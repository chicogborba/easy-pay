//! OpenRouter integration: turns a free-form message into a receipt draft,
//! and transcribes voice notes. Falls back to a simple local parser when no
//! API key is configured, so the demo works offline.

use anyhow::{anyhow, Result};
use regex::Regex;
use serde_json::{json, Value};

use crate::models::{CatalogEntry, ChatMessage, ChatResponse, Draft, Item};

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

fn system_prompt(lang: &str, currency: &str, catalog: &[CatalogEntry]) -> String {
    let catalog = if catalog.is_empty() {
        "(none yet — this is a new seller)".to_string()
    } else {
        catalog
            .iter()
            .map(|c| format!("- {} — usual price {:.2} {} each", c.name, c.unit_cents as f64 / 100.0, c.currency))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        r#"You are "Easy", the assistant inside a payment-link app for tiny businesses (home bakers, crafters, street food).
The owner tells you, by text or voice, what a customer is buying. You build a clean itemized receipt, then the app turns it into a payment link.
You are proactive: a receipt with a wrong or guessed price is worse than asking one quick question.

Reply ONLY with one JSON object (no markdown, no code fences):
{{"reply": "<message to the owner, in {lang}>",
  "choices": ["<tap-to-answer option>", ...],
  "draft": null | {{"items": [{{"name": "<as shown on the receipt>", "product": "<catalog name>", "quantity": <int>, "total": <number, price of the WHOLE line>}}],
                   "currency": "<ISO 4217>", "note": "<short note for the customer or empty>", "customer": "<customer name or empty>"}}}}

DECIDE: every item must have a certain price before you return a draft.
1. Price clearly given per item → return the draft.
2. "2 breads for 20" → quantity 2, total 20 (the price is for the line). "2 breads at 10 each" / "10 cada" → total 20.
3. Several different items share ONE price ("a pizza and a coke for 80") → draft null. Ask if they want to tell each price or keep one line.
   If the catalog's usual prices sum exactly to that total, offer that split as the first choice (e.g. "Pizza 70 + Coke 10").
   If they pick "together", return ONE line named like "Pizza + Coke", quantity 1.
4. An item has no price:
   - it's in the catalog → use its usual price, and say so in the reply ("I used your usual price, 12").
   - otherwise → draft null, ask its price. You may list the items you already understood in the reply.
5. Unclear quantity or item ("some cookies") → ask how many (draft null).
6. The owner corrects something → return the FULL updated draft.
7. Greeting, thanks or off-topic → one warm sentence, then ask what they sold (draft null, no choices needed).

QUESTIONS: ask ONE short question at a time and always give 2-3 "choices" written as the owner's answer (max 6 words, in {lang}),
e.g. ["Pizza 70 + Coke 10", "Keep them together", "I'll type the prices"]. Never ask something the catalog already answers.

PRODUCTS (the app learns the owner's catalog from you):
- "product": if it's the same thing as a catalog product (synonym, abbreviation, singular/plural, typo, other language) use the catalog name EXACTLY;
  else a short clean generic name: singular, capitalized, keep size/flavor ("Jam 500g", "Chocolate cake").
- "name": what the customer reads — the owner's wording, nicely capitalized, with size/flavor.

OTHER:
- Currency: as mentioned (reais=BRL, dollars=USD, euros=EUR, pesos=MXN unless clear, yuan=CNY, rupees=INR), otherwise {currency}. Prices like "14,50" mean 14.50.
- "for Joana" / "pra Joana" → "customer": "Joana".
- With a draft, the reply is a short confirmation like "Here's the receipt, total 34. Is it right?" and "choices" is [] (the app shows buttons).
- Tone: warm, simple words, no jargon, at most 2 short sentences. The owner may be 60 years old and not tech savvy.

EXAMPLES (replies shown in English; always answer in {lang}):
Owner: "2 sourdough breads for 30 and a jam for 12"
→ {{"reply":"Here's the receipt, total 42. Is it right?","choices":[],"draft":{{"items":[{{"name":"Sourdough bread","product":"Sourdough bread","quantity":2,"total":30}},{{"name":"Jam","product":"Jam","quantity":1,"total":12}}],"currency":"{currency}","note":"","customer":""}}}}
Owner: "a pizza and a coke for 80"
→ {{"reply":"Got it, 80 in total. Do you want a price for each or one line for both?","choices":["I'll say each price","Keep them together"],"draft":null}}
Owner: "3 brigadeiros and a cake"
→ {{"reply":"How much is each? Tell me the price of the brigadeiros and of the cake.","choices":["Brigadeiros 2 each, cake 40","Brigadeiros 6, cake 40"],"draft":null}}

OWNER'S CATALOG
{catalog}"#,
        lang = lang_name(lang),
    )
}

impl Ai {
    pub fn from_env() -> Self {
        let key = std::env::var("OPENROUTER_API_KEY").ok().filter(|k| !k.trim().is_empty());
        Self {
            http: reqwest::Client::new(),
            key,
            // Smart enough to ask good questions, still fractions of a cent per message.
            model: std::env::var("OPENROUTER_MODEL")
                .ok()
                .filter(|m| !m.trim().is_empty())
                .unwrap_or_else(|| "google/gemini-2.5-flash".into()),
            audio_model: std::env::var("OPENROUTER_AUDIO_MODEL")
                .ok()
                .filter(|m| !m.trim().is_empty())
                .unwrap_or_else(|| "google/gemini-2.5-flash-lite".into()),
        }
    }

    pub fn enabled(&self) -> bool {
        self.key.is_some()
    }

    async fn complete(&self, model: &str, messages: Value, json_mode: bool) -> Result<String> {
        let key = self.key.as_ref().ok_or_else(|| anyhow!("no api key"))?;
        let mut body = json!({ "model": model, "messages": messages, "temperature": 0.3 });
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

    pub async fn chat(
        &self,
        history: &[ChatMessage],
        lang: &str,
        currency: &str,
        catalog: &[CatalogEntry],
    ) -> ChatResponse {
        if !self.enabled() {
            return local_parse(history, currency, lang);
        }
        let messages = self.chat_messages(history, lang, currency, catalog);
        match self.complete(&self.model, messages, true).await {
            Ok(text) => parse_model_output(&text, currency).unwrap_or_else(|| {
                tracing::warn!("could not parse model output: {text}");
                local_parse(history, currency, lang)
            }),
            Err(e) => {
                tracing::error!("openrouter error: {e:#}");
                local_parse(history, currency, lang)
            }
        }
    }

    /// Like [`Ai::chat`], but streams the model's answer: `on_reply` receives each new
    /// piece of the `reply` text as the tokens arrive, before the full JSON is complete.
    pub async fn chat_stream(
        &self,
        history: &[ChatMessage],
        lang: &str,
        currency: &str,
        catalog: &[CatalogEntry],
        on_reply: impl Fn(&str),
    ) -> ChatResponse {
        if !self.enabled() {
            return local_parse(history, currency, lang);
        }
        let messages = self.chat_messages(history, lang, currency, catalog);
        match self.complete_stream(&self.model, messages, &on_reply).await {
            Ok(text) => parse_model_output(&text, currency).unwrap_or_else(|| {
                tracing::warn!("could not parse model output: {text}");
                local_parse(history, currency, lang)
            }),
            Err(e) => {
                tracing::error!("openrouter stream error: {e:#}");
                local_parse(history, currency, lang)
            }
        }
    }

    fn chat_messages(&self, history: &[ChatMessage], lang: &str, currency: &str, catalog: &[CatalogEntry]) -> Value {
        let mut messages = vec![json!({ "role": "system", "content": system_prompt(lang, currency, catalog) })];
        // Keep the conversation short: last 12 turns is plenty for corrections.
        let start = history.len().saturating_sub(12);
        for m in &history[start..] {
            let role = if m.role == "assistant" { "assistant" } else { "user" };
            messages.push(json!({ "role": role, "content": m.content }));
        }
        Value::Array(messages)
    }

    /// Reads OpenRouter's server-sent events and returns the whole content at the end.
    async fn complete_stream(&self, model: &str, messages: Value, on_reply: &impl Fn(&str)) -> Result<String> {
        let key = self.key.as_ref().ok_or_else(|| anyhow!("no api key"))?;
        let body = json!({
            "model": model,
            "messages": messages,
            "temperature": 0.3,
            "stream": true,
            "response_format": { "type": "json_object" },
        });
        let mut res = self
            .http
            .post(URL)
            .bearer_auth(key)
            .header("X-Title", "Easy Pay")
            .json(&body)
            .send()
            .await?
            .error_for_status()?;

        let mut buf: Vec<u8> = Vec::new();
        let mut content = String::new();
        let mut sent = 0; // bytes of the reply already handed to `on_reply`
        while let Some(chunk) = res.chunk().await? {
            buf.extend_from_slice(&chunk);
            while let Some(nl) = buf.iter().position(|&b| b == b'\n') {
                let line: Vec<u8> = buf.drain(..=nl).collect();
                let line = String::from_utf8_lossy(&line);
                // SSE: "data: {...}"; lines starting with ':' are keep-alive comments.
                let Some(data) = line.trim().strip_prefix("data:") else { continue };
                let data = data.trim();
                if data == "[DONE]" {
                    continue;
                }
                let Ok(v) = serde_json::from_str::<Value>(data) else { continue };
                if let Some(err) = v.get("error") {
                    return Err(anyhow!("stream error: {err}"));
                }
                if let Some(piece) = v["choices"][0]["delta"]["content"].as_str() {
                    content.push_str(piece);
                    let reply = partial_reply(&content);
                    if reply.len() > sent {
                        on_reply(&reply[sent..]);
                        sent = reply.len();
                    }
                }
            }
        }
        if content.is_empty() {
            return Err(anyhow!("empty stream"));
        }
        Ok(content)
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

    /// Short, practical tips generated from the merchant's aggregated sales data.
    pub async fn insights(&self, data: &Value, lang: &str) -> Result<Vec<String>> {
        let messages = json!([
            { "role": "system", "content": format!(
                "You are a friendly business coach for a very small, non-technical seller. Based ONLY on the sales data given, \
                 write 3 short, concrete, encouraging tips in {} (max 20 words each, simple words, one emoji at the start of each). \
                 Mention product names and weekdays when useful (weekdays index 0 = Sunday). Money values are in cents; show them \
                 as normal amounts with the currency. Reply ONLY with JSON: {{\"tips\": [\"...\", \"...\", \"...\"]}}",
                lang_name(lang)
            )},
            { "role": "user", "content": data.to_string() }
        ]);
        let text = self.complete(&self.model, messages, true).await?;
        let start = text.find('{').ok_or_else(|| anyhow!("no json"))?;
        let end = text.rfind('}').ok_or_else(|| anyhow!("no json"))?;
        let v: Value = serde_json::from_str(&text[start..=end])?;
        Ok(v["tips"]
            .as_array()
            .map(|a| a.iter().filter_map(|t| t.as_str().map(str::to_string)).take(4).collect())
            .unwrap_or_default())
    }
}

/// Decodes as much of the `"reply"` string as has arrived in a still-incomplete JSON object.
fn partial_reply(json: &str) -> String {
    let Some(key) = json.find("\"reply\"") else { return String::new() };
    let rest = json[key + 7..].trim_start();
    let Some(rest) = rest.strip_prefix(':') else { return String::new() };
    let Some(rest) = rest.trim_start().strip_prefix('"') else { return String::new() };
    let mut out = String::new();
    let mut chars = rest.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => break,
            '\\' => {
                let Some(e) = chars.next() else { break };
                match e {
                    'n' => out.push('\n'),
                    't' => out.push('\t'),
                    'r' => {}
                    'u' => {
                        let Some(hi) = hex4(&mut chars) else { break }; // escape not complete yet
                        let code = if (0xD800..0xDC00).contains(&hi) {
                            // Surrogate pair (emoji): needs the following \uXXXX too.
                            if chars.next() != Some('\\') || chars.next() != Some('u') {
                                break;
                            }
                            let Some(lo) = hex4(&mut chars) else { break };
                            0x10000 + ((hi - 0xD800) << 10) + (lo.wrapping_sub(0xDC00) & 0x3FF)
                        } else {
                            hi
                        };
                        match char::from_u32(code) {
                            Some(ch) => out.push(ch),
                            None => break,
                        }
                    }
                    other => out.push(other),
                }
            }
            c => out.push(c),
        }
    }
    out
}

fn hex4(chars: &mut std::str::Chars) -> Option<u32> {
    let hex: String = chars.by_ref().take(4).collect();
    if hex.len() < 4 {
        return None;
    }
    u32::from_str_radix(&hex, 16).ok()
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
                    product: it["product"].as_str().map(str::to_string),
                    product_id: None,
                })
            })
            .collect();
        Draft {
            items,
            currency: d["currency"].as_str().unwrap_or(default_currency).to_string(),
            note: d["note"].as_str().unwrap_or("").to_string(),
            customer: d["customer"].as_str().unwrap_or("").to_string(),
            customer_id: None,
        }
        .sanitize()
    });
    // Buttons only make sense for questions; a draft has its own buttons.
    let choices = if draft.is_some() {
        Vec::new()
    } else {
        v["choices"]
            .as_array()
            .map(|a| a.iter().filter_map(|c| c.as_str()).map(|c| c.chars().take(60).collect()).take(3).collect())
            .unwrap_or_default()
    };
    Some(ChatResponse { reply, draft, choices })
}

