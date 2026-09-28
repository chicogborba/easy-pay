use std::collections::HashMap;

use anyhow::Result;
use rand::{distributions::Alphanumeric, Rng};
use sqlx::{
    postgres::{PgConnectOptions, PgPoolOptions, PgRow, PgSslMode},
    PgConnection, PgPool, Row,
};

use crate::models::{
    CatalogEntry, CustomerDetail, CustomerSummary, DayTotal, Draft, Item, Link, Payer, ProductDay, ProductDetail,
    ProductSummary, Stats, TopItem,
};

/// Connects to Postgres. Remote databases (Heroku) require TLS; local ones don't.
pub async fn connect(url: &str) -> Result<PgPool> {
    let mut opts: PgConnectOptions = url.parse()?;
    let local = ["localhost", "127.0.0.1", "::1"].contains(&opts.get_host()) || opts.get_host().starts_with('/');
    if !local && !url.contains("sslmode=") {
        // Heroku Postgres uses self-signed certs: encrypt without verifying.
        opts = opts.ssl_mode(PgSslMode::Require);
    }
    let max: u32 = std::env::var("DATABASE_POOL_SIZE").ok().and_then(|v| v.parse().ok()).unwrap_or(5);
    let pool = PgPoolOptions::new().max_connections(max).connect_with(opts).await?;
    migrate(&pool).await?;
    Ok(pool)
}

/// Idempotent schema setup, run on every start. An advisory lock keeps
/// concurrent starts (tests, rolling deploys) from racing each other.
pub async fn migrate(pool: &PgPool) -> Result<()> {
    let mut conn = pool.acquire().await?;
    sqlx::query("SELECT pg_advisory_lock(746_1937)").execute(&mut *conn).await?;
    let result = run_migrations(&mut conn).await;
    sqlx::query("SELECT pg_advisory_unlock(746_1937)").execute(&mut *conn).await?;
    result
}

async fn run_migrations(conn: &mut PgConnection) -> Result<()> {
    for stmt in [
        "CREATE TABLE IF NOT EXISTS links (
             id            TEXT PRIMARY KEY,
             merchant_id   TEXT NOT NULL,
             business_name TEXT NOT NULL DEFAULT '',
             customer      TEXT NOT NULL DEFAULT '',
             items_json    TEXT NOT NULL,
             currency      TEXT NOT NULL,
             total_cents   BIGINT NOT NULL,
             note          TEXT NOT NULL DEFAULT '',
             status        TEXT NOT NULL DEFAULT 'waiting',
             created_at    BIGINT NOT NULL,
             paid_at       BIGINT,
             paid_method   TEXT
         )",
        "CREATE INDEX IF NOT EXISTS idx_links_merchant ON links(merchant_id, created_at DESC)",
        // Products the merchant sells, learned automatically from their links.
        "CREATE TABLE IF NOT EXISTS products (
             id              BIGSERIAL PRIMARY KEY,
             merchant_id     TEXT NOT NULL,
             name            TEXT NOT NULL,
             last_unit_cents BIGINT NOT NULL DEFAULT 0,
             last_currency   TEXT NOT NULL DEFAULT '',
             created_at      BIGINT NOT NULL
         )",
        "CREATE INDEX IF NOT EXISTS idx_products_merchant ON products(merchant_id)",
        // Every way the merchant has written a product (normalized), pointing to it.
        "CREATE TABLE IF NOT EXISTS product_aliases (
             merchant_id TEXT NOT NULL,
             alias_norm  TEXT NOT NULL,
             alias       TEXT NOT NULL,
             product_id  BIGINT NOT NULL,
             PRIMARY KEY (merchant_id, alias_norm)
         )",
        // People who paid a link, identified by phone (no login needed).
        "CREATE TABLE IF NOT EXISTS customers (
             id          BIGSERIAL PRIMARY KEY,
             merchant_id TEXT NOT NULL,
             name        TEXT NOT NULL,
             phone       TEXT NOT NULL,
             phone_norm  TEXT NOT NULL,
             email       TEXT NOT NULL DEFAULT '',
             note        TEXT NOT NULL DEFAULT '',
             created_at  BIGINT NOT NULL,
             UNIQUE (merchant_id, phone_norm)
         )",
        "ALTER TABLE links ADD COLUMN IF NOT EXISTS customer_id BIGINT",
        "ALTER TABLE links ADD COLUMN IF NOT EXISTS payer_name TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE links ADD COLUMN IF NOT EXISTS payer_phone TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE links ADD COLUMN IF NOT EXISTS payer_email TEXT NOT NULL DEFAULT ''",
        "CREATE INDEX IF NOT EXISTS idx_links_customer ON links(customer_id)",
        "CREATE INDEX IF NOT EXISTS idx_links_merchant_paid ON links(merchant_id, paid_at) WHERE status = 'paid'",
        "ALTER TABLE links ADD COLUMN IF NOT EXISTS provider_ref TEXT",
        // Seller accounts. `id` is the merchant_id used by every other table.
        "CREATE TABLE IF NOT EXISTS accounts (
             id                     TEXT PRIMARY KEY,
             email                  TEXT NOT NULL UNIQUE,
             password_hash          TEXT NOT NULL,
             business_name          TEXT NOT NULL DEFAULT '',
             lang                   TEXT NOT NULL DEFAULT 'en',
             currency               TEXT NOT NULL DEFAULT 'USD',
             status                 TEXT NOT NULL DEFAULT 'active',
             plan                   TEXT NOT NULL DEFAULT 'free',
             stripe_account_id      TEXT,
             stripe_charges_enabled BOOLEAN NOT NULL DEFAULT FALSE,
             created_at             BIGINT NOT NULL,
             last_seen_at           BIGINT
         )",
        "CREATE INDEX IF NOT EXISTS idx_accounts_created ON accounts(created_at)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_stripe ON accounts(stripe_account_id)",
        // Login sessions (only a hash of the token is stored).
        "CREATE TABLE IF NOT EXISTS sessions (
             token_hash   TEXT PRIMARY KEY,
             account_id   TEXT NOT NULL,
             created_at   BIGINT NOT NULL,
             expires_at   BIGINT NOT NULL,
             last_seen_at BIGINT NOT NULL
         )",
        "CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id)",
        // What each account uses (AI calls, links...) for the platform admin panel.
        "CREATE TABLE IF NOT EXISTS usage_events (
             id         BIGSERIAL PRIMARY KEY,
             account_id TEXT NOT NULL,
             kind       TEXT NOT NULL,
             created_at BIGINT NOT NULL
         )",
        "CREATE INDEX IF NOT EXISTS idx_usage_account ON usage_events(account_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_events(created_at)",
        // What the platform earns on each payment.
        "ALTER TABLE links ADD COLUMN IF NOT EXISTS provider TEXT",
        "ALTER TABLE links ADD COLUMN IF NOT EXISTS fee_bps BIGINT NOT NULL DEFAULT 0",
        "ALTER TABLE links ADD COLUMN IF NOT EXISTS platform_fee_cents BIGINT NOT NULL DEFAULT 0",
        // Seller profile (what a real payments business needs to know about its sellers).
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS owner_name TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS document TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS terms_accepted_at BIGINT",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email_verified_at BIGINT",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS fee_bps_override BIGINT",
        // Mercado Pago (OAuth) connection; tokens are stored encrypted.
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS mp_user_id TEXT",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS mp_access_token TEXT",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS mp_refresh_token TEXT",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS mp_token_expires_at BIGINT",
        "CREATE INDEX IF NOT EXISTS idx_accounts_mp_user ON accounts(mp_user_id)",
        // One-time tokens: email verification, password reset, OAuth state.
        "CREATE TABLE IF NOT EXISTS auth_tokens (
             token_hash TEXT PRIMARY KEY,
             account_id TEXT NOT NULL,
             kind       TEXT NOT NULL,
             expires_at BIGINT NOT NULL,
             used_at    BIGINT
         )",
    ] {
        sqlx::query(stmt).execute(&mut *conn).await?;
    }
    Ok(())
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn new_id() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(8)
        .map(char::from)
        .collect()
}

