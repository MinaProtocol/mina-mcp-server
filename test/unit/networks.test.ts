import { describe, it, expect } from "vitest";
import { NETWORKS, resolveNetwork, preflightWarning } from "../../src/networks.js";

describe("public network table", () => {
  it("exposes devnet, mainnet, mesa and mesa-mut", () => {
    expect(Object.keys(NETWORKS).sort()).toEqual(["devnet", "mainnet", "mesa", "mesa-mut"]);
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

  it("devnet and mainnet are stable; mesa and mesa-mut are preflight", () => {
    expect(NETWORKS.devnet.stability).toBe("stable");
    expect(NETWORKS.mainnet.stability).toBe("stable");
    expect(NETWORKS.mesa.stability).toBe("preflight");
    expect(NETWORKS["mesa-mut"].stability).toBe("preflight");
  });

  it("networks that declare an archive-dump prefix also declare a cadence", () => {
    for (const cfg of Object.values(NETWORKS)) {
      // archiveDumpPrefix is optional — networks without a published dump
      // (e.g. mesa-mut) omit it, and snapshot mode is unavailable for them.
      if (cfg.archiveDumpPrefix === undefined) {
        expect(cfg.archiveDumpCadence).toBeUndefined();
        continue;
      }
      expect(cfg.archiveDumpPrefix.length).toBeGreaterThan(0);
      expect(["daily", "twice-daily"]).toContain(cfg.archiveDumpCadence);
    }
    expect(NETWORKS.mesa.archiveDumpCadence).toBe("twice-daily");
    // mesa-mut has no published archive dump.
    expect(NETWORKS["mesa-mut"].archiveDumpPrefix).toBeUndefined();
  });

  it("devnet and mesa declare a faucet URL; mainnet does not", () => {
    expect(NETWORKS.devnet.faucetUrl).toMatch(/^https?:\/\//);
    expect(NETWORKS.mesa.faucetUrl).toMatch(/^https?:\/\//);
    expect(NETWORKS.mainnet.faucetUrl).toBeUndefined();
  });

  it("networks that declare a Mina-Rosetta endpoint also declare its network identifier", () => {
    for (const cfg of Object.values(NETWORKS)) {
      // rosettaUrl is optional — networks without a published Rosetta endpoint
      // (e.g. mesa-mut) omit it, and rosetta_* tools are not registered.
      if (cfg.rosettaUrl === undefined) {
        expect(cfg.rosettaNetwork).toBeUndefined();
        continue;
      }
      expect(cfg.rosettaUrl).toMatch(/^https?:\/\//);
      expect(typeof cfg.rosettaNetwork).toBe("string");
      expect(cfg.rosettaNetwork!.length).toBeGreaterThan(0);
    }
    // Mesa's Rosetta endpoint calls itself "testnet", not "mesa" —
    // verified via /network/list. Make sure we don't regress on this.
    expect(NETWORKS.mesa.rosettaNetwork).toBe("testnet");
    expect(NETWORKS.devnet.rosettaNetwork).toBe("devnet");
    expect(NETWORKS.mainnet.rosettaNetwork).toBe("mainnet");
    // mesa-mut has no published Rosetta endpoint.
    expect(NETWORKS["mesa-mut"].rosettaUrl).toBeUndefined();
  });

  it("preflightWarning returns a warning for preflight networks and null otherwise", () => {
    expect(preflightWarning(NETWORKS.devnet)).toBeNull();
    expect(preflightWarning(NETWORKS.mainnet)).toBeNull();
    const w = preflightWarning(NETWORKS.mesa);
    expect(w).not.toBeNull();
    expect(w).toMatch(/PREFLIGHT/);
    expect(w).toMatch(/mesa/);
    const wMut = preflightWarning(NETWORKS["mesa-mut"]);
    expect(wMut).not.toBeNull();
    expect(wMut).toMatch(/PREFLIGHT/);
    expect(wMut).toMatch(/mesa-mut/);
  });

  it("resolveNetwork returns the matching entry", () => {
    expect(resolveNetwork("devnet").name).toBe("devnet");
    expect(resolveNetwork("mainnet").name).toBe("mainnet");
    expect(resolveNetwork("mesa").name).toBe("mesa");
    expect(resolveNetwork("mesa-mut").name).toBe("mesa-mut");
  });

  it("resolveNetwork throws on unknown name with the known list", () => {
    expect(() => resolveNetwork("nope")).toThrow(/Unknown network 'nope'/);
    expect(() => resolveNetwork("nope")).toThrow(/devnet/);
  });
});