/// Canned replies for the offline parser.
fn canned(lang: &str, key: &str) -> &'static str {
    match (key, lang) {
        ("ok", "es") => "¡Aquí está! ¿Está bien?",
        ("ok", "pt") => "Aqui está! Está certo?",
        ("ok", "zh") => "好了！对吗？",
        ("ok", "hi") => "यह रहा! क्या यह सही है?",
        ("ok", "ar") => "ها هو! هل هذا صحيح؟",
        ("ok", "fr") => "Voilà ! C'est correct ?",
        ("ok", _) => "Here it is! Is it right?",
        ("together", "es") => "Puse esos productos juntos en una línea. ¿Está bien?",
        ("together", "pt") => "Coloquei esses produtos juntos em uma linha. Está certo?",
        ("together", "zh") => "我把这些商品放在同一行了。对吗？",
        ("together", "hi") => "मैंने इन चीज़ों को एक ही लाइन में रखा है। क्या यह सही है?",
        ("together", "ar") => "وضعت هذه المنتجات معًا في سطر واحد. هل هذا صحيح؟",
        ("together", "fr") => "J'ai mis ces produits ensemble sur une ligne. C'est correct ?",
        ("together", _) => "I put those products together on one line. Is it right?",
        (_, "es") => "Dime qué vendiste y el precio. Ejemplo: 2 panes por 20",
        (_, "pt") => "Me diga o que vendeu e o preço. Exemplo: 2 pães por 20",
        (_, "zh") => "告诉我你卖了什么、多少钱。例如：2个面包 20元",
        (_, "hi") => "बताइए आपने क्या बेचा और कितने में। जैसे: 2 ब्रेड 20 में",
        (_, "ar") => "أخبرني ماذا بعت وبكم. مثال: 2 خبز بـ 20",
        (_, "fr") => "Dites-moi ce que vous avez vendu et le prix. Exemple : 2 pains pour 20",
        _ => "Tell me what you sold and the price. Example: 2 breads for 20",
    }
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    chars.next().map(|c| c.to_uppercase().collect::<String>()).unwrap_or_default() + chars.as_str()
}

