import MinaSigner from "mina-signer";
import { LiveProvider } from "./live.js";
import { NetworkConfig } from "../networks.js";
import { LoadedWallet, WalletRegistry } from "../wallets/types.js";

// Signed-submit mutations stay inline here because live-write needs to set
// `validUntil` (computed by mina-signer) which the SDK's typed `sendPayment`
// / `sendDelegation` don't yet expose. Tutorial-mode (daemon-signed) submits
// use the SDK's typed methods via TutorialProvider.
const SIGNED_SEND_PAYMENT = `
mutation ($input: SendPaymentInput!, $signature: SignatureInput) {
  sendPayment(input: $input, signature: $signature) {
    payment {
      id
      hash
      kind
      nonce
      source { publicKey }
      receiver { publicKey }
      amount
      fee
      memo
    }
  }
}`;

const SIGNED_SEND_DELEGATION = `
mutation ($input: SendDelegationInput!, $signature: SignatureInput) {
  sendDelegation(input: $input, signature: $signature) {
    delegation {
      id
      hash
      kind
      nonce
      source { publicKey }
      receiver { publicKey }
      fee
      memo
    }
  }
}`;

// Mina transaction memos are capped at 32 bytes on-chain. Enforce it before
// signing so an over-long memo fails fast with a clear error rather than
// being silently truncated or rejected by the daemon after we've signed.
const MAX_MEMO_BYTES = 32;

// Guardrail violation — surfaced to the LLM so it can react, never silently
// swallowed. Carries no key material.
export class SpendLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpendLimitError";
  }
}

// Compare two non-negative decimal nanomina strings: is value > cap?
// Defensive: if either isn't a clean integer string, don't block here — the
// signer + daemon validate amounts; caps are a guardrail, not the validator.
function exceeds(value: string, cap: string): boolean {
  if (!/^\d+$/.test(value) || !/^\d+$/.test(cap)) return false;
  return BigInt(value) > BigInt(cap);
}

// LiveProvider that holds plaintext private keys for one or more wallets
// and can sign+submit payments / delegations against the configured public
// daemon. Only constructed when the caller passes a wallets config (see
// src/index.ts); plain LiveProvider stays the default read-only path.
//
// Private keys must never leave this class — not in tool responses, not in
// log lines, not in error messages. See src/wallets/types.ts.

export interface BuildPaymentInput {
  to: string;
  amount: string;
  fee: string;
  memo?: string;
}

export interface BuildDelegationInput {
  to: string;
  fee: string;
  memo?: string;
}

export interface WalletSummary {
  alias: string;
  publicKey: string;
  // Resolved at call time via daemon GraphQL. Optional because the lookup
  // can fail (rate limit, transient blip) and we'd rather return a summary
  // with a missing balance than throw away the whole list.
  balance?: string | null;
  nonce?: number | null;
  balanceError?: string;
}

export class LiveWriteProvider extends LiveProvider {
  public override readonly mode: string = "live";
  public readonly registry: WalletRegistry;
  private readonly signer: MinaSigner;
  // Local nonce cache: max(daemon's view, last-submitted+1). Avoids races
  // when an agent fires back-to-back sends before the daemon reflects the
  // first one.
  private readonly nonceCache = new Map<string, number>();

  constructor(network: NetworkConfig, registry: WalletRegistry, signer: MinaSigner) {
    super(network);
    this.registry = registry;
    this.signer = signer;
  }

