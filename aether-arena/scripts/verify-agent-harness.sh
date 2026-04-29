#!/usr/bin/env bash
# Smoke-check: Gateway /api/models (workspace chat uses same list), SearXNG, harness web_search tests.
# Web search in chat = LangGraph lead_agent → config.yaml `tools` → `aether-arena.community.searxng.tools:web_search_tool`.
#
# Usage from aether-arena/:
#   ./scripts/verify-agent-harness.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NGINX_URL="${NGINX_URL:-http://127.0.0.1:2026}"
SEARX_HOST="${SEARX_HOST:-http://127.0.0.1:2030}"

die() { echo "FAIL: $*" >&2; exit 1; }

echo "== SearXNG =="
code="$(curl -sS -o /dev/null -w '%{http_code}' "${SEARX_HOST}/healthz" || echo 000)"
[[ "$code" == "200" ]] || die "${SEARX_HOST}/healthz -> HTTP $code"

echo "== Gateway GET /api/models =="
mj="$(curl -sS "${NGINX_URL}/api/models" || true)"
if ! echo "$mj" | jq -e '.models | type == "array"' >/dev/null 2>&1; then
  echo "$mj" | head -c 400
  die "Not JSON from ${NGINX_URL}/api/models (if 502 after gateway fix: docker restart aether-arena-nginx)"
fi
n="$(echo "$mj" | jq '.models | length')"
[[ "${n:-0}" -ge 1 ]] || die "Empty models[]"

echo "== Harness pytest: web_search (SearXNG tool) =="
if docker exec aether-arena-gateway true 2>/dev/null; then
  docker exec aether-arena-gateway sh -c 'cd /app/backend && PYTHONPATH=. uv run pytest tests/test_searxng_tool.py -q'
elif command -v uv >/dev/null 2>&1; then
  cd "${ROOT}/backend"
  PYTHONPATH=. uv run pytest tests/test_searxng_tool.py -q
else
  echo "WARN: neither aether-arena-gateway nor uv available — skip pytest (install uv or run stack)."
fi

echo "OK."
echo "lead_agent loads tools from config.yaml (all groups when none filtered). Web: web_search→SearXNG (\$SEARXNG_URL), plus web_fetch/image_search if configured."
