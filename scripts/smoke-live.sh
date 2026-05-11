#!/usr/bin/env bash
# Read-only smoke test for live mode against a public Mina network.
#
# Spawns `node dist/index.js --mode live --network $NETWORK --transport http`
# on a free local port, then drives JSON-RPC over HTTP and asserts the
# expected tool surface + happy paths for a few representative tools
# including Rosetta. No state-mutating calls.
#
# Env:
#   NETWORK   one of devnet (default) / mainnet / mesa
#   PORT      local port to bind, default 13900
#
# Exit code: 0 on success, 1 on any check failing.

set -euo pipefail

NETWORK="${NETWORK:-devnet}"
PORT="${PORT:-13900}"
BASE_URL="http://127.0.0.1:${PORT}"
MCP_URL="${BASE_URL}/mcp"
HEALTH_URL="${BASE_URL}/health"

PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }
require() {
  local label="$1"; local cond="$2"
  if eval "$cond"; then pass "$label"; else fail "$label"; fi
}
contains() { echo "$1" | grep -qF "$2"; }

echo "=== Smoke test: live mode (network=$NETWORK, port=$PORT) ==="

# 1. Spawn the server. We send stderr to a log we can fish through on
# failure; stdout is the http server which doesn't speak to stdio.
LOG="$(mktemp -t mina-mcp-smoke-XXXXXX.log)"
MINA_MCP_HTTP_PORT="$PORT" node dist/index.js \
  --mode live --network "$NETWORK" --transport http \
  >/dev/null 2>"$LOG" &
SERVER_PID=$!

cleanup() {
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [ "$FAIL" != "0" ] && [ -s "$LOG" ]; then
    echo
    echo "--- server log tail ---"
    tail -40 "$LOG" || true
  fi
  rm -f "$LOG"
}
trap cleanup EXIT

# 2. Wait for /health (server boot + first connection probe is ~1s
# locally, but be generous in CI).
echo "[boot]"
HEALTH=""
for attempt in $(seq 1 30); do
  HEALTH=$(curl -sS --max-time 3 "$HEALTH_URL" 2>/dev/null || echo "")
  if contains "$HEALTH" "\"status\":\"ok\""; then
    echo "  server up after ${attempt} probe(s)"
    break
  fi
  sleep 1
done
require "GET /health returns ok"           'contains "$HEALTH" "\"status\":\"ok\""'
require "GET /health reports live mode"    'contains "$HEALTH" "\"mode\":\"live\""'

# 3. initialize → session id
echo "[mcp initialize]"
INIT=$(curl -sS --max-time 10 -i -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke-live","version":"0.0.1"}}}')
SESSION=$(echo "$INIT" | grep -i '^mcp-session-id:' | head -1 | awk '{print $2}' | tr -d '\r')
require "initialize returns Mcp-Session-Id" '[ -n "$SESSION" ]'
require "initialize body advertises live server name" 'contains "$INIT" "mina-live"'

# Notifications/initialized (required before tool calls)
curl -sS --max-time 5 -X POST "$MCP_URL" \
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

# 4. tools/list — verify live-mode surface (incl. Rosetta tools)
echo "[tools/list]"
TOOLS=$(mcp_call '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
for tool in \
  describe_state get_account get_block get_archive_blocks get_best_chain \
  get_sync_status get_mempool list_examples \
  rosetta_status rosetta_account rosetta_block rosetta_mempool rosetta_mempool_transaction
do
  require "tools/list contains $tool" 'contains "$TOOLS" "\"name\":\"$tool\""'
done
# Tools that must NOT be registered in live mode.
for tool in faucet send_payment query_archive_sql list_blocks freeze_reset; do
  require "tools/list does NOT contain $tool" '! contains "$TOOLS" "\"name\":\"$tool\""'
done

# 5. describe_state — live-flavoured snapshot
echo "[describe_state]"
STATE=$(mcp_call '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"describe_state","arguments":{}}}')
require "describe_state mode is live"      'contains "$STATE" "\\\"mode\\\": \\\"live\\\""'
require "describe_state reports network"   "contains \"\$STATE\" \"\\\\\\\"name\\\\\\\": \\\\\\\"$NETWORK\\\\\\\"\""
require "describe_state mentions Rosetta tool family in hints" 'contains "$STATE" "rosetta_status"'
SYNC_OK=0
for s in SYNCED BOOTSTRAP CATCHUP OFFLINE; do
  if contains "$STATE" "$s"; then SYNC_OK=1; break; fi
done
require "describe_state reports a recognized syncStatus value" '[ "$SYNC_OK" = "1" ]'

# Preflight networks (mesa today) must lead with a PREFLIGHT hint.
if [ "$NETWORK" = "mesa" ]; then
  require "mesa: hints[0] is the PREFLIGHT warning" 'contains "$STATE" "PREFLIGHT"'
fi

# 6. get_archive_blocks → extract a canonical stateHash → round-trip through get_block.
echo "[get_archive_blocks → get_block]"
BLOCKS=$(mcp_call '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_archive_blocks","arguments":{"canonical":true,"limit":5}}}')
require "get_archive_blocks returned content" 'contains "$BLOCKS" "stateHash"'
# Pull the first stateHash. The SSE payload escapes JSON quotes (\") so we
# match through the escape sequence.
STATE_HASH=$(echo "$BLOCKS" | grep -oE '\\"stateHash\\":\s*\\"3N[A-Za-z0-9]+\\"' | head -1 | sed -E 's/.*\\"stateHash\\":\s*\\"([^\\]+)\\".*/\1/')
require "extracted a 3N… stateHash from archive blocks" '[ -n "$STATE_HASH" ] && [ "${STATE_HASH:0:2}" = "3N" ]'

if [ -n "$STATE_HASH" ]; then
  BLOCK=$(mcp_call "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"get_block\",\"arguments\":{\"stateHash\":\"$STATE_HASH\"}}}")
  require "get_block round-trip returned the same stateHash" 'contains "$BLOCK" "$STATE_HASH"'
fi

# 7. rosetta_status — Data API round-trip.
echo "[rosetta_status]"
ROSETTA=$(mcp_call '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"rosetta_status","arguments":{}}}')
require "rosetta_status returned current_block_identifier" 'contains "$ROSETTA" "current_block_identifier"'
require "rosetta_status returned sync_status"               'contains "$ROSETTA" "sync_status"'

# 8. Tear down session explicitly (cleanup() also handles process kill).
curl -sS --max-time 5 -X DELETE "$MCP_URL" -H "Mcp-Session-Id: $SESSION" >/dev/null || true

echo
echo "=== $PASS passed, $FAIL failed (network=$NETWORK) ==="
[ "$FAIL" = "0" ]
