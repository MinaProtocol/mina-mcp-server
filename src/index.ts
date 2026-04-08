#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ArchiveDB } from "./db/archive.js";
import { GraphQLClient } from "./graphql/client.js";
import { ArchiveNodeAPI } from "./graphql/archive-api.js";
import { AccountsManager } from "./graphql/accounts-manager.js";
import { SnapshotProvider } from "./providers/snapshot.js";
import { TutorialProvider } from "./providers/tutorial.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerBlockTools } from "./tools/blocks.js";
import { registerTransactionTools } from "./tools/transactions.js";
import { registerNetworkTools } from "./tools/network.js";
import { registerSchemaTools } from "./tools/schema.js";
import { registerZkAppTools } from "./tools/zkapps.js";
import { registerTestAccountTools } from "./tools/test-accounts.js";

type Mode = "snapshot" | "tutorial";

function parseArgs(): { mode: Mode } {
  const args = process.argv.slice(2);
  let mode: Mode = "snapshot";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mode" && args[i + 1]) {
      const val = args[i + 1];
      if (val !== "snapshot" && val !== "tutorial") {
        console.error(`Invalid mode: ${val}. Use 'snapshot' or 'tutorial'.`);
        process.exit(1);
      }
      mode = val;
    }
  }

  // Env override
  if (process.env.MINA_MCP_MODE === "tutorial" || process.env.MINA_MCP_MODE === "snapshot") {
    mode = process.env.MINA_MCP_MODE;
  }

  return { mode };
}

async function main() {
  const { mode } = parseArgs();

  const db = new ArchiveDB();
  let provider: SnapshotProvider | TutorialProvider;

  if (mode === "tutorial") {
    const graphql = new GraphQLClient();
    const archiveApi = new ArchiveNodeAPI();
    const accountsManager = new AccountsManager();
    provider = new TutorialProvider(db, graphql, archiveApi, accountsManager);
  } else {
    provider = new SnapshotProvider(db);
  }

  const server = new McpServer({
    name: `mina-${mode}`,
    version: "0.1.0",
  });

  const getProvider = () => provider;

  // Register all tools
  registerAccountTools(server, getProvider);
  registerBlockTools(server, getProvider);
  registerTransactionTools(server, getProvider);
  registerNetworkTools(server, getProvider);
  registerSchemaTools(server, getProvider);
  registerZkAppTools(server, getProvider);
  registerTestAccountTools(server, getProvider);

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`Mina MCP server started in ${mode} mode`);

  if (mode === "tutorial") {
    const tp = provider as TutorialProvider;
    const results = await Promise.allSettled([
      tp.graphql.isConnected(),
      tp.archiveApi?.isConnected(),
      tp.accountsManager?.isConnected(),
      db.isConnected(),
    ]);

    const status = (r: PromiseSettledResult<unknown>) =>
      r.status === "fulfilled" && r.value ? "connected" : "not reachable";

    console.error(`  Daemon GraphQL (${tp.graphql.getEndpoint()}): ${status(results[0])}`);
    console.error(`  Archive-Node-API (${tp.archiveApi?.getEndpoint()}): ${status(results[1])}`);
    console.error(`  Accounts Manager (${tp.accountsManager?.getEndpoint()}): ${status(results[2])}`);
    console.error(`  Archive DB: ${status(results[3])}`);
  } else {
    const dbConnected = await db.isConnected();
    console.error(`  Archive DB: ${dbConnected ? "connected" : "not reachable"}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
