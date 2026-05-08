#!/usr/bin/env bash
# Bundled startup script for the fly.io image: launches the lightnet stack
# (postgres, mina daemon, archive-api, accounts-manager, nginx) in the
# background, waits for accounts-manager to come up, then execs the MCP
# server in the foreground so its exit triggers container shutdown.

set -euo pipefail

LIGHTNET_ENTRYPOINT="${LIGHTNET_ENTRYPOINT:-/root/spinup-testnet.sh}"
ACCOUNTS_MANAGER_PROBE="${ACCOUNTS_MANAGER_ENDPOINT:-http://localhost:8181}/list-acquired-accounts"
WAIT_TIMEOUT_SECS="${WAIT_TIMEOUT_SECS:-300}"

echo "[start-mcp] launching lightnet via ${LIGHTNET_ENTRYPOINT}"
"${LIGHTNET_ENTRYPOINT}" &
LIGHTNET_PID=$!

cleanup() {
  echo "[start-mcp] shutting down (lightnet pid=${LIGHTNET_PID})"
  kill "${LIGHTNET_PID}" 2>/dev/null || true
  wait "${LIGHTNET_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[start-mcp] waiting up to ${WAIT_TIMEOUT_SECS}s for accounts-manager (${ACCOUNTS_MANAGER_PROBE})"
deadline=$(( $(date +%s) + WAIT_TIMEOUT_SECS ))
until curl -fsS "${ACCOUNTS_MANAGER_PROBE}" >/dev/null 2>&1; do
  if [ "$(date +%s)" -ge "${deadline}" ]; then
    echo "[start-mcp] accounts-manager did not come up within ${WAIT_TIMEOUT_SECS}s; starting MCP anyway"
    break
  fi
  if ! kill -0 "${LIGHTNET_PID}" 2>/dev/null; then
    echo "[start-mcp] lightnet exited before accounts-manager came up"
    exit 1
  fi
  sleep 5
done

echo "[start-mcp] starting MCP server (mode=${MINA_MCP_MODE:-tutorial} transport=${MINA_MCP_TRANSPORT:-http} port=${MINA_MCP_HTTP_PORT:-3000})"
exec node /opt/mcp/dist/index.js
