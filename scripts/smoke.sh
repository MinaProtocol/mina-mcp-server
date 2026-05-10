#!/usr/bin/env bash
# Read-only smoke test for the deployed MCP server.
# Asserts /health is OK, MCP initialize works, the expected tool surface
# is registered, and describe_state returns a live chain snapshot.
#
# No state-mutating calls (no faucet, no send_payment) so this is safe to
# run on a cron without polluting the shared lightnet.
#
# Env:
#   MCP_URL  default https://mina-mcp-sandbox.fly.dev/mcp
#
# Exit code: 0 on success, 1 on any check failing.

set -euo pipefail

MCP_URL="${MCP_URL:-https://mina-mcp-sandbox.fly.dev/mcp}"
HEALTH_URL="${MCP_URL%/mcp}/health"

PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

require() {
  local label="$1"; local cond="$2"
  if eval "$cond"; then pass "$label"; else fail "$label"; fi
}

contains() {
  echo "$1" | grep -qF "$2"
}

echo "=== Smoke test against $MCP_URL ==="

# 1. /health
echo "[health]"
HEALTH=$(curl -sS --max-time 30 "$HEALTH_URL" || echo "")
require "GET /health returns ok" 'contains "$HEALTH" "\"status\":\"ok\""'
require "GET /health reports tutorial mode" 'contains "$HEALTH" "\"mode\":\"tutorial\""'

# 2. MCP initialize
echo "[mcp initialize]"
INIT=$(curl -sS --max-time 30 -i -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.1"}}}' \
  || echo "")
SESSION=$(echo "$INIT" | grep -i '^mcp-session-id:' | head -1 | awk '{print $2}' | tr -d '\r')
require "initialize returns Mcp-Session-Id" '[ -n "$SESSION" ]'
require "initialize body advertises tutorial server" 'contains "$INIT" "mina-tutorial"'

# Trap to terminate session on exit so we don't leak it
cleanup() {
  if [ -n "${SESSION:-}" ]; then
    curl -sS --max-time 10 -X DELETE "$MCP_URL" -H "Mcp-Session-Id: $SESSION" >/dev/null || true
  fi
}
trap cleanup EXIT

# Notifications/initialized (required before tool calls)
curl -sS --max-time 10 -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null || true

# Helper: extract the SSE data line and return raw JSON
mcp_call() {
  curl -sS --max-time 30 -X POST "$MCP_URL" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Mcp-Session-Id: $SESSION" \
    -d "$1" | grep '^data: ' | head -1 | sed 's/^data: //'
}

# 3. tools/list — verify the expected surface
echo "[tools/list]"
TOOLS=$(mcp_call '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
for tool in faucet describe_state list_examples reset_session freeze_reset get_archive_schema send_payment; do
  require "tools/list contains $tool" 'contains "$TOOLS" "\"name\":\"$tool\""'
done

# 4. describe_state — live chain snapshot. The response is SSE-wrapped JSON
# with the result text as an escaped JSON string, so we check for substrings
# that don't depend on quote escaping.
echo "[describe_state]"
STATE=$(mcp_call '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"describe_state","arguments":{}}}')
require "describe_state mentions tutorial mode" 'contains "$STATE" "tutorial"'
require "describe_state mentions chain"         'contains "$STATE" "chain"'
require "describe_state mentions hints"         'contains "$STATE" "hints"'
require "describe_state mentions syncStatus"    'contains "$STATE" "syncStatus"'
# Daemon is alive if any sync state is reported
SYNC_OK=0
for s in SYNCED BOOTSTRAP CATCHUP OFFLINE; do
  if contains "$STATE" "$s"; then SYNC_OK=1; break; fi
done
require "describe_state reports a recognized syncStatus value" '[ "$SYNC_OK" = "1" ]'

echo ""
echo "=== $PASS passed, $FAIL failed ==="
[ "$FAIL" = "0" ]
