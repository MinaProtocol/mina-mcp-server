# Prompt cookbook

Things you can ask an AI assistant once the Mina MCP server is connected. These
are natural-language prompts — the model picks the right tools. Each entry notes
the tools involved and the mode it needs.

The server also ships these as a runnable, machine-readable library: call
`list_examples` to see what's available in the current mode, and `get_example`
to fetch the exact tool steps for one.

> **Tip:** in any new session, start with *"Describe the current state"* —
> it calls `describe_state`, which orients the model (sync status, mempool,
> mode, network) and returns `hints[]` that steer follow-up calls.

## Live mode (public networks — no infra)

Run `npx @o1-labs/mina-mcp-server --mode live --network devnet`, or use the
hosted sandbox.

| Ask | Tools | Notes |
|---|---|---|
| "What's the balance and nonce of `B62q…`?" | `get_account` | Works on devnet/mainnet/mesa. |
| "Show me the top of the canonical chain." | `get_best_chain` | |
| "Get block at height 12345 / state hash `3N…`." | `get_block` | Exactly one of height or hash. |
| "Is the network synced? What's in the mempool?" | `get_sync_status`, `get_mempool` | |
| "List the last 5 canonical archive blocks, then open one." | `get_archive_blocks`, `get_block` | |
| "Show events / actions for zkApp `B62q…`." | `get_events`, `get_actions` | Archive-Node-API. |
| "Give me the Rosetta network status / block / account balance." | `rosetta_status`, `rosetta_block`, `rosetta_account` | Standardized Rosetta format. |
| "What pending tx is `Ckp5…`?" | `rosetta_mempool`, `rosetta_mempool_transaction` | |

## Tutorial mode (local lightnet — read + write)

Run `--mode tutorial` with the lightnet up (see [Prerequisites](../README.md#prerequisites)).

| Ask | Tools | Notes |
|---|---|---|
| "Send 1 MINA from a fresh test account to another and confirm it." | `faucet`, `send_payment`, `get_transaction_status` | Faucet gives 1550-MINA accounts. |
| "Submit a payment and show it in the mempool before it's mined." | `faucet`, `send_payment`, `get_mempool` | Run mempool read immediately. |
| "Send a payment, wait for inclusion, verify it in the archive DB." | `send_payment`, `get_transaction_status`, `query_archive_sql` | |
| "Delegate a faucet account's stake to `B62q…`." | `faucet`, `send_delegation` | |
| "Pause the periodic chain reset for an hour for a demo." | `freeze_reset`, `freeze_status`, `unfreeze_reset` | |
| "Release every test account this session is holding." | `reset_session` | Idempotent. |

## Live-write mode (experimental — your keys, in-process signing)

Run `--mode live --network devnet --wallets ./wallets.json`. **Read the
live-write safety warnings first** ([README](../README.md), [SECURITY.md](../SECURITY.md)).

| Ask | Tools | Notes |
|---|---|---|
| "List my loaded wallets with balances." | `list_wallets` | Never returns private keys. |
| "Send 2 MINA from my `warm` wallet to `B62q…`." | `send_payment` | Signed locally with `mina-signer`. |

## Snapshot mode (frozen archive — analytics)

Run `--mode snapshot` against a Postgres archive dump. Schema-only: SQL +
connectivity.

| Ask | Tools | Notes |
|---|---|---|
| "What tables are in the archive?" | `get_archive_schema` | |
| "Count blocks by chain status." | `query_archive_sql` | Read-only role + statement timeout. |
| "How many user commands per day last week?" | `query_archive_sql` | Bring your own SQL. |