/// Lowercase, strip accents and punctuation, collapse spaces: "Pães  Fermentados!" -> "paes fermentados".
pub fn normalize(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.to_lowercase().chars() {
        let c = match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' | 'å' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            c if c.is_alphanumeric() => c,
            _ => ' ',
        };
        out.push(c);
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/* ---------------- links ---------------- */

const COLS: &str = "id, merchant_id, business_name, items_json, currency, total_cents, note, status, created_at, \
                    paid_at, paid_method, customer, customer_id, payer_name, payer_phone, payer_email, \
                    provider, platform_fee_cents";

fn row_to_link(r: &PgRow) -> Result<Link, sqlx::Error> {
    let items_json: String = r.try_get("items_json")?;
    Ok(Link {
        merchant_id: r.try_get("merchant_id")?,
        id: r.try_get("id")?,
        business_name: r.try_get("business_name")?,
        items: serde_json::from_str::<Vec<Item>>(&items_json).unwrap_or_default(),
        currency: r.try_get("currency")?,
        total_cents: r.try_get("total_cents")?,
        note: r.try_get("note")?,
        status: r.try_get("status")?,
        created_at: r.try_get("created_at")?,
        paid_at: r.try_get("paid_at")?,
        paid_method: r.try_get("paid_method")?,
        customer: r.try_get("customer")?,
        customer_id: r.try_get("customer_id")?,
        payer_name: r.try_get("payer_name")?,
        payer_phone: r.try_get("payer_phone")?,
        payer_email: r.try_get("payer_email")?,
        known_customer: None,
        provider: r.try_get("provider")?,
        platform_fee_cents: r.try_get("platform_fee_cents")?,
        payment_mode: None,
    })
}

pub async fn create_link(pool: &PgPool, merchant: &str, business: &str, draft: &Draft) -> Result<Link> {
    // A link made for a known customer is tied to them (only the merchant's own customers).
    let mut customer_id = None;
    let mut customer_name = draft.customer.clone();
    if let Some(id) = draft.customer_id {
        if let Some(c) = customer_rows(pool, merchant, Some(id)).await?.pop() {
            customer_id = Some(c.id);
            customer_name = c.name;
        }
    }
    let mut tx = pool.begin().await?;
    let mut items = draft.items.clone();
    for it in &mut items {
        let (pid, name) = resolve_product(&mut tx, merchant, it, &draft.currency).await?;
        it.product_id = Some(pid);
        it.product = Some(name);
    }
    let id = new_id();
    sqlx::query(
        "INSERT INTO links (id, merchant_id, business_name, items_json, currency, total_cents, note, created_at, customer, customer_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(&id)
    .bind(merchant)
    .bind(business.trim())
    .bind(serde_json::to_string(&items)?)
    .bind(&draft.currency)
    .bind(draft.total_cents())
    .bind(&draft.note)
    .bind(now_ms())
    .bind(&customer_name)
    .bind(customer_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(get_link(pool, &id).await?.expect("just inserted"))
}

pub async fn get_link(pool: &PgPool, id: &str) -> Result<Option<Link>> {
    let row = sqlx::query(&format!("SELECT {COLS} FROM links WHERE id = $1"))
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row.as_ref().map(row_to_link).transpose()?)
}

/// Every link of a merchant (used by per-merchant analytics and the CRM).
pub async fn list_links(pool: &PgPool, merchant: &str) -> Result<Vec<Link>> {
    let rows = sqlx::query(&format!("SELECT {COLS} FROM links WHERE merchant_id = $1 ORDER BY created_at DESC"))
        .bind(merchant)
        .fetch_all(pool)
        .await?;
    Ok(rows.iter().map(row_to_link).collect::<Result<_, _>>()?)
}

/// One page of links, newest first (`before` = created_at of the last link already shown).
pub async fn list_links_page(
    pool: &PgPool,
    merchant: &str,
    status: Option<&str>,
    before: Option<i64>,
    limit: i64,
) -> Result<Vec<Link>> {
    let rows = sqlx::query(&format!(
        "SELECT {COLS} FROM links
         WHERE merchant_id = $1 AND ($2::TEXT IS NULL OR status = $2) AND ($3::BIGINT IS NULL OR created_at < $3)
         ORDER BY created_at DESC LIMIT $4"
    ))
    .bind(merchant)
    .bind(status)
    .bind(before)
    .bind(limit.clamp(1, 200))
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(row_to_link).collect::<Result<_, _>>()?)
}

/// Links paid after `since` (cheap polling for the "you got paid" toast).
pub async fn paid_since(pool: &PgPool, merchant: &str, since: i64) -> Result<Vec<Link>> {
    let rows = sqlx::query(&format!(
        "SELECT {COLS} FROM links WHERE merchant_id = $1 AND status = 'paid' AND paid_at > $2 ORDER BY paid_at LIMIT 50"
    ))
    .bind(merchant)
    .bind(since)
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(row_to_link).collect::<Result<_, _>>()?)
}

