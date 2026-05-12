import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AnyProvider, Mode } from "../server-factory.js";
import { TutorialProvider } from "../providers/tutorial.js";

export function registerAccountTools(
  server: McpServer,
  getProvider: () => AnyProvider,
  mode: Mode
) {
  if (mode !== "snapshot") {
    server.tool(
      "get_account",
      "[business] Get account information by public key from the live daemon (tutorial + live modes).",
      { publicKey: z.string().describe("Mina public key (B62...)"), token: z.string().optional().describe("Token ID (optional, defaults to MINA)") },
      async ({ publicKey, token }) => {
        const provider = getProvider();
        if (!(provider instanceof TutorialProvider)) {
          return { content: [{ type: "text", text: "This tool requires a live daemon connection." }] };
        }
        const result = await provider.getAccountLive(publicKey, token);
        if (!result || (Array.isArray(result) && result.length === 0)) {
          return { content: [{ type: "text", text: `Account not found: ${publicKey}` }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
    );
  }

  if (mode === "tutorial") {
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
  }

  if (mode === "tutorial") {
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
}
