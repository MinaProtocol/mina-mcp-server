# Prompt cookbook

Worked examples you can paste into an MCP client once the Mina server is
connected. Each entry lists the **goal**, the **mode** it needs, a
copy-paste **prompt**, the **tool sequence** the model should run, and the
**expected result**. They double as a regression corpus for the
LLM-friendliness work (#27).

The server also ships these as a machine-readable library: `list_examples`
shows what's runnable in the current mode, and `get_example` returns the exact
tool steps for one.

> In any new session, start with **"Describe the current state"** —
> `describe_state` orients the model (sync status, network, mempool, mode) and
> returns `hints[]` that steer the follow-up calls.

---

## 1. Devnet payment: dry-run → commit → poll

- **Goal:** send MINA on a public network, but inspect the signed transaction before it goes out.
- **Mode:** `live` + `--wallets` (live-write).
- **Prompt:** *"Using my `warm` wallet, do a dry run of sending 1 MINA to `B62q…`. If it looks right, submit it and then poll until it's included."*
- **Tools:** `list_wallets` → `send_payment` (`dry_run: true`) → `send_payment` → `get_transaction_status`
- **Expected:** a signed payload (sender, amount, fee, nonce) from the dry run; then a tx id/hash on submit; then `get_transaction_status` transitions `PENDING` → `INCLUDED`. A fee/amount above a wallet cap is refused *before* signing.

## 2. Tutorial faucet lifecycle

- **Goal:** end-to-end payment between two throwaway funded accounts.
- **Mode:** `tutorial`.
- **Prompt:** *"Grab two test accounts, send 1 MINA from the first to the second, confirm it's included, then release everything."*
- **Tools:** `faucet` → `faucet` → `send_payment` → `get_transaction_status` → `reset_session`
- **Expected:** two `B62q…` accounts (1550 MINA each); a payment id; status reaching `INCLUDED` (~one lightnet block); `reset_session` releases the acquired accounts.

## 3. Multi-wallet orientation

- **Goal:** see every loaded wallet's balance and nonce at a glance.
- **Mode:** `live` + `--wallets` (live-write).
- **Prompt:** *"Describe the state, then list my wallets with their balances and nonces."*
- **Tools:** `describe_state` → `list_wallets`
- **Expected:** the network snapshot, then one row per wallet (alias, publicKey, balance, nonce). **Private keys never appear.**

## 4. GraphQL vs Rosetta cross-validation

- **Goal:** confirm the native and Rosetta views of the same data agree.
- **Mode:** `live`.
- **Prompt:** *"Look up account `B62q…` two ways — the native `get_account` and the Rosetta `rosetta_account` — and tell me whether the balances match."*
- **Tools:** `get_account` + `rosetta_account` (optionally `get_block` + `rosetta_block` for a block).
- **Expected:** both report the same balance (native in a `balance.total` field, Rosetta in `balances[].value`); the model reconciles units (nanomina) and reports agreement.

## 5. Archive top accounts (SQL)

- **Goal:** ad-hoc analytics over historical chain data.
- **Mode:** `snapshot` (or `tutorial`).
- **Prompt:** *"Show me the archive schema, then the 10 accounts that received the most distinct payments."*
- **Tools:** `get_archive_schema` → `query_archive_sql`
- **Expected:** the table/column listing, then a 10-row result. Queries run with a read-only role and a statement timeout — writes or runaway scans are rejected.

## 6. zkApp event / action walk-through

- **Goal:** inspect a deployed zkApp's on-chain activity.
- **Mode:** `live` (public Archive-Node-API) or `tutorial`.
- **Prompt:** *"For zkApp `B62q…`, show its recent canonical events and actions and summarize what changed."*
- **Tools:** `get_events` → `get_actions`
- **Expected:** events/actions grouped by block, each with the emitting transaction; an empty list if the zkApp has no canonical activity yet (not an error).

## 7. Multi-network sync sanity check

- **Goal:** confirm the public endpoints are healthy across networks.
- **Mode:** `live` (run once per network, or use the hosted sandbox + local instances).
- **Prompt:** *"Is this network synced, and what's the current block height?"* (repeat on devnet, mainnet, mesa).
- **Tools:** `describe_state` (or `get_sync_status` + `get_network_state`).
- **Expected:** `SYNCED` with a plausible height on devnet/mainnet; on `mesa` the first hint is a `PREFLIGHT` warning and data should be treated as ephemeral.

## 8. Mempool watch grouped by source

- **Goal:** see what's pending right now, by sender.
- **Mode:** `tutorial` or `live`.
- **Prompt:** *"List the pending mempool transactions and group them by sender account."*
- **Tools:** `get_mempool`
- **Expected:** pending commands with from/to/amount/fee/nonce, grouped by `from`; an empty list once everything is mined (mempool shows only un-included txs).

## 9. Funding handoff flow

- **Goal:** fund a fresh account from a faucet account, then verify.
- **Mode:** `tutorial`.
- **Prompt:** *"Acquire a funded account and a new empty one, move 5 MINA over, wait for inclusion, then show the new account's balance."*
- **Tools:** `faucet` → `faucet` → `send_payment` → `get_transaction_status` → `get_account` → `return_account`
- **Expected:** the receiver's balance reflects the transfer after inclusion; `return_account` (or `reset_session`) releases the funded source.

## 10. Pre-deploy smoke across live networks

- **Goal:** one-shot health/readiness check before pointing automation at a network.
- **Mode:** `live`.
- **Prompt:** *"Run a quick smoke check: sync status, latest block, and genesis constants. Flag anything unexpected."*
- **Tools:** `describe_state` → `get_best_chain` (lite) → `get_genesis_constants`
- **Expected:** synced status, a short chain of recent block headers (use `get_block` with `detail` for transactions), and the network's fee/timing constants — enough to green-light or abort.
