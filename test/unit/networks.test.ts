import { describe, it, expect } from "vitest";
import { NETWORKS, resolveNetwork, preflightWarning } from "../../src/networks.js";

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

  it("every network declares a stability tier", () => {
    for (const cfg of Object.values(NETWORKS)) {
      expect(["stable", "preflight"]).toContain(cfg.stability);
    }
  });

  it("devnet and mainnet are stable; mesa is preflight", () => {
    expect(NETWORKS.devnet.stability).toBe("stable");
    expect(NETWORKS.mainnet.stability).toBe("stable");
    expect(NETWORKS.mesa.stability).toBe("preflight");
  });

  it("every network declares an archive-dump prefix and cadence", () => {
    for (const cfg of Object.values(NETWORKS)) {
      expect(cfg.archiveDumpPrefix.length).toBeGreaterThan(0);
      expect(["daily", "twice-daily"]).toContain(cfg.archiveDumpCadence);
    }
    expect(NETWORKS.mesa.archiveDumpCadence).toBe("twice-daily");
  });

  it("preflightWarning returns a warning for preflight networks and null otherwise", () => {
    expect(preflightWarning(NETWORKS.devnet)).toBeNull();
    expect(preflightWarning(NETWORKS.mainnet)).toBeNull();
    const w = preflightWarning(NETWORKS.mesa);
    expect(w).not.toBeNull();
    expect(w).toMatch(/PREFLIGHT/);
    expect(w).toMatch(/mesa/);
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
