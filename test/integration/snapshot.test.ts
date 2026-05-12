/**
 * Integration tests for snapshot mode against a real captured archive DB.
 *
 * Snapshot mode is now a "schema explorer": SQL access (query_archive_sql,
 * get_archive_schema) + a DB-connectivity probe (get_sync_status) + the
 * example library. Everything else (get_account, get_block, list_blocks,
 * get_transaction, search_transactions, get_archive_stats, etc.) was
 * dropped — it's available in tutorial mode where you actually have a
 * live lightnet to validate against.
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
import { registerExampleTools } from "../../src/tools/examples.js";

describe("Snapshot Mode Integration (schema-only)", () => {
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
    registerExampleTools(server, getProvider, "snapshot");

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

  it("registers only the schema-only toolset", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "get_archive_schema",
      "get_example",
      "get_sync_status",
      "list_examples",
      "query_archive_sql",
    ].sort());
  });

  it("get_sync_status returns snapshot DB stats", async () => {
    const result = await client.callTool({ name: "get_sync_status", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.mode).toBe("snapshot");
    expect(Number(parsed.total_blocks)).toBeGreaterThan(0);
  });

  it("get_archive_schema returns table definitions for the canonical archive tables", async () => {
    const result = await client.callTool({ name: "get_archive_schema", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const schema = JSON.parse(text);
    expect(schema.blocks).toBeDefined();
    expect(schema.blocks.length).toBeGreaterThan(0);
  });

  it("query_archive_sql executes read-only queries against the real archive", async () => {
    const result = await client.callTool({
      name: "query_archive_sql",
      arguments: { sql: "SELECT count(*) as count FROM blocks" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(Number(parsed.rows[0].count)).toBeGreaterThan(0);
  });

  it("query_archive_sql rejects write queries", async () => {
    const result = await client.callTool({
      name: "query_archive_sql",
      arguments: { sql: "DROP TABLE blocks" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Query error");
  });

  it("dropped-from-snapshot tools surface MCP 'tool not found' errors", async () => {
    // After the schema-only reduction these tools live in tutorial mode
    // only. Depending on SDK version, calling an unregistered tool either
    // rejects or resolves with `MCP error -32602: Tool X not found` —
    // accept both shapes.
    const expectToolNotFound = async (name: string, args: Record<string, unknown> = {}) => {
      try {
        const result = await client.callTool({ name, arguments: args });
        const text = (result.content as Array<{ type: string; text: string }>)[0].text;
        expect(text).toMatch(new RegExp(`Tool ${name} not found`));
      } catch (e) {
        expect((e as Error).message).toMatch(new RegExp(`Tool ${name} not found`));
      }
    };
    for (const name of [
      "get_account", "get_block", "list_blocks", "get_transaction",
      "search_transactions", "get_archive_stats", "get_staking_ledger",
      "faucet", "send_payment",
    ]) {
      await expectToolNotFound(name);
    }
  });
});
