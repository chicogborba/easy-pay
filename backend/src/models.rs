use serde::{Deserialize, Serialize};

/// One line on the receipt. `total_cents` is the price of the whole line
/// (e.g. "2 breads for 20" => quantity 2, total 2000), which avoids rounding issues.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub name: String,
    pub quantity: u32,
    pub total_cents: i64,
    /// Canonical product name suggested by the AI (matches the merchant's catalog when known).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product: Option<String>,
    /// Set by the server when the link is created.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Draft {
    pub items: Vec<Item>,
    pub currency: String,
    #[serde(default)]
    pub note: String,
    /// Who is buying, when the owner mentions it ("for Joana").
    #[serde(default)]
    pub customer: String,
    /// Set when the owner starts the link from a customer's page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub customer_id: Option<i64>,
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
            i.product = i
                .product
                .take()
                .map(|p| p.trim().chars().take(80).collect::<String>())
                .filter(|p| !p.is_empty());
        }
        self.currency = self.currency.trim().to_uppercase();
        if self.currency.len() != 3 {
            self.currency = "USD".into();
        }
        self.note = self.note.trim().chars().take(200).collect();
        self.customer = self.customer.trim().chars().take(60).collect();
        if self.items.is_empty() {
            None
        } else {
            Some(self)
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Link {
    #[serde(skip)]
    pub merchant_id: String,
    pub id: String,
    pub business_name: String,
    pub customer: String,
    pub items: Vec<Item>,
    pub currency: String,
    pub total_cents: i64,
    pub note: String,
    pub status: String,
    pub created_at: i64,
    pub paid_at: Option<i64>,
    pub paid_method: Option<String>,
    /// Who paid (filled on the checkout page). Hidden from anyone but the merchant.
    pub customer_id: Option<i64>,
    pub payer_name: String,
    pub payer_phone: String,
    pub payer_email: String,
    /// For links made for a known customer: enough for them to recognize
    /// themselves at checkout ("Pay as Ana · phone ending 5678") without exposing the number.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub known_customer: Option<KnownCustomer>,
}

#[derive(Debug, Clone, Serialize)]
pub struct KnownCustomer {
    pub name: String,
    pub phone_last4: String,
}

impl Link {
    /// What a visitor who is not the owner may see.
    pub fn public(mut self) -> Self {
        self.customer_id = None;
        self.payer_name.clear();
        self.payer_phone.clear();
        self.payer_email.clear();
        self
    }
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
    /// Quick-reply buttons for a question the assistant asked.
    #[serde(default)]
    pub choices: Vec<String>,
}

/// What the AI knows about the merchant's products.
#[derive(Debug, Clone)]
pub struct CatalogEntry {
    pub name: String,
    pub unit_cents: i64,
    pub currency: String,
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
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub email: String,
}

/// Validated payer details.
#[derive(Debug, Clone)]
pub struct Payer {
    pub name: String,
    pub phone: String,
    pub phone_norm: String,
    pub email: String,
}

impl PayRequest {
    pub fn payer(&self) -> Result<Payer, &'static str> {
        let name: String = self.name.trim().chars().take(80).collect();
        if name.chars().count() < 2 {
            return Err("invalid name");
        }
        let phone_norm: String = self.phone.chars().filter(|c| c.is_ascii_digit()).collect();
        if !(8..=15).contains(&phone_norm.len()) {
            return Err("invalid phone");
        }
        let email = self.email.trim().to_lowercase();
        if !email.is_empty() && (!email.contains('@') || email.len() > 120) {
            return Err("invalid email");
        }
        Ok(Payer { name, phone: self.phone.trim().chars().take(30).collect(), phone_norm, email })
    }
}

#[derive(Debug, Serialize)]
pub struct CustomerSummary {
    pub id: i64,
    pub name: String,
    pub phone: String,
    pub email: String,
    pub note: String,
    pub orders: u32,
    pub spent_cents: i64,
    pub first_purchase_at: Option<i64>,
    pub last_purchase_at: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct CustomerDetail {
    #[serde(flatten)]
    pub summary: CustomerSummary,
    pub favorites: Vec<TopItem>,
    pub links: Vec<Link>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCustomerRequest {
    pub name: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct StatsQuery {
    pub currency: Option<String>,
    /// Minutes to add to UTC to get the merchant's local time (JS: -getTimezoneOffset()).
    pub tz_offset: Option<i64>,
    /// Period for product rankings; missing = all time.
    pub days: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct DayTotal {
    /// Local day start as unix ms (string for easy JS parsing).
    pub day: String,
    pub total_cents: i64,
    pub top: Vec<TopItem>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TopItem {
    pub product_id: Option<i64>,
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
    pub prev_week_cents: i64,
    pub month_cents: i64,
    pub last_7_days: Vec<DayTotal>,
    /// Best sellers of the last 30 days.
    pub top_items: Vec<TopItem>,
    /// Revenue per weekday over the last 8 weeks, index 0 = Sunday.
    pub weekdays: [i64; 7],
}

#[derive(Debug, Serialize)]
pub struct ProductSummary {
    pub id: i64,
    pub name: String,
    pub quantity: u32,
    pub revenue_cents: i64,
    pub orders: u32,
    pub last_sold_at: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct ProductDay {
    pub day: String,
    pub quantity: u32,
    pub total_cents: i64,
}

#[derive(Debug, Serialize)]
pub struct ProductDetail {
    pub id: i64,
    pub name: String,
    pub aliases: Vec<String>,
    pub quantity: u32,
    pub revenue_cents: i64,
    pub orders: u32,
    pub avg_unit_cents: i64,
    pub last_sold_at: Option<i64>,
    pub last_14_days: Vec<ProductDay>,
    /// Units per weekday, index 0 = Sunday.
    pub weekdays: [u32; 7],
}

#[derive(Debug, Deserialize)]
pub struct RenameRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct MergeRequest {
    pub into_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct InsightsRequest {
    #[serde(default = "default_lang")]
    pub lang: String,
    #[serde(default = "default_currency")]
    pub currency: String,
    #[serde(default)]
    pub tz_offset: i64,
}

#[derive(Debug, Serialize)]
pub struct InsightsResponse {
    pub tips: Vec<String>,
}

fn default_lang() -> String {
    "en".into()
}

fn default_currency() -> String {
    "USD".into()
}
