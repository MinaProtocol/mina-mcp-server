import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TutorialProvider } from "../../src/providers/tutorial.js";
import { ArchiveDB } from "../../src/db/archive.js";
import { GraphQLClient } from "../../src/graphql/client.js";
import { ArchiveNodeAPI } from "../../src/graphql/archive-api.js";
import { AccountsManager } from "../../src/graphql/accounts-manager.js";

describe("TutorialProvider", () => {
  let provider: TutorialProvider;
  let mockDb: ArchiveDB;
  let mockGraphql: GraphQLClient;
  let mockArchiveApi: ArchiveNodeAPI;
  let mockAccountsMgr: AccountsManager;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
      queryReadOnly: vi.fn(),
      isConnected: vi.fn().mockResolvedValue(true),
      close: vi.fn(),
    } as unknown as ArchiveDB;

    mockGraphql = {
      query: vi.fn(),
      isConnected: vi.fn().mockResolvedValue(true),
      getEndpoint: vi.fn().mockReturnValue("http://test:3085/graphql"),
    } as unknown as GraphQLClient;

    mockArchiveApi = {
      getEvents: vi.fn(),
      getActions: vi.fn(),
      getBlocks: vi.fn(),
      getNetworkState: vi.fn(),
      isConnected: vi.fn().mockResolvedValue(true),
      getEndpoint: vi.fn().mockReturnValue("http://test:8282"),
    } as unknown as ArchiveNodeAPI;

    mockAccountsMgr = {
      acquireAccount: vi.fn(),
      releaseAccount: vi.fn(),
      listAcquiredAccounts: vi.fn(),
      isConnected: vi.fn().mockResolvedValue(true),
      getEndpoint: vi.fn().mockReturnValue("http://test:8181"),
    } as unknown as AccountsManager;

    provider = new TutorialProvider(mockDb, mockGraphql, mockArchiveApi, mockAccountsMgr);
  });

  it("should have mode 'tutorial'", () => {
    expect(provider.mode).toBe("tutorial");
  });

  it("should expose all clients", () => {
    expect(provider.graphql).toBe(mockGraphql);
    expect(provider.archiveApi).toBe(mockArchiveApi);
    expect(provider.accountsManager).toBe(mockAccountsMgr);
    expect(provider.db).toBe(mockDb);
  });

  it("should allow null archive API and accounts manager", () => {
    const minimal = new TutorialProvider(mockDb, mockGraphql);
    expect(minimal.archiveApi).toBeNull();
    expect(minimal.accountsManager).toBeNull();
  });

  describe("getSyncStatus", () => {
    it("should query daemon sync status", async () => {
      (mockGraphql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { syncStatus: "SYNCED" },
      });

      const status = await provider.getSyncStatus();
      expect(status).toBe("SYNCED");
    });

    it("should return UNKNOWN when no data", async () => {
      (mockGraphql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: null });
      const status = await provider.getSyncStatus();
      expect(status).toBe("UNKNOWN");
    });
  });

  describe("getAccountLive", () => {
    it("should query account via GraphQL", async () => {
      const mockAccount = { publicKey: "B62qtest", balance: { total: "1550000000000" } };
      (mockGraphql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { account: mockAccount },
      });

      const result = await provider.getAccountLive("B62qtest");
      expect(result).toEqual(mockAccount);
    });

    it("should throw on GraphQL errors", async () => {
      (mockGraphql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        errors: [{ message: "Account not found" }],
      });

      await expect(provider.getAccountLive("B62qbad")).rejects.toThrow("Account not found");
    });
  });

  describe("sendPayment", () => {
    it("should send payment via GraphQL mutation", async () => {
      const mockResult = { payment: { id: "pay1", hash: "txhash" } };
      (mockGraphql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { sendPayment: mockResult },
      });

      const result = await provider.sendPayment({
        from: "B62qfrom",
        to: "B62qto",
        amount: "1000000000",
        fee: "100000000",
        memo: "test",
      });

      expect(result).toEqual(mockResult);
      const call = (mockGraphql.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1].input.from).toBe("B62qfrom");
      expect(call[1].input.amount).toBe("1000000000");
    });

    it("should throw on payment errors", async () => {
      (mockGraphql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        errors: [{ message: "Insufficient balance" }],
      });

      await expect(
        provider.sendPayment({ from: "B62q", to: "B62q", amount: "999999999999999", fee: "100000000" })
      ).rejects.toThrow("Insufficient balance");
    });
  });

  describe("sendDelegation", () => {
    it("should send delegation via GraphQL", async () => {
      (mockGraphql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { sendDelegation: { delegation: { hash: "delhash" } } },
      });

      const result = await provider.sendDelegation({
        from: "B62qfrom",
        to: "B62qproducer",
        fee: "100000000",
      });

      expect(result).toBeDefined();
    });
  });

  describe("getMempool", () => {
    it("should query pooled commands", async () => {
      const mockTxns = [{ hash: "tx1" }, { hash: "tx2" }];
      (mockGraphql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { pooledUserCommands: mockTxns },
      });

      const result = await provider.getMempool();
      expect(result).toHaveLength(2);
    });
  });

  describe("getBestChain", () => {
    it("should query best chain", async () => {
      const mockChain = [{ stateHash: "h1" }, { stateHash: "h2" }];
      (mockGraphql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { bestChain: mockChain },
      });

      const result = await provider.getBestChain(5);
      expect(result).toHaveLength(2);
    });
  });

  describe("getTrackedAccounts", () => {
    it("should list tracked accounts", async () => {
      (mockGraphql.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { trackedAccounts: [{ publicKey: "B62q1", balance: { total: "1000" } }] },
      });

      const result = await provider.getTrackedAccounts();
      expect(result).toHaveLength(1);
      expect(result[0].publicKey).toBe("B62q1");
    });
  });
});
