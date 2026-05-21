# mina-mcp-server

MCP (Model Context Protocol) server for the [Mina Protocol](https://minaprotocol.com/) blockchain. Exposes Mina blockchain data and operations through MCP-compatible tools that can be used by AI assistants and other MCP clients.

> **Status: beta / preview.** **Live mode** talks to public Mina networks (devnet / mainnet / mesa) and needs **no local infrastructure** — run `npx @o1-labs/mina-mcp-server --mode live --network devnet`, or point your client at the [hosted sandbox](#deploying-on-flyio). **Snapshot** and **tutorial** modes are thin MCP layers over backing services (PostgreSQL, and for tutorial a local Mina lightnet) that you must stand up yourself first — see [Prerequisites](#prerequisites). A bundled SQLite snapshot for zero-infra *snapshot* mode is planned ([#28](https://github.com/MinaProtocol/mina-mcp-server/issues/28)).

## Features

- **24+ MCP tools** for querying accounts, blocks, transactions, zkApp events/actions, network status, and more
- **Two operating modes:**
  - **Snapshot** — **schema explorer only**: SQL access (`query_archive_sql`, `get_archive_schema`) + DB connectivity probe. Read-only against a frozen archive Postgres dump. Useful for ad-hoc analytics over historical chain data.
  - **Tutorial** — full read/write access to a live Mina lightnet (daemon, archive, test accounts)
  - **Live** — read-only proxy to a public Mina network (devnet/mainnet/mesa); no local infra
- **Safe SQL access** — read-only queries against the archive database with timeout protection
- **Test account faucet** — acquire/release pre-funded accounts for testing (tutorial mode)

## Prerequisites

**Common (all modes):**

- Node.js >= 18
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

When a `LiveProvider` is constructed against a preflight network, the server emits a `[WARN] Network '<name>' is a PREFLIGHT network…` line at startup and prepends a `PREFLIGHT` hint to `describe_state`'s `hints[]` — so any LLM consuming the output sees the caveat before reasoning about the data. If you build downstream automation against a preflight network, treat any data you gather as ephemeral and have a fallback to a stable network.

### Rosetta Data API (live mode)

When a live-mode network has a Rosetta endpoint configured (all three public networks do today), the server registers five Rosetta Data API tools alongside the daemon/archive ones. These return responses in **standardized Rosetta format** — useful for LLMs and integrations that already speak Rosetta:

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

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

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
    archive-api.test.ts
    archive-db.test.ts
    graphql-client.test.ts
    snapshot-provider.test.ts
    tutorial-provider.test.ts
  mcp/                     # MCP protocol tests - InMemoryTransport + Client
    helpers.ts             # Shared setup: mock providers, transport wiring
    snapshot.test.ts       # Snapshot mode: all tools, guards, responses
    tutorial.test.ts       # Tutorial mode: live tools, zkApp, faucet
  integration/             # Integration tests - requires live lightnet
    lightnet.test.ts
```

The **MCP tests** use `@modelcontextprotocol/sdk`'s `InMemoryTransport` to create a linked client-server pair in-process. This tests the full MCP protocol layer (tool registration, schema validation, request/response) without needing any network or database.

### Project Structure

```
src/
  index.ts                 # Entry point - server setup and transport
  db/archive.ts            # PostgreSQL archive database client
  graphql/
    client.ts              # Generic GraphQL client
    queries.ts             # Daemon GraphQL query definitions
    archive-api.ts         # Archive-Node-API client (events, actions, blocks)
    accounts-manager.ts    # Test accounts REST API client
  providers/
    snapshot.ts            # Read-only provider (archive DB only)
    tutorial.ts            # Live provider (daemon + archive + accounts)
  tools/
    accounts.ts            # Account tools (get_account, get_staking_ledger, etc.)
    blocks.ts              # Block tools (get_block, list_blocks, get_best_chain)
    transactions.ts        # Transaction tools (send_payment, search, mempool)
    network.ts             # Network tools (sync status, genesis constants)
    schema.ts              # Schema tools (SQL queries, schema inspection)
    zkapps.ts              # zkApp tools (events, actions, archive blocks)
    test-accounts.ts       # Faucet tools (acquire/release test accounts)
  snapshots/capture.ts     # Utility to capture archive DB snapshots
```

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

## Using with Claude Desktop / Claude Code

Once the backing infrastructure is up (see [Prerequisites](#prerequisites)), register the MCP server with your MCP client. Example for Claude Desktop (`claude_desktop_config.json`) or Claude Code (`.mcp.json`):

```json
{
  "mcpServers": {
    "mina": {
      "command": "npx",
      "args": ["-y", "@o1-labs/mina-mcp-server", "--mode", "snapshot"]
    }
  }
}
```

For tutorial mode, replace `snapshot` with `tutorial` and make sure the lightnet is running first.

**The MCP server will not start the infrastructure for you.** If Postgres / daemon / archive-node-api / accounts-manager are not reachable, tools will return connection errors.

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
