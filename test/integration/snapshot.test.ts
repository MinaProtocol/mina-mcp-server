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

    registerAccountTools(server, getProvider);
    registerBlockTools(server, getProvider);
    registerTransactionTools(server, getProvider);
    registerNetworkTools(server, getProvider);
    registerSchemaTools(server, getProvider);
    registerZkAppTools(server, getProvider);
    registerTestAccountTools(server, getProvider);

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

  it("should list all tools", async () => {
    const result = await client.listTools();
    expect(result.tools.length).toBeGreaterThanOrEqual(20);
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

  it("send_payment should return tutorial-only message", async () => {
    const result = await client.callTool({
      name: "send_payment",
      arguments: { from: "B62qA", to: "B62qB", amount: "1000000000" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("only available in tutorial mode");
  });

  it("faucet should return tutorial-only message", async () => {
    const result = await client.callTool({ name: "faucet", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("tutorial mode");
  });
});
