import { promises as fs, lstatSync, openSync, readFileSync, closeSync, constants as fsc } from "node:fs";
import path from "node:path";
import MinaSigner from "mina-signer";
import { LoadedWallet, RawWalletEntry, WalletCaps, WalletRegistry, WalletsConfig } from "./types.js";

// Anything wider than these mode bits in the bottom 6 (group+other rwx) is
// rejected. 0600 is allowed; 0640, 0644, 0660 etc. all fail.
const FORBIDDEN_PERM_BITS = 0o077;

export class WalletLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletLoadError";
  }
}

interface LoadOptions {
  // The mina-signer instance to verify each loaded key against its claimed
  // publicKey. Created once per server in src/index.ts and reused.
  signer: MinaSigner;
}

// Load a wallets.json file from disk, validate every key's permissions and
// matching public key, and return the in-memory registry.
//
// Failure modes (all throw WalletLoadError):
//   - file missing / unreadable / not JSON
//   - schema mismatch (missing `wallets`, non-string fields, etc.)
//   - key file too-permissive (mode & 0o077 != 0)
//   - loaded private key doesn't derive to the configured publicKey
//   - defaultWallet refers to an alias not in `wallets`
//
// Never logs or rethrows a private key. Errors carry alias + path, not key
// material — important for the redaction test.
export async function loadWallets(
  configPath: string,
  opts: LoadOptions
): Promise<WalletRegistry> {
  const raw = await readJson(configPath);
  const cfg = parseConfig(raw, configPath);

  const wallets: LoadedWallet[] = [];
  for (const [alias, entry] of Object.entries(cfg.wallets)) {
    const wallet = await loadOne(alias, entry, opts.signer, configPath);
    wallets.push(wallet);
  }

  const defaultAlias = resolveDefault(cfg, wallets);
  return { wallets, defaultAlias };
}

async function readJson(configPath: string): Promise<unknown> {
  let buf: Buffer;
  try {
    buf = await fs.readFile(configPath);
  } catch (e) {
    throw new WalletLoadError(
      `Could not read wallets config '${configPath}': ${(e as Error).message}`
    );
  }
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch (e) {
    throw new WalletLoadError(
      `Wallets config '${configPath}' is not valid JSON: ${(e as Error).message}`
    );
  }
}

function parseConfig(raw: unknown, configPath: string): WalletsConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new WalletLoadError(
      `Wallets config '${configPath}' must be a JSON object.`
    );
  }
  const obj = raw as Record<string, unknown>;
  const wallets = obj.wallets;
  if (!wallets || typeof wallets !== "object" || Array.isArray(wallets)) {
    throw new WalletLoadError(
      `Wallets config '${configPath}' must have a 'wallets' object.`
    );
  }
  const parsedWallets: Record<string, RawWalletEntry> = {};
  for (const [alias, entry] of Object.entries(wallets as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") {
      throw new WalletLoadError(`Wallet '${alias}': entry must be an object.`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.keyPath !== "string" || e.keyPath.length === 0) {
      throw new WalletLoadError(`Wallet '${alias}': missing keyPath (string).`);
    }
    if (typeof e.publicKey !== "string" || !e.publicKey.startsWith("B62q")) {
      throw new WalletLoadError(
        `Wallet '${alias}': missing or invalid publicKey (must start with B62q).`
      );
    }
    const caps = parseCaps(alias, e.caps);
    parsedWallets[alias] = { keyPath: e.keyPath, publicKey: e.publicKey, ...(caps ? { caps } : {}) };
  }
  if (Object.keys(parsedWallets).length === 0) {
    throw new WalletLoadError(
      `Wallets config '${configPath}' has no wallet entries.`
    );
  }
  const defaultWallet =
    typeof obj.defaultWallet === "string" ? obj.defaultWallet : undefined;
  return { wallets: parsedWallets, defaultWallet };
}

// Parse optional per-wallet spend caps. Each cap is a non-negative integer
// number of nanomina (accepts a JSON number or a decimal string).
function parseCaps(alias: string, raw: unknown): WalletCaps | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new WalletLoadError(`Wallet '${alias}': caps must be an object.`);
  }
  const c = raw as Record<string, unknown>;
  const caps: WalletCaps = {};
  for (const field of ["maxFeeNanomina", "maxAmountNanomina"] as const) {
    const v = c[field];
    if (v === undefined) continue;
    const s = typeof v === "number" ? String(v) : v;
    if (typeof s !== "string" || !/^\d+$/.test(s)) {
      throw new WalletLoadError(
        `Wallet '${alias}': caps.${field} must be a non-negative integer (nanomina).`
      );
    }
    caps[field] = s;
  }
  return Object.keys(caps).length ? caps : undefined;
}

