// End-to-end demo of the trustless-verification tools.
//
//   1. verify_chain_tip       — prove the live devnet tip is cryptographically valid
//   2. check_endpoint_honesty — catch a DISHONEST endpoint that lies about chain state
//
// Both go through the real MCP server + tools (over an in-memory transport), exactly
// as an MCP client/agent would call them. Requires the optional `mina-verify-wasm`
// package installed (see demo/README.md).  Run: `npm run demo:honesty`
//
// Note: each verification runs a real Pickles/kimchi SNARK proof check (~tens of
// seconds, single-threaded). The waiting is the point — it's verifying, not trusting.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "../src/server-factory.js";
import { LiveProvider } from "../src/providers/live.js";
import { NETWORKS, NetworkConfig } from "../src/networks.js";
import { startTamperingProxy } from "./tampering-proxy.mjs";

function banner(n: number, title: string) {
  console.log(`\n${"━".repeat(72)}\n  ${n}. ${title}\n${"━".repeat(72)}`);
}

async function mcpClientFor(cfg: NetworkConfig): Promise<Client> {
  const server = buildMcpServer(new LiveProvider(cfg), "live");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "honesty-demo", version: "0.0.1" }, { capabilities: {} });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

async function callTool(client: Client, name: string): Promise<string> {
  const t = Date.now();
  process.stdout.write(`  → calling ${name} (verifying a real SNARK proof, ~tens of seconds)…\n`);
  const res = await client.callTool({ name, arguments: {} });
  const text = (res.content as Array<{ text: string }>)[0].text;
  console.log(`  ⏱  ${Math.round((Date.now() - t) / 1000)}s\n`);
  return text;
}

async function main() {
  console.log(
    "\nTRUSTLESS CHAIN VERIFICATION — Mina light-client proofs, from an MCP tool.\n" +
      "A verifying block's SNARK attests the whole chain to genesis; no data source is trusted.",
  );

  // 1. The honest, real devnet daemon: prove the tip is valid.
  banner(1, "Verify the live devnet chain tip is cryptographically valid");
  const honest = await mcpClientFor(NETWORKS.devnet);
  console.log(await callTool(honest, "verify_chain_tip"));

  // 2. The honest daemon again: its claims should MATCH the proof → HONEST.
  banner(2, "Check an HONEST endpoint (the real devnet daemon) → expect HONEST");
  console.log(await callTool(honest, "check_endpoint_honesty"));

  // 3. A dishonest endpoint: same daemon, but a proxy that lies about the ledger hash.
  banner(3, "Catch a DISHONEST endpoint (proxy that lies about the staged-ledger hash)");
  const proxy = await startTamperingProxy(NETWORKS.devnet.daemonGraphql);
  console.log(`  (started a tampering proxy at ${proxy.url} — forwards to devnet, lies about stagedLedgerHash)\n`);
  const tamperedCfg: NetworkConfig = { ...NETWORKS.devnet, daemonGraphql: proxy.url };
  const evil = await mcpClientFor(tamperedCfg);
  console.log(await callTool(evil, "check_endpoint_honesty"));
  await proxy.close();

  console.log(
    `${"━".repeat(72)}\n` +
      "  The agent verified a real chain proof, then caught a lying endpoint —\n" +
      "  using only cryptography, with zero trust in the data source.\n" +
      `${"━".repeat(72)}\n`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("\nDemo failed:", e);
  process.exit(1);
});
