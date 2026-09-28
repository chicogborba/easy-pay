//! Paying a link: demo payments, Stripe Checkout, Mercado Pago Checkout Pro,
//! connecting sellers' payout accounts and the providers' webhooks.

use std::time::Duration;

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Redirect, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    auth::{self, Account, CurrentAccount},
    crypto, db,
    models::{Link, PayRequest, Payer},
    not_found,
    payments::{provider_for_country, Provider},
    ApiError, ApiResult, AppState,
};

const DAY_MS: i64 = 86_400_000;

/// Who is paying: typed on the checkout page, or the saved customer when they tapped "it's me".
pub async fn resolve_payer(s: &AppState, link: &Link, mut req: PayRequest) -> Result<Payer, ApiError> {
    if req.name.trim().is_empty() && req.phone.trim().is_empty() {
        if let Some(cid) = link.customer_id {
            if let Some((name, phone)) = db::customer_contact(&s.db, &link.merchant_id, cid).await? {
                req.name = name;
                req.phone = phone;
            }
        }
    }
    req.payer().map_err(|e| ApiError(StatusCode::BAD_REQUEST, e.into()))
}

/// How a link can be paid right now: "mock", "stripe" or "mercadopago".
pub fn mode_for_seller(s: &AppState, seller: Option<&Account>) -> &'static str {
    match seller {
        Some(a) => s.payments.mode_for(&a.country),
        // Links from before accounts existed: demo only.
        None => "mock",
    }
}

/// A link can be paid only while waiting and while its seller's account is active.
async fn payable_link(s: &AppState, id: &str) -> Result<(Link, Option<Account>), ApiError> {
    let link = db::get_link(&s.db, id).await?.ok_or_else(not_found)?;
    if link.status != "waiting" {
        return Err(ApiError(StatusCode::CONFLICT, link.status));
    }
    match auth::account_by_id(&s.db, &link.merchant_id).await? {
        Some(a) if a.status != "active" => Err(ApiError(StatusCode::CONFLICT, "unavailable".into())),
        seller => Ok((link, seller)),
    }
}

/// Demo payment. Only when real payments are off for this seller's country.
pub async fn pay_link(State(s): State<AppState>, Path(id): Path<String>, Json(req): Json<PayRequest>) -> ApiResult<Link> {
    let method = match req.method.as_str() {
        "apple_pay" | "google_pay" | "card" | "pix" => req.method.clone(),
        _ => return Err(ApiError(StatusCode::BAD_REQUEST, "invalid method".into())),
    };
    let (link, seller) = payable_link(&s, &id).await?;
    if mode_for_seller(&s, seller.as_ref()) != "mock" && std::env::var("ALLOW_MOCK_PAYMENTS").as_deref() != Ok("true") {
        return Err(ApiError(StatusCode::CONFLICT, "use checkout".into()));
    }
    // Simulate the processor taking a moment.
    tokio::time::sleep(Duration::from_millis(900)).await;
    let payer = resolve_payer(&s, &link, req).await?;
    if !db::mark_paid(&s.db, &id, "mock", &method, &payer, s.payments.fees).await? {
        return Err(ApiError(StatusCode::CONFLICT, "paid".into()));
    }
    db::get_link(&s.db, &id).await?.map(|l| Json(l.public())).ok_or_else(not_found)
}

/// Real payments: returns the provider's checkout URL (Stripe or Mercado Pago).
pub async fn checkout(State(s): State<AppState>, Path(id): Path<String>, Json(req): Json<PayRequest>) -> ApiResult<Value> {
    let (link, seller) = payable_link(&s, &id).await?;
    let Some(seller) = seller else { return Err(ApiError(StatusCode::CONFLICT, "mock".into())) };
    let payer = resolve_payer(&s, &link, req).await?;
    let fee = s.payments.fee_cents(link.total_cents, seller.fee_bps_override, &seller.country);
    let not_ready = || ApiError(StatusCode::CONFLICT, "seller not ready to receive payments".into());

    let (reference, url) = match mode_for_seller(&s, Some(&seller)) {
        "stripe" => {
            let stripe = s.payments.stripe.as_ref().expect("live");
            let destination = seller.stripe_account_id.as_deref().filter(|_| seller.stripe_charges_enabled);
            if destination.is_none() && stripe.require_connect {
                return Err(not_ready());
            }
            stripe.create_checkout(&link, &payer, destination, if destination.is_some() { fee } else { 0 }).await?
        }
        "mercadopago" => {
            let mp = s.payments.mp.as_ref().expect("live");
            let token = mp_token(&s, &seller.id).await?.ok_or_else(not_ready)?;
            mp.create_preference(&token, &link, &payer, fee).await?
        }
        _ => return Err(ApiError(StatusCode::CONFLICT, "mock".into())),
    };
    db::set_provider_ref(&s.db, &id, &reference).await?;
    Ok(Json(json!({ "url": url })))
}

/* ---------------- connecting a seller's payout account ---------------- */

