import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SnapshotProvider } from "./providers/snapshot.js";
import { TutorialProvider } from "./providers/tutorial.js";
import { LiveProvider } from "./providers/live.js";
import { LiveWriteProvider } from "./providers/live-write.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerBlockTools } from "./tools/blocks.js";
import { registerTransactionTools } from "./tools/transactions.js";
import { registerNetworkTools } from "./tools/network.js";
import { registerSchemaTools } from "./tools/schema.js";
import { registerZkAppTools } from "./tools/zkapps.js";
import { registerTestAccountTools } from "./tools/test-accounts.js";
import { registerAdminTools } from "./tools/admin.js";
import { registerStateTools } from "./tools/state.js";
import { registerExampleTools } from "./tools/examples.js";
import { registerRosettaTools } from "./tools/rosetta.js";
import { registerWalletTools } from "./tools/wallets.js";

export type Mode = "snapshot" | "tutorial" | "live";

export type AnyProvider = SnapshotProvider | TutorialProvider | LiveProvider | LiveWriteProvider;

export function buildMcpServer(provider: AnyProvider, mode: Mode): McpServer {
  // Append "-write" to the server name when a LiveWriteProvider is in use,
  // so MCP clients can distinguish read-only live mode from the write-
  // capable variant without needing to call describe_state.
  const suffix = provider instanceof LiveWriteProvider ? "-write" : "";
  const server = new McpServer({ name: `mina-${mode}${suffix}`, version: "0.1.0" });
  const getProvider = () => provider;
  registerAccountTools(server, getProvider, mode);
  registerBlockTools(server, getProvider, mode);
  registerTransactionTools(server, getProvider, mode);
  registerNetworkTools(server, getProvider, mode);
  registerSchemaTools(server, getProvider, mode);
  registerZkAppTools(server, getProvider, mode);
  registerTestAccountTools(server, getProvider, mode);
  registerAdminTools(server, getProvider, mode);
  registerStateTools(server, getProvider, mode);
  registerExampleTools(server, getProvider, mode);
  registerRosettaTools(server, getProvider, mode);
  registerWalletTools(server, getProvider, mode);
  return server;
}
