//! Seller profile: who they are and their business, validated per country.
//! Brazil needs a valid CPF (individual) or CNPJ (MEI/company); elsewhere the tax id is
//! optional because Stripe collects identity during onboarding.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ProfileInput {
    #[serde(default)]
    pub owner_name: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub country: String,
    #[serde(default)]
    pub business_name: String,
    /// individual | mei | company
    #[serde(default)]
    pub business_type: String,
    /// CPF / CNPJ in Brazil, optional tax id (EIN...) elsewhere. Digits only are kept.
    #[serde(default)]
    pub document: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub city: String,
    #[serde(default)]
    pub state: String,
}

#[derive(Debug, Clone)]
pub struct Profile {
    pub owner_name: String,
    pub phone: String,
    pub country: String,
    pub business_name: String,
    pub business_type: String,
    pub document: String,
    pub category: String,
    pub city: String,
    pub state: String,
}

fn clip(s: &str, n: usize) -> String {
    s.trim().chars().take(n).collect()
}

pub fn digits(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_digit()).collect()
}

/// Brazilian individual taxpayer id (11 digits, two check digits).
pub fn valid_cpf(s: &str) -> bool {
    let d: Vec<u32> = digits(s).chars().filter_map(|c| c.to_digit(10)).collect();
    if d.len() != 11 || d.iter().all(|&x| x == d[0]) {
        return false;
    }
    let check = |n: usize| {
        let sum: u32 = (0..n).map(|i| d[i] * (n as u32 + 1 - i as u32)).sum();
        let r = (sum * 10) % 11;
        if r == 10 { 0 } else { r }
    };
    check(9) == d[9] && check(10) == d[10]
}

/// Brazilian company id (14 digits, two check digits). MEIs have one too.
pub fn valid_cnpj(s: &str) -> bool {
    let d: Vec<u32> = digits(s).chars().filter_map(|c| c.to_digit(10)).collect();
    if d.len() != 14 || d.iter().all(|&x| x == d[0]) {
        return false;
    }
    let check = |n: usize| {
        let weights: Vec<u32> = if n == 12 { vec![5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] } else { vec![6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] };
        let sum: u32 = (0..n).map(|i| d[i] * weights[i]).sum();
        let r = sum % 11;
        if r < 2 { 0 } else { 11 - r }
    };
    check(12) == d[12] && check(13) == d[13]
}

pub const CATEGORIES: &[&str] = &["food", "crafts", "clothing", "beauty", "services", "other"];

impl ProfileInput {
    /// Validates and normalizes; the error is a short code the app translates.
    pub fn validate(&self) -> Result<Profile, &'static str> {
        let owner_name = clip(&self.owner_name, 80);
        if owner_name.chars().count() < 2 {
            return Err("invalid_owner_name");
        }
        let phone = clip(&self.phone, 30);
        if !(8..=15).contains(&digits(&phone).len()) {
            return Err("invalid_phone");
        }
        let country = self.country.trim().to_uppercase();
        if country.len() != 2 || !country.chars().all(|c| c.is_ascii_uppercase()) {
            return Err("invalid_country");
        }
        let business_name = clip(&self.business_name, 60);
        if business_name.is_empty() {
            return Err("invalid_business_name");
        }
        let business_type = self.business_type.trim().to_lowercase();
        if !matches!(business_type.as_str(), "individual" | "mei" | "company") {
            return Err("invalid_business_type");
        }
        let document = digits(&self.document);
        if country == "BR" {
            let ok = if business_type == "individual" { valid_cpf(&document) } else { valid_cnpj(&document) };
            if !ok {
                return Err("invalid_document");
            }
        } else if document.len() > 20 {
            return Err("invalid_document");
        }
        let category = self.category.trim().to_lowercase();
        let category = if CATEGORIES.contains(&category.as_str()) { category } else { "other".into() };
        Ok(Profile {
            owner_name,
            phone,
            country,
            business_name,
            business_type,
            document,
            category,
            city: clip(&self.city, 60),
            state: clip(&self.state, 40),
        })
    }
}

/// Sensible default currency for a new seller.
pub fn currency_for_country(country: &str) -> &'static str {
    match country {
        "BR" => "BRL",
        "US" => "USD",
        "CA" => "CAD",
        "GB" => "GBP",
        "MX" => "MXN",
        "AR" => "ARS",
        "CO" => "COP",
        "IN" => "INR",
        "CN" => "CNY",
        "PT" | "ES" | "FR" | "DE" | "IT" | "NL" | "IE" | "BE" | "AT" => "EUR",
        _ => "USD",
    }
}

/// "123.***.***-09" style masking for admin screens.
pub fn mask_document(doc: &str) -> String {
    let n = doc.len();
    if n <= 4 {
        return "•".repeat(n);
    }
    format!("{}{}{}", &doc[..2], "•".repeat(n - 4), &doc[n - 2..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brazilian_documents() {
        assert!(valid_cpf("529.982.247-25"));
        assert!(!valid_cpf("529.982.247-24"));
        assert!(!valid_cpf("111.111.111-11"));
        assert!(valid_cnpj("11.222.333/0001-81"));
        assert!(!valid_cnpj("11.222.333/0001-80"));
    }

    fn input(country: &str, kind: &str, doc: &str) -> ProfileInput {
        ProfileInput {
            owner_name: "Maria Silva".into(),
            phone: "+55 11 91234-5678".into(),
            country: country.into(),
            business_name: "Doces da Maria".into(),
            business_type: kind.into(),
            document: doc.into(),
            category: "food".into(),
            ..Default::default()
        }
    }

    #[test]
    fn validates_per_country() {
        assert!(input("BR", "individual", "529.982.247-25").validate().is_ok());
        assert_eq!(input("BR", "individual", "123").validate().unwrap_err(), "invalid_document");
        assert!(input("BR", "mei", "11.222.333/0001-81").validate().is_ok());
        assert_eq!(input("BR", "mei", "529.982.247-25").validate().unwrap_err(), "invalid_document");
        // US: tax id optional (Stripe verifies identity).
        assert!(input("US", "individual", "").validate().is_ok());
        assert_eq!(mask_document("52998224725"), "52•••••••25");
    }
}
