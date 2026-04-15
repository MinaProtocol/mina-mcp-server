import { GraphQLClient } from "../graphql/client.js";
import { QUERIES } from "../graphql/queries.js";
import { ArchiveNodeAPI } from "../graphql/archive-api.js";
import { AccountsManager } from "../graphql/accounts-manager.js";
import { SnapshotProvider } from "./snapshot.js";
import { ArchiveDB } from "../db/archive.js";

export class TutorialProvider extends SnapshotProvider {
  public graphql: GraphQLClient;
  public archiveApi: ArchiveNodeAPI | null;
  public accountsManager: AccountsManager | null;
  public override readonly mode: string = "tutorial";

  constructor(
    db: ArchiveDB,
    graphql: GraphQLClient,
    archiveApi?: ArchiveNodeAPI,
    accountsManager?: AccountsManager
  ) {
    super(db);
    this.graphql = graphql;
    this.archiveApi = archiveApi ?? null;
    this.accountsManager = accountsManager ?? null;
  }

  async getSyncStatus(): Promise<string> {
    const result = await this.graphql.query<{ syncStatus: string }>(QUERIES.syncStatus);
    return result.data?.syncStatus ?? "UNKNOWN";
  }

  async getDaemonStatus() {
    const result = await this.graphql.query(QUERIES.daemonStatus);
    if (result.errors) throw new Error(result.errors[0].message);
    return result.data;
  }

  async getAccountLive(publicKey: string, token?: string) {
    const result = await this.graphql.query(QUERIES.account, { publicKey, token });
    if (result.errors) throw new Error(result.errors[0].message);
    return (result.data as Record<string, unknown>)?.account ?? null;
  }

  async getBestChain(maxLength = 10) {
    const result = await this.graphql.query(QUERIES.bestChain, { maxLength });
    if (result.errors) throw new Error(result.errors[0].message);
    return (result.data as Record<string, unknown>)?.bestChain ?? [];
  }

  async getBlockLive(stateHash?: string, height?: number) {
    const result = await this.graphql.query(QUERIES.block, { stateHash, height });
    if (result.errors) throw new Error(result.errors[0].message);
    return (result.data as Record<string, unknown>)?.block ?? null;
  }

  async sendPayment(input: {
    from: string;
    to: string;
    amount: string;
    fee: string;
    memo?: string;
  }) {
    const result = await this.graphql.query(QUERIES.sendPayment, {
      input: {
        from: input.from,
        to: input.to,
        amount: input.amount,
        fee: input.fee,
        memo: input.memo ?? "",
      },
    });
    if (result.errors) throw new Error(result.errors[0].message);
    return (result.data as Record<string, unknown>)?.sendPayment ?? null;
  }

  async sendDelegation(input: { from: string; to: string; fee: string; memo?: string }) {
    const result = await this.graphql.query(QUERIES.sendDelegation, {
      input: {
        from: input.from,
        to: input.to,
        fee: input.fee,
        memo: input.memo ?? "",
      },
    });
    if (result.errors) throw new Error(result.errors[0].message);
    return (result.data as Record<string, unknown>)?.sendDelegation ?? null;
  }

  async getMempool(publicKey?: string) {
    const result = await this.graphql.query(QUERIES.pooledUserCommands, { publicKey });
    if (result.errors) throw new Error(result.errors[0].message);
    return (result.data as Record<string, unknown>)?.pooledUserCommands ?? [];
  }

  async getTransactionStatus(payment?: string, zkappTransaction?: string) {
    // Build query with only the provided variable to avoid "Missing variable" errors
    let query: string;
    let variables: Record<string, string>;
    if (payment) {
      query = `query TransactionStatus($payment: ID!) { transactionStatus(payment: $payment) }`;
      variables = { payment };
    } else if (zkappTransaction) {
      query = `query TransactionStatus($zkappTransaction: ID!) { transactionStatus(zkappTransaction: $zkappTransaction) }`;
      variables = { zkappTransaction };
    } else {
      throw new Error("Provide either payment or zkappTransaction ID");
    }
    const result = await this.graphql.query(query, variables);
    if (result.errors) throw new Error(result.errors[0].message);
    return (result.data as Record<string, unknown>)?.transactionStatus ?? null;
  }

  async getGenesisConstants() {
    const result = await this.graphql.query(QUERIES.genesisConstants);
    if (result.errors) throw new Error(result.errors[0].message);
    return (result.data as Record<string, unknown>)?.genesisConstants ?? null;
  }

  async getNetworkID(): Promise<string> {
    const result = await this.graphql.query<{ networkID: string }>(QUERIES.networkID);
    if (result.errors) throw new Error(result.errors[0].message);
    return result.data?.networkID ?? "UNKNOWN";
  }

  async getTrackedAccounts() {
    const result = await this.graphql.query<{
      trackedAccounts: Array<{ publicKey: string; balance: { total: string } }>;
    }>("{ trackedAccounts { publicKey balance { total } } }");
    if (result.errors) throw new Error(result.errors[0].message);
    return result.data?.trackedAccounts ?? [];
  }
}
