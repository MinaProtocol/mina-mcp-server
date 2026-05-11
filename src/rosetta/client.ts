// Typed wrapper around a public Mina-Rosetta endpoint.
// Implements the Data API subset we need (read-only). Construction API will
// land in a follow-up — keep that out of this file when it does.
//
// All requests carry the same `network_identifier`. The endpoint *also*
// rejects requests whose `network_identifier` doesn't appear in its
// `/network/list` response — that's why NetworkConfig carries an explicit
// `rosettaNetwork` field (mesa's Rosetta calls itself "testnet", not "mesa").

export interface NetworkIdentifier {
  blockchain: string;
  network: string;
}

export interface PartialBlockIdentifier {
  index?: number;
  hash?: string;
}

export interface RosettaError {
  code: number;
  message: string;
  description?: string;
  retriable?: boolean;
  details?: Record<string, unknown>;
}

export class RosettaClient {
  constructor(
    private readonly endpoint: string,
    private readonly networkIdentifier: NetworkIdentifier,
    // Injected for tests; defaults to global fetch in production.
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  getEndpoint(): string {
    return this.endpoint;
  }

  getNetworkIdentifier(): NetworkIdentifier {
    return this.networkIdentifier;
  }

  async isConnected(): Promise<boolean> {
    try {
      const r = await this.post<{ network_identifiers?: NetworkIdentifier[] }>("/network/list", {
        metadata: {},
      });
      return Array.isArray(r.network_identifiers);
    } catch {
      return false;
    }
  }

  async networkList(): Promise<{ network_identifiers: NetworkIdentifier[] }> {
    return this.post("/network/list", { metadata: {} });
  }

  async networkStatus(): Promise<Record<string, unknown>> {
    return this.post("/network/status", { network_identifier: this.networkIdentifier });
  }

  async accountBalance(
    address: string,
    blockIdentifier?: PartialBlockIdentifier
  ): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
      network_identifier: this.networkIdentifier,
      account_identifier: { address },
    };
    if (blockIdentifier && (blockIdentifier.index !== undefined || blockIdentifier.hash)) {
      body.block_identifier = blockIdentifier;
    }
    return this.post("/account/balance", body);
  }

  async block(blockIdentifier: PartialBlockIdentifier): Promise<Record<string, unknown>> {
    if (blockIdentifier.index === undefined && !blockIdentifier.hash) {
      throw new Error("rosetta block: must provide either index or hash");
    }
    return this.post("/block", {
      network_identifier: this.networkIdentifier,
      block_identifier: blockIdentifier,
    });
  }

  async mempool(): Promise<{ transaction_identifiers: Array<{ hash: string }> }> {
    return this.post("/mempool", { network_identifier: this.networkIdentifier });
  }

  async mempoolTransaction(transactionHash: string): Promise<Record<string, unknown>> {
    return this.post("/mempool/transaction", {
      network_identifier: this.networkIdentifier,
      transaction_identifier: { hash: transactionHash },
    });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.endpoint}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      // Non-JSON body — fall through to HTTP-status error below.
    }
    if (!res.ok) {
      // Rosetta uses HTTP 500 for protocol-level errors with a structured
      // body: { code, message, description?, retriable?, details? }.
      const err = parsed as Partial<RosettaError> | undefined;
      if (err && typeof err.code === "number" && typeof err.message === "string") {
        const detail = err.details ? ` (${JSON.stringify(err.details)})` : "";
        throw new Error(`Rosetta ${path} [${err.code}]: ${err.message}${detail}`);
      }
      throw new Error(`Rosetta ${path}: HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return parsed as T;
  }
}
