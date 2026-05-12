import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { setupSnapshotMcp, McpTestContext } from "./helpers.js";

describe("MCP Server - Snapshot Mode (schema-only)", () => {
  let ctx: McpTestContext;

  beforeEach(async () => {
    ctx = await setupSnapshotMcp();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  describe("tool listing", () => {
    it("registers only the schema-only toolset (everything else is tutorial- or live-mode-only)", async () => {
      const result = await ctx.client.listTools();
      const toolNames = result.tools.map((t) => t.name).sort();

      // Snapshot mode is now a thin "schema explorer": SQL access + a way
      // to confirm the DB is connected + the example library for orient.
      expect(toolNames).toEqual([
        "get_archive_schema",
        "get_example",
        "get_sync_status",
        "list_examples",
        "query_archive_sql",
      ].sort());

      // Everything previously snapshot-resident is now tutorial- or live-only.
      const forbidden = [
        // dropped from snapshot in this PR
        "get_account", "get_block", "get_staking_ledger",
        "list_blocks", "get_transaction", "search_transactions",
        "get_archive_stats",
        // tutorial-only (unchanged)
        "faucet", "return_account", "reset_session",
        "freeze_reset", "unfreeze_reset", "freeze_status",
        "describe_state", "send_payment", "send_delegation",
        "get_transaction_status", "get_mempool",
        "get_genesis_constants", "get_network_id", "get_tracked_accounts",
        "get_best_chain",
        // archive-node-api family (tutorial + live, never snapshot)
        "get_events", "get_actions", "get_archive_blocks", "get_network_state",
        // live-only
        "rosetta_status", "rosetta_account", "rosetta_block",
        "rosetta_mempool", "rosetta_mempool_transaction",
      ];
      for (const name of forbidden) expect(toolNames).not.toContain(name);
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

  describe("get_sync_status", () => {
    it("returns DB stats in snapshot mode", async () => {
      const mockStats = { total_blocks: 100, canonical_blocks: 90, max_height: 99 };
      (ctx.mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [mockStats] });

      const result = await ctx.client.callTool({ name: "get_sync_status", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.mode).toBe("snapshot");
      expect(parsed.total_blocks).toBe(100);
    });
  });

  describe("schema tools", () => {
    it("query_archive_sql executes read-only queries", async () => {
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

    it("query_archive_sql surfaces errors", async () => {
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

    it("get_archive_schema returns table definitions", async () => {
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

  describe("examples", () => {
    it("list_examples in snapshot mode returns only schema-applicable workflows", async () => {
      const result = await ctx.client.callTool({ name: "list_examples", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const items = JSON.parse(text) as Array<{ name: string; mode: string }>;
      // Only snapshot-tagged or "both"-tagged examples are returned.
      for (const e of items) expect(["snapshot", "both"]).toContain(e.mode);
      // custom_sql remains the canonical snapshot-applicable workflow.
      expect(items.some((e) => e.name === "custom_sql")).toBe(true);
      // Newly tutorial-tagged examples (after the schema-only reduction)
      // must NOT appear in snapshot mode.
      expect(items.some((e) => e.name === "send_payment")).toBe(false);
      expect(items.some((e) => e.name === "look_up_account")).toBe(false);
      expect(items.some((e) => e.name === "browse_chain_archive")).toBe(false);
    });

    it("list_examples with include='all' still shows every workflow regardless of mode", async () => {
      const result = await ctx.client.callTool({
        name: "list_examples",
        arguments: { include: "all" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const items = JSON.parse(text) as Array<{ name: string; mode: string }>;
      expect(items.some((e) => e.name === "send_payment")).toBe(true);
      expect(items.some((e) => e.name === "custom_sql")).toBe(true);
    });

    it("get_example returns the full workflow by name", async () => {
      const result = await ctx.client.callTool({
        name: "get_example",
        arguments: { name: "custom_sql" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const example = JSON.parse(text);
      expect(example.name).toBe("custom_sql");
      expect(Array.isArray(example.steps)).toBe(true);
    });

    it("get_example with unknown name returns a helpful list", async () => {
      const result = await ctx.client.callTool({
        name: "get_example",
        arguments: { name: "nope" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain("Unknown example 'nope'");
    });
  });
});
