/**
 * Integration tests for tutorial mode MCP tools against a live lightnet.
 *
 * Tests the full MCP flow: faucet -> send_payment -> get_transaction_status
 *
 * Prerequisites:
 *   docker compose -f docker-compose.tutorial.yml up -d
 *   # Wait for healthcheck to pass (~1-2 min)
 *
 * Run:
 *   npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ArchiveDB } from "../../src/db/archive.js";
import { GraphQLClient } from "../../src/graphql/client.js";
import { ArchiveNodeAPI } from "../../src/graphql/archive-api.js";
import { AccountsManager } from "../../src/graphql/accounts-manager.js";
import { TutorialProvider } from "../../src/providers/tutorial.js";
import { registerAccountTools } from "../../src/tools/accounts.js";
import { registerBlockTools } from "../../src/tools/blocks.js";
import { registerTransactionTools } from "../../src/tools/transactions.js";
import { registerNetworkTools } from "../../src/tools/network.js";
import { registerSchemaTools } from "../../src/tools/schema.js";
import { registerZkAppTools } from "../../src/tools/zkapps.js";
import { registerTestAccountTools } from "../../src/tools/test-accounts.js";

const DAEMON_ENDPOINT = process.env.MINA_GRAPHQL_ENDPOINT ?? "http://localhost:3085/graphql";
const ARCHIVE_API_ENDPOINT = process.env.ARCHIVE_API_ENDPOINT ?? "http://localhost:8282";
const ACCOUNTS_MANAGER_ENDPOINT = process.env.ACCOUNTS_MANAGER_ENDPOINT ?? "http://localhost:8181";

describe("Tutorial Mode Integration - MCP Tools", () => {
  let client: Client;
  let server: McpServer;
  let db: ArchiveDB;

  beforeAll(async () => {
    db = new ArchiveDB();
    const graphql = new GraphQLClient(DAEMON_ENDPOINT);
    const archiveApi = new ArchiveNodeAPI(ARCHIVE_API_ENDPOINT);
    const accountsManager = new AccountsManager(ACCOUNTS_MANAGER_ENDPOINT);
    const provider = new TutorialProvider(db, graphql, archiveApi, accountsManager);

    server = new McpServer({ name: "mina-tutorial-integration", version: "0.1.0" });
    const getProvider = () => provider;

    registerAccountTools(server, getProvider);
    registerBlockTools(server, getProvider);
    registerTransactionTools(server, getProvider);
    registerNetworkTools(server, getProvider);
    registerSchemaTools(server, getProvider);
    registerZkAppTools(server, getProvider);
    registerTestAccountTools(server, getProvider);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "tutorial-test-client", version: "0.1.0" });
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

  it("get_sync_status should show SYNCED", async () => {
    const result = await client.callTool({ name: "get_sync_status", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.syncStatus).toBe("SYNCED");
  });

  it("get_genesis_constants should return constants", async () => {
    const result = await client.callTool({ name: "get_genesis_constants", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.coinbase).toBeDefined();
    expect(parsed.accountCreationFee).toBeDefined();
  });

  describe("faucet -> send_payment -> check status", () => {
    let senderPk: string;
    let senderSk: string;
    let receiverPk: string;
    let receiverSk: string;
    let paymentHash: string;

    it("should get a sender account via faucet", async () => {
      const result = await client.callTool({ name: "faucet", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.publicKey).toMatch(/^B62q/);
      expect(parsed.status).toBe("ready");
      senderPk = parsed.publicKey;
      senderSk = parsed.secretKey;
    });

    it("should get a receiver account via faucet", async () => {
      const result = await client.callTool({ name: "faucet", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.publicKey).toMatch(/^B62q/);
      receiverPk = parsed.publicKey;
      receiverSk = parsed.secretKey;
    });

    it("should send a payment", async () => {
      const result = await client.callTool({
        name: "send_payment",
        arguments: {
          from: senderPk,
          to: receiverPk,
          amount: "1000000000",
          fee: "100000000",
          memo: "mcp-integration-test",
        },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.payment).toBeDefined();
      paymentHash = parsed.payment.hash;
      expect(paymentHash).toBeDefined();
    });

    it("should check transaction status", async () => {
      const result = await client.callTool({
        name: "get_transaction_status",
        arguments: { payment: paymentHash },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const status = JSON.parse(text);
      expect(["PENDING", "INCLUDED", "UNKNOWN"]).toContain(status);
    });

    afterAll(async () => {
      // Return accounts to pool
      if (senderPk && senderSk) {
        await client.callTool({
          name: "return_account",
          arguments: { pk: senderPk, sk: senderSk },
        }).catch(() => {});
      }
      if (receiverPk && receiverSk) {
        await client.callTool({
          name: "return_account",
          arguments: { pk: receiverPk, sk: receiverSk },
        }).catch(() => {});
      }
    });
  });
});
