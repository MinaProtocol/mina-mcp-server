import { describe, it, expect } from "vitest";
import {
  MAX_RESPONSE_CHARS,
  renderShaped,
  shapeBestChain,
  shapeDaemonBlock,
  shapeRosettaBlock,
} from "../../src/tools/shape.js";

function daemonBlock(txCount: number) {
  const userCommands = Array.from({ length: txCount }, (_, i) => ({
    id: `id${i}`,
    hash: `hash${i}`,
    kind: i % 2 === 0 ? "PAYMENT" : "STAKE_DELEGATION",
    nonce: i,
    source: { publicKey: "B62qsource" },
    receiver: { publicKey: "B62qreceiver" },
    amount: "1000000000",
    fee: "100000000",
    memo: "",
    failureReason: null,
  }));
  return {
    stateHash: "3Nstate",
    protocolState: {
      previousStateHash: "3Nprev",
      consensusState: { blockHeight: "519000", slot: "42", blockCreator: "B62qcreator" },
      blockchainState: { date: "1", utcDate: "2026-05-21T00:00:00Z", snarkedLedgerHash: "j", stagedLedgerHash: "j" },
    },
    transactions: {
      userCommands,
      feeTransfer: [{ recipient: "B62q", fee: "1", type: "Fee_transfer" }],
      coinbase: "720000000000",
      coinbaseReceiverAccount: { publicKey: "B62qcoinbase" },
    },
  };
}

describe("shapeDaemonBlock", () => {
  it("lite returns header + counts, no per-tx detail", () => {
    const out = shapeDaemonBlock(daemonBlock(60), { detail: "lite", transactionLimit: 20, transactionOffset: 0 });
    expect(out.stateHash).toBe("3Nstate");
    expect(out.height).toBe("519000");
    expect(out.coinbaseReceiver).toBe("B62qcoinbase");
    expect(out.transactionCounts).toEqual({
      userCommands: 60,
      byKind: { PAYMENT: 30, STAKE_DELEGATION: 30 },
      feeTransfers: 1,
    });
    expect(out.userCommands).toBeUndefined();
  });

  it("transactions pages the userCommands", () => {
    const out = shapeDaemonBlock(daemonBlock(60), { detail: "transactions", transactionLimit: 20, transactionOffset: 40 });
    expect(out.transactionPage).toEqual({ offset: 40, limit: 20, total: 60, returned: 20 });
    expect(out.userCommands).toHaveLength(20);
    expect(out.userCommands[0].id).toBe("id40");
  });

  it("full returns the original object untouched", () => {
    const block = daemonBlock(3);
    const out = shapeDaemonBlock(block, { detail: "full", transactionLimit: 20, transactionOffset: 0 });
    expect(out).toBe(block);
  });
});

describe("shapeBestChain", () => {
  it("always reduces each block to a header regardless of detail", () => {
    const blocks = [daemonBlock(60), daemonBlock(70)];
    const out = shapeBestChain(blocks, { detail: "transactions", transactionLimit: 20, transactionOffset: 0 }) as any[];
    expect(out).toHaveLength(2);
    expect(out[0].userCommands).toBeUndefined();
    expect(out[0].transactionCounts.userCommands).toBe(60);
    expect(out[1].transactionCounts.userCommands).toBe(70);
  });

  it("full passes blocks through", () => {
    const blocks = [daemonBlock(1)];
    expect(shapeBestChain(blocks, { detail: "full", transactionLimit: 20, transactionOffset: 0 })).toBe(blocks);
  });
});

describe("shapeRosettaBlock", () => {
  const resp = {
    block: {
      block_identifier: { index: 519000, hash: "3N" },
      parent_block_identifier: { index: 518999, hash: "3Nprev" },
      timestamp: 1700000000000,
      transactions: Array.from({ length: 50 }, (_, i) => ({
        transaction_identifier: { hash: `Ckp${i}` },
        operations: [{ a: 1 }, { b: 2 }, { c: 3 }],
      })),
    },
  };

  it("lite returns identifiers + tx/op counts", () => {
    const out = shapeRosettaBlock(resp, { detail: "lite", transactionLimit: 20, transactionOffset: 0 });
    expect(out.block_identifier).toEqual({ index: 519000, hash: "3N" });
    expect(out.transactionCounts).toEqual({ transactions: 50, operations: 150 });
    expect(out.transactions).toBeUndefined();
  });

  it("transactions pages", () => {
    const out = shapeRosettaBlock(resp, { detail: "transactions", transactionLimit: 10, transactionOffset: 0 });
    expect(out.transactions).toHaveLength(10);
    expect(out.transactionPage).toEqual({ offset: 0, limit: 10, total: 50, returned: 10 });
  });
});

describe("renderShaped", () => {
  it("returns a lite payload as-is even if (hypothetically) large", () => {
    const out = renderShaped({ ok: true }, "lite");
    expect(out.content[0].text).toContain("ok");
  });

  it("degrades an oversized non-lite payload to an actionable message", () => {
    const huge = { blob: "x".repeat(MAX_RESPONSE_CHARS + 100) };
    const out = renderShaped(huge, "full");
    expect(out.content[0].text).toContain("over the");
    expect(out.content[0].text).toContain('detail:"lite"');
  });
});
