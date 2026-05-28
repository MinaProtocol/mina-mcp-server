import { MinaClient } from "@o1-labs/mina-sdk";

/**
 * Factory for the SDK `MinaClient` configured for MCP use.
 *
 * `logger: null` is mandatory: this server speaks MCP over stdio, so anything
 * the SDK might write to stdout would corrupt the protocol stream.
 *
 * Providers consume `MinaClient` directly via the typed methods
 * (`getAccount`, `getBestChain`, `sendPayment`, …) — the SDK is the single
 * source of truth for query strings, response shapes, and retry/timeout
 * behavior. There is no longer a custom `GraphQLClient` wrapper or a
 * mcp-side `QUERIES.*` map.
 *
 * `executeQuery` is still available on the returned client as an escape
 * hatch for ad-hoc queries (e.g. the snapshot-capture path) that don't fit
 * one of the typed methods.
 */
export function createMinaClient(endpoint?: string): MinaClient {
  const graphqlUri = endpoint ?? process.env.MINA_GRAPHQL_ENDPOINT ?? "http://localhost:3085/graphql";
  return new MinaClient({
    graphqlUri,
    retries: 2,
    retryDelayMs: 500,
    timeoutMs: 15_000,
    logger: null,
  });
}

/** Returns true when the daemon answers `syncStatus`, false otherwise. */
export async function isConnected(client: MinaClient): Promise<boolean> {
  try {
    await client.getSyncStatus();
    return true;
  } catch {
    return false;
  }
}
