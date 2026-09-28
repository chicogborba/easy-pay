//! Seller accounts: sign up, log in, sessions and account settings.
//!
//! Sessions are random tokens in an HttpOnly cookie; only their SHA-256 is stored,
//! so the app stays stateless and can run on several instances.

use anyhow::Result;
use argon2::{
    password_hash::{rand_core::OsRng, SaltString},
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
};
use axum::{
    async_trait,
    extract::{FromRequestParts, State},
    http::{header, request::Parts, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};

use crate::{db::now_ms, ApiError, ApiResult, AppState};

const COOKIE: &str = "ep_session";
const SESSION_DAYS: i64 = 30;
const DAY_MS: i64 = 86_400_000;

#[derive(Debug, Clone, Serialize)]
pub struct Account {
    pub id: String,
    pub email: String,
    pub business_name: String,
    pub lang: String,
    pub currency: String,
    pub status: String,
    pub plan: String,
    pub created_at: i64,
    pub stripe_account_id: Option<String>,
    pub stripe_charges_enabled: bool,
    /// Platform owner (email listed in ADMIN_EMAILS).
    pub is_admin: bool,
}

const ACCOUNT_COLS: &str = "id, email, business_name, lang, currency, status, plan, created_at, \
                            stripe_account_id, stripe_charges_enabled";

fn row_to_account(r: &sqlx::postgres::PgRow) -> Result<Account, sqlx::Error> {
    let email: String = r.try_get("email")?;
    Ok(Account {
        id: r.try_get("id")?,
        is_admin: is_admin_email(&email),
        email,
        business_name: r.try_get("business_name")?,
        lang: r.try_get("lang")?,
        currency: r.try_get("currency")?,
        status: r.try_get("status")?,
        plan: r.try_get("plan")?,
        created_at: r.try_get("created_at")?,
        stripe_account_id: r.try_get("stripe_account_id")?,
        stripe_charges_enabled: r.try_get("stripe_charges_enabled")?,
    })
}

pub fn is_admin_email(email: &str) -> bool {
    std::env::var("ADMIN_EMAILS")
        .unwrap_or_default()
        .split(',')
        .any(|a| !a.trim().is_empty() && a.trim().eq_ignore_ascii_case(email))
}

/* ---------------- passwords & tokens ---------------- */

pub fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| anyhow::anyhow!("hash: {e}"))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .map(|h| Argon2::default().verify_password(password.as_bytes(), &h).is_ok())
        .unwrap_or(false)
}

fn new_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

fn new_account_id() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Session token from the cookie (browsers) or `Authorization: Bearer` (API clients).
fn token_from(headers: &HeaderMap) -> Option<String> {
    if let Some(b) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        if let Some(t) = b.strip_prefix("Bearer ") {
            return Some(t.trim().to_string());
        }
    }
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .find_map(|c| c.trim().strip_prefix(&format!("{COOKIE}=")).map(str::to_string))
}

/// Secure cookies behind HTTPS (Caddy/Heroku set X-Forwarded-Proto), or when forced by COOKIE_SECURE.
fn cookie_secure(headers: &HeaderMap) -> bool {
    match std::env::var("COOKIE_SECURE").ok().as_deref() {
        Some("true") => true,
        Some("false") => false,
        _ => headers.get("x-forwarded-proto").and_then(|v| v.to_str().ok()) == Some("https"),
    }
}

fn session_cookie(token: &str, max_age_secs: i64, secure: bool) -> String {
    format!(
        "{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age_secs}{}",
        if secure { "; Secure" } else { "" }
    )
}

/* ---------------- db ---------------- */

pub async fn account_by_id(pool: &PgPool, id: &str) -> Result<Option<Account>> {
    let row = sqlx::query(&format!("SELECT {ACCOUNT_COLS} FROM accounts WHERE id = $1"))
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row.as_ref().map(row_to_account).transpose()?)
}

