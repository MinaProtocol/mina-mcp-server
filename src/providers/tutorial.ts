import { ArchiveClient } from "@o1-labs/mina-archive-sdk";
import { GraphQLClient } from "../graphql/client.js";
import { QUERIES } from "../graphql/queries.js";
import {
  AccountResponse,
  BestChainResponse,
  BlockResponse,
  GenesisConstantsResponse,
  validateData,
} from "../graphql/schemas.js";
import { AccountsManager } from "../graphql/accounts-manager.js";
import { SessionTracker } from "../session/tracker.js";
import { ResetController } from "../reset/controller.js";
import { SnapshotProvider } from "./snapshot.js";
import { ArchiveDB } from "../db/archive.js";

export class TutorialProvider extends SnapshotProvider {
  public graphql: GraphQLClient;
  public archiveApi: ArchiveClient | null;
  public accountsManager: AccountsManager | null;
  public tracker: SessionTracker | null;
  public resetController: ResetController | null;
  public override readonly mode: string = "tutorial";

  constructor(
    db: ArchiveDB,
    graphql: GraphQLClient,
    archiveApi?: ArchiveClient,
    accountsManager?: AccountsManager,
    tracker?: SessionTracker,
    resetController?: ResetController
  ) {
    super(db);
    this.graphql = graphql;
    this.archiveApi = archiveApi ?? null;
    this.accountsManager = accountsManager ?? null;
    this.tracker = tracker ?? null;
    this.resetController = resetController ?? null;
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

  // "1" is the canonical MINA token id; the daemon resolver rejects undefined here.
  static readonly MINA_TOKEN_ID = "1";

  async getAccountLive(publicKey: string, token?: string) {
    const result = await this.graphql.query(QUERIES.account, {
      publicKey,
      token: token ?? TutorialProvider.MINA_TOKEN_ID,
    });
    if (result.errors) throw new Error(result.errors[0].message);
    return validateData(AccountResponse, result.data, "account").account ?? null;
  }

  async getBestChain(maxLength = 10) {
    const result = await this.graphql.query(QUERIES.bestChain, { maxLength });
    if (result.errors) throw new Error(result.errors[0].message);
    return validateData(BestChainResponse, result.data, "bestChain").bestChain ?? [];
  }

  async getBlockLive(stateHash?: string, height?: number) {
    // The daemon's block resolver enforces "exactly one of state hash, height".
    // When only height is supplied, resolve it to a state_hash via the archive
    // DB (issue #4) and then call the daemon with stateHash only — passing
    // both at once trips the daemon's exactly-one check.
    let resolvedStateHash = stateHash;
    if (!resolvedStateHash && typeof height === "number") {
      const row = await this.db.query<{ state_hash: string }>(
        `SELECT state_hash FROM blocks
         WHERE height = $1
         ORDER BY (chain_status = 'canonical') DESC, id DESC
         LIMIT 1`,
        [height]
      );
      if (row.rows.length === 0) {
        throw new Error(`No block found at height ${height} in archive DB`);
      }
      resolvedStateHash = row.rows[0].state_hash;
    }
    if (!resolvedStateHash) {
      throw new Error("Provide either stateHash or height");
    }
    const result = await this.graphql.query(QUERIES.block, {
      stateHash: resolvedStateHash,
      height: null,
    });
    if (result.errors) throw new Error(result.errors[0].message);
    return validateData(BlockResponse, result.data, "block").block ?? null;
  }

  async sendPayment(input: {
    from: string;
    to: string;
    amount: string;
    fee: string;
    memo?: string;
  }) {
    // signature: null tells the daemon to sign with its own wallet keys.
    // The mutation declares $signature so an *explicit* null is required —
    // omitting the variable triggers "Missing variable `signature`".
    const result = await this.graphql.query(QUERIES.sendPayment, {
      input: {
        from: input.from,
        to: input.to,
        amount: input.amount,
        fee: input.fee,
        memo: input.memo ?? "",
      },
      signature: null,
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
      signature: null,
    });
    if (result.errors) throw new Error(result.errors[0].message);
    return (result.data as Record<string, unknown>)?.sendDelegation ?? null;
  }

  async getMempool(publicKey?: string) {
    const result = await this.graphql.query(QUERIES.pooledUserCommands, { publicKey: publicKey ?? null });
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
    return validateData(GenesisConstantsResponse, result.data, "genesisConstants").genesisConstants;
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