/// Waiting links plus links paid since `since`: all the time-windowed analytics need.
async fn recent_links(pool: &PgPool, merchant: &str, since: i64) -> Result<Vec<Link>> {
    let rows = sqlx::query(&format!(
        "SELECT {COLS} FROM links
         WHERE merchant_id = $1 AND (status = 'waiting' OR (status = 'paid' AND COALESCE(paid_at, created_at) >= $2))"
    ))
    .bind(merchant)
    .bind(since)
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(row_to_link).collect::<Result<_, _>>()?)
}

/// Records one use of a feature (fire-and-forget; never fails the request).
pub fn track(pool: &PgPool, account: &str, kind: &'static str) {
    let pool = pool.clone();
    let account = account.to_string();
    tokio::spawn(async move {
        let r = sqlx::query("INSERT INTO usage_events (account_id, kind, created_at) VALUES ($1, $2, $3)")
            .bind(account)
            .bind(kind)
            .bind(now_ms())
            .execute(&pool)
            .await;
        if let Err(e) = r {
            tracing::warn!("usage tracking failed: {e}");
        }
    });
}

pub async fn set_provider_ref(pool: &PgPool, id: &str, provider_ref: &str) -> Result<()> {
    sqlx::query("UPDATE links SET provider_ref = $2 WHERE id = $1")
        .bind(id)
        .bind(provider_ref)
        .execute(pool)
        .await?;
    Ok(())
}

/// Returns false when the link does not belong to the merchant or is not waiting.
pub async fn cancel_link(pool: &PgPool, merchant: &str, id: &str) -> Result<bool> {
    let r = sqlx::query("UPDATE links SET status = 'cancelled' WHERE id = $1 AND merchant_id = $2 AND status = 'waiting'")
        .bind(id)
        .bind(merchant)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() > 0)
}

/// Mock payment: flips a waiting link to paid and records who paid,
/// creating or updating the merchant's customer (matched by phone).
/// Demo payment with no platform fee (used by tests and old demo links).
#[cfg(test)]
pub async fn pay_link(pool: &PgPool, id: &str, method: &str, payer: &Payer) -> Result<bool> {
    mark_paid(pool, id, "mock", method, payer, 0).await
}

