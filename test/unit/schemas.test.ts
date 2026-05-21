import { describe, it, expect } from "vitest";
import {
  AccountResponse,
  BestChainResponse,
  BlockResponse,
  GenesisConstantsResponse,
  validateData,
} from "../../src/graphql/schemas.js";

// Representative fixtures shaped like the real daemon responses (the fields
// QUERIES.* selects). The schema test is the unit-level guard issue #23 asks
// for: drift between a query's selection set and what the code reads should
// fail here, not at runtime in front of a user.

describe("daemon/archive response schemas (#23)", () => {
  it("accepts a well-formed block response", () => {
    const data = {
      block: {
        stateHash: "3NKtip",
        protocolState: { consensusState: { blockHeight: "519000" }, blockchainState: {} },
        transactions: { userCommands: [], coinbase: "720000000000" },
      },
    };
    expect(validateData(BlockResponse, data, "block").block?.stateHash).toBe("3NKtip");
  });

  it("accepts a null block (not found)", () => {
    expect(validateData(BlockResponse, { block: null }, "block").block).toBeNull();
  });

  it("rejects a block missing stateHash", () => {
    expect(() => validateData(BlockResponse, { block: { height: 1 } }, "block")).toThrow(
      /block response shape/
    );
  });

  it("rejects when the block envelope itself is missing", () => {
    expect(() => validateData(BlockResponse, { wrongKey: {} }, "block")).toThrow();
  });

  it("accepts a best-chain array and rejects an element without stateHash", () => {
    expect(
      validateData(BestChainResponse, { bestChain: [{ stateHash: "3NK1" }, { stateHash: "3NK2" }] }, "bestChain")
        .bestChain
    ).toHaveLength(2);
    expect(() =>
      validateData(BestChainResponse, { bestChain: [{ creator: "B62q" }] }, "bestChain")
    ).toThrow(/bestChain response shape/);
  });

  it("validates account + genesisConstants envelopes", () => {
    expect(
      validateData(AccountResponse, { account: { publicKey: "B62q", balance: { total: "1" } } }, "account").account
        ?.publicKey
    ).toBe("B62q");
    expect(validateData(AccountResponse, { account: null }, "account").account).toBeNull();
    expect(
      validateData(GenesisConstantsResponse, { genesisConstants: { coinbase: "720000000000" } }, "genesisConstants")
        .genesisConstants
    ).toBeDefined();
  });

  it("error messages carry issue paths, never the response values", () => {
    try {
      validateData(BlockResponse, { block: { height: 1 } }, "block");
      throw new Error("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("block.stateHash");
      expect(msg).not.toContain('"height"');
    }
  });
});
