import { MinaClient, GraphQLError } from "@o1-labs/mina-sdk";

export interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; path?: string[] }>;
}

/**
 * Thin adapter over the published `@o1-labs/mina-sdk` MinaClient. Keeps the
 * `{ data, errors }` response shape (and the `query`/`isConnected`/`getEndpoint`
 * surface) the providers and tools already depend on, while delegating the
 * actual HTTP transport — retry/backoff, request timeout, typed errors — to the
 * SDK instead of a hand-rolled `fetch`.
 *
 * `logger: null` is mandatory: this server speaks MCP over stdio, so anything
 * the SDK might write to stdout would corrupt the protocol stream.
 */
export class GraphQLClient {
  private readonly client: MinaClient;
  private readonly endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint =
      endpoint ?? process.env.MINA_GRAPHQL_ENDPOINT ?? "http://localhost:3085/graphql";
    this.client = new MinaClient({
      graphqlUri: this.endpoint,
      retries: 2,
      retryDelayMs: 500,
      timeoutMs: 15_000,
      logger: null,
    });
  }

  async query<T = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<GraphQLResponse<T>> {
    try {
      const data = await this.client.executeQuery<T>(query, variables, "mcp_graphql");
      return { data };
    } catch (err) {
      // Deterministic GraphQL errors map back to the { errors } shape callers
      // expect (mirrors a 200 response carrying an `errors` array). Transport
      // failures (timeout, connection, non-2xx) are surfaced by re-throwing —
      // the SDK has already exhausted retries by this point.
      if (err instanceof GraphQLError) {
        return {
          errors: err.errors.map((e) => ({
            message: e.message,
            ...(e.path ? { path: e.path.map(String) } : {}),
          })),
        };
      }
      throw err;
    }
  }

  async isConnected(): Promise<boolean> {
    try {
      await this.client.getSyncStatus();
      return true;
    } catch {
      return false;
    }
  }

  getEndpoint(): string {
    return this.endpoint;
  }
}
