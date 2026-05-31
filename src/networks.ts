// Public Mina network endpoints exposed by o1labs/MinaProtocol on GCP.
// These are best-effort services without SLAs — see the source-of-truth doc
// for the canonical URLs (subject to change at any time).

export type NetworkName = "devnet" | "mainnet" | "mesa" | "mesa-mut";

// "stable"   — long-lived network we expect to keep around (devnet, mainnet).
// "preflight" — short-lived ops/staging network. May be renamed, reset, or
//   retired without notice; endpoint URLs and archive-dump filenames are not
//   guaranteed to remain stable. Tools that connect to a preflight network
//   surface this in their startup banner and in `describe_state`.
export type NetworkStability = "stable" | "preflight";

// Cadence at which the archive dump is published to mina-archive-dumps.
// Used by snapshot-mode tooling to pick a fallback hour when today's dump
// hasn't landed yet.
export type ArchiveDumpCadence = "daily" | "twice-daily";

export interface NetworkConfig {
  name: NetworkName;
  description: string;
  stability: NetworkStability;
  daemonGraphql: string;
  archiveNodeApi: string;
  // Human-facing faucet URL for funding accounts on this network. The MCP
  // server can't call it (it's a web form, not an API), but surfacing it in
  // describe_state lets an LLM hand a human the right link in one tool call.
  // Mainnet has none — real MINA is acquired via exchanges.
  faucetUrl?: string;
  // Optional extra guidance appended to the faucet hint — e.g. which button to
  // click on the shared form, or whether funding is currently available. The
  // faucet.minaprotocol.com form has per-network buttons; some are gated
  // (e.g. mesa-mut's stays disabled until the network forks).
  faucetNote?: string;
  // Mina-Rosetta endpoint for this network. Standard Rosetta API
  // (Coinbase spec) — usable for exchange-style integrations and
  // construction flows.
  rosettaUrl?: string;
  // The `network` field inside Rosetta's `network_identifier` ({blockchain,
  // network}) for this endpoint. Often matches `name`, but NOT always —
  // mesa's Rosetta uses "testnet". Only meaningful when rosettaUrl is set.
  rosettaNetwork?: string;
  // Snapshot mode (docker-compose.snapshot.yml --profile download): the dump
  // is fetched from
  //   https://storage.googleapis.com/mina-archive-dumps/${archiveDumpPrefix}-${date}_${hour}.sql.tar.gz
  // The prefix is the ONLY thing that differs per network. Optional: networks
  // without a published archive dump (e.g. short-lived upgrade-test forks) omit
  // these, and snapshot mode is simply unavailable for them.
  archiveDumpPrefix?: string;
  archiveDumpCadence?: ArchiveDumpCadence;
}

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  devnet: {
    name: "devnet",
    description: "Mina public devnet — for development against a live network.",
    stability: "stable",
    daemonGraphql: "https://devnet-plain-1.gcp.o1test.net/graphql",
    archiveNodeApi: "https://devnet-archive-node-api.gcp.o1test.net",
    // Shared faucet UI — network is selectable in the form.
    faucetUrl: "https://faucet.minaprotocol.com",
    rosettaUrl: "https://devnet-rosetta.gcp.o1test.net",
    rosettaNetwork: "devnet",
    archiveDumpPrefix: "devnet-archive-dump",
    archiveDumpCadence: "daily",
  },
  mainnet: {
    name: "mainnet",
    description: "Mina mainnet — production network, read-only via MCP.",
    stability: "stable",
    daemonGraphql: "https://mainnet-plain-1.gcp.o1test.net/graphql",
    archiveNodeApi: "https://archive-node-api.gcp.o1test.net",
    // No faucet — production network, real MINA is acquired via exchanges.
    rosettaUrl: "https://mainnet-rosetta.gcp.o1test.net",
    rosettaNetwork: "mainnet",
    archiveDumpPrefix: "mainnet-archive-dump",
    archiveDumpCadence: "daily",
  },
  mesa: {
    name: "mesa",
    description:
      "Mina mesa public testnet — preflight/preview network for testing pre-release builds. " +
      "Not guaranteed to persist: endpoints, prefix, and even the network itself may be reset or retired without notice.",
    stability: "preflight",
    daemonGraphql: "https://plain-1-graphql.mina-mesa-network.gcp.o1test.net/graphql",
    archiveNodeApi: "https://mesa-archive-node-api.gcp.o1test.net",
    // Same faucet UI as devnet; mesa is one of the network options in the form.
    faucetUrl: "https://faucet.minaprotocol.com",
    rosettaUrl: "https://rosetta.mina-mesa-network.gcp.o1test.net",
    // Mesa's Rosetta endpoint exposes itself as "testnet" (not "mesa") —
    // verified via /network/list. Keep this exact string in sync with the
    // endpoint, otherwise every Rosetta call will get rejected.
    rosettaNetwork: "testnet",
    // Preflight ops-naming, not a stable convention — likely to change when
    // mesa graduates. Document this prominently anywhere it's surfaced to users.
    archiveDumpPrefix: "hetzner-pre-mesa-1-archive-dump",
    archiveDumpCadence: "twice-daily",
  },
  "mesa-mut": {
    name: "mesa-mut",
    description:
      "Mina Mesa Upgrade Test (MUT) — a fork of mainnet state used to rehearse the Mesa " +
      "hardfork upgrade (see https://mesa-upgrade-tracker.minaprotocol.com/status.json). " +
      "Preflight: short-lived and tied to the upgrade rehearsal — it may be reset or retired " +
      "without notice, and endpoints are not guaranteed stable. Although the genesis is a " +
      "mainnet-state fork, the daemon reports networkID 'mina:testnet', so signatures use the " +
      "testnet schema (same as devnet/mesa).",
    stability: "preflight",
    daemonGraphql: "https://plain-1-graphql.mesa-mut.minaprotocol.com/graphql",
    archiveNodeApi: "https://archive-node-api.mesa-mut.minaprotocol.com",
    // Shared faucet UI. mesa-mut is funded via the "Trailblazer (mesa)" button,
    // which stays GREYED OUT until mesa-mut forks (genesis 2026-06-03). Pre-fork
    // the faucet can't fund mesa-mut — use accounts carried over from the
    // mainnet-state fork instead. The form's four buttons are: devnet, mesa,
    // Trailblazer (berkeley), and Trailblazer (mesa).
    faucetUrl: "https://faucet.minaprotocol.com",
    faucetNote:
      'On the form pick the "Trailblazer (mesa)" button. It is greyed out ' +
      "until mesa-mut forks, so faucet funding is unavailable before the fork; " +
      "until then, use accounts carried over from the mainnet-state fork.",
    // No Mina-Rosetta endpoint published — rosetta_* tools are not registered.
    // No public archive dump published — snapshot mode is unavailable.
  },
};

export function resolveNetwork(name: string): NetworkConfig {
  const cfg = NETWORKS[name as NetworkName];
  if (!cfg) {
    const known = Object.keys(NETWORKS).join(", ");
    throw new Error(`Unknown network '${name}'. Known: ${known}.`);
  }
  return cfg;
}

export function preflightWarning(cfg: NetworkConfig): string | null {
  if (cfg.stability !== "preflight") return null;
  return (
    `[WARN] Network '${cfg.name}' is a PREFLIGHT network: it may be reset, ` +
    `renamed, or retired without notice. Endpoints and archive-dump filenames ` +
    `are not guaranteed to remain stable. Treat any data you gather as ephemeral.`
  );
}
