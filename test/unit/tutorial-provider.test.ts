import { describe, it, expect, vi, beforeEach } from "vitest";
import { TutorialProvider } from "../../src/providers/tutorial.js";
import { ArchiveDB } from "../../src/db/archive.js";
import { ArchiveClient } from "@o1-labs/mina-archive-sdk";
import { AccountsManager } from "../../src/graphql/accounts-manager.js";
import { Currency, MinaClient } from "@o1-labs/mina-sdk";

class AccountNotFoundError extends Error {
  override readonly name = "AccountNotFoundError";
  constructor(publicKey: string) {
    super(`Account not found: ${publicKey}`);
  }
}

describe("TutorialProvider", () => {
  let provider: TutorialProvider;
  let mockDb: ArchiveDB;
  let mockClient: MinaClient;
  let mockArchiveApi: ArchiveClient;
  let mockAccountsMgr: AccountsManager;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
      queryReadOnly: vi.fn(),
      isConnected: vi.fn().mockResolvedValue(true),
      close: vi.fn(),
    } as unknown as ArchiveDB;

    mockClient = {
      graphqlUri: "http://test:3085/graphql",
      getSyncStatus: vi.fn(),
      getDaemonStatus: vi.fn(),
      getAccount: vi.fn(),
      getBestChain: vi.fn(),
      getBlock: vi.fn(),
      sendPayment: vi.fn(),
      sendDelegation: vi.fn(),
      getPooledUserCommands: vi.fn(),
      getTransactionStatus: vi.fn(),
      getGenesisConstants: vi.fn(),
      getNetworkId: vi.fn(),
      getTrackedAccounts: vi.fn(),
    } as unknown as MinaClient;

    mockArchiveApi = {
      getEvents: vi.fn(),
      getActions: vi.fn(),
      getBlocks: vi.fn(),
      getNetworkState: vi.fn(),
      graphqlUri: "http://test:8282",
    } as unknown as ArchiveClient;

    mockAccountsMgr = {
      acquireAccount: vi.fn(),
      releaseAccount: vi.fn(),
      listAcquiredAccounts: vi.fn(),
      isConnected: vi.fn().mockResolvedValue(true),
      getEndpoint: vi.fn().mockReturnValue("http://test:8181"),
    } as unknown as AccountsManager;

    provider = new TutorialProvider(mockDb, mockClient, mockArchiveApi, mockAccountsMgr);
  });

  it("should have mode 'tutorial'", () => {
    expect(provider.mode).toBe("tutorial");
  });

  it("should expose all clients", () => {
    expect(provider.client).toBe(mockClient);
    expect(provider.archiveApi).toBe(mockArchiveApi);
    expect(provider.accountsManager).toBe(mockAccountsMgr);
    expect(provider.db).toBe(mockDb);
  });

  it("should allow null archive API and accounts manager", () => {
    const minimal = new TutorialProvider(mockDb, mockClient);
    expect(minimal.archiveApi).toBeNull();
    expect(minimal.accountsManager).toBeNull();
  });

  it("getDaemonEndpoint exposes the underlying SDK uri", () => {
    expect(provider.getDaemonEndpoint()).toBe("http://test:3085/graphql");
  });

  describe("getSyncStatus", () => {
    it("returns the SDK's syncStatus", async () => {
      (mockClient.getSyncStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce("SYNCED");
      expect(await provider.getSyncStatus()).toBe("SYNCED");
    });

    it("returns UNKNOWN when the SDK throws (daemon unreachable)", async () => {
      (mockClient.getSyncStatus as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
      expect(await provider.getSyncStatus()).toBe("UNKNOWN");
    });
  });

  describe("getAccountLive", () => {
    it("delegates to client.getAccount and returns the typed AccountData", async () => {
      const mockAccount = {
        publicKey: "B62qtest",
        nonce: 0,
        delegate: "B62q",
        tokenId: "1",
        balance: { total: Currency.fromGraphQL("1") },
      };
      (mockClient.getAccount as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockAccount);

      const result = await provider.getAccountLive("B62qtest");
      expect(result).toEqual(mockAccount);
    });

    it("maps AccountNotFoundError back to null", async () => {
      (mockClient.getAccount as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new AccountNotFoundError("B62qbad")
      );
      const result = await provider.getAccountLive("B62qbad");
      expect(result).toBeNull();
    });

    it("rethrows other errors", async () => {
      (mockClient.getAccount as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network down"));
      await expect(provider.getAccountLive("B62qtest")).rejects.toThrow("network down");
    });

    it("defaults token to the MINA token id when caller omits it (issue #5)", async () => {
      (mockClient.getAccount as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
      await provider.getAccountLive("B62qtest");
      expect(mockClient.getAccount).toHaveBeenCalledWith("B62qtest", "1");
    });

    it("passes through an explicit token unchanged", async () => {
      (mockClient.getAccount as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});
      await provider.getAccountLive("B62qtest", "wSHV2S4qX9jFsLjQo8r1BsMLH2ZRKsZx6EJd1sbozGPieEC4Jf");
      expect(mockClient.getAccount).toHaveBeenCalledWith(
        "B62qtest",
        "wSHV2S4qX9jFsLjQo8r1BsMLH2ZRKsZx6EJd1sbozGPieEC4Jf"
      );
    });
  });

  describe("getBlockLive", () => {
    it("passes through an explicit stateHash without archive lookup", async () => {
      (mockClient.getBlock as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ stateHash: "3NHash" });

      const result = await provider.getBlockLive("3NHash");

      expect(result).toEqual({ stateHash: "3NHash" });
      expect(mockDb.query).not.toHaveBeenCalled();
      expect(mockClient.getBlock).toHaveBeenCalledWith({ stateHash: "3NHash" });
    });

    it("resolves height to a canonical state_hash via the archive DB first (issue #4)", async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        rows: [{ state_hash: "3NLookedUp" }],
      });
      (mockClient.getBlock as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        stateHash: "3NLookedUp",
        blockHeight: 1281,
      });

      const result = await provider.getBlockLive(undefined, 1281);

      expect(result).toMatchObject({ stateHash: "3NLookedUp" });
      const dbCall = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(dbCall[0]).toContain("FROM blocks");
      expect(dbCall[0]).toContain("height = $1");
      expect(dbCall[1]).toEqual([1281]);
      // Daemon enforces "exactly one of state hash, height" — pass only the
      // resolved stateHash to the SDK.
      expect(mockClient.getBlock).toHaveBeenCalledWith({ stateHash: "3NLookedUp" });
    });

    it("throws when archive DB has no block at the requested height", async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

      await expect(provider.getBlockLive(undefined, 999999)).rejects.toThrow(
        "No block found at height 999999"
      );
      expect(mockClient.getBlock).not.toHaveBeenCalled();
    });

    it("throws when neither stateHash nor height is provided", async () => {
      await expect(provider.getBlockLive()).rejects.toThrow(/stateHash or height/);
      expect(mockDb.query).not.toHaveBeenCalled();
      expect(mockClient.getBlock).not.toHaveBeenCalled();
    });

    it("maps 'block not found' SDK error back to null", async () => {
      (mockClient.getBlock as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("block not found (stateHash=3NHash, height=null)")
      );
      const result = await provider.getBlockLive("3NHash");
      expect(result).toBeNull();
    });
  });

  describe("sendPayment", () => {
    it("delegates to client.sendPayment with Currency-typed amount/fee", async () => {
      const mockResult = { id: "pay1", hash: "txhash", nonce: 0 };
      (mockClient.sendPayment as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResult);

      const result = await provider.sendPayment({
        from: "B62qfrom",
        to: "B62qto",
        amount: "1000000000",
        fee: "100000000",
        memo: "test",
      });

      expect(result).toEqual(mockResult);
      const call = (mockClient.sendPayment as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0].sender).toBe("B62qfrom");
      expect(call[0].receiver).toBe("B62qto");
      expect(call[0].memo).toBe("test");
      expect(call[0].amount).toBeInstanceOf(Currency);
      expect(call[0].amount.toNanominaString()).toBe("1000000000");
      expect(call[0].fee.toNanominaString()).toBe("100000000");
    });

    it("rethrows SDK errors (e.g. insufficient balance)", async () => {
      (mockClient.sendPayment as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Insufficient balance")
      );
      await expect(
        provider.sendPayment({ from: "B62q", to: "B62q", amount: "999999999999999", fee: "100000000" })
      ).rejects.toThrow("Insufficient balance");
    });
  });

  describe("sendDelegation", () => {
    it("delegates to client.sendDelegation", async () => {
      // Regression guard for issue #21: the daemon mutation declares
      // $signature, so the SDK passes an explicit null when omitted. The
      // provider just forwards the call.
      const mockResult = { id: "d1", hash: "h", nonce: 0 };
      (mockClient.sendDelegation as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResult);
      await provider.sendDelegation({ from: "B62q", to: "B62q", fee: "1" });
      expect(mockClient.sendDelegation).toHaveBeenCalledTimes(1);
    });

    it("returns the SDK-typed delegation result", async () => {
      const mockResult = { id: "d1", hash: "delhash", nonce: 0 };
      (mockClient.sendDelegation as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResult);

      const result = await provider.sendDelegation({
        from: "B62qfrom",
        to: "B62qproducer",
        fee: "100000000",
      });

      expect(result).toEqual(mockResult);
    });
  });

  describe("getMempool", () => {
    it("delegates to client.getPooledUserCommands", async () => {
      const mockTxns = [{ hash: "tx1" }, { hash: "tx2" }];
      (mockClient.getPooledUserCommands as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockTxns);

      const result = await provider.getMempool();
      expect(result).toHaveLength(2);
    });
  });

  describe("getBestChain", () => {
    it("delegates to client.getBestChain", async () => {
      const mockChain = [{ stateHash: "h1" }, { stateHash: "h2" }];
      (mockClient.getBestChain as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockChain);

      const result = await provider.getBestChain(5);
      expect(result).toHaveLength(2);
      expect(mockClient.getBestChain).toHaveBeenCalledWith(5);
    });
  });

  describe("getTrackedAccounts", () => {
    it("delegates to client.getTrackedAccounts", async () => {
      const accounts = [{ publicKey: "B62q1", balance: "1000" }];
      (mockClient.getTrackedAccounts as ReturnType<typeof vi.fn>).mockResolvedValueOnce(accounts);

      const result = await provider.getTrackedAccounts();
      expect(result).toHaveLength(1);
      expect(result[0].publicKey).toBe("B62q1");
    });
  });
});