/// Marks a waiting link paid, records the platform fee (seller's custom fee or `default_fee_bps`)
/// and creates or updates the seller's customer (matched by phone).
/// Returns false if the link was not waiting (already paid, cancelled or unknown), so
/// duplicate webhooks are harmless.
pub async fn mark_paid(pool: &PgPool, id: &str, provider: &str, method: &str, payer: &Payer, default_fee_bps: i64) -> Result<bool> {
    let mut tx = pool.begin().await?;
    let merchant: Option<String> =
        sqlx::query_scalar("SELECT merchant_id FROM links WHERE id = $1 AND status = 'waiting' FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some(merchant) = merchant else { return Ok(false) };

    // Latest name/email win; the merchant's note is kept.
    let customer_id: i64 = sqlx::query_scalar(
        "INSERT INTO customers (merchant_id, name, phone, phone_norm, email, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (merchant_id, phone_norm) DO UPDATE
           SET name = EXCLUDED.name, phone = EXCLUDED.phone,
               email = CASE WHEN EXCLUDED.email = '' THEN customers.email ELSE EXCLUDED.email END
         RETURNING id",
    )
    .bind(&merchant)
    .bind(&payer.name)
    .bind(&payer.phone)
    .bind(&payer.phone_norm)
    .bind(&payer.email)
    .bind(now_ms())
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE links l SET status = 'paid', paid_at = $2, paid_method = $3,
                          customer_id = $4, payer_name = $5, payer_phone = $6, payer_email = $7, provider = $8,
                          fee_bps = f.bps, platform_fee_cents = l.total_cents * f.bps / 10000
         FROM (SELECT COALESCE((SELECT fee_bps_override FROM accounts WHERE id = $9), $10)::BIGINT AS bps) f
         WHERE l.id = $1",
    )
    .bind(id)
    .bind(now_ms())
    .bind(method)
    .bind(customer_id)
    .bind(&payer.name)
    .bind(&payer.phone)
    .bind(&payer.email)
    .bind(provider)
    .bind(&merchant)
    .bind(default_fee_bps)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(true)
}

/* ---------------- products ---------------- */

async fn find_alias(c: &mut PgConnection, merchant: &str, text: &str) -> Result<Option<i64>> {
    let norm = normalize(text);
    if norm.is_empty() {
        return Ok(None);
    }
    Ok(sqlx::query_scalar("SELECT product_id FROM product_aliases WHERE merchant_id = $1 AND alias_norm = $2")
        .bind(merchant)
        .bind(norm)
        .fetch_optional(c)
        .await?)
}

async fn add_alias(c: &mut PgConnection, merchant: &str, text: &str, pid: i64) -> Result<()> {
    let norm = normalize(text);
    if !norm.is_empty() {
        sqlx::query(
            "INSERT INTO product_aliases (merchant_id, alias_norm, alias, product_id) VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING",
        )
        .bind(merchant)
        .bind(norm)
        .bind(text.trim())
        .bind(pid)
        .execute(c)
        .await?;
    }
    Ok(())
}

/// Finds the product for a receipt line (by the AI's canonical name, then by the
/// line's own name) or creates it. Remembers the line's wording as an alias.
async fn resolve_product(c: &mut PgConnection, merchant: &str, it: &Item, currency: &str) -> Result<(i64, String)> {
    let mut pid = None;
    for cand in [it.product.as_deref(), Some(it.name.as_str())].into_iter().flatten() {
        if let Some(p) = find_alias(c, merchant, cand).await? {
            pid = Some(p);
            break;
        }
    }
    let pid = match pid {
        Some(p) => p,
        None => {
            let name = it.product.clone().unwrap_or_else(|| it.name.clone());
            sqlx::query_scalar("INSERT INTO products (merchant_id, name, created_at) VALUES ($1, $2, $3) RETURNING id")
                .bind(merchant)
                .bind(name)
                .bind(now_ms())
                .fetch_one(&mut *c)
                .await?
        }
    };
    if let Some(p) = &it.product {
        add_alias(c, merchant, p, pid).await?;
    }
    add_alias(c, merchant, &it.name, pid).await?;
    let name = sqlx::query_scalar("UPDATE products SET last_unit_cents = $2, last_currency = $3 WHERE id = $1 RETURNING name")
        .bind(pid)
        .bind(it.total_cents / it.quantity.max(1) as i64)
        .bind(currency)
        .fetch_one(c)
        .await?;
    Ok((pid, name))
}

/// Products the AI should know about, most recently created first.
pub async fn catalog(pool: &PgPool, merchant: &str) -> Result<Vec<CatalogEntry>> {
    let rows = sqlx::query(
        "SELECT name, last_unit_cents, last_currency FROM products WHERE merchant_id = $1 ORDER BY id DESC LIMIT 80",
    )
    .bind(merchant)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .iter()
        .map(|r| {
            Ok(CatalogEntry {
                name: r.try_get("name")?,
                unit_cents: r.try_get("last_unit_cents")?,
                currency: r.try_get("last_currency")?,
            })
        })
        .collect::<Result<_, sqlx::Error>>()?)
}

async fn product_names(pool: &PgPool, merchant: &str) -> Result<HashMap<i64, String>> {
    let rows: Vec<(i64, String)> = sqlx::query_as("SELECT id, name FROM products WHERE merchant_id = $1")
        .bind(merchant)
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().collect())
}

pub async fn rename_product(pool: &PgPool, merchant: &str, id: i64, name: &str) -> Result<bool> {
    let mut tx = pool.begin().await?;
    let r = sqlx::query("UPDATE products SET name = $3 WHERE id = $1 AND merchant_id = $2")
        .bind(id)
        .bind(merchant)
        .bind(name.trim())
        .execute(&mut *tx)
        .await?;
    if r.rows_affected() > 0 {
        add_alias(&mut tx, merchant, name, id).await?;
    }
    tx.commit().await?;
    Ok(r.rows_affected() > 0)
}

