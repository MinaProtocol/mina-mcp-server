# Trustless verification demo

Shows the two verification tools doing what no GraphQL query can: proving chain
state with cryptography instead of trusting the endpoint.

```
npm run demo:honesty
```

Three acts, all through the real MCP server + tools (in-memory transport), exactly as
an agent would call them:

1. **`verify_chain_tip`** against live **devnet** → `VERIFIED ✓`. It downloads the
   canonical precomputed block and checks its Pickles/kimchi SNARK proof; a valid proof
   attests the entire chain back to genesis. No trust in the daemon or the block bucket.

2. **`check_endpoint_honesty`** against the **honest** devnet daemon → `HONEST ✓`. Every
   field the daemon reports matches what the proof attests.

3. **`check_endpoint_honesty`** against a **dishonest endpoint** → `DISHONEST ✗`. The
   demo starts a tampering proxy (`demo/tampering-proxy.mts`) that forwards to the real
   devnet daemon but **lies about the staged-ledger hash**. The tool verifies the
   canonical block's proof, compares, and catches the lie — naming the exact field.

Expect each act to take **tens of seconds** (so ~2–3 min total): each runs a real
zero-knowledge proof verification, single-threaded. The wait is the point — it's
verifying, not trusting.

## Requirements

The proof verifier is the optional `mina-verify-wasm` WebAssembly package. Until it and
the SDK verify API are published, wire the local builds:

```bash
./demo/setup-local.sh      # builds + links sibling mina-verify / mina-sdk-js checkouts
npm run demo:honesty
```

`setup-local.sh` expects the sibling repos at `../../mina-verify` (with the
`mina-verify-wasm` crate built) and `../mina-sdk-js`. In production none of this is
needed once both packages are published.

## Presenting it

[`sample-output.txt`](sample-output.txt) is a captured run, if you'd rather show the
result than wait ~2.5 min for two live proof checks.

Talking points:

- **The problem.** Today an exchange, wallet, or agent reading a Mina node has to *trust*
  the node. A compromised or buggy endpoint can report a wrong balance / ledger and the
  client can't tell.
- **What act 1 shows.** `verify_chain_tip` doesn't ask the node "are you honest?" — it
  checks the chain's **SNARK proof** itself. One ~22 KB recursive proof attests the entire
  history to genesis. That's Mina's superpower: a phone-sized client can verify the whole
  chain.
- **What act 2 shows.** We put a lying proxy in front of the real node. A trusting client
  sees a normal response. `check_endpoint_honesty` verifies the canonical block's proof
  and **catches the lie**, naming the field. Trust in the data source drops to zero.
- **Why it matters for agents.** An MCP-driven AI can now make this a reflex: verify before
  acting on chain data, and refuse endpoints that don't check out.

Caveat to mention: verification is single-threaded today (~tens of seconds); a threaded
backend is the planned perf follow-up. Correctness is done; speed is an optimization.
