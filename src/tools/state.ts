import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AnyProvider, Mode } from "../server-factory.js";
import { TutorialProvider } from "../providers/tutorial.js";
import { LiveProvider } from "../providers/live.js";
import { LiveWriteProvider } from "../providers/live-write.js";
import { NetworkConfig } from "../networks.js";
import { STDIO_SESSION_ID } from "../session/tracker.js";

function faucetHint(cfg: NetworkConfig): string | null {
  if (!cfg.faucetUrl) return null;
  let hint =
    `If a human user needs test MINA on ${cfg.name}, direct them to ${cfg.faucetUrl} — ` +
    `it is a web form, not an API, so the agent cannot call it directly.`;
  if (cfg.faucetNote) hint += ` ${cfg.faucetNote}`;
  return hint;
}

function rosettaHint(cfg: NetworkConfig): string | null {
  if (!cfg.rosettaUrl) return null;
  return (
    `Mina-Rosetta (Coinbase spec) Data API is available on ${cfg.name} via ` +
    `\`rosetta_status\`, \`rosetta_account\`, \`rosetta_block\`, \`rosetta_mempool\`, ` +
    `and \`rosetta_mempool_transaction\` — use these when the caller wants ` +
    `standardized Rosetta-format responses. Underlying endpoint: ${cfg.rosettaUrl}.`
  );
}

const TUTORIAL_HINTS = [
  "Call `faucet` to acquire a pre-funded test account (1550 MINA, ready to sign).",
  "After `faucet`, use `send_payment` or `send_delegation`; the key is already unlocked.",
  "Use `get_mempool` to watch pending transactions before they're included in a block.",
  "Use `get_transaction_status` with a payment id to track a tx through the pipeline.",
  "Use `query_archive_sql` for read-only SQL against the archive DB; `get_archive_schema` first if you don't know the tables.",
  "Use `get_events` / `get_actions` for zkApp event/action queries via the Archive-Node-API.",
  "Call `reset_session` to release every account you've acquired this session.",
  "Before a human demo, call `freeze_reset` to pause the periodic chain reset.",
];

const LIVE_HINTS = [
  "This is a public read-only Mina network — no faucet, no daemon-side signing, no archive DB.",
  "Use `get_archive_blocks` to discover recent block heights/state hashes, then `get_block` with a stateHash.",
  "Use `get_events` / `get_actions` (Archive-Node-API) for zkApp event/action queries.",
  "Use `get_account` to inspect any B62q… address. `get_best_chain` returns the daemon's recent tip.",
  "Use `get_mempool` to look at pending transactions on this public network.",
];

const PREFLIGHT_HINT =
  "WARNING: this network is a PREFLIGHT/preview network — it may be reset, " +
  "renamed, or retired without notice. Endpoints and dump filenames are not " +
  "guaranteed to remain stable. If you hit endpoint errors, fall back to a " +
  "stable network (devnet or mainnet).";

interface TutorialSnapshot {
  mode: string;
  chain: {
    syncStatus?: string;
    blockchainLength?: number | null;
    stateHash?: string | null;
    error?: string;
  };
  mempool: { size?: number; error?: string };
  accounts: { acquired?: number; thisSession?: number; error?: string };
  reset: { frozen: boolean; frozenUntil: number | null; remainingMs: number | null };
  hints: string[];
}

interface LiveSnapshot {
  mode: string;
  network: {
    name: string;
    stability: "stable" | "preflight";
    daemonGraphql: string;
    archiveNodeApi: string;
  };
  chain: {
    syncStatus?: string;
    blockchainLength?: number | null;
    stateHash?: string | null;
    error?: string;
  };
  mempool: { size?: number; error?: string };
  // Only present in live-write mode. Public keys + aliases only — private
  // keys never appear here. balanceError is set when get_account threw for
  // that wallet (rate limit, transient blip).
  wallets?: Array<{
    alias: string;
    publicKey: string;
    balance?: string | null;
    nonce?: number | null;
    balanceError?: string;
    isDefault?: boolean;
  }>;
  hints: string[];
}

const WRITE_MODE_HINTS = [
  "Live-WRITE mode: send_payment and send_delegation are available and will sign client-side with mina-signer.",
  "Use `list_wallets` (or this state's `wallets` field) to see which aliases are configured.",
  "Pass `from_alias` to send_payment / send_delegation, or rely on the default wallet if one is set.",
  "Try `send_payment` with `dry_run: true` first to see the signed payload without submitting.",
];

