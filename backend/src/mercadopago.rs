//! Mercado Pago for Brazilian sellers (Pix, cards, boleto via Checkout Pro).
//!
//! Marketplace model: each seller connects their own Mercado Pago account with OAuth,
//! payments are created with the seller's token (money goes to them) and the platform
//! keeps `marketplace_fee`. Turns on with MP_CLIENT_ID + MP_CLIENT_SECRET. See PAYMENTS.md.

use anyhow::{anyhow, bail, Result};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;

use crate::models::{Link, Payer};

const API: &str = "https://api.mercadopago.com";

#[derive(Clone)]
pub struct MercadoPago {
    http: reqwest::Client,
    client_id: String,
    client_secret: String,
    /// "Secret signature" of the webhook (Your integrations → Webhooks). Optional but recommended.
    webhook_secret: String,
    auth_url: String,
    app_url: String,
    /// Use sandbox checkout URLs (test users).
    sandbox: bool,
}

#[derive(Debug, Deserialize)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
    pub user_id: i64,
    pub expires_in: i64,
}

impl MercadoPago {
    pub fn from_env(app_url: &str) -> Option<Self> {
        let client_id = std::env::var("MP_CLIENT_ID").ok().filter(|v| !v.trim().is_empty())?;
        let client_secret = std::env::var("MP_CLIENT_SECRET").ok().filter(|v| !v.trim().is_empty())?;
        Some(Self {
            http: reqwest::Client::new(),
            client_id: client_id.trim().into(),
            client_secret: client_secret.trim().into(),
            webhook_secret: std::env::var("MP_WEBHOOK_SECRET").unwrap_or_default(),
            auth_url: std::env::var("MP_AUTH_URL").unwrap_or_else(|_| "https://auth.mercadopago.com.br/authorization".into()),
            app_url: app_url.to_string(),
            sandbox: std::env::var("MP_SANDBOX").as_deref() == Ok("true"),
        })
    }

    pub fn redirect_uri(&self) -> String {
        format!("{}/api/oauth/mercadopago/callback", self.app_url)
    }

    /// Where the seller logs into Mercado Pago and authorizes the platform.
    pub fn authorize_url(&self, state: &str) -> String {
        format!(
            "{}?client_id={}&response_type=code&platform_id=mp&state={}&redirect_uri={}",
            self.auth_url,
            urlencoding::encode(&self.client_id),
            urlencoding::encode(state),
            urlencoding::encode(&self.redirect_uri())
        )
    }

    async fn token_request(&self, body: Value) -> Result<Tokens> {
        let res = self.http.post(format!("{API}/oauth/token")).json(&body).send().await?;
        let status = res.status();
        let v: Value = res.json().await?;
        if !status.is_success() {
            bail!("mercadopago oauth {status}: {}", v["message"].as_str().unwrap_or("error"));
        }
        Ok(serde_json::from_value(v)?)
    }

    pub async fn exchange_code(&self, code: &str) -> Result<Tokens> {
        self.token_request(json!({
            "client_id": self.client_id, "client_secret": self.client_secret,
            "grant_type": "authorization_code", "code": code, "redirect_uri": self.redirect_uri(),
        }))
        .await
    }

    pub async fn refresh(&self, refresh_token: &str) -> Result<Tokens> {
        self.token_request(json!({
            "client_id": self.client_id, "client_secret": self.client_secret,
            "grant_type": "refresh_token", "refresh_token": refresh_token,
        }))
        .await
    }

