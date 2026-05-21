# Security Policy

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Report privately via [GitHub's "Report a vulnerability"](https://github.com/MinaProtocol/mina-mcp-server/security/advisories/new)
(Security → Advisories), or email **build@o1labs.org** with details and, if
possible, a reproduction. We aim to acknowledge within 3 business days.

## Scope and threat model

This server is a thin MCP layer over Mina backing services. Keep these in mind:

- **Live-write mode loads unencrypted private keys** from a wallet file into
  process memory and signs transactions in-process. Only use it with keys whose
  funds you can afford to lose. Never load mainnet production keys; use a
  hardware wallet or offline signer for anything material. See the live-write
  warnings in the [README](README.md).
- **Private keys must never appear in tool output.** `list_wallets` and related
  tools redact secret material; a leak of any `sk`/`EK…` value through a tool
  response is a vulnerability — please report it.
- **`query_archive_sql` is read-only** (read-only DB role + statement timeout).
  A query that mutates state or escapes the timeout is a vulnerability.
- **The hosted Fly.io sandbox is a shared, best-effort service.** Treat any data
  it returns as untrusted for production decisions, and do not submit secrets to
  it.
- **Mainnet writes are guarded** behind an explicit opt-in (`allowMainnetWrites`).
  A path that submits a mainnet transaction without that opt-in is a
  vulnerability.

## Supported versions

This is beta software (0.x). Security fixes land on the latest released minor
version. Pin a version and watch releases for updates.
