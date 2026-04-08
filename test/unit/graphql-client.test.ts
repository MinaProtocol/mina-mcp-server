import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GraphQLClient } from "../../src/graphql/client.js";

describe("GraphQLClient", () => {
  let client: GraphQLClient;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new GraphQLClient("http://test:3085/graphql");
    fetchSpy = vi.spyOn(globalThis, "fetch");
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
    expect(fetchSpy).toHaveBeenCalledWith("http://test:3085/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ syncStatus }", variables: undefined }),
    });
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

  it("should throw on HTTP errors", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }));

    await expect(client.query("{ syncStatus }")).rejects.toThrow("GraphQL request failed: 500");
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
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await client.isConnected()).toBe(false);
  });
});
