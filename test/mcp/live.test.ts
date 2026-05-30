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
        // Rosetta Data API — registered when network has rosettaUrl + rosettaNetwork.
        "rosetta_account",
        "rosetta_block",
        "rosetta_mempool",
        "rosetta_mempool_transaction",
        "rosetta_status",
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
      (ctx.mockClient.getBlock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockBlock);

      // detail:"full" returns the raw daemon block (default is the lite summary).
      const result = await ctx.client.callTool({ name: "get_block", arguments: { stateHash: "3NKtest", detail: "full" } });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(mockBlock);
    });

    it("get_block defaults to a lite summary with transaction counts", async () => {
      // SDK-shaped (flat) block — matches MinaClient#getBlock's return.
      const mockBlock = {
        stateHash: "3NKlite",
        blockHeight: 519000,
        blockCreator: "B62qc",
        userCommands: [{ kind: "PAYMENT" }, { kind: "PAYMENT" }],
        feeTransfers: [],
      };
      (ctx.mockClient.getBlock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockBlock);

      const result = await ctx.client.callTool({ name: "get_block", arguments: { stateHash: "3NKlite" } });
      const out = JSON.parse((result.content as Array<{ type: string; text: string }>)[0].text);
      expect(out.height).toBe(519000);
      expect(out.transactionCounts.userCommands).toBe(2);
      expect(out.userCommands).toBeUndefined();
    });

    it("rejects height-only lookups with a hint to use get_archive_blocks", async () => {
      const result = await ctx.client.callTool({ name: "get_block", arguments: { height: 1281 } });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toMatch(/requires a stateHash/);
      expect(text).toMatch(/get_archive_blocks/);
      expect(ctx.mockClient.getBlock).not.toHaveBeenCalled();
    });
  });

  describe("describe_state", () => {
    it("returns a live-flavoured snapshot including network metadata and no accounts/reset fields", async () => {
      (ctx.mockClient.getDaemonStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        syncStatus: "SYNCED",
        blockchainLength: 518429,
        stateHash: "3NKlive",
        commitId: "",
        peers: [],
      });
      (ctx.mockClient.getPooledUserCommands as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

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
      // Rosetta endpoint should be surfaced — both the rosetta_* tool family and the URL.
      expect(snapshot.hints.some((h: string) => h.includes("rosetta_status"))).toBe(true);
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
        (mesaCtx.mockClient.getDaemonStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
          syncStatus: "SYNCED",
          blockchainLength: 7000,
          stateHash: "3NKmesa",
          commitId: "",
          peers: [],
        });
        (mesaCtx.mockClient.getPooledUserCommands as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

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

  describe("upgrade status (mesa-mut)", () => {
    const TRACKER = {
      currentPhase: "pre-upgrade",
      network: "mainnet",
      lastUpdated: "2026-05-28T23:11:00Z",
      slots: { stopTransactionSlot: 2680, stopNetworkSlot: 2780 },
      autoHardForkDelta: 60,
      mesaGenesisTimestamp: "2026-06-03T18:00:00Z",
    };

    async function withMesaMut(
      slot: string,
      run: (ctx: LiveMcpTestContext) => Promise<void>
    ): Promise<void> {
      await ctx.cleanup();
      const mutCtx = await setupLiveMcp("mesa-mut");
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => TRACKER });
      vi.stubGlobal("fetch", fetchMock);
      try {
        (mutCtx.mockClient.executeQuery as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
          daemonStatus: { consensusTimeNow: { globalSlot: slot }, blockchainLength: 296681 },
        });
        await run(mutCtx);
      } finally {
        vi.unstubAllGlobals();
        await mutCtx.cleanup();
      }
    }

    async function callUpgrade(c: LiveMcpTestContext) {
      const result = await c.client.callTool({ name: "get_upgrade_status", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      return JSON.parse(text);
    }

    it("joins the tracker with the live slot and reports transactions OPEN before stopTransactionSlot", async () => {
      await withMesaMut("952", async (c) => {
        const s = await callUpgrade(c);
        expect(s.network).toBe("mesa-mut");
        expect(s.trackerPhase).toBe("pre-upgrade");
        expect(s.transactionsOpen).toBe(true);
        expect(s.currentSlot).toBe(952);
        expect(s.stopTransactionSlot).toBe(2680);
        expect(s.slotsUntilStopTransaction).toBe(2680 - 952);
        expect(s.mesaGenesisTimestamp).toBe("2026-06-03T18:00:00Z");
        expect(s.hints.some((h: string) => h.includes("Transactions are OPEN"))).toBe(true);
        expect(s.hints.some((h: string) => h.includes("PREFLIGHT"))).toBe(true);
      });
    });

    it("reports transactions STOPPED once the live slot passes stopTransactionSlot", async () => {
      await withMesaMut("2700", async (c) => {
        const s = await callUpgrade(c);
        expect(s.transactionsOpen).toBe(false);
        expect(s.livePhase).toMatch(/transactions stopped/);
        expect(s.slotsUntilStopNetwork).toBe(2780 - 2700);
        expect(s.hints.some((h: string) => h.includes("STOPPED"))).toBe(true);
      });
    });

    it("reports network HALTED once the live slot passes stopNetworkSlot", async () => {
      await withMesaMut("2800", async (c) => {
        const s = await callUpgrade(c);
        expect(s.transactionsOpen).toBe(false);
        expect(s.livePhase).toMatch(/network halted/);
        expect(s.hints.some((h: string) => h.includes("HALTED"))).toBe(true);
      });
    });

    it("is not registered on networks without an upgrade tracker (devnet)", async () => {
      const tools = await ctx.client.listTools();
      expect(tools.tools.map((t) => t.name)).not.toContain("get_upgrade_status");
    });
  });

  describe("rosetta tools", () => {
    it("rosetta_status returns the underlying client response", async () => {
      const fixture = { current_block_identifier: { index: 7, hash: "h7" }, sync_status: { synced: true } };
      (ctx.mockRosetta.networkStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fixture);

      const result = await ctx.client.callTool({ name: "rosetta_status", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(fixture);
    });

    it("rosetta_block by index forwards a {index} block_identifier", async () => {
      (ctx.mockRosetta.block as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ block: { block_identifier: { index: 100, hash: "h100" } } });

      const result = await ctx.client.callTool({ name: "rosetta_block", arguments: { index: 100, detail: "full" } });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toMatchObject({ block: { block_identifier: { index: 100 } } });
      expect(ctx.mockRosetta.block).toHaveBeenCalledWith({ index: 100 });
    });

    it("rosetta_block rejects when both index and hash are supplied", async () => {
      const result = await ctx.client.callTool({ name: "rosetta_block", arguments: { index: 1, hash: "h1" } });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toMatch(/exactly one of/);
      expect(ctx.mockRosetta.block).not.toHaveBeenCalled();
    });

    it("rosetta_block rejects when neither index nor hash is supplied", async () => {
      const result = await ctx.client.callTool({ name: "rosetta_block", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toMatch(/exactly one of/);
      expect(ctx.mockRosetta.block).not.toHaveBeenCalled();
    });

    it("rosetta_account omits block_identifier when none is provided", async () => {
      (ctx.mockRosetta.accountBalance as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ balances: [] });
      await ctx.client.callTool({ name: "rosetta_account", arguments: { address: "B62qtest" } });
      expect(ctx.mockRosetta.accountBalance).toHaveBeenCalledWith({
        address: "B62qtest",
        blockIdentifier: undefined,
      });
    });

    it("rosetta_account passes a {index} block_identifier when blockIndex is set", async () => {
      (ctx.mockRosetta.accountBalance as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ balances: [] });
      await ctx.client.callTool({ name: "rosetta_account", arguments: { address: "B62qtest", blockIndex: 42 } });
      expect(ctx.mockRosetta.accountBalance).toHaveBeenCalledWith({
        address: "B62qtest",
        blockIdentifier: { index: 42 },
      });
    });

    it("rosetta tool errors surface the safeCall label prefix", async () => {
      (ctx.mockRosetta.networkStatus as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("upstream 502"));
      const result = await ctx.client.callTool({ name: "rosetta_status", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toBe("rosetta_status: upstream 502");
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
