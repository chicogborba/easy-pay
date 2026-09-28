//! Payments: a mock provider for demos and Stripe (Checkout + Connect) for real money.
//!
//! Stripe turns on by setting STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. See STRIPE.md.
//! Flow:
//!   1. Seller connects a Stripe Express account (POST /api/account/stripe/onboard).
//!   2. Customer fills name/phone, POST /api/links/:id/checkout returns a Stripe Checkout URL
//!      (Apple Pay, Google Pay, cards, Pix... are handled by Stripe).
//!   3. Stripe calls POST /api/webhooks/stripe; `checkout.session.completed` marks the link paid.

use anyhow::{anyhow, bail, Result};
use hmac::{Hmac, Mac};
use serde_json::Value;
use sha2::Sha256;

use crate::models::{Link, Payer};

const API: &str = "https://api.stripe.com/v1";

#[derive(Clone)]
pub enum Payments {
    Mock,
    Stripe(Stripe),
}

#[derive(Clone)]
pub struct Stripe {
    http: reqwest::Client,
    secret_key: String,
    pub webhook_secret: String,
    /// Platform fee in basis points (300 = 3%), kept by the platform on each payment.
    fee_bps: i64,
    /// Public URL of the app, for redirects (e.g. https://pay.example.com).
    pub app_url: String,
    /// Refuse payments until the seller finished Stripe onboarding (recommended).
    pub require_connect: bool,
}

impl Payments {
    pub fn from_env() -> Self {
        let key = std::env::var("STRIPE_SECRET_KEY").unwrap_or_default();
        if key.trim().is_empty() {
            return Payments::Mock;
        }
        let webhook_secret = std::env::var("STRIPE_WEBHOOK_SECRET").unwrap_or_default();
        if webhook_secret.is_empty() {
            tracing::warn!("STRIPE_WEBHOOK_SECRET not set: payments will never be confirmed");
        }
        Payments::Stripe(Stripe {
            http: reqwest::Client::new(),
            secret_key: key.trim().to_string(),
            webhook_secret,
            fee_bps: std::env::var("PLATFORM_FEE_BPS").ok().and_then(|v| v.parse().ok()).unwrap_or(0),
            app_url: std::env::var("APP_URL").unwrap_or_else(|_| "http://localhost:5173".into()).trim_end_matches('/').to_string(),
            require_connect: std::env::var("STRIPE_REQUIRE_CONNECT").map(|v| v != "false").unwrap_or(true),
        })
    }

    pub fn mode(&self) -> &'static str {
        match self {
            Payments::Mock => "mock",
            Payments::Stripe(_) => "stripe",
        }
    }
}

impl Stripe {
    async fn post(&self, path: &str, form: &[(String, String)], account: Option<&str>) -> Result<Value> {
        let mut req = self.http.post(format!("{API}{path}")).basic_auth(&self.secret_key, Some("")).form(form);
        if let Some(acct) = account {
            req = req.header("Stripe-Account", acct);
        }
        let res = req.send().await?;
        let status = res.status();
        let body: Value = res.json().await?;
        if !status.is_success() {
            bail!("stripe {path} {status}: {}", body["error"]["message"].as_str().unwrap_or("unknown error"));
        }
        Ok(body)
    }