async fn create_session(pool: &PgPool, account_id: &str) -> Result<String> {
    let token = new_token();
    let now = now_ms();
    sqlx::query("INSERT INTO sessions (token_hash, account_id, created_at, expires_at, last_seen_at) VALUES ($1, $2, $3, $4, $3)")
        .bind(token_hash(&token))
        .bind(account_id)
        .bind(now)
        .bind(now + SESSION_DAYS * DAY_MS)
        .execute(pool)
        .await?;
    Ok(token)
}

/// Resolves a session token to its (active or suspended) account and refreshes activity
/// at most every few minutes, so busy accounts don't write on every request.
async fn account_for_token(pool: &PgPool, token: &str) -> Result<Option<Account>> {
    let hash = token_hash(token);
    let now = now_ms();
    let row = sqlx::query(&format!(
        "SELECT s.last_seen_at AS session_seen, {} FROM sessions s JOIN accounts a ON a.id = s.account_id
         WHERE s.token_hash = $1 AND s.expires_at > $2",
        ACCOUNT_COLS.split(", ").map(|c| format!("a.{c}")).collect::<Vec<_>>().join(", ")
    ))
    .bind(&hash)
    .bind(now)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else { return Ok(None) };
    let account = row_to_account(&row)?;
    let seen: i64 = row.try_get("session_seen")?;
    if now - seen > 5 * 60_000 {
        let pool = pool.clone();
        let id = account.id.clone();
        tokio::spawn(async move {
            let _ = sqlx::query("UPDATE sessions SET last_seen_at = $2, expires_at = $3 WHERE token_hash = $1")
                .bind(&hash)
                .bind(now)
                .bind(now + SESSION_DAYS * DAY_MS)
                .execute(&pool)
                .await;
            let _ = sqlx::query("UPDATE accounts SET last_seen_at = $2 WHERE id = $1").bind(&id).bind(now).execute(&pool).await;
        });
    }
    Ok(Some(account))
}

/* ---------------- extractors ---------------- */

/// The logged-in, active seller.
pub struct CurrentAccount(pub Account);

/// Just the seller's id (= merchant_id in every table).
pub struct Merchant(pub String);

#[async_trait]
impl FromRequestParts<AppState> for CurrentAccount {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = token_from(&parts.headers).ok_or_else(unauthorized)?;
        let account = account_for_token(&state.db, &token).await?.ok_or_else(unauthorized)?;
        if account.status != "active" {
            return Err(ApiError(StatusCode::FORBIDDEN, "account suspended".into()));
        }
        Ok(CurrentAccount(account))
    }
}

#[async_trait]
impl FromRequestParts<AppState> for Merchant {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        CurrentAccount::from_request_parts(parts, state).await.map(|a| Merchant(a.0.id))
    }
}

fn unauthorized() -> ApiError {
    ApiError(StatusCode::UNAUTHORIZED, "login required".into())
}

/* ---------------- handlers ---------------- */

#[derive(Deserialize)]
pub struct RegisterRequest {
    email: String,
    password: String,
    business_name: String,
    #[serde(default)]
    lang: String,
    #[serde(default)]
    currency: String,
    /// Random id the device used before accounts existed: its links move into the new account.
    #[serde(default)]
    claim_id: String,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    email: String,
    password: String,
}

fn valid_email(e: &str) -> bool {
    let e = e.trim();
    e.len() <= 120 && e.contains('@') && e.rsplit('@').next().is_some_and(|d| d.contains('.')) && !e.contains(' ')
}

fn with_session(account: Account, token: &str, headers: &HeaderMap) -> Response {
    let cookie = session_cookie(token, SESSION_DAYS * 86_400, cookie_secure(headers));
    ([(header::SET_COOKIE, cookie)], Json(account)).into_response()
}

