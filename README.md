# Easy Pay

Mobile-first web app for small sellers: describe the sale in a chat (text or voice) and get a payment link with an itemized receipt.

> "2 artisan breads for 20 and 500g of jam for 14" → receipt → **Send on WhatsApp**

- **Landing page** `/welcome` – first-time visitors see it before onboarding: 3D hero (pointer/scroll-driven phone with a looping AI chat demo), how it works, what the AI does, 1.98% fee + calculator, FAQ (7 languages, `frontend/src/i18n/landing.ts`).
- **Chat (New link)** – AI (OpenRouter) turns free text/voice into items + prices, asks short follow-up questions with tap-to-answer buttons (e.g. "a pizza and a coke for 80" → price of each, or together?), reuses usual prices, captures the customer name, then creates the link.
- **Learns your products** – every line is linked to a product in the merchant's catalog. The AI receives the catalog and maps synonyms/plurals/other languages to the same product ("pão fermentado" = "Sourdough bread"); each wording is saved as an alias. Products can be renamed or merged manually.
- **My links** – history with status (Waiting / Paid / Cancelled), share, cancel.
- **My money** – week/today/30-day totals, AI tips, 7-day chart (tap a day → best sellers of that day), best sellers of 30 days.
- **My products** – ranking by period (7d / 30d / all), product page with 14-day chart, best weekday, aliases, rename/merge.
- **Customer page** `/p/:id` – receipt, then name + phone (email optional, no login; remembered on the customer's device), then Apple Pay / Google Pay / Card. **Payments are mocked** (no real charge).
- **Customers (CRM)** – everyone who paid, matched by phone: search, sort (recent / top spenders / A–Z), tags (VIP, New, Missing you), WhatsApp/call buttons, total spent, average ticket, favorite products, purchase history, private notes, "new link for …".
- Languages (English by default until the user picks one): English, 中文, हिन्दी, Español, العربية (RTL), Français, Português.
- Hand-drawn design system (Kalam / Patrick Hand, wobbly borders, hard shadows) — tokens in `frontend/tailwind.config.js`.

## Stack

| | |
|---|---|
| Backend | Rust · axum · PostgreSQL (sqlx) · reqwest → OpenRouter |
| Frontend | React · Vite · TypeScript · Tailwind · lucide-react |

## Run locally

```bash
# 1. Postgres (or point DATABASE_URL to any Postgres)
docker compose up -d

# 2. backend (http://localhost:8080) — creates the tables on start
cd backend
cp .env.example .env        # add OPENROUTER_API_KEY
cargo run

# 3. frontend dev (http://localhost:5173, proxies /api → 8080)
cd frontend
npm install
npm run dev
```

Without `OPENROUTER_API_KEY` the backend uses a simple offline parser and voice falls back to the browser's speech recognition (Chrome/Safari).

Tests: `cargo test`. Database tests run only when `TEST_DATABASE_URL` points to a Postgres.

## Deploy to Heroku

Heroku builds the root `Dockerfile` (frontend + backend in one image) via `heroku.yml`.
The app creates its tables on start, binds to `$PORT` and reads Heroku's `DATABASE_URL` (TLS on).

**Option A — button** (uses `app.json`: Basic dyno + Postgres Essential-0):

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/chicogborba/easy-pay)

> The button deploys the repo's default branch — merge this branch first.

**Option B — CLI:**

```bash
heroku login
heroku create my-easy-pay --stack container
heroku addons:create heroku-postgresql:essential-0
heroku config:set OPENROUTER_API_KEY=sk-or-...
git push heroku claude/intelligent-ride-621ios:main   # or main, once merged
heroku open
heroku logs --tail                                     # if something goes wrong
```

Notes:
- GitHub Student Pack credits cover a Basic dyno + Essential-0 Postgres. Eco dynos also work but sleep after 30 min idle (first request is slow).
- HTTPS comes for free on `*.herokuapp.com`, so the microphone works on phones.

## Voice

The browser records audio, converts it to 16 kHz mono WAV, and `POST /api/transcribe` sends it to an audio-capable OpenRouter model (default `google/gemini-2.5-flash-lite`; chat uses `google/gemini-2.5-flash`). The transcript is sent to the chat automatically.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/config` | `{ ai, voice }` |
| POST | `/api/chat` | `{ messages, lang, currency }` → `{ reply, draft }` |
| POST | `/api/transcribe` | `{ audio_base64, lang }` → `{ text }` |
| GET/POST | `/api/links` | merchant (`X-Merchant-Id` header) |
| GET | `/api/links/:id` | public (payer data only for the owner) |
| POST | `/api/links/:id/cancel` | merchant |
| POST | `/api/links/:id/pay` | public, **mock** `{ method: apple_pay \| google_pay \| card, name, phone, email? }` |
| GET | `/api/stats?currency=BRL&tz_offset=-180` | merchant |
| GET | `/api/products?currency=BRL&days=30` | merchant, ranking |
| GET | `/api/products/:id?currency=BRL` | merchant, detail |
| POST | `/api/products/:id/rename` · `/merge` | merchant `{ name }` · `{ into_id }` |
| POST | `/api/insights` | merchant, AI tips `{ lang, currency, tz_offset }` |
| GET | `/api/customers?currency=BRL` | merchant, CRM list |
| GET/POST | `/api/customers/:id` | merchant, detail / update `{ name?, note? }` |

POC auth: each device gets a random merchant id in `localStorage`.

## Next steps

- Replace the mock `pay_link` handler (`backend/src/main.rs`) with Stripe Checkout / Payment Element (Apple Pay & Google Pay come with it) + webhook to mark links paid.
- Real merchant accounts (login by phone/magic link).
