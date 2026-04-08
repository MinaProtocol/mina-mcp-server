import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SnapshotProvider } from "../providers/snapshot.js";
import { TutorialProvider } from "../providers/tutorial.js";

export function registerBlockTools(
  server: McpServer,
  getProvider: () => SnapshotProvider | TutorialProvider
) {
  server.tool(
    "get_block",
    "[business] Get a block by state hash or height. In tutorial mode, can also query live blocks from the daemon.",
    {
      stateHash: z.string().optional().describe("Block state hash"),
      height: z.number().optional().describe("Block height"),
    },
    async ({ stateHash, height }) => {
      const provider = getProvider();

      if (provider instanceof TutorialProvider && (stateHash || height)) {
        const result = await provider.getBlockLive(stateHash, height);
        if (result) {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
      }

      // Fall back to archive DB
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

  server.tool(
    "list_blocks",
    "[business] List blocks from the archive database, ordered by height descending.",
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

  server.tool(
    "get_best_chain",
    "[business] Get the current best chain from the live daemon (tutorial mode only).",
    {
      maxLength: z.number().min(1).max(290).default(10).describe("Maximum number of blocks to return"),
    },
    async ({ maxLength }) => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider)) {
        return {
          content: [{ type: "text", text: "This tool is only available in tutorial mode." }],
        };
      }
      const result = await provider.getBestChain(maxLength);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
