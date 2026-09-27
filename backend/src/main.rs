mod ai;
mod db;
mod models;

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use sqlx::PgPool;
use serde_json::json;
use tower_http::{
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};

use models::*;

#[derive(Clone)]
struct AppState {
    db: PgPool,
    ai: ai::Ai,
}

type ApiResult<T> = Result<Json<T>, ApiError>;

struct ApiError(StatusCode, String);

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

/// POC auth: each device generates a random merchant id and sends it as a header.
fn merchant_id(h: &HeaderMap) -> Result<String, ApiError> {
    h.get("x-merchant-id")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|v| (8..=64).contains(&v.len()))
        .map(str::to_string)
        .ok_or_else(|| ApiError(StatusCode::UNAUTHORIZED, "missing x-merchant-id".into()))
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
    let state = AppState {
        db: db::connect(&db_url).await?,
        ai: ai::Ai::from_env(),
    };
    if !state.ai.enabled() {
        tracing::warn!("OPENROUTER_API_KEY not set: using the offline parser and voice is disabled");
    }

    let api = Router::new()
        .route("/config", get(config))
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

    let app = Router::new()
        .nest("/api", api)
        .fallback_service(spa)
        .layer(axum::extract::DefaultBodyLimit::max(8 * 1024 * 1024))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Heroku (and most hosts) tell us the port through $PORT.
    let addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| {
        format!("0.0.0.0:{}", std::env::var("PORT").unwrap_or_else(|_| "8080".into()))
    });
    tracing::info!("listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn config(State(s): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({ "ai": s.ai.enabled(), "voice": s.ai.enabled() }))
}

async fn chat(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ChatRequest>,
) -> ApiResult<ChatResponse> {
    if req.messages.is_empty() {
        return Err(ApiError(StatusCode::BAD_REQUEST, "empty conversation".into()));
    }
    // The merchant's known products let the AI group synonyms and reuse usual prices.
    let catalog = match merchant_id(&headers) {
        Ok(m) => db::catalog(&s.db, &m).await?,
        Err(_) => Vec::new(),
    };
    Ok(Json(s.ai.chat(&req.messages, &req.lang, &req.currency, &catalog).await))
}

