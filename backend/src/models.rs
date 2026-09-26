use serde::{Deserialize, Serialize};

/// One line on the receipt. `total_cents` is the price of the whole line
/// (e.g. "2 breads for 20" => quantity 2, total 2000), which avoids rounding issues.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub name: String,
    pub quantity: u32,
    pub total_cents: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Draft {
    pub items: Vec<Item>,
    pub currency: String,
    #[serde(default)]
    pub note: String,
}

impl Draft {
    pub fn total_cents(&self) -> i64 {
        self.items.iter().map(|i| i.total_cents).sum()
    }

    /// Drops empty/invalid lines and normalizes fields.
    pub fn sanitize(mut self) -> Option<Self> {
        self.items.retain(|i| !i.name.trim().is_empty() && i.total_cents > 0);
        for i in &mut self.items {
            i.name = i.name.trim().chars().take(80).collect();
            i.quantity = i.quantity.clamp(1, 9999);
        }
        self.currency = self.currency.trim().to_uppercase();
        if self.currency.len() != 3 {
            self.currency = "USD".into();
        }
        self.note = self.note.trim().chars().take(200).collect();
        if self.items.is_empty() {
            None
        } else {
            Some(self)
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Link {
    pub id: String,
    pub business_name: String,
    pub items: Vec<Item>,
    pub currency: String,
    pub total_cents: i64,
    pub note: String,
    pub status: String,
    pub created_at: i64,
    pub paid_at: Option<i64>,
    pub paid_method: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    #[serde(default = "default_lang")]
    pub lang: String,
    #[serde(default = "default_currency")]
    pub currency: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatResponse {
    pub reply: String,
    pub draft: Option<Draft>,
}

#[derive(Debug, Deserialize)]
pub struct TranscribeRequest {
    pub audio_base64: String,
    #[serde(default = "default_lang")]
    pub lang: String,
}

#[derive(Debug, Serialize)]
pub struct TranscribeResponse {
    pub text: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateLinkRequest {
    pub draft: Draft,
    #[serde(default)]
    pub business_name: String,
}

#[derive(Debug, Deserialize)]
pub struct PayRequest {
    pub method: String,
}

#[derive(Debug, Deserialize)]
pub struct StatsQuery {
    pub currency: Option<String>,
    /// Minutes to add to UTC to get the merchant's local time (JS: -getTimezoneOffset()).
    pub tz_offset: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct DayTotal {
    pub day: String,
    pub total_cents: i64,
}

#[derive(Debug, Serialize)]
pub struct TopItem {
    pub name: String,
    pub quantity: u32,
    pub total_cents: i64,
}

#[derive(Debug, Serialize)]
pub struct Stats {
    pub currency: String,
    pub paid_total_cents: i64,
    pub paid_count: i64,
    pub waiting_total_cents: i64,
    pub waiting_count: i64,
    pub today_cents: i64,
    pub week_cents: i64,
    pub month_cents: i64,
    pub last_7_days: Vec<DayTotal>,
    pub top_items: Vec<TopItem>,
}

fn default_lang() -> String {
    "en".into()
}

fn default_currency() -> String {
    "USD".into()
}
