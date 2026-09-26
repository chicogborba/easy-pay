# One image with the API and the built frontend. Used by Heroku (heroku.yml) and anywhere Docker runs.

# ---- frontend ----
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- backend ----
FROM rust:1-slim-bookworm AS api
WORKDIR /api
# Build dependencies first so code changes don't recompile every crate.
COPY backend/Cargo.toml backend/Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY backend/src ./src
RUN touch src/main.rs && cargo build --release

# ---- runtime ----
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home app
WORKDIR /app
COPY --from=api /api/target/release/easy-pay-backend ./easy-pay
COPY --from=web /web/dist ./static
ENV STATIC_DIR=/app/static \
    RUST_LOG=info
USER app
# Heroku sets $PORT; defaults to 8080 elsewhere.
CMD ["./easy-pay"]
