import { describe, it, expect } from "vitest";
import { QUERIES } from "../../src/graphql/queries.js";

describe("daemon GraphQL queries", () => {
  it("bestChain.consensusState uses coinbaseReceiverAccount, not the bare field", () => {
    // Regression: `coinbaseReceiver` is on DaemonStatus, not on ConsensusState.
    // The ConsensusState type exposes `coinbaseReceiverAccount { publicKey }`.
    // See https://github.com/MinaProtocol/mina-mcp-server/issues/3.
    expect(QUERIES.bestChain).toContain("coinbaseReceiverAccount { publicKey }");
    expect(QUERIES.bestChain).not.toMatch(/\bcoinbaseReceiver\b(?!Account)/);
  });

  it("block.consensusState uses coinbaseReceiverAccount, not the bare field", () => {
    expect(QUERIES.block).toContain("coinbaseReceiverAccount { publicKey }");
    expect(QUERIES.block).not.toMatch(/\bcoinbaseReceiver\b(?!Account)/);
  });

  it("daemonStatus may still request coinbaseReceiver (it's valid on DaemonStatus)", () => {
    // Sanity: the query that runs against DaemonStatus is allowed to use the
    // bare field. This test is here so a blanket find/replace of
    // `coinbaseReceiver` doesn't silently break daemonStatus.
    expect(QUERIES.daemonStatus).toContain("coinbaseReceiver");
  });
});
