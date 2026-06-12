# Trustless verification demo

Shows the two verification tools doing what no GraphQL query can: proving chain
state with cryptography instead of trusting the endpoint.

```
npm run demo:honesty
```

Two acts, both through the real MCP server + tools (in-memory transport), exactly as
an agent would call them:

1. **`verify_chain_tip`** against live **devnet** → `VERIFIED ✓`. It downloads the
   canonical precomputed block and checks its Pickles/kimchi SNARK proof; a valid proof
   attests the entire chain back to genesis. No trust in the daemon or the block bucket.

2. **`check_endpoint_honesty`** against a **dishonest endpoint** → `DISHONEST ✗`. The
   demo starts a tampering proxy (`demo/tampering-proxy.mts`) that forwards to the real
   devnet daemon but **lies about the staged-ledger hash**. The tool verifies the
   canonical block's proof, compares, and catches the lie — naming the exact field.

Expect each act to take **tens of seconds**: it is running a real zero-knowledge proof
verification, single-threaded. The wait is the point — it's verifying, not trusting.

## Requirements

The proof verifier is the optional `mina-verify-wasm` WebAssembly package. Until it (and
`@o1-labs/mina-sdk` ≥ 0.4.0 with the verify API) are published, wire the local builds:

```bash
./demo/setup-local.sh      # builds + links the sibling mina-verify / mina-sdk-js checkouts
npm run demo:honesty
```

`setup-local.sh` expects the sibling repos at `../../mina-verify` (with the
`mina-verify-wasm` crate built) and `../mina-sdk-js`. In production none of this is
needed — `npm install mina-verify-wasm` is the whole setup.
