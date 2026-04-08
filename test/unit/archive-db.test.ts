import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArchiveDB } from "../../src/db/archive.js";

// Mock pg module
vi.mock("pg", () => {
  const mockClient = {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: vi.fn(),
  };
  const MockPool = vi.fn(() => ({
    query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }], rowCount: 1 }),
    connect: vi.fn().mockResolvedValue(mockClient),
    end: vi.fn().mockResolvedValue(undefined),
    _mockClient: mockClient,
  }));
  return { default: { Pool: MockPool }, Pool: MockPool };
});

describe("ArchiveDB", () => {
  let db: ArchiveDB;

  beforeEach(() => {
    db = new ArchiveDB();
  });

  it("should create with default config", () => {
    expect(db).toBeDefined();
  });

  it("should create with custom config", () => {
    const db2 = new ArchiveDB({ host: "custom-host", port: 5433 });
    expect(db2).toBeDefined();
  });

  it("should execute a query", async () => {
    const result = await db.query("SELECT 1");
    expect(result).toBeDefined();
    expect(result.rows).toBeDefined();
  });

  it("should check connection", async () => {
    const connected = await db.isConnected();
    expect(connected).toBe(true);
  });

  it("should reject non-SELECT in queryReadOnly", async () => {
    await expect(db.queryReadOnly("DELETE FROM blocks")).rejects.toThrow(
      "Only SELECT/WITH/EXPLAIN queries are allowed"
    );
  });

  it("should reject INSERT in queryReadOnly", async () => {
    await expect(db.queryReadOnly("INSERT INTO blocks VALUES (1)")).rejects.toThrow(
      "Only SELECT/WITH/EXPLAIN queries are allowed"
    );
  });

  it("should reject UPDATE in queryReadOnly", async () => {
    await expect(db.queryReadOnly("UPDATE blocks SET height = 1")).rejects.toThrow(
      "Only SELECT/WITH/EXPLAIN queries are allowed"
    );
  });

  it("should allow SELECT in queryReadOnly", async () => {
    const result = await db.queryReadOnly("SELECT * FROM blocks");
    expect(result).toBeDefined();
  });

  it("should allow WITH (CTE) in queryReadOnly", async () => {
    const result = await db.queryReadOnly("WITH cte AS (SELECT 1) SELECT * FROM cte");
    expect(result).toBeDefined();
  });

  it("should allow EXPLAIN in queryReadOnly", async () => {
    const result = await db.queryReadOnly("EXPLAIN SELECT * FROM blocks");
    expect(result).toBeDefined();
  });

  it("should close the pool", async () => {
    await expect(db.close()).resolves.toBeUndefined();
  });
});