  // Resolve a wallet by alias, public key, or fall back to default. Returns
  // null with a descriptive message in `error` when nothing matches.
  resolveWallet(opts: {
    alias?: string;
    publicKey?: string;
  }): { wallet?: LoadedWallet; error?: string } {
    if (opts.alias) {
      const w = this.registry.wallets.find((w) => w.alias === opts.alias);
      if (!w) {
        return {
          error: `Unknown wallet alias '${opts.alias}'. Known: ${this.registry.wallets
            .map((w) => w.alias)
            .join(", ")}.`,
        };
      }
      if (opts.publicKey && opts.publicKey !== w.publicKey) {
        return {
          error: `Wallet '${opts.alias}' publicKey is ${w.publicKey}, but 'from' was ${opts.publicKey}.`,
        };
      }
      return { wallet: w };
    }
    if (opts.publicKey) {
      const w = this.registry.wallets.find((w) => w.publicKey === opts.publicKey);
      if (!w) {
        return {
          error:
            `No loaded wallet has publicKey '${opts.publicKey}'. ` +
            `Known: ${this.registry.wallets.map((w) => w.publicKey).join(", ")}.`,
        };
      }
      return { wallet: w };
    }
    if (this.registry.defaultAlias) {
      const w = this.registry.wallets.find((w) => w.alias === this.registry.defaultAlias);
      if (w) return { wallet: w };
    }
    return {
      error:
        `No wallet specified and no defaultWallet configured. Pass 'from_alias' or 'from', ` +
        `or set 'defaultWallet' in wallets.json.`,
    };
  }

  // List loaded wallets with current balance + nonce. Balances are fetched
  // in parallel; a single failure surfaces as `balanceError` on that entry
  // rather than tanking the whole list.
  async listWallets(): Promise<WalletSummary[]> {
    return Promise.all(
      this.registry.wallets.map(async (w): Promise<WalletSummary> => {
        try {
          const account = await this.getAccountLive(w.publicKey);
          // `account.balance.total` is a Currency instance (SDK 0.3.0+);
          // stringify it deterministically as nanomina rather than relying on
          // implicit toJSON at serialization time. Keeps WalletSummary's
          // `balance: string | null` contract honest.
          const total = account?.balance?.total;
          const balance = total != null ? String(total) : null;
          const nonce = account && typeof account.nonce === "number" ? account.nonce : null;
          return { alias: w.alias, publicKey: w.publicKey, balance, nonce };
        } catch (e) {
          return {
            alias: w.alias,
            publicKey: w.publicKey,
            balanceError: (e as Error).message,
          };
        }
      })
    );
  }

  // Resolve the nonce to use for the next send from this wallet.
  // max(local cache, daemon-reported) — handles archive lag where the
  // daemon's view temporarily regresses.
  async resolveNonce(wallet: LoadedWallet): Promise<number> {
    let daemonNonce = 0;
    try {
      const account = await this.getAccountLive(wallet.publicKey);
      // SDK's AccountData.nonce is number (since 0.3.0). Coerce just in case
      // a fork ever returns it as a string.
      const raw = account?.nonce;
      if (typeof raw === "number") daemonNonce = raw;
      else if (typeof raw === "string") daemonNonce = Number(raw);
    } catch {
      // ignore — fall back to cache. The submission will fail with a clear
      // error if the daemon really is unreachable.
    }
    const cached = this.nonceCache.get(wallet.publicKey) ?? -1;
    return Math.max(daemonNonce, cached + 1);
  }

  // Enforce memo size + per-wallet spend caps BEFORE we sign anything. A
  // capped or oversized transaction must never get a signature. (#26)
  private enforceLimits(
    wallet: LoadedWallet,
    tx: { amount?: string; fee: string; memo?: string }
  ): void {
    const memoBytes = Buffer.byteLength(tx.memo ?? "", "utf8");
    if (memoBytes > MAX_MEMO_BYTES) {
      throw new SpendLimitError(
        `memo is ${memoBytes} bytes; Mina memos are capped at ${MAX_MEMO_BYTES} bytes.`
      );
    }
    const caps = wallet.caps;
    if (!caps) return;
    if (caps.maxFeeNanomina !== undefined && exceeds(tx.fee, caps.maxFeeNanomina)) {
      throw new SpendLimitError(
        `fee ${tx.fee} exceeds wallet '${wallet.alias}' cap maxFeeNanomina=${caps.maxFeeNanomina}. ` +
          `Lower the fee or raise the cap in wallets.json.`
      );
    }
    if (
      tx.amount !== undefined &&
      caps.maxAmountNanomina !== undefined &&
      exceeds(tx.amount, caps.maxAmountNanomina)
    ) {
      throw new SpendLimitError(
        `amount ${tx.amount} exceeds wallet '${wallet.alias}' cap maxAmountNanomina=${caps.maxAmountNanomina}. ` +
          `Lower the amount or raise the cap in wallets.json.`
      );
    }
  }

