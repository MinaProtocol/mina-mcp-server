import { ArchiveClient } from "@o1-labs/mina-archive-sdk";
import { GraphQLClient } from "../graphql/client.js";
import { ArchiveDB } from "../db/archive.js";
import { TutorialProvider } from "./tutorial.js";
import { NetworkConfig, preflightWarning } from "../networks.js";
import { RosettaClient } from "@o1-labs/mina-rosetta-sdk";

/**
 * Read-only provider that points at a public Mina network (devnet, mainnet, mesa)
 * — no local lightnet, no Postgres, no accounts-manager. Extends TutorialProvider
 * so existing `instanceof TutorialProvider` routing in tools continues to use the
 * daemon path; DB- and accounts-dependent tools are filtered out at registration
 * time (see server-factory) rather than at call time.
 */
export class LiveProvider extends TutorialProvider {
  public readonly network: NetworkConfig;
  public override readonly mode: string = "live";
  // Optional — present when network.rosettaUrl + rosettaNetwork are both set.
  // rosetta_* tools are only registered when this is non-null.
  public readonly rosetta: RosettaClient | null;

  constructor(network: NetworkConfig) {
    // Stub ArchiveDB — pool is lazy and never queried because DB-backed tools
    // aren't registered in live mode. The throw-on-query stub guarantees a
    // loud failure if anything bypasses the registration filter.
    const stubDb = new StubArchiveDB();
    const graphql = new GraphQLClient(network.daemonGraphql);
    const archiveApi = new ArchiveClient(network.archiveNodeApi);
    super(stubDb as unknown as ArchiveDB, graphql, archiveApi);
    this.network = network;
    this.rosetta =
      network.rosettaUrl && network.rosettaNetwork
        ? new RosettaClient({
            baseUrl: network.rosettaUrl,
            network: { blockchain: "mina", network: network.rosettaNetwork },
          })
        : null;
    const warning = preflightWarning(network);
    if (warning) console.error(warning);
  }

  /**
   * In live mode there's no Postgres to resolve height → state_hash, so reject
   * height-only lookups with a hint. Callers should use `get_archive_blocks`
   * (Archive-Node-API) to find a recent block's stateHash, then call this
   * with that hash.
   */
  override async getBlockLive(stateHash?: string, height?: number) {
    if (!stateHash) {
      if (typeof height === "number") {
        throw new Error(
          `In live mode (${this.network.name}), get_block requires a stateHash. ` +
            `Use get_archive_blocks to find blocks by height and then pass the resulting stateHash here.`
        );
      }
      throw new Error("Provide a stateHash");
    }
    return super.getBlockLive(stateHash);
  }
}

class StubArchiveDB {
  async query(): Promise<never> {
    throw new Error(
      "Archive DB is not available in live mode. " +
        "Use get_archive_blocks / get_events / get_actions (Archive-Node-API) instead."
    );
  }
  async queryReadOnly(): Promise<never> {
    return this.query();
  }
  async isConnected(): Promise<boolean> {
    return false;
  }
  async close(): Promise<void> {
    /* no-op */
  }
}
