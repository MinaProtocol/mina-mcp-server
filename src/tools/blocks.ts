import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AnyProvider, Mode } from "../server-factory.js";
import { TutorialProvider } from "../providers/tutorial.js";
import {
  DEFAULT_TX_LIMIT,
  renderShaped,
  shapeBestChain,
  shapeDaemonBlock,
  type Detail,
} from "./shape.js";

const detailArg = z
  .enum(["lite", "transactions", "full"])
  .default("lite")
  .describe(
    'Output size. "lite" (default): block header + transaction counts only — always within budget. ' +
      '"transactions": header + a page of userCommands (see transactionLimit/Offset). ' +
      '"full": the complete daemon response — may overflow the tool budget on busy networks.',
  );

const txLimitArg = z
  .number()
  .min(1)
  .max(100)
  .default(DEFAULT_TX_LIMIT)
  .describe('Max userCommands to return when detail="transactions".');

const txOffsetArg = z
  .number()
  .min(0)
  .default(0)
  .describe('Offset into the userCommands list when detail="transactions".');

export function registerBlockTools(
  server: McpServer,
  getProvider: () => AnyProvider,
  mode: Mode
) {
  if (mode !== "snapshot") {
    server.tool(
      "get_block",
      'Get a block by state hash or height. Defaults to a "lite" summary (header + ' +
        "transaction counts) that stays within the tool budget; use detail to pull paged " +
        "transactions or the full block. In tutorial mode, queries the live daemon first and " +
        "falls back to the archive DB. In live mode, a stateHash is required (use " +
        "get_archive_blocks to discover one).",
      {
        stateHash: z.string().optional().describe("Block state hash"),
        height: z.number().optional().describe("Block height"),
        detail: detailArg,
        transactionLimit: txLimitArg,
        transactionOffset: txOffsetArg,
      },
      async ({ stateHash, height, detail, transactionLimit, transactionOffset }) => {
        const provider = getProvider();
        const opts = { detail: detail as Detail, transactionLimit, transactionOffset };

        if (provider instanceof TutorialProvider && (stateHash || height)) {
          const result = await provider.getBlockLive(stateHash, height);
          if (result) {
            return renderShaped(
              shapeDaemonBlock(result as unknown as Record<string, unknown>, opts),
              opts.detail
            );
          }
        }

        // Fall back to archive DB (tutorial mode only — live has no DB). The DB
        // shape differs from the daemon's and these blocks are small, so it's
        // returned as-is rather than run through the daemon-block shaper.
        const key = stateHash ?? height;
        if (!key) {
          return {
            content: [{ type: "text", text: "Provide either stateHash or height" }],
          };
        }
        const result = await provider.getBlock(key);
        if (!result) {
          return { content: [{ type: "text", text: "Block not found" }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
    );
  }

  if (mode === "tutorial") {
    server.tool(
      "list_blocks",
      "[tutorial] Archive-DB-backed list of blocks ordered by height descending. " +
        "Tutorial mode only (live mode has no archive DB — use `get_archive_blocks` against the " +
        "Archive-Node-API instead). Prefer `get_best_chain` for the daemon's in-memory tip view.",
      {
        limit: z.number().min(1).max(100).default(20).describe("Number of blocks to return (max 100)"),
        offset: z.number().min(0).default(0).describe("Offset for pagination"),
        status: z.enum(["canonical", "orphaned", "pending"]).optional().describe("Filter by chain status"),
      },
      async ({ limit, offset, status }) => {
        const provider = getProvider();
        const result = await provider.listBlocks(limit, offset, status);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
    );
  }

  if (mode !== "snapshot") {
    server.tool(
      "get_best_chain",
      "Get the current best chain from the live daemon. Returns per-block headers + " +
        "transaction counts (always within budget) — use get_block for a specific block's " +
        'transactions. detail:"full" returns complete blocks and may overflow on busy networks.',
      {
        maxLength: z.number().min(1).max(290).default(10).describe("Maximum number of blocks to return"),
        detail: detailArg,
      },
      async ({ maxLength, detail }) => {
        const provider = getProvider();
        if (!(provider instanceof TutorialProvider)) {
          return {
            content: [{ type: "text", text: "This tool requires a live daemon connection." }],
          };
        }
        const result = await provider.getBestChain(maxLength);
        const opts = {
          detail: detail as Detail,
          transactionLimit: DEFAULT_TX_LIMIT,
          transactionOffset: 0,
        };
        return renderShaped(
          shapeBestChain(result as unknown as Record<string, unknown>[], opts),
          opts.detail
        );
      }
    );
  }
}
