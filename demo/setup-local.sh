#!/usr/bin/env bash
# Wire the local (unpublished) verification packages into this MCP checkout so the
# demo runs before mina-verify-wasm / @o1-labs/mina-sdk are on npm.
#
# Expects sibling checkouts:
#   ../../mina-verify        (with crates/mina-verify-wasm)
#   ../mina-sdk-js           (the SDK, on the verify branch)
#
# In production this whole script is unnecessary: `npm install mina-verify-wasm`.
set -euo pipefail
cd "$(dirname "$0")/.."
MCP="$PWD"
VERIFY="${MINA_VERIFY_DIR:-$MCP/../../mina-verify}"
SDK="${MINA_SDK_DIR:-$MCP/../mina-sdk-js}"
WASM_PKG="$VERIFY/crates/mina-verify-wasm/pkg"

echo ">> 1/4 build mina-verify-wasm (threaded wasm; needs nightly — see its build.sh)"
if [ ! -f "$WASM_PKG/mina_verify_wasm.js" ]; then
  ( cd "$VERIFY/crates/mina-verify-wasm" && ./build.sh nodejs )
else
  echo "   (pkg already built at $WASM_PKG — skipping)"
fi

echo ">> 2/4 build @o1-labs/mina-sdk (with the verify API)"
( cd "$SDK" && npm install --silent && npm run build --silent )

echo ">> 3/4 link the SDK build into this checkout"
DEST="$MCP/node_modules/@o1-labs/mina-sdk"
rm -rf "$DEST"; mkdir -p "$DEST"
TARBALL="$(cd "$SDK" && npm pack --silent)"
tar -xzf "$SDK/$TARBALL" -C "$DEST" --strip-components=1
rm -f "$SDK/$TARBALL"

echo ">> 4/4 install the wasm backend"
npm install --no-save "$WASM_PKG"

echo ">> done. run: npm run demo:honesty"
