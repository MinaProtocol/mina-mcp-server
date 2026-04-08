export interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; path?: string[] }>;
}

export class GraphQLClient {
  private endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint =
      endpoint ?? process.env.MINA_GRAPHQL_ENDPOINT ?? "http://localhost:3085/graphql";
  }

  async query<T = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<GraphQLResponse<T>> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as GraphQLResponse<T>;
  }

  async isConnected(): Promise<boolean> {
    try {
      const result = await this.query("{ syncStatus }");
      return !result.errors;
    } catch {
      return false;
    }
  }

  getEndpoint(): string {
    return this.endpoint;
  }
}
