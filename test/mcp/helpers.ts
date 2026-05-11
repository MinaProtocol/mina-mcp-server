import { vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SnapshotProvider } from "../../src/providers/snapshot.js";
import { TutorialProvider } from "../../src/providers/tutorial.js";
import { LiveProvider } from "../../src/providers/live.js";
import { resolveNetwork, NetworkName } from "../../src/networks.js";
import { RosettaClient } from "../../src/rosetta/client.js";
import { ArchiveDB } from "../../src/db/archive.js";
import { GraphQLClient } from "../../src/graphql/client.js";
import { ArchiveNodeAPI } from "../../src/graphql/archive-api.js";
import { AccountsManager } from "../../src/graphql/accounts-manager.js";
import { SessionTracker } from "../../src/session/tracker.js";
import { ResetController } from "../../src/reset/controller.js";
import { registerAccountTools } from "../../src/tools/accounts.js";
import { registerBlockTools } from "../../src/tools/blocks.js";
import { registerTransactionTools } from "../../src/tools/transactions.js";
import { registerNetworkTools } from "../../src/tools/network.js";
import { registerSchemaTools } from "../../src/tools/schema.js";
import { registerZkAppTools } from "../../src/tools/zkapps.js";
import { registerTestAccountTools } from "../../src/tools/test-accounts.js";
import { registerAdminTools } from "../../src/tools/admin.js";
import { registerStateTools } from "../../src/tools/state.js";
import { registerExampleTools } from "../../src/tools/examples.js";
import { registerRosettaTools } from "../../src/tools/rosetta.js";

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

  registerAccountTools(server, getProvider, "snapshot");
  registerBlockTools(server, getProvider, "snapshot");
  registerTransactionTools(server, getProvider, "snapshot");
  registerNetworkTools(server, getProvider, "snapshot");
  registerSchemaTools(server, getProvider, "snapshot");
  registerZkAppTools(server, getProvider, "snapshot");
  registerTestAccountTools(server, getProvider, "snapshot");
  registerAdminTools(server, getProvider, "snapshot");
  registerStateTools(server, getProvider, "snapshot");
  registerExampleTools(server, getProvider, "snapshot");

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
  tracker: SessionTracker;
  resetController: ResetController;
}

export interface LiveMcpTestContext {
  client: Client;
  server: McpServer;
  provider: LiveProvider;
  mockGraphQL: GraphQLClient;
  mockArchiveApi: ArchiveNodeAPI;
  mockRosetta: RosettaClient;
  cleanup: () => Promise<void>;
}

export function createMockRosetta(): RosettaClient {
  return {
    networkList: vi.fn().mockResolvedValue({ network_identifiers: [{ blockchain: "mina", network: "devnet" }] }),
    networkStatus: vi.fn().mockResolvedValue({}),
    accountBalance: vi.fn().mockResolvedValue({}),
    block: vi.fn().mockResolvedValue({}),
    mempool: vi.fn().mockResolvedValue({ transaction_identifiers: [] }),
    mempoolTransaction: vi.fn().mockResolvedValue({}),
    isConnected: vi.fn().mockResolvedValue(true),
    getEndpoint: vi.fn().mockReturnValue("https://rosetta.test"),
    getNetworkIdentifier: vi.fn().mockReturnValue({ blockchain: "mina", network: "devnet" }),
  } as unknown as RosettaClient;
}

export async function setupLiveMcp(networkName: NetworkName = "devnet"): Promise<LiveMcpTestContext> {
  const mockGraphQL = createMockGraphQL();
  const mockArchiveApi = createMockArchiveApi();
  const mockRosetta = createMockRosetta();
  const provider = new LiveProvider(resolveNetwork(networkName));
  // Swap in mocks so tests don't reach the public network.
  (provider as unknown as { graphql: GraphQLClient }).graphql = mockGraphQL;
  (provider as unknown as { archiveApi: ArchiveNodeAPI }).archiveApi = mockArchiveApi;
  (provider as unknown as { rosetta: RosettaClient }).rosetta = mockRosetta;

  const server = new McpServer({ name: "mina-live-test", version: "0.1.0" });
  const getProvider = () => provider;

  registerAccountTools(server, getProvider, "live");
  registerBlockTools(server, getProvider, "live");
  registerTransactionTools(server, getProvider, "live");
  registerNetworkTools(server, getProvider, "live");
  registerSchemaTools(server, getProvider, "live");
  registerZkAppTools(server, getProvider, "live");
  registerTestAccountTools(server, getProvider, "live");
  registerAdminTools(server, getProvider, "live");
  registerStateTools(server, getProvider, "live");
  registerExampleTools(server, getProvider, "live");
  registerRosettaTools(server, getProvider, "live");

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.1.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    server,
    provider,
    mockGraphQL,
    mockArchiveApi,
    mockRosetta,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

export async function setupTutorialMcp(): Promise<TutorialMcpTestContext> {
  const mockDb = createMockDb();
  const mockGraphQL = createMockGraphQL();
  const mockArchiveApi = createMockArchiveApi();
  const mockAccountsManager = createMockAccountsManager();
  const tracker = new SessionTracker(mockAccountsManager);
  const resetController = new ResetController();
  const provider = new TutorialProvider(mockDb, mockGraphQL, mockArchiveApi, mockAccountsManager, tracker, resetController);

  const server = new McpServer({ name: "mina-tutorial-test", version: "0.1.0" });
  const getProvider = () => provider;

  registerAccountTools(server, getProvider, "tutorial");
  registerBlockTools(server, getProvider, "tutorial");
  registerTransactionTools(server, getProvider, "tutorial");
  registerNetworkTools(server, getProvider, "tutorial");
  registerSchemaTools(server, getProvider, "tutorial");
  registerZkAppTools(server, getProvider, "tutorial");
  registerTestAccountTools(server, getProvider, "tutorial");
  registerAdminTools(server, getProvider, "tutorial");
  registerStateTools(server, getProvider, "tutorial");
  registerExampleTools(server, getProvider, "tutorial");

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
    tracker,
    resetController,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}
