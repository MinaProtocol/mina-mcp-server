# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Detailed, per-change tracking starts with this file; entries for releases before
it are summarized from the git history.

## [Unreleased]

### Added

- Published to npm as the scoped package `@o1-labs/mina-mcp-server`, runnable via
  `npx` (stdio) — the canonical local install for an MCP client.
- `LICENSE` file (Apache-2.0), `SECURITY.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, issue/PR templates, and a prompt cookbook
  (`docs/examples.md`).
- `server.json` manifest for the official MCP registry.
- `--help` and `--version` CLI flags.
- README distribution rework: a "which mode?" decision flow, a multi-client
  config matrix (Claude Desktop/Code, Cursor, Cline, Windsurf, Continue, Zed),
  a verify-it-works smoke prompt, a troubleshooting section, an env-var/flag
  table, and badges. Expanded the prompt cookbook to structured, copy-paste
  examples.

### Changed

- Internal transport now uses the published O(1) Labs SDK family instead of
  hand-rolled HTTP clients: daemon GraphQL → `@o1-labs/mina-sdk`, archive node →
  `@o1-labs/mina-archive-sdk`, Rosetta → `@o1-labs/mina-rosetta-sdk`. No change
  to the MCP tool surface ([#31](https://github.com/MinaProtocol/mina-mcp-server/issues/31)).
- Release pipeline switched to npm OIDC trusted publishing (no token).

## [0.5.0] - 2026-05

### Added

- Live-write mode: in-process transaction signing with `mina-signer` and
  multi-wallet support, submitting pre-signed transactions to the daemon.

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
