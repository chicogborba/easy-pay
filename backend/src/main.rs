mod admin;
mod ai;
mod auth;
mod db;
mod limits;
mod models;
mod payments;

use std::{sync::Arc, time::Duration};

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use sqlx::PgPool;
use serde_json::json;
use tower_http::{
    compression::CompressionLayer,
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
    timeout::TimeoutLayer,
    trace::TraceLayer,
};

use auth::Merchant;
use limits::RateLimiter;
use models::*;
use payments::Payments;

/// Shared, cheap to clone. Nothing here holds per-user state, so the app can run
/// as many instances as needed behind a load balancer (sessions live in Postgres).
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub ai: ai::Ai,
    pub payments: Payments,
    pub login_limiter: Arc<RateLimiter>,
    pub signup_limiter: Arc<RateLimiter>,
    /// Keeps AI costs bounded per seller.
    pub ai_limiter: Arc<RateLimiter>,
}

pub type ApiResult<T> = Result<Json<T>, ApiError>;

pub struct ApiError(pub StatusCode, pub String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        tracing::error!("{e:#}");
        ApiError(StatusCode::INTERNAL_SERVER_ERROR, "internal error".into())
    }
}

fn not_found() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "not found".into())
}

fn ai_limited(s: &AppState, merchant: &str) -> Result<(), ApiError> {
    if s.ai_limiter.check(merchant) {
        Ok(())
    } else {
        Err(ApiError(StatusCode::TOO_MANY_REQUESTS, "slow down a little and try again in a minute".into()))
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,tower_http=info".into()),
        )
        .init();

    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres:postgres@localhost:5432/easypay".into());
    let per_min = |var: &str, default: u32| std::env::var(var).ok().and_then(|v| v.parse().ok()).unwrap_or(default);
    let state = AppState {
        db: db::connect(&db_url).await?,
        ai: ai::Ai::from_env(),
        payments: Payments::from_env(),
        login_limiter: Arc::new(RateLimiter::new(10, Duration::from_secs(15 * 60))),
        signup_limiter: Arc::new(RateLimiter::new(20, Duration::from_secs(60 * 60))),
        ai_limiter: Arc::new(RateLimiter::new(per_min("AI_REQUESTS_PER_MINUTE", 30), Duration::from_secs(60))),
    };
    tracing::info!("payments: {}", state.payments.mode());
    if !state.ai.enabled() {
        tracing::warn!("OPENROUTER_API_KEY not set: using the offline parser and voice is disabled");
    }

    let app = router(state);

    // Heroku (and most hosts) tell us the port through $PORT.
    let addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| {
        format!("0.0.0.0:{}", std::env::var("PORT").unwrap_or_else(|_| "8080".into()))
    });
    tracing::info!("listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    // Finish in-flight requests on deploys/restarts instead of cutting them off.
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let ctrl_c = tokio::signal::ctrl_c();
            let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("signal");
            tokio::select! { _ = ctrl_c => {}, _ = term.recv() => {} }
            tracing::info!("shutting down");
        })
        .await?;
    Ok(())
}

/// Every route of the app (also used by the API tests).
fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .route("/config", get(config))
        // accounts
        .route("/auth/register", post(auth::register))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me))
        .route("/account", post(auth::update_account))
        .route("/account/password", post(auth::change_password))
        .route("/account/stripe/onboard", post(stripe_onboard))
        // platform admin
        .route("/admin/overview", get(admin::overview))
        .route("/admin/accounts", get(admin::accounts))
        .route("/admin/accounts/:id", get(admin::account_detail))
        .route("/admin/accounts/:id/status", post(admin::set_status))
        // payments
        .route("/links/:id/checkout", post(checkout))
        .route("/links/updates", get(link_updates))
        .route("/webhooks/stripe", post(stripe_webhook))
        .route("/chat", post(chat))
        .route("/chat/stream", post(chat_stream))
        .route("/transcribe", post(transcribe))
        .route("/links", get(list_links).post(create_link))
        .route("/links/:id", get(get_link))
        .route("/links/:id/cancel", post(cancel_link))
        .route("/links/:id/pay", post(pay_link))
        .route("/stats", get(stats))
        .route("/products", get(list_products))
        .route("/products/:id", get(get_product))
        .route("/products/:id/rename", post(rename_product))
        .route("/products/:id/merge", post(merge_product))
        .route("/insights", post(insights))
        .route("/customers", get(list_customers))
        .route("/customers/:id", get(get_customer).post(update_customer));

    // Serve the built frontend (SPA) from the same server.
    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "../frontend/dist".into());
    let spa = ServeDir::new(&static_dir).fallback(ServeFile::new(format!("{static_dir}/index.html")));

    Router::new()
        .nest("/api", api)
        .fallback_service(spa)
        .layer(axum::extract::DefaultBodyLimit::max(8 * 1024 * 1024))
        .layer(CompressionLayer::new())
        // Chat streaming and voice can take a while; everything else is fast.
        .layer(TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, Duration::from_secs(90)))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn config(State(s): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({ "ai": s.ai.enabled(), "voice": s.ai.enabled(), "payments": s.payments.mode() }))
}

