import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SnapshotProvider } from "../providers/snapshot.js";
import { TutorialProvider } from "../providers/tutorial.js";

export function registerTestAccountTools(
  server: McpServer,
  getProvider: () => SnapshotProvider | TutorialProvider
) {
  server.tool(
    "faucet",
    "[infra] Get a ready-to-use funded test account (tutorial mode only). Acquires a pre-funded account (1550 MINA), imports its key into the daemon, and unlocks it for signing. The account is reserved until you call return_account.",
    {
      isRegularAccount: z.boolean().default(true).describe("true for regular account, false for zkApp account"),
    },
    async ({ isRegularAccount }) => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider) || !provider.accountsManager) {
        return { content: [{ type: "text", text: "This tool requires tutorial mode with Accounts Manager." }] };
      }

      try {
        // Acquire account with unlock — the Accounts Manager handles
        // importing the key file and unlocking it inside the container.
        const account = await provider.accountsManager.acquireAccount({
          isRegularAccount,
          unlockAccount: true,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              publicKey: account.pk,
              secretKey: account.sk,
              balance: "1550000000000",
              balanceMina: "1550",
              status: "ready",
              note: "Account is imported, unlocked, and ready for send_payment / send_delegation. Call return_account(pk, sk) when done.",
            }, null, 2),
          }],
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Faucet error: ${(e as Error).message}` }] };
      }
    }
  );

  server.tool(
    "return_account",
    "[infra] Release a test account back to the pool (tutorial mode only). Call this when you're done with an account obtained from faucet.",
    {
      pk: z.string().describe("Public key of the account to release"),
      sk: z.string().describe("Secret key of the account to release"),
    },
    async ({ pk, sk }) => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider) || !provider.accountsManager) {
        return { content: [{ type: "text", text: "This tool requires tutorial mode with Accounts Manager." }] };
      }
      try {
        await provider.accountsManager.releaseAccount({ pk, sk });
        return { content: [{ type: "text", text: `Account ${pk} returned to pool.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }] };
      }
    }
  );
}
