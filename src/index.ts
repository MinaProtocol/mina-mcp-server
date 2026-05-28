#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import MinaSigner from "mina-signer";
import { ArchiveDB } from "./db/archive.js";
import { createMinaClient } from "./graphql/client.js";
import { ArchiveClient } from "@o1-labs/mina-archive-sdk";
import { AccountsManager } from "./graphql/accounts-manager.js";
import { SessionTracker } from "./session/tracker.js";
import { ResetController } from "./reset/controller.js";
import { SnapshotProvider } from "./providers/snapshot.js";
import { TutorialProvider } from "./providers/tutorial.js";
import { LiveProvider } from "./providers/live.js";
import { LiveWriteProvider } from "./providers/live-write.js";
import { AnyProvider, Mode, buildMcpServer } from "./server-factory.js";
import { startHttpServer } from "./transports/http.js";
import { NETWORKS, NetworkName, resolveNetwork } from "./networks.js";
import { loadWallets, WalletLoadError } from "./wallets/loader.js";
import { WalletRegistry } from "./wallets/types.js";

type Transport = "stdio" | "http";

// Resolved from package.json at the package root (../ from dist/index.js).
const VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "unknown";
  }
})();

const HELP_TEXT = `mina-mcp-server v${VERSION}
MCP server for Mina Protocol — accounts, blocks, transactions, zkApp events,
archive SQL, and Rosetta, over the daemon / archive node / Rosetta endpoints.

USAGE
  mina-mcp-server [--mode <mode>] [options]

MODES
  live        Read-only proxy to a public network. No local infra. (use --network)
  tutorial    Read+write against a local Mina lightnet (daemon + archive + faucet).
  snapshot    Schema-only SQL access against a frozen archive Postgres dump. (default)

OPTIONS
  --mode <live|tutorial|snapshot>   Operating mode (default: snapshot).
  --network <devnet|mainnet|mesa>   Public network (live mode only).
  --transport <stdio|http>          MCP transport (default: stdio).
  --wallets <path>                  wallets.json for live-write mode (live only).
  --allow-mainnet-writes            Required opt-in to submit on mainnet.
  -h, --help                        Show this help and exit.
  -v, --version                     Print the version and exit.

ENVIRONMENT (equivalent to the flags above)
  MINA_MCP_MODE, MINA_MCP_NETWORK, MINA_MCP_TRANSPORT, MINA_MCP_WALLETS,
  MINA_MCP_ALLOW_MAINNET_WRITES=1, MINA_MCP_HTTP_PORT (http transport, default 3000).

EXAMPLES
  mina-mcp-server --mode live --network devnet
  mina-mcp-server --mode tutorial
  MINA_MCP_MODE=snapshot mina-mcp-server

Docs: https://github.com/MinaProtocol/mina-mcp-server`;