async function loadOne(
  alias: string,
  entry: RawWalletEntry,
  signer: MinaSigner,
  configPath: string
): Promise<LoadedWallet> {
  // keyPath may be relative to the config file's directory, which makes
  // wallets.json portable next to its keys.
  const absKey = path.isAbsolute(entry.keyPath)
    ? entry.keyPath
    : path.resolve(path.dirname(configPath), entry.keyPath);

  // Permission + ownership + no-symlink gate. lstatSync (not statSync) so a
  // symlink is rejected outright rather than letting an attacker swap it
  // under us between stat and open. Also verify file is owned by the same
  // uid that's running the server — refuses someone else's 0600 key file.
  // Then open with O_NOFOLLOW to close the TOCTOU window between the lstat
  // and the read.
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(absKey);
  } catch (e) {
    throw new WalletLoadError(
      `Wallet '${alias}': key file '${absKey}' is not readable: ${(e as Error).message}`
    );
  }
  if (stat.isSymbolicLink()) {
    throw new WalletLoadError(
      `Wallet '${alias}': key file '${absKey}' is a symlink; refuse to follow. ` +
        `Point keyPath at the real file (or copy it next to wallets.json).`
    );
  }
  if (!stat.isFile()) {
    throw new WalletLoadError(
      `Wallet '${alias}': key file '${absKey}' is not a regular file.`
    );
  }
  if ((stat.mode & FORBIDDEN_PERM_BITS) !== 0) {
    const got = (stat.mode & 0o777).toString(8).padStart(3, "0");
    throw new WalletLoadError(
      `Wallet '${alias}': key file '${absKey}' has permissions ${got}; ` +
        `must be 0600 (chmod 600 the file before retrying).`
    );
  }
  // process.getuid is undefined on Windows; only enforce when it's available.
  const ourUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (ourUid !== null && stat.uid !== ourUid) {
    throw new WalletLoadError(
      `Wallet '${alias}': key file '${absKey}' is owned by uid ${stat.uid}, ` +
        `not by the server's uid ${ourUid}. Refusing to load someone else's key.`
    );
  }

  let keyContents: string;
  try {
    // O_NOFOLLOW: if the path raced into a symlink after the lstat, this
    // open fails with ELOOP rather than reading the wrong file.
    const fd = openSync(absKey, fsc.O_RDONLY | fsc.O_NOFOLLOW);
    try {
      keyContents = readFileSync(fd, { encoding: "utf8" }).trim();
    } finally {
      closeSync(fd);
    }
  } catch (e) {
    throw new WalletLoadError(
      `Wallet '${alias}': could not read '${absKey}': ${(e as Error).message}`
    );
  }
  if (!keyContents.startsWith("EK")) {
    // We don't log the contents — the prefix check guarantees an "EK…"
    // value would have leaked if we did. Just the alias + path.
    throw new WalletLoadError(
      `Wallet '${alias}': key file '${absKey}' does not contain a base58check ` +
        `Mina private key (expected to start with 'EK'). Encrypted key files ` +
        `are not supported in this revision — see README live-write notes.`
    );
  }

  // Verify the loaded private key derives to the configured publicKey.
  let derivedPk: string;
  try {
    derivedPk = signer.derivePublicKey(keyContents);
  } catch (e) {
    // Sanitize: mina-signer error messages don't include the private key
    // itself in any version we've used, but we belt-and-braces here.
    throw new WalletLoadError(
      `Wallet '${alias}': could not derive public key from '${absKey}'. ` +
        `Make sure the file contains exactly one base58check private key.`
    );
  }
  if (derivedPk !== entry.publicKey) {
    throw new WalletLoadError(
      `Wallet '${alias}': configured publicKey does not match the key in ` +
        `'${absKey}'. Expected ${entry.publicKey}, got ${derivedPk}.`
    );
  }

  return {
    alias,
    publicKey: entry.publicKey,
    privateKey: keyContents,
    ...(entry.caps ? { caps: entry.caps } : {}),
  };
}

function resolveDefault(
  cfg: WalletsConfig,
  wallets: LoadedWallet[]
): string | null {
  if (!cfg.defaultWallet) return null;
  const exists = wallets.some((w) => w.alias === cfg.defaultWallet);
  if (!exists) {
    throw new WalletLoadError(
      `defaultWallet '${cfg.defaultWallet}' is not one of the configured wallets.`
    );
  }
  return cfg.defaultWallet;
}
