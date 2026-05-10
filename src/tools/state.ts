import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SnapshotProvider } from "../providers/snapshot.js";
import { TutorialProvider } from "../providers/tutorial.js";
import { STDIO_SESSION_ID } from "../session/tracker.js";

const HINTS = [
  "Call `faucet` to acquire a pre-funded test account (1550 MINA, ready to sign).",
  "After `faucet`, use `send_payment` or `send_delegation`; the key is already unlocked.",
  "Use `get_mempool` to watch pending transactions before they're included in a block.",
  "Use `get_transaction_status` with a payment id to track a tx through the pipeline.",
  "Use `query_archive_sql` for read-only SQL against the archive DB; `get_archive_schema` first if you don't know the tables.",
  "Use `get_events` / `get_actions` for zkApp event/action queries via the Archive-Node-API.",
  "Call `reset_session` to release every account you've acquired this session.",
  "Before a human demo, call `freeze_reset` to pause the periodic chain reset.",
];

interface StateSnapshot {
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

export function registerStateTools(
  server: McpServer,
  getProvider: () => SnapshotProvider | TutorialProvider
) {
  server.tool(
    "describe_state",
    "[infra] Snapshot of the live network: sync, latest block, mempool size, accounts in use (server-wide and this session), reset-freeze status, plus suggested next-tool hints. Call this first to orient yourself before issuing more specific queries.",
    {},
    async (_args, extra) => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider)) {
        return { content: [{ type: "text", text: "This tool requires tutorial mode." }] };
      }

      const sessionId = extra.sessionId ?? STDIO_SESSION_ID;
      const [chainResult, mempoolResult, acquiredResult] = await Promise.allSettled([
        provider.getDaemonStatus(),
        provider.getMempool(),
        provider.accountsManager?.listAcquiredAccounts() ?? Promise.resolve([]),
      ]);

      const snapshot: StateSnapshot = {
        mode: "tutorial",
        chain: {},
        mempool: {},
        accounts: {},
        reset: provider.resetController?.getStatus() ?? { frozen: false, frozenUntil: null, remainingMs: null },
        hints: HINTS,
      };

      if (chainResult.status === "fulfilled") {
        const status = (chainResult.value as { daemonStatus?: Record<string, unknown> } | null)?.daemonStatus ?? {};
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
