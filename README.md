# mina-mcp-server

[![npm version](https://img.shields.io/npm/v/@o1-labs/mina-mcp-server.svg)](https://www.npmjs.com/package/@o1-labs/mina-mcp-server)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compatible-success.svg)](https://modelcontextprotocol.io)

MCP (Model Context Protocol) server for the [Mina Protocol](https://minaprotocol.com/) blockchain. Exposes Mina blockchain data and operations through MCP-compatible tools that can be used by AI assistants and other MCP clients.

**New here?** Jump to [Which mode do I want?](#which-mode-do-i-want) → [Connect your MCP client](#connect-your-mcp-client) → [Verify it works](#verify-it-works). For copy-paste prompts, see the [prompt cookbook](docs/examples.md).

> **Status: beta / preview.** **Live mode** talks to public Mina networks (devnet / mainnet / mesa) and needs **no local infrastructure** — run `npx @o1-labs/mina-mcp-server --mode live --network devnet`, or point your client at the [hosted sandbox](#deploying-on-flyio). **Snapshot** and **tutorial** modes are thin MCP layers over backing services (PostgreSQL, and for tutorial a local Mina lightnet) that you must stand up yourself first — see [Prerequisites](#prerequisites). A bundled SQLite snapshot for zero-infra *snapshot* mode is planned ([#28](https://github.com/MinaProtocol/mina-mcp-server/issues/28)).

## Features

- **40+ MCP tools** for querying accounts, blocks, transactions, zkApp events/actions, network/sync status, Rosetta, and archive SQL.
- **Three operating modes:**
  - **Live** — read-only proxy to a public Mina network (devnet/mainnet/mesa). **No local infra** — the zero-setup default.
  - **Tutorial** — full read/write against a local Mina lightnet (daemon, archive, test-account faucet).
  - **Snapshot** — schema-only SQL access (`query_archive_sql`, `get_archive_schema`) against a frozen archive Postgres dump.
- **Standardized Rosetta** Data API tools (live mode) alongside the native GraphQL ones.
- **Safe SQL access** — read-only queries against the archive DB with timeout protection.
- **Test-account faucet** — acquire/release pre-funded accounts (tutorial mode).
- **[Prompt cookbook](docs/examples.md)** — copy-paste prompts that drive end-to-end tool sequences.

## Which mode do I want?

| You want to… | Mode | Infra needed |
|---|---|---|
| **Query a public network** (balances, blocks, zkApp events, Rosetta) | **`live`** | None — just `npx`. **Start here.** |
| **Send transactions on a public network** with your own keys | **`live` + `--wallets`** | None (keys signed in-process) |
| **Develop against a controllable chain** (faucet, reset, write) | **`tutorial`** | Local Mina lightnet ([Prerequisites](#prerequisites)) |
| **Run analytics SQL over a historical archive dump** | **`snapshot`** | A Postgres archive dump ([Prerequisites](#prerequisites)) |

Most people want **`live`** — it needs nothing installed beyond Node.

## Connect your MCP client

**Local (recommended), via `npx` — no clone, no infra:**

```json
{
  "mcpServers": {
    "mina": {
      "command": "npx",
      "args": ["-y", "@o1-labs/mina-mcp-server", "--mode", "live", "--network", "devnet"]
    }
  }
}
```

Swap `devnet` for `mainnet` or `mesa`. For other modes, change `--mode` (and drop `--network`); see [Configuration](#configuration).

**Hosted sandbox (zero install) — point your client at the URL:**

```json
{ "mcpServers": { "mina": { "url": "https://mina-mcp-sandbox.fly.dev/mcp" } } }
```

The hosted sandbox runs **tutorial mode** against a shared lightnet (best-effort, no SLA). Use local `live` mode for real networks.

**Where the config lives, per client:**

| Client | Config | Notes |
|---|---|---|
| Claude Desktop | `claude_desktop_config.json` (Settings → Developer) | `command`/`args` shape above |
| Claude Code | `.mcp.json` in the project, or `claude mcp add` | same shape |
| Cursor | `~/.cursor/mcp.json` (or Settings → MCP) | same shape |
| Cline / Roo | the extension's MCP settings JSON | same shape |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | same shape |
| Continue | `~/.continue/config.json` under `mcpServers` | same shape |
| Zed | `settings.json` under `context_servers` | Zed uses `"command": { "path": "npx", "args": [...] }` |

All clients except Zed take the same `{ command, args }` object; only the file location differs. Hosted-URL configs work in any client that supports a remote/streamable-HTTP MCP server.

## Verify it works

After wiring it up, ask your assistant:

> **"Describe the current Mina network state."**

It should call `describe_state` and return a snapshot with `syncStatus` (e.g. `SYNCED`), the network name, and mempool size. That's your green light. (On `mesa`, expect a `PREFLIGHT` caveat in the hints.)

## Configuration

All flags have environment-variable equivalents; run `npx @o1-labs/mina-mcp-server --help` for the full surface.

```
$ mina-mcp-server --help
USAGE
  mina-mcp-server [--mode <mode>] [options]

MODES
  live        Read-only proxy to a public network. No local infra. (use --network)
  tutorial    Read+write against a local Mina lightnet (daemon + archive + faucet).
  snapshot    Schema-only SQL access against a frozen archive Postgres dump. (default)
```

| Flag | Env var | Values (default) |
|---|---|---|
| `--mode` | `MINA_MCP_MODE` | `live` / `tutorial` / `snapshot` (`snapshot`) |
| `--network` | `MINA_MCP_NETWORK` | `devnet` / `mainnet` / `mesa` / `mesa-mut` (live only) |
| `--transport` | `MINA_MCP_TRANSPORT` | `stdio` / `http` (`stdio`) |
| `--wallets` | `MINA_MCP_WALLETS` | path to `wallets.json` (live-write) |
| `--allow-mainnet-writes` | `MINA_MCP_ALLOW_MAINNET_WRITES=1` | opt-in gate for mainnet sends |
| _(http only)_ | `MINA_MCP_HTTP_PORT` | port for `--transport http` (`3000`) |
| `--help`, `--version` | — | print help / version and exit |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npx` fails / "Unsupported engine" | Needs **Node ≥ 20.18**. Check `node --version`. |
| Tools return "not reachable" in `tutorial`/`snapshot` | The server does **not** start infra — bring up the lightnet/Postgres first ([Prerequisites](#prerequisites)). |
| Port already in use (`tutorial` lightnet) | Another lightnet/daemon is bound to 3085/8282/5432; stop it or remap ports. |
| Changes not taking effect after editing source | Re-run `npm run build` (the client runs `dist/`, not `src/`). |
| Hosted server: "Missing/!Unknown session id" | Your client must echo the `Mcp-Session-Id` header from `initialize` on every request — use a client that supports streamable-HTTP MCP. |
| `mesa` data looks unstable | `mesa` is a **preflight** network — it can reset/rename without notice. Treat its data as ephemeral. |

## Prerequisites

> Only needed for **`tutorial`** and **`snapshot`** modes. **`live` mode needs none of this.**

**Common:**

- Node.js >= 20.18
- Docker & Docker Compose (to run the backing services below)

**Snapshot mode additionally requires:**

| Component | Purpose | Default endpoint |
|-----------|---------|------------------|
| PostgreSQL with Mina archive schema + data | Source of all read queries | `localhost:5432` |

You can bring this up with `docker-compose.snapshot.yml` (ships in the repo). A snapshot dump under `./snapshots/devnet-latest` — or downloaded via the compose `download` profile — is required.

**Tutorial mode additionally requires** a full local lightnet:

| Component | Purpose | Default endpoint |
|-----------|---------|------------------|
| Mina Daemon GraphQL | Live chain queries, sending payments | `http://localhost:3085/graphql` |
| Archive-Node-API | zkApp events/actions, archive blocks | `http://localhost:8282` |
| Accounts Manager | Test account faucet | `http://localhost:8181` |
| PostgreSQL (archive DB) | Read queries | `localhost:5432` |

All four are brought up by `docker-compose.tutorial.yml`. Expect ~1–2 minutes for the network to sync before tools respond correctly.

> **Note:** if you install from npm (`npx @o1-labs/mina-mcp-server`), the docker-compose files are *not* included in the tarball — you will need to clone this repo, or copy the `docker-compose.*.yml` files out of it, to start the infra.

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Start infrastructure (pick one):

# Option A: Snapshot mode (read-only, from local dump)
SNAPSHOT_DIR=./snapshots/devnet-latest docker compose -f docker-compose.snapshot.yml up -d

# Option B: Snapshot mode (download latest dump from GCS — devnet by default)
docker compose -f docker-compose.snapshot.yml --profile download up -d
#   See "Snapshot mode against other public networks" below for mainnet/mesa.

# Option C: Tutorial mode (full lightnet)
docker compose -f docker-compose.tutorial.yml up -d
# Wait ~1-2 min for the network to sync

# Option D: Live mode (read-only, talks to a public Mina network — no local infra)
#   Picks a network with --network (devnet, mainnet, mesa). Nothing else to start.

# Run the MCP server
MINA_MCP_MODE=snapshot npm start                              # or
MINA_MCP_MODE=tutorial npm start                              # or
npm start -- --mode live --network devnet                     # no Postgres / lightnet needed
```

### Live mode against a public Mina network

Live mode is a thin read-only proxy that turns MCP tool calls into GraphQL/HTTP requests against the o1Labs-hosted public endpoints. There is **nothing to host** — run it locally next to your MCP client:

```bash
npm start -- --mode live --network devnet     # or mainnet, mesa
# equivalently:
MINA_MCP_MODE=live MINA_MCP_NETWORK=devnet npm start
```

Endpoints are best-effort services without SLAs and URLs are subject to change. Networks are classified by **stability tier**:

| Network | Stability | What it means |
|---|---|---|
| `devnet` | stable | Long-lived dev network. Expected to stick around. |
| `mainnet` | stable | Production. Expected to stick around. |
| `mesa` | **preflight** | Preview/staging network. **May be reset, renamed, or retired without notice.** Endpoints, archive-dump filenames, and even the network identity itself are not guaranteed stable. |
| `mesa-mut` | **preflight** | [Mesa Upgrade Test](https://mesa-upgrade-tracker.minaprotocol.com/status.json) — a fork of mainnet state for rehearsing the Mesa hardfork. **Tied to the upgrade rehearsal; will be reset/retired without notice.** Genesis is a mainnet-state fork, but the daemon reports networkID `mina:testnet` (testnet signature schema). No Rosetta endpoint, no faucet, and no published archive dump (snapshot mode unavailable). |

When a `LiveProvider` is constructed against a preflight network, the server emits a `[WARN] Network '<name>' is a PREFLIGHT network…` line at startup and prepends a `PREFLIGHT` hint to `describe_state`'s `hints[]` — so any LLM consuming the output sees the caveat before reasoning about the data. If you build downstream automation against a preflight network, treat any data you gather as ephemeral and have a fallback to a stable network.

### Rosetta Data API (live mode)

When a live-mode network has a Rosetta endpoint configured (`devnet`, `mainnet`, and `mesa` do today; `mesa-mut` does not), the server registers five Rosetta Data API tools alongside the daemon/archive ones. On a network without a Rosetta endpoint the `rosetta_*` tools are not registered at all, so the advertised tool list reflects what the network can actually do. These return responses in **standardized Rosetta format** — useful for LLMs and integrations that already speak Rosetta:

| Tool | Rosetta endpoint | Use |
|---|---|---|
| `rosetta_status` | `POST /network/status` | Current / genesis / oldest block, sync state |
| `rosetta_account` | `POST /account/balance` | Balance for an address, optionally at a specific block |
| `rosetta_block` | `POST /block` | Full block (with operations) by index or hash |
| `rosetta_mempool` | `POST /mempool` | Pending transaction identifiers |
| `rosetta_mempool_transaction` | `POST /mempool/transaction` | A single pending tx with operations |

Construction API (offline signing flow) is intentionally not included in this set; it's a follow-up with its own tool-shape design (macro-vs-literal).

Each network also carries optional pointers that the MCP server doesn't proxy itself but surfaces via `describe_state.hints[]` so an LLM can hand them to a human or a Rosetta-aware client:

| Network | Faucet | Rosetta |
|---|---|---|
| `devnet` | https://faucet.minaprotocol.com | https://devnet-rosetta.gcp.o1test.net |
| `mainnet` | _(none — exchanges only)_ | https://mainnet-rosetta.gcp.o1test.net |
| `mesa` | https://faucet.minaprotocol.com | https://rosetta.mina-mesa-network.gcp.o1test.net |
| `mesa-mut` | _(none — mainnet-state fork)_ | _(none)_ |

### Live write mode (experimental — client-side signing)

Live mode can be promoted from read-only to read+write by handing the server one or more wallet keys. Sends are signed **in this process** with [`mina-signer`](https://www.npmjs.com/package/mina-signer) and submitted as pre-signed transactions to the daemon. No daemon-side wallet, no faucet on devnet/mainnet, no key material on the wire.

```bash
npm start -- --mode live --network devnet --wallets ./wallets.json
# equivalently:
MINA_MCP_MODE=live MINA_MCP_NETWORK=devnet MINA_MCP_WALLETS=./wallets.json npm start
```

> **EXPERIMENTAL — read this before pointing it at real value.**
> Wallet private keys are loaded **unencrypted** from disk into this process's memory. That's fine for ephemeral test wallets on devnet/mesa; it's **not** fine for production keys. Either:
> - only load wallets containing money you can afford to lose, **or**
> - don't use this mode for mainnet at all — use a hardware wallet or an offline signer for anything material.
>
> Pointing this at mainnet additionally requires `--allow-mainnet-writes` (or `MINA_MCP_ALLOW_MAINNET_WRITES=1`) as a deliberate speedbump against config typos.

**`wallets.json` schema**

```json
{
  "wallets": {
    "warm": {
      "keyPath": "/home/me/.mina/keys/warm.key",
      "publicKey": "B62q…",
      "caps": { "maxFeeNanomina": "100000000", "maxAmountNanomina": "5000000000" }
    },
    "demo": { "keyPath": "/home/me/.mina/keys/demo.key", "publicKey": "B62q…" }
  },
  "defaultWallet": "warm"
}
```

- `keyPath` files must contain exactly one `EK…` base58check private key (one line, no other content). Encrypted JSON key files are not supported in this revision.
- `keyPath` files **must** be `chmod 600`; the loader refuses to start otherwise.
- `publicKey` is verified at startup against the loaded key — catches "wrong key for this alias" mistakes before any tool runs.
- `caps` (optional, per wallet) bound a single transaction: `maxFeeNanomina` and `maxAmountNanomina` (decimal nanomina, 1 MINA = 1e9). A send exceeding a cap is **refused before signing** — a guardrail against a runaway/adversarial LLM draining a wallet. Memos are always capped at 32 bytes.
- `defaultWallet` is optional; if omitted, every `send_payment`/`send_delegation` call must pass `from_alias` or `from`.
- Paths may be relative to the config file's directory (so the whole bundle is portable).

**Tool surface added in live-write mode** (on top of the live-mode read tools):

| Tool | Description |
|---|---|
| `list_wallets` | Loaded aliases + publicKeys + balances + nonces. **Never returns private keys.** |
| `send_payment` | Sign + submit a MINA payment. Use `from_alias`, or `from` (publicKey), or rely on the default. Pass `dry_run: true` to inspect the signed payload without submitting. |
| `send_delegation` | Same shape, for stake delegation. |

`describe_state` in live-write mode adds a `wallets[]` block (aliases, publicKeys, balances — never keys) and prepends a `Live-WRITE mode…` hint, so an LLM picks up the new capabilities on the first orient.

**Safety guarantees** (enforced, not just documented):

- **Permission gate.** Any key file with mode wider than `0600` fails startup loudly.
- **Mainnet writes opt-in.** `--allow-mainnet-writes` is a hard requirement for `--network mainnet --wallets …`.
- **Nonce cache.** `max(daemon_nonce, last_submitted+1)` — survives archive-lag races without burning a nonce on failed submits.
- **Dry-run.** `send_payment(dry_run: true)` returns the signed payload + computed hash without hitting the daemon.
- **Automated redaction sweep.** `test/mcp/wallets-redaction.test.ts` fires every registered tool with bogus args and asserts the server's loaded private key never appears in any response.

### Snapshot mode against other public networks

The `--profile download` path of `docker-compose.snapshot.yml` fetches dumps from the public bucket `https://storage.googleapis.com/mina-archive-dumps`. The URL layout is `<prefix>-<YYYY-MM-DD>_<HOUR>.sql.tar.gz`. To target a different network, override `ARCHIVE_DUMP_PREFIX`:

| Network | Prefix | Cadence | Recent size |
|---|---|---|---|
| devnet (default) | `devnet-archive-dump` | daily, `_0000` UTC | ~370 MB compressed |
| mainnet | `mainnet-archive-dump` | daily, `_0000` UTC | ~1.5 GB compressed |
| mesa (**preflight**) | `hetzner-pre-mesa-1-archive-dump` | twice daily, `_0000` + `_1200` UTC | ~32 MB compressed |

```bash
# Mainnet snapshot
ARCHIVE_DUMP_PREFIX=mainnet-archive-dump \
  docker compose -f docker-compose.snapshot.yml --profile download up -d

# Mesa snapshot (preflight — see warning below)
ARCHIVE_DUMP_PREFIX=hetzner-pre-mesa-1-archive-dump ARCHIVE_DUMP_HOUR=1200 \
  docker compose -f docker-compose.snapshot.yml --profile download up -d
```

> **Mesa is a preflight network.** The dump prefix above is internal ops naming and is **not a stable convention** — it may change or stop being published without notice when mesa graduates or is retired. Treat snapshot data from mesa as ephemeral.

In live mode the server hides every tool that would need infra it doesn't have:

- no archive Postgres → no `query_archive_sql`, `get_archive_schema`, `list_blocks`, `search_transactions`, `get_transaction`, `get_staking_ledger`, `get_archive_stats`;
- no accounts-manager / faucet → no `faucet`, `return_account`, `reset_session`;
- no reset janitor → no `freeze_reset`, `unfreeze_reset`, `freeze_status`;
- public daemons don't sign for you → no `send_payment`, `send_delegation`, `get_tracked_accounts`.

`get_block` requires a `stateHash` in live mode — use `get_archive_blocks` (Archive-Node-API) to discover one first.

## Demo: end-to-end payment in tutorial mode

The point of running this server is that a single natural-language prompt can drive a multi-step on-chain flow that would otherwise need half a dozen separate GraphQL calls. Once the lightnet is up and your MCP client is connected, this prompt:

> Grab two funded test accounts from the faucet. Send 10 MINA from the first to the second, then poll until it lands in a block — show me the mempool state right after submission and the block height it gets included in. Once confirmed, check both balances and return both accounts.

drives the following tool sequence (excerpted from a real tutorial-mode run):

| Step | Tool | Key output |
|------|------|------------|
| 1 | `faucet` ×2 | Two accounts, 1550 MINA each |
| 2 | `send_payment` (10 MINA, 0.1 fee) | Tx hash `5JtVaGBj…6Tto` |
| 3 | `get_mempool` filtered by sender | Captures the pending tx |
| 4 | `get_transaction_status` | `INCLUDED` |
| 5 | `get_transaction` → `get_block(height=175)` | In block **175** (`3NKErr14…YHpm`), status `applied` |
| 6 | `get_account` ×2 | Sender 1539.9 MINA, Receiver 1560 MINA — sender −10 payment −0.1 fee, receiver +10 ✓ |
| 7 | `return_account` ×2 | Both released back to the pool |

End-to-end wall-clock was a few seconds on a synced lightnet. The flow exercises every tutorial-only tool family in one go — faucet/return, payment submission, mempool, status polling, block/account lookup — making it a useful smoke check after deploy.

## Infrastructure configuration (tutorial / snapshot)

These configure where the backing services live; `live` mode doesn't use them. Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
```

Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MINA_MCP_MODE` | `snapshot` | Server mode: `snapshot`, `tutorial`, or `live` |
| `MINA_MCP_NETWORK` | _(unset)_ | Required in live mode: `devnet`, `mainnet`, or `mesa` |
| `ARCHIVE_DB_HOST` | `localhost` | Archive PostgreSQL host |
| `ARCHIVE_DB_PORT` | `5432` | Archive PostgreSQL port |
| `MINA_GRAPHQL_ENDPOINT` | `http://localhost:3085/graphql` | Mina daemon GraphQL (tutorial mode) |
| `ARCHIVE_API_ENDPOINT` | `http://localhost:8282` | Archive-Node-API GraphQL (tutorial mode) |
| `ACCOUNTS_MANAGER_ENDPOINT` | `http://localhost:8181` | Test accounts manager (tutorial mode) |

## MCP Tools

Tool registration is **mode-aware** — tools whose backing infra isn't available in a given mode aren't registered at all (so they don't show up in `tools/list`, and an LLM never reasons about them).

### Snapshot mode (schema explorer)

| Tool | Description |
|------|-------------|
| `query_archive_sql` | Execute read-only SQL against the local archive Postgres |
| `get_archive_schema` | Inspect archive DB table/column metadata |
| `get_sync_status` | DB connectivity probe + basic archive stats |
| `list_examples` / `get_example` | Discover canned SQL workflows (e.g. `custom_sql`) |

### Tutorial mode (live lightnet — superset of snapshot)

All snapshot tools, plus:

| Tool | Description |
|------|-------------|
| `get_account` / `get_block` | Live state from the daemon, with archive-DB fallback |
| `get_staking_ledger` / `list_blocks` / `get_transaction` / `search_transactions` | Archive-DB reads |
| `get_archive_stats` | Tally of blocks / commands / accounts in the archive |
| `get_best_chain` / `get_mempool` / `get_transaction_status` | Live daemon queries |
| `get_genesis_constants` / `get_network_id` / `get_tracked_accounts` | Daemon metadata |
| `get_events` / `get_actions` / `get_archive_blocks` / `get_network_state` | Archive-Node-API |
| `faucet` / `return_account` / `reset_session` | Pre-funded test account pool (1550 MINA each) |
| `send_payment` / `send_delegation` | Daemon-signed transactions |
| `freeze_reset` / `unfreeze_reset` / `freeze_status` | Pause the periodic chain reset for human demos |
| `describe_state` | One-shot snapshot of chain + mempool + accounts + reset state |

### Live mode (public Mina network — read-only)

| Tool | Description |
|------|-------------|
| `get_account` / `get_block` / `get_best_chain` / `get_mempool` / `get_transaction_status` | Live daemon queries |
| `get_sync_status` / `get_genesis_constants` / `get_network_id` | Daemon metadata |
| `get_events` / `get_actions` / `get_archive_blocks` / `get_network_state` | Archive-Node-API |
| `rosetta_status` / `rosetta_account` / `rosetta_block` / `rosetta_mempool` / `rosetta_mempool_transaction` | Mina-Rosetta Data API (Coinbase spec) |
| `describe_state` | Live snapshot incl. preflight + Rosetta + faucet hints |
| `list_examples` / `get_example` | Live-mode-applicable workflows |

## Development

### Build

```bash
npm run build          # compile TypeScript
npm run dev            # compile in watch mode
```

### Running Tests

```bash
# All unit + MCP tests (no infrastructure needed)
npm run test:unit
npm run test:mcp

# All tests (unit + MCP)
npm test

# Watch mode
npm run test:watch

# Integration tests (requires running lightnet)
docker compose -f docker-compose.tutorial.yml up -d
npm run test:integration
```

### Test Structure

```
test/
  unit/                    # Unit tests - mock all external dependencies
    accounts-manager.test.ts
    archive-db.test.ts
    example-library.test.ts
    live-provider.test.ts
    networks.test.ts
    reset-controller.test.ts
    schemas.test.ts
    session-tracker.test.ts
    shape.test.ts
    snapshot-provider.test.ts
    tutorial-provider.test.ts
    wallet-caps.test.ts
    wallets-loader.test.ts
  mcp/                     # MCP protocol tests - InMemoryTransport + Client
    helpers.ts             # Shared setup: mock providers, transport wiring
    snapshot.test.ts       # Snapshot mode
    tutorial.test.ts       # Tutorial mode: live tools, zkApp, faucet
    live.test.ts           # Live mode: read-only against public networks
    live-write.test.ts     # Live-write mode: wallet loading + signed sends
    http-transport.test.ts # HTTP transport: rate-limiting, /health, /metrics
    wallets-redaction.test.ts # Sweep: no private key leaks any tool response
  integration/             # Integration tests - require live lightnet
    lightnet.test.ts
    tutorial.test.ts
```

The **MCP tests** use `@modelcontextprotocol/sdk`'s `InMemoryTransport` to create a linked client-server pair in-process. This tests the full MCP protocol layer (tool registration, schema validation, request/response) without needing any network or database.

### Project Structure

```
src/
  index.ts                 # Entry point — CLI args, mode wiring, transport
  server-factory.ts        # Centralized tool registration per mode
  db/archive.ts            # PostgreSQL archive database client
  graphql/
    client.ts              # createMinaClient factory (wraps @o1-labs/mina-sdk MinaClient)
    accounts-manager.ts    # Tutorial-mode test accounts REST API client
  providers/
    snapshot.ts            # Read-only provider (archive DB only; no daemon)
    tutorial.ts            # Tutorial provider (daemon + archive + accounts mgr)
    live.ts                # Live provider (public network daemon, read-only)
    live-write.ts          # Live-write provider (wallet-backed signed sends)
  tools/
    accounts.ts            # Account tools (get_account, get_staking_ledger)
    blocks.ts              # Block tools (get_block, list_blocks, get_best_chain)
    transactions.ts        # Transaction tools (send_payment, search, mempool, status)
    network.ts             # Network tools (sync status, genesis, archive stats)
    schema.ts              # Archive SQL (query_archive_sql, get_archive_schema)
    zkapps.ts              # Archive-Node-API tools (events, actions, blocks)
    test-accounts.ts       # Faucet tools (acquire/release tutorial accounts)
    state.ts               # describe_state aggregator
    admin.ts               # Reset controls (freeze/unfreeze)
    rosetta.ts             # Rosetta Data API tools (live mode)
    wallets.ts             # list_wallets (live-write mode)
    examples.ts            # Cookbook tools (list_examples, get_example)
    shape.ts               # Response shapers (lite / transactions / full)
  transports/
    http.ts                # HTTP transport (Streamable + rate limiting + /metrics)
  wallets/
    loader.ts              # Wallet config + key file loader (live-write mode)
    types.ts               # WalletRegistry / LoadedWallet types
  session/tracker.ts       # Per-MCP-session account tracking (auto-release)
  reset/controller.ts      # Reset-window controller (freeze/unfreeze chain resets)
  snapshots/capture.ts     # CLI: capture archive DB snapshot
  examples/library.ts      # Cookbook workflow library (drives examples tools)
  networks.ts              # Public network configs (devnet/mainnet/mesa)
```

Daemon GraphQL access goes through `@o1-labs/mina-sdk`'s `MinaClient` — typed
methods (`getAccount`, `getBestChain`, `getBlock`, `sendPayment`, …) own the
query strings, response shapes, and retry/timeout policy. mcp-server is
deliberately a thin adapter: it adds tutorial-mode test-account orchestration
and the MCP tool registration layer on top of the SDK.

## Tutorial Mode Services

When running in tutorial mode with `docker-compose.tutorial.yml`, the following services are available:

| Service | URL | Description |
|---------|-----|-------------|
| Mina Daemon | `http://localhost:3085/graphql` | Direct daemon GraphQL |
| NGINX Proxy | `http://localhost:8080/graphql` | Daemon GraphQL with CORS |
| Explorer UI | `http://localhost:8080/` | Lightweight block explorer |
| Accounts Manager | `http://localhost:8181/` | Test account REST API |
| Archive-Node-API | `http://localhost:8282/` | Archive GraphQL (events/actions) |
| PostgreSQL | `localhost:5432` | Archive database |

## Using with tutorial / snapshot mode

Client config is the same `{ command, args }` shown in [Connect your MCP client](#connect-your-mcp-client) — just change `--mode` to `tutorial` or `snapshot` (and drop `--network`). The difference is the **infrastructure**: these modes talk to local services, so bring those up first (see [Prerequisites](#prerequisites) and [Quick Start](#quick-start)).

**The MCP server will not start the infrastructure for you.** If Postgres / daemon / archive-node-api / accounts-manager are not reachable, tools return connection errors — that's expected, not a bug.

## Deploying on Fly.io

The repo ships a `Dockerfile` and `fly.toml` that bundle the MCP server with the lightnet image into a single Fly machine. The MCP server runs in HTTP/SSE mode behind Fly's TLS terminator; the lightnet's Explorer UI + GraphQL playground are exposed on a second port for humans.

```bash
# First-time setup (creates the app and provisions a machine)
flyctl launch --no-deploy --copy-config

# Or, if app already exists:
flyctl deploy
```

After deploy:

| URL | Audience | What's there |
|-----|----------|--------------|
| `https://mina-mcp-sandbox.fly.dev/mcp` | AI clients | MCP streamable-HTTP endpoint |
| `https://mina-mcp-sandbox.fly.dev/health` | ops | Liveness probe + active session count |
| `https://mina-mcp-sandbox.fly.dev:8080/` | humans | Lightweight Mina Explorer UI |
| `https://mina-mcp-sandbox.fly.dev:8080/graphql` | humans | GraphQL playground (CORS-enabled NGINX proxy) |

Rename the app to your own subdomain with `flyctl apps rename` or attach a custom domain via `flyctl certs add mcp.your-domain.com` (CNAME the domain to `mina-mcp-sandbox.fly.dev`).

### Connecting an MCP client to the hosted server

Claude Desktop / Claude Code config (`.mcp.json`):

```json
{
  "mcpServers": {
    "mina": {
      "url": "https://mina-mcp-sandbox.fly.dev/mcp"
    }
  }
}
```

The first session call returns a `Mcp-Session-Id` header that the client must echo on every subsequent request. When the session disconnects, every test account it acquired via `faucet` is automatically released.

### Operational notes

- `auto_stop_machines = "stop"` + `min_machines_running = 0` lets the machine scale to zero when idle. First request after idle pays a ~60–120s cold-start while the lightnet syncs.
- The chain-reset janitor (planned) reads `provider.resetController.isFrozen()`; admins / demo presenters can pause it via the `freeze_reset` MCP tool.
- See `deploy/start.sh` for the in-container boot order: lightnet first, MCP server last.

## Roadmap

Tracked in [GitHub issues](https://github.com/MinaProtocol/mina-mcp-server/issues). Highlights:

- **Bundled SQLite snapshot** ([#28](https://github.com/MinaProtocol/mina-mcp-server/issues/28)) — ship a SQLite archive snapshot inside the package so `npx @o1-labs/mina-mcp-server --mode snapshot` runs with zero infra, the same zero-setup story live mode already has.
- **Rosetta Construction API** — the offline signing flow (derive → preprocess → metadata → payloads → sign → combine → submit). The read-only Rosetta Data API tools already ship today.

Shipped recently: live mode against public networks (devnet / mainnet / mesa), a hosted [Fly.io sandbox](#deploying-on-flyio), live-write mode (in-process signing), and adoption of the published `@o1-labs/mina-*` SDKs as the transport layer. Tutorial mode stays infrastructure-dependent (local lightnet) by design — it's for development against a controllable network.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, testing, and PR conventions. Found a vulnerability? See [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE)