/// Stripe: Express onboarding link. Mercado Pago: OAuth authorization URL.
pub async fn connect_payouts(State(s): State<AppState>, CurrentAccount(a): CurrentAccount) -> ApiResult<Value> {
    match provider_for_country(&a.country) {
        Provider::Stripe => {
            let stripe = s.payments.stripe.as_ref().ok_or_else(|| ApiError(StatusCode::CONFLICT, "demo".into()))?;
            let account = match a.stripe_account_id {
                Some(acct) => acct,
                None => {
                    let acct = stripe.create_account(&a.email, &a.id, &a.country).await?;
                    sqlx::query("UPDATE accounts SET stripe_account_id = $2 WHERE id = $1")
                        .bind(&a.id)
                        .bind(&acct)
                        .execute(&s.db)
                        .await
                        .map_err(anyhow::Error::from)?;
                    acct
                }
            };
            Ok(Json(json!({ "url": stripe.onboarding_link(&account).await? })))
        }
        Provider::MercadoPago => {
            let mp = s.payments.mp.as_ref().ok_or_else(|| ApiError(StatusCode::CONFLICT, "demo".into()))?;
            let state = auth::create_one_time(&s.db, &a.id, "mp_oauth", 30 * 60_000).await?;
            Ok(Json(json!({ "url": mp.authorize_url(&state) })))
        }
    }
}

#[derive(Deserialize)]
pub struct OAuthCallback {
    code: Option<String>,
    state: Option<String>,
}

/// Mercado Pago sends the seller back here after they authorize us.
pub async fn mp_callback(State(s): State<AppState>, Query(q): Query<OAuthCallback>) -> Response {
    let done = |ok: bool| Redirect::to(&format!("{}/settings?payments={}", s.payments.app_url, if ok { "connected" } else { "error" })).into_response();
    let (Some(mp), Some(code), Some(state)) = (s.payments.mp.as_ref(), q.code, q.state) else { return done(false) };
    let account = match auth::consume_one_time(&s.db, &state, "mp_oauth").await {
        Ok(Some(id)) => id,
        _ => return done(false),
    };
    match mp.exchange_code(&code).await {
        Ok(tokens) => match store_mp_tokens(&s, &account, &tokens).await {
            Ok(()) => {
                tracing::info!(account, mp_user = tokens.user_id, "mercado pago connected");
                done(true)
            }
            Err(e) => {
                tracing::error!("store mp tokens: {e:#}");
                done(false)
            }
        },
        Err(e) => {
            tracing::warn!("mercado pago oauth failed: {e:#}");
            done(false)
        }
    }
}

async fn store_mp_tokens(s: &AppState, account: &str, t: &crate::mercadopago::Tokens) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE accounts SET mp_user_id = $2, mp_access_token = $3, mp_refresh_token = $4, mp_token_expires_at = $5 WHERE id = $1",
    )
    .bind(account)
    .bind(t.user_id.to_string())
    .bind(crypto::encrypt(&t.access_token)?)
    .bind(crypto::encrypt(&t.refresh_token)?)
    .bind(db::now_ms() + t.expires_in * 1000)
    .execute(&s.db)
    .await?;
    Ok(())
}

/// The seller's Mercado Pago access token, refreshed when it is about to expire.
async fn mp_token(s: &AppState, account: &str) -> Result<Option<String>, ApiError> {
    let row: Option<(Option<String>, Option<String>, Option<i64>)> =
        sqlx::query_as("SELECT mp_access_token, mp_refresh_token, mp_token_expires_at FROM accounts WHERE id = $1")
            .bind(account)
            .fetch_optional(&s.db)
            .await
            .map_err(anyhow::Error::from)?;
    let Some((Some(access), Some(refresh), expires)) = row else { return Ok(None) };
    if expires.unwrap_or(0) > db::now_ms() + DAY_MS {
        return Ok(Some(crypto::decrypt(&access)?));
    }
    let mp = s.payments.mp.as_ref().ok_or_else(not_found)?;
    let tokens = mp.refresh(&crypto::decrypt(&refresh)?).await?;
    store_mp_tokens(s, account, &tokens).await?;
    Ok(Some(tokens.access_token))
}

/// Stops sending money to this Mercado Pago account (the seller can connect another one).
pub async fn disconnect_payouts(State(s): State<AppState>, CurrentAccount(a): CurrentAccount) -> ApiResult<Account> {
    sqlx::query(
        "UPDATE accounts SET mp_user_id = NULL, mp_access_token = NULL, mp_refresh_token = NULL, mp_token_expires_at = NULL,
                             stripe_account_id = NULL, stripe_charges_enabled = FALSE WHERE id = $1",
    )
    .bind(&a.id)
    .execute(&s.db)
    .await
    .map_err(anyhow::Error::from)?;
    Ok(Json(auth::account_by_id(&s.db, &a.id).await?.expect("exists")))
}

/* ---------------- webhooks ---------------- */

