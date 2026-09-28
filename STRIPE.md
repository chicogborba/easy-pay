# Turning on real payments (Stripe)

Everything is already wired. Until `STRIPE_SECRET_KEY` is set the app runs in **demo mode**
(mock Apple Pay / Google Pay / card buttons, no money moves).

## How it works

- **Stripe Connect (Express)**: each seller connects their own Stripe account from
  *Settings → Receive payments*. Money goes straight to them; the platform can keep a fee.
- **Stripe Checkout**: the customer fills name + phone on `/p/:id`, taps *Pay*, and is sent to a
  Stripe-hosted page (Apple Pay, Google Pay, cards, Pix/boleto in Brazil — whatever you enable in Stripe).
- **Webhook** `POST /api/webhooks/stripe` confirms the payment (`checkout.session.completed`) and marks
  the link paid, creating/updating the customer. Signatures are verified (`Stripe-Signature`, 5-min tolerance).

Code: `backend/src/payments.rs` (API calls + signature check), handlers `checkout`, `stripe_onboard`,
`stripe_webhook` in `backend/src/main.rs`.

## Checklist

1. **Stripe account** → activate **Connect** (Dashboard → Connect → Get started), platform profile, Express accounts.
2. **Payment methods**: Settings → Payment methods → enable Apple Pay, Google Pay, Pix (BR), etc.
   For Apple Pay on your own domain: Settings → Payment methods → Apple Pay → add your domain.
3. **Webhook**: Developers → Webhooks → Add endpoint
   - URL: `https://YOUR_DOMAIN/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `account.updated`
   - **Listen to events on Connected accounts too** (for `account.updated`).
   - Copy the signing secret (`whsec_...`).
4. **Env vars** (VM `.env` or Heroku config):
   ```
   STRIPE_SECRET_KEY=sk_test_...        # start with test mode
   STRIPE_WEBHOOK_SECRET=whsec_...
   APP_URL=https://YOUR_DOMAIN          # docker-compose.prod.yml sets it from DOMAIN
   PLATFORM_FEE_BPS=300                 # optional: 3% for the platform
   STRIPE_REQUIRE_CONNECT=true          # default: sellers must finish onboarding before charging
   ```
5. Redeploy. `GET /api/config` should show `"payments":"stripe"`.
6. **Test (test mode)**: log in as a seller → Settings → *Connect with Stripe* → finish the test
   onboarding → create a link → pay it with card `4242 4242 4242 4242`. The link turns *Paid* after the webhook.
   Local testing: `stripe listen --forward-to localhost:8080/api/webhooks/stripe`.
7. Switch to live keys when ready.

## Notes / next steps

- Refunds and disputes: handle in the Stripe Dashboard for now (a `charge.refunded` webhook could set the
  link to `refunded`).
- `ALLOW_MOCK_PAYMENTS=true` keeps the demo buttons working even with Stripe on (don't use in production).
- Links store the Checkout Session id in `links.provider_ref` for support/reconciliation.
- **Not tested against the real Stripe API yet** — the request shapes follow Stripe's API docs; run step 6
  in test mode before going live.