/// Same as `/chat`, but as newline-delimited JSON: `{"delta": "..."}` for each piece of
/// the reply while the model writes it, then `{"done": ChatResponse}`.
async fn chat_stream(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ChatRequest>,
) -> Result<Response, ApiError> {
    if req.messages.is_empty() {
        return Err(ApiError(StatusCode::BAD_REQUEST, "empty conversation".into()));
    }
    let catalog = match merchant_id(&headers) {
        Ok(m) => db::catalog(&s.db, &m).await?,
        Err(_) => Vec::new(),
    };
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

async fn transcribe(State(s): State<AppState>, Json(req): Json<TranscribeRequest>) -> ApiResult<TranscribeResponse> {
    if !s.ai.enabled() {
        return Err(ApiError(StatusCode::SERVICE_UNAVAILABLE, "voice not configured".into()));
    }
    let text = s.ai.transcribe(&req.audio_base64, &req.lang).await?;
    Ok(Json(TranscribeResponse { text }))
}

async fn create_link(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateLinkRequest>,
) -> ApiResult<Link> {
    let merchant = merchant_id(&headers)?;
    let draft = req
        .draft
        .sanitize()
        .ok_or_else(|| ApiError(StatusCode::BAD_REQUEST, "no items".into()))?;
    let business: String = req.business_name.chars().take(60).collect();
    let db = &s.db;
    Ok(Json(db::create_link(db, &merchant, &business, &draft).await?))
}

async fn list_links(State(s): State<AppState>, headers: HeaderMap) -> ApiResult<Vec<Link>> {
    let merchant = merchant_id(&headers)?;
    let db = &s.db;
    Ok(Json(db::list_links(db, &merchant).await?))
}

/// Public (the customer opens it), but who paid is only shown to the link's owner.
async fn get_link(State(s): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> ApiResult<Link> {
    let link = db::get_link(&s.db, &id).await?.ok_or_else(not_found)?;
    let owner = merchant_id(&headers).is_ok_and(|m| m == link.merchant_id);
    Ok(Json(if owner { link } else { link.public() }))
}

async fn cancel_link(State(s): State<AppState>, headers: HeaderMap, Path(id): Path<String>) -> ApiResult<Link> {
    let merchant = merchant_id(&headers)?;
    let db = &s.db;
    if !db::cancel_link(db, &merchant, &id).await? {
        return Err(ApiError(StatusCode::CONFLICT, "cannot cancel".into()));
    }
    db::get_link(db, &id).await?.map(Json).ok_or_else(not_found)
}

/// MOCK payment. Replace with Stripe (Payment Element / Checkout) later.
async fn pay_link(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<PayRequest>,
) -> ApiResult<Link> {
    let method = match req.method.as_str() {
        "apple_pay" | "google_pay" | "card" => req.method.clone(),
        _ => return Err(ApiError(StatusCode::BAD_REQUEST, "invalid method".into())),
    };
    let payer = req.payer().map_err(|e| ApiError(StatusCode::BAD_REQUEST, e.into()))?;
    // Simulate the processor taking a moment.
    tokio::time::sleep(std::time::Duration::from_millis(900)).await;
    let db = &s.db;
    let link = db::get_link(db, &id).await?.ok_or_else(not_found)?;
    if link.status != "waiting" {
        return Err(ApiError(StatusCode::CONFLICT, link.status));
    }
    // The UPDATE only matches a waiting link, so two payments can't both succeed.
    if !db::pay_link(db, &id, &method, &payer).await? {
        return Err(ApiError(StatusCode::CONFLICT, "paid".into()));
    }
    db::get_link(db, &id).await?.map(|l| Json(l.public())).ok_or_else(not_found)
}

async fn stats(State(s): State<AppState>, headers: HeaderMap, Query(q): Query<StatsQuery>) -> ApiResult<Stats> {
    let merchant = merchant_id(&headers)?;
    let currency = q.currency.unwrap_or_else(|| "USD".into()).to_uppercase();
    let db = &s.db;
    Ok(Json(db::stats(db, &merchant, &currency, q.tz_offset.unwrap_or(0)).await?))
}

async fn list_products(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<StatsQuery>,
) -> ApiResult<Vec<ProductSummary>> {
    let merchant = merchant_id(&headers)?;
    let currency = q.currency.unwrap_or_else(|| "USD".into()).to_uppercase();
    let db = &s.db;
    Ok(Json(db::products(db, &merchant, &currency, q.tz_offset.unwrap_or(0), q.days).await?))
}

async fn get_product(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Query(q): Query<StatsQuery>,
) -> ApiResult<ProductDetail> {
    let merchant = merchant_id(&headers)?;
    let currency = q.currency.unwrap_or_else(|| "USD".into()).to_uppercase();
    let db = &s.db;
    db::product_detail(db, &merchant, id, &currency, q.tz_offset.unwrap_or(0)).await?
        .map(Json)
        .ok_or_else(not_found)
}

async fn rename_product(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<RenameRequest>,
) -> ApiResult<serde_json::Value> {
    let merchant = merchant_id(&headers)?;
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
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<MergeRequest>,
) -> ApiResult<serde_json::Value> {
    let merchant = merchant_id(&headers)?;
    let db = &s.db;
    if !db::merge_products(db, &merchant, id, req.into_id).await? {
        return Err(ApiError(StatusCode::BAD_REQUEST, "cannot merge".into()));
    }
    Ok(Json(json!({ "ok": true })))
}

/// AI tips from aggregated data. 503 without an API key (the app shows its own simple tips).
async fn insights(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<InsightsRequest>,
) -> ApiResult<InsightsResponse> {
    let merchant = merchant_id(&headers)?;
    if !s.ai.enabled() {
        return Err(ApiError(StatusCode::SERVICE_UNAVAILABLE, "ai not configured".into()));
    }
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
    headers: HeaderMap,
    Query(q): Query<StatsQuery>,
) -> ApiResult<Vec<CustomerSummary>> {
    let merchant = merchant_id(&headers)?;
    let currency = q.currency.unwrap_or_else(|| "USD".into()).to_uppercase();
    Ok(Json(db::customers(&s.db, &merchant, &currency).await?))
}

async fn get_customer(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Query(q): Query<StatsQuery>,
) -> ApiResult<CustomerDetail> {
    let merchant = merchant_id(&headers)?;
    let currency = q.currency.unwrap_or_else(|| "USD".into()).to_uppercase();
    db::customer_detail(&s.db, &merchant, id, &currency).await?.map(Json).ok_or_else(not_found)
}

async fn update_customer(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(req): Json<UpdateCustomerRequest>,
) -> ApiResult<serde_json::Value> {
    let merchant = merchant_id(&headers)?;
    let name = req.name.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(|n| n.chars().take(80).collect::<String>());
    let note = req.note.as_deref().map(|n| n.trim().chars().take(1000).collect::<String>());
    if !db::update_customer(&s.db, &merchant, id, name.as_deref(), note.as_deref()).await? {
        return Err(not_found());
    }
    Ok(Json(json!({ "ok": true })))
}
