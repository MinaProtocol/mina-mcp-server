import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AnyProvider, Mode } from "../server-factory.js";
import { LiveProvider } from "../providers/live.js";

// Mesa Upgrade Test (mesa-mut) hardfork tracker — the source of truth for the
// upgrade schedule (phase + the slots at which transactions and then the
// network stop, and the Mesa genesis timestamp).
const MESA_MUT_TRACKER_URL = "https://mesa-upgrade-tracker.minaprotocol.com/status.json";

// mesa-mut runs the mainnet protocol config (180s slots). Used only to turn a
// slot delta into a rough wall-clock estimate; mesaGenesisTimestamp from the
// tracker remains the authoritative time.
const SLOT_DURATION_SEC = 180;

// Network reachability budget for the tracker fetch.
const TRACKER_TIMEOUT_MS = 15_000;

interface TrackerStatus {
  currentPhase?: string;
  network?: string;
  lastUpdated?: string;
  slots?: { stopTransactionSlot?: number; stopNetworkSlot?: number };
  autoHardForkDelta?: number;
  mesaGenesisTimestamp?: string;
  genesisConfig?: { timestamp?: string; ledgerHash?: string };
  endpoints?: Record<string, string>;
}

// Returns the active provider iff it is a live mesa-mut provider, else null.
function liveMesaMut(provider: AnyProvider): LiveProvider | null {
  if (provider instanceof LiveProvider && provider.network.name === "mesa-mut") {
    return provider;
  }
  return null;
}

function roundMinutes(slots: number): number {
  return Math.round((slots * SLOT_DURATION_SEC) / 60);
}

/**
 * Registers `get_upgrade_status`, scoped to the mesa-mut network. It joins the
 * upgrade tracker (status.json) with the live daemon's current global slot to
 * report which hardfork phase the network is in and what an agent should do —
 * crucially, whether transactions will still be accepted.
 */
