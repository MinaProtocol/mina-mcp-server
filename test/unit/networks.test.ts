import { describe, it, expect } from "vitest";
import { NETWORKS, resolveNetwork } from "../../src/networks.js";

describe("public network table", () => {
  it("exposes devnet, mainnet and mesa", () => {
    expect(Object.keys(NETWORKS).sort()).toEqual(["devnet", "mainnet", "mesa"]);
  });

  it("every network has both daemon GraphQL and archive-node-api endpoints", () => {
    for (const [key, cfg] of Object.entries(NETWORKS)) {
      expect(cfg.name).toBe(key);
      expect(cfg.daemonGraphql).toMatch(/^https?:\/\/.+/);
      expect(cfg.archiveNodeApi).toMatch(/^https?:\/\/.+/);
      expect(cfg.description.length).toBeGreaterThan(0);
    }
  });

  it("resolveNetwork returns the matching entry", () => {
    expect(resolveNetwork("devnet").name).toBe("devnet");
    expect(resolveNetwork("mainnet").name).toBe("mainnet");
    expect(resolveNetwork("mesa").name).toBe("mesa");
  });

  it("resolveNetwork throws on unknown name with the known list", () => {
    expect(() => resolveNetwork("nope")).toThrow(/Unknown network 'nope'/);
    expect(() => resolveNetwork("nope")).toThrow(/devnet/);
  });
});