/// Joins `src` into `dst`: aliases and past sales move over, `src` disappears.
pub async fn merge_products(pool: &PgPool, merchant: &str, src: i64, dst: i64) -> Result<bool> {
    let names = product_names(pool, merchant).await?;
    let (Some(_), Some(dst_name)) = (names.get(&src), names.get(&dst)) else { return Ok(false) };
    if src == dst {
        return Ok(false);
    }
    let links = list_links(pool, merchant).await?;
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE product_aliases SET product_id = $3 WHERE merchant_id = $1 AND product_id = $2")
        .bind(merchant)
        .bind(src)
        .bind(dst)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM products WHERE id = $1 AND merchant_id = $2")
        .bind(src)
        .bind(merchant)
        .execute(&mut *tx)
        .await?;
    for link in links {
        let mut items = link.items.clone();
        let mut changed = false;
        for it in items.iter_mut().filter(|it| it.product_id == Some(src)) {
            it.product_id = Some(dst);
            it.product = Some(dst_name.clone());
            changed = true;
        }
        if changed {
            sqlx::query("UPDATE links SET items_json = $2 WHERE id = $1")
                .bind(&link.id)
                .bind(serde_json::to_string(&items)?)
                .execute(&mut *tx)
                .await?;
        }
    }
    tx.commit().await?;
    Ok(true)
}

/* ---------------- customers (CRM) ---------------- */

struct CustomerRow {
    id: i64,
    name: String,
    phone: String,
    email: String,
    note: String,
}

async fn customer_rows(pool: &PgPool, merchant: &str, id: Option<i64>) -> Result<Vec<CustomerRow>> {
    let rows = sqlx::query(
        "SELECT id, name, phone, email, note FROM customers
         WHERE merchant_id = $1 AND ($2::BIGINT IS NULL OR id = $2)",
    )
    .bind(merchant)
    .bind(id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .iter()
        .map(|r| {
            Ok(CustomerRow {
                id: r.try_get("id")?,
                name: r.try_get("name")?,
                phone: r.try_get("phone")?,
                email: r.try_get("email")?,
                note: r.try_get("note")?,
            })
        })
        .collect::<Result<_, sqlx::Error>>()?)
}

/// Name and phone of one of the merchant's customers.
pub async fn customer_contact(pool: &PgPool, merchant: &str, id: i64) -> Result<Option<(String, String)>> {
    Ok(customer_rows(pool, merchant, Some(id)).await?.pop().map(|c| (c.name, c.phone)))
}

fn summarize(c: CustomerRow, links: &[Link], currency: &str) -> CustomerSummary {
    let mut s = CustomerSummary {
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        note: c.note,
        orders: 0,
        spent_cents: 0,
        first_purchase_at: None,
        last_purchase_at: None,
    };
    for l in links.iter().filter(|l| l.status == "paid" && l.customer_id == Some(s.id)) {
        let t = l.paid_at.unwrap_or(l.created_at);
        s.orders += 1;
        if l.currency == currency {
            s.spent_cents += l.total_cents;
        }
        s.first_purchase_at = Some(s.first_purchase_at.map_or(t, |x| x.min(t)));
        s.last_purchase_at = Some(s.last_purchase_at.map_or(t, |x| x.max(t)));
    }
    s
}

/// All customers with their totals, most recent buyers first.
pub async fn customers(pool: &PgPool, merchant: &str, currency: &str) -> Result<Vec<CustomerSummary>> {
    let links = list_links(pool, merchant).await?;
    let mut v: Vec<CustomerSummary> = customer_rows(pool, merchant, None)
        .await?
        .into_iter()
        .map(|c| summarize(c, &links, currency))
        .collect();
    v.sort_by(|a, b| b.last_purchase_at.cmp(&a.last_purchase_at).then(a.name.cmp(&b.name)));
    Ok(v)
}

pub async fn customer_detail(pool: &PgPool, merchant: &str, id: i64, currency: &str) -> Result<Option<CustomerDetail>> {
    let Some(row) = customer_rows(pool, merchant, Some(id)).await?.pop() else { return Ok(None) };
    let links = list_links(pool, merchant).await?;
    let names = product_names(pool, merchant).await?;
    let summary = summarize(row, &links, currency);
    let mine: Vec<Link> = links.into_iter().filter(|l| l.customer_id == Some(id)).collect();
    let mut fav = Agg::default();
    for l in mine.iter().filter(|l| l.status == "paid" && l.currency == currency) {
        l.items.iter().for_each(|it| fav.add(it, &names));
    }
    Ok(Some(CustomerDetail { summary, favorites: fav.top(5), links: mine }))
}

pub async fn update_customer(
    pool: &PgPool,
    merchant: &str,
    id: i64,
    name: Option<&str>,
    note: Option<&str>,
) -> Result<bool> {
    let r = sqlx::query(
        "UPDATE customers SET name = COALESCE($3, name), note = COALESCE($4, note) WHERE id = $1 AND merchant_id = $2",
    )
    .bind(id)
    .bind(merchant)
    .bind(name)
    .bind(note)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() > 0)
}