pub async fn register(State(s): State<AppState>, headers: HeaderMap, Json(req): Json<RegisterRequest>) -> Result<Response, ApiError> {
    let email = req.email.trim().to_lowercase();
    if !valid_email(&email) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "invalid email".into()));
    }
    if req.password.chars().count() < 8 || req.password.len() > 200 {
        return Err(ApiError(StatusCode::BAD_REQUEST, "password too short".into()));
    }
    let business: String = req.business_name.trim().chars().take(60).collect();
    if business.is_empty() {
        return Err(ApiError(StatusCode::BAD_REQUEST, "business name required".into()));
    }
    if !s.signup_limiter.check(&client_ip(&headers)) {
        return Err(ApiError(StatusCode::TOO_MANY_REQUESTS, "too many attempts".into()));
    }
    let lang = if req.lang.len() == 2 { req.lang.to_lowercase() } else { "en".into() };
    let currency = if req.currency.len() == 3 { req.currency.to_uppercase() } else { "USD".into() };

    // Keep data created before accounts existed, if that id isn't taken.
    let claim = req.claim_id.trim();
    let id = if (8..=64).contains(&claim.len())
        && claim.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && account_by_id(&s.db, claim).await?.is_none()
    {
        claim.to_string()
    } else {
        new_account_id()
    };

    let hash = hash_password(&req.password)?;
    let inserted = sqlx::query(
        "INSERT INTO accounts (id, email, password_hash, business_name, lang, currency, created_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7) ON CONFLICT DO NOTHING",
    )
    .bind(&id)
    .bind(&email)
    .bind(hash)
    .bind(&business)
    .bind(&lang)
    .bind(&currency)
    .bind(now_ms())
    .execute(&s.db)
    .await
    .map_err(anyhow::Error::from)?;
    if inserted.rows_affected() == 0 {
        return Err(ApiError(StatusCode::CONFLICT, "email already registered".into()));
    }
    crate::db::track(&s.db, &id, "signup");
    let token = create_session(&s.db, &id).await?;
    let account = account_by_id(&s.db, &id).await?.expect("just created");
    Ok(with_session(account, &token, &headers))
}

pub async fn login(State(s): State<AppState>, headers: HeaderMap, Json(req): Json<LoginRequest>) -> Result<Response, ApiError> {
    let email = req.email.trim().to_lowercase();
    if !s.login_limiter.check(&format!("{}|{email}", client_ip(&headers))) {
        return Err(ApiError(StatusCode::TOO_MANY_REQUESTS, "too many attempts, try again in a few minutes".into()));
    }
    let row = sqlx::query("SELECT id, password_hash, status FROM accounts WHERE email = $1")
        .bind(&email)
        .fetch_optional(&s.db)
        .await
        .map_err(anyhow::Error::from)?;
    let wrong = || ApiError(StatusCode::UNAUTHORIZED, "wrong email or password".into());
    let Some(row) = row else {
        // Same work as a real check, so timing doesn't reveal which emails exist.
        static DUMMY: std::sync::OnceLock<String> = std::sync::OnceLock::new();
        let dummy = DUMMY.get_or_init(|| hash_password("dummy-password").unwrap_or_default());
        let _ = verify_password(&req.password, dummy);
        return Err(wrong());
    };
    let (id, hash, status): (String, String, String) =
        (row.try_get("id").map_err(anyhow::Error::from)?, row.try_get("password_hash").map_err(anyhow::Error::from)?, row.try_get("status").map_err(anyhow::Error::from)?);
    if !verify_password(&req.password, &hash) {
        return Err(wrong());
    }
    if status != "active" {
        return Err(ApiError(StatusCode::FORBIDDEN, "account suspended".into()));
    }
    // Housekeeping: drop this account's expired sessions.
    let _ = sqlx::query("DELETE FROM sessions WHERE account_id = $1 AND expires_at < $2").bind(&id).bind(now_ms()).execute(&s.db).await;
    let token = create_session(&s.db, &id).await?;
    let account = account_by_id(&s.db, &id).await?.expect("exists");
    Ok(with_session(account, &token, &headers))
}

pub async fn logout(State(s): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(token) = token_from(&headers) {
        let _ = sqlx::query("DELETE FROM sessions WHERE token_hash = $1").bind(token_hash(&token)).execute(&s.db).await;
    }
    ([(header::SET_COOKIE, session_cookie("", 0, cookie_secure(&headers)))], Json(json!({ "ok": true }))).into_response()
}

