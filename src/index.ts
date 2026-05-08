#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ArchiveDB } from "./db/archive.js";
import { GraphQLClient } from "./graphql/client.js";
import { ArchiveNodeAPI } from "./graphql/archive-api.js";
import { AccountsManager } from "./graphql/accounts-manager.js";
import { SessionTracker } from "./session/tracker.js";
import { ResetController } from "./reset/controller.js";
import { SnapshotProvider } from "./providers/snapshot.js";
import { TutorialProvider } from "./providers/tutorial.js";
import { Mode, buildMcpServer } from "./server-factory.js";
import { startHttpServer } from "./transports/http.js";

type Transport = "stdio" | "http";

function parseArgs(): { mode: Mode; transport: Transport; httpPort: number } {
  const args = process.argv.slice(2);
  let mode: Mode = "snapshot";
  let transport: Transport = "stdio";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mode" && args[i + 1]) {
      const val = args[i + 1];
      if (val !== "snapshot" && val !== "tutorial") {
        console.error(`Invalid mode: ${val}. Use 'snapshot' or 'tutorial'.`);
        process.exit(1);
      }
      mode = val;
    } else if (args[i] === "--transport" && args[i + 1]) {
      const val = args[i + 1];
      if (val !== "stdio" && val !== "http") {
        console.error(`Invalid transport: ${val}. Use 'stdio' or 'http'.`);
        process.exit(1);
      }
      transport = val;
    }
  }

  if (process.env.MINA_MCP_MODE === "tutorial" || process.env.MINA_MCP_MODE === "snapshot") {
    mode = process.env.MINA_MCP_MODE;
  }
  if (process.env.MINA_MCP_TRANSPORT === "stdio" || process.env.MINA_MCP_TRANSPORT === "http") {
    transport = process.env.MINA_MCP_TRANSPORT;
  }

  const httpPort = Number.parseInt(process.env.MINA_MCP_HTTP_PORT ?? "3000", 10);
  if (!Number.isFinite(httpPort) || httpPort <= 0) {
    console.error(`Invalid MINA_MCP_HTTP_PORT: ${process.env.MINA_MCP_HTTP_PORT}`);
    process.exit(1);
  }

  return { mode, transport, httpPort };
}

function logProviderHealth(provider: SnapshotProvider | TutorialProvider, mode: Mode, db: ArchiveDB) {
  if (mode === "tutorial") {
    const tp = provider as TutorialProvider;
    void Promise.allSettled([
      tp.graphql.isConnected(),
      tp.archiveApi?.isConnected(),
      tp.accountsManager?.isConnected(),
      db.isConnected(),
    ]).then((results) => {
      const status = (r: PromiseSettledResult<unknown>) =>
        r.status === "fulfilled" && r.value ? "connected" : "not reachable";
      console.error(`  Daemon GraphQL (${tp.graphql.getEndpoint()}): ${status(results[0])}`);
      console.error(`  Archive-Node-API (${tp.archiveApi?.getEndpoint()}): ${status(results[1])}`);
      console.error(`  Accounts Manager (${tp.accountsManager?.getEndpoint()}): ${status(results[2])}`);
      console.error(`  Archive DB: ${status(results[3])}`);
    });
  } else {
    void db.isConnected().then((c) => console.error(`  Archive DB: ${c ? "connected" : "not reachable"}`));
  }
}

async function main() {
  const { mode, transport, httpPort } = parseArgs();

  const db = new ArchiveDB();
  let provider: SnapshotProvider | TutorialProvider;

  if (mode === "tutorial") {
    const graphql = new GraphQLClient();
    const archiveApi = new ArchiveNodeAPI();
    const accountsManager = new AccountsManager();
    const tracker = new SessionTracker(accountsManager);
    const resetController = new ResetController();
    provider = new TutorialProvider(db, graphql, archiveApi, accountsManager, tracker, resetController);
  } else {
    provider = new SnapshotProvider(db);
  }

  if (transport === "stdio") {
    const server = buildMcpServer(provider, mode);
    const stdio = new StdioServerTransport();
    await server.connect(stdio);

    if (mode === "tutorial") {
      const tp = provider as TutorialProvider;
      let releasing = false;
      const onExit = (signal: string) => async () => {
        if (releasing) return;
        releasing = true;
        try {
          if (tp.tracker) {
            const result = await tp.tracker.releaseAll();
            if (result.released > 0 || result.errors.length > 0) {
              console.error(
                `[${signal}] released ${result.released} tracked accounts` +
                  (result.errors.length ? `, ${result.errors.length} failed: ${result.errors.join("; ")}` : "")
              );
            }
          }
        } catch (e) {
          console.error(`release on ${signal} threw:`, e);
        }
        if (signal !== "beforeExit") process.exit(0);
      };
      process.once("SIGINT", onExit("SIGINT"));
      process.once("SIGTERM", onExit("SIGTERM"));
      process.once("beforeExit", onExit("beforeExit"));
    }

    console.error(`Mina MCP server started in ${mode} mode (stdio)`);
  } else {
    const httpServer = await startHttpServer({ port: httpPort, provider, mode });
    console.error(`Mina MCP server started in ${mode} mode (http) on :${httpServer.port}`);
    console.error(`  POST /mcp        — JSON-RPC requests (use Mcp-Session-Id header)`);
    console.error(`  GET  /mcp        — SSE stream`);
    console.error(`  GET  /health     — liveness/health`);

    const onExit = (signal: string) => async () => {
      console.error(`[${signal}] shutting down http server`);
      try {
        await httpServer.close();
      } catch (e) {
        console.error(`shutdown threw:`, e);
      }
      process.exit(0);
    };
    process.once("SIGINT", onExit("SIGINT"));
    process.once("SIGTERM", onExit("SIGTERM"));
  }

  logProviderHealth(provider, mode, db);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