/* ---------------- analytics ---------------- */
// Small merchants have few links, so aggregation happens in memory:
// simple, and timezone handling stays in one place.

const DAY_MS: i64 = 86_400_000;

/// Paid links in one currency, with their payment time shifted to local time.
fn paid_local(links: &[Link], currency: &str, offset_ms: i64) -> Vec<(i64, Link)> {
    links
        .iter()
        .filter(|l| l.status == "paid" && l.currency == currency)
        .map(|l| (l.paid_at.unwrap_or(l.created_at) + offset_ms, l.clone()))
        .collect()
}

fn today_start(offset_ms: i64) -> i64 {
    let now_local = now_ms() + offset_ms;
    now_local - now_local.rem_euclid(DAY_MS)
}

/// 0 = Sunday (1970-01-01 was a Thursday).
fn weekday(local_ms: i64) -> usize {
    ((local_ms.div_euclid(DAY_MS) + 4).rem_euclid(7)) as usize
}

/// Groups receipt lines by product (falls back to the line name for old links).
#[derive(Default)]
struct Agg(HashMap<String, TopItem>);

impl Agg {
    fn add(&mut self, it: &Item, names: &HashMap<i64, String>) {
        let (key, name) = match it.product_id {
            Some(id) => (format!("#{id}"), names.get(&id).cloned().unwrap_or_else(|| it.name.clone())),
            None => (normalize(&it.name), it.name.clone()),
        };
        let e = self.0.entry(key).or_insert(TopItem { product_id: it.product_id, name, quantity: 0, total_cents: 0 });
        e.quantity += it.quantity;
        e.total_cents += it.total_cents;
    }

    fn top(self, n: usize) -> Vec<TopItem> {
        let mut v: Vec<TopItem> = self.0.into_values().collect();
        v.sort_by(|a, b| b.quantity.cmp(&a.quantity).then(b.total_cents.cmp(&a.total_cents)));
        v.truncate(n);
        v
    }
}

pub async fn stats(pool: &PgPool, merchant: &str, currency: &str, tz_offset_min: i64) -> Result<Stats> {
    // Only the last ~8 weeks are needed in memory; all-time totals come from SQL.
    let links = recent_links(pool, merchant, now_ms() - 58 * DAY_MS).await?;
    let (paid_count, paid_total): (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(SUM(total_cents), 0)::BIGINT FROM links
         WHERE merchant_id = $1 AND status = 'paid' AND currency = $2",
    )
    .bind(merchant)
    .bind(currency)
    .fetch_one(pool)
    .await?;
    let names = product_names(pool, merchant).await?;
    let offset = tz_offset_min * 60_000;
    let today = today_start(offset);
    let week_start = today - 6 * DAY_MS;
    let prev_week_start = week_start - 7 * DAY_MS;
    let month_start = today - 29 * DAY_MS;
    let weekdays_start = today - 55 * DAY_MS;

    let mut s = Stats {
        currency: currency.to_string(),
        paid_total_cents: paid_total,
        paid_count,
        waiting_total_cents: 0,
        waiting_count: 0,
        today_cents: 0,
        week_cents: 0,
        prev_week_cents: 0,
        month_cents: 0,
        last_7_days: Vec::new(),
        top_items: Vec::new(),
        weekdays: [0; 7],
    };

    for l in links.iter().filter(|l| l.currency == currency && l.status == "waiting") {
        s.waiting_count += 1;
        s.waiting_total_cents += l.total_cents;
    }

    let mut days: Vec<(i64, Agg)> = (0..7).map(|_| (0, Agg::default())).collect();
    let mut month = Agg::default();

    for (t, l) in paid_local(&links, currency, offset) {
        if t >= today {
            s.today_cents += l.total_cents;
        }
        if t >= week_start {
            s.week_cents += l.total_cents;
            let d = &mut days[((t - week_start) / DAY_MS).clamp(0, 6) as usize];
            d.0 += l.total_cents;
            l.items.iter().for_each(|it| d.1.add(it, &names));
        } else if t >= prev_week_start {
            s.prev_week_cents += l.total_cents;
        }
        if t >= month_start {
            s.month_cents += l.total_cents;
            l.items.iter().for_each(|it| month.add(it, &names));
        }
        if t >= weekdays_start {
            s.weekdays[weekday(t)] += l.total_cents;
        }
    }

    s.last_7_days = days
        .into_iter()
        .enumerate()
        .map(|(i, (total, agg))| DayTotal {
            day: (week_start + i as i64 * DAY_MS - offset).to_string(),
            total_cents: total,
            top: agg.top(5),
        })
        .collect();
    s.top_items = month.top(5);
    Ok(s)
}