pub async fn me(CurrentAccount(a): CurrentAccount) -> Json<Account> {
    Json(a)
}

#[derive(Deserialize)]
pub struct UpdateAccountRequest {
    business_name: Option<String>,
    lang: Option<String>,
    currency: Option<String>,
}

pub async fn update_account(
    State(s): State<AppState>,
    CurrentAccount(a): CurrentAccount,
    Json(req): Json<UpdateAccountRequest>,
) -> ApiResult<Account> {
    let business = req.business_name.map(|b| b.trim().chars().take(60).collect::<String>()).filter(|b| !b.is_empty());
    let lang = req.lang.filter(|l| l.len() == 2).map(|l| l.to_lowercase());
    let currency = req.currency.filter(|c| c.len() == 3).map(|c| c.to_uppercase());
    sqlx::query(
        "UPDATE accounts SET business_name = COALESCE($2, business_name), lang = COALESCE($3, lang),
                             currency = COALESCE($4, currency) WHERE id = $1",
    )
    .bind(&a.id)
    .bind(business)
    .bind(lang)
    .bind(currency)
    .execute(&s.db)
    .await
    .map_err(anyhow::Error::from)?;
    Ok(Json(account_by_id(&s.db, &a.id).await?.expect("exists")))
}

#[derive(Deserialize)]
pub struct ChangePasswordRequest {
    current: String,
    new: String,
}

/// Changing the password logs out every other device.
pub async fn change_password(
    State(s): State<AppState>,
    headers: HeaderMap,
    CurrentAccount(a): CurrentAccount,
    Json(req): Json<ChangePasswordRequest>,
) -> ApiResult<serde_json::Value> {
    if req.new.chars().count() < 8 || req.new.len() > 200 {
        return Err(ApiError(StatusCode::BAD_REQUEST, "password too short".into()));
    }
    let hash: String = sqlx::query_scalar("SELECT password_hash FROM accounts WHERE id = $1")
        .bind(&a.id)
        .fetch_one(&s.db)
        .await
        .map_err(anyhow::Error::from)?;
    if !verify_password(&req.current, &hash) {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "wrong password".into()));
    }
    sqlx::query("UPDATE accounts SET password_hash = $2 WHERE id = $1")
        .bind(&a.id)
        .bind(hash_password(&req.new)?)
        .execute(&s.db)
        .await
        .map_err(anyhow::Error::from)?;
    let keep = token_from(&headers).map(|t| token_hash(&t)).unwrap_or_default();
    sqlx::query("DELETE FROM sessions WHERE account_id = $1 AND token_hash <> $2")
        .bind(&a.id)
        .bind(keep)
        .execute(&s.db)
        .await
        .map_err(anyhow::Error::from)?;
    Ok(Json(json!({ "ok": true })))
}

/// Best-effort client IP (behind Caddy/Heroku the first X-Forwarded-For entry).
pub fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|v| v.trim().to_string())
        .unwrap_or_else(|| "unknown".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_roundtrip() {
        let h = hash_password("correct horse").unwrap();
        assert!(verify_password("correct horse", &h));
        assert!(!verify_password("wrong horse", &h));
        assert!(!verify_password("x", "not-a-hash"));
    }

    #[test]
    fn reads_cookie_and_bearer() {
        let mut h = HeaderMap::new();
        h.insert(header::COOKIE, "a=1; ep_session=abc; b=2".parse().unwrap());
        assert_eq!(token_from(&h).as_deref(), Some("abc"));
        h.insert(header::AUTHORIZATION, "Bearer xyz".parse().unwrap());
        assert_eq!(token_from(&h).as_deref(), Some("xyz"));
    }

    #[test]
    fn email_validation() {
        assert!(valid_email("ana@bakery.com"));
        assert!(!valid_email("ana@bakery"));
        assert!(!valid_email("ana bakery.com"));
    }
}