/// Tiny offline parser: "500g jam for 14 and 2 breads for 20".
/// Products without their own price ("a pizza and a coke for 80") are joined into one line.
fn local_parse(history: &[ChatMessage], default_currency: &str, lang: &str) -> ChatResponse {
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

    let splitter = Regex::new(r"(?i)\s+(?:and|e|y|et|und|com|with|con)\s+|[,;+\n]|\s&\s").unwrap();
    let cur = r"(?:reais|real|dollars?|d[oó]lares|euros?|pesos|bucks)\b";
    let price_re = Regex::new(&format!(
        r"(?i)(?:\b(?:for|por|a|at|para|pour|=)\s*|r\$\s*|\$\s*|€\s*)(\d+(?:[.,]\d{{1,2}})?)(?:\s*{cur})?|(\d+(?:[.,]\d{{1,2}})?)\s*{cur}"
    ))
    .unwrap();
    let qty_re = Regex::new(r"^\s*(\d+)\s+(?:x\s+)?([^\d].*)$").unwrap();
    let filler = Regex::new(
        r"(?i)^(?:i\s+)?(?:need|want|make|create|gera|gerar|preciso\s+de|quero|necesito|un|uma?|a|an|one|link|de|pagamento|payment|pago|para|pra|for|of)\b\s*",
    )
    .unwrap();

    let clean = |raw: &str| -> (u32, String) {
        let mut name = raw.to_string();
        for _ in 0..12 {
            name = filler.replace(name.trim(), "").to_string();
        }
        let mut quantity = 1;
        if let Some(q) = qty_re.captures(&name) {
            quantity = q[1].parse().unwrap_or(1);
            name = q[2].to_string();
        }
        (quantity, capitalize(name.trim().trim_end_matches(['.', ':', '-']).trim()))
    };

    let mut items = Vec::new();
    let mut pending: Vec<String> = Vec::new();
    let mut grouped = false;
    for seg in splitter.split(text) {
        let Some(cap) = price_re.captures(seg) else {
            let (_, name) = clean(seg);
            if !name.is_empty() {
                pending.push(name);
            }
            continue;
        };
        let num = cap.get(1).or_else(|| cap.get(2)).unwrap().as_str().replace(',', ".");
        let Ok(price) = num.parse::<f64>() else { continue };
        let whole = cap.get(0).unwrap();
        let (mut quantity, mut name) = clean(&format!("{} {}", &seg[..whole.start()], &seg[whole.end()..]));
        if !pending.is_empty() {
            pending.push(name);
            name = pending.drain(..).filter(|n| !n.is_empty()).collect::<Vec<_>>().join(" + ");
            quantity = 1;
            grouped = true;
        }
        if name.is_empty() {
            continue;
        }
        items.push(Item { name, quantity, total_cents: (price * 100.0).round() as i64, product: None, product_id: None });
    }

    let draft = Draft { items, currency: currency.into(), note: String::new(), customer: String::new(), customer_id: None }.sanitize();
    let reply = match (&draft, grouped) {
        (Some(_), true) => canned(lang, "together"),
        (Some(_), false) => canned(lang, "ok"),
        _ => canned(lang, "ask"),
    };
    ChatResponse { reply: reply.into(), draft, choices: Vec::new() }
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
        let r = local_parse(&h, "USD", "pt");
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

    #[test]
    fn groups_items_sharing_one_price() {
        let h = vec![ChatMessage { role: "user".into(), content: "uma pizza e uma coca por 80".into() }];
        let d = local_parse(&h, "BRL", "pt").draft.unwrap();
        assert_eq!(d.items.len(), 1);
        assert_eq!(d.items[0].name, "Pizza + Coca");
        assert_eq!(d.items[0].total_cents, 8000);
    }

    #[test]
    fn choices_only_without_draft() {
        let r = parse_model_output(r#"{"reply":"Price of each?","choices":["Together","Each price"],"draft":null}"#, "USD").unwrap();
        assert_eq!(r.choices.len(), 2);
    }
}

#[cfg(test)]
mod stream_tests {
    use super::partial_reply;

    #[test]
    fn reads_reply_while_json_is_incomplete() {
        assert_eq!(partial_reply(""), "");
        assert_eq!(partial_reply("{\"reply\": \"Here"), "Here");
        assert_eq!(partial_reply("{\"reply\":\"Oi, \\\"tudo\\\" bem"), "Oi, \"tudo\" bem");
        assert_eq!(partial_reply("{\"reply\": \"Done.\", \"choices\": [\"x\"]"), "Done.");
        // Incomplete escapes wait for the rest.
        assert_eq!(partial_reply("{\"reply\": \"a\\u00"), "a");
        assert_eq!(partial_reply("{\"reply\": \"a\\u00e9"), "aé");
        assert_eq!(partial_reply("{\"reply\": \"\\ud83d"), "");
        assert_eq!(partial_reply("{\"reply\": \"\\ud83d\\ude00!"), "😀!");
    }
}
