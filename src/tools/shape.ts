// Response shaping to keep live-mode tool output within the MCP per-tool
// result-size budget (issue #32). On real public networks a block can carry
// 60+ user commands, and the full GraphQL/Rosetta shapes blow past what an LLM
// client will accept — the framework then spills to disk and the round-trip is
// lost. Default every block-ish tool to a compact "lite" summary; let callers
// opt into paged transaction detail.

export type Detail = "lite" | "transactions" | "full";

export const DETAIL_VALUES: readonly Detail[] = ["lite", "transactions", "full"];

// Conservative ceiling for one tool result rendered to the LLM (~15k tokens).
// Real clients vary; beyond this the framework spills to disk.
export const MAX_RESPONSE_CHARS = 60_000;

export const DEFAULT_TX_LIMIT = 20;

export interface PageOpts {
  detail: Detail;
  transactionLimit: number;
  transactionOffset: number;
}

// The GraphQL/Rosetta payloads are untyped JSON here; shape defensively.
type Json = Record<string, any>;

function txKindCounts(userCommands: Json[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of userCommands) {
    const k = String(c?.kind ?? "unknown");
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

/**
 * Shape a daemon block as returned by the SDK's `getBlock()` / `getBestChain()`
 * methods. SDK responses are flat: `block.blockHeight`, `block.userCommands`,
 * etc. — no more `protocolState.consensusState.*` nesting.
 */
export function shapeDaemonBlock(block: Json, opts: PageOpts): Json {
  if (opts.detail === "full") return block;
  const userCommands: Json[] = Array.isArray(block?.userCommands) ? block.userCommands : [];
  const feeTransfers: Json[] = Array.isArray(block?.feeTransfers) ? block.feeTransfers : [];

  const header: Json = {
    stateHash: block?.stateHash,
    height: block?.blockHeight ?? block?.height,
    previousStateHash: block?.previousStateHash,
    creator: block?.blockCreator ?? block?.creatorPublicKey,
    slot: block?.slot ?? block?.globalSlotSinceHardFork,
    date: block?.utcDate ?? block?.date,
    coinbase: block?.coinbase,
    coinbaseReceiver: block?.coinbaseReceiver,
    transactionCounts: {
      userCommands: userCommands.length,
      byKind: txKindCounts(userCommands),
      feeTransfers: feeTransfers.length,
    },
  };

  if (opts.detail === "lite") return header;

  // detail === "transactions": page the userCommands.
  const start = Math.max(0, opts.transactionOffset);
  const page = userCommands.slice(start, start + opts.transactionLimit);
  return {
    ...header,
    transactionPage: {
      offset: start,
      limit: opts.transactionLimit,
      total: userCommands.length,
      returned: page.length,
    },
    userCommands: page,
  };
}

/**
 * Shape a best-chain array. Even "transactions" across many blocks is large, so
 * best chain only ever returns per-block headers — reach for get_block when you
 * need a specific block's transactions.
 */
export function shapeBestChain(blocks: Json[], opts: PageOpts): Json {
  if (opts.detail === "full") return blocks;
  return blocks.map((b) => shapeDaemonBlock(b, { ...opts, detail: "lite" }));
}

/** Shape a Rosetta /block response (block.transactions[].operations[]). */
export function shapeRosettaBlock(resp: Json, opts: PageOpts): Json {
  if (opts.detail === "full") return resp;
  const block = resp?.block ?? {};
  const transactions: Json[] = Array.isArray(block.transactions) ? block.transactions : [];
  const opCount = transactions.reduce(
    (n, t) => n + (Array.isArray(t?.operations) ? t.operations.length : 0),
    0,
  );
  const header: Json = {
    block_identifier: block.block_identifier,
    parent_block_identifier: block.parent_block_identifier,
    timestamp: block.timestamp,
    transactionCounts: { transactions: transactions.length, operations: opCount },
    other_transactions: resp?.other_transactions,
  };
  if (opts.detail === "lite") return header;

  const start = Math.max(0, opts.transactionOffset);
  const page = transactions.slice(start, start + opts.transactionLimit);
  return {
    ...header,
    transactionPage: {
      offset: start,
      limit: opts.transactionLimit,
      total: transactions.length,
      returned: page.length,
    },
    transactions: page,
  };
}

/**
 * Render a shaped value as an MCP text result, guarding against oversized
 * payloads. A "lite" result is always returned as-is; a larger detail level
 * that still busts the budget yields an actionable message rather than a silent
 * disk spill.
 */
export function renderShaped(
  value: unknown,
  detail: Detail,
): { content: { type: "text"; text: string }[] } {
  const text = JSON.stringify(value, null, 2);
  if (text.length <= MAX_RESPONSE_CHARS || detail === "lite") {
    return { content: [{ type: "text", text }] };
  }
  return {
    content: [
      {
        type: "text",
        text:
          `Response is ${text.length} chars, over the ~${MAX_RESPONSE_CHARS}-char tool budget. ` +
          `Re-run with detail:"lite" for a summary, or detail:"transactions" with a smaller ` +
          `transactionLimit / a transactionOffset to page through the transactions.`,
      },
    ],
  };
}