  // Build, sign, optionally submit. dryRun returns the signed payload + hash
  // without hitting the daemon, useful for "show me what you'd do".
  async sendSignedPayment(opts: {
    wallet: LoadedWallet;
    payment: BuildPaymentInput;
    dryRun: boolean;
  }): Promise<Record<string, unknown>> {
    this.enforceLimits(opts.wallet, {
      amount: opts.payment.amount,
      fee: opts.payment.fee,
      memo: opts.payment.memo,
    });
    const nonce = await this.resolveNonce(opts.wallet);
    const payload = {
      from: opts.wallet.publicKey,
      to: opts.payment.to,
      amount: opts.payment.amount,
      fee: opts.payment.fee,
      nonce: String(nonce),
      memo: opts.payment.memo ?? "",
    };
    const signed = this.signer.signPayment(payload, opts.wallet.privateKey);

    if (opts.dryRun) {
      return {
        dryRun: true,
        // Echo the signable data + the signature so the caller can inspect.
        // signer.publicKey is the sender, not anything secret.
        signedPayload: {
          data: signed.data,
          signature: signed.signature,
          publicKey: signed.publicKey,
        },
      };
    }

    const input: Record<string, unknown> = {
      from: opts.wallet.publicKey,
      to: opts.payment.to,
      amount: opts.payment.amount,
      fee: opts.payment.fee,
      nonce: String(nonce),
      memo: opts.payment.memo ?? "",
    };
    if ((signed.data as { validUntil?: string }).validUntil) {
      input.validUntil = (signed.data as { validUntil: string }).validUntil;
    }
    const data = await this.client.executeQuery<{ sendPayment?: Record<string, unknown> }>(
      SIGNED_SEND_PAYMENT,
      { input, signature: signed.signature },
      "send_signed_payment"
    );
    // Bump the cache *after* a successful submit so a failed submit doesn't
    // burn a nonce. If the daemon ACKs, the next send must use nonce+1.
    this.nonceCache.set(opts.wallet.publicKey, nonce);
    return (data.sendPayment ?? {}) as Record<string, unknown>;
  }

  async sendSignedDelegation(opts: {
    wallet: LoadedWallet;
    delegation: BuildDelegationInput;
    dryRun: boolean;
  }): Promise<Record<string, unknown>> {
    this.enforceLimits(opts.wallet, {
      fee: opts.delegation.fee,
      memo: opts.delegation.memo,
    });
    const nonce = await this.resolveNonce(opts.wallet);
    // mina-signer exposes signStakeDelegation with the same call shape.
    const payload = {
      from: opts.wallet.publicKey,
      to: opts.delegation.to,
      fee: opts.delegation.fee,
      nonce: String(nonce),
      memo: opts.delegation.memo ?? "",
    };
    const signed = this.signer.signStakeDelegation(payload, opts.wallet.privateKey);

    if (opts.dryRun) {
      return {
        dryRun: true,
        signedPayload: {
          data: signed.data,
          signature: signed.signature,
          publicKey: signed.publicKey,
        },
      };
    }

    const input: Record<string, unknown> = {
      from: opts.wallet.publicKey,
      to: opts.delegation.to,
      fee: opts.delegation.fee,
      nonce: String(nonce),
      memo: opts.delegation.memo ?? "",
    };
    if ((signed.data as { validUntil?: string }).validUntil) {
      input.validUntil = (signed.data as { validUntil: string }).validUntil;
    }
    const data = await this.client.executeQuery<{ sendDelegation?: Record<string, unknown> }>(
      SIGNED_SEND_DELEGATION,
      { input, signature: signed.signature },
      "send_signed_delegation"
    );
    this.nonceCache.set(opts.wallet.publicKey, nonce);
    return (data.sendDelegation ?? {}) as Record<string, unknown>;
  }
}
