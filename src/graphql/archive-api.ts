/**
 * Client for the Archive-Node-API GraphQL service (port 8282).
 * Provides access to zkApp events, actions, blocks, and network state.
 * Schema: https://github.com/o1-labs/Archive-Node-API
 */

import { GraphQLResponse } from "./client.js";

export interface BlockInfo {
  height: number;
  stateHash: string;
  parentHash: string;
  ledgerHash: string;
  chainStatus: string;
  timestamp: string;
  globalSlotSinceHardfork: number;
  globalSlotSinceGenesis: number;
  distanceFromMaxBlockHeight: number;
}

export interface TransactionInfo {
  status: string;
  hash: string;
  memo: string;
  authorizationKind: string;
}

export interface EventOutput {
  blockInfo: BlockInfo;
  eventData: Array<{ data: string[]; accountUpdateId: string; transactionInfo: TransactionInfo }>;
}

export interface ActionOutput {
  blockInfo: BlockInfo;
  actionState: {
    actionStateOne: string;
    actionStateTwo: string;
    actionStateThree: string;
    actionStateFour: string;
    actionStateFive: string;
  };
  actionData: Array<{ data: string[]; transactionInfo: TransactionInfo }>;
}

export interface ArchiveBlock {
  blockHeight: number;
  creator: string;
  stateHash: string;
  dateTime: string;
  transactions: { coinbase: string };
}

export class ArchiveNodeAPI {
  private endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint =
      endpoint ?? process.env.ARCHIVE_API_ENDPOINT ?? "http://localhost:8282";
  }

  private async query<T = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<GraphQLResponse<T>> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`Archive API request failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as GraphQLResponse<T>;
  }

  async getEvents(opts: {
    address: string;
    tokenId?: string;
    status?: "ALL" | "PENDING" | "CANONICAL";
    from?: number;
    to?: number;
  }): Promise<EventOutput[]> {
    const result = await this.query<{ events: EventOutput[] }>(
      `query GetEvents($input: EventFilterOptionsInput!) {
        events(input: $input) {
          blockInfo {
            height stateHash parentHash ledgerHash chainStatus
            timestamp globalSlotSinceHardfork globalSlotSinceGenesis
            distanceFromMaxBlockHeight
          }
          eventData {
            data
            accountUpdateId
            transactionInfo { status hash memo authorizationKind }
          }
        }
      }`,
      { input: opts }
    );
    if (result.errors) throw new Error(result.errors[0].message);
    return result.data?.events ?? [];
  }

  async getActions(opts: {
    address: string;
    tokenId?: string;
    status?: "ALL" | "PENDING" | "CANONICAL";
    from?: number;
    to?: number;
    fromActionState?: string;
    endActionState?: string;
  }): Promise<ActionOutput[]> {
    const result = await this.query<{ actions: ActionOutput[] }>(
      `query GetActions($input: ActionFilterOptionsInput!) {
        actions(input: $input) {
          blockInfo {
            height stateHash parentHash ledgerHash chainStatus
            timestamp globalSlotSinceHardfork globalSlotSinceGenesis
            distanceFromMaxBlockHeight
          }
          actionState {
            actionStateOne actionStateTwo actionStateThree
            actionStateFour actionStateFive
          }
          actionData {
            data
            transactionInfo { status hash memo authorizationKind }
          }
        }
      }`,
      { input: opts }
    );
    if (result.errors) throw new Error(result.errors[0].message);
    return result.data?.actions ?? [];
  }

  async getBlocks(opts?: {
    dateTime_gte?: string;
    dateTime_lt?: string;
    canonical?: boolean;
    sortBy?: "BLOCKHEIGHT_ASC" | "BLOCKHEIGHT_DESC";
    limit?: number;
  }): Promise<ArchiveBlock[]> {
    const { sortBy, limit, ...query } = opts ?? {};
    const result = await this.query<{ blocks: ArchiveBlock[] }>(
      `query GetBlocks($query: BlockQueryInput, $sortBy: BlockSortByInput, $limit: Int) {
        blocks(query: $query, sortBy: $sortBy, limit: $limit) {
          blockHeight
          creator
          stateHash
          dateTime
          transactions { coinbase }
        }
      }`,
      { query, sortBy, limit }
    );
    if (result.errors) throw new Error(result.errors[0].message);
    return result.data?.blocks ?? [];
  }

  async getNetworkState(): Promise<{
    canonicalMaxBlockHeight: number;
    pendingMaxBlockHeight: number;
  }> {
    const result = await this.query<{
      networkState: { maxBlockHeight: { canonicalMaxBlockHeight: number; pendingMaxBlockHeight: number } };
    }>(
      `{ networkState { maxBlockHeight { canonicalMaxBlockHeight pendingMaxBlockHeight } } }`
    );
    if (result.errors) throw new Error(result.errors[0].message);
    return result.data?.networkState?.maxBlockHeight ?? { canonicalMaxBlockHeight: 0, pendingMaxBlockHeight: 0 };
  }

  async isConnected(): Promise<boolean> {
    try {
      await this.getNetworkState();
      return true;
    } catch {
      return false;
    }
  }

  getEndpoint(): string {
    return this.endpoint;
  }
}
