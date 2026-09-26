use std::collections::HashMap;

use anyhow::Result;
use rand::{distributions::Alphanumeric, Rng};
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::models::{
    CatalogEntry, DayTotal, Draft, Item, Link, ProductDay, ProductDetail, ProductSummary, Stats, TopItem,
};

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
         CREATE INDEX IF NOT EXISTS idx_links_merchant ON links(merchant_id, created_at DESC);

         -- Products the merchant sells, learned automatically from their links.
         CREATE TABLE IF NOT EXISTS products (
             id              INTEGER PRIMARY KEY AUTOINCREMENT,
             merchant_id     TEXT NOT NULL,
             name            TEXT NOT NULL,
             last_unit_cents INTEGER NOT NULL DEFAULT 0,
             last_currency   TEXT NOT NULL DEFAULT '',
             created_at      INTEGER NOT NULL
         );
         -- Every way the merchant has written a product (normalized), pointing to it.
         CREATE TABLE IF NOT EXISTS product_aliases (
             merchant_id TEXT NOT NULL,
             alias_norm  TEXT NOT NULL,
             alias       TEXT NOT NULL,
             product_id  INTEGER NOT NULL,
             PRIMARY KEY (merchant_id, alias_norm)
         );",
    )?;
    // Columns added after the first version (ignore "duplicate column" on existing DBs).
    let _ = conn.execute("ALTER TABLE links ADD COLUMN customer TEXT NOT NULL DEFAULT ''", []);
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

const COLS: &str = "id, business_name, items_json, currency, total_cents, note, status, created_at, paid_at, paid_method, customer";

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
        customer: r.get(10)?,
    })
}