/// For load balancers / uptime checks: also proves the database answers.
async fn health(State(s): State<AppState>) -> Result<&'static str, ApiError> {
    sqlx::query("SELECT 1").execute(&s.db).await.map_err(|e| {
        tracing::error!("health: {e}");
        ApiError(StatusCode::SERVICE_UNAVAILABLE, "db down".into())
    })?;
    Ok("ok")
}

async fn chat(
    State(s): State<AppState>,
    Merchant(merchant): Merchant,
    Json(req): Json<ChatRequest>,
) -> ApiResult<ChatResponse> {
    if req.messages.is_empty() {
        return Err(ApiError(StatusCode::BAD_REQUEST, "empty conversation".into()));
    }
    ai_limited(&s, &merchant)?;
    db::track(&s.db, &merchant, "ai_chat");
    // The merchant's known products let the AI group synonyms and reuse usual prices.
    let catalog = db::catalog(&s.db, &merchant).await?;
    Ok(Json(s.ai.chat(&req.messages, &req.lang, &req.currency, &catalog).await))
}

/// Same as `/chat`, but as newline-delimited JSON: `{"delta": "..."}` for each piece of
/// the reply while the model writes it, then `{"done": ChatResponse}`.
async fn chat_stream(
    State(s): State<AppState>,
    Merchant(merchant): Merchant,
    Json(req): Json<ChatRequest>,
) -> Result<Response, ApiError> {
    if req.messages.is_empty() {
        return Err(ApiError(StatusCode::BAD_REQUEST, "empty conversation".into()));
    }
    ai_limited(&s, &merchant)?;
    db::track(&s.db, &merchant, "ai_chat");
    let catalog = db::catalog(&s.db, &merchant).await?;
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Result<String, std::convert::Infallible>>();
    tokio::spawn(async move {
        let delta_tx = tx.clone();
        let res = s
            .ai
            .chat_stream(&req.messages, &req.lang, &req.currency, &catalog, move |d| {
                let _ = delta_tx.send(Ok(format!("{}\n", json!({ "delta": d }))));
            })
            .await;
        let _ = tx.send(Ok(format!("{}\n", json!({ "done": res }))));
    });
    let body = axum::body::Body::from_stream(tokio_stream::wrappers::UnboundedReceiverStream::new(rx));
    Ok((
        [
            (axum::http::header::CONTENT_TYPE, "application/x-ndjson"),
            (axum::http::header::CACHE_CONTROL, "no-cache"),
            // Tell proxies not to buffer, so tokens reach the phone as they come.
            (axum::http::HeaderName::from_static("x-accel-buffering"), "no"),
        ],
        body,
    )
        .into_response())
}

async fn transcribe(
    State(s): State<AppState>,
    Merchant(merchant): Merchant,
    Json(req): Json<TranscribeRequest>,
) -> ApiResult<TranscribeResponse> {
    if !s.ai.enabled() {
        return Err(ApiError(StatusCode::SERVICE_UNAVAILABLE, "voice not configured".into()));
    }
    ai_limited(&s, &merchant)?;
    db::track(&s.db, &merchant, "ai_voice");
    let text = s.ai.transcribe(&req.audio_base64, &req.lang).await?;
    Ok(Json(TranscribeResponse { text }))
}

