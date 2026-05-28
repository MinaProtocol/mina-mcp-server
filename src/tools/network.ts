import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AnyProvider, Mode } from "../server-factory.js";
import { TutorialProvider } from "../providers/tutorial.js";

export function registerNetworkTools(
  server: McpServer,
  getProvider: () => AnyProvider,
  mode: Mode
) {
  server.tool(
    "get_sync_status",
    "[infra] Get the sync status and daemon info. Returns the flat daemon status object directly — fields like `syncStatus`, `blockchainLength`, `stateHash`, `numAccounts`, `chainId`, `addrsAndPorts` are at the top level (not nested under `daemonStatus`). In snapshot mode returns archive DB stats instead. In tutorial and live modes returns the live daemon status.",
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
                text: `Daemon not reachable: ${(e as Error).message}\nGraphQL endpoint: ${provider.getDaemonEndpoint()}`,
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

  if (mode !== "snapshot") {
    server.tool(
      "get_genesis_constants",
      "Get the network's genesis constants: coinbase reward, account-creation fee, " +
        "slot/epoch timing, k (confirmations), and ledger depth. Use these to reason " +
        "about fees, finality, and timing rather than hard-coding values.",
      {},
      async () => {
        const provider = getProvider();
        if (!(provider instanceof TutorialProvider)) {
          return {
            content: [{ type: "text", text: "This tool requires a live daemon connection." }],
          };
        }
        const result = await provider.getGenesisConstants();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
    );

    server.tool(
      "get_network_id",
      "Get the daemon's network identifier (e.g. 'mina:mainnet', 'mina:devnet'). " +
        "Use this to confirm which network the server is actually talking to before " +
        "interpreting balances or submitting transactions.",
      {},
      async () => {
        const provider = getProvider();
        if (!(provider instanceof TutorialProvider)) {
          return {
            content: [{ type: "text", text: "This tool requires a live daemon connection." }],
          };
        }
        const result = await provider.getNetworkID();
        return { content: [{ type: "text", text: result }] };
      }
    );
  }

  if (mode === "tutorial") {
    server.tool(
      "get_archive_stats",
      "[infra][tutorial] Statistics from the local archive database: total blocks, commands, accounts, etc. Tutorial mode only — live/snapshot don't have an archive DB.",
      {},
      async () => {
        const provider = getProvider();
        const stats = await provider.getStats();
        return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
      }
    );
  }
}
