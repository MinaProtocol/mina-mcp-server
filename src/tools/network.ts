import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SnapshotProvider } from "../providers/snapshot.js";
import { TutorialProvider } from "../providers/tutorial.js";

export function registerNetworkTools(
  server: McpServer,
  getProvider: () => SnapshotProvider | TutorialProvider
) {
  server.tool(
    "get_sync_status",
    "[infra] Get the sync status and daemon info. In snapshot mode returns archive DB stats. In tutorial mode returns live daemon status.",
    {},
    async () => {
      const provider = getProvider();

      if (provider instanceof TutorialProvider) {
        try {
          const status = await provider.getDaemonStatus();
          return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: `Daemon not reachable: ${(e as Error).message}\nGraphQL endpoint: ${provider.graphql.getEndpoint()}`,
              },
            ],
          };
        }
      }

      // Snapshot mode: return DB stats
      const stats = await provider.getStats();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { mode: "snapshot", connected: await provider.db.isConnected(), ...stats },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "get_genesis_constants",
    "[business] Get genesis constants like coinbase reward and account creation fee (tutorial mode only).",
    {},
    async () => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider)) {
        return {
          content: [{ type: "text", text: "This tool is only available in tutorial mode." }],
        };
      }
      const result = await provider.getGenesisConstants();
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "get_network_id",
    "[business] Get the network identifier (tutorial mode only).",
    {},
    async () => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider)) {
        return {
          content: [{ type: "text", text: "This tool is only available in tutorial mode." }],
        };
      }
      const result = await provider.getNetworkID();
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "get_archive_stats",
    "[infra] Get statistics from the archive database: total blocks, commands, accounts, etc.",
    {},
    async () => {
      const provider = getProvider();
      const stats = await provider.getStats();
      return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
    }
  );
}
