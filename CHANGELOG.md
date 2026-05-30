# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Detailed, per-change tracking starts with this file; entries for releases before
it are summarized from the git history.

## [Unreleased]

## [0.7.0] - 2026-05

### Added

- **New live network: `mesa-mut`** (Mesa Upgrade Test) — the fork of mainnet
  state used to rehearse the Mesa hardfork upgrade
  (`https://mesa-upgrade-tracker.minaprotocol.com/status.json`). Use with
  `--mode live --network mesa-mut`. Classified **preflight** (ephemeral; reset/
  retired without notice). Daemon + Archive-Node-API endpoints only — no Rosetta
  endpoint, no faucet, and no published archive dump (snapshot mode unavailable).
  Although genesis is a mainnet-state fork, the daemon reports networkID
  `mina:testnet`, so signatures use the testnet schema.

### Changed

- **`rosetta_*` tools are now registered only when the active network actually
  has a Rosetta endpoint.** Previously they were always registered in live mode
  and returned a "not available" message at call time on networks without
  Rosetta. The advertised tool list now reflects real per-network capability
  (e.g. `mesa-mut` lists 15 tools instead of 20). `NetworkConfig.archiveDumpPrefix`
  / `archiveDumpCadence` are now optional for networks without a published dump.

## [0.6.3] - 2026-05

### Fixed

- **MCP `serverInfo.version` now reflects the published package version.** The
  server previously reported a hardcoded `0.1.0` to clients regardless of the
  actual release; it now resolves the version from `package.json` (matching the
  `--version` flag), so clients inspecting the `initialize` response see the
  real version.

### Changed

- Republished via the GitHub Actions OIDC Trusted Publisher workflow so the npm
  release carries a signed provenance attestation (the manual `0.6.2` bootstrap
  publish had none).

## [0.6.1] - 2026-05

### Changed

- **Tool descriptions now tag mode gating** (`[tutorial]`, `[tutorial+live]`,
  `[tutorial+snapshot]`, `[infra]`) so an LLM client knows up-front which mode
  a tool needs instead of discovering it via a "not available" error. Applied
  to `get_staking_ledger`, `list_blocks`, `get_archive_stats`,
  `query_archive_sql`, `get_events`, `get_actions`, `get_archive_blocks`,
  `get_network_state`.
- **`get_sync_status` and `get_mempool` descriptions now document their
  flat response shapes** so LLM clients (and downstream tools) reach for the
  correct top-level fields. No code change — this resolves the silent shape
  diff between 0.5.x and 0.6.0.
- **`getBlockLive`** uses a case-insensitive substring check (`/\bblock not
  found\b/i`) instead of `err.message.startsWith("block not found")` to map
  the SDK's "not found" error back to `null`. Less brittle to SDK
  rewordings.
- **`listWallets`** now stringifies the SDK's `Currency` instance via
  `String(currency)` instead of treating `balance.total` as an opaque string.
  Honors `WalletSummary.balance: string | null` at runtime, not just at
  serialization time.
- **`resolveNonce`** accepts the SDK's typed `nonce: number` directly (was
  cast-narrowed to `string` then re-numerified).

### Fixed

- **Cookbook examples that errored on first call**:
  - `look_up_account` now uses `sender` and `receiver` (the actual
    `search_transactions` args) instead of an invented `publicKey` field.
  - `explore_zkapp_events` now uses `address` (the actual `get_events` /
    `get_actions` arg) instead of `publicKey`.
  - `verify_in_archive` now binds both `$tx_hash` and `$tx_id` from the
    flat `send_payment` response (the example was referencing `$tx_id`
    without binding it).
- **README**: project-structure and test-tree blocks rewritten to reflect
  the actual 0.6.x source layout — the old listing referenced files removed
  in 0.6.0 (`graphql/queries.ts`, `graphql/archive-api.ts`,
  `graphql/schemas.ts`) and the obsolete `GraphQLClient` wrapper.

## [0.6.0] - 2026-05

### Changed