    /// Stripe Checkout page for one link. Returns (session id, url).
    pub async fn create_checkout(&self, link: &Link, payer: &Payer, destination: Option<&str>) -> Result<(String, String)> {
        let currency = link.currency.to_lowercase();
        let mut f: Vec<(String, String)> = vec![
            ("mode".into(), "payment".into()),
            ("success_url".into(), format!("{}/p/{}?paid=1", self.app_url, link.id)),
            ("cancel_url".into(), format!("{}/p/{}", self.app_url, link.id)),
            ("client_reference_id".into(), link.id.clone()),
            ("metadata[link_id]".into(), link.id.clone()),
            // Who is paying: applied to the seller's customer list when the payment succeeds.
            ("metadata[payer_name]".into(), payer.name.clone()),
            ("metadata[payer_phone]".into(), payer.phone.clone()),
            ("metadata[payer_email]".into(), payer.email.clone()),
            ("payment_intent_data[metadata][link_id]".into(), link.id.clone()),
            ("payment_intent_data[description]".into(), format!("{} · {}", link.business_name, link.id)),
        ];
        if !payer.email.is_empty() {
            f.push(("customer_email".into(), payer.email.clone()));
        }
        // One Checkout line per receipt line. Lines are priced as a whole ("2 breads for 20"),
        // so quantity 1 with the quantity in the name keeps totals exact.
        for (i, it) in link.items.iter().enumerate() {
            let name = if it.quantity > 1 { format!("{}× {}", it.quantity, it.name) } else { it.name.clone() };
            f.push((format!("line_items[{i}][quantity]"), "1".into()));
            f.push((format!("line_items[{i}][price_data][currency]"), currency.clone()));
            f.push((format!("line_items[{i}][price_data][unit_amount]"), it.total_cents.to_string()));
            f.push((format!("line_items[{i}][price_data][product_data][name]"), name));
        }
        if let Some(acct) = destination {
            // Destination charge: money goes to the seller, the platform keeps its fee.
            f.push(("payment_intent_data[transfer_data][destination]".into(), acct.to_string()));
            let fee = link.total_cents * self.fee_bps / 10_000;
            if fee > 0 {
                f.push(("payment_intent_data[application_fee_amount]".into(), fee.to_string()));
            }
        }
        let s = self.post("/checkout/sessions", &f, None).await?;
        let id = s["id"].as_str().ok_or_else(|| anyhow!("no session id"))?.to_string();
        let url = s["url"].as_str().ok_or_else(|| anyhow!("no session url"))?.to_string();
        Ok((id, url))
    }

    /// Creates the seller's Stripe Express account.
    pub async fn create_account(&self, email: &str, seller_id: &str) -> Result<String> {
        let f = vec![
            ("type".into(), "express".into()),
            ("email".into(), email.to_string()),
            ("metadata[seller_id]".into(), seller_id.to_string()),
            ("capabilities[card_payments][requested]".into(), "true".into()),
            ("capabilities[transfers][requested]".into(), "true".into()),
        ];
        let a = self.post("/accounts", &f, None).await?;
        a["id"].as_str().map(str::to_string).ok_or_else(|| anyhow!("no account id"))
    }

    /// One-time onboarding URL where the seller fills in their bank and identity details.
    pub async fn onboarding_link(&self, account: &str) -> Result<String> {
        let f = vec![
            ("account".into(), account.to_string()),
            ("type".into(), "account_onboarding".into()),
            ("refresh_url".into(), format!("{}/settings?stripe=refresh", self.app_url)),
            ("return_url".into(), format!("{}/settings?stripe=done", self.app_url)),
        ];
        let l = self.post("/account_links", &f, None).await?;
        l["url"].as_str().map(str::to_string).ok_or_else(|| anyhow!("no onboarding url"))
    }
}

/// Checks the `Stripe-Signature` header (`t=...,v1=...`): HMAC-SHA256 of "{t}.{payload}"
/// with the endpoint secret, and a timestamp no older than 5 minutes.
pub fn verify_webhook(secret: &str, payload: &[u8], sig_header: &str, now_secs: i64) -> bool {
    let mut ts = None;
    let mut sigs = Vec::new();
    for part in sig_header.split(',') {
        match part.trim().split_once('=') {
            Some(("t", v)) => ts = v.parse::<i64>().ok(),
            Some(("v1", v)) => sigs.push(v.to_string()),
            _ => {}
        }
    }
    let Some(ts) = ts else { return false };
    if (now_secs - ts).abs() > 300 || secret.is_empty() {
        return false;
    }
    sigs.iter().any(|sig| {
        let Ok(expected) = hex::decode(sig) else { return false };
        let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else { return false };
        mac.update(ts.to_string().as_bytes());
        mac.update(b".");
        mac.update(payload);
        mac.verify_slice(&expected).is_ok() // constant-time comparison
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sign(secret: &str, ts: i64, payload: &[u8]) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(format!("{ts}.").as_bytes());
        mac.update(payload);
        hex::encode(mac.finalize().into_bytes())
    }

    #[test]
    fn webhook_signature() {
        let body = br#"{"type":"checkout.session.completed"}"#;
        let sig = sign("whsec_test", 1_700_000_000, body);
        let header = format!("t=1700000000,v1={sig}");
        assert!(verify_webhook("whsec_test", body, &header, 1_700_000_100));
        // Wrong secret, tampered body, or too old.
        assert!(!verify_webhook("whsec_other", body, &header, 1_700_000_100));
        assert!(!verify_webhook("whsec_test", b"{}", &header, 1_700_000_100));
        assert!(!verify_webhook("whsec_test", body, &header, 1_700_001_000));
        assert!(!verify_webhook("whsec_test", body, "garbage", 1_700_000_100));
    }
}