    /// Checkout Pro preference paid to the seller (their token), with the platform fee.
    /// Returns (preference id, checkout URL).
    pub async fn create_preference(&self, seller_token: &str, link: &Link, payer: &Payer, fee_cents: i64) -> Result<(String, String)> {
        let items: Vec<Value> = link
            .items
            .iter()
            .map(|it| {
                let title = if it.quantity > 1 { format!("{}× {}", it.quantity, it.name) } else { it.name.clone() };
                json!({ "title": title, "quantity": 1, "currency_id": link.currency, "unit_price": it.total_cents as f64 / 100.0 })
            })
            .collect();
        let back = format!("{}/p/{}", self.app_url, link.id);
        let mut body = json!({
            "items": items,
            "external_reference": link.id,
            "payer": { "name": payer.name, "phone": { "number": payer.phone } },
            "back_urls": { "success": format!("{back}?paid=1"), "pending": format!("{back}?paid=1"), "failure": back },
            "auto_return": "approved",
            "notification_url": format!("{}/api/webhooks/mercadopago", self.app_url),
            "statement_descriptor": link.business_name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == ' ').take(22).collect::<String>(),
            "metadata": { "link_id": link.id, "payer_name": payer.name, "payer_phone": payer.phone, "payer_email": payer.email },
        });
        if !payer.email.is_empty() {
            body["payer"]["email"] = json!(payer.email);
        }
        if fee_cents > 0 {
            body["marketplace_fee"] = json!(fee_cents as f64 / 100.0);
        }
        let res = self.http.post(format!("{API}/checkout/preferences")).bearer_auth(seller_token).json(&body).send().await?;
        let status = res.status();
        let v: Value = res.json().await?;
        if !status.is_success() {
            bail!("mercadopago preference {status}: {}", v["message"].as_str().unwrap_or("error"));
        }
        let url_key = if self.sandbox { "sandbox_init_point" } else { "init_point" };
        let url = v[url_key].as_str().ok_or_else(|| anyhow!("no checkout url"))?.to_string();
        Ok((v["id"].as_str().unwrap_or_default().to_string(), url))
    }

    /// The payment as Mercado Pago sees it (the source of truth, never the webhook body).
    pub async fn get_payment(&self, seller_token: &str, payment_id: &str) -> Result<Value> {
        let res = self.http.get(format!("{API}/v1/payments/{payment_id}")).bearer_auth(seller_token).send().await?;
        let status = res.status();
        let v: Value = res.json().await?;
        if !status.is_success() {
            bail!("mercadopago payment {status}");
        }
        Ok(v)
    }

    /// Webhook authenticity (x-signature "ts=..,v1=.."): HMAC-SHA256 of
    /// "id:{data.id};request-id:{x-request-id};ts:{ts};". Skipped when no secret is configured
    /// (we fetch the payment from the API anyway, so a forged body can't mark anything paid).
    pub fn verify_signature(&self, x_signature: &str, request_id: &str, data_id: &str) -> bool {
        if self.webhook_secret.is_empty() {
            return true;
        }
        verify_signature(&self.webhook_secret, x_signature, request_id, data_id)
    }
}

pub fn verify_signature(secret: &str, x_signature: &str, request_id: &str, data_id: &str) -> bool {
    let (mut ts, mut v1) = (None, None);
    for part in x_signature.split(',') {
        match part.trim().split_once('=') {
            Some(("ts", v)) => ts = Some(v.to_string()),
            Some(("v1", v)) => v1 = Some(v.to_string()),
            _ => {}
        }
    }
    let (Some(ts), Some(v1)) = (ts, v1) else { return false };
    let Ok(expected) = hex::decode(v1) else { return false };
    let id = if data_id.chars().all(|c| c.is_ascii_alphanumeric()) { data_id.to_lowercase() } else { data_id.to_string() };
    let manifest = format!("id:{id};request-id:{request_id};ts:{ts};");
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else { return false };
    mac.update(manifest.as_bytes());
    mac.verify_slice(&expected).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webhook_signature() {
        let manifest = "id:123456;request-id:req-1;ts:1700000000;";
        let mut mac = Hmac::<Sha256>::new_from_slice(b"mp_secret").unwrap();
        mac.update(manifest.as_bytes());
        let sig = hex::encode(mac.finalize().into_bytes());
        let header = format!("ts=1700000000,v1={sig}");
        assert!(verify_signature("mp_secret", &header, "req-1", "123456"));
        assert!(!verify_signature("other", &header, "req-1", "123456"));
        assert!(!verify_signature("mp_secret", &header, "req-2", "123456"));
        assert!(!verify_signature("mp_secret", "nonsense", "req-1", "123456"));
    }
}