async fn create_link(
    State(s): State<AppState>,
    Merchant(merchant): Merchant,
    Json(req): Json<CreateLinkRequest>,
) -> ApiResult<Link> {
    let draft = req
        .draft
        .sanitize()
        .ok_or_else(|| ApiError(StatusCode::BAD_REQUEST, "no items".into()))?;
    let business: String = req.business_name.chars().take(60).collect();
    let db = &s.db;
    db::track(db, &merchant, "link_created");
    Ok(Json(db::create_link(db, &merchant, &business, &draft).await?))
}

#[derive(serde::Deserialize)]
struct LinksQuery {
    status: Option<String>,
    /// created_at of the last link already shown (pagination cursor).
    before: Option<i64>,
    limit: Option<i64>,
}

async fn list_links(State(s): State<AppState>, Merchant(merchant): Merchant, Query(q): Query<LinksQuery>) -> ApiResult<Vec<Link>> {
    let status = q.status.as_deref().filter(|s| matches!(*s, "waiting" | "paid" | "cancelled"));
    Ok(Json(db::list_links_page(&s.db, &merchant, status, q.before, q.limit.unwrap_or(50)).await?))
}

#[derive(serde::Deserialize)]
struct UpdatesQuery {
    since: i64,
}

/// Links paid since a timestamp: the app polls this (cheap, indexed) to celebrate payments.
async fn link_updates(State(s): State<AppState>, Merchant(merchant): Merchant, Query(q): Query<UpdatesQuery>) -> ApiResult<serde_json::Value> {
    let paid = db::paid_since(&s.db, &merchant, q.since).await?;
    Ok(Json(json!({ "now": db::now_ms(), "paid": paid })))
}

/// Public (the customer opens it), but who paid is only shown to the link's owner.
async fn get_link(State(s): State<AppState>, merchant: Option<Merchant>, Path(id): Path<String>) -> ApiResult<Link> {
    let mut link = db::get_link(&s.db, &id).await?.ok_or_else(not_found)?;
    let owner = merchant.is_some_and(|Merchant(m)| m == link.merchant_id);
    if link.status == "waiting" {
        if let Some(cid) = link.customer_id {
            if let Some((name, phone)) = db::customer_contact(&s.db, &link.merchant_id, cid).await? {
                let digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
                let last4 = digits[digits.len().saturating_sub(4)..].to_string();
                link.known_customer = Some(KnownCustomer { name, phone_last4: last4 });
            }
        }
    }
    Ok(Json(if owner { link } else { link.public() }))
}

async fn cancel_link(State(s): State<AppState>, Merchant(merchant): Merchant, Path(id): Path<String>) -> ApiResult<Link> {
    let db = &s.db;
    if !db::cancel_link(db, &merchant, &id).await? {
        return Err(ApiError(StatusCode::CONFLICT, "cannot cancel".into()));
    }
    db::get_link(db, &id).await?.map(Json).ok_or_else(not_found)
}

