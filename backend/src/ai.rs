//! OpenRouter integration: turns a free-form message into a receipt draft,
//! and transcribes voice notes. Falls back to a simple local parser when no
//! API key is configured, so the demo works offline.

use anyhow::{anyhow, Result};
use regex::Regex;
use serde_json::{json, Value};

use crate::models::{ChatMessage, ChatResponse, Draft, Item};

#[derive(Clone)]
pub struct Ai {
    http: reqwest::Client,
    key: Option<String>,
    model: String,
    audio_model: String,
}

const URL: &str = "https://openrouter.ai/api/v1/chat/completions";

fn lang_name(code: &str) -> &'static str {
    match code {
        "es" => "Spanish",
        "pt" => "Portuguese",
        "zh" => "Simplified Chinese",
        "hi" => "Hindi",
        "ar" => "Arabic",
        "fr" => "French",
        _ => "English",
    }
}

fn system_prompt(lang: &str, currency: &str) -> String {
    format!(
        r#"You help a small business owner create payment links. They describe what a customer is buying, in any language, by text or voice.
Extract the items and prices. Reply ONLY with a JSON object, no markdown:
{{"reply": "<very short friendly message in {lang}>", "draft": null | {{"items": [{{"name": "<item>", "quantity": <int>, "total": <number, price of the whole line>}}], "currency": "<ISO 4217>", "note": "<optional short note for the customer, or empty>"}}}}
Rules:
- "2 breads for 20" means quantity 2 and total 20. Only multiply when they say "each"/"cada"/"per unit".
- Keep sizes in the item name, e.g. "Jam 500g". Keep item names in the language the owner used, nicely capitalized.
- Currency: use the one mentioned (reais=BRL, dollars=USD, euros=EUR, pesos=MXN unless clear otherwise, yuan=CNY, rupees=INR). If none is mentioned use {currency}.
- If the owner corrects something, return the full updated draft.
- If there is no price or nothing to sell, set "draft" to null and in "reply" ask simply what they sold and for how much.
- When there is a draft, "reply" should say something like "Here it is! Is it right?" in {lang}.
- Be warm and extremely simple. The user is not tech savvy."#,
        lang = lang_name(lang),
    )
}

impl Ai {
    pub fn from_env() -> Self {
        let key = std::env::var("OPENROUTER_API_KEY").ok().filter(|k| !k.trim().is_empty());
        Self {
            http: reqwest::Client::new(),
            key,
            model: std::env::var("OPENROUTER_MODEL")
                .unwrap_or_else(|_| "google/gemini-2.5-flash-lite".into()),
            audio_model: std::env::var("OPENROUTER_AUDIO_MODEL")
                .unwrap_or_else(|_| "google/gemini-2.5-flash-lite".into()),
        }
    }

    pub fn enabled(&self) -> bool {
        self.key.is_some()
    }

    async fn complete(&self, model: &str, messages: Value, json_mode: bool) -> Result<String> {
        let key = self.key.as_ref().ok_or_else(|| anyhow!("no api key"))?;
        let mut body = json!({ "model": model, "messages": messages, "temperature": 0.1 });
        if json_mode {
            body["response_format"] = json!({ "type": "json_object" });
        }
        let res: Value = self
            .http
            .post(URL)
            .bearer_auth(key)
            .header("X-Title", "Easy Pay")
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        res["choices"][0]["message"]["content"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| anyhow!("unexpected response: {res}"))
    }

    pub async fn chat(&self, history: &[ChatMessage], lang: &str, currency: &str) -> ChatResponse {
        if !self.enabled() {
            return local_parse(history, currency);
        }
        let mut messages = vec![json!({ "role": "system", "content": system_prompt(lang, currency) })];
        // Keep the conversation short: last 12 turns is plenty for corrections.
        let start = history.len().saturating_sub(12);
        for m in &history[start..] {
            let role = if m.role == "assistant" { "assistant" } else { "user" };
            messages.push(json!({ "role": role, "content": m.content }));
        }
        match self.complete(&self.model, Value::Array(messages), true).await {
            Ok(text) => parse_model_output(&text, currency).unwrap_or_else(|| {
                tracing::warn!("could not parse model output: {text}");
                local_parse(history, currency)
            }),
            Err(e) => {
                tracing::error!("openrouter error: {e:#}");
                local_parse(history, currency)
            }
        }
    }

    /// `wav_base64` is a mono 16-bit WAV encoded by the browser.
    pub async fn transcribe(&self, wav_base64: &str, lang: &str) -> Result<String> {
        let messages = json!([{
            "role": "user",
            "content": [
                { "type": "text", "text": format!(
                    "Transcribe this voice note exactly as spoken. It is probably in {} but keep the original language. Output only the transcription, nothing else.",
                    lang_name(lang)
                )},
                { "type": "input_audio", "input_audio": { "data": wav_base64, "format": "wav" } }
            ]
        }]);
        let text = self.complete(&self.audio_model, messages, false).await?;
        Ok(text.trim().trim_matches('"').to_string())
    }
}

