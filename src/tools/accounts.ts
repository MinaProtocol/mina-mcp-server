import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SnapshotProvider } from "../providers/snapshot.js";
import { TutorialProvider } from "../providers/tutorial.js";

export function registerAccountTools(
  server: McpServer,
  getProvider: () => SnapshotProvider | TutorialProvider
) {
  server.tool(
    "get_account",
    "[business] Get account information by public key. In tutorial mode, returns live state from the daemon. In snapshot mode, returns data from the archive database.",
    { publicKey: z.string().describe("Mina public key (B62...)"), token: z.string().optional().describe("Token ID (optional, defaults to MINA)") },
    async ({ publicKey, token }) => {
      const provider = getProvider();
      let result: unknown;

      if (provider instanceof TutorialProvider) {
        result = await provider.getAccountLive(publicKey, token);
      } else {
        result = await provider.getAccount(publicKey);
      }

      if (!result || (Array.isArray(result) && result.length === 0)) {
        return { content: [{ type: "text", text: `Account not found: ${publicKey}` }] };
      }

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "get_staking_ledger",
    "[business] Get staking ledger entries from the archive database. Returns up to 100 accounts with their staking info.",
    { epoch: z.number().optional().describe("Epoch number (optional)") },
    async ({ epoch }) => {
      const provider = getProvider();
      const result = await provider.getStakingLedger(epoch);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "get_tracked_accounts",
    "[infra] List all accounts tracked by the daemon wallet (tutorial mode only). These are the pre-funded test accounts available for transactions.",
    {},
    async () => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider)) {
        return {
          content: [{ type: "text", text: "This tool is only available in tutorial mode." }],
        };
      }
      const result = await provider.getTrackedAccounts();
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
