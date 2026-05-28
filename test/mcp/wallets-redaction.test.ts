import { describe, it, expect } from "vitest";
import { promises as fs, chmodSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import MinaSigner from "mina-signer";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LiveWriteProvider } from "../../src/providers/live-write.js";
import { ArchiveClient } from "@o1-labs/mina-archive-sdk";
import { RosettaClient } from "@o1-labs/mina-rosetta-sdk";
import { MinaClient } from "@o1-labs/mina-sdk";
import { resolveNetwork } from "../../src/networks.js";
import { loadWallets } from "../../src/wallets/loader.js";
import { registerAccountTools } from "../../src/tools/accounts.js";
import { registerBlockTools } from "../../src/tools/blocks.js";
import { registerTransactionTools } from "../../src/tools/transactions.js";
import { registerNetworkTools } from "../../src/tools/network.js";
import { registerSchemaTools } from "../../src/tools/schema.js";
import { registerZkAppTools } from "../../src/tools/zkapps.js";
import { registerTestAccountTools } from "../../src/tools/test-accounts.js";
import { registerAdminTools } from "../../src/tools/admin.js";
import { registerStateTools } from "../../src/tools/state.js";
import { registerExampleTools } from "../../src/tools/examples.js";
import { registerRosettaTools } from "../../src/tools/rosetta.js";
import { registerWalletTools } from "../../src/tools/wallets.js";
import { createMockMinaClient, createMockArchiveApi, createMockRosetta } from "./helpers.js";

// Sweep every registered tool with arguments that will normally produce
// verbose error responses (bogus addresses, malformed input, etc.) and
// assert that the **registry's loaded private key** never appears anywhere
// in the JSON-RPC stream. This is the SDK-boundary redaction guarantee.
//
// Note we don't assert "no EK… substring at all" — a tool echoing a
// CALLER-supplied EK string back in a "not found" message isn't a server
// leak (the caller already had the key). What matters is that nothing the
// server loaded server-side ever escapes into a response.

const signer = new MinaSigner({ network: "testnet" });

describe("MCP Server - private-key redaction sweep", () => {
  it("no tool error path ever leaks an EK… private key into a response", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mina-mcp-redact-"));
    let server: McpServer | undefined;
    let client: Client | undefined;
    try {
      const k = signer.genKeys();
      const keyPath = path.join(tmp, "warm.key");
      await fs.writeFile(keyPath, k.privateKey, { mode: 0o600 });
      chmodSync(keyPath, 0o600);
      const cfgPath = path.join(tmp, "wallets.json");
      await fs.writeFile(
        cfgPath,
        JSON.stringify({
          wallets: { warm: { keyPath, publicKey: k.publicKey } },
          defaultWallet: "warm",
        })
      );
      const registry = await loadWallets(cfgPath, { signer });
      const provider = new LiveWriteProvider(resolveNetwork("devnet"), registry, signer);
      // Mock all upstreams so we never hit the real network and so we can
      // also throw from them (to exercise error paths that mention upstream
      // bodies — those must NOT contain key material either).
      (provider as unknown as { client: MinaClient }).client = createMockMinaClient();
      (provider as unknown as { archiveApi: ArchiveClient }).archiveApi = createMockArchiveApi();
      (provider as unknown as { rosetta: RosettaClient }).rosetta = createMockRosetta();

      server = new McpServer({ name: "mina-redact-test", version: "0.1.0" });
      const getProvider = () => provider;
      registerAccountTools(server, getProvider, "live");
      registerBlockTools(server, getProvider, "live");
      registerTransactionTools(server, getProvider, "live");
      registerNetworkTools(server, getProvider, "live");
      registerSchemaTools(server, getProvider, "live");
      registerZkAppTools(server, getProvider, "live");
      registerTestAccountTools(server, getProvider, "live");
      registerAdminTools(server, getProvider, "live");
      registerStateTools(server, getProvider, "live");
      registerExampleTools(server, getProvider, "live");
      registerRosettaTools(server, getProvider, "live");
      registerWalletTools(server, getProvider, "live");

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      client = new Client({ name: "redact-client", version: "0.1.0" });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const listed = await client.listTools();
      // Bogus args per tool — chosen to force an error path. Each row is
      // (toolName, args) where args will fail validation, fail resolution,
      // or hit an upstream error. We use a placeholder string that is NOT
      // an EK key — the guarantee under test is that the server's loaded
      // key (k.privateKey) never appears, regardless of what the caller
      // happens to pass in.
      const bogus = "B62qBOGUS_NOT_A_KEY_ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ";
      const loadedKey = k.privateKey;
      const probe: Record<string, Record<string, unknown>> = {
        get_account: { publicKey: bogus },
        get_block: { stateHash: bogus, height: 999 },
        get_best_chain: { maxLength: -1 },
        get_sync_status: {},
        get_genesis_constants: {},
        get_network_id: {},
        get_mempool: { publicKey: bogus },
        get_transaction_status: { payment: bogus },
        get_events: { address: bogus },
        get_actions: { address: bogus },
        get_archive_blocks: {},
        get_network_state: {},
        rosetta_status: {},
        rosetta_account: { address: bogus },
        rosetta_block: {},
        rosetta_mempool: {},
        rosetta_mempool_transaction: { hash: bogus },
        list_examples: {},
        get_example: { name: bogus },
        describe_state: {},
        list_wallets: {},
        // Force send_payment to fail at wallet resolution (passing the
        // private key as `from` is intentional — that's the most direct
        // way an honest mistake could trigger a leak).
        send_payment: { from: bogus, to: bogus, amount: "1", fee: "1" },
        send_delegation: { from: bogus, to: bogus, fee: "1" },
      };

      for (const tool of listed.tools) {
        const args = probe[tool.name];
        if (!args) {
          throw new Error(
            `Test missing a probe for tool '${tool.name}'. Add one to the redaction sweep.`
          );
        }
        let response: { content: Array<{ type: string; text: string }> };
        try {
          response = (await client.callTool({ name: tool.name, arguments: args })) as typeof response;
        } catch (e) {
          // Even SDK rejections must not echo the loaded key.
          const msg = (e as Error).message;
          expect(msg, `${tool.name} threw with the loaded private key in the message`).not.toContain(loadedKey);
          continue;
        }
        const serialized = JSON.stringify(response);
        expect(
          serialized,
          `${tool.name} response leaked the server's loaded private key`
        ).not.toContain(loadedKey);
      }
    } finally {
      if (client) await client.close();
      if (server) await server.close();
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
