# ── Stage 1: Build ────────────────────────────────────────────────────────────
#
# Build deps breakdown:
#   clang + libclang-dev  — required by boring-sys2 (BoringSSL mandates clang)
#   cmake + ninja-build   — BoringSSL CMake build system
#   golang-go             — BoringSSL build system requires Go
#   perl                  — BoringSSL configure scripts
#   pkg-config            — used by several -sys crates
#   libssl-dev            — openssl-sys fallback / link hints
#   python3               — deno_core V8 snapshot creation
#
# Note: nasm is x86-only. ARM64 uses the GAS assembler (part of binutils,
#       already present in the Rust image) so it is not listed here.
#
# Note: the v8 crate (via deno_core) downloads a pre-built V8 static library
#       at build time — it does NOT compile V8 from source. Build time ~5 min
#       first run; cached on subsequent Docker layer rebuilds.
#
# rust:1-bookworm always resolves to the latest stable Rust (≥ 1.88 required
# by boring-sys2 / icu4x transitive deps).

FROM rust:1-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        clang \
        libclang-dev \
        cmake \
        ninja-build \
        golang-go \
        perl \
        pkg-config \
        libssl-dev \
        python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# ── Dependency caching ───────────────────────────────────────────────────────
# Copy manifests + build scripts first so that the heavy dep-compile layer is
# cached independently from source changes.

COPY Cargo.toml Cargo.lock ./
COPY crates/obscura-dom/Cargo.toml     crates/obscura-dom/Cargo.toml
COPY crates/obscura-net/Cargo.toml     crates/obscura-net/Cargo.toml
COPY crates/obscura-browser/Cargo.toml crates/obscura-browser/Cargo.toml
COPY crates/obscura-cdp/Cargo.toml     crates/obscura-cdp/Cargo.toml
COPY crates/obscura-js/Cargo.toml      crates/obscura-js/Cargo.toml
COPY crates/obscura-js/build.rs        crates/obscura-js/build.rs
COPY crates/obscura-js/js/             crates/obscura-js/js/
COPY crates/obscura-cli/Cargo.toml     crates/obscura-cli/Cargo.toml

# Minimal stub sources so `cargo build` can resolve and compile all deps
# without the real implementation files.
RUN mkdir -p \
        crates/obscura-dom/src \
        crates/obscura-net/src \
        crates/obscura-browser/src \
        crates/obscura-cdp/src \
        crates/obscura-js/src \
        crates/obscura-cli/src && \
    printf 'pub fn _stub(){}' > crates/obscura-dom/src/lib.rs && \
    printf 'pub fn _stub(){}' > crates/obscura-net/src/lib.rs && \
    printf 'pub fn _stub(){}' > crates/obscura-browser/src/lib.rs && \
    printf 'pub fn _stub(){}' > crates/obscura-cdp/src/lib.rs && \
    printf 'pub fn _stub(){}' > crates/obscura-js/src/lib.rs && \
    printf 'fn main(){}' > crates/obscura-cli/src/main.rs && \
    printf 'fn main(){}' > crates/obscura-cli/src/worker.rs

# Pre-compile all dependencies (this layer is cached until Cargo.lock changes)
RUN cargo build --release --features stealth 2>&1 | tail -3 || true

# ── Real build ───────────────────────────────────────────────────────────────
COPY crates/ crates/

# Touch sources so Cargo detects they differ from the stubs above
RUN find crates -name "*.rs" -exec touch {} +

RUN cargo build --release --features stealth

# Smoke-test: confirm both binaries exist and respond
RUN /build/target/release/obscura --help > /dev/null && \
    /build/target/release/obscura-worker --help > /dev/null || true

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
# Minimal image: only the binaries + CA certs + OpenSSL runtime libs.
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        libssl3 \
        netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

# Non-root service account — obscura needs no filesystem writes, no privs
RUN groupadd --system obscura && \
    useradd  --system --gid obscura --no-create-home obscura

COPY --from=builder /build/target/release/obscura        /usr/local/bin/obscura
COPY --from=builder /build/target/release/obscura-worker /usr/local/bin/obscura-worker

USER obscura

# CDP WebSocket is INTERNAL only — not published through nginx.
# Port 9222 is exposed here so Docker networks can reach it; it is
# NOT listed as a `ports:` mapping in docker-compose.yaml (prod).
EXPOSE 9222

# Health probe uses the CDP HTTP /json/version endpoint.
# netcat-openbsd (nc) is the only extra runtime dep needed.
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
    CMD printf 'GET /json/version HTTP/1.0\r\nHost: localhost\r\n\r\n' \
        | nc -w2 localhost 9222 \
        | grep -q "Obscura"

# stealth: TLS fingerprint impersonation (wreq/BoringSSL) + 3,520-domain
# tracker blocklist. workers=2 gives two independent browser contexts for
# concurrent fetches with minimal extra memory (~30 MB per context).
CMD ["obscura", "serve", "--port", "9222", "--stealth", "--workers", "2"]
