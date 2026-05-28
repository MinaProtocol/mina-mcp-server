import { ArchiveClient } from "@o1-labs/mina-archive-sdk";
import { Currency, MinaClient } from "@o1-labs/mina-sdk";
import { isConnected as clientConnected } from "../graphql/client.js";
import { AccountsManager } from "../graphql/accounts-manager.js";
import { SessionTracker } from "../session/tracker.js";
import { ResetController } from "../reset/controller.js";
import { SnapshotProvider } from "./snapshot.js";
import { ArchiveDB } from "../db/archive.js";

export class TutorialProvider extends SnapshotProvider {
  public client: MinaClient;
  public archiveApi: ArchiveClient | null;
  public accountsManager: AccountsManager | null;
  public tracker: SessionTracker | null;
  public resetController: ResetController | null;
  public override readonly mode: string = "tutorial";

  constructor(
    db: ArchiveDB,
    client: MinaClient,
    archiveApi?: ArchiveClient,
    accountsManager?: AccountsManager,
    tracker?: SessionTracker,
    resetController?: ResetController
  ) {
    super(db);
    this.client = client;
    this.archiveApi = archiveApi ?? null;
    this.accountsManager = accountsManager ?? null;
    this.tracker = tracker ?? null;
    this.resetController = resetController ?? null;
  }

  /** Underlying daemon endpoint — used by tools that surface it in error messages. */
  getDaemonEndpoint(): string {
    return this.client.graphqlUri;
  }

  /** True when the daemon answers a basic `syncStatus` query. */
  async isDaemonConnected(): Promise<boolean> {
    return clientConnected(this.client);
  }

  async getSyncStatus(): Promise<string> {
    try {
      return await this.client.getSyncStatus();
    } catch {
      return "UNKNOWN";
    }
  }

  async getDaemonStatus() {
    return this.client.getDaemonStatus();
  }

  // "1" is the canonical MINA token id; the daemon resolver rejects undefined here.
  static readonly MINA_TOKEN_ID = "1";

  async getAccountLive(publicKey: string, token?: string) {
    try {
      return await this.client.getAccount(publicKey, token ?? TutorialProvider.MINA_TOKEN_ID);
    } catch (err) {
      // SDK throws AccountNotFoundError on missing account; map back to the
      // null-or-empty shape tools already render as "Account not found".
      if (err instanceof Error && err.name === "AccountNotFoundError") return null;
      throw err;
    }
  }

  async getBestChain(maxLength = 10) {
    return this.client.getBestChain(maxLength);
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
    try {
      return await this.client.getBlock({ stateHash: resolvedStateHash });
    } catch (err) {
      // SDK throws a plain Error("block not found ...") when the daemon
      // returns null — surface as the null tools render as "Block not found".
      if (err instanceof Error && err.message.startsWith("block not found")) return null;
      throw err;
    }
  }

  async sendPayment(input: {
    from: string;
    to: string;
    amount: string;
    fee: string;
    memo?: string;
  }) {
    // signature defaults to null: tells the daemon to sign with its own
    // wallet keys (tutorial/lightnet). The SDK's sendPayment passes the
    // explicit-null `$signature` the daemon requires when the variable is
    // declared.
    return this.client.sendPayment({
      sender: input.from,
      receiver: input.to,
      amount: Currency.fromGraphQL(input.amount),
      fee: Currency.fromGraphQL(input.fee),
      ...(input.memo ? { memo: input.memo } : {}),
    });
  }

  async sendDelegation(input: { from: string; to: string; fee: string; memo?: string }) {
    return this.client.sendDelegation({
      sender: input.from,
      delegateTo: input.to,
      fee: Currency.fromGraphQL(input.fee),
      ...(input.memo ? { memo: input.memo } : {}),
    });
  }

  async getMempool(publicKey?: string) {
    return this.client.getPooledUserCommands(publicKey);
  }

  async getTransactionStatus(payment?: string, zkappTransaction?: string) {
    if (payment) return this.client.getTransactionStatus({ payment });
    if (zkappTransaction) return this.client.getTransactionStatus({ zkappTransaction });
    throw new Error("Provide either payment or zkappTransaction ID");
  }

  async getGenesisConstants() {
    return this.client.getGenesisConstants();
  }

  async getNetworkID(): Promise<string> {
    try {
      return await this.client.getNetworkId();
    } catch {
      return "UNKNOWN";
    }
  }

  async getTrackedAccounts() {
    return this.client.getTrackedAccounts();
  }
}