pub fn create_link(conn: &Connection, merchant: &str, business: &str, draft: &Draft) -> Result<Link> {
    let mut items = draft.items.clone();
    for it in &mut items {
        let (pid, name) = resolve_product(conn, merchant, it, &draft.currency)?;
        it.product_id = Some(pid);
        it.product = Some(name);
    }
    let id = new_id();
    conn.execute(
        "INSERT INTO links (id, merchant_id, business_name, items_json, currency, total_cents, note, created_at, customer)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            merchant,
            business.trim(),
            serde_json::to_string(&items)?,
            draft.currency,
            draft.total_cents(),
            draft.note,
            now_ms(),
            draft.customer,
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
        "SELECT {COLS} FROM links WHERE merchant_id = ?1 ORDER BY created_at DESC LIMIT 2000"
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

/* ---------------- products ---------------- */

fn find_alias(conn: &Connection, merchant: &str, text: &str) -> Result<Option<i64>> {
    let norm = normalize(text);
    if norm.is_empty() {
        return Ok(None);
    }
    Ok(conn
        .query_row(
            "SELECT product_id FROM product_aliases WHERE merchant_id = ?1 AND alias_norm = ?2",
            params![merchant, norm],
            |r| r.get(0),
        )
        .optional()?)
}

fn add_alias(conn: &Connection, merchant: &str, text: &str, pid: i64) -> Result<()> {
    let norm = normalize(text);
    if !norm.is_empty() {
        conn.execute(
            "INSERT OR IGNORE INTO product_aliases (merchant_id, alias_norm, alias, product_id) VALUES (?1, ?2, ?3, ?4)",
            params![merchant, norm, text.trim(), pid],
        )?;
    }
    Ok(())
}

/// Finds the product for a receipt line (by the AI's canonical name, then by the
/// line's own name) or creates it. Remembers the line's wording as an alias.
fn resolve_product(conn: &Connection, merchant: &str, it: &Item, currency: &str) -> Result<(i64, String)> {
    let mut pid = None;
    for cand in [it.product.as_deref(), Some(it.name.as_str())].into_iter().flatten() {
        if let Some(p) = find_alias(conn, merchant, cand)? {
            pid = Some(p);
            break;
        }
    }
    let pid = match pid {
        Some(p) => p,
        None => {
            let name = it.product.clone().unwrap_or_else(|| it.name.clone());
            conn.execute(
                "INSERT INTO products (merchant_id, name, created_at) VALUES (?1, ?2, ?3)",
                params![merchant, name, now_ms()],
            )?;
            conn.last_insert_rowid()
        }
    };
    if let Some(p) = &it.product {
        add_alias(conn, merchant, p, pid)?;
    }
    add_alias(conn, merchant, &it.name, pid)?;
    conn.execute(
        "UPDATE products SET last_unit_cents = ?2, last_currency = ?3 WHERE id = ?1",
        params![pid, it.total_cents / it.quantity.max(1) as i64, currency],
    )?;
    let name = conn.query_row("SELECT name FROM products WHERE id = ?1", [pid], |r| r.get(0))?;
    Ok((pid, name))
}

/// Products the AI should know about, most recently used first.
pub fn catalog(conn: &Connection, merchant: &str) -> Result<Vec<CatalogEntry>> {
    let mut stmt = conn.prepare(
        "SELECT name, last_unit_cents, last_currency FROM products WHERE merchant_id = ?1 ORDER BY id DESC LIMIT 80",
    )?;
    let rows = stmt.query_map([merchant], |r| {
        Ok(CatalogEntry { name: r.get(0)?, unit_cents: r.get(1)?, currency: r.get(2)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn product_names(conn: &Connection, merchant: &str) -> Result<HashMap<i64, String>> {
    let mut stmt = conn.prepare("SELECT id, name FROM products WHERE merchant_id = ?1")?;
    let rows = stmt.query_map([merchant], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn rename_product(conn: &Connection, merchant: &str, id: i64, name: &str) -> Result<bool> {
    let name = name.trim();
    let n = conn.execute(
        "UPDATE products SET name = ?3 WHERE id = ?1 AND merchant_id = ?2",
        params![id, merchant, name],
    )?;
    if n > 0 {
        add_alias(conn, merchant, name, id)?;
    }
    Ok(n > 0)
}

/// Joins `src` into `dst`: aliases and past sales move over, `src` disappears.
pub fn merge_products(conn: &Connection, merchant: &str, src: i64, dst: i64) -> Result<bool> {
    let names = product_names(conn, merchant)?;
    let (Some(_), Some(dst_name)) = (names.get(&src), names.get(&dst)) else { return Ok(false) };
    if src == dst {
        return Ok(false);
    }
    conn.execute(
        "UPDATE product_aliases SET product_id = ?3 WHERE merchant_id = ?1 AND product_id = ?2",
        params![merchant, src, dst],
    )?;
    conn.execute("DELETE FROM products WHERE id = ?1 AND merchant_id = ?2", params![src, merchant])?;
    for link in list_links(conn, merchant)? {
        let mut changed = false;
        let mut items = link.items.clone();
        for it in &mut items {
            if it.product_id == Some(src) {
                it.product_id = Some(dst);
                it.product = Some(dst_name.clone());
                changed = true;
            }
        }
        if changed {
            conn.execute(
                "UPDATE links SET items_json = ?2 WHERE id = ?1",
                params![link.id, serde_json::to_string(&items)?],
            )?;
        }
    }
    Ok(true)
}

/* ---------------- analytics ---------------- */

const DAY_MS: i64 = 86_400_000;

/// Paid links in one currency, with their payment time shifted to local time.
fn paid_local(conn: &Connection, merchant: &str, currency: &str, offset_ms: i64) -> Result<Vec<(i64, Link)>> {
    Ok(list_links(conn, merchant)?
        .into_iter()
        .filter(|l| l.status == "paid" && l.currency == currency)
        .map(|l| (l.paid_at.unwrap_or(l.created_at) + offset_ms, l))
        .collect())
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

pub fn stats(conn: &Connection, merchant: &str, currency: &str, tz_offset_min: i64) -> Result<Stats> {
    let offset = tz_offset_min * 60_000;
    let today = today_start(offset);
    let week_start = today - 6 * DAY_MS;
    let prev_week_start = week_start - 7 * DAY_MS;
    let month_start = today - 29 * DAY_MS;
    let weekdays_start = today - 55 * DAY_MS;
    let names = product_names(conn, merchant)?;

    let mut s = Stats {
        currency: currency.to_string(),
        paid_total_cents: 0,
        paid_count: 0,
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

    for l in list_links(conn, merchant)?.iter().filter(|l| l.currency == currency && l.status == "waiting") {
        s.waiting_count += 1;
        s.waiting_total_cents += l.total_cents;
    }

    let mut days: Vec<(i64, Agg)> = (0..7).map(|_| (0, Agg::default())).collect();
    let mut month = Agg::default();

    for (t, l) in paid_local(conn, merchant, currency, offset)? {
        s.paid_count += 1;
        s.paid_total_cents += l.total_cents;
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

pub fn products(
    conn: &Connection,
    merchant: &str,
    currency: &str,
    tz_offset_min: i64,
    days: Option<i64>,
) -> Result<Vec<ProductSummary>> {
    let offset = tz_offset_min * 60_000;
    let since = days.map(|d| today_start(offset) - (d - 1) * DAY_MS).unwrap_or(i64::MIN);
    let names = product_names(conn, merchant)?;
    let mut map: HashMap<i64, ProductSummary> = names
        .iter()
        .map(|(id, name)| {
            (*id, ProductSummary { id: *id, name: name.clone(), quantity: 0, revenue_cents: 0, orders: 0, last_sold_at: None })
        })
        .collect();

    for (t, l) in paid_local(conn, merchant, currency, offset)? {
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

pub fn product_detail(
    conn: &Connection,
    merchant: &str,
    id: i64,
    currency: &str,
    tz_offset_min: i64,
) -> Result<Option<ProductDetail>> {
    let Some(name) = product_names(conn, merchant)?.remove(&id) else { return Ok(None) };
    let offset = tz_offset_min * 60_000;
    let start = today_start(offset) - 13 * DAY_MS;

    let mut stmt = conn.prepare("SELECT alias FROM product_aliases WHERE merchant_id = ?1 AND product_id = ?2")?;
    let aliases: Vec<String> = stmt
        .query_map(params![merchant, id], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .filter(|a| normalize(a) != normalize(&name))
        .collect();

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

    for (t, l) in paid_local(conn, merchant, currency, offset)? {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn item(name: &str, product: Option<&str>) -> Item {
        Item { name: name.into(), quantity: 2, total_cents: 2000, product: product.map(Into::into), product_id: None }
    }

    fn draft(items: Vec<Item>) -> Draft {
        Draft { items, currency: "BRL".into(), note: String::new(), customer: String::new() }
    }

    #[test]
    fn learns_and_groups_products() {
        let conn = open(":memory:").unwrap();
        let a = create_link(&conn, "m1", "", &draft(vec![item("Pão fermentado", Some("Sourdough bread"))])).unwrap();
        // Same product written differently, no AI hint: matched by alias.
        let b = create_link(&conn, "m1", "", &draft(vec![item("pao  FERMENTADO!", None)])).unwrap();
        // AI maps a new wording to the canonical name.
        let c = create_link(&conn, "m1", "", &draft(vec![item("Sourdough", Some("Sourdough bread"))])).unwrap();
        let pid = a.items[0].product_id;
        assert_eq!(b.items[0].product_id, pid);
        assert_eq!(c.items[0].product_id, pid);
        for l in [&a, &b, &c] {
            pay_link(&conn, &l.id, "card").unwrap();
        }
        let p = products(&conn, "m1", "BRL", 0, None).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].quantity, 6);
        assert_eq!(p[0].name, "Sourdough bread");
        let s = stats(&conn, "m1", "BRL", 0).unwrap();
        assert_eq!(s.last_7_days[6].top[0].quantity, 6);
    }

    #[test]
    fn merges_products() {
        let conn = open(":memory:").unwrap();
        let a = create_link(&conn, "m1", "", &draft(vec![item("Coke", None)])).unwrap();
        let b = create_link(&conn, "m1", "", &draft(vec![item("Coca-Cola", None)])).unwrap();
        let (src, dst) = (b.items[0].product_id.unwrap(), a.items[0].product_id.unwrap());
        assert_ne!(src, dst);
        pay_link(&conn, &a.id, "card").unwrap();
        pay_link(&conn, &b.id, "card").unwrap();
        assert!(merge_products(&conn, "m1", src, dst).unwrap());
        let p = products(&conn, "m1", "BRL", 0, None).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].quantity, 4);
        // Future "coca cola" goes to the merged product.
        let c = create_link(&conn, "m1", "", &draft(vec![item("coca cola", None)])).unwrap();
        assert_eq!(c.items[0].product_id, Some(dst));
    }
}
