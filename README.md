# mina-mcp-server

MCP (Model Context Protocol) server for the [Mina Protocol](https://minaprotocol.com/) blockchain. Exposes Mina blockchain data and operations through MCP-compatible tools that can be used by AI assistants and other MCP clients.

## Features

- **24+ MCP tools** for querying accounts, blocks, transactions, zkApp events/actions, network status, and more
- **Two operating modes:**
  - **Snapshot** — read-only access to a frozen archive database (no live network required)
  - **Tutorial** — full read/write access to a live Mina lightnet (daemon, archive, test accounts)
- **Safe SQL access** — read-only queries against the archive database with timeout protection
- **Test account faucet** — acquire/release pre-funded accounts for testing (tutorial mode)

## Prerequisites

- Node.js >= 18
- Docker & Docker Compose (for running the database or lightnet)

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Start infrastructure (pick one):

# Option A: Snapshot mode (read-only, from local dump)
SNAPSHOT_DIR=./snapshots/devnet-latest docker compose -f docker-compose.snapshot.yml up -d

# Option B: Snapshot mode (download latest devnet dump)
docker compose -f docker-compose.snapshot.yml --profile download up -d

# Option C: Tutorial mode (full lightnet)
docker compose -f docker-compose.tutorial.yml up -d
# Wait ~1-2 min for the network to sync

# Run the MCP server
MINA_MCP_MODE=snapshot npm start    # or
MINA_MCP_MODE=tutorial npm start
```

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
```

Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MINA_MCP_MODE` | `snapshot` | Server mode: `snapshot` or `tutorial` |
| `ARCHIVE_DB_HOST` | `localhost` | Archive PostgreSQL host |
| `ARCHIVE_DB_PORT` | `5432` | Archive PostgreSQL port |
| `MINA_GRAPHQL_ENDPOINT` | `http://localhost:3085/graphql` | Mina daemon GraphQL (tutorial mode) |
| `ARCHIVE_API_ENDPOINT` | `http://localhost:8282` | Archive-Node-API GraphQL (tutorial mode) |
| `ACCOUNTS_MANAGER_ENDPOINT` | `http://localhost:8181` | Test accounts manager (tutorial mode) |

## MCP Tools

### Available in Both Modes

| Tool | Description |
|------|-------------|
| `get_account` | Get account info by public key |
| `get_block` | Get a block by state hash or height |
| `list_blocks` | List blocks with pagination and status filter |
| `get_transaction` | Look up a transaction by hash |
| `search_transactions` | Search transactions by sender/receiver/amount |
| `get_staking_ledger` | Get staking ledger entries |
| `get_sync_status` | Get daemon or archive status |
| `get_archive_stats` | Get archive database statistics |
| `query_archive_sql` | Execute read-only SQL against the archive DB |
| `get_archive_schema` | Inspect archive database schema |

### Tutorial Mode Only

| Tool | Description |
|------|-------------|
| `get_best_chain` | Get the current best chain from the live daemon |
| `send_payment` | Send a MINA payment |
| `send_delegation` | Delegate stake to a block producer |
| `get_transaction_status` | Check pending transaction status |
| `get_mempool` | View pending transactions in the mempool |
| `get_genesis_constants` | Get genesis constants (coinbase, fees) |
| `get_network_id` | Get the network identifier |
| `get_tracked_accounts` | List daemon-tracked wallet accounts |
| `get_events` | Get zkApp events via Archive-Node-API |
| `get_actions` | Get zkApp actions via Archive-Node-API |
| `get_archive_blocks` | Get blocks from Archive-Node-API |
| `get_network_state` | Get network state from Archive-Node-API |
| `faucet` | Acquire a pre-funded test account (1550 MINA) |
| `return_account` | Release a test account back to the pool |

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

## License

Apache-2.0
