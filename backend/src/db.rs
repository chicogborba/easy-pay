use std::collections::HashMap;

use anyhow::Result;
use rand::{distributions::Alphanumeric, Rng};
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::models::{DayTotal, Draft, Item, Link, Stats, TopItem};

pub fn open(path: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS links (
             id            TEXT PRIMARY KEY,
             merchant_id   TEXT NOT NULL,
             business_name TEXT NOT NULL DEFAULT '',
             items_json    TEXT NOT NULL,
             currency      TEXT NOT NULL,
             total_cents   INTEGER NOT NULL,
             note          TEXT NOT NULL DEFAULT '',
             status        TEXT NOT NULL DEFAULT 'waiting',
             created_at    INTEGER NOT NULL,
             paid_at       INTEGER,
             paid_method   TEXT
         );
         CREATE INDEX IF NOT EXISTS idx_links_merchant ON links(merchant_id, created_at DESC);",
    )?;
    Ok(conn)
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

const COLS: &str =
    "id, business_name, items_json, currency, total_cents, note, status, created_at, paid_at, paid_method";

fn row_to_link(r: &Row) -> rusqlite::Result<Link> {
    let items_json: String = r.get(2)?;
    Ok(Link {
        id: r.get(0)?,
        business_name: r.get(1)?,
        items: serde_json::from_str::<Vec<Item>>(&items_json).unwrap_or_default(),
        currency: r.get(3)?,
        total_cents: r.get(4)?,
        note: r.get(5)?,
        status: r.get(6)?,
        created_at: r.get(7)?,
        paid_at: r.get(8)?,
        paid_method: r.get(9)?,
    })
}

pub fn create_link(conn: &Connection, merchant: &str, business: &str, draft: &Draft) -> Result<Link> {
    let id = new_id();
    conn.execute(
        "INSERT INTO links (id, merchant_id, business_name, items_json, currency, total_cents, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            merchant,
            business.trim(),
            serde_json::to_string(&draft.items)?,
            draft.currency,
            draft.total_cents(),
            draft.note,
            now_ms()
        ],
    )?;
    Ok(get_link(conn, &id)?.expect("just inserted"))
}

pub fn get_link(conn: &Connection, id: &str) -> Result<Option<Link>> {
    Ok(conn
        .query_row(&format!("SELECT {COLS} FROM links WHERE id = ?1"), [id], row_to_link)
        .optional()?)
}

pub fn list_links(conn: &Connection, merchant: &str) -> Result<Vec<Link>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM links WHERE merchant_id = ?1 ORDER BY created_at DESC LIMIT 500"
    ))?;
    let rows = stmt.query_map([merchant], row_to_link)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Returns false when the link does not belong to the merchant or is not waiting.
pub fn cancel_link(conn: &Connection, merchant: &str, id: &str) -> Result<bool> {
    let n = conn.execute(
        "UPDATE links SET status = 'cancelled' WHERE id = ?1 AND merchant_id = ?2 AND status = 'waiting'",
        params![id, merchant],
    )?;
    Ok(n > 0)
}

/// Mock payment: flips the link to paid.
pub fn pay_link(conn: &Connection, id: &str, method: &str) -> Result<bool> {
    let n = conn.execute(
        "UPDATE links SET status = 'paid', paid_at = ?2, paid_method = ?3 WHERE id = ?1 AND status = 'waiting'",
        params![id, now_ms(), method],
    )?;
    Ok(n > 0)
}

const DAY_MS: i64 = 86_400_000;

pub fn stats(conn: &Connection, merchant: &str, currency: &str, tz_offset_min: i64) -> Result<Stats> {
    let links: Vec<Link> = list_links(conn, merchant)?
        .into_iter()
        .filter(|l| l.currency == currency)
        .collect();

    let offset = tz_offset_min * 60_000;
    let now_local = now_ms() + offset;
    let today_start = now_local - now_local.rem_euclid(DAY_MS);
    let week_start = today_start - 6 * DAY_MS;
    let month_start = today_start - 29 * DAY_MS;

    let mut s = Stats {
        currency: currency.to_string(),
        paid_total_cents: 0,
        paid_count: 0,
        waiting_total_cents: 0,
        waiting_count: 0,
        today_cents: 0,
        week_cents: 0,
        month_cents: 0,
        last_7_days: Vec::new(),
        top_items: Vec::new(),
    };
    let mut days = [0i64; 7];
    let mut top: HashMap<String, TopItem> = HashMap::new();

    for l in &links {
        match l.status.as_str() {
            "waiting" => {
                s.waiting_count += 1;
                s.waiting_total_cents += l.total_cents;
            }
            "paid" => {
                s.paid_count += 1;
                s.paid_total_cents += l.total_cents;
                let t = l.paid_at.unwrap_or(l.created_at) + offset;
                if t >= today_start {
                    s.today_cents += l.total_cents;
                }
                if t >= week_start {
                    s.week_cents += l.total_cents;
                    let idx = ((t - week_start) / DAY_MS).clamp(0, 6) as usize;
                    days[idx] += l.total_cents;
                }
                if t >= month_start {
                    s.month_cents += l.total_cents;
                }
                for it in &l.items {
                    let key = it.name.to_lowercase();
                    let e = top.entry(key).or_insert(TopItem {
                        name: it.name.clone(),
                        quantity: 0,
                        total_cents: 0,
                    });
                    e.quantity += it.quantity;
                    e.total_cents += it.total_cents;
                }
            }
            _ => {}
        }
    }

    s.last_7_days = days
        .iter()
        .enumerate()
        .map(|(i, total)| DayTotal {
            // Day start in local time as unix ms (as string for easy JS parsing).
            day: (week_start + i as i64 * DAY_MS - offset).to_string(),
            total_cents: *total,
        })
        .collect();

    let mut top: Vec<TopItem> = top.into_values().collect();
    top.sort_by(|a, b| b.total_cents.cmp(&a.total_cents));
    top.truncate(5);
    s.top_items = top;
    Ok(s)
}
