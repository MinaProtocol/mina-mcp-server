// Public Mina network endpoints exposed by o1labs/MinaProtocol on GCP.
// These are best-effort services without SLAs — see the source-of-truth doc
// for the canonical URLs (subject to change at any time).

export type NetworkName = "devnet" | "mainnet" | "mesa";

export interface NetworkConfig {
  name: NetworkName;
  description: string;
  daemonGraphql: string;
  archiveNodeApi: string;
}

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  devnet: {
    name: "devnet",
    description: "Mina public devnet — for development against a live network.",
    daemonGraphql: "https://devnet-plain-1.gcp.o1test.net/graphql",
    archiveNodeApi: "https://devnet-archive-node-api.gcp.o1test.net",
  },
  mainnet: {
    name: "mainnet",
    description: "Mina mainnet — production network, read-only via MCP.",
    daemonGraphql: "https://mainnet-plain-1.gcp.o1test.net/graphql",
    archiveNodeApi: "https://archive-node-api.gcp.o1test.net",
  },
  mesa: {
    name: "mesa",
    description: "Mina mesa public testnet — for testing pre-release builds.",
    daemonGraphql: "https://plain-1-graphql.mina-mesa-network.gcp.o1test.net/graphql",
    archiveNodeApi: "https://mesa-archive-node-api.gcp.o1test.net",
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
