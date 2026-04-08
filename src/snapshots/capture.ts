#!/usr/bin/env node

/**
 * Capture a snapshot from a running Mina network (devnet, testnet, or local).
 *
 * Usage:
 *   node dist/snapshots/capture.js \
 *     --db-host localhost --db-port 5432 --db-name archive \
 *     --graphql http://localhost:3085/graphql \
 *     --output ./snapshots/devnet-20260405
 *
 * This creates:
 *   <output>/archive-dump.sql   - Full PostgreSQL dump of the archive DB
 *   <output>/metadata.json      - Network metadata at capture time
 */

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { GraphQLClient } from "../graphql/client.js";

interface CaptureOptions {
  dbHost: string;
  dbPort: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  graphqlEndpoint?: string;
  outputDir: string;
}

function parseArgs(): CaptureOptions {
  const args = process.argv.slice(2);
  const opts: CaptureOptions = {
    dbHost: "localhost",
    dbPort: "5432",
    dbName: "archive",
    dbUser: "postgres",
    dbPassword: "postgres",
    outputDir: "./snapshots/capture",
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--db-host":
        opts.dbHost = args[++i];
        break;
      case "--db-port":
        opts.dbPort = args[++i];
        break;
      case "--db-name":
        opts.dbName = args[++i];
        break;
      case "--db-user":
        opts.dbUser = args[++i];
        break;
      case "--db-password":
        opts.dbPassword = args[++i];
        break;
      case "--graphql":
        opts.graphqlEndpoint = args[++i];
        break;
      case "--output":
        opts.outputDir = args[++i];
        break;
    }
  }

  return opts;
}

async function captureMetadata(graphqlEndpoint?: string) {
  const metadata: Record<string, unknown> = {
    capturedAt: new Date().toISOString(),
    tool: "mina-mcp-server/capture",
  };

  if (graphqlEndpoint) {
    const client = new GraphQLClient(graphqlEndpoint);
    try {
      const statusResult = await client.query<{
        daemonStatus: { blockchainLength: number; stateHash: string; chainId: string };
      }>("{ daemonStatus { blockchainLength stateHash chainId } }");
      if (statusResult.data) {
        metadata.daemonStatus = statusResult.data.daemonStatus;
      }

      const genesisResult = await client.query<{
        genesisConstants: Record<string, unknown>;
      }>("{ genesisConstants { genesisTimestamp coinbase accountCreationFee } }");
      if (genesisResult.data) {
        metadata.genesisConstants = genesisResult.data.genesisConstants;
      }

      const networkResult = await client.query<{ networkID: string }>("{ networkID }");
      if (networkResult.data) {
        metadata.networkID = networkResult.data.networkID;
      }
    } catch (e) {
      console.error(`Warning: Could not fetch live metadata: ${(e as Error).message}`);
      metadata.liveMetadataError = (e as Error).message;
    }
  }

  return metadata;
}

async function main() {
  const opts = parseArgs();

  console.log(`Capturing snapshot to ${opts.outputDir}`);
  mkdirSync(opts.outputDir, { recursive: true });

  // Dump the archive database
  console.log("Dumping archive database...");
  const pgDumpEnv = { ...process.env, PGPASSWORD: opts.dbPassword };
  try {
    execSync(
      `pg_dump -h ${opts.dbHost} -p ${opts.dbPort} -U ${opts.dbUser} -d ${opts.dbName} --no-owner --no-acl -f "${opts.outputDir}/archive-dump.sql"`,
      { env: pgDumpEnv, stdio: "inherit" }
    );
    console.log("Database dump complete.");
  } catch (e) {
    console.error(`pg_dump failed: ${(e as Error).message}`);
    console.error("Make sure pg_dump is installed and the database is accessible.");
    process.exit(1);
  }

  // Capture metadata from live daemon if available
  console.log("Capturing metadata...");
  const metadata = await captureMetadata(opts.graphqlEndpoint);
  writeFileSync(`${opts.outputDir}/metadata.json`, JSON.stringify(metadata, null, 2));
  console.log("Metadata captured.");

  console.log(`\nSnapshot saved to: ${opts.outputDir}`);
  console.log("Files:");
  console.log(`  ${opts.outputDir}/archive-dump.sql`);
  console.log(`  ${opts.outputDir}/metadata.json`);
  console.log("\nTo use with snapshot mode:");
  console.log(`  1. docker compose -f docker-compose.snapshot.yml up -d`);
  console.log(`     (set SNAPSHOT_DIR=${opts.outputDir})`);
  console.log(`  2. MINA_MCP_MODE=snapshot node dist/index.js`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
