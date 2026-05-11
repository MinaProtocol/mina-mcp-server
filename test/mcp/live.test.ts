import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { setupLiveMcp, LiveMcpTestContext } from "./helpers.js";

describe("MCP Server - Live Mode", () => {
  let ctx: LiveMcpTestContext;

  beforeEach(async () => {
    ctx = await setupLiveMcp("devnet");
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  describe("tool listing", () => {
    it("registers only read-only daemon + Archive-Node-API tools (no DB, no accounts, no admin, no writes)", async () => {
      const result = await ctx.client.listTools();
      const toolNames = result.tools.map((t) => t.name).sort();

      // Tools that SHOULD be exposed in live mode.
      const expected = [
        "describe_state",
        "get_account",
        "get_actions",
        "get_archive_blocks",
        "get_best_chain",
        "get_block",
        "get_events",
        "get_example",
        "get_genesis_constants",
        "get_mempool",
        "get_network_id",
        "get_network_state",
        "get_sync_status",
        "get_transaction_status",
        "list_examples",
      ].sort();
      expect(toolNames).toEqual(expected);

      // Tools that must NEVER appear in live mode — would either need
      // the archive DB (we don't have one) or daemon-side signing /
      // accounts-manager (which public daemons don't offer).
      const forbidden = [
        "faucet", "return_account", "reset_session",
        "freeze_reset", "unfreeze_reset", "freeze_status",
        "send_payment", "send_delegation",
        "get_transaction", "search_transactions",
        "list_blocks", "get_staking_ledger", "get_tracked_accounts",
        "get_archive_stats",
        "query_archive_sql", "get_archive_schema",
      ];
      for (const name of forbidden) expect(toolNames).not.toContain(name);
    });
  });

  describe("get_block", () => {
    it("passes through to the daemon when a stateHash is provided", async () => {
      const mockBlock = { stateHash: "3NKtest", blockHeight: 1281 };
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { block: mockBlock },
      });

      const result = await ctx.client.callTool({ name: "get_block", arguments: { stateHash: "3NKtest" } });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(mockBlock);
    });

    it("rejects height-only lookups with a hint to use get_archive_blocks", async () => {
      const result = await ctx.client.callTool({ name: "get_block", arguments: { height: 1281 } });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toMatch(/requires a stateHash/);
      expect(text).toMatch(/get_archive_blocks/);
      expect(ctx.mockGraphQL.query).not.toHaveBeenCalled();
    });
  });

  describe("describe_state", () => {
    it("returns a live-flavoured snapshot including network metadata and no accounts/reset fields", async () => {
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ data: { daemonStatus: { syncStatus: "SYNCED", blockchainLength: 518429, stateHash: "3NKlive" } } })
        .mockResolvedValueOnce({ data: { pooledUserCommands: [] } });

      const result = await ctx.client.callTool({ name: "describe_state", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const snapshot = JSON.parse(text);

      expect(snapshot.mode).toBe("live");
      expect(snapshot.network.name).toBe("devnet");
      expect(snapshot.network.stability).toBe("stable");
      expect(snapshot.network.daemonGraphql).toMatch(/^https?:\/\//);
      expect(snapshot.network.archiveNodeApi).toMatch(/^https?:\/\//);
      expect(snapshot.chain.syncStatus).toBe("SYNCED");
      expect(snapshot.chain.blockchainLength).toBe(518429);
      expect(snapshot.mempool.size).toBe(0);
      expect(Array.isArray(snapshot.hints)).toBe(true);
      expect(snapshot.hints.some((h: string) => h.includes("public read-only"))).toBe(true);
      // Devnet has a faucet — hint should surface the URL so an LLM can hand it to a human.
      expect(snapshot.hints.some((h: string) => h.includes("faucet.minaprotocol.com"))).toBe(true);
      // Rosetta endpoint should be surfaced too.
      expect(snapshot.hints.some((h: string) => h.includes("devnet-rosetta.gcp.o1test.net"))).toBe(true);
      // Stable network should NOT carry a preflight warning.
      expect(snapshot.hints.some((h: string) => h.includes("PREFLIGHT"))).toBe(false);
      // Live-mode snapshot intentionally omits accounts + reset (those don't exist here).
      expect("accounts" in snapshot).toBe(false);
      expect("reset" in snapshot).toBe(false);
    });
  });

  describe("preflight network (mesa)", () => {
    it("describe_state surfaces stability='preflight' and leads with a PREFLIGHT hint", async () => {
      // Replace the default devnet fixture with a mesa one.
      await ctx.cleanup();
      const { setupLiveMcp } = await import("./helpers.js");
      const mesaCtx = await setupLiveMcp("mesa");
      try {
        (mesaCtx.mockGraphQL.query as ReturnType<typeof vi.fn>)
          .mockResolvedValueOnce({ data: { daemonStatus: { syncStatus: "SYNCED", blockchainLength: 7000, stateHash: "3NKmesa" } } })
          .mockResolvedValueOnce({ data: { pooledUserCommands: [] } });

        const result = await mesaCtx.client.callTool({ name: "describe_state", arguments: {} });
        const text = (result.content as Array<{ type: string; text: string }>)[0].text;
        const snapshot = JSON.parse(text);

        expect(snapshot.network.name).toBe("mesa");
        expect(snapshot.network.stability).toBe("preflight");
        // First hint MUST be the preflight warning so it shows up on the first scan.
        expect(snapshot.hints[0]).toMatch(/PREFLIGHT/);
        // Mesa is also faucet-fundable (shared form with devnet).
        expect(snapshot.hints.some((h: string) => h.includes("faucet.minaprotocol.com"))).toBe(true);
      } finally {
        await mesaCtx.cleanup();
      }
    });
  });

  describe("examples", () => {
    it("list_examples in live mode includes the live-specific workflows", async () => {
      const result = await ctx.client.callTool({ name: "list_examples", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const items = JSON.parse(text) as Array<{ name: string; mode: string }>;
      const names = items.map((e) => e.name);
      expect(names).toContain("look_up_account_live");
      expect(names).toContain("explore_zkapp_events_live");
      expect(names).toContain("browse_archive_blocks");
      // Lightnet-only workflows must NOT be listed in live mode.
      expect(names).not.toContain("send_payment");
      expect(names).not.toContain("freeze_for_demo");
    });
  });
});