fn payer_from_metadata(meta: &Value) -> Option<Payer> {
    PayRequest {
        method: String::new(),
        name: meta["payer_name"].as_str().unwrap_or("").into(),
        phone: meta["payer_phone"].as_str().unwrap_or("").into(),
        email: meta["payer_email"].as_str().unwrap_or("").into(),
    }
    .payer()
    .ok()
}

/// Stripe → us. Signature-checked; idempotent (paying an already-paid link is a no-op).
pub async fn stripe_webhook(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> Result<&'static str, ApiError> {
    let stripe = s.payments.stripe.as_ref().ok_or_else(not_found)?;
    let sig = headers.get("stripe-signature").and_then(|v| v.to_str().ok()).unwrap_or("");
    if !crate::payments::verify_webhook(&stripe.webhook_secret, &body, sig, db::now_ms() / 1000) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "bad signature".into()));
    }
    let event: Value = serde_json::from_slice(&body).map_err(|_| ApiError(StatusCode::BAD_REQUEST, "bad json".into()))?;
    let obj = &event["data"]["object"];
    match event["type"].as_str().unwrap_or("") {
        "checkout.session.completed" | "checkout.session.async_payment_succeeded" if obj["payment_status"] == "paid" => {
            let link_id = obj["client_reference_id"].as_str().unwrap_or("");
            match payer_from_metadata(&obj["metadata"]) {
                Some(payer) => {
                    let paid = db::mark_paid(&s.db, link_id, "stripe", "stripe", &payer, s.payments.fees).await?;
                    tracing::info!(link = link_id, paid, "stripe payment confirmed");
                }
                None => tracing::warn!(link = link_id, "stripe payment without valid payer metadata"),
            }
        }
        "account.updated" => {
            sqlx::query("UPDATE accounts SET stripe_charges_enabled = $2 WHERE stripe_account_id = $1")
                .bind(obj["id"].as_str().unwrap_or(""))
                .bind(obj["charges_enabled"].as_bool().unwrap_or(false))
                .execute(&s.db)
                .await
                .map_err(anyhow::Error::from)?;
        }
        _ => {}
    }
    Ok("ok")
}

#[derive(Deserialize, Default)]
pub struct MpQuery {
    #[serde(rename = "data.id")]
    data_id: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
}

/// Mercado Pago → us. We never trust the body: the payment is fetched from Mercado Pago
/// with the seller's token and must belong to one of that seller's links.
pub async fn mp_webhook(State(s): State<AppState>, headers: HeaderMap, Query(q): Query<MpQuery>, body: Bytes) -> Result<&'static str, ApiError> {
    let mp = s.payments.mp.as_ref().ok_or_else(not_found)?;
    let event: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let kind = q.kind.or_else(|| event["type"].as_str().map(str::to_string)).unwrap_or_default();
    let payment_id = q
        .data_id
        .or_else(|| event["data"]["id"].as_str().map(str::to_string))
        .or_else(|| event["data"]["id"].as_i64().map(|v| v.to_string()))
        .unwrap_or_default();
    if kind != "payment" || payment_id.is_empty() {
        return Ok("ignored");
    }
    let header = |k: &str| headers.get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    if !mp.verify_signature(&header("x-signature"), &header("x-request-id"), &payment_id) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "bad signature".into()));
    }
    // Which seller: Mercado Pago sends their user id.
    let mp_user = event["user_id"].as_i64().map(|v| v.to_string()).or_else(|| event["user_id"].as_str().map(str::to_string));
    let Some(mp_user) = mp_user else { return Ok("no seller") };
    let seller: Option<String> = sqlx::query_scalar("SELECT id FROM accounts WHERE mp_user_id = $1")
        .bind(&mp_user)
        .fetch_optional(&s.db)
        .await
        .map_err(anyhow::Error::from)?;
    let Some(seller) = seller else { return Ok("unknown seller") };
    let Some(token) = mp_token(&s, &seller).await? else { return Ok("disconnected") };

    let payment = mp.get_payment(&token, &payment_id).await?;
    if payment["status"] != "approved" {
        return Ok("not approved");
    }
    let link_id = payment["external_reference"].as_str().unwrap_or("");
    let Some(link) = db::get_link(&s.db, link_id).await? else { return Ok("unknown link") };
    if link.merchant_id != seller {
        tracing::warn!(link = link_id, "mercado pago payment for another seller's link");
        return Ok("mismatch");
    }
    let method = payment["payment_type_id"].as_str().unwrap_or("mercadopago").to_string();
    match payer_from_metadata(&payment["metadata"]) {
        Some(payer) => {
            let paid = db::mark_paid(&s.db, link_id, "mercadopago", &method, &payer, s.payments.fees).await?;
            db::set_provider_ref(&s.db, link_id, &payment_id).await?;
            tracing::info!(link = link_id, paid, "mercado pago payment confirmed");
        }
        None => tracing::warn!(link = link_id, "mercado pago payment without payer metadata"),
    }
    Ok("ok")
}
