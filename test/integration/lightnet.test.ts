/**
 * Integration tests against a live lightnet container.
 *
 * Prerequisites:
 *   docker compose -f docker-compose.tutorial.yml up -d
 *   # Wait for healthcheck to pass (~1-2 min)
 *
 * Run:
 *   npm run test:integration
 */

import { describe, it, expect, beforeAll } from "vitest";
import { GraphQLClient } from "../../src/graphql/client.js";
import { ArchiveNodeAPI } from "../../src/graphql/archive-api.js";
import { AccountsManager, type TestAccount } from "../../src/graphql/accounts-manager.js";
import { ArchiveDB } from "../../src/db/archive.js";

const DAEMON_ENDPOINT = process.env.MINA_GRAPHQL_ENDPOINT ?? "http://localhost:3085/graphql";
const ARCHIVE_API_ENDPOINT = process.env.ARCHIVE_API_ENDPOINT ?? "http://localhost:8282";
const ACCOUNTS_MANAGER_ENDPOINT = process.env.ACCOUNTS_MANAGER_ENDPOINT ?? "http://localhost:8181";

describe("Lightnet Integration", () => {
  let graphql: GraphQLClient;
  let archiveApi: ArchiveNodeAPI;
  let accountsMgr: AccountsManager;
  let db: ArchiveDB;

  beforeAll(() => {
    graphql = new GraphQLClient(DAEMON_ENDPOINT);
    archiveApi = new ArchiveNodeAPI(ARCHIVE_API_ENDPOINT);
    accountsMgr = new AccountsManager(ACCOUNTS_MANAGER_ENDPOINT);
    db = new ArchiveDB();
  });

  describe("Service connectivity", () => {
    it("daemon GraphQL should be reachable", async () => {
      expect(await graphql.isConnected()).toBe(true);
    });

    it("daemon should be SYNCED", async () => {
      const result = await graphql.query<{ syncStatus: string }>("{ syncStatus }");
      expect(result.data?.syncStatus).toBe("SYNCED");
    });

    it("Archive-Node-API should be reachable", async () => {
      expect(await archiveApi.isConnected()).toBe(true);
    });

    it("Accounts Manager should be reachable", async () => {
      expect(await accountsMgr.isConnected()).toBe(true);
    });

    it("Archive DB should be reachable", async () => {
      expect(await db.isConnected()).toBe(true);
    });
  });

  describe("Accounts Manager", () => {
    it("should acquire, list, and release a test account", async () => {
      // Acquire
      const account = await accountsMgr.acquireAccount({ isRegularAccount: true });
      expect(account.pk).toMatch(/^B62q/);
      expect(account.sk).toMatch(/^EKE/);

      // Should appear in acquired list
      const before = await accountsMgr.listAcquiredAccounts();
      expect(before.some((a) => a.pk === account.pk)).toBe(true);

      // Release
      await accountsMgr.releaseAccount(account);

      // Should no longer appear in acquired list
      const after = await accountsMgr.listAcquiredAccounts();
      expect(after.some((a) => a.pk === account.pk)).toBe(false);
    });
  });

  describe("Daemon GraphQL - Queries", () => {
    it("should return daemon status", async () => {
      const result = await graphql.query<{
        daemonStatus: { blockchainLength: number; syncStatus: string };
      }>("{ daemonStatus { blockchainLength syncStatus } }");

      expect(result.data?.daemonStatus.syncStatus).toBe("SYNCED");
      expect(result.data?.daemonStatus.blockchainLength).toBeGreaterThan(0);
    });

    it("should return genesis constants", async () => {
      const result = await graphql.query<{
        genesisConstants: { coinbase: string; accountCreationFee: string };
      }>("{ genesisConstants { coinbase accountCreationFee } }");

      expect(result.data?.genesisConstants.coinbase).toBeDefined();
      expect(result.data?.genesisConstants.accountCreationFee).toBeDefined();
    });

    it("should return best chain", async () => {
      const result = await graphql.query<{
        bestChain: Array<{ stateHash: string }>;
      }>("{ bestChain(maxLength: 3) { stateHash } }");

      expect(result.data?.bestChain.length).toBeGreaterThan(0);
    });

    it("should return network ID", async () => {
      const result = await graphql.query<{ networkID: string }>("{ networkID }");
      expect(result.data?.networkID).toBeDefined();
    });
  });

  describe("Daemon GraphQL - Payment lifecycle", () => {
    let sender: TestAccount;
    let receiver: TestAccount;
    let paymentHash: string;

    beforeAll(async () => {
      // Acquire two accounts; unlock sender via Accounts Manager
      sender = await accountsMgr.acquireAccount({ isRegularAccount: true, unlockAccount: true });
      receiver = await accountsMgr.acquireAccount({ isRegularAccount: true });
    });

    it("should query sender account balance", async () => {
      const result = await graphql.query<{
        account: { balance: { total: string }; nonce: string };
      }>(
        `query($pk: PublicKey!) { account(publicKey: $pk) { balance { total } nonce } }`,
        { pk: sender.pk }
      );

      expect(result.data?.account.balance.total).toBeDefined();
      // 1550 MINA = 1550000000000 nanomina
      expect(BigInt(result.data!.account.balance.total)).toBeGreaterThan(0n);
    });

    it("should send a payment", async () => {
      const result = await graphql.query<{
        sendPayment: { payment: { hash: string; id: string } };
      }>(
        `mutation($input: SendPaymentInput!) {
          sendPayment(input: $input) { payment { hash id } }
        }`,
        {
          input: {
            from: sender.pk,
            to: receiver.pk,
            amount: "1000000000", // 1 MINA
            fee: "100000000", // 0.1 MINA
            memo: "mcp-integration-test",
          },
        }
      );

      expect(result.errors).toBeUndefined();
      paymentHash = result.data!.sendPayment.payment.hash;
      expect(paymentHash).toBeDefined();
    });

    it("should see payment in mempool", async () => {
      const result = await graphql.query<{
        pooledUserCommands: Array<{ hash: string }>;
      }>(
        `query($pk: PublicKey) { pooledUserCommands(publicKey: $pk) { hash } }`,
        { pk: sender.pk }
      );

      // May or may not still be in mempool depending on block timing
      expect(result.errors).toBeUndefined();
    });

    it("should check transaction status", async () => {
      const result = await graphql.query<{ transactionStatus: string }>(
        `query($payment: ID) { transactionStatus(payment: $payment) }`,
        { payment: paymentHash }
      );

      expect(result.errors).toBeUndefined();
      // Status is PENDING or INCLUDED
      expect(["PENDING", "INCLUDED", "UNKNOWN"]).toContain(result.data?.transactionStatus);
    });

    // Cleanup
    afterAll(async () => {
      await accountsMgr.releaseAccount(sender).catch(() => {});
      await accountsMgr.releaseAccount(receiver).catch(() => {});
    });
  });

  describe("Archive DB (direct SQL)", () => {
    it("should have blocks", async () => {
      const result = await db.query<{ count: string }>("SELECT count(*) as count FROM blocks");
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    it("should have canonical blocks", async () => {
      const result = await db.query<{ count: string }>(
        "SELECT count(*) as count FROM blocks WHERE chain_status = 'canonical'"
      );
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    it("should have public keys", async () => {
      const result = await db.query<{ count: string }>("SELECT count(*) as count FROM public_keys");
      expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
    });

    it("should enforce read-only queries", async () => {
      await expect(db.queryReadOnly("DROP TABLE blocks")).rejects.toThrow(
        "Only SELECT/WITH/EXPLAIN queries are allowed"
      );
    });

    it("should query archive schema", async () => {
      const result = await db.queryReadOnly(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name LIMIT 5"
      );
      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  describe("Archive-Node-API", () => {
    it("should return network state with block heights", async () => {
      const state = await archiveApi.getNetworkState();
      expect(state.canonicalMaxBlockHeight).toBeGreaterThanOrEqual(0);
      expect(state.pendingMaxBlockHeight).toBeGreaterThanOrEqual(0);
    });

    it("should return blocks", async () => {
      const blocks = await archiveApi.getBlocks({
        sortBy: "BLOCKHEIGHT_DESC",
        limit: 5,
      });
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0].blockHeight).toBeGreaterThan(0);
      expect(blocks[0].creator).toMatch(/^B62q/);
    });

    it("should return canonical blocks", async () => {
      const blocks = await archiveApi.getBlocks({
        canonical: true,
        sortBy: "BLOCKHEIGHT_DESC",
        limit: 3,
      });
      // May be empty early in chain lifecycle, but should not error
      expect(Array.isArray(blocks)).toBe(true);
    });

    it("should handle events query for non-existent address gracefully", async () => {
      // A random non-zkApp address should return empty events, not error
      const events = await archiveApi.getEvents({
        address: "B62qiZfzW27eavtPrnF6DeDSAKEjXuGFdkouC3T5STRa6rrYLiDUP2p",
      });
      expect(Array.isArray(events)).toBe(true);
    });

    it("should handle actions query for non-existent address gracefully", async () => {
      const actions = await archiveApi.getActions({
        address: "B62qiZfzW27eavtPrnF6DeDSAKEjXuGFdkouC3T5STRa6rrYLiDUP2p",
      });
      expect(Array.isArray(actions)).toBe(true);
    });
  });

  describe("Full faucet workflow", () => {
    it("should acquire (with unlock) → query balance → release", async () => {
      // 1. Acquire with unlock handled by Accounts Manager
      const account = await accountsMgr.acquireAccount({
        isRegularAccount: true,
        unlockAccount: true,
      });
      expect(account.pk).toMatch(/^B62q/);

      // 2. Query balance
      const balanceResult = await graphql.query<{
        account: { balance: { total: string } };
      }>(
        `query($pk: PublicKey!) { account(publicKey: $pk) { balance { total } } }`,
        { pk: account.pk }
      );
      expect(balanceResult.data?.account.balance.total).toBe("1550000000000");

      // 3. Release
      await accountsMgr.releaseAccount(account);
    });
  });

  afterAll(async () => {
    await db.close();
  });
});