pub async fn products(
    pool: &PgPool,
    merchant: &str,
    currency: &str,
    tz_offset_min: i64,
    days: Option<i64>,
) -> Result<Vec<ProductSummary>> {
    let links = match days {
        Some(d) => recent_links(pool, merchant, now_ms() - (d + 1) * DAY_MS).await?,
        None => list_links(pool, merchant).await?,
    };
    let names = product_names(pool, merchant).await?;
    let offset = tz_offset_min * 60_000;
    let since = days.map(|d| today_start(offset) - (d - 1) * DAY_MS).unwrap_or(i64::MIN);
    let mut map: HashMap<i64, ProductSummary> = names
        .into_iter()
        .map(|(id, name)| (id, ProductSummary { id, name, quantity: 0, revenue_cents: 0, orders: 0, last_sold_at: None }))
        .collect();

    for (t, l) in paid_local(&links, currency, offset) {
        if t < since {
            continue;
        }
        for it in &l.items {
            let Some(p) = it.product_id.and_then(|id| map.get_mut(&id)) else { continue };
            p.quantity += it.quantity;
            p.revenue_cents += it.total_cents;
            p.orders += 1;
            let paid = t - offset;
            p.last_sold_at = Some(p.last_sold_at.map_or(paid, |x| x.max(paid)));
        }
    }

    let mut v: Vec<ProductSummary> = map.into_values().collect();
    v.sort_by(|a, b| {
        b.quantity
            .cmp(&a.quantity)
            .then(b.revenue_cents.cmp(&a.revenue_cents))
            .then(a.name.cmp(&b.name))
    });
    Ok(v)
}

pub async fn product_detail(
    pool: &PgPool,
    merchant: &str,
    id: i64,
    currency: &str,
    tz_offset_min: i64,
) -> Result<Option<ProductDetail>> {
    let Some(name) = product_names(pool, merchant).await?.remove(&id) else { return Ok(None) };
    let links = list_links(pool, merchant).await?;
    let offset = tz_offset_min * 60_000;
    let start = today_start(offset) - 13 * DAY_MS;

    let aliases: Vec<String> =
        sqlx::query_scalar("SELECT alias FROM product_aliases WHERE merchant_id = $1 AND product_id = $2 ORDER BY alias")
            .bind(merchant)
            .bind(id)
            .fetch_all(pool)
            .await?;
    let aliases = aliases.into_iter().filter(|a| normalize(a) != normalize(&name)).collect();

    let mut d = ProductDetail {
        id,
        name,
        aliases,
        quantity: 0,
        revenue_cents: 0,
        orders: 0,
        avg_unit_cents: 0,
        last_sold_at: None,
        last_14_days: (0..14)
            .map(|i| ProductDay { day: (start + i * DAY_MS - offset).to_string(), quantity: 0, total_cents: 0 })
            .collect(),
        weekdays: [0; 7],
    };

    for (t, l) in paid_local(&links, currency, offset) {
        for it in l.items.iter().filter(|it| it.product_id == Some(id)) {
            d.quantity += it.quantity;
            d.revenue_cents += it.total_cents;
            d.orders += 1;
            d.weekdays[weekday(t)] += it.quantity;
            let paid = t - offset;
            d.last_sold_at = Some(d.last_sold_at.map_or(paid, |x| x.max(paid)));
            if t >= start {
                let day = &mut d.last_14_days[((t - start) / DAY_MS).clamp(0, 13) as usize];
                day.quantity += it.quantity;
                day.total_cents += it.total_cents;
            }
        }
    }
    if d.quantity > 0 {
        d.avg_unit_cents = d.revenue_cents / d.quantity as i64;
    }
    Ok(Some(d))
}

