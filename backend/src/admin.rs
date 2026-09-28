//! Platform admin panel (for whoever runs Easy Pay): every account, how much they use the
//! app, and the money flowing through it. Access: accounts whose email is in ADMIN_EMAILS.
//! Everything here is plain SQL aggregates, so it stays fast as accounts grow.

use axum::{
    async_trait,
    extract::{FromRequestParts, Path, Query, State},
    http::{request::Parts, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool};

use crate::{
    auth::{account_by_id, Account, CurrentAccount},
    db::now_ms,
    ApiError, ApiResult, AppState,
};

const DAY_MS: i64 = 86_400_000;

pub struct Admin(pub Account);

#[async_trait]
impl FromRequestParts<AppState> for Admin {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let CurrentAccount(a) = CurrentAccount::from_request_parts(parts, state).await?;
        if !a.is_admin {
            return Err(ApiError(StatusCode::FORBIDDEN, "admins only".into()));
        }
        Ok(Admin(a))
    }
}

fn db_err(e: sqlx::Error) -> ApiError {
    ApiError::from(anyhow::Error::from(e))
}

#[derive(Serialize, FromRow)]
struct CurrencyTotal {
    currency: String,
    cents: i64,
    count: i64,
}

#[derive(Serialize, FromRow)]
struct DayCount {
    day: i64,
    count: i64,
}

#[derive(Serialize, FromRow)]
struct KindCount {
    kind: String,
    count: i64,
}

async fn gmv(pool: &PgPool, since: i64, account: Option<&str>) -> Result<Vec<CurrencyTotal>, ApiError> {
    sqlx::query_as(
        "SELECT currency, COALESCE(SUM(total_cents), 0)::BIGINT AS cents, COUNT(*) AS count FROM links
         WHERE status = 'paid' AND COALESCE(paid_at, created_at) >= $1 AND ($2::TEXT IS NULL OR merchant_id = $2)
         GROUP BY currency ORDER BY cents DESC",
    )
    .bind(since)
    .bind(account)
    .fetch_all(pool)
    .await
    .map_err(db_err)
}

/// What the platform earned (its fee on each payment), per currency.
async fn revenue(pool: &PgPool, since: i64, account: Option<&str>) -> Result<Vec<CurrencyTotal>, ApiError> {
    sqlx::query_as(
        "SELECT currency, COALESCE(SUM(platform_fee_cents), 0)::BIGINT AS cents, COUNT(*) AS count FROM links
         WHERE status = 'paid' AND COALESCE(paid_at, created_at) >= $1 AND ($2::TEXT IS NULL OR merchant_id = $2)
         GROUP BY currency ORDER BY cents DESC",
    )
    .bind(since)
    .bind(account)
    .fetch_all(pool)
    .await
    .map_err(db_err)
}

#[derive(Serialize, FromRow)]
struct CountryCount {
    country: String,
    accounts: i64,
    connected: i64,
}

async fn usage_by_kind(pool: &PgPool, since: i64, account: Option<&str>) -> Result<Vec<KindCount>, ApiError> {
    sqlx::query_as(
        "SELECT kind, COUNT(*) AS count FROM usage_events
         WHERE created_at >= $1 AND ($2::TEXT IS NULL OR account_id = $2) GROUP BY kind ORDER BY count DESC",
    )
    .bind(since)
    .bind(account)
    .fetch_all(pool)
    .await
    .map_err(db_err)
}

/// Daily counts for the last 30 days (UTC days) of a table's timestamp column.
async fn per_day(pool: &PgPool, sql: &str, since: i64, account: Option<&str>) -> Result<Vec<DayCount>, ApiError> {
    sqlx::query_as(sql).bind(since).bind(account).fetch_all(pool).await.map_err(db_err)
}

async fn scalar(pool: &PgPool, sql: &str, since: i64) -> Result<i64, ApiError> {
    sqlx::query_scalar(sql).bind(since).fetch_one(pool).await.map_err(db_err)
}

