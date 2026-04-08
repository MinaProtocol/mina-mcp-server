import { vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SnapshotProvider } from "../../src/providers/snapshot.js";
import { TutorialProvider } from "../../src/providers/tutorial.js";
import { ArchiveDB } from "../../src/db/archive.js";
import { GraphQLClient } from "../../src/graphql/client.js";
import { ArchiveNodeAPI } from "../../src/graphql/archive-api.js";
import { AccountsManager } from "../../src/graphql/accounts-manager.js";
import { registerAccountTools } from "../../src/tools/accounts.js";
import { registerBlockTools } from "../../src/tools/blocks.js";
import { registerTransactionTools } from "../../src/tools/transactions.js";
import { registerNetworkTools } from "../../src/tools/network.js";
import { registerSchemaTools } from "../../src/tools/schema.js";
import { registerZkAppTools } from "../../src/tools/zkapps.js";
import { registerTestAccountTools } from "../../src/tools/test-accounts.js";

export function createMockDb() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    queryReadOnly: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    isConnected: vi.fn().mockResolvedValue(true),
    close: vi.fn(),
  } as unknown as ArchiveDB;
}

export function createMockGraphQL() {
  return {
    query: vi.fn().mockResolvedValue({ data: {} }),
    isConnected: vi.fn().mockResolvedValue(true),
    getEndpoint: vi.fn().mockReturnValue("http://localhost:3085/graphql"),
  } as unknown as GraphQLClient;
}

export function createMockArchiveApi() {
  return {
    getEvents: vi.fn().mockResolvedValue([]),
    getActions: vi.fn().mockResolvedValue([]),
    getBlocks: vi.fn().mockResolvedValue([]),
    getNetworkState: vi.fn().mockResolvedValue({ canonicalMaxBlockHeight: 100, pendingMaxBlockHeight: 101 }),
    isConnected: vi.fn().mockResolvedValue(true),
    getEndpoint: vi.fn().mockReturnValue("http://localhost:8282"),
  } as unknown as ArchiveNodeAPI;
}

export function createMockAccountsManager() {
  return {
    acquireAccount: vi.fn().mockResolvedValue({ pk: "B62qtest", sk: "EKtest" }),
    releaseAccount: vi.fn().mockResolvedValue(undefined),
    listAcquiredAccounts: vi.fn().mockResolvedValue([]),
    unlockAccount: vi.fn().mockResolvedValue(undefined),
    lockAccount: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockResolvedValue(true),
    getEndpoint: vi.fn().mockReturnValue("http://localhost:8181"),
  } as unknown as AccountsManager;
}

export interface McpTestContext {
  client: Client;
  server: McpServer;
  provider: SnapshotProvider | TutorialProvider;
  mockDb: ArchiveDB;
  cleanup: () => Promise<void>;
}

export async function setupSnapshotMcp(): Promise<McpTestContext> {
  const mockDb = createMockDb();
  const provider = new SnapshotProvider(mockDb);

  const server = new McpServer({ name: "mina-snapshot-test", version: "0.1.0" });
  const getProvider = () => provider;

  registerAccountTools(server, getProvider);
  registerBlockTools(server, getProvider);
  registerTransactionTools(server, getProvider);
  registerNetworkTools(server, getProvider);
  registerSchemaTools(server, getProvider);
  registerZkAppTools(server, getProvider);
  registerTestAccountTools(server, getProvider);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "test-client", version: "0.1.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    server,
    provider,
    mockDb,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

export interface TutorialMcpTestContext extends McpTestContext {
  provider: TutorialProvider;
  mockGraphQL: GraphQLClient;
  mockArchiveApi: ArchiveNodeAPI;
  mockAccountsManager: AccountsManager;
}

export async function setupTutorialMcp(): Promise<TutorialMcpTestContext> {
  const mockDb = createMockDb();
  const mockGraphQL = createMockGraphQL();
  const mockArchiveApi = createMockArchiveApi();
  const mockAccountsManager = createMockAccountsManager();
  const provider = new TutorialProvider(mockDb, mockGraphQL, mockArchiveApi, mockAccountsManager);

  const server = new McpServer({ name: "mina-tutorial-test", version: "0.1.0" });
  const getProvider = () => provider;

  registerAccountTools(server, getProvider);
  registerBlockTools(server, getProvider);
  registerTransactionTools(server, getProvider);
  registerNetworkTools(server, getProvider);
  registerSchemaTools(server, getProvider);
  registerZkAppTools(server, getProvider);
  registerTestAccountTools(server, getProvider);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "test-client", version: "0.1.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    server,
    provider,
    mockDb,
    mockGraphQL,
    mockArchiveApi,
    mockAccountsManager,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}
