import { describe, it, expect, vi } from "vitest";
import { RosettaClient } from "../../src/rosetta/client.js";

const NETWORK = { blockchain: "mina", network: "devnet" };
const BASE = "https://devnet-rosetta.example.test";

function mockJson(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn((input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1] = {}) =>
    Promise.resolve(handler(String(input), init as RequestInit))
  ) as unknown as typeof fetch;
}

describe("RosettaClient", () => {
  it("getEndpoint / getNetworkIdentifier expose what was constructed", () => {
    const client = new RosettaClient(BASE, NETWORK, mockFetch(() => mockJson({})));
    expect(client.getEndpoint()).toBe(BASE);
    expect(client.getNetworkIdentifier()).toEqual(NETWORK);
  });

  it("networkStatus POSTs to /network/status with the configured network_identifier", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const client = new RosettaClient(BASE, NETWORK, mockFetch((url, init) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return mockJson({ current_block_identifier: { index: 1, hash: "h" }, sync_status: { synced: true } });
    }));
    const r = await client.networkStatus();
    expect(calls[0].url).toBe(`${BASE}/network/status`);
    expect(calls[0].body).toEqual({ network_identifier: NETWORK });
    expect((r as { sync_status: { synced: boolean } }).sync_status.synced).toBe(true);
  });

  it("accountBalance omits block_identifier when none is supplied", async () => {
    const calls: Array<{ body: Record<string, unknown> }> = [];
    const client = new RosettaClient(BASE, NETWORK, mockFetch((_, init) => {
      calls.push({ body: JSON.parse(String(init.body)) });
      return mockJson({ balances: [] });
    }));
    await client.accountBalance("B62qabc");
    expect(calls[0].body).toEqual({
      network_identifier: NETWORK,
      account_identifier: { address: "B62qabc" },
    });
  });

  it("accountBalance passes through a block_identifier when supplied", async () => {
    const calls: Array<{ body: Record<string, unknown> }> = [];
    const client = new RosettaClient(BASE, NETWORK, mockFetch((_, init) => {
      calls.push({ body: JSON.parse(String(init.body)) });
      return mockJson({ balances: [] });
    }));
    await client.accountBalance("B62qabc", { index: 100 });
    expect(calls[0].body.block_identifier).toEqual({ index: 100 });
  });

  it("block requires at least one of index/hash", async () => {
    const client = new RosettaClient(BASE, NETWORK, mockFetch(() => mockJson({})));
    await expect(client.block({})).rejects.toThrow(/must provide either index or hash/);
  });

  it("block forwards block_identifier verbatim when index is provided", async () => {
    const calls: Array<{ body: Record<string, unknown> }> = [];
    const client = new RosettaClient(BASE, NETWORK, mockFetch((_, init) => {
      calls.push({ body: JSON.parse(String(init.body)) });
      return mockJson({ block: { block_identifier: { index: 5, hash: "h5" } } });
    }));
    await client.block({ index: 5 });
    expect(calls[0].body).toEqual({
      network_identifier: NETWORK,
      block_identifier: { index: 5 },
    });
  });

  it("mempool returns the transaction_identifiers array", async () => {
    const client = new RosettaClient(
      BASE,
      NETWORK,
      mockFetch(() => mockJson({ transaction_identifiers: [{ hash: "5JtA" }, { hash: "5JtB" }] }))
    );
    const r = await client.mempool();
    expect(r.transaction_identifiers.map((t) => t.hash)).toEqual(["5JtA", "5JtB"]);
  });

  it("mempoolTransaction sends the right body shape", async () => {
    const calls: Array<{ body: Record<string, unknown> }> = [];
    const client = new RosettaClient(BASE, NETWORK, mockFetch((_, init) => {
      calls.push({ body: JSON.parse(String(init.body)) });
      return mockJson({ transaction: { transaction_identifier: { hash: "5JtA" } } });
    }));
    await client.mempoolTransaction("5JtA");
    expect(calls[0].body).toEqual({
      network_identifier: NETWORK,
      transaction_identifier: { hash: "5JtA" },
    });
  });

  it("surfaces structured Rosetta errors with code + message", async () => {
    const client = new RosettaClient(
      BASE,
      NETWORK,
      mockFetch(() =>
        mockJson(
          { code: 3, message: "GraphQL query failed", description: "blah", retriable: true, details: { foo: "bar" } },
          { status: 500 }
        )
      )
    );
    await expect(client.networkStatus()).rejects.toThrow(/\[3\]: GraphQL query failed/);
  });

  it("falls back to HTTP status message when body is not Rosetta-shaped", async () => {
    const client = new RosettaClient(
      BASE,
      NETWORK,
      mockFetch(() => new Response("plain text gateway error", { status: 502 }))
    );
    await expect(client.networkStatus()).rejects.toThrow(/HTTP 502/);
  });

  it("isConnected returns true on a healthy /network/list, false otherwise", async () => {
    const ok = new RosettaClient(
      BASE,
      NETWORK,
      mockFetch(() => mockJson({ network_identifiers: [NETWORK] }))
    );
    expect(await ok.isConnected()).toBe(true);

    const bad = new RosettaClient(
      BASE,
      NETWORK,
      mockFetch(() => new Response("nope", { status: 503 }))
    );
    expect(await bad.isConnected()).toBe(false);
  });
});