/// Who is paying: typed on the checkout page, or the saved customer when they tapped "it's me".
async fn resolve_payer(s: &AppState, link: &Link, mut req: PayRequest) -> Result<Payer, ApiError> {
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

/// A link can be paid only while waiting and while its seller's account is active.
async fn payable_link(s: &AppState, id: &str) -> Result<(Link, auth::Account), ApiError> {
    let link = db::get_link(&s.db, id).await?.ok_or_else(not_found)?;
    if link.status != "waiting" {
        return Err(ApiError(StatusCode::CONFLICT, link.status));
    }
    let seller = auth::account_by_id(&s.db, &link.merchant_id).await?;
    match seller {
        // Links made before accounts existed have no account row: still payable in demo mode.
        None if matches!(s.payments, Payments::Mock) => {}
        Some(a) if a.status == "active" => return Ok((link, a)),
        _ => return Err(ApiError(StatusCode::CONFLICT, "unavailable".into())),
    }
    let placeholder = auth::Account {
        id: link.merchant_id.clone(),
        email: String::new(),
        business_name: link.business_name.clone(),
        lang: "en".into(),
        currency: link.currency.clone(),
        status: "active".into(),
        plan: "free".into(),
        created_at: 0,
        stripe_account_id: None,
        stripe_charges_enabled: false,
        is_admin: false,
    };
    Ok((link, placeholder))
}

/// MOCK payment (demo mode). With Stripe enabled use /checkout instead.
async fn pay_link(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<PayRequest>,
) -> ApiResult<Link> {
    if !matches!(s.payments, Payments::Mock) && std::env::var("ALLOW_MOCK_PAYMENTS").as_deref() != Ok("true") {
        return Err(ApiError(StatusCode::CONFLICT, "use checkout".into()));
    }
    let method = match req.method.as_str() {
        "apple_pay" | "google_pay" | "card" => req.method.clone(),
        _ => return Err(ApiError(StatusCode::BAD_REQUEST, "invalid method".into())),
    };
    // Simulate the processor taking a moment.
    tokio::time::sleep(Duration::from_millis(900)).await;
    let (link, _) = payable_link(&s, &id).await?;
    let payer = resolve_payer(&s, &link, req).await?;
    // The UPDATE only matches a waiting link, so two payments can't both succeed.
    if !db::pay_link(&s.db, &id, &method, &payer).await? {
        return Err(ApiError(StatusCode::CONFLICT, "paid".into()));
    }
    db::get_link(&s.db, &id).await?.map(|l| Json(l.public())).ok_or_else(not_found)
}

/// Real payments: returns the Stripe Checkout URL for this link.
async fn checkout(State(s): State<AppState>, Path(id): Path<String>, Json(req): Json<PayRequest>) -> ApiResult<serde_json::Value> {
    let Payments::Stripe(stripe) = &s.payments else {
        return Err(ApiError(StatusCode::CONFLICT, "mock".into()));
    };
    let (link, seller) = payable_link(&s, &id).await?;
    let payer = resolve_payer(&s, &link, req).await?;
    let destination = seller.stripe_account_id.as_deref().filter(|_| seller.stripe_charges_enabled);
    if destination.is_none() && stripe.require_connect {
        return Err(ApiError(StatusCode::CONFLICT, "seller not ready to receive payments".into()));
    }
    let (session_id, url) = stripe.create_checkout(&link, &payer, destination).await?;
    db::set_provider_ref(&s.db, &id, &session_id).await?;
    Ok(Json(json!({ "url": url })))
}

/// Seller connects (or finishes connecting) their Stripe account to receive money.
async fn stripe_onboard(State(s): State<AppState>, auth::CurrentAccount(a): auth::CurrentAccount) -> ApiResult<serde_json::Value> {
    let Payments::Stripe(stripe) = &s.payments else {
        return Err(ApiError(StatusCode::CONFLICT, "payments are in demo mode".into()));
    };
    let account = match a.stripe_account_id {
        Some(acct) => acct,
        None => {
            let acct = stripe.create_account(&a.email, &a.id).await?;
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

/// Stripe → us. Signature-checked; idempotent (paying an already-paid link is a no-op).
async fn stripe_webhook(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> Result<&'static str, ApiError> {
    let Payments::Stripe(stripe) = &s.payments else { return Err(not_found()) };
    let sig = headers.get("stripe-signature").and_then(|v| v.to_str().ok()).unwrap_or("");
    if !payments::verify_webhook(&stripe.webhook_secret, &body, sig, db::now_ms() / 1000) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "bad signature".into()));
    }
    let event: serde_json::Value = serde_json::from_slice(&body).map_err(|_| ApiError(StatusCode::BAD_REQUEST, "bad json".into()))?;
    let obj = &event["data"]["object"];
    match event["type"].as_str().unwrap_or("") {
        "checkout.session.completed" | "checkout.session.async_payment_succeeded" if obj["payment_status"] == "paid" => {
            let link_id = obj["client_reference_id"].as_str().unwrap_or("");
            let meta = &obj["metadata"];
            let req = PayRequest {
                method: "stripe".into(),
                name: meta["payer_name"].as_str().unwrap_or("").into(),
                phone: meta["payer_phone"].as_str().unwrap_or("").into(),
                email: meta["payer_email"].as_str().unwrap_or("").into(),
            };
            if let Ok(payer) = req.payer() {
                let paid = db::pay_link(&s.db, link_id, "stripe", &payer).await?;
                tracing::info!(link = link_id, paid, "stripe payment confirmed");
            } else {
                tracing::warn!(link = link_id, "stripe payment without valid payer metadata");
            }
        }
        "account.updated" => {
            let acct = obj["id"].as_str().unwrap_or("");
            let enabled = obj["charges_enabled"].as_bool().unwrap_or(false);
            sqlx::query("UPDATE accounts SET stripe_charges_enabled = $2 WHERE stripe_account_id = $1")
                .bind(acct)
                .bind(enabled)
                .execute(&s.db)
                .await
                .map_err(anyhow::Error::from)?;
        }
        _ => {}
    }
    Ok("ok")
}

async fn stats(State(s): State<AppState>, Merchant(merchant): Merchant, Query(q): Query<StatsQuery>) -> ApiResult<Stats> {
    let currency = q.currency.unwrap_or_else(|| "USD".into()).to_uppercase();
    let db = &s.db;
    Ok(Json(db::stats(db, &merchant, &currency, q.tz_offset.unwrap_or(0)).await?))
}

async fn list_products(
    State(s): State<AppState>,
    Merchant(merchant): Merchant,
    Query(q): Query<StatsQuery>,
) -> ApiResult<Vec<ProductSummary>> {
    let currency = q.currency.unwrap_or_else(|| "USD".into()).to_uppercase();
    let db = &s.db;
    Ok(Json(db::products(db, &merchant, &currency, q.tz_offset.unwrap_or(0), q.days).await?))
}

async fn get_product(
    State(s): State<AppState>,
    Merchant(merchant): Merchant,
    Path(id): Path<i64>,
    Query(q): Query<StatsQuery>,
) -> ApiResult<ProductDetail> {
    let currency = q.currency.unwrap_or_else(|| "USD".into()).to_uppercase();
    let db = &s.db;
    db::product_detail(db, &merchant, id, &currency, q.tz_offset.unwrap_or(0)).await?
        .map(Json)
        .ok_or_else(not_found)
}

async fn rename_product(
    State(s): State<AppState>,
    Merchant(merchant): Merchant,
    Path(id): Path<i64>,
    Json(req): Json<RenameRequest>,
) -> ApiResult<serde_json::Value> {
    let name: String = req.name.trim().chars().take(80).collect();
    if name.is_empty() {
        return Err(ApiError(StatusCode::BAD_REQUEST, "empty name".into()));
    }
    let db = &s.db;
    if !db::rename_product(db, &merchant, id, &name).await? {
        return Err(not_found());
    }
    Ok(Json(json!({ "ok": true })))
}

async fn merge_product(
    State(s): State<AppState>,
    Merchant(merchant): Merchant,
    Path(id): Path<i64>,
    Json(req): Json<MergeRequest>,
) -> ApiResult<serde_json::Value> {
    let db = &s.db;
    if !db::merge_products(db, &merchant, id, req.into_id).await? {
        return Err(ApiError(StatusCode::BAD_REQUEST, "cannot merge".into()));
    }
    Ok(Json(json!({ "ok": true })))
}

/// AI tips from aggregated data. 503 without an API key (the app shows its own simple tips).
async fn insights(
    State(s): State<AppState>,
    Merchant(merchant): Merchant,
    Json(req): Json<InsightsRequest>,
) -> ApiResult<InsightsResponse> {
    if !s.ai.enabled() {
        return Err(ApiError(StatusCode::SERVICE_UNAVAILABLE, "ai not configured".into()));
    }
    ai_limited(&s, &merchant)?;
    db::track(&s.db, &merchant, "ai_tips");
    let currency = req.currency.to_uppercase();
    let data = {
        let db = &s.db;
        let st = db::stats(db, &merchant, &currency, req.tz_offset).await?;
        let products: Vec<_> = db::products(db, &merchant, &currency, req.tz_offset, Some(30)).await?
            .into_iter()
            .filter(|p| p.quantity > 0)
            .take(10)
            .collect();
        let customers = db::customers(db, &merchant, &currency).await?;
        let mut top_customers: Vec<_> = customers
            .iter()
            .filter(|c| c.orders > 0)
            .map(|c| json!({ "first_name": c.name.split_whitespace().next(), "orders": c.orders, "spent_cents": c.spent_cents, "last_purchase_at": c.last_purchase_at }))
            .collect();
        top_customers.sort_by_key(|c| -c["spent_cents"].as_i64().unwrap_or(0));
        top_customers.truncate(5);
        json!({
            "currency": currency,
            "now_ms": db::now_ms(),
            "this_week_cents": st.week_cents,
            "previous_week_cents": st.prev_week_cents,
            "last_30_days_cents": st.month_cents,
            "waiting_links": st.waiting_count,
            "waiting_cents": st.waiting_total_cents,
            "revenue_by_weekday_last_8_weeks_cents": st.weekdays,
            "top_products_last_30_days": products,
            "customers": {
                "total": customers.len(),
                "returning": customers.iter().filter(|c| c.orders > 1).count(),
                "top_by_spent": top_customers,
            },
        })
    };
    let tips = s.ai.insights(&data, &req.lang).await?;
    Ok(Json(InsightsResponse { tips }))
}

async fn list_customers(
    State(s): State<AppState>,
    Merchant(merchant): Merchant,
    Query(q): Query<StatsQuery>,
) -> ApiResult<Vec<CustomerSummary>> {
    let currency = q.currency.unwrap_or_else(|| "USD".into()).to_uppercase();
    Ok(Json(db::customers(&s.db, &merchant, &currency).await?))
}

async fn get_customer(
    State(s): State<AppState>,
    Merchant(merchant): Merchant,
    Path(id): Path<i64>,
    Query(q): Query<StatsQuery>,
) -> ApiResult<CustomerDetail> {
    let currency = q.currency.unwrap_or_else(|| "USD".into()).to_uppercase();
    db::customer_detail(&s.db, &merchant, id, &currency).await?.map(Json).ok_or_else(not_found)
}

async fn update_customer(
    State(s): State<AppState>,
    Merchant(merchant): Merchant,
    Path(id): Path<i64>,
    Json(req): Json<UpdateCustomerRequest>,
) -> ApiResult<serde_json::Value> {
    let name = req.name.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(|n| n.chars().take(80).collect::<String>());
    let note = req.note.as_deref().map(|n| n.trim().chars().take(1000).collect::<String>());
    if !db::update_customer(&s.db, &merchant, id, name.as_deref(), note.as_deref()).await? {
        return Err(not_found());
    }
    Ok(Json(json!({ "ok": true })))
}

/// End-to-end API tests against a real Postgres (set TEST_DATABASE_URL; skipped otherwise).
#[cfg(test)]
mod api_tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    async fn app() -> Option<Router> {
        let url = std::env::var("TEST_DATABASE_URL").ok()?;
        std::env::set_var("ADMIN_EMAILS", "owner@easypay.test");
        let state = AppState {
            db: db::connect(&url).await.unwrap(),
            ai: ai::Ai::from_env(),
            payments: Payments::Mock,
            login_limiter: Arc::new(RateLimiter::new(100, Duration::from_secs(60))),
            signup_limiter: Arc::new(RateLimiter::new(100, Duration::from_secs(60))),
            ai_limiter: Arc::new(RateLimiter::new(100, Duration::from_secs(60))),
        };
        Some(router(state))
    }

    async fn call(app: &Router, method: &str, uri: &str, cookie: Option<&str>, body: serde_json::Value) -> (StatusCode, serde_json::Value, Option<String>) {
        let mut req = Request::builder().method(method).uri(uri).header("content-type", "application/json");
        if let Some(c) = cookie {
            req = req.header("cookie", c);
        }
        let body = if method == "GET" { Body::empty() } else { Body::from(body.to_string()) };
        let res = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
        let status = res.status();
        let set_cookie = res
            .headers()
            .get("set-cookie")
            .and_then(|v| v.to_str().ok())
            .map(|v| v.split(';').next().unwrap().to_string());
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null), set_cookie)
    }

    fn unique(prefix: &str) -> String {
        format!("{prefix}{}@easypay.test", db::now_ms() % 1_000_000_000 + rand::random::<u16>() as i64)
    }

    #[tokio::test]
    async fn signup_login_links_and_admin() {
        let Some(app) = app().await else { return };
        let email = unique("seller");

        // Seller routes need a login.
        let (st, _, _) = call(&app, "GET", "/api/links", None, json!({})).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED);

        // Sign up, then the same email can't sign up again.
        let reg = json!({ "email": email, "password": "supersecret", "business_name": "Maria's Kitchen", "lang": "pt", "currency": "BRL" });
        let (st, me, cookie) = call(&app, "POST", "/api/auth/register", None, reg.clone()).await;
        assert_eq!(st, StatusCode::OK, "{me}");
        let cookie = cookie.expect("session cookie");
        assert_eq!(me["business_name"], "Maria's Kitchen");
        let (st, _, _) = call(&app, "POST", "/api/auth/register", None, reg).await;
        assert_eq!(st, StatusCode::CONFLICT);

        // Wrong password fails, right one logs in.
        let (st, _, _) = call(&app, "POST", "/api/auth/login", None, json!({ "email": email, "password": "nope-nope" })).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED);
        let (st, _, cookie2) = call(&app, "POST", "/api/auth/login", None, json!({ "email": email.to_uppercase(), "password": "supersecret" })).await;
        assert_eq!(st, StatusCode::OK);
        assert!(cookie2.is_some());

        // Create and pay a link (mock), then see it paid.
        let draft = json!({ "draft": { "items": [{ "name": "Bolo", "quantity": 1, "total_cents": 3000 }], "currency": "BRL" }, "business_name": "Maria's Kitchen" });
        let (st, link, _) = call(&app, "POST", "/api/links", Some(&cookie), draft).await;
        assert_eq!(st, StatusCode::OK, "{link}");
        let id = link["id"].as_str().unwrap().to_string();
        let (st, _, _) = call(&app, "POST", &format!("/api/links/{id}/pay"), None, json!({ "method": "card", "name": "Ana", "phone": "+55 11 91234-5678" })).await;
        assert_eq!(st, StatusCode::OK);
        let (_, page, _) = call(&app, "GET", "/api/links?limit=10", Some(&cookie), json!({})).await;
        assert_eq!(page[0]["status"], "paid");
        let (_, upd, _) = call(&app, "GET", "/api/links/updates?since=0", Some(&cookie), json!({})).await;
        assert_eq!(upd["paid"].as_array().unwrap().len(), 1);

        // Sellers can't open the admin panel.
        let (st, _, _) = call(&app, "GET", "/api/admin/overview", Some(&cookie), json!({})).await;
        assert_eq!(st, StatusCode::FORBIDDEN);

        // The platform owner can, and sees this seller.
        let owner = json!({ "email": "owner@easypay.test", "password": "ownerpassword", "business_name": "Easy Pay" });
        let (_, _, oc) = call(&app, "POST", "/api/auth/register", None, owner.clone()).await;
        let oc = match oc {
            Some(c) => c,
            None => call(&app, "POST", "/api/auth/login", None, owner).await.2.unwrap(),
        };
        let (st, ov, _) = call(&app, "GET", "/api/admin/overview", Some(&oc), json!({})).await;
        assert_eq!(st, StatusCode::OK, "{ov}");
        assert!(ov["accounts_total"].as_i64().unwrap() >= 2);
        let (st, list, _) = call(&app, "GET", &format!("/api/admin/accounts?q={}", email.split('@').next().unwrap()), Some(&oc), json!({})).await;
        assert_eq!(st, StatusCode::OK, "{list}");
        let row = &list["accounts"][0];
        assert_eq!(row["email"], email.as_str());
        assert_eq!(row["paid_links"], 1);
        assert_eq!(row["gmv_cents"], 3000);
        let acct_id = row["id"].as_str().unwrap().to_string();
        let (st, det, _) = call(&app, "GET", &format!("/api/admin/accounts/{acct_id}"), Some(&oc), json!({})).await;
        assert_eq!(st, StatusCode::OK, "{det}");
        assert_eq!(det["customers"], 1);

        // Suspending logs the seller out and blocks their links.
        let (st, _, _) = call(&app, "POST", &format!("/api/admin/accounts/{acct_id}/status"), Some(&oc), json!({ "status": "suspended" })).await;
        assert_eq!(st, StatusCode::OK);
        let (st, _, _) = call(&app, "GET", "/api/auth/me", Some(&cookie), json!({})).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED);
        let (st, _, _) = call(&app, "POST", "/api/auth/login", None, json!({ "email": email, "password": "supersecret" })).await;
        assert_eq!(st, StatusCode::FORBIDDEN);

        // Logout clears the session.
        let (st, _, _) = call(&app, "POST", "/api/auth/logout", Some(&oc), json!({})).await;
        assert_eq!(st, StatusCode::OK);
        let (st, _, _) = call(&app, "GET", "/api/auth/me", Some(&oc), json!({})).await;
        assert_eq!(st, StatusCode::UNAUTHORIZED);
    }
}