async fn count(pool: &PgPool, sql: &str) -> Result<i64, ApiError> {
    sqlx::query_scalar(sql).fetch_one(pool).await.map_err(db_err)
}

pub async fn overview(State(s): State<AppState>, _: Admin) -> ApiResult<Value> {
    let db = &s.db;
    let now = now_ms();
    let d30 = now - 30 * DAY_MS;
    let d7 = now - 7 * DAY_MS;
    Ok(Json(json!({
        "accounts_total": count(db, "SELECT COUNT(*) FROM accounts").await?,
        "accounts_active_7d": scalar(db, "SELECT COUNT(*) FROM accounts WHERE last_seen_at >= $1", d7).await?,
        "accounts_active_30d": scalar(db, "SELECT COUNT(*) FROM accounts WHERE last_seen_at >= $1", d30).await?,
        "accounts_new_30d": scalar(db, "SELECT COUNT(*) FROM accounts WHERE created_at >= $1", d30).await?,
        "accounts_stripe_ready": count(db, "SELECT COUNT(*) FROM accounts WHERE stripe_charges_enabled").await?,
        "links_total": count(db, "SELECT COUNT(*) FROM links").await?,
        "links_30d": scalar(db, "SELECT COUNT(*) FROM links WHERE created_at >= $1", d30).await?,
        "customers_total": count(db, "SELECT COUNT(*) FROM customers").await?,
        "gmv_all": gmv(db, 0, None).await?,
        "gmv_30d": gmv(db, d30, None).await?,
        "revenue_all": revenue(db, 0, None).await?,
        "revenue_30d": revenue(db, d30, None).await?,
        "accounts_payouts_connected": count(db, "SELECT COUNT(*) FROM accounts WHERE stripe_charges_enabled OR mp_user_id IS NOT NULL").await?,
        "accounts_verified": count(db, "SELECT COUNT(*) FROM accounts WHERE email_verified_at IS NOT NULL").await?,
        "by_country": sqlx::query_as::<_, CountryCount>(
            "SELECT CASE WHEN country = '' THEN '??' ELSE country END AS country, COUNT(*) AS accounts,
                    COUNT(*) FILTER (WHERE stripe_charges_enabled OR mp_user_id IS NOT NULL) AS connected
             FROM accounts GROUP BY 1 ORDER BY 2 DESC LIMIT 20")
            .fetch_all(db).await.map_err(db_err)?,
        "usage_30d": usage_by_kind(db, d30, None).await?,
        "signups_by_day": per_day(db,
            "SELECT (created_at / 86400000) * 86400000 AS day, COUNT(*) AS count FROM accounts
             WHERE created_at >= $1 AND ($2::TEXT IS NULL OR id = $2) GROUP BY 1 ORDER BY 1", d30, None).await?,
        "links_by_day": per_day(db,
            "SELECT (created_at / 86400000) * 86400000 AS day, COUNT(*) AS count FROM links
             WHERE created_at >= $1 AND ($2::TEXT IS NULL OR merchant_id = $2) GROUP BY 1 ORDER BY 1", d30, None).await?,
        "providers": { "stripe": s.payments.stripe.is_some(), "mercadopago": s.payments.mp.is_some() },
        "default_fee_bps": s.payments.default_fee_bps,
        "ai_enabled": s.ai.enabled(),
    })))
}

#[derive(Deserialize)]
pub struct AccountsQuery {
    q: Option<String>,
    sort: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

#[derive(Serialize, FromRow)]
pub struct AccountRow {
    id: String,
    email: String,
    business_name: String,
    owner_name: String,
    country: String,
    fee_bps_override: Option<i64>,
    payouts_connected: bool,
    /// Platform fees earned from this seller, in their currency.
    revenue_cents: i64,
    currency: String,
    status: String,
    plan: String,
    created_at: i64,
    last_seen_at: Option<i64>,
    stripe_charges_enabled: bool,
    links: i64,
    paid_links: i64,
    /// Paid volume in the account's own currency.
    gmv_cents: i64,
    customers: i64,
    ai_calls_30d: i64,
}

pub async fn accounts(State(s): State<AppState>, _: Admin, Query(q): Query<AccountsQuery>) -> ApiResult<Value> {
    let order = match q.sort.as_deref() {
        Some("gmv") => "gmv_cents DESC",
        Some("revenue") => "revenue_cents DESC",
        Some("links") => "links DESC",
        Some("ai") => "ai_calls_30d DESC",
        Some("active") => "last_seen_at DESC NULLS LAST",
        _ => "created_at DESC",
    };
    let search = q.q.as_deref().map(|s| format!("%{}%", s.trim().to_lowercase())).filter(|s| s.len() > 2);
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let offset = q.offset.unwrap_or(0).max(0);
    // Aggregates are grouped once per table (not per row), so this scales with the number of links.
    let sql = format!(
        "WITH l AS (
             SELECT merchant_id, COUNT(*) AS links,
                    COUNT(*) FILTER (WHERE status = 'paid') AS paid_links
             FROM links GROUP BY merchant_id),
         g AS (
             SELECT l.merchant_id, COALESCE(SUM(l.total_cents), 0)::BIGINT AS gmv_cents,
                    COALESCE(SUM(l.platform_fee_cents), 0)::BIGINT AS revenue_cents
             FROM links l JOIN accounts a ON a.id = l.merchant_id AND a.currency = l.currency
             WHERE l.status = 'paid' GROUP BY l.merchant_id),
         c AS (SELECT merchant_id, COUNT(*) AS customers FROM customers GROUP BY merchant_id),
         u AS (SELECT account_id, COUNT(*) AS ai_calls_30d FROM usage_events
               WHERE created_at >= $1 AND kind LIKE 'ai_%' GROUP BY account_id)
         SELECT a.id, a.email, a.business_name, a.owner_name, a.country, a.currency, a.status, a.plan,
                a.created_at, a.last_seen_at, a.stripe_charges_enabled, a.fee_bps_override,
                (a.stripe_charges_enabled OR a.mp_user_id IS NOT NULL) AS payouts_connected,
                COALESCE(g.revenue_cents, 0)::BIGINT AS revenue_cents,
                COALESCE(l.links, 0) AS links, COALESCE(l.paid_links, 0) AS paid_links,
                COALESCE(g.gmv_cents, 0)::BIGINT AS gmv_cents, COALESCE(c.customers, 0) AS customers,
                COALESCE(u.ai_calls_30d, 0) AS ai_calls_30d
         FROM accounts a
         LEFT JOIN l ON l.merchant_id = a.id LEFT JOIN g ON g.merchant_id = a.id
         LEFT JOIN c ON c.merchant_id = a.id LEFT JOIN u ON u.account_id = a.id
         WHERE ($2::TEXT IS NULL OR lower(a.email) LIKE $2 OR lower(a.business_name) LIKE $2 OR lower(a.owner_name) LIKE $2)
         ORDER BY {order} LIMIT $3 OFFSET $4"
    );
    let rows: Vec<AccountRow> = sqlx::query_as(&sql)
        .bind(now_ms() - 30 * DAY_MS)
        .bind(&search)
        .bind(limit)
        .bind(offset)
        .fetch_all(&s.db)
        .await
        .map_err(db_err)?;
    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM accounts WHERE ($1::TEXT IS NULL OR lower(email) LIKE $1 OR lower(business_name) LIKE $1)",
    )
    .bind(&search)
    .fetch_one(&s.db)
    .await
    .map_err(db_err)?;
    Ok(Json(json!({ "total": total, "accounts": rows })))
}

pub async fn account_detail(State(s): State<AppState>, _: Admin, Path(id): Path<String>) -> ApiResult<Value> {
    let db = &s.db;
    let mut account = account_by_id(db, &id).await?.ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "not found".into()))?;
    // The admin sees enough to identify the seller, not the full tax id.
    account.document = crate::profile::mask_document(&account.document);
    let d30 = now_ms() - 30 * DAY_MS;
    let recent = crate::db::list_links_page(db, &id, None, None, 15).await?;
    let last_seen: Option<i64> = sqlx::query_scalar("SELECT last_seen_at FROM accounts WHERE id = $1")
        .bind(&id)
        .fetch_one(db)
        .await
        .map_err(db_err)?;
    Ok(Json(json!({
        "account": account,
        "last_seen_at": last_seen,
        "gmv_all": gmv(db, 0, Some(&id)).await?,
        "gmv_30d": gmv(db, d30, Some(&id)).await?,
        "revenue_all": revenue(db, 0, Some(&id)).await?,
        "revenue_30d": revenue(db, d30, Some(&id)).await?,
        "default_fee_bps": s.payments.default_fee_bps,
        "usage_30d": usage_by_kind(db, d30, Some(&id)).await?,
        "usage_by_day": per_day(db,
            "SELECT (created_at / 86400000) * 86400000 AS day, COUNT(*) AS count FROM usage_events
             WHERE created_at >= $1 AND account_id = $2 GROUP BY 1 ORDER BY 1", d30, Some(&id)).await?,
        "links_by_day": per_day(db,
            "SELECT (created_at / 86400000) * 86400000 AS day, COUNT(*) AS count FROM links
             WHERE created_at >= $1 AND merchant_id = $2 GROUP BY 1 ORDER BY 1", d30, Some(&id)).await?,
        "customers": sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM customers WHERE merchant_id = $1")
            .bind(&id).fetch_one(db).await.map_err(db_err)?,
        "recent_links": recent,
    })))
}

#[derive(Deserialize)]
pub struct StatusRequest {
    status: String,
}

/// Suspend (logs the seller out everywhere, links stop accepting payments) or reactivate.
pub async fn set_status(
    State(s): State<AppState>,
    Admin(admin): Admin,
    Path(id): Path<String>,
    Json(req): Json<StatusRequest>,
) -> ApiResult<Value> {
    if !matches!(req.status.as_str(), "active" | "suspended") {
        return Err(ApiError(StatusCode::BAD_REQUEST, "invalid status".into()));
    }
    if id == admin.id {
        return Err(ApiError(StatusCode::BAD_REQUEST, "you can't suspend yourself".into()));
    }
    let r = sqlx::query("UPDATE accounts SET status = $2 WHERE id = $1")
        .bind(&id)
        .bind(&req.status)
        .execute(&s.db)
        .await
        .map_err(db_err)?;
    if r.rows_affected() == 0 {
        return Err(ApiError(StatusCode::NOT_FOUND, "not found".into()));
    }
    if req.status == "suspended" {
        sqlx::query("DELETE FROM sessions WHERE account_id = $1").bind(&id).execute(&s.db).await.map_err(db_err)?;
    }
    tracing::info!(admin = %admin.email, account = %id, status = %req.status, "account status changed");
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub struct FeeRequest {
    /// Basis points (300 = 3%); null = back to the platform default.
    fee_bps: Option<i64>,
}

/// Custom fee for one seller (e.g. a promo or a bigger customer). Applies to future payments.
pub async fn set_fee(State(s): State<AppState>, Admin(admin): Admin, Path(id): Path<String>, Json(req): Json<FeeRequest>) -> ApiResult<Value> {
    if req.fee_bps.is_some_and(|b| !(0..=5000).contains(&b)) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "fee must be between 0 and 50%".into()));
    }
    let r = sqlx::query("UPDATE accounts SET fee_bps_override = $2 WHERE id = $1")
        .bind(&id)
        .bind(req.fee_bps)
        .execute(&s.db)
        .await
        .map_err(db_err)?;
    if r.rows_affected() == 0 {
        return Err(ApiError(StatusCode::NOT_FOUND, "not found".into()));
    }
    tracing::info!(admin = %admin.email, account = %id, fee_bps = ?req.fee_bps, "fee changed");
    Ok(Json(json!({ "ok": true })))
}
