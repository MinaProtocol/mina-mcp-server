import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SnapshotProvider } from "./providers/snapshot.js";
import { TutorialProvider } from "./providers/tutorial.js";
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

export type Mode = "snapshot" | "tutorial";

export function buildMcpServer(provider: SnapshotProvider | TutorialProvider, mode: Mode): McpServer {
  const server = new McpServer({ name: `mina-${mode}`, version: "0.1.0" });
  const getProvider = () => provider;
  registerAccountTools(server, getProvider);
  registerBlockTools(server, getProvider);
  registerTransactionTools(server, getProvider);
  registerNetworkTools(server, getProvider);
  registerSchemaTools(server, getProvider);
  registerZkAppTools(server, getProvider);
  registerTestAccountTools(server, getProvider);
  registerAdminTools(server, getProvider);
  registerStateTools(server, getProvider);
  registerExampleTools(server, getProvider);
  return server;
}
