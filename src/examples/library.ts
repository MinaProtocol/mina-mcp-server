export type ExampleMode = "snapshot" | "tutorial" | "both";

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
        args: { from: "$sender_pk", to: "$receiver_pk", amount: "1000000000", fee: "100000000" },
        bind: { "data.sendPayment.payment.hash": "$tx_hash" },
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
    summary: "List recent canonical blocks from the archive (works against any historical snapshot).",
    mode: "both",
    steps: [
      { tool: "list_blocks", args: { limit: 10, status: "canonical" } },
    ],
  },
  {
    name: "look_up_account",
    summary: "Read an account's balance/nonce, then list its recent transactions.",
    mode: "both",
    steps: [
      { tool: "get_account", args: { publicKey: "B62q..." }, note: "Replace publicKey with the account you care about." },
      { tool: "search_transactions", args: { publicKey: "B62q...", limit: 25 } },
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
      { tool: "get_events", args: { publicKey: "B62q...zkapp", from: 1 } },
      { tool: "get_actions", args: { publicKey: "B62q...zkapp", from: 1 } },
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
];

export function listExamples(modeFilter: ExampleMode): Pick<Example, "name" | "summary" | "mode">[] {
  return EXAMPLES.filter((e) => e.mode === "both" || e.mode === modeFilter).map((e) => ({
    name: e.name,
    summary: e.summary,
    mode: e.mode,
  }));
}

export function getExample(name: string): Example | null {
  return EXAMPLES.find((e) => e.name === name) ?? null;
}
