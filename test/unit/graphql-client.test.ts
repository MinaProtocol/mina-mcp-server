import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GraphQLClient } from "../../src/graphql/client.js";

describe("GraphQLClient", () => {
  let client: GraphQLClient;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy BEFORE constructing the client: the underlying SDK MinaClient
    // captures globalThis.fetch in its constructor, so the spy must already
    // be installed for calls to be intercepted.
    fetchSpy = vi.spyOn(globalThis, "fetch");
    client = new GraphQLClient("http://test:3085/graphql");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("should create with default endpoint", () => {
    const defaultClient = new GraphQLClient();
    expect(defaultClient.getEndpoint()).toBe("http://localhost:3085/graphql");
  });

  it("should create with custom endpoint", () => {
    expect(client.getEndpoint()).toBe("http://test:3085/graphql");
  });

  it("should send a GraphQL query", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { syncStatus: "SYNCED" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await client.query<{ syncStatus: string }>("{ syncStatus }");
    expect(result.data?.syncStatus).toBe("SYNCED");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://test:3085/graphql");
    expect(init!.method).toBe("POST");
    const body = JSON.parse(init!.body as string);
    expect(body.query).toBe("{ syncStatus }");
  });

  it("should pass variables", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { account: { balance: "1000" } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await client.query("query($pk: PublicKey!) { account(publicKey: $pk) { balance } }", {
      pk: "B62test",
    });

    const callBody = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(callBody.variables).toEqual({ pk: "B62test" });
  });

  it("should throw on transport (HTTP) errors", async () => {
    // Persistent mock: the SDK transport retries non-deterministic failures
    // before giving up, so every attempt must see the 500.
    fetchSpy.mockResolvedValue(
      new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" })
    );

    await expect(client.query("{ syncStatus }")).rejects.toThrow();
  });

  it("should return errors from GraphQL response", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ errors: [{ message: "Field not found" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await client.query("{ badField }");
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0].message).toBe("Field not found");
  });

  it("should check connection (success)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { syncStatus: "SYNCED" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    expect(await client.isConnected()).toBe(true);
  });

  it("should check connection (failure)", async () => {
    // Persistent reject: isConnected → getSyncStatus retries before failing.
    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await client.isConnected()).toBe(false);
  });
});
