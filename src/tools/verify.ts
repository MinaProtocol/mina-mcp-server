import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  compareToClaims,
  verifyPrecomputedBlock,
  VerificationBackendError,
  type VerifiedBlock,
} from "@o1-labs/mina-sdk";
import { AnyProvider, Mode } from "../server-factory.js";
import { LiveProvider } from "../providers/live.js";
import { NetworkConfig } from "../networks.js";

// Networks whose verification key is embedded in mina-verify-wasm. Verification
// is only possible for these; mesa/mesa-mut have no embedded VK.
const VERIFIABLE_NETWORKS = new Set(["devnet", "mainnet"]);

// The precomputed block for the live tip can lag a little behind the daemon's
// best tip, so when verifying "the tip" we walk a few blocks back until we find
// one the bucket has published.
const TIP_SEARCH_DEPTH = 8;
const BLOCK_FETCH_TIMEOUT_MS = 45_000;

/** Returns the active provider iff it is a live provider on a verifiable network. */
function verifiableLive(provider: AnyProvider): LiveProvider | null {
  if (
    provider instanceof LiveProvider &&
    provider.network.precomputedBlockBaseUrl &&
    VERIFIABLE_NETWORKS.has(provider.network.name)
  ) {
    return provider;
  }
  return null;
}

function precomputedUrl(cfg: NetworkConfig, height: number, stateHash: string): string {
  return `${cfg.precomputedBlockBaseUrl}/${cfg.name}-${height}-${stateHash}.json`;
}

/** Fetch a precomputed block JSON from the bucket. Returns null on 404 (not yet
 * published / wrong hash), throws on other transport errors. */
