import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ArchiveNodeAPI } from "../../src/graphql/archive-api.js";

describe("ArchiveNodeAPI", () => {
  let api: ArchiveNodeAPI;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    api = new ArchiveNodeAPI("http://test:8282");
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("should create with default endpoint", () => {
    const defaultApi = new ArchiveNodeAPI();
    expect(defaultApi.getEndpoint()).toBe("http://localhost:8282");
  });

  it("should fetch events", async () => {
    const mockEvents = [
      {
        blockInfo: { height: 10, stateHash: "hash1" },
        eventData: [{ data: ["field1"], accountUpdateId: "1", transactionInfo: { hash: "txhash" } }],
      },
    ];
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { events: mockEvents } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const events = await api.getEvents({ address: "B62qtest" });
    expect(events).toHaveLength(1);
    expect(events[0].blockInfo.height).toBe(10);
  });

  it("should throw on events error", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: [{ message: "Invalid address" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(api.getEvents({ address: "bad" })).rejects.toThrow("Invalid address");
  });

  it("should fetch actions", async () => {
    const mockActions = [
      {
        blockInfo: { height: 5 },
        actionState: { actionStateOne: "state1" },
        actionData: [{ data: ["f1", "f2"] }],
      },
    ];
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { actions: mockActions } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const actions = await api.getActions({ address: "B62qtest" });
    expect(actions).toHaveLength(1);
    expect(actions[0].actionData[0].data).toEqual(["f1", "f2"]);
  });

  it("should fetch blocks", async () => {
    const mockBlocks = [
      { blockHeight: 100, creator: "B62q...", stateHash: "hash", dateTime: "2026-01-01", transactions: { coinbase: "720000000000" } },
    ];
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { blocks: mockBlocks } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const blocks = await api.getBlocks({ canonical: true, limit: 10 });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].blockHeight).toBe(100);
  });

  it("should fetch network state", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { networkState: { maxBlockHeight: { canonicalMaxBlockHeight: 50, pendingMaxBlockHeight: 52 } } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const state = await api.getNetworkState();
    expect(state.canonicalMaxBlockHeight).toBe(50);
    expect(state.pendingMaxBlockHeight).toBe(52);
  });

  it("should check connection (success)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { networkState: { maxBlockHeight: { canonicalMaxBlockHeight: 1, pendingMaxBlockHeight: 1 } } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    expect(await api.isConnected()).toBe(true);
  });

  it("should check connection (failure)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await api.isConnected()).toBe(false);
  });
});