export function registerUpgradeTools(
  server: McpServer,
  getProvider: () => AnyProvider,
  mode: Mode
) {
  if (mode !== "live") return;
  // mesa-mut is the only network with a hardfork upgrade tracker today.
  if (!liveMesaMut(getProvider())) return;

  server.tool(
    "get_upgrade_status",
    "[live][mesa-mut] Mesa hardfork upgrade status for the mesa-mut network. Fetches the upgrade " +
      "tracker (mesa-upgrade-tracker.minaprotocol.com) and joins it with the live daemon's current " +
      "global slot to report the current phase and how many slots remain until transactions stop " +
      "(stopTransactionSlot), until the network halts (stopNetworkSlot), and until the Mesa genesis. " +
      "Returns structured fields plus hints[] — check `transactionsOpen` before submitting any send: " +
      "transactions submitted after stopTransactionSlot are dropped. Only available on --network mesa-mut.",
    {},
    async () => {
      const provider = liveMesaMut(getProvider());
      if (!provider) {
        return {
          content: [
            {
              type: "text",
              text: "get_upgrade_status is only available in live mode against --network mesa-mut.",
            },
          ],
        };
      }

      // 1. Upgrade tracker (schedule). Degrade gracefully if unreachable.
      let tracker: TrackerStatus | null = null;
      let trackerError: string | null = null;
      try {
        const res = await fetch(MESA_MUT_TRACKER_URL, {
          signal: AbortSignal.timeout(TRACKER_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        tracker = (await res.json()) as TrackerStatus;
      } catch (e) {
        trackerError = (e as Error).message;
      }

      // 2. Live daemon current global slot (since this chain's genesis).
      let currentSlot: number | null = null;
      let blockchainLength: number | null = null;
      let slotError: string | null = null;
      try {
        const data = await provider.client.executeQuery<{
          daemonStatus?: {
            consensusTimeNow?: { globalSlot?: string | number };
            blockchainLength?: number;
          };
        }>(
          "{ daemonStatus { consensusTimeNow { globalSlot } blockchainLength } }",
          undefined,
          "upgradeStatus"
        );
        const gs = data?.daemonStatus?.consensusTimeNow?.globalSlot;
        currentSlot = gs != null ? Number(gs) : null;
        blockchainLength = data?.daemonStatus?.blockchainLength ?? null;
      } catch (e) {
        slotError = (e as Error).message;
      }

      const stopTx = tracker?.slots?.stopTransactionSlot ?? null;
      const stopNet = tracker?.slots?.stopNetworkSlot ?? null;
      const hints: string[] = [];

      // Derive the live phase + remaining slots when we have both inputs.
      let transactionsOpen: boolean | null = null;
      let livePhase: string | null = null;
      let slotsUntilStopTransaction: number | null = null;
      let slotsUntilStopNetwork: number | null = null;

      if (currentSlot != null && stopTx != null && stopNet != null) {
        slotsUntilStopTransaction = stopTx - currentSlot;
        slotsUntilStopNetwork = stopNet - currentSlot;
        if (currentSlot < stopTx) {
          transactionsOpen = true;
          livePhase = "pre-upgrade (transactions open)";
          hints.push(
            `Transactions are OPEN. They stop at slot ${stopTx} — in ~${slotsUntilStopTransaction} slots ` +
              `(~${roundMinutes(slotsUntilStopTransaction)} min). Sends submitted after that are dropped.`
          );
        } else if (currentSlot < stopNet) {
          transactionsOpen = false;
          livePhase = "transactions stopped (awaiting network halt)";
          hints.push(
            `Transactions are STOPPED (current slot ${currentSlot} ≥ stopTransactionSlot ${stopTx}). ` +
              `Do NOT submit sends — they will be dropped. The network halts at slot ${stopNet} ` +
              `(~${slotsUntilStopNetwork} slots / ~${roundMinutes(slotsUntilStopNetwork)} min).`
          );
        } else {
          transactionsOpen = false;
          livePhase = "network halted (awaiting Mesa genesis)";
          hints.push(
            `The pre-fork network has HALTED (current slot ${currentSlot} ≥ stopNetworkSlot ${stopNet}). ` +
              `The Mesa hardfork genesis is scheduled for ${tracker?.mesaGenesisTimestamp ?? "(see tracker)"}. ` +
              `After genesis this is a NEW chain — re-fetch genesis constants and treat prior state as historical.`
          );
        }
      }

      if (tracker?.mesaGenesisTimestamp) {
        hints.push(`Mesa genesis (hardfork) timestamp: ${tracker.mesaGenesisTimestamp}.`);
      }
      if (trackerError) {
        hints.push(
          `Upgrade tracker unreachable (${trackerError}); reporting live slot only. ` +
            `Check ${MESA_MUT_TRACKER_URL} manually for the schedule.`
        );
      }
      if (slotError) {
        hints.push(`Could not read the live daemon slot (${slotError}); reporting tracker schedule only.`);
      }
      hints.push(
        "mesa-mut is a PREFLIGHT upgrade-rehearsal network — it will be reset/retired without notice. " +
          "Treat all data as ephemeral."
      );

      const result = {
        network: "mesa-mut",
        trackerUrl: MESA_MUT_TRACKER_URL,
        trackerPhase: tracker?.currentPhase ?? null,
        livePhase,
        transactionsOpen,
        currentSlot,
        blockchainLength,
        stopTransactionSlot: stopTx,
        stopNetworkSlot: stopNet,
        slotsUntilStopTransaction,
        slotsUntilStopNetwork,
        autoHardForkDelta: tracker?.autoHardForkDelta ?? null,
        mesaGenesisTimestamp: tracker?.mesaGenesisTimestamp ?? null,
        genesisConfig: tracker?.genesisConfig ?? null,
        trackerLastUpdated: tracker?.lastUpdated ?? null,
        hints,
      };

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
