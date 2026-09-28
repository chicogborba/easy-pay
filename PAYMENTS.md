# Payments, fees and emails — going live

Easy Pay picks the payment provider by the seller's country:

| Seller country | Provider | Customers pay with | Money goes to |
|---|---|---|---|
| 🇧🇷 Brazil | **Mercado Pago** (Checkout Pro, OAuth marketplace) | Pix, card, boleto | seller's Mercado Pago account |
| 🇺🇸 US and everyone else | **Stripe** (Checkout + Connect Express) | card, Apple Pay, Google Pay (+ local methods you enable) | seller's bank via Stripe |

If a provider has no credentials, its sellers run in **demo mode** (simulated payments) — the app always works.

**Your revenue**: `PLATFORM_FEE_BPS` (300 = 3%) is kept on every paid sale — Mercado Pago `marketplace_fee`,
Stripe `application_fee_amount`. You can give any seller a custom fee in **/admin → Accounts → seller**.
The fee is stored on each link (`platform_fee_cents`), so the admin panel shows exactly what you earned per seller.
Demo payments record the fee too, so you can see the numbers before going live.

Code: `backend/src/payments.rs` (Stripe + provider choice), `backend/src/mercadopago.rs`, `backend/src/checkout.rs`
(checkout, payout connection, webhooks), `backend/src/crypto.rs` (token encryption).

---

## 1. Mercado Pago (Brazil)

1. Log in at <https://www.mercadopago.com.br/developers/panel> with **your** (platform) account → **Criar aplicação**.
   - Solution: *Pagamentos online* → *Checkout Pro*. Model: **Marketplace**.
2. In the app → **Edit** → **Redirect URL**: `https://YOUR_DOMAIN/api/oauth/mercadopago/callback`
3. **Webhooks** (Suas integrações → Webhooks): URL `https://YOUR_DOMAIN/api/webhooks/mercadopago`, event **Pagamentos**.
   Copy the **secret signature**.
4. Production credentials → copy **Client ID** and **Client Secret**.
5. Env:
   ```
   MP_CLIENT_ID=...
   MP_CLIENT_SECRET=...
   MP_WEBHOOK_SECRET=...
   SECRETS_KEY=<openssl rand -hex 32>   # encrypts sellers' tokens — set once, never change
   PLATFORM_FEE_BPS=300                 # 3% for you (optional)
   MP_SANDBOX=true                      # while testing with test users; remove for production
   ```
6. Test: create **test users** (seller + buyer) in the developer panel. Log in to Easy Pay as a Brazilian seller →
   Settings → **Conectar Mercado Pago** → authorize with the test seller → create a link → pay with the test buyer
   (Pix / test card). The link turns *Paid* when the webhook arrives.

Notes: sellers' access tokens expire in ~6 months and are refreshed automatically. The webhook body is never
trusted — the payment is fetched from Mercado Pago with the seller's token and must match one of their links.

## 2. Stripe (US and other countries)

1. Stripe Dashboard → **Connect** → get started (platform, **Express** accounts).
2. Settings → Payment methods: enable Apple Pay, Google Pay, etc. (Apple Pay: add your domain).
3. Developers → Webhooks → endpoint `https://YOUR_DOMAIN/api/webhooks/stripe`, events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `account.updated`
   (**also listen to connected accounts**). Copy the signing secret.
4. Env:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
5. Test (test mode): log in as a US seller → Settings → **Connect with Stripe** → finish test onboarding →
   create a link → pay with `4242 4242 4242 4242`. Local: `stripe listen --forward-to localhost:8080/api/webhooks/stripe`.

## 3. Emails (verification, password reset)

Create a key at <https://resend.com> and verify your domain, then:
```
RESEND_API_KEY=re_...
EMAIL_FROM=Easy Pay <no-reply@yourdomain.com>
```
Without a key, emails are printed in the app logs (`docker compose logs app`), handy for testing.

## 4. Checklist before recommending it to real sellers

- [ ] `APP_URL` is your public HTTPS URL (docker-compose sets it from `DOMAIN`).
- [ ] `SECRETS_KEY` set (long random) and backed up.
- [ ] Provider credentials in **production** mode, webhooks pointing to production.
- [ ] One real low-value payment end to end per provider.
- [ ] Terms / Privacy (`/terms`, `/privacy`) reviewed by a lawyer (Brazil: LGPD).
- [ ] Database backups (e.g. daily `pg_dump` of the `pgdata` volume).
- [ ] Support contact (email/WhatsApp) shown to sellers.

**Not tested against the real Stripe / Mercado Pago APIs from this codebase yet** — request shapes follow their
docs; run the test steps above before going live.
