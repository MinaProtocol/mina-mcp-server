import { describe, it, expect } from "vitest";
import { promises as fs, chmodSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import MinaSigner from "mina-signer";
import { LiveWriteProvider, SpendLimitError } from "../../src/providers/live-write.js";
import { loadWallets } from "../../src/wallets/loader.js";
import { resolveNetwork } from "../../src/networks.js";
import type { WalletCaps, WalletRegistry } from "../../src/wallets/types.js";

const signer = new MinaSigner({ network: "testnet" });

function providerWithCaps(caps?: WalletCaps) {
  const k = signer.genKeys();
  const registry: WalletRegistry = {
    wallets: [{ alias: "warm", publicKey: k.publicKey, privateKey: k.privateKey, ...(caps ? { caps } : {}) }],
    defaultAlias: "warm",
  };
  const provider = new LiveWriteProvider(resolveNetwork("devnet"), registry, signer);
  // Avoid a real daemon round-trip in resolveNonce (dryRun still resolves one).
  (provider as unknown as { graphql: { query: () => Promise<unknown> } }).graphql = {
    query: async () => ({ data: { account: { nonce: "0" } } }),
  };
  return { provider, wallet: registry.wallets[0] };
}

describe("live-write spend caps + memo limit (#26)", () => {
  it("rejects a fee above maxFeeNanomina before signing", async () => {
    const { provider, wallet } = providerWithCaps({ maxFeeNanomina: "100000000" });
    await expect(
      provider.sendSignedPayment({
        wallet,
        payment: { to: wallet.publicKey, amount: "1", fee: "200000000" },
        dryRun: true,
      })
    ).rejects.toThrow(SpendLimitError);
  });

  it("rejects a payment amount above maxAmountNanomina", async () => {
    const { provider, wallet } = providerWithCaps({ maxAmountNanomina: "1000000000" });
    await expect(
      provider.sendSignedPayment({
        wallet,
        payment: { to: wallet.publicKey, amount: "5000000000", fee: "1" },
        dryRun: true,
      })
    ).rejects.toThrow(/maxAmountNanomina/);
  });

  it("rejects a memo longer than 32 bytes", async () => {
    const { provider, wallet } = providerWithCaps();
    await expect(
      provider.sendSignedPayment({
        wallet,
        payment: { to: wallet.publicKey, amount: "1", fee: "1", memo: "x".repeat(33) },
        dryRun: true,
      })
    ).rejects.toThrow(/memo/);
  });

  it("allows a transaction within caps (dry run)", async () => {
    const { provider, wallet } = providerWithCaps({
      maxFeeNanomina: "100000000",
      maxAmountNanomina: "1000000000",
    });
    const res = await provider.sendSignedPayment({
      wallet,
      payment: { to: wallet.publicKey, amount: "1000000000", fee: "100000000" },
      dryRun: true,
    });
    expect(res.dryRun).toBe(true);
  });

  it("loader parses per-wallet caps (number or string)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mina-caps-"));
    try {
      const k = signer.genKeys();
      const keyPath = path.join(tmp, "warm.key");
      await fs.writeFile(keyPath, k.privateKey, { mode: 0o600 });
      chmodSync(keyPath, 0o600);
      const cfgPath = path.join(tmp, "wallets.json");
      await fs.writeFile(
        cfgPath,
        JSON.stringify({
          wallets: {
            warm: {
              keyPath,
              publicKey: k.publicKey,
              caps: { maxFeeNanomina: "100000000", maxAmountNanomina: 5000000000 },
            },
          },
          defaultWallet: "warm",
        })
      );
      const registry = await loadWallets(cfgPath, { signer });
      expect(registry.wallets[0].caps).toEqual({
        maxFeeNanomina: "100000000",
        maxAmountNanomina: "5000000000",
      });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