/// These tests need a real Postgres: set TEST_DATABASE_URL (they are skipped otherwise).
#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> Option<PgPool> {
        let url = std::env::var("TEST_DATABASE_URL").ok()?;
        Some(connect(&url).await.expect("test database"))
    }

    /// A fresh merchant per test keeps runs independent without wiping tables.
    fn merchant() -> String {
        format!("test-{}", new_id())
    }

    fn item(name: &str, product: Option<&str>) -> Item {
        Item { name: name.into(), quantity: 2, total_cents: 2000, product: product.map(Into::into), product_id: None }
    }

    fn payer(name: &str, phone: &str) -> Payer {
        crate::models::PayRequest { method: "card".into(), name: name.into(), phone: phone.into(), email: String::new() }
            .payer()
            .unwrap()
    }

    fn draft(items: Vec<Item>) -> Draft {
        Draft { items, currency: "BRL".into(), note: String::new(), customer: String::new(), customer_id: None }
    }

    #[tokio::test]
    async fn learns_and_groups_products() {
        let Some(db) = pool().await else { return };
        let m = merchant();
        let a = create_link(&db, &m, "", &draft(vec![item("Pão fermentado", Some("Sourdough bread"))])).await.unwrap();
        // Same product written differently, no AI hint: matched by alias.
        let b = create_link(&db, &m, "", &draft(vec![item("pao  FERMENTADO!", None)])).await.unwrap();
        // AI maps a new wording to the canonical name.
        let c = create_link(&db, &m, "", &draft(vec![item("Sourdough", Some("Sourdough bread"))])).await.unwrap();
        let pid = a.items[0].product_id;
        assert_eq!(b.items[0].product_id, pid);
        assert_eq!(c.items[0].product_id, pid);
        for l in [&a, &b, &c] {
            assert!(pay_link(&db, &l.id, "card", &payer("Ana", "+55 11 91234-5678")).await.unwrap());
        }
        let p = products(&db, &m, "BRL", 0, None).await.unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].quantity, 6);
        assert_eq!(p[0].name, "Sourdough bread");
        let s = stats(&db, &m, "BRL", 0).await.unwrap();
        assert_eq!(s.last_7_days[6].top[0].quantity, 6);
        assert_eq!(s.paid_count, 3);
        let d = product_detail(&db, &m, pid.unwrap(), "BRL", 0).await.unwrap().unwrap();
        assert_eq!(d.quantity, 6);
        assert!(d.aliases.iter().any(|a| a == "Pão fermentado"));
    }

    #[tokio::test]
    async fn merges_and_renames_products() {
        let Some(db) = pool().await else { return };
        let m = merchant();
        let a = create_link(&db, &m, "", &draft(vec![item("Coke", None)])).await.unwrap();
        let b = create_link(&db, &m, "", &draft(vec![item("Coca-Cola", None)])).await.unwrap();
        let (src, dst) = (b.items[0].product_id.unwrap(), a.items[0].product_id.unwrap());
        assert_ne!(src, dst);
        pay_link(&db, &a.id, "card", &payer("Ana", "11912345678")).await.unwrap();
        pay_link(&db, &b.id, "card", &payer("Bruno", "11988887777")).await.unwrap();
        assert!(merge_products(&db, &m, src, dst).await.unwrap());
        assert!(rename_product(&db, &m, dst, "Coca-Cola 350ml").await.unwrap());
        let p = products(&db, &m, "BRL", 0, None).await.unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].quantity, 4);
        assert_eq!(p[0].name, "Coca-Cola 350ml");
        // Future "coca cola" goes to the merged product.
        let c = create_link(&db, &m, "", &draft(vec![item("coca cola", None)])).await.unwrap();
        assert_eq!(c.items[0].product_id, Some(dst));
        // Cancel only works for the owner.
        assert!(!cancel_link(&db, "someone-else", &c.id).await.unwrap());
        assert!(cancel_link(&db, &m, &c.id).await.unwrap());
    }

    #[tokio::test]
    async fn payments_build_the_customer_list() {
        let Some(db) = pool().await else { return };
        let m = merchant();
        let a = create_link(&db, &m, "", &draft(vec![item("Bolo", None)])).await.unwrap();
        let b = create_link(&db, &m, "", &draft(vec![item("Bolo", None)])).await.unwrap();
        let c = create_link(&db, &m, "", &draft(vec![item("Pão", None)])).await.unwrap();
        // Same phone written differently = same customer; newest name wins.
        assert!(pay_link(&db, &a.id, "card", &payer("Ana", "(11) 91234-5678")).await.unwrap());
        assert!(pay_link(&db, &b.id, "pix", &payer("Ana Souza", "11 912345678")).await.unwrap());
        assert!(pay_link(&db, &c.id, "card", &payer("Bruno", "11988887777")).await.unwrap());
        // A paid link can't be paid again.
        assert!(!pay_link(&db, &a.id, "card", &payer("Xavier", "11900000000")).await.unwrap());

        let list = customers(&db, &m, "BRL").await.unwrap();
        assert_eq!(list.len(), 2);
        let ana = list.iter().find(|c| c.name == "Ana Souza").unwrap();
        assert_eq!(ana.orders, 2);
        assert_eq!(ana.spent_cents, 4000);

        assert!(update_customer(&db, &m, ana.id, None, Some("Gosta de pouco açúcar")).await.unwrap());
        let d = customer_detail(&db, &m, ana.id, "BRL").await.unwrap().unwrap();
        assert_eq!(d.summary.note, "Gosta de pouco açúcar");
        assert_eq!(d.links.len(), 2);
        assert_eq!(d.favorites[0].quantity, 4);
        // Other merchants can't see or edit.
        assert!(customer_detail(&db, "other", ana.id, "BRL").await.unwrap().is_none());
        assert!(!update_customer(&db, "other", ana.id, Some("x"), None).await.unwrap());
        // Payer data is hidden in the public view.
        let l = get_link(&db, &a.id).await.unwrap().unwrap();
        assert_eq!(l.payer_name, "Ana");
        assert!(l.public().payer_phone.is_empty());
    }

    #[tokio::test]
    async fn links_for_a_known_customer() {
        let Some(db) = pool().await else { return };
        let m = merchant();
        let first = create_link(&db, &m, "", &draft(vec![item("Bolo", None)])).await.unwrap();
        pay_link(&db, &first.id, "card", &payer("Francisco Borba", "+55 51 99999-1234")).await.unwrap();
        let cid = customers(&db, &m, "BRL").await.unwrap()[0].id;

        let mut d = draft(vec![item("Pão", None)]);
        d.customer_id = Some(cid);
        let l = create_link(&db, &m, "", &d).await.unwrap();
        assert_eq!(l.customer_id, Some(cid));
        assert_eq!(l.customer, "Francisco Borba");
        // Shows up in the customer's history while still waiting.
        let det = customer_detail(&db, &m, cid, "BRL").await.unwrap().unwrap();
        assert!(det.links.iter().any(|x| x.id == l.id && x.status == "waiting"));
        assert_eq!(customer_contact(&db, &m, cid).await.unwrap().unwrap().1, "+55 51 99999-1234");

        // Someone else's customer id is ignored.
        let mut other = draft(vec![item("Pão", None)]);
        other.customer_id = Some(cid);
        let x = create_link(&db, "another-merchant", "", &other).await.unwrap();
        assert_eq!(x.customer_id, None);
    }
}
