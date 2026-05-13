import { describe, it, expect } from "vitest";
import { LiveProvider } from "../../src/providers/live.js";
import { resolveNetwork } from "../../src/networks.js";

describe("LiveProvider", () => {
  it("constructs with the resolved network config and reports mode 'live'", () => {
    const provider = new LiveProvider(resolveNetwork("devnet"));
    expect(provider.mode).toBe("live");
    expect(provider.network.name).toBe("devnet");
    expect(provider.graphql.getEndpoint()).toBe(resolveNetwork("devnet").daemonGraphql);
    expect(provider.archiveApi?.graphqlUri).toBe(resolveNetwork("devnet").archiveNodeApi);
  });

  it("DB stub throws when archive DB is queried (DB-backed tools must not run in live mode)", async () => {
    const provider = new LiveProvider(resolveNetwork("mainnet"));
    await expect(provider.db.query("SELECT 1")).rejects.toThrow(
      /Archive DB is not available in live mode/
    );
    await expect(provider.db.queryReadOnly("SELECT 1")).rejects.toThrow(
      /Archive DB is not available in live mode/
    );
    expect(await provider.db.isConnected()).toBe(false);
  });

  it("getBlockLive rejects height-only lookups with a hint to use get_archive_blocks", async () => {
    const provider = new LiveProvider(resolveNetwork("devnet"));
    await expect(provider.getBlockLive(undefined, 1281)).rejects.toThrow(
      /requires a stateHash/
    );
    await expect(provider.getBlockLive(undefined, 1281)).rejects.toThrow(
      /get_archive_blocks/
    );
  });

  it("getBlockLive throws when neither stateHash nor height is provided", async () => {
    const provider = new LiveProvider(resolveNetwork("mesa"));
    await expect(provider.getBlockLive()).rejects.toThrow(/Provide a stateHash/);
  });
});
