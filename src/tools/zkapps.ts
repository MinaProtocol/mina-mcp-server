import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AnyProvider, Mode } from "../server-factory.js";
import { TutorialProvider } from "../providers/tutorial.js";

export function registerZkAppTools(
  server: McpServer,
  getProvider: () => AnyProvider,
  mode: Mode
) {
  if (mode === "snapshot") return;

  server.tool(
    "get_events",
    "[tutorial+live] Get emitted events from a zkApp address via the Archive-Node-API. Events are state-change notifications emitted by zkApp account updates. Snapshot mode does not run an Archive-Node-API and rejects this tool.",
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
        return { content: [{ type: "text", text: "This tool requires Archive-Node-API." }] };
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
    "[tutorial+live] Get dispatched actions from a zkApp address via the Archive-Node-API. Actions are reducer inputs that modify zkApp state. Snapshot mode does not run an Archive-Node-API and rejects this tool.",
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
        return { content: [{ type: "text", text: "This tool requires Archive-Node-API." }] };
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
    "[tutorial+live] Get finalized blocks from the Archive-Node-API (height, creator, timestamp, coinbase). Prefer this for live mode (the archive node holds canonical history) over `get_best_chain` (daemon's in-memory view including not-yet-canonical tip). Returns full block rows — use a small `limit` on busy chains.",
    {
      canonical: z.boolean().optional().describe("Only return canonical (finalized) blocks"),
      sortBy: z.enum(["BLOCKHEIGHT_ASC", "BLOCKHEIGHT_DESC"]).default("BLOCKHEIGHT_DESC").describe("Sort order"),
      limit: z.number().min(1).max(100).default(20).describe("Number of blocks to return"),
    },
    async (args) => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider) || !provider.archiveApi) {
        return { content: [{ type: "text", text: "This tool requires Archive-Node-API." }] };
      }
      try {
        const { canonical, sortBy, limit } = args;
        const blocks = await provider.archiveApi.getBlocks({
          query: canonical !== undefined ? { canonical } : undefined,
          sortBy,
          limit,
        });
        return { content: [{ type: "text", text: JSON.stringify(blocks, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }] };
      }
    }
  );

  server.tool(
    "get_network_state",
    "[tutorial+live] Get network state from the Archive-Node-API: max canonical and pending block heights. (Different from `get_sync_status` which queries the daemon, and from `describe_state` which aggregates both.)",
    {},
    async () => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider) || !provider.archiveApi) {
        return { content: [{ type: "text", text: "This tool requires Archive-Node-API." }] };
      }
      try {
        const state = await provider.archiveApi.getNetworkState();
        const flat = state.maxBlockHeight ?? {
          canonicalMaxBlockHeight: 0,
          pendingMaxBlockHeight: 0,
        };
        return { content: [{ type: "text", text: JSON.stringify(flat, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }] };
      }
    }
  );
}
