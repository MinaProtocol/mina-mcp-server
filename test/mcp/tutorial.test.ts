import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { setupTutorialMcp, TutorialMcpTestContext } from "./helpers.js";

describe("MCP Server - Tutorial Mode", () => {
  let ctx: TutorialMcpTestContext;

  beforeEach(async () => {
    ctx = await setupTutorialMcp();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  describe("tool listing", () => {
    it("should list all registered tools", async () => {
      const result = await ctx.client.listTools();
      expect(result.tools.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe("account tools", () => {
    it("get_account should query live daemon", async () => {
      const mockAccount = { publicKey: "B62qtest", balance: { total: "1000000000" } };
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { account: mockAccount },
      });

      const result = await ctx.client.callTool({ name: "get_account", arguments: { publicKey: "B62qtest" } });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.publicKey).toBe("B62qtest");
    });

    it("get_tracked_accounts should return accounts", async () => {
      const mockAccounts = [{ publicKey: "B62qA", balance: { total: "1000" } }];
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { trackedAccounts: mockAccounts },
      });

      const result = await ctx.client.callTool({ name: "get_tracked_accounts", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(mockAccounts);
    });
  });

  describe("block tools", () => {
    it("get_block should query live daemon when stateHash provided", async () => {
      const mockBlock = { stateHash: "3NKtest", blockHeight: 100 };
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { block: mockBlock },
      });

      const result = await ctx.client.callTool({ name: "get_block", arguments: { stateHash: "3NKtest" } });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(mockBlock);
    });

    it("get_best_chain should return chain data", async () => {
      const mockChain = [{ stateHash: "3NK1", blockHeight: 100 }, { stateHash: "3NK2", blockHeight: 99 }];
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { bestChain: mockChain },
      });

      const result = await ctx.client.callTool({ name: "get_best_chain", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(mockChain);
    });
  });

  describe("transaction tools", () => {
    it("send_payment should send via daemon", async () => {
      const mockPayment = { payment: { id: "pay1", hash: "txhash1" } };
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { sendPayment: mockPayment },
      });

      const result = await ctx.client.callTool({
        name: "send_payment",
        arguments: { from: "B62qA", to: "B62qB", amount: "1000000000" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(mockPayment);
    });

    it("send_payment should handle errors", async () => {
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        errors: [{ message: "Insufficient funds" }],
      });

      const result = await ctx.client.callTool({
        name: "send_payment",
        arguments: { from: "B62qA", to: "B62qB", amount: "999999999999999" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Payment failed");
    });

    it("send_delegation should send via daemon", async () => {
      const mockDelegation = { sendDelegation: { delegation: { hash: "delhash1" } } };
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { sendDelegation: mockDelegation },
      });

      const result = await ctx.client.callTool({
        name: "send_delegation",
        arguments: { from: "B62qA", to: "B62qB" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toBeDefined();
    });

    it("get_transaction_status should return status", async () => {
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { transactionStatus: "INCLUDED" },
      });

      const result = await ctx.client.callTool({
        name: "get_transaction_status",
        arguments: { payment: "someid" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toBe("INCLUDED");
    });

    it("get_mempool should return pending transactions", async () => {
      const mockPool = [{ hash: "tx1", amount: "1000" }];
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { pooledUserCommands: mockPool },
      });

      const result = await ctx.client.callTool({ name: "get_mempool", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(mockPool);
    });
  });

  describe("network tools", () => {
    it("get_sync_status should return daemon status in tutorial mode", async () => {
      const mockStatus = { syncStatus: "SYNCED", blockchainLength: 100 };
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: mockStatus,
      });

      const result = await ctx.client.callTool({ name: "get_sync_status", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.syncStatus).toBe("SYNCED");
    });

    it("get_sync_status should handle daemon unreachable", async () => {
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("ECONNREFUSED")
      );

      const result = await ctx.client.callTool({ name: "get_sync_status", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Daemon not reachable");
    });

    it("get_genesis_constants should return constants", async () => {
      const mockConstants = { coinbase: "720000000000", accountCreationFee: "1000000000" };
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { genesisConstants: mockConstants },
      });

      const result = await ctx.client.callTool({ name: "get_genesis_constants", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(mockConstants);
    });

    it("get_network_id should return network ID", async () => {
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { networkID: "mina:testnet" },
      });

      const result = await ctx.client.callTool({ name: "get_network_id", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toBe("mina:testnet");
    });
  });

  describe("zkapp tools", () => {
    it("get_events should return events", async () => {
      const mockEvents = [{ blockInfo: { height: 10 }, eventData: [] }];
      (ctx.mockArchiveApi.getEvents as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockEvents);

      const result = await ctx.client.callTool({
        name: "get_events",
        arguments: { address: "B62qzkapp" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(mockEvents);
    });

    it("get_events should handle errors", async () => {
      (ctx.mockArchiveApi.getEvents as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Not found")
      );

      const result = await ctx.client.callTool({
        name: "get_events",
        arguments: { address: "B62qbad" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Error");
    });

    it("get_actions should return actions", async () => {
      const mockActions = [{ blockInfo: { height: 10 }, actionData: [] }];
      (ctx.mockArchiveApi.getActions as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockActions);

      const result = await ctx.client.callTool({
        name: "get_actions",
        arguments: { address: "B62qzkapp" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(mockActions);
    });

    it("get_archive_blocks should return blocks", async () => {
      const mockBlocks = [{ blockHeight: 100, creator: "B62qcreator", stateHash: "3NK" }];
      (ctx.mockArchiveApi.getBlocks as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockBlocks);

      const result = await ctx.client.callTool({ name: "get_archive_blocks", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(mockBlocks);
    });

    it("get_network_state should return network state", async () => {
      const mockState = { canonicalMaxBlockHeight: 100, pendingMaxBlockHeight: 101 };
      (ctx.mockArchiveApi.getNetworkState as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockState);

      const result = await ctx.client.callTool({ name: "get_network_state", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(mockState);
    });
  });

  describe("test account tools", () => {
    it("faucet should acquire and return ready account", async () => {
      (ctx.mockAccountsManager.acquireAccount as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        pk: "B62qfaucet",
        sk: "EKfaucet",
      });

      const result = await ctx.client.callTool({ name: "faucet", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.publicKey).toBe("B62qfaucet");
      expect(parsed.status).toBe("ready");
      expect(parsed.balanceMina).toBe("1550");
    });

    it("faucet should handle errors", async () => {
      (ctx.mockAccountsManager.acquireAccount as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("No accounts available")
      );

      const result = await ctx.client.callTool({ name: "faucet", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Faucet error");
    });

    it("return_account should release account", async () => {
      (ctx.mockAccountsManager.releaseAccount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      const result = await ctx.client.callTool({
        name: "return_account",
        arguments: { pk: "B62qtest", sk: "EKtest" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("returned to pool");
    });

    it("return_account should handle errors", async () => {
      (ctx.mockAccountsManager.releaseAccount as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Account not found")
      );

      const result = await ctx.client.callTool({
        name: "return_account",
        arguments: { pk: "B62qbad", sk: "EKbad" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Error");
    });
  });

  describe("session tracking", () => {
    it("faucet records the acquired account against the session", async () => {
      (ctx.mockAccountsManager.acquireAccount as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        pk: "B62qsess1",
        sk: "EKsess1",
      });

      await ctx.client.callTool({ name: "faucet", arguments: {} });

      const sessionIds = ctx.tracker.sessionIds();
      expect(sessionIds).toHaveLength(1);
      const tracked = ctx.tracker.getSessionAccounts(sessionIds[0]);
      expect(tracked.map((a) => a.pk)).toEqual(["B62qsess1"]);
    });

    it("return_account untracks on success", async () => {
      (ctx.mockAccountsManager.acquireAccount as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        pk: "B62qreturn",
        sk: "EKreturn",
      });
      (ctx.mockAccountsManager.releaseAccount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      await ctx.client.callTool({ name: "faucet", arguments: {} });
      await ctx.client.callTool({
        name: "return_account",
        arguments: { pk: "B62qreturn", sk: "EKreturn" },
      });

      expect(ctx.tracker.sessionIds()).toEqual([]);
    });

    it("reset_session releases every account this session holds", async () => {
      const acquireMock = ctx.mockAccountsManager.acquireAccount as ReturnType<typeof vi.fn>;
      acquireMock
        .mockResolvedValueOnce({ pk: "B62qreset1", sk: "EKreset1" })
        .mockResolvedValueOnce({ pk: "B62qreset2", sk: "EKreset2" });

      await ctx.client.callTool({ name: "faucet", arguments: {} });
      await ctx.client.callTool({ name: "faucet", arguments: {} });

      const releaseMock = ctx.mockAccountsManager.releaseAccount as ReturnType<typeof vi.fn>;
      releaseMock.mockResolvedValue(undefined);

      const result = await ctx.client.callTool({ name: "reset_session", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Released 2");
      expect(releaseMock).toHaveBeenCalledTimes(2);
      expect(ctx.tracker.sessionIds()).toEqual([]);
    });
  });

  describe("freeze tools", () => {
    it("freeze_reset pauses the chain-reset janitor and surfaces remaining time", async () => {
      const result = await ctx.client.callTool({ name: "freeze_reset", arguments: { minutes: 30 } });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const status = JSON.parse(text);
      expect(status.frozen).toBe(true);
      expect(status.remainingMs).toBeGreaterThan(0);
      expect(status.remainingMs).toBeLessThanOrEqual(30 * 60_000);
      expect(ctx.resetController.isFrozen()).toBe(true);
    });

    it("unfreeze_reset clears an active freeze immediately", async () => {
      ctx.resetController.freeze(60 * 60_000);
      expect(ctx.resetController.isFrozen()).toBe(true);

      const result = await ctx.client.callTool({ name: "unfreeze_reset", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual({ frozen: false, frozenUntil: null, remainingMs: null });
      expect(ctx.resetController.isFrozen()).toBe(false);
    });

    it("freeze_status reports the current state", async () => {
      const before = await ctx.client.callTool({ name: "freeze_status", arguments: {} });
      const beforeText = (before.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(beforeText).frozen).toBe(false);

      ctx.resetController.freeze(15 * 60_000);

      const after = await ctx.client.callTool({ name: "freeze_status", arguments: {} });
      const afterText = (after.content as Array<{ type: string; text: string }>)[0].text;
      const status = JSON.parse(afterText);
      expect(status.frozen).toBe(true);
      expect(status.remainingMs).toBeGreaterThan(0);
    });
  });

  describe("describe_state", () => {
    it("returns a unified snapshot of chain, mempool, accounts, and reset state", async () => {
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockImplementation(async (q: string) => {
        if (q.includes("daemonStatus")) {
          return { data: { daemonStatus: { syncStatus: "SYNCED", blockchainLength: 42, stateHash: "3NK..." } } };
        }
        if (q.includes("pooledUserCommands")) {
          return { data: { pooledUserCommands: [{ hash: "Ckp1" }, { hash: "Ckp2" }] } };
        }
        return { data: {} };
      });
      (ctx.mockAccountsManager.listAcquiredAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { pk: "B62qserver1", sk: "EK1" },
        { pk: "B62qserver2", sk: "EK2" },
        { pk: "B62qserver3", sk: "EK3" },
      ]);
      (ctx.mockAccountsManager.acquireAccount as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        pk: "B62qmine",
        sk: "EKmine",
      });

      await ctx.client.callTool({ name: "faucet", arguments: {} });

      const result = await ctx.client.callTool({ name: "describe_state", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const snapshot = JSON.parse(text);

      expect(snapshot.mode).toBe("tutorial");
      expect(snapshot.chain.syncStatus).toBe("SYNCED");
      expect(snapshot.chain.blockchainLength).toBe(42);
      expect(snapshot.mempool.size).toBe(2);
      expect(snapshot.accounts.acquired).toBe(3);
      expect(snapshot.accounts.thisSession).toBe(1);
      expect(snapshot.reset.frozen).toBe(false);
      expect(Array.isArray(snapshot.hints)).toBe(true);
      expect(snapshot.hints.length).toBeGreaterThan(0);
    });

    it("captures partial failures without losing other fields", async () => {
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("daemon offline"));
      (ctx.mockAccountsManager.listAcquiredAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const result = await ctx.client.callTool({ name: "describe_state", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const snapshot = JSON.parse(text);

      expect(snapshot.chain.error).toContain("daemon offline");
      expect(snapshot.mempool.error).toContain("daemon offline");
      expect(snapshot.accounts.acquired).toBe(0);
      expect(snapshot.reset.frozen).toBe(false);
      expect(snapshot.hints.length).toBeGreaterThan(0);
    });
  });

  describe("examples", () => {
    it("list_examples in tutorial mode includes tutorial-only workflows by default", async () => {
      const result = await ctx.client.callTool({ name: "list_examples", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const items = JSON.parse(text) as Array<{ name: string; mode: string }>;
      expect(items.some((e) => e.name === "send_payment")).toBe(true);
      expect(items.some((e) => e.name === "look_up_account")).toBe(true);
      for (const e of items) expect(["tutorial", "both"]).toContain(e.mode);
    });

    it("get_example returns the full send_payment workflow with named placeholders", async () => {
      const result = await ctx.client.callTool({
        name: "get_example",
        arguments: { name: "send_payment" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const example = JSON.parse(text);
      expect(example.name).toBe("send_payment");
      expect(example.steps.some((s: { tool: string }) => s.tool === "send_payment")).toBe(true);
      const placeholders = JSON.stringify(example);
      expect(placeholders).toContain("$sender_pk");
    });
  });
});