interface ParsedArgs {
  mode: Mode;
  transport: Transport;
  httpPort: number;
  network?: NetworkName;
  wallets?: string;
  allowMainnetWrites: boolean;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);

  // Handled before anything else, and before any MCP transport is created, so
  // writing to stdout here is safe (no protocol stream yet).
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP_TEXT);
    process.exit(0);
  }
  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    process.exit(0);
  }

  let mode: Mode = "snapshot";
  let transport: Transport = "stdio";
  let network: NetworkName | undefined;
  let wallets: string | undefined;
  let allowMainnetWrites = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mode" && args[i + 1]) {
      const val = args[i + 1];
      if (val !== "snapshot" && val !== "tutorial" && val !== "live") {
        console.error(`Invalid mode: ${val}. Use 'snapshot', 'tutorial', or 'live'.`);
        process.exit(1);
      }
      mode = val as Mode;
    } else if (args[i] === "--transport" && args[i + 1]) {
      const val = args[i + 1];
      if (val !== "stdio" && val !== "http") {
        console.error(`Invalid transport: ${val}. Use 'stdio' or 'http'.`);
        process.exit(1);
      }
      transport = val;
    } else if (args[i] === "--network" && args[i + 1]) {
      const val = args[i + 1];
      if (!(val in NETWORKS)) {
        console.error(`Invalid network: ${val}. Known: ${Object.keys(NETWORKS).join(", ")}.`);
        process.exit(1);
      }
      network = val as NetworkName;
    } else if (args[i] === "--wallets" && args[i + 1]) {
      wallets = args[i + 1];
    } else if (args[i] === "--allow-mainnet-writes") {
      allowMainnetWrites = true;
    }
  }

  const envMode = process.env.MINA_MCP_MODE;
  if (envMode === "tutorial" || envMode === "snapshot" || envMode === "live") {
    mode = envMode;
  }
  if (process.env.MINA_MCP_TRANSPORT === "stdio" || process.env.MINA_MCP_TRANSPORT === "http") {
    transport = process.env.MINA_MCP_TRANSPORT;
  }
  const envNetwork = process.env.MINA_MCP_NETWORK;
  if (envNetwork && envNetwork in NETWORKS) {
    network = envNetwork as NetworkName;
  }
  if (process.env.MINA_MCP_WALLETS) wallets = process.env.MINA_MCP_WALLETS;
  if (process.env.MINA_MCP_ALLOW_MAINNET_WRITES === "1") allowMainnetWrites = true;

  if (mode === "live" && !network) {
    console.error(
      `Mode 'live' requires --network <devnet|mainnet|mesa> (or MINA_MCP_NETWORK).`
    );
    process.exit(1);
  }
  if (mode !== "live" && network) {
    console.error(`--network is only valid with --mode live (got mode '${mode}').`);
    process.exit(1);
  }
  if (wallets && mode !== "live") {
    console.error(`--wallets is only valid with --mode live (got mode '${mode}').`);
    process.exit(1);
  }
  if (wallets && network === "mainnet" && !allowMainnetWrites) {
    console.error(
      `Refusing to load wallets against mainnet without --allow-mainnet-writes ` +
        `(or MINA_MCP_ALLOW_MAINNET_WRITES=1). This is a deliberate safety gate to ` +
        `prevent an agent from accidentally spending real MINA because of a config typo.`
    );
    process.exit(1);
  }

  const httpPort = Number.parseInt(process.env.MINA_MCP_HTTP_PORT ?? "3000", 10);
  if (!Number.isFinite(httpPort) || httpPort <= 0) {
    console.error(`Invalid MINA_MCP_HTTP_PORT: ${process.env.MINA_MCP_HTTP_PORT}`);
    process.exit(1);
  }

  return { mode, transport, httpPort, network, wallets, allowMainnetWrites };
}

async function archiveReachable(client: ArchiveClient | null | undefined): Promise<boolean> {
  if (!client) return false;
  try {
    await client.getNetworkState();
    return true;
  } catch {
    return false;
  }
}

function logProviderHealth(provider: AnyProvider, mode: Mode, db: ArchiveDB) {
  if (mode === "tutorial") {
    const tp = provider as TutorialProvider;
    void Promise.allSettled([
      tp.isDaemonConnected(),
      archiveReachable(tp.archiveApi),
      tp.accountsManager?.isConnected(),
      db.isConnected(),
    ]).then((results) => {
      const status = (r: PromiseSettledResult<unknown>) =>
        r.status === "fulfilled" && r.value ? "connected" : "not reachable";
      console.error(`  Daemon GraphQL (${tp.getDaemonEndpoint()}): ${status(results[0])}`);
      console.error(`  Archive-Node-API (${tp.archiveApi?.graphqlUri}): ${status(results[1])}`);
      console.error(`  Accounts Manager (${tp.accountsManager?.getEndpoint()}): ${status(results[2])}`);
      console.error(`  Archive DB: ${status(results[3])}`);
    });
  } else if (mode === "live") {
    const lp = provider as LiveProvider;
    void Promise.allSettled([
      lp.isDaemonConnected(),
      archiveReachable(lp.archiveApi),
    ]).then((results) => {
      const status = (r: PromiseSettledResult<unknown>) =>
        r.status === "fulfilled" && r.value ? "connected" : "not reachable";
      console.error(`  Network: ${lp.network.name}`);
      console.error(`  Daemon GraphQL (${lp.getDaemonEndpoint()}): ${status(results[0])}`);
      console.error(`  Archive-Node-API (${lp.archiveApi?.graphqlUri}): ${status(results[1])}`);
      if (provider instanceof LiveWriteProvider) {
        console.error(
          `  Wallets loaded (${provider.registry.wallets.length}): ` +
            provider.registry.wallets.map((w) => w.alias).join(", ") +
            (provider.registry.defaultAlias ? ` (default: ${provider.registry.defaultAlias})` : "")
        );
      }
    });
  } else {
    void db.isConnected().then((c) => console.error(`  Archive DB: ${c ? "connected" : "not reachable"}`));
  }
}

