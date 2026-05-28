export type ExampleMode = "snapshot" | "tutorial" | "live" | "both";

// Examples runnable in live mode. "both" examples are also included if they
// don't depend on the archive DB.
const LIVE_RUNNABLE = new Set<string>([
  "orient",
  "browse_chain",
  "look_up_account_live",
  "explore_zkapp_events_live",
  "browse_archive_blocks",
  "live_write_payment",
  "rosetta_browse",
]);

export interface ExampleStep {
  tool: string;
  args?: Record<string, unknown>;
  bind?: Record<string, string>;
  note?: string;
}

export interface Example {
  name: string;
  summary: string;
  mode: ExampleMode;
  steps: ExampleStep[];
}

export const EXAMPLES: Example[] = [
  {
    name: "orient",
    summary: "Get a one-shot snapshot of the network: sync, mempool, accounts, freeze status.",
    mode: "tutorial",
    steps: [
      { tool: "describe_state", note: "Call this first in any new session." },
    ],
  },
  {
    name: "look_up_account_live",
    summary: "Read a public-network account's balance and nonce live from the daemon.",
    mode: "live",
    steps: [
      { tool: "get_account", args: { publicKey: "B62q..." }, note: "Replace publicKey with the account you care about." },
    ],
  },
  {
    name: "explore_zkapp_events_live",
    summary: "Read events/actions for a deployed zkApp from the Archive-Node-API on a public network.",
    mode: "live",
    steps: [
      { tool: "get_events", args: { address: "B62q...zkapp", status: "CANONICAL" } },
      { tool: "get_actions", args: { address: "B62q...zkapp", status: "CANONICAL" } },
    ],
  },
  {
    name: "browse_archive_blocks",
    summary: "List recent canonical blocks from the public Archive-Node-API and then fetch one by stateHash.",
    mode: "live",
    steps: [
      { tool: "get_archive_blocks", args: { canonical: true, limit: 5 }, bind: { "blocks.0.stateHash": "$state_hash" } },
      { tool: "get_block", args: { stateHash: "$state_hash" } },
    ],
  },
  {
    name: "send_payment",
    summary: "Send a MINA payment between two pre-funded test accounts and confirm inclusion.",
    mode: "tutorial",
    steps: [
      {
        tool: "faucet",
        args: {},
        bind: { publicKey: "$sender_pk", secretKey: "$sender_sk" },
        note: "Acquires + unlocks a 1550-MINA sender. Capture publicKey/secretKey from the JSON.",
      },
      {
        tool: "faucet",
        args: {},
        bind: { publicKey: "$receiver_pk" },
        note: "Acquires the receiver. We only need its publicKey here.",
      },
      {
        tool: "send_payment",
        args: { from: "$sender_pk", to: "$receiver_pk", amount: "1000000000", fee: "100000000" },
        bind: { "data.sendPayment.payment.id": "$tx_id" },
        note: "1 MINA payment, 0.1 MINA fee. amount/fee are nanominas (1 MINA = 1e9 nanomina).",
      },
      {
        tool: "get_transaction_status",
        args: { payment: "$tx_id" },
        note: "Poll every ~10s until status is INCLUDED.",
      },
      {
        tool: "return_account",
        args: { pk: "$sender_pk", sk: "$sender_sk" },
        note: "Optional — reset_session also releases everything held by this session.",
      },
    ],
  },
  {
    name: "watch_mempool",
    summary: "Submit a payment, then read it back from the daemon's mempool before it's mined.",
    mode: "tutorial",
    steps: [
      { tool: "faucet", args: {}, bind: { publicKey: "$sender_pk" } },
      { tool: "faucet", args: {}, bind: { publicKey: "$receiver_pk" } },
      {
        tool: "send_payment",
        args: { from: "$sender_pk", to: "$receiver_pk", amount: "1000000000", fee: "100000000" },
      },
      { tool: "get_mempool", note: "Run immediately — the tx will leave once it's in a block." },
    ],
  },
  {
    name: "verify_in_archive",
    summary: "Send a payment, wait for inclusion, then verify it landed in the archive DB.",
    mode: "tutorial",
    steps: [
      { tool: "faucet", args: {}, bind: { publicKey: "$sender_pk" } },
      { tool: "faucet", args: {}, bind: { publicKey: "$receiver_pk" } },
      {
        tool: "send_payment",
        // SDK 0.3.0+ flattened the response — payment fields are at the top
        // level (`hash`, `id`, `nonce`, ...), no longer under `payment`.
        args: { from: "$sender_pk", to: "$receiver_pk", amount: "1000000000", fee: "100000000" },
        bind: { hash: "$tx_hash", id: "$tx_id" },
      },
      {
        tool: "get_transaction_status",
        args: { payment: "$tx_id" },
        note: "Wait until INCLUDED (blocks every ~20s in lightnet).",
      },
      {
        tool: "query_archive_sql",
        args: { sql: "SELECT hash, fee, amount FROM user_commands WHERE hash = $1", params: ["$tx_hash"] },
      },
    ],
  },
  {
    name: "browse_chain",
    summary: "List the top of the canonical chain.",
    mode: "tutorial",
    steps: [
      { tool: "get_best_chain", args: { maxLength: 10 } },
    ],
  },
  {
    name: "browse_chain_archive",
    summary: "List recent canonical blocks from the archive (tutorial mode only — snapshot is schema-only).",
    mode: "tutorial",
    steps: [
      { tool: "list_blocks", args: { limit: 10, status: "canonical" } },
    ],
  },
  {
    name: "look_up_account",
    summary: "Read an account's balance/nonce, then list its recent transactions (as sender and as receiver).",
    mode: "tutorial",
    steps: [
      { tool: "get_account", args: { publicKey: "B62q..." }, note: "Replace publicKey with the account you care about." },
      // search_transactions accepts `sender` / `receiver`, not `publicKey`.
      // Use two calls when you want both sides; or pick the role you care about.
      { tool: "search_transactions", args: { sender: "B62q...", limit: 25 }, note: "Outgoing txs." },
      { tool: "search_transactions", args: { receiver: "B62q...", limit: 25 }, note: "Incoming txs." },
    ],
  },
  {
    name: "delegate_stake",
    summary: "Delegate a faucet account's stake to another block producer.",
    mode: "tutorial",
    steps: [
      { tool: "faucet", args: {}, bind: { publicKey: "$delegator" } },
      {
        tool: "send_delegation",
        args: { from: "$delegator", to: "B62q...validator", fee: "100000000" },
        note: "to: any valid B62q...; fee in nanominas.",
      },
    ],
  },
  {
    name: "explore_zkapp_events",
    summary: "Read events for a deployed zkApp contract from the archive.",
    mode: "tutorial",
    steps: [
      // get_events / get_actions take `address`, not `publicKey`.
      { tool: "get_events", args: { address: "B62q...zkapp", from: 1 } },
      { tool: "get_actions", args: { address: "B62q...zkapp", from: 1 } },
    ],
  },
  {
    name: "custom_sql",
    summary: "Inspect the archive schema, then run a read-only SQL query.",
    mode: "both",
    steps: [
      { tool: "get_archive_schema", note: "Shows tables/columns available for SQL queries." },
      {
        tool: "query_archive_sql",
        args: { sql: "SELECT chain_status, COUNT(*) FROM blocks GROUP BY chain_status" },
        note: "All queries run with a read-only role and a server-side timeout.",
      },
    ],
  },
  {
    name: "freeze_for_demo",
    summary: "Pause the periodic chain reset before a live demo, then unfreeze when done.",
    mode: "tutorial",
    steps: [
      { tool: "freeze_reset", args: { minutes: 60 }, note: "Pauses the janitor for 60 minutes." },
      { tool: "freeze_status", note: "Confirm: frozen=true, remainingMs counts down." },
      { tool: "unfreeze_reset", note: "Run after the demo to re-enable the janitor." },
    ],
  },
  {
    name: "session_cleanup",
    summary: "Release every test account this session has acquired without disconnecting.",
    mode: "tutorial",
    steps: [
      { tool: "reset_session", note: "Idempotent — safe to call when the session holds nothing." },
    ],
  },
  {
    name: "live_write_payment",
    summary: "Send a signed payment in live-write mode (server-loaded wallet keys; signs locally, submits to a public network).",
    mode: "live",
    steps: [
      {
        tool: "list_wallets",
        note: "Pick an alias and confirm the balance covers amount + fee. The response never includes private keys.",
      },
      {
        tool: "send_payment",
        args: {
          from_alias: "warm",
          to: "B62q...",
          amount: "1000000000",
          fee: "100000000",
          dry_run: true,
        },
        note: "ALWAYS dry-run first: returns signedPayload (data, signature, publicKey) without submitting. Confirms nonce + signature shape look right.",
      },
      {
        tool: "send_payment",
        args: { from_alias: "warm", to: "B62q...", amount: "1000000000", fee: "100000000" },
        bind: { hash: "$tx_hash", id: "$tx_id" },
        note: "Real submit. Returns the flat SubmittedCommand (hash, id, nonce, kind, source, receiver, amount, fee, memo). Per-wallet spend caps + memo size are enforced before signing.",
      },
      {
        tool: "get_transaction_status",
        args: { payment: "$tx_id" },
        note: "PENDING → INCLUDED on a typical devnet block (~3 min). UNKNOWN means the daemon doesn't have it.",
      },
    ],
  },
  {
    name: "rosetta_browse",
    summary: "Walk a public network through the Rosetta Data API: chain status → latest block → mempool.",
    mode: "live",
    steps: [
      {
        tool: "rosetta_status",
        note: "Confirms the Rosetta endpoint is reachable and reports the current block.",
        bind: { "current_block_identifier.index": "$block_index" },
      },
      {
        tool: "rosetta_block",
        args: { block_identifier: { index: "$block_index" }, detail: "lite" },
        note: "lite returns header + transaction counts. Use `transactions` for paged tx details, `full` to bypass shaping (may overflow).",
      },
      {
        tool: "rosetta_mempool",
        note: "Pending transaction identifiers. Pick one and call rosetta_mempool_transaction for its operations.",
      },
    ],
  },
];

export function listExamples(modeFilter: ExampleMode): Pick<Example, "name" | "summary" | "mode">[] {
  return EXAMPLES.filter((e) => {
    if (e.mode === modeFilter) return true;
    if (modeFilter === "live") return LIVE_RUNNABLE.has(e.name);
    return e.mode === "both";
  }).map((e) => ({
    name: e.name,
    summary: e.summary,
    mode: e.mode,
  }));
}

export function getExample(name: string): Example | null {
  return EXAMPLES.find((e) => e.name === name) ?? null;
}
