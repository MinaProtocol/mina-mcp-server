import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { setupSnapshotMcp, McpTestContext } from "./helpers.js";

describe("MCP Server - Snapshot Mode", () => {
  let ctx: McpTestContext;

  beforeEach(async () => {
    ctx = await setupSnapshotMcp();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  describe("tool listing", () => {
    it("should list all registered tools", async () => {
      const result = await ctx.client.listTools();
      const toolNames = result.tools.map((t) => t.name).sort();

      expect(toolNames).toEqual([
        "faucet",
        "get_account",
        "get_actions",
        "get_archive_blocks",
        "get_archive_stats",
        "get_archive_schema",
        "get_best_chain",
        "get_block",
        "get_events",
        "get_genesis_constants",
        "get_mempool",
        "get_network_id",
        "get_network_state",
        "get_staking_ledger",
        "get_sync_status",
        "get_tracked_accounts",
        "get_transaction",
        "get_transaction_status",
        "list_blocks",
        "query_archive_sql",
        "return_account",
        "search_transactions",
        "send_delegation",
        "send_payment",
      ].sort());
    });

    it("each tool should have a description", async () => {
      const result = await ctx.client.listTools();
      for (const tool of result.tools) {
        expect(tool.description, `${tool.name} missing description`).toBeTruthy();
      }
    });

    it("each tool should have an input schema", async () => {
      const result = await ctx.client.listTools();
      for (const tool of result.tools) {
        expect(tool.inputSchema, `${tool.name} missing inputSchema`).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
    });
  });

  describe("account tools", () => {
    it("get_account should return account data", async () => {
      const mockRows = [{ public_key: "B62qtest", token_id: "1" }];
      (ctx.mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: mockRows });

      const result = await ctx.client.callTool({ name: "get_account", arguments: { publicKey: "B62qtest" } });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed).toEqual(mockRows);
    });

    it("get_account should handle not found", async () => {
      (ctx.mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

      const result = await ctx.client.callTool({ name: "get_account", arguments: { publicKey: "B62qnotfound" } });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Account not found");
    });

    it("get_staking_ledger should return ledger entries", async () => {
      const mockRows = [{ public_key: "B62qtest", account_id: 1 }];
      (ctx.mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: mockRows });

      const result = await ctx.client.callTool({ name: "get_staking_ledger", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(mockRows);
    });

    it("get_tracked_accounts should return tutorial-only message", async () => {
      const result = await ctx.client.callTool({ name: "get_tracked_accounts", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("only available in tutorial mode");
    });
  });

  describe("block tools", () => {
    it("get_block should return block by height", async () => {
      const mockBlock = { state_hash: "3NKtest", height: 100 };
      (ctx.mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [mockBlock] });

      const result = await ctx.client.callTool({ name: "get_block", arguments: { height: 100 } });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(mockBlock);
    });

    it("get_block should return block by state hash", async () => {
      const mockBlock = { state_hash: "3NKaBJsN1SehD6test", height: 100 };
      (ctx.mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [mockBlock] });

      const result = await ctx.client.callTool({ name: "get_block", arguments: { stateHash: "3NKaBJsN1SehD6test" } });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(mockBlock);
    });

    it("get_block should handle not found", async () => {
      (ctx.mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

      const result = await ctx.client.callTool({ name: "get_block", arguments: { height: 999999 } });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Block not found");
    });

    it("get_block should require stateHash or height", async () => {
      const result = await ctx.client.callTool({ name: "get_block", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Provide either stateHash or height");
    });

    it("list_blocks should return blocks", async () => {
      const mockBlocks = [{ height: 2 }, { height: 1 }];
      (ctx.mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: mockBlocks });

      const result = await ctx.client.callTool({ name: "list_blocks", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(mockBlocks);
    });

    it("get_best_chain should return tutorial-only message", async () => {
      const result = await ctx.client.callTool({ name: "get_best_chain", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("only available in tutorial mode");
    });
  });

  describe("transaction tools", () => {
    it("get_transaction should return transaction", async () => {
      const mockTx = { hash: "txhash1", command_type: "payment", amount: "1000000000" };
      (ctx.mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [mockTx] });

      const result = await ctx.client.callTool({ name: "get_transaction", arguments: { hash: "txhash1" } });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual({ type: "user_command", ...mockTx });
    });

    it("get_transaction should handle not found", async () => {
      (ctx.mockDb.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await ctx.client.callTool({ name: "get_transaction", arguments: { hash: "nonexistent" } });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Transaction not found");
    });

    it("search_transactions should return results", async () => {
      const mockRows = [{ hash: "tx1", source: "B62qsender" }];
      (ctx.mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: mockRows });

      const result = await ctx.client.callTool({
        name: "search_transactions",
        arguments: { sender: "B62qsender" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(mockRows);
    });

    it("send_payment should return tutorial-only message", async () => {
      const result = await ctx.client.callTool({
        name: "send_payment",
        arguments: { from: "B62qA", to: "B62qB", amount: "1000000000" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("only available in tutorial mode");
    });

    it("send_delegation should return tutorial-only message", async () => {
      const result = await ctx.client.callTool({
        name: "send_delegation",
        arguments: { from: "B62qA", to: "B62qB" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("only available in tutorial mode");
    });

    it("get_transaction_status should return tutorial-only message", async () => {
      const result = await ctx.client.callTool({
        name: "get_transaction_status",
        arguments: { payment: "someid" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("only available in tutorial mode");
    });

    it("get_mempool should return tutorial-only message", async () => {
      const result = await ctx.client.callTool({ name: "get_mempool", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("only available in tutorial mode");
    });
  });

  describe("network tools", () => {
    it("get_sync_status should return DB stats in snapshot mode", async () => {
      const mockStats = { total_blocks: 100, canonical_blocks: 90, max_height: 99 };
      (ctx.mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [mockStats] });

      const result = await ctx.client.callTool({ name: "get_sync_status", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.mode).toBe("snapshot");
      expect(parsed.total_blocks).toBe(100);
    });

    it("get_genesis_constants should return tutorial-only message", async () => {
      const result = await ctx.client.callTool({ name: "get_genesis_constants", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("only available in tutorial mode");
    });

    it("get_network_id should return tutorial-only message", async () => {
      const result = await ctx.client.callTool({ name: "get_network_id", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("only available in tutorial mode");
    });

    it("get_archive_stats should return stats", async () => {
      const mockStats = { total_blocks: 50, total_user_commands: 10 };
      (ctx.mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [mockStats] });

      const result = await ctx.client.callTool({ name: "get_archive_stats", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(JSON.parse(text)).toEqual(mockStats);
    });
  });

  describe("schema tools", () => {
    it("query_archive_sql should execute read-only query", async () => {
      const mockResult = { rows: [{ count: 5 }], rowCount: 1 };
      (ctx.mockDb.queryReadOnly as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResult);

      const result = await ctx.client.callTool({
        name: "query_archive_sql",
        arguments: { sql: "SELECT count(*) FROM blocks" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.rowCount).toBe(1);
      expect(parsed.rows[0].count).toBe(5);
    });

    it("query_archive_sql should handle errors", async () => {
      (ctx.mockDb.queryReadOnly as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Only SELECT/WITH/EXPLAIN queries are allowed")
      );

      const result = await ctx.client.callTool({
        name: "query_archive_sql",
        arguments: { sql: "DROP TABLE blocks" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Query error");
    });

    it("get_archive_schema should return table schema", async () => {
      const mockSchema = [
        { table_name: "blocks", column_name: "id", data_type: "integer", is_nullable: "NO" },
        { table_name: "blocks", column_name: "state_hash", data_type: "text", is_nullable: "NO" },
      ];
      (ctx.mockDb.queryReadOnly as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: mockSchema });

      const result = await ctx.client.callTool({ name: "get_archive_schema", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.blocks).toHaveLength(2);
      expect(parsed.blocks[0].column).toBe("id");
    });
  });

  describe("zkapp tools (tutorial-only guards)", () => {
    it("get_events should return tutorial-only message", async () => {
      const result = await ctx.client.callTool({
        name: "get_events",
        arguments: { address: "B62qtest" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("tutorial mode");
    });

    it("get_actions should return tutorial-only message", async () => {
      const result = await ctx.client.callTool({
        name: "get_actions",
        arguments: { address: "B62qtest" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("tutorial mode");
    });

    it("get_archive_blocks should return tutorial-only message", async () => {
      const result = await ctx.client.callTool({ name: "get_archive_blocks", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("tutorial mode");
    });

    it("get_network_state should return tutorial-only message", async () => {
      const result = await ctx.client.callTool({ name: "get_network_state", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("tutorial mode");
    });
  });

  describe("test account tools (tutorial-only guards)", () => {
    it("faucet should return tutorial-only message", async () => {
      const result = await ctx.client.callTool({ name: "faucet", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("tutorial mode");
    });

    it("return_account should return tutorial-only message", async () => {
      const result = await ctx.client.callTool({
        name: "return_account",
        arguments: { pk: "B62qtest", sk: "EKtest" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("tutorial mode");
    });
  });
});
