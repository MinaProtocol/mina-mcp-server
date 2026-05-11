/**
 * Integration tests for snapshot mode against a real captured archive DB.
 *
 * These run after the lightnet integration tests capture a snapshot
 * and load it into a standalone Postgres instance.
 *
 * Run:
 *   npx vitest run test/integration/snapshot.test.ts --test-timeout 30000
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ArchiveDB } from "../../src/db/archive.js";
import { SnapshotProvider } from "../../src/providers/snapshot.js";
import { registerAccountTools } from "../../src/tools/accounts.js";
import { registerBlockTools } from "../../src/tools/blocks.js";
import { registerTransactionTools } from "../../src/tools/transactions.js";
import { registerNetworkTools } from "../../src/tools/network.js";
import { registerSchemaTools } from "../../src/tools/schema.js";
import { registerZkAppTools } from "../../src/tools/zkapps.js";
import { registerTestAccountTools } from "../../src/tools/test-accounts.js";

describe("Snapshot Mode Integration", () => {
  let client: Client;
  let server: McpServer;
  let db: ArchiveDB;

  beforeAll(async () => {
    db = new ArchiveDB();
    const provider = new SnapshotProvider(db);

    server = new McpServer({ name: "mina-snapshot-integration", version: "0.1.0" });
    const getProvider = () => provider;

    registerAccountTools(server, getProvider, "snapshot");
    registerBlockTools(server, getProvider, "snapshot");
    registerTransactionTools(server, getProvider, "snapshot");
    registerNetworkTools(server, getProvider, "snapshot");
    registerSchemaTools(server, getProvider, "snapshot");
    registerZkAppTools(server, getProvider, "snapshot");
    registerTestAccountTools(server, getProvider, "snapshot");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "snapshot-test-client", version: "0.1.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
    await db.close();
  });

  it("registers the DB-backed snapshot toolset (tutorial- and live-only tools are filtered out)", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    // Snapshot mode registers the archive-DB tools plus the always-on examples
    // pair; tutorial-only and live-only tools must NOT be registered.
    expect(names).toContain("get_account");
    expect(names).toContain("get_block");
    expect(names).toContain("list_blocks");
    expect(names).toContain("get_transaction");
    expect(names).toContain("search_transactions");
    expect(names).toContain("get_staking_ledger");
    expect(names).toContain("get_sync_status");
    expect(names).toContain("get_archive_stats");
    expect(names).toContain("query_archive_sql");
    expect(names).toContain("get_archive_schema");
    // Filtered out:
    for (const forbidden of ["faucet", "send_payment", "send_delegation", "get_tracked_accounts", "get_best_chain", "get_events", "get_actions", "get_archive_blocks", "get_network_state"]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("get_sync_status should return snapshot stats", async () => {
    const result = await client.callTool({ name: "get_sync_status", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.mode).toBe("snapshot");
    expect(Number(parsed.total_blocks)).toBeGreaterThan(0);
  });

  it("list_blocks should return blocks from archive", async () => {
    const result = await client.callTool({ name: "list_blocks", arguments: { limit: 3 } });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const blocks = JSON.parse(text);
    expect(blocks.length).toBeGreaterThan(0);
  });

  it("get_archive_stats should return statistics", async () => {
    const result = await client.callTool({ name: "get_archive_stats", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const stats = JSON.parse(text);
    expect(Number(stats.total_blocks)).toBeGreaterThan(0);
  });

  it("get_archive_schema should return table definitions", async () => {
    const result = await client.callTool({ name: "get_archive_schema", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const schema = JSON.parse(text);
    expect(schema.blocks).toBeDefined();
    expect(schema.blocks.length).toBeGreaterThan(0);
  });

  it("query_archive_sql should execute read-only queries", async () => {
    const result = await client.callTool({
      name: "query_archive_sql",
      arguments: { sql: "SELECT count(*) as count FROM blocks" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(Number(parsed.rows[0].count)).toBeGreaterThan(0);
  });

  it("query_archive_sql should reject write queries", async () => {
    const result = await client.callTool({
      name: "query_archive_sql",
      arguments: { sql: "DROP TABLE blocks" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Query error");
  });

  it("calling a tutorial-only tool yields an MCP 'tool not found' error (it is not registered in snapshot mode)", async () => {
    // Filtering happens at registration time now, so tutorial-only tools
    // aren't even on the wire. Depending on the MCP SDK version the
    // unknown-tool path either rejects the promise or resolves with
    // an `MCP error -32602: Tool X not found` text content — accept both.
    const expectToolNotFound = async (name: string, args: Record<string, unknown> = {}) => {
      try {
        const result = await client.callTool({ name, arguments: args });
        const text = (result.content as Array<{ type: string; text: string }>)[0].text;
        expect(text).toMatch(new RegExp(`Tool ${name} not found`));
      } catch (e) {
        expect((e as Error).message).toMatch(new RegExp(`Tool ${name} not found`));
      }
    };
    await expectToolNotFound("send_payment", { from: "B62qA", to: "B62qB", amount: "1000000000" });
    await expectToolNotFound("faucet");
  });
});