- Switched fully to `@o1-labs/mina-sdk@^0.3.0` typed methods
  (`getAccount`, `getBestChain`, `getBlock`, `sendPayment`, `sendDelegation`,
  `getPooledUserCommands`, `getTransactionStatus`, `getGenesisConstants`,
  `getNetworkId`, `getTrackedAccounts`, `getDaemonStatus`, `getSyncStatus`).
  The SDK is now the single source of truth for query strings, response
  shapes, retry/timeout behavior, and drift detection (PR #47).
- **`describe_state`** consumes the SDK's flat `DaemonStatus` directly (no
  `{ daemonStatus: ... }` envelope) and the SDK's flat `BlockInfo` from
  `getBestChain`.
- **Tools that consumed raw GraphQL nesting** (notably `shapeDaemonBlock` for
  `get_block` / `get_best_chain`) switched to the SDK's flat shapes.

### Removed

- `src/graphql/queries.ts` — the in-house `QUERIES.*` map duplicated SDK
  queries that drifted from the daemon's schema. The SDK now ships its own
  two-layer drift checker that catches that class of regression upstream.
- `src/graphql/schemas.ts` — Zod boundary validators superseded by typed SDK
  responses.
- The `GraphQLClient` wrapper class — replaced with a tiny `createMinaClient`
  factory (`src/graphql/client.ts`) that pins `logger: null` for stdio-safe
  MCP and otherwise hands the SDK's `MinaClient` straight to providers.
- The mirror unit tests for the deleted modules.

### Added

- **`live-write`** keeps an inline mutation for signed submits via
  `client.executeQuery` — it needs `validUntil` + `signature`, which the
  SDK's typed `sendPayment` doesn't yet expose. Tutorial-mode (daemon-signed)
  submits use the SDK's typed methods unchanged.

## [0.5.0] - 2026-05

### Added

- Live-write mode: in-process transaction signing with `mina-signer` and
  multi-wallet support, submitting pre-signed transactions to the daemon.
- Published to npm as the scoped package `@o1-labs/mina-mcp-server`, runnable via
  `npx` (stdio) — the canonical local install for an MCP client.
- `LICENSE` file (Apache-2.0), `SECURITY.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, issue/PR templates, and a prompt cookbook
  (`docs/examples.md`).
- `server.json` manifest for the official MCP registry, a `mcpName` field in
  `package.json` (links the npm package to the registry entry), and a
  `smithery.yaml` for Smithery listing.
- `--help` and `--version` CLI flags.
- README distribution rework: a "which mode?" decision flow, a multi-client
  config matrix (Claude Desktop/Code, Cursor, Cline, Windsurf, Continue, Zed),
  a verify-it-works smoke prompt, a troubleshooting section, an env-var/flag
  table, and badges.

### Changed

- Internal transport switched to the published O(1) Labs SDK family instead
  of hand-rolled HTTP clients: daemon GraphQL → `@o1-labs/mina-sdk`, archive
  node → `@o1-labs/mina-archive-sdk`, Rosetta → `@o1-labs/mina-rosetta-sdk`.
  No change to the MCP tool surface
  ([#31](https://github.com/MinaProtocol/mina-mcp-server/issues/31)).
- Release pipeline switched to npm OIDC trusted publishing (no token).

## [0.4.0] - 2026-05

### Added

- Rosetta Data API tools and additional read-only coverage.

## [0.3.0] - 2026-05

### Added

- Live mode: read-only proxy against public Mina networks (devnet / mainnet /
  mesa), with no local infrastructure required.

## [0.2.0] - 2026-04

### Added

- Initial MCP server: snapshot and tutorial modes, archive SQL access, daemon
  queries/mutations, zkApp events/actions, and a test-account faucet.

[Unreleased]: https://github.com/MinaProtocol/mina-mcp-server/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/MinaProtocol/mina-mcp-server/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/MinaProtocol/mina-mcp-server/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/MinaProtocol/mina-mcp-server/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/MinaProtocol/mina-mcp-server/releases/tag/v0.2.0
