import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { promises as fs, chmodSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import MinaSigner from "mina-signer";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LiveWriteProvider } from "../../src/providers/live-write.js";
import { GraphQLClient } from "../../src/graphql/client.js";
import { ArchiveClient } from "@o1-labs/mina-archive-sdk";
import { RosettaClient } from "@o1-labs/mina-rosetta-sdk";
import { resolveNetwork } from "../../src/networks.js";
import { loadWallets } from "../../src/wallets/loader.js";
import { registerAccountTools } from "../../src/tools/accounts.js";
import { registerBlockTools } from "../../src/tools/blocks.js";
import { registerTransactionTools } from "../../src/tools/transactions.js";
import { registerNetworkTools } from "../../src/tools/network.js";
import { registerSchemaTools } from "../../src/tools/schema.js";
import { registerZkAppTools } from "../../src/tools/zkapps.js";
import { registerTestAccountTools } from "../../src/tools/test-accounts.js";
import { registerAdminTools } from "../../src/tools/admin.js";
import { registerStateTools } from "../../src/tools/state.js";
import { registerExampleTools } from "../../src/tools/examples.js";
import { registerRosettaTools } from "../../src/tools/rosetta.js";
import { registerWalletTools } from "../../src/tools/wallets.js";
import { createMockGraphQL, createMockArchiveApi, createMockRosetta } from "./helpers.js";

const signer = new MinaSigner({ network: "testnet" });

interface Ctx {
  client: Client;
  server: McpServer;
  provider: LiveWriteProvider;
  mockGraphQL: GraphQLClient;
  walletA: { alias: string; publicKey: string; privateKey: string };
  walletB: { alias: string; publicKey: string; privateKey: string };
  tmpDir: string;
  cleanup: () => Promise<void>;
}

