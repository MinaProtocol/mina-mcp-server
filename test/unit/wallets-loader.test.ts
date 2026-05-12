import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { promises as fs, chmodSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import MinaSigner from "mina-signer";
import { loadWallets, WalletLoadError } from "../../src/wallets/loader.js";

// All fixture wallets are freshly generated per test run via mina-signer —
// nothing static or real ever touches disk under the repo. Each test
// owns its temp dir and chmods key files to 0600 so the permission gate
// passes (then individual tests override perms to assert the gate fires).

const signer = new MinaSigner({ network: "testnet" });

interface Keypair {
  publicKey: string;
  privateKey: string;
}

async function writeKey(dir: string, name: string, key: Keypair): Promise<string> {
  const p = path.join(dir, `${name}.key`);
  await fs.writeFile(p, key.privateKey, { mode: 0o600 });
  chmodSync(p, 0o600);
  return p;
}

async function writeJson(dir: string, name: string, obj: unknown): Promise<string> {
  const p = path.join(dir, name);
  await fs.writeFile(p, JSON.stringify(obj, null, 2));
  return p;
}

describe("wallets loader", () => {
  let tmpRoot: string;

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mina-mcp-walloader-"));
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpRoot, "case-"));
  });

  it("loads a single well-formed wallet at 0600", async () => {
    const kp = signer.genKeys();
    const keyPath = await writeKey(dir, "warm", kp);
    const cfgPath = await writeJson(dir, "wallets.json", {
      wallets: { warm: { keyPath, publicKey: kp.publicKey } },
    });

    const reg = await loadWallets(cfgPath, { signer });
    expect(reg.wallets).toHaveLength(1);
    expect(reg.wallets[0].alias).toBe("warm");
    expect(reg.wallets[0].publicKey).toBe(kp.publicKey);
    expect(reg.wallets[0].privateKey).toBe(kp.privateKey);
    expect(reg.defaultAlias).toBeNull();
  });

  it("resolves keyPath relative to the config file's directory", async () => {
    const kp = signer.genKeys();
    await writeKey(dir, "warm", kp);
    const cfgPath = await writeJson(dir, "wallets.json", {
      wallets: { warm: { keyPath: "warm.key", publicKey: kp.publicKey } },
    });
    const reg = await loadWallets(cfgPath, { signer });
    expect(reg.wallets[0].privateKey).toBe(kp.privateKey);
  });

  it("honors defaultWallet when configured", async () => {
    const kpA = signer.genKeys();
    const kpB = signer.genKeys();
    const keyA = await writeKey(dir, "warm", kpA);
    const keyB = await writeKey(dir, "demo", kpB);
    const cfgPath = await writeJson(dir, "wallets.json", {
      wallets: {
        warm: { keyPath: keyA, publicKey: kpA.publicKey },
        demo: { keyPath: keyB, publicKey: kpB.publicKey },
      },
      defaultWallet: "demo",
    });
    const reg = await loadWallets(cfgPath, { signer });
    expect(reg.defaultAlias).toBe("demo");
  });

  it("rejects a defaultWallet that isn't in the wallets map", async () => {
    const kp = signer.genKeys();
    const keyPath = await writeKey(dir, "warm", kp);
    const cfgPath = await writeJson(dir, "wallets.json", {
      wallets: { warm: { keyPath, publicKey: kp.publicKey } },
      defaultWallet: "ghost",
    });
    await expect(loadWallets(cfgPath, { signer })).rejects.toBeInstanceOf(WalletLoadError);
    await expect(loadWallets(cfgPath, { signer })).rejects.toThrow(/defaultWallet 'ghost'/);
  });

  it("rejects a key file with too-permissive mode", async () => {
    const kp = signer.genKeys();
    const keyPath = await writeKey(dir, "warm", kp);
    chmodSync(keyPath, 0o644);
    const cfgPath = await writeJson(dir, "wallets.json", {
      wallets: { warm: { keyPath, publicKey: kp.publicKey } },
    });
    await expect(loadWallets(cfgPath, { signer })).rejects.toThrow(/permissions 644/);
    await expect(loadWallets(cfgPath, { signer })).rejects.toThrow(/chmod 600/);
  });

  it("rejects when configured publicKey doesn't match the key file", async () => {
    const kpA = signer.genKeys();
    const kpB = signer.genKeys(); // different
    const keyPath = await writeKey(dir, "warm", kpA);
    const cfgPath = await writeJson(dir, "wallets.json", {
      wallets: { warm: { keyPath, publicKey: kpB.publicKey } },
    });
    await expect(loadWallets(cfgPath, { signer })).rejects.toThrow(
      /publicKey does not match/
    );
  });

  it("rejects a key file whose contents don't look like a base58check private key", async () => {
    const keyPath = path.join(dir, "warm.key");
    await fs.writeFile(keyPath, "this is not a key", { mode: 0o600 });
    chmodSync(keyPath, 0o600);
    const cfgPath = await writeJson(dir, "wallets.json", {
      wallets: { warm: { keyPath, publicKey: "B62qfake" } },
    });
    await expect(loadWallets(cfgPath, { signer })).rejects.toThrow(/start with 'EK'/);
  });

  it("rejects a missing key file with the alias + path in the message (and never the key)", async () => {
    const cfgPath = await writeJson(dir, "wallets.json", {
      wallets: { warm: { keyPath: path.join(dir, "does-not-exist.key"), publicKey: "B62qfake" } },
    });
    await expect(loadWallets(cfgPath, { signer })).rejects.toThrow(/Wallet 'warm':.*does-not-exist\.key/);
  });

  it("rejects an empty wallets map", async () => {
    const cfgPath = await writeJson(dir, "wallets.json", { wallets: {} });
    await expect(loadWallets(cfgPath, { signer })).rejects.toThrow(/no wallet entries/);
  });

  it("rejects schema mismatches (missing publicKey, wrong types) clearly", async () => {
    const kp = signer.genKeys();
    const keyPath = await writeKey(dir, "warm", kp);
    const cfgPath = await writeJson(dir, "wallets.json", {
      wallets: { warm: { keyPath } }, // publicKey missing
    });
    await expect(loadWallets(cfgPath, { signer })).rejects.toThrow(/missing or invalid publicKey/);
  });

  it("does not leak the private key in any error message path", async () => {
    // Pair a real EK… private key with a wrong publicKey so the load
    // hits the verify-mismatch path with non-trivial input.
    const kp = signer.genKeys();
    const wrong = signer.genKeys();
    const keyPath = await writeKey(dir, "warm", kp);
    const cfgPath = await writeJson(dir, "wallets.json", {
      wallets: { warm: { keyPath, publicKey: wrong.publicKey } },
    });
    try {
      await loadWallets(cfgPath, { signer });
      throw new Error("expected load to fail");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain(kp.privateKey);
      // Belt-and-braces: assert no EK… substring of any length.
      expect(msg).not.toMatch(/EK[A-Za-z0-9]{20,}/);
    }
  });
});
