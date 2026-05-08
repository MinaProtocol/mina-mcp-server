import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SnapshotProvider } from "../providers/snapshot.js";
import { TutorialProvider } from "../providers/tutorial.js";
import { STDIO_SESSION_ID } from "../session/tracker.js";

export function registerTestAccountTools(
  server: McpServer,
  getProvider: () => SnapshotProvider | TutorialProvider
) {
  server.tool(
    "faucet",
    "[infra] Get a ready-to-use funded test account (tutorial mode only). Acquires a pre-funded account (1550 MINA), imports its key into the daemon, and unlocks it for signing. The account is reserved until you call return_account or reset_session, or until your session disconnects.",
    {
      isRegularAccount: z.boolean().default(true).describe("true for regular account, false for zkApp account"),
    },
    async ({ isRegularAccount }, extra) => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider) || !provider.accountsManager) {
        return { content: [{ type: "text", text: "This tool requires tutorial mode with Accounts Manager." }] };
      }

      try {
        const account = await provider.accountsManager.acquireAccount({
          isRegularAccount,
          unlockAccount: true,
        });

        provider.tracker?.trackAcquire(extra.sessionId ?? STDIO_SESSION_ID, account);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              publicKey: account.pk,
              secretKey: account.sk,
              balance: "1550000000000",
              balanceMina: "1550",
              status: "ready",
              note: "Account is imported, unlocked, and ready for send_payment / send_delegation. Call return_account(pk, sk) when done, or rely on session-end auto-release.",
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
    async ({ pk, sk }, extra) => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider) || !provider.accountsManager) {
        return { content: [{ type: "text", text: "This tool requires tutorial mode with Accounts Manager." }] };
      }
      try {
        await provider.accountsManager.releaseAccount({ pk, sk });
        provider.tracker?.trackRelease(extra.sessionId ?? STDIO_SESSION_ID, pk);
        return { content: [{ type: "text", text: `Account ${pk} returned to pool.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }] };
      }
    }
  );

  server.tool(
    "reset_session",
    "[infra] Release every test account currently held by this session back to the pool. Useful when you want to start fresh without disconnecting.",
    {},
    async (_args, extra) => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider) || !provider.accountsManager || !provider.tracker) {
        return { content: [{ type: "text", text: "This tool requires tutorial mode with Accounts Manager." }] };
      }
      const sessionId = extra.sessionId ?? STDIO_SESSION_ID;
      const result = await provider.tracker.releaseSession(sessionId);
      const summary = result.errors.length === 0
        ? `Released ${result.released} accounts.`
        : `Released ${result.released} accounts; ${result.errors.length} failed: ${result.errors.join("; ")}`;
      return { content: [{ type: "text", text: summary }] };
    }
  );
}
