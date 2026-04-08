import { describe, it, expect, vi, beforeEach } from "vitest";
import { SnapshotProvider } from "../../src/providers/snapshot.js";
import { ArchiveDB } from "../../src/db/archive.js";

describe("SnapshotProvider", () => {
  let provider: SnapshotProvider;
  let mockDb: ArchiveDB;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
      queryReadOnly: vi.fn(),
      isConnected: vi.fn().mockResolvedValue(true),
      close: vi.fn(),
    } as unknown as ArchiveDB;
    provider = new SnapshotProvider(mockDb);
  });

  it("should have mode 'snapshot'", () => {
    expect(provider.mode).toBe("snapshot");
  });

  describe("getAccount", () => {
    it("should query by public key", async () => {
      const mockRows = [{ public_key: "B62qtest", token_id: "1" }];
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: mockRows });

      const result = await provider.getAccount("B62qtest");
      expect(result).toEqual(mockRows);

      const call = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain("public_keys");
      expect(call[1]).toEqual(["B62qtest"]);
    });
  });

  describe("getBlock", () => {
    it("should query by height (number)", async () => {
      const mockBlock = { state_hash: "hash1", height: 100 };
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [mockBlock] });

      const result = await provider.getBlock(100);
      expect(result).toEqual(mockBlock);

      const call = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain("b.height = $1");
      expect(call[1]).toEqual([100]);
    });

    it("should query by state hash (string)", async () => {
      const mockBlock = { state_hash: "3NKaBJsN1SehD6", height: 100 };
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [mockBlock] });

      const result = await provider.getBlock("3NKaBJsN1SehD6");
      expect(result).toEqual(mockBlock);

      const call = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain("b.state_hash = $1");
    });

    it("should return null when block not found", async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });
      const result = await provider.getBlock(999999);
      expect(result).toBeNull();
    });
  });

  describe("listBlocks", () => {
    it("should list with defaults", async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [{ height: 1 }, { height: 2 }] });

      const result = await provider.listBlocks();
      expect(result).toHaveLength(2);

      const call = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toEqual([20, 0]); // default limit, offset
    });

    it("should filter by status", async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

      await provider.listBlocks(10, 0, "canonical");

      const call = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain("chain_status");
      expect(call[1]).toEqual([10, 0, "canonical"]);
    });
  });

  describe("getTransaction", () => {
    it("should find a user command", async () => {
      const mockTx = { hash: "txhash1", command_type: "payment", amount: "1000000000" };
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [mockTx] });

      const result = await provider.getTransaction("txhash1");
      expect(result).toEqual({ type: "user_command", ...mockTx });
    });

    it("should fall back to internal commands", async () => {
      (mockDb.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rows: [] }) // no user command
        .mockResolvedValueOnce({ rows: [{ hash: "txhash2", command_type: "coinbase" }] });

      const result = await provider.getTransaction("txhash2");
      expect(result).toEqual({ type: "internal_command", hash: "txhash2", command_type: "coinbase" });
    });

    it("should return null when not found", async () => {
      (mockDb.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await provider.getTransaction("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("searchTransactions", () => {
    it("should search by sender", async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [{ hash: "tx1" }] });

      const result = await provider.searchTransactions({ sender: "B62qsender" });
      expect(result).toHaveLength(1);

      const call = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain("pk_src.value = $1");
      expect(call[1][0]).toBe("B62qsender");
    });

    it("should combine multiple filters", async () => {
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

      await provider.searchTransactions({
        sender: "B62qA",
        receiver: "B62qB",
        minAmount: "1000",
        limit: 5,
      });

      const call = (mockDb.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain("pk_src.value = $1");
      expect(call[0]).toContain("pk_recv.value = $2");
      expect(call[0]).toContain("uc.amount::numeric >= $3");
      expect(call[1]).toEqual(["B62qA", "B62qB", "1000", 5, 0]);
    });
  });

  describe("getStats", () => {
    it("should return database statistics", async () => {
      const mockStats = { total_blocks: 100, canonical_blocks: 90, max_height: 99 };
      (mockDb.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [mockStats] });

      const result = await provider.getStats();
      expect(result).toEqual(mockStats);
    });
  });

  describe("rawQuery", () => {
    it("should delegate to queryReadOnly", async () => {
      (mockDb.queryReadOnly as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [{ count: 5 }], rowCount: 1 });

      const result = await provider.rawQuery("SELECT count(*) FROM blocks");
      expect(result.rows[0]).toEqual({ count: 5 });
      expect(mockDb.queryReadOnly).toHaveBeenCalledWith("SELECT count(*) FROM blocks", undefined);
    });
  });
});