async function setupLiveWriteCtx(): Promise<Ctx> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mina-mcp-live-write-"));

  // Two fresh keypairs — never reused across tests.
  const kA = signer.genKeys();
  const kB = signer.genKeys();

  const keyA = path.join(tmpDir, "warm.key");
  const keyB = path.join(tmpDir, "demo.key");
  await fs.writeFile(keyA, kA.privateKey, { mode: 0o600 });
  await fs.writeFile(keyB, kB.privateKey, { mode: 0o600 });
  chmodSync(keyA, 0o600);
  chmodSync(keyB, 0o600);

  const cfgPath = path.join(tmpDir, "wallets.json");
  await fs.writeFile(
    cfgPath,
    JSON.stringify({
      wallets: {
        warm: { keyPath: keyA, publicKey: kA.publicKey },
        demo: { keyPath: keyB, publicKey: kB.publicKey },
      },
      defaultWallet: "warm",
    })
  );

  const registry = await loadWallets(cfgPath, { signer });
  const provider = new LiveWriteProvider(resolveNetwork("devnet"), registry, signer);
  // Swap upstream clients for mocks so we never touch the real network.
  const mockGraphQL = createMockGraphQL();
  (provider as unknown as { graphql: GraphQLClient }).graphql = mockGraphQL;
  (provider as unknown as { archiveApi: ArchiveClient }).archiveApi = createMockArchiveApi();
  (provider as unknown as { rosetta: RosettaClient }).rosetta = createMockRosetta();

  const server = new McpServer({ name: "mina-live-write-test", version: "0.1.0" });
  const getProvider = () => provider;
  registerAccountTools(server, getProvider, "live");
  registerBlockTools(server, getProvider, "live");
  registerTransactionTools(server, getProvider, "live");
  registerNetworkTools(server, getProvider, "live");
  registerSchemaTools(server, getProvider, "live");
  registerZkAppTools(server, getProvider, "live");
  registerTestAccountTools(server, getProvider, "live");
  registerAdminTools(server, getProvider, "live");
  registerStateTools(server, getProvider, "live");
  registerExampleTools(server, getProvider, "live");
  registerRosettaTools(server, getProvider, "live");
  registerWalletTools(server, getProvider, "live");

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "live-write-test-client", version: "0.1.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    server,
    provider,
    mockGraphQL,
    walletA: { alias: "warm", ...kA },
    walletB: { alias: "demo", ...kB },
    tmpDir,
    cleanup: async () => {
      await client.close();
      await server.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

describe("MCP Server - Live Write Mode", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await setupLiveWriteCtx();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  describe("tool listing", () => {
    it("registers list_wallets + send_payment + send_delegation when wallets are loaded", async () => {
      const result = await ctx.client.listTools();
      const names = result.tools.map((t) => t.name);
      expect(names).toContain("list_wallets");
      expect(names).toContain("send_payment");
      expect(names).toContain("send_delegation");
    });
  });

  describe("list_wallets", () => {
    it("returns all loaded wallets with balance + nonce; never private keys", async () => {
      // Fake an account response per wallet — the provider hits get_account
      // for each wallet in parallel via the GraphQL mock.
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ data: { account: { balance: { total: "1000000000000" }, nonce: "5" } } })
        .mockResolvedValueOnce({ data: { account: { balance: { total: "2000000000000" }, nonce: "9" } } });

      const result = await ctx.client.callTool({ name: "list_wallets", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const list = JSON.parse(text) as Array<{ alias: string; publicKey: string; balance: string; nonce: number }>;

      expect(list.map((w) => w.alias).sort()).toEqual(["demo", "warm"]);
      // Belt-and-braces: no privateKey field anywhere.
      expect(text).not.toContain("privateKey");
      expect(text).not.toMatch(/EK[A-Za-z0-9]{20,}/);
    });
  });

  describe("send_payment (live-write)", () => {
    it("with dry_run=true returns a signed payload and DOES NOT submit the mutation", async () => {
      // dry_run still hits the daemon once to learn the current nonce —
      // otherwise the returned signed payload wouldn't be a real one you
      // could submit later. What it must NOT do is call sendPayment.
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { account: { nonce: "3" } },
      });

      const result = await ctx.client.callTool({
        name: "send_payment",
        arguments: { from_alias: "warm", to: ctx.walletB.publicKey, amount: "1000000000", fee: "100000000", dry_run: true },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text) as {
        dryRun: boolean;
        signedPayload: {
          data: { from: string; to: string; nonce: string };
          signature: { field: string; scalar: string };
        };
      };
      expect(parsed.dryRun).toBe(true);
      expect(parsed.signedPayload.data.from).toBe(ctx.walletA.publicKey);
      expect(parsed.signedPayload.data.to).toBe(ctx.walletB.publicKey);
      expect(parsed.signedPayload.data.nonce).toBe("3");
      expect(typeof parsed.signedPayload.signature.field).toBe("string");
      expect(typeof parsed.signedPayload.signature.scalar).toBe("string");

      // Exactly one call: the nonce lookup. No sendPayment mutation.
      expect(ctx.mockGraphQL.query).toHaveBeenCalledTimes(1);
      const calls = (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][0]).not.toContain("sendPayment");

      // The server's loaded private key must not appear in the payload.
      expect(text).not.toContain(ctx.walletA.privateKey);
    });

    it("without dry_run signs locally and submits via daemon sendPayment with $signature", async () => {
      // Mock: GraphQL.query is called twice — first for nonce lookup
      // (account), second for the sendPayment mutation itself.
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ data: { account: { balance: { total: "1000000000000" }, nonce: "7" } } })
        .mockResolvedValueOnce({ data: { sendPayment: { payment: { hash: "5JtTEST", id: "id1" } } } });

      const result = await ctx.client.callTool({
        name: "send_payment",
        arguments: { from_alias: "warm", to: ctx.walletB.publicKey, amount: "1000000000", fee: "100000000" },
      });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const parsed = JSON.parse(text);
      expect(parsed.payment.hash).toBe("5JtTEST");

      // The sendPayment call must include both `input.nonce` (7) and a
      // non-null `signature` — that's how the daemon knows to skip its
      // own signing path.
      const [, vars] = (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(vars.input.nonce).toBe("7");
      expect(vars.input.from).toBe(ctx.walletA.publicKey);
      expect(vars.signature.field).toBeDefined();
      expect(vars.signature.scalar).toBeDefined();
    });

    it("resolves wallet by `from` publicKey when no alias is given", async () => {
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ data: { account: { nonce: "0" } } })
        .mockResolvedValueOnce({ data: { sendPayment: { payment: { hash: "h" } } } });

      await ctx.client.callTool({
        name: "send_payment",
        arguments: { from: ctx.walletB.publicKey, to: ctx.walletA.publicKey, amount: "100", fee: "1" },
      });
      const [, vars] = (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mock.calls[1];
      // Sender should be walletB, not the default warm.
      expect(vars.input.from).toBe(ctx.walletB.publicKey);
    });

    it("returns a descriptive error when neither alias nor `from` resolves and no default applies", async () => {
      // Build a wallet config with no defaultWallet so the "neither/nor"
      // branch fires.
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mina-mcp-nodef-"));
      try {
        const k = signer.genKeys();
        const kp = path.join(tmp, "k.key");
        await fs.writeFile(kp, k.privateKey, { mode: 0o600 });
        chmodSync(kp, 0o600);
        const cfg = path.join(tmp, "wallets.json");
        await fs.writeFile(cfg, JSON.stringify({ wallets: { only: { keyPath: kp, publicKey: k.publicKey } } }));
        const reg = await loadWallets(cfg, { signer });
        const prov = new LiveWriteProvider(resolveNetwork("devnet"), reg, signer);
        const out = prov.resolveWallet({});
        expect(out.error).toMatch(/no defaultWallet configured/);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    it("does not bump the nonce cache when submission fails", async () => {
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ data: { account: { nonce: "10" } } })
        .mockResolvedValueOnce({ errors: [{ message: "Insufficient balance" }] });

      await ctx.client.callTool({
        name: "send_payment",
        arguments: { from_alias: "warm", to: ctx.walletB.publicKey, amount: "999999999999999", fee: "1" },
      });

      // Cache should not have been touched. Next nonce call against the
      // same wallet should still resolve to max(daemon=10, cache=-1+1=0) = 10.
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { account: { nonce: "10" } },
      });
      const next = await ctx.provider.resolveNonce({ ...ctx.walletA });
      expect(next).toBe(10);
    });
  });

  describe("nonce cache", () => {
    it("uses max(daemon, cache+1) — bumps to cache+1 when daemon lags", async () => {
      // Seed the cache with a successful submission at nonce 5.
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ data: { account: { nonce: "5" } } })
        .mockResolvedValueOnce({ data: { sendPayment: { payment: { hash: "h1" } } } });
      await ctx.provider.sendSignedPayment({
        wallet: ctx.walletA,
        payment: { to: ctx.walletB.publicKey, amount: "1", fee: "1" },
        dryRun: false,
      });

      // Daemon still reports the old nonce (archive lag) — we should
      // pick max(daemon=5, cache+1=6) = 6.
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { account: { nonce: "5" } },
      });
      const next = await ctx.provider.resolveNonce(ctx.walletA);
      expect(next).toBe(6);
    });

    it("prefers the daemon's nonce when it's ahead of the cache", async () => {
      // No prior submission ⇒ cache empty. Daemon reports 12. Pick 12.
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { account: { nonce: "12" } },
      });
      const next = await ctx.provider.resolveNonce(ctx.walletA);
      expect(next).toBe(12);
    });
  });

  describe("describe_state", () => {
    it("includes wallets[] with publicKeys + balances (never private keys) and surfaces WRITE_MODE hints", async () => {
      // describe_state issues:
      //   1. daemon getDaemonStatus
      //   2. daemon getMempool
      //   3. listWallets → one daemon account() call per wallet
      (ctx.mockGraphQL.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ data: { daemonStatus: { syncStatus: "SYNCED", blockchainLength: 100, stateHash: "3NX" } } })
        .mockResolvedValueOnce({ data: { pooledUserCommands: [] } })
        .mockResolvedValueOnce({ data: { account: { balance: { total: "1000000000000" }, nonce: "1" } } })
        .mockResolvedValueOnce({ data: { account: { balance: { total: "2000000000000" }, nonce: "2" } } });

      const result = await ctx.client.callTool({ name: "describe_state", arguments: {} });
      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      const snap = JSON.parse(text);

      expect(snap.mode).toBe("live");
      expect(Array.isArray(snap.wallets)).toBe(true);
      expect(snap.wallets.length).toBe(2);
      const aliases = snap.wallets.map((w: { alias: string }) => w.alias).sort();
      expect(aliases).toEqual(["demo", "warm"]);
      // Default flag is set on warm.
      const warm = snap.wallets.find((w: { alias: string }) => w.alias === "warm");
      expect(warm.isDefault).toBe(true);
      expect(warm.publicKey).toBe(ctx.walletA.publicKey);
      // Write-mode hints are present and prominent.
      expect(snap.hints.some((h: string) => h.includes("Live-WRITE"))).toBe(true);
      // Redaction.
      expect(text).not.toContain("privateKey");
      expect(text).not.toMatch(/EK[A-Za-z0-9]{20,}/);
    });
  });
});
