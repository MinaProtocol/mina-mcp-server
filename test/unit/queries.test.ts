import { describe, it, expect } from "vitest";
import { QUERIES } from "../../src/graphql/queries.js";

describe("daemon GraphQL queries", () => {
  // ConsensusState's actual field is `coinbaseReceiever` — a typo (three e's)
  // baked into the Mina daemon schema. The bug-fix in #6 used
  // `coinbaseReceiverAccount`, which the issue had suggested, but daemon
  // introspection on the deployed lightnet shows that field doesn't exist
  // either. We must mirror the daemon's misspelling exactly.

  it("bestChain.consensusState uses the daemon's `coinbaseReceiever` field (note typo)", () => {
    expect(QUERIES.bestChain).toContain("coinbaseReceiever");
  });

  it("block.consensusState uses the daemon's `coinbaseReceiever` field (note typo)", () => {
    expect(QUERIES.block).toContain("coinbaseReceiever");
    // block.transactions.coinbaseReceiverAccount is a different type and stays;
    // we don't assert against that here.
  });

  it("daemonStatus may still request the (correctly-spelled) `coinbaseReceiver`", () => {
    // DaemonStatus's field IS spelled correctly; only ConsensusState has the typo.
    expect(QUERIES.daemonStatus).toContain("coinbaseReceiver");
  });
});
