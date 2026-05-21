# Contributing

Thanks for your interest in improving the Mina MCP server!

## Development setup

Requires **Node.js >= 20.18**.

```bash
npm install
npm run build        # tsc -p tsconfig.json
```

## Tests

| Command | What it covers | Needs infra? |
|---|---|---|
| `npm run test:unit` | Pure unit tests | No |
| `npm run test:mcp`  | In-process MCP server (mocked transports) | No |
| `npm test`          | unit + mcp | No |
| `npm run test:integration` | Live lightnet + Postgres | Yes (see [Prerequisites](README.md#prerequisites)) |

Run `npm test` before opening a PR. The integration suite runs in CI against a
real lightnet; you don't need it locally unless you're touching those paths.

## Architecture, in one paragraph

The MCP layer (`src/tools/*`, `src/server-factory.ts`) is the public surface —
agents call MCP tools, not the SDKs directly. Transport to Mina services goes
through the published O(1) Labs SDKs (`@o1-labs/mina-sdk` for the daemon,
`@o1-labs/mina-archive-sdk` for the archive node, `@o1-labs/mina-rosetta-sdk`
for Rosetta). Prefer adding a tool that wraps an SDK call over hand-rolling a
GraphQL query; only drop to raw transport if the SDK can't reach it.

## Conventions

- **New tools prefer the SDK.** A tool's `description` and error messages are its
  UX — write them for an LLM reading them cold (when to use, what it returns,
  what it does not do).
- **MCP speaks stdio.** Never write to stdout from server code; it corrupts the
  protocol stream. Use `console.error` / the logger.
- **Never leak secrets** in tool output — see [SECURITY.md](SECURITY.md).
- Keep PRs focused; update `CHANGELOG.md` under `[Unreleased]`.
- Conventional, imperative commit subjects (e.g. `Add get_staking_ledger tool`).

## Releasing (maintainers)

Bump `version` in `package.json`, update `CHANGELOG.md`, then push a `v*` tag.
The release workflow publishes to npm via OIDC trusted publishing and creates a
GitHub release. The Fly.io sandbox deploys separately on the same tag.