function warnWriteMode(network: NetworkName) {
  console.error("");
  console.error("================================================================");
  console.error(" [WARN] LIVE WRITE MODE — EXPERIMENTAL");
  console.error("");
  console.error(" Wallet private keys are loaded UNENCRYPTED into this process's");
  console.error(" memory from disk. This is suitable for ephemeral test wallets");
  console.error(" on devnet/mesa, NOT for keys that hold meaningful value.");
  console.error("");
  console.error(" If you're pointing this at mainnet:");
  console.error("   - Only load wallets you can afford to lose");
  console.error("   - Or: don't. Use a hardware wallet for anything material.");
  console.error("");
  console.error(` Network in use: ${network}`);
  console.error("================================================================");
  console.error("");
}

async function buildLiveProvider(
  network: NetworkConfigArg
): Promise<LiveProvider | LiveWriteProvider> {
  const cfg = resolveNetwork(network.name);
  if (!network.walletsPath) return new LiveProvider(cfg);

  // For mina-signer, "mainnet" requires the mainnet schema, everything else
  // uses the testnet schema.
  const signer = new MinaSigner({
    network: network.name === "mainnet" ? "mainnet" : "testnet",
  });

  let registry: WalletRegistry;
  try {
    registry = await loadWallets(network.walletsPath, { signer });
  } catch (e) {
    if (e instanceof WalletLoadError) {
      console.error(`Wallet load failed: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }

  warnWriteMode(network.name);
  return new LiveWriteProvider(cfg, registry, signer);
}

interface NetworkConfigArg {
  name: NetworkName;
  walletsPath?: string;
}

async function main() {
  const { mode, transport, httpPort, network, wallets } = parseArgs();

  const db = new ArchiveDB();
  let provider: AnyProvider;

  if (mode === "tutorial") {
    const client = createMinaClient();
    const archiveApi = new ArchiveClient(
      process.env.ARCHIVE_API_ENDPOINT ?? "http://localhost:8282"
    );
    const accountsManager = new AccountsManager();
    const tracker = new SessionTracker(accountsManager);
    const resetController = new ResetController();
    provider = new TutorialProvider(db, client, archiveApi, accountsManager, tracker, resetController);
  } else if (mode === "live") {
    provider = await buildLiveProvider({ name: network!, walletsPath: wallets });
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

    const liveSuffix = () => {
      if (mode !== "live") return "";
      const cfg = (provider as LiveProvider).network;
      const writeTag = provider instanceof LiveWriteProvider ? " write-enabled" : "";
      const tag = cfg.stability === "preflight" ? `${network} [PREFLIGHT]${writeTag}` : `${network}${writeTag}`;
      return ` (network: ${tag})`;
    };
    console.error(`Mina MCP server started in ${mode} mode (stdio)${liveSuffix()}`);
  } else {
    const httpServer = await startHttpServer({ port: httpPort, provider, mode });
    const liveSuffix = () => {
      if (mode !== "live") return "";
      const cfg = (provider as LiveProvider).network;
      const writeTag = provider instanceof LiveWriteProvider ? " write-enabled" : "";
      const tag = cfg.stability === "preflight" ? `${network} [PREFLIGHT]${writeTag}` : `${network}${writeTag}`;
      return ` (network: ${tag})`;
    };
    console.error(`Mina MCP server started in ${mode} mode (http) on :${httpServer.port}${liveSuffix()}`);
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
