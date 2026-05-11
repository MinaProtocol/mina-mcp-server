import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AnyProvider, Mode } from "../server-factory.js";
import { LiveProvider } from "../providers/live.js";

// Read-only Rosetta Data API tools. Registered only when:
//   - mode === "live"
//   - the active network has rosettaUrl + rosettaNetwork configured
//
// Construction API (offline signing flow) is intentionally not here; it
// will land in a follow-up PR with its own design conversation about
// macro-vs-literal tool shapes.

const NOT_AVAILABLE_MSG =
  "Rosetta is not available on this network. Set rosettaUrl + rosettaNetwork in NetworkConfig.";

function rosettaOf(provider: AnyProvider) {
  if (!(provider instanceof LiveProvider) || !provider.rosetta) return null;
  return provider.rosetta;
}

async function safeCall<T>(
  fn: () => Promise<T>,
  label: string
): Promise<{ ok: true; value: T } | { ok: false; text: string }> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (e) {
    return { ok: false, text: `${label}: ${(e as Error).message}` };
  }
}

export function registerRosettaTools(
  server: McpServer,
  getProvider: () => AnyProvider,
  mode: Mode
) {
  if (mode !== "live") return;

  server.tool(
    "rosetta_status",
    "[business] Mina-Rosetta /network/status — current/genesis/oldest block identifiers and sync state for this network, in standardized Rosetta format.",
    {},
    async () => {
      const rosetta = rosettaOf(getProvider());
      if (!rosetta) return { content: [{ type: "text", text: NOT_AVAILABLE_MSG }] };
      const r = await safeCall(() => rosetta.networkStatus(), "rosetta_status");
      return {
        content: [{ type: "text", text: r.ok ? JSON.stringify(r.value, null, 2) : r.text }],
      };
    }
  );

  server.tool(
    "rosetta_account",
    "[business] Mina-Rosetta /account/balance — balance(s) for a B62q… account, optionally at a specific block.",
    {
      address: z.string().describe("Mina public key (B62q…)"),
      blockIndex: z.number().optional().describe("Block height (optional). Pass at most one of blockIndex or blockHash."),
      blockHash: z.string().optional().describe("Block state hash (optional). Pass at most one of blockIndex or blockHash."),
    },
    async ({ address, blockIndex, blockHash }) => {
      const rosetta = rosettaOf(getProvider());
      if (!rosetta) return { content: [{ type: "text", text: NOT_AVAILABLE_MSG }] };
      if (blockIndex !== undefined && blockHash !== undefined) {
        return {
          content: [
            {
              type: "text",
              text: "Pass at most one of blockIndex or blockHash, not both.",
            },
          ],
        };
      }
      const blockId = blockIndex !== undefined
        ? { index: blockIndex }
        : blockHash !== undefined
          ? { hash: blockHash }
          : undefined;
      const r = await safeCall(
        () => rosetta.accountBalance(address, blockId),
        "rosetta_account"
      );
      return {
        content: [{ type: "text", text: r.ok ? JSON.stringify(r.value, null, 2) : r.text }],
      };
    }
  );

  server.tool(
    "rosetta_block",
    "[business] Mina-Rosetta /block — full block (with operations) by index or state hash. Provide exactly one.",
    {
      index: z.number().optional().describe("Block height"),
      hash: z.string().optional().describe("Block state hash"),
    },
    async ({ index, hash }) => {
      const rosetta = rosettaOf(getProvider());
      if (!rosetta) return { content: [{ type: "text", text: NOT_AVAILABLE_MSG }] };
      if ((index === undefined) === (hash === undefined)) {
        return {
          content: [
            {
              type: "text",
              text: "Provide exactly one of index or hash.",
            },
          ],
        };
      }
      const r = await safeCall(
        () => rosetta.block(index !== undefined ? { index } : { hash: hash! }),
        "rosetta_block"
      );
      return {
        content: [{ type: "text", text: r.ok ? JSON.stringify(r.value, null, 2) : r.text }],
      };
    }
  );

  server.tool(
    "rosetta_mempool",
    "[business] Mina-Rosetta /mempool — pending transaction identifiers on this network.",
    {},
    async () => {
      const rosetta = rosettaOf(getProvider());
      if (!rosetta) return { content: [{ type: "text", text: NOT_AVAILABLE_MSG }] };
      const r = await safeCall(() => rosetta.mempool(), "rosetta_mempool");
      return {
        content: [{ type: "text", text: r.ok ? JSON.stringify(r.value, null, 2) : r.text }],
      };
    }
  );

  server.tool(
    "rosetta_mempool_transaction",
    "[business] Mina-Rosetta /mempool/transaction — a single pending transaction with operations, by hash.",
    {
      hash: z.string().describe("Transaction hash (returned by rosetta_mempool)"),
    },
    async ({ hash }) => {
      const rosetta = rosettaOf(getProvider());
      if (!rosetta) return { content: [{ type: "text", text: NOT_AVAILABLE_MSG }] };
      const r = await safeCall(
        () => rosetta.mempoolTransaction(hash),
        "rosetta_mempool_transaction"
      );
      return {
        content: [{ type: "text", text: r.ok ? JSON.stringify(r.value, null, 2) : r.text }],
      };
    }
  );
}
