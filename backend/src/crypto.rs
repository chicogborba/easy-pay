//! Encrypts secrets at rest (sellers' Mercado Pago tokens) with AES-256-GCM.
//! Key: SHA-256 of SECRETS_KEY (set a long random value in production).

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use sha2::{Digest, Sha256};

fn cipher() -> Aes256Gcm {
    let secret = std::env::var("SECRETS_KEY").unwrap_or_else(|_| {
        tracing::warn!("SECRETS_KEY not set: using a development key");
        "easy-pay-development-key".into()
    });
    Aes256Gcm::new_from_slice(&Sha256::digest(secret.as_bytes())).expect("32-byte key")
}

/// "v1:" + base64(nonce || ciphertext)
pub fn encrypt(plain: &str) -> Result<String> {
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let ct = cipher().encrypt(Nonce::from_slice(&nonce), plain.as_bytes()).map_err(|_| anyhow!("encrypt"))?;
    let mut out = nonce.to_vec();
    out.extend(ct);
    Ok(format!("v1:{}", B64.encode(out)))
}

pub fn decrypt(stored: &str) -> Result<String> {
    let raw = B64.decode(stored.strip_prefix("v1:").ok_or_else(|| anyhow!("unknown format"))?)?;
    if raw.len() < 13 {
        return Err(anyhow!("too short"));
    }
    let (nonce, ct) = raw.split_at(12);
    let plain = cipher().decrypt(Nonce::from_slice(nonce), ct).map_err(|_| anyhow!("decrypt"))?;
    Ok(String::from_utf8(plain)?)
}

#[cfg(test)]
mod tests {
    #[test]
    fn roundtrip() {
        let e = super::encrypt("APP_USR-123").unwrap();
        assert_ne!(e, "APP_USR-123");
        assert_eq!(super::decrypt(&e).unwrap(), "APP_USR-123");
        assert!(super::decrypt("v1:AAAA").is_err());
    }
}
