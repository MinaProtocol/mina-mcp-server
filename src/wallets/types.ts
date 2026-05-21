// Public types for the live-write wallet subsystem. Kept separate from
// `loader.ts` so the file doesn't need to import `fs` and stays safe to
// pull in from browser-side tooling later.

// Optional per-wallet spend guardrails. Values are decimal nanomina strings
// (1 MINA = 1e9 nanomina). A runaway/adversarial LLM cannot exceed these
// without an explicit config change — see issue #26.
export interface WalletCaps {
  // Reject any single transaction whose fee exceeds this.
  maxFeeNanomina?: string;
  // Reject any single payment whose amount exceeds this.
  maxAmountNanomina?: string;
}

export interface RawWalletEntry {
  // Path on disk to the plaintext private key (one line, base58check `EK…`).
  // The file must have mode 0600. Encrypted key files are explicitly out of
  // scope for this revision — see README "live write mode" notes.
  keyPath: string;
  // The B62q… public key that this wallet should resolve to. Verified at
  // load time against the loaded private key — catches a wrong-key-for-this-
  // alias mistake before the first `send_payment` ever runs.
  publicKey: string;
  // Optional spend caps for this wallet.
  caps?: WalletCaps;
}

export interface WalletsConfig {
  wallets: Record<string, RawWalletEntry>;
  defaultWallet?: string;
}

// What the rest of the server holds in memory after the loader resolves
// each entry. The `privateKey` field must never leave this struct — never
// in tool responses, never in logs, never in errors. See the
// redaction-test in test/unit/wallets-redaction.test.ts.
export interface LoadedWallet {
  alias: string;
  publicKey: string;
  privateKey: string;
  // Spend caps carried from config; enforced before signing.
  caps?: WalletCaps;
}

export interface WalletRegistry {
  // Insertion order = config order (preserved by JS object iteration).
  wallets: LoadedWallet[];
  // null if defaultWallet was unset in config; in that case callers must
  // always pass `from` or `from_alias` explicitly.
  defaultAlias: string | null;
}