fn to_cents(v: &Value) -> Option<i64> {
    let n = match v {
        Value::Number(n) => n.as_f64()?,
        Value::String(s) => s.replace(',', ".").trim().parse().ok()?,
        _ => return None,
    };
    Some((n * 100.0).round() as i64)
}

fn parse_model_output(text: &str, default_currency: &str) -> Option<ChatResponse> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    let v: Value = serde_json::from_str(&text[start..=end]).ok()?;
    let reply = v["reply"].as_str().unwrap_or("").to_string();
    let draft = v.get("draft").filter(|d| d.is_object()).and_then(|d| {
        let items = d["items"]
            .as_array()?
            .iter()
            .filter_map(|it| {
                Some(Item {
                    name: it["name"].as_str()?.to_string(),
                    quantity: it["quantity"].as_u64().unwrap_or(1) as u32,
                    total_cents: to_cents(&it["total"])?,
                })
            })
            .collect();
        Draft {
            items,
            currency: d["currency"].as_str().unwrap_or(default_currency).to_string(),
            note: d["note"].as_str().unwrap_or("").to_string(),
        }
        .sanitize()
    });
    Some(ChatResponse { reply, draft })
}

/// Tiny offline parser: "500g jam for 14 and 2 breads for 20".
fn local_parse(history: &[ChatMessage], default_currency: &str) -> ChatResponse {
    let text = history
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.as_str())
        .unwrap_or("");
    let lower = text.to_lowercase();

    let currency = if lower.contains("reais") || lower.contains("r$") {
        "BRL"
    } else if lower.contains("euro") || lower.contains('€') {
        "EUR"
    } else if lower.contains("dollar") || lower.contains("dólar") || lower.contains("us$") {
        "USD"
    } else {
        default_currency
    };

    let splitter = Regex::new(r"(?i)\s+(?:and|e|y|et|und)\s+|[,;+\n]|\s&\s").unwrap();
    let cur = r"(?:reais|real|dollars?|d[oó]lares|euros?|pesos|bucks)\b";
    let price_re = Regex::new(&format!(
        r"(?i)(?:\b(?:for|por|a|at|para|pour|=)\s*|r\$\s*|\$\s*|€\s*)(\d+(?:[.,]\d{{1,2}})?)(?:\s*{cur})?|(\d+(?:[.,]\d{{1,2}})?)\s*{cur}"
    ))
    .unwrap();
    let qty_re = Regex::new(r"^\s*(\d+)\s+(?:x\s+)?([^\d].*)$").unwrap();
    let filler = Regex::new(
        r"(?i)^(?:i\s+)?(?:need|want|make|create|gera|gerar|preciso\s+de|quero|necesito|un|uma?|a|link|de|pagamento|payment|pago|para|pra|for|of)\b\s*",
    )
    .unwrap();

    let mut items = Vec::new();
    for seg in splitter.split(text) {
        let Some(cap) = price_re.captures(seg) else { continue };
        let num = cap.get(1).or_else(|| cap.get(2)).unwrap().as_str().replace(',', ".");
        let Ok(price) = num.parse::<f64>() else { continue };
        let whole = cap.get(0).unwrap();
        let mut name = format!("{} {}", &seg[..whole.start()], &seg[whole.end()..]);
        for _ in 0..12 {
            name = filler.replace(name.trim(), "").to_string();
        }
        let mut quantity = 1;
        if let Some(q) = qty_re.captures(&name) {
            quantity = q[1].parse().unwrap_or(1);
            name = q[2].to_string();
        }
        let name = name.trim().trim_end_matches(['.', ':', '-']).trim();
        if name.is_empty() {
            continue;
        }
        let mut chars = name.chars();
        let name = chars.next().map(|c| c.to_uppercase().collect::<String>()).unwrap_or_default() + chars.as_str();
        items.push(Item { name, quantity, total_cents: (price * 100.0).round() as i64 });
    }

    let draft = Draft { items, currency: currency.into(), note: String::new() }.sanitize();
    let reply = if draft.is_some() {
        "Here it is! Is it right?".into()
    } else {
        "Tell me what you sold and the price. Example: 2 breads for 20".into()
    };
    ChatResponse { reply, draft }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_example() {
        let h = vec![ChatMessage {
            role: "user".into(),
            content: "preciso de um link de pagamento pra 500g de geleia por 14 reais e 2 pães artesanais por 20 reais".into(),
        }];
        let r = local_parse(&h, "USD");
        let d = r.draft.unwrap();
        assert_eq!(d.currency, "BRL");
        assert_eq!(d.items.len(), 2);
        assert_eq!(d.items[0].total_cents, 1400);
        assert_eq!(d.items[1].quantity, 2);
        assert_eq!(d.items[1].total_cents, 2000);
    }

    #[test]
    fn parses_model_json() {
        let r = parse_model_output(
            r#"```json {"reply":"ok","draft":{"items":[{"name":"Jam 500g","quantity":1,"total":"14,50"}],"currency":"brl"}}```"#,
            "USD",
        )
        .unwrap();
        let d = r.draft.unwrap();
        assert_eq!(d.items[0].total_cents, 1450);
        assert_eq!(d.currency, "BRL");
    }
}
