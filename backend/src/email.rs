//! Transactional email (verification, password reset) through Resend's HTTP API.
//! Without RESEND_API_KEY the email is written to the server log instead, so
//! development and demos work with no setup.

use serde_json::json;

#[derive(Clone)]
pub struct Mailer {
    http: reqwest::Client,
    key: Option<String>,
    from: String,
}

impl Mailer {
    pub fn from_env() -> Self {
        Self {
            http: reqwest::Client::new(),
            key: std::env::var("RESEND_API_KEY").ok().filter(|k| !k.trim().is_empty()),
            from: std::env::var("EMAIL_FROM").unwrap_or_else(|_| "Easy Pay <onboarding@resend.dev>".into()),
        }
    }

    /// Fire-and-forget: a slow or failing email provider never blocks the request.
    pub fn send(&self, to: &str, subject: &str, text: &str) {
        let Some(key) = self.key.clone() else {
            tracing::info!(to, subject, "email (not sent, RESEND_API_KEY unset):\n{text}");
            return;
        };
        let body = json!({ "from": self.from, "to": [to], "subject": subject, "text": text });
        let http = self.http.clone();
        let to = to.to_string();
        tokio::spawn(async move {
            let res = http.post("https://api.resend.com/emails").bearer_auth(key).json(&body).send().await;
            match res {
                Ok(r) if r.status().is_success() => {}
                Ok(r) => tracing::warn!(to, status = %r.status(), "email failed"),
                Err(e) => tracing::warn!(to, "email failed: {e}"),
            }
        });
    }
}

/// Short, friendly emails in the seller's language (English fallback).
pub fn verify_email(lang: &str, link: &str) -> (&'static str, String) {
    match lang {
        "pt" => ("Confirme seu e-mail no Easy Pay", format!("Olá!\n\nConfirme seu e-mail tocando no link:\n{link}\n\nSe não foi você, ignore esta mensagem.")),
        "es" => ("Confirma tu email en Easy Pay", format!("¡Hola!\n\nConfirma tu email tocando el link:\n{link}\n\nSi no fuiste tú, ignora este mensaje.")),
        _ => ("Confirm your email for Easy Pay", format!("Hi!\n\nConfirm your email by tapping this link:\n{link}\n\nIf this wasn't you, just ignore this message.")),
    }
}

pub fn reset_password(lang: &str, link: &str) -> (&'static str, String) {
    match lang {
        "pt" => ("Criar nova senha no Easy Pay", format!("Olá!\n\nPara criar uma nova senha, toque no link (vale por 1 hora):\n{link}\n\nSe não foi você, ignore esta mensagem.")),
        "es" => ("Crear nueva contraseña en Easy Pay", format!("¡Hola!\n\nPara crear una nueva contraseña, toca el link (vale 1 hora):\n{link}\n\nSi no fuiste tú, ignora este mensaje.")),
        _ => ("Reset your Easy Pay password", format!("Hi!\n\nTo choose a new password, tap this link (valid for 1 hour):\n{link}\n\nIf this wasn't you, just ignore this message.")),
    }
}