export function registerStateTools(
  server: McpServer,
  getProvider: () => AnyProvider,
  mode: Mode
) {
  if (mode === "snapshot") return;

  server.tool(
    "describe_state",
    mode === "live"
      ? "[infra] Snapshot of the live public network: sync, latest block, mempool size, plus suggested next-tool hints. Call this first to orient yourself."
      : "[infra] Snapshot of the live network: sync, latest block, mempool size, accounts in use (server-wide and this session), reset-freeze status, plus suggested next-tool hints. Call this first to orient yourself before issuing more specific queries.",
    {},
    async (_args, extra) => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider)) {
        return { content: [{ type: "text", text: "This tool requires a live daemon connection." }] };
      }

      const sessionId = extra.sessionId ?? STDIO_SESSION_ID;
      const [chainResult, mempoolResult, acquiredResult] = await Promise.allSettled([
        provider.getDaemonStatus(),
        provider.getMempool(),
        provider.accountsManager?.listAcquiredAccounts() ?? Promise.resolve([]),
      ]);

      if (provider instanceof LiveProvider) {
        const isPreflight = provider.network.stability === "preflight";
        const isWrite = provider instanceof LiveWriteProvider;
        const faucet = faucetHint(provider.network);
        const rosetta = rosettaHint(provider.network);
        const snapshot: LiveSnapshot = {
          mode: "live",
          network: {
            name: provider.network.name,
            stability: provider.network.stability,
            daemonGraphql: provider.network.daemonGraphql,
            archiveNodeApi: provider.network.archiveNodeApi,
          },
          chain: {},
          mempool: {},
          // Order: preflight warning first (loudest signal), write-mode
          // hints next so an LLM picks up that send_payment is available,
          // then generic live hints, then per-network pointers.
          hints: [
            ...(isPreflight ? [PREFLIGHT_HINT] : []),
            ...(isWrite ? WRITE_MODE_HINTS : []),
            ...LIVE_HINTS,
            ...(faucet ? [faucet] : []),
            ...(rosetta ? [rosetta] : []),
          ],
        };
        if (chainResult.status === "fulfilled") {
          // SDK getDaemonStatus returns a typed DaemonStatus directly (no
          // `{ daemonStatus: … }` envelope from the raw GraphQL shape).
          const status = (chainResult.value as unknown as Record<string, unknown> | null) ?? {};
          snapshot.chain.syncStatus = status.syncStatus as string | undefined;
          snapshot.chain.blockchainLength = (status.blockchainLength as number | null) ?? null;
          snapshot.chain.stateHash = (status.stateHash as string | null) ?? null;
        } else {
          snapshot.chain.error = (chainResult.reason as Error)?.message ?? "unknown";
        }
        if (mempoolResult.status === "fulfilled") {
          snapshot.mempool.size = Array.isArray(mempoolResult.value) ? mempoolResult.value.length : 0;
        } else {
          snapshot.mempool.error = (mempoolResult.reason as Error)?.message ?? "unknown";
        }
        if (provider instanceof LiveWriteProvider) {
          const walletSummaries = await provider.listWallets();
          snapshot.wallets = walletSummaries.map((w) => ({
            ...w,
            isDefault: provider.registry.defaultAlias === w.alias ? true : undefined,
          }));
        }
        return { content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }] };
      }

      const snapshot: TutorialSnapshot = {
        mode: "tutorial",
        chain: {},
        mempool: {},
        accounts: {},
        reset: provider.resetController?.getStatus() ?? { frozen: false, frozenUntil: null, remainingMs: null },
        hints: TUTORIAL_HINTS,
      };

      if (chainResult.status === "fulfilled") {
        // SDK getDaemonStatus returns a typed DaemonStatus directly (no
        // `{ daemonStatus: … }` envelope from the raw GraphQL shape).
        const status = (chainResult.value as unknown as Record<string, unknown> | null) ?? {};
        snapshot.chain.syncStatus = status.syncStatus as string | undefined;
        snapshot.chain.blockchainLength = (status.blockchainLength as number | null) ?? null;
        snapshot.chain.stateHash = (status.stateHash as string | null) ?? null;
      } else {
        snapshot.chain.error = (chainResult.reason as Error)?.message ?? "unknown";
      }

      if (mempoolResult.status === "fulfilled") {
        snapshot.mempool.size = Array.isArray(mempoolResult.value) ? mempoolResult.value.length : 0;
      } else {
        snapshot.mempool.error = (mempoolResult.reason as Error)?.message ?? "unknown";
      }

      if (acquiredResult.status === "fulfilled") {
        snapshot.accounts.acquired = (acquiredResult.value as Array<unknown>).length;
      } else {
        snapshot.accounts.error = (acquiredResult.reason as Error)?.message ?? "unknown";
      }

      snapshot.accounts.thisSession = provider.tracker?.getSessionAccounts(sessionId).length ?? 0;

      return { content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }] };
    }
  );
}
