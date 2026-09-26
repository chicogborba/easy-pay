# Easy Pay

Mobile-first web app for small sellers: describe the sale in a chat (text or voice) and get a payment link with an itemized receipt.

> "2 artisan breads for 20 and 500g of jam for 14" → receipt → **Send on WhatsApp**

- **Chat (New link)** – AI (OpenRouter) turns free text/voice into items + prices, asks for confirmation, creates the link.
- **My links** – history with status (Waiting / Paid / Cancelled), share, cancel.
- **My money** – week/today/30-day totals, 7-day chart, best sellers.
- **Customer page** `/p/:id` – receipt + Apple Pay / Google Pay / Card. **Payments are mocked** (no real charge).
- Languages: English, 中文, हिन्दी, Español, العربية (RTL), Français, Português.
- Hand-drawn design system (Kalam / Patrick Hand, wobbly borders, hard shadows) — tokens in `frontend/tailwind.config.js`.

## Stack

| | |
|---|---|
| Backend | Rust · axum · SQLite (rusqlite) · reqwest → OpenRouter |
| Frontend | React · Vite · TypeScript · Tailwind · lucide-react |

## Run

```bash
# backend (http://localhost:8080)
cd backend
cp .env.example .env        # add OPENROUTER_API_KEY
cargo run

# frontend dev (http://localhost:5173, proxies /api → 8080)
cd frontend
npm install
npm run dev
```

Production: `npm run build` in `frontend/`, then `cargo run --release` serves `frontend/dist` and the API on the same port.

Without `OPENROUTER_API_KEY` the backend uses a simple offline parser and voice falls back to the browser's speech recognition (Chrome/Safari).

## Voice

The browser records audio, converts it to 16 kHz mono WAV, and `POST /api/transcribe` sends it to an audio-capable OpenRouter model (default `google/gemini-2.5-flash-lite`). The transcript is sent to the chat automatically.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/config` | `{ ai, voice }` |
| POST | `/api/chat` | `{ messages, lang, currency }` → `{ reply, draft }` |
| POST | `/api/transcribe` | `{ audio_base64, lang }` → `{ text }` |
| GET/POST | `/api/links` | merchant (`X-Merchant-Id` header) |
| GET | `/api/links/:id` | public |
| POST | `/api/links/:id/cancel` | merchant |
| POST | `/api/links/:id/pay` | public, **mock** `{ method: apple_pay \| google_pay \| card }` |
| GET | `/api/stats?currency=BRL&tz_offset=-180` | merchant |

POC auth: each device gets a random merchant id in `localStorage`.

## Next steps

- Replace the mock `pay_link` handler (`backend/src/main.rs`) with Stripe Checkout / Payment Element (Apple Pay & Google Pay come with it) + webhook to mark links paid.
- Real merchant accounts (login by phone/magic link).