async function fetchPrecomputedBlock(
  cfg: NetworkConfig,
  height: number,
  stateHash: string,
): Promise<string | null> {
  const res = await fetch(precomputedUrl(cfg, height, stateHash), {
    signal: AbortSignal.timeout(BLOCK_FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetching precomputed block: HTTP ${res.status}`);
  return res.text();
}

const network = z
  .enum(["devnet", "mainnet"])
  .optional()
  .describe("Override the verification-key network. Defaults to the active network.");

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function backendHint(e: unknown): string | null {
  if (e instanceof VerificationBackendError) {
    return (
      "Verification backend not available. The proof verifier is an optional WebAssembly " +
      "package; install it where the MCP server runs:\n\n    npm install mina-verify-wasm\n\n" +
      `(${e.message})`
    );
  }
  return null;
}

/**
 * Registers the trustless-verification tools (live mode, devnet/mainnet only):
 *   - verify_chain_tip       — prove the chain tip is valid (its SNARK proof verifies)
 *   - check_endpoint_honesty — prove the daemon's claims match a proof-verified block
 *
 * Both fetch the canonical precomputed block from the public bucket and verify its
 * Pickles/kimchi proof via @o1-labs/mina-sdk (backed by the mina-verify-wasm package).
 * A verifying block attests the entire chain to genesis by recursion, so trust in the
 * bucket is NOT required: a forged block simply won't verify.
 *
 * NOTE: verification is CPU-bound and currently takes ~tens of seconds, during which
 * the call blocks. Intended for occasional integrity checks, not hot paths.
 */
export function registerVerifyTools(
  server: McpServer,
  getProvider: () => AnyProvider,
  mode: Mode,
) {
  if (mode !== "live") return;
  if (!verifiableLive(getProvider())) return;

  server.tool(
    "verify_chain_tip",
    "[live][devnet/mainnet] Cryptographically verify the chain tip. Fetches the canonical " +
      "precomputed block from the public block bucket and checks its Pickles/kimchi SNARK proof; " +
      "a valid proof attests the ENTIRE chain back to genesis by recursion, with no trust in the " +
      "daemon or the bucket (a forged block won't verify). Pass height+stateHash to verify a " +
      "specific block, else the most recent published tip is used. WARNING: CPU-bound, blocks for " +
      "~tens of seconds. Requires the optional `mina-verify-wasm` package.",
    {
      height: z.number().optional().describe("Verify this height (requires stateHash too)."),
      stateHash: z.string().optional().describe("Verify this state hash (requires height too)."),
      network,
    },
    async ({ height, stateHash, network: net }) => {
      const provider = verifiableLive(getProvider());
      if (!provider) {
        return text("verify_chain_tip is only available in live mode on devnet or mainnet.");
      }
      const cfg = provider.network;
      const vkNetwork = (net ?? cfg.name) as "devnet" | "mainnet";

      try {
        // Resolve the target block + its precomputed JSON.
        let json: string | null = null;
        let target = "";
        if (height != null && stateHash != null) {
          json = await fetchPrecomputedBlock(cfg, height, stateHash);
          target = `${height}-${stateHash}`;
          if (!json) return text(`No precomputed block published at ${target} (HTTP 404).`);
        } else {
          // Walk the best chain from the tip down to the first published block.
          const chain = await provider.getBestChain(TIP_SEARCH_DEPTH);
          const candidates = [...chain].reverse(); // tip first
          for (const b of candidates) {
            if (b.stateHash == null || b.height == null) continue;
            json = await fetchPrecomputedBlock(cfg, b.height, b.stateHash);
            if (json) {
              target = `${b.height}-${b.stateHash}`;
              break;
            }
          }
          if (!json) {
            return text(
              `No precomputed block published yet for any of the last ${TIP_SEARCH_DEPTH} tips. ` +
                "The bucket lags the live tip slightly — try again shortly, or pass an older height+stateHash.",
            );
          }
        }

        const facts = verifyPrecomputedBlock(json, { network: vkNetwork });
        return text(
          `VERIFIED ✓ — the ${cfg.name} chain tip is cryptographically valid.\n\n` +
            `  height              ${facts.height}\n` +
            `  state_hash          ${facts.stateHash}\n` +
            `  previous_state_hash ${facts.previousStateHash}\n` +
            `  staged_ledger_hash  ${facts.stagedLedgerHash}\n\n` +
            "Its Pickles/kimchi SNARK proof verifies, which by recursion attests every ancestor " +
            "back to genesis. No trust in the daemon or the block bucket was required.",
        );
      } catch (e) {
        const hint = backendHint(e);
        if (hint) return text(hint);
        return text(`Verification failed: ${(e as Error).message}`);
      }
    },
  );

  server.tool(
    "check_endpoint_honesty",
    "[live][devnet/mainnet] Check whether the connected daemon's GraphQL is telling the truth. " +
      "Reads the daemon's claimed block facts (state hash, height, ledger hashes), independently " +
      "fetches the canonical precomputed block and verifies its SNARK proof, then compares: if the " +
      "daemon's claims don't match the proof-attested facts, the daemon is serving inconsistent or " +
      "invalid data. Pass height+stateHash to check a specific block, else the tip is used. " +
      "WARNING: CPU-bound, blocks for ~tens of seconds. Requires the optional `mina-verify-wasm` package.",
    {
      height: z.number().optional().describe("Check this height (requires stateHash too)."),
      stateHash: z.string().optional().describe("Check this state hash (requires height too)."),
      network,
    },
    async ({ height, stateHash, network: net }) => {
      const provider = verifiableLive(getProvider());
      if (!provider) {
        return text("check_endpoint_honesty is only available in live mode on devnet or mainnet.");
      }
      const cfg = provider.network;
      const vkNetwork = (net ?? cfg.name) as "devnet" | "mainnet";

      try {
        // What the daemon CLAIMS about the target block.
        const chain = await provider.getBestChain(TIP_SEARCH_DEPTH);
        let claim: Partial<VerifiedBlock> & { height: number; stateHash: string };
        if (height != null && stateHash != null) {
          const match = chain.find((b) => b.height === height && b.stateHash === stateHash);
          claim = {
            height,
            stateHash,
            previousStateHash: match?.previousStateHash,
            stagedLedgerHash: match?.stagedLedgerHash,
          };
        } else {
          // Most recent tip the bucket has published, using the daemon's own claim for it.
          const candidates = [...chain].reverse();
          let picked: (typeof chain)[number] | undefined;
          let json: string | null = null;
          for (const b of candidates) {
            if (b.stateHash == null || b.height == null) continue;
            json = await fetchPrecomputedBlock(cfg, b.height, b.stateHash);
            if (json) {
              picked = b;
              break;
            }
          }
          if (!picked || !json) {
            return text(
              `No precomputed block published yet for any of the last ${TIP_SEARCH_DEPTH} tips; ` +
                "cannot cross-check the daemon right now. Try again shortly.",
            );
          }
          const facts = verifyPrecomputedBlock(json, { network: vkNetwork });
          const result = compareToClaims(facts, {
            height: picked.height,
            stateHash: picked.stateHash,
            previousStateHash: picked.previousStateHash,
            stagedLedgerHash: picked.stagedLedgerHash,
          });
          return renderHonesty(cfg.name, result);
        }

        // Specific block path.
        const json = await fetchPrecomputedBlock(cfg, claim.height, claim.stateHash);
        if (!json) {
          return text(
            `DISHONEST / UNVERIFIABLE ✗ — the daemon reports tip ${claim.height}-${claim.stateHash}, ` +
              "but no canonical precomputed block exists at that (height, state hash). The daemon's " +
              "claimed block is not a published, proof-backed block.",
          );
        }
        const facts = verifyPrecomputedBlock(json, { network: vkNetwork });
        return renderHonesty(cfg.name, compareToClaims(facts, claim));
      } catch (e) {
        const hint = backendHint(e);
        if (hint) return text(hint);
        return text(`Honesty check failed: ${(e as Error).message}`);
      }
    },
  );
}

function renderHonesty(
  networkName: string,
  result: ReturnType<typeof compareToClaims>,
) {
  const { honest, facts, mismatches } = result;
  if (honest) {
    return text(
      `HONEST ✓ — the ${networkName} daemon's claims match the proof-verified block.\n\n` +
        `  height              ${facts.height}\n` +
        `  state_hash          ${facts.stateHash}\n` +
        `  staged_ledger_hash  ${facts.stagedLedgerHash}\n\n` +
        "Every field the daemon reported agrees with what the SNARK proof attests.",
    );
  }
  const lines = mismatches
    .map((m) => `  ${m.field}: daemon says ${JSON.stringify(m.claimed)}, proof says ${JSON.stringify(m.actual)}`)
    .join("\n");
  return text(
    `DISHONEST ✗ — the ${networkName} daemon's claims disagree with the proof-verified block:\n\n` +
      `${lines}\n\n` +
      "The proof-attested values are authoritative. Treat this endpoint's data as untrustworthy.",
  );
}
