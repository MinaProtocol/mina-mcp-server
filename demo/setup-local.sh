#!/usr/bin/env bash
# Wire the local unpublished verification pieces into this MCP checkout so the
# demo runs before mina-verify-wasm and the SDK verify API are on npm.
#
# Expects sibling checkouts next to this repo:
#   ../mina-verify           (with crates/mina-verify-wasm)
#   ../mina-sdk-js           (the SDK, on the verify branch)
# Override with MINA_VERIFY_DIR / MINA_SDK_DIR if they live elsewhere.
#
# In production this whole script is unnecessary once the SDK verify API and
# `mina-verify-wasm` are published.
set -euo pipefail
cd "$(dirname "$0")/.."
MCP="$PWD"
VERIFY="${MINA_VERIFY_DIR:-$MCP/../mina-verify}"
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

# Copy (not `npm install`) the wasm package straight into node_modules while
# the npm package is unpublished. Base deps are assumed already present here.
echo ">> 4/4 place the wasm backend in node_modules"
WASM_DEST="$MCP/node_modules/mina-verify-wasm"
rm -rf "$WASM_DEST"; mkdir -p "$WASM_DEST"
cp -r "$WASM_PKG/." "$WASM_DEST/"

echo ">> done. run: npm run demo:honesty"
