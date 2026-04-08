import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SnapshotProvider } from "../providers/snapshot.js";
import { TutorialProvider } from "../providers/tutorial.js";

export function registerZkAppTools(
  server: McpServer,
  getProvider: () => SnapshotProvider | TutorialProvider
) {
  server.tool(
    "get_events",
    "[business] Get emitted events from a zkApp address. Uses the Archive-Node-API (tutorial mode only). Events are state-change notifications emitted by zkApp account updates.",
    {
      address: z.string().describe("zkApp public key (B62...)"),
      tokenId: z.string().optional().describe("Token ID (defaults to MINA token)"),
      status: z.enum(["ALL", "PENDING", "CANONICAL"]).default("ALL").describe("Block status filter"),
      from: z.number().optional().describe("Start block height (inclusive)"),
      to: z.number().optional().describe("End block height (exclusive)"),
    },
    async (args) => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider) || !provider.archiveApi) {
        return { content: [{ type: "text", text: "This tool requires tutorial mode with Archive-Node-API." }] };
      }
      try {
        const events = await provider.archiveApi.getEvents(args);
        return { content: [{ type: "text", text: JSON.stringify(events, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }] };
      }
    }
  );

  server.tool(
    "get_actions",
    "[business] Get dispatched actions from a zkApp address. Uses the Archive-Node-API (tutorial mode only). Actions are reducer inputs that modify zkApp state.",
    {
      address: z.string().describe("zkApp public key (B62...)"),
      tokenId: z.string().optional().describe("Token ID"),
      status: z.enum(["ALL", "PENDING", "CANONICAL"]).default("ALL").describe("Block status filter"),
      from: z.number().optional().describe("Start block height (inclusive)"),
      to: z.number().optional().describe("End block height (exclusive)"),
      fromActionState: z.string().optional().describe("Filter from this action state hash (inclusive)"),
      endActionState: z.string().optional().describe("Filter to this action state hash (inclusive)"),
    },
    async (args) => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider) || !provider.archiveApi) {
        return { content: [{ type: "text", text: "This tool requires tutorial mode with Archive-Node-API." }] };
      }
      try {
        const actions = await provider.archiveApi.getActions(args);
        return { content: [{ type: "text", text: JSON.stringify(actions, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }] };
      }
    }
  );

  server.tool(
    "get_archive_blocks",
    "[business] Get blocks from the Archive-Node-API (tutorial mode only). Includes block height, creator, timestamp, and coinbase reward.",
    {
      canonical: z.boolean().optional().describe("Only return canonical (finalized) blocks"),
      sortBy: z.enum(["BLOCKHEIGHT_ASC", "BLOCKHEIGHT_DESC"]).default("BLOCKHEIGHT_DESC").describe("Sort order"),
      limit: z.number().min(1).max(100).default(20).describe("Number of blocks to return"),
    },
    async (args) => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider) || !provider.archiveApi) {
        return { content: [{ type: "text", text: "This tool requires tutorial mode with Archive-Node-API." }] };
      }
      try {
        const blocks = await provider.archiveApi.getBlocks(args);
        return { content: [{ type: "text", text: JSON.stringify(blocks, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }] };
      }
    }
  );

  server.tool(
    "get_network_state",
    "[business] Get network state from the Archive-Node-API (tutorial mode only). Returns max canonical and pending block heights.",
    {},
    async () => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider) || !provider.archiveApi) {
        return { content: [{ type: "text", text: "This tool requires tutorial mode with Archive-Node-API." }] };
      }
      try {
        const state = await provider.archiveApi.getNetworkState();
        return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }] };
      }
    }
  );
}
