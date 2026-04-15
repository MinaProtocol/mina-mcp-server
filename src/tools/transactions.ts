import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SnapshotProvider } from "../providers/snapshot.js";
import { TutorialProvider } from "../providers/tutorial.js";

export function registerTransactionTools(
  server: McpServer,
  getProvider: () => SnapshotProvider | TutorialProvider
) {
  server.tool(
    "get_transaction",
    "[business] Look up a transaction by its hash in the archive database.",
    { hash: z.string().describe("Transaction hash") },
    async ({ hash }) => {
      const provider = getProvider();
      const result = await provider.getTransaction(hash);
      if (!result) {
        return { content: [{ type: "text", text: `Transaction not found: ${hash}` }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "search_transactions",
    "[business] Search user commands in the archive database by sender, receiver, and/or amount range.",
    {
      sender: z.string().optional().describe("Sender public key"),
      receiver: z.string().optional().describe("Receiver public key"),
      minAmount: z.string().optional().describe("Minimum amount in nanomina"),
      maxAmount: z.string().optional().describe("Maximum amount in nanomina"),
      limit: z.number().min(1).max(100).default(20).describe("Number of results (max 100)"),
      offset: z.number().min(0).default(0).describe("Offset for pagination"),
    },
    async (args) => {
      const provider = getProvider();
      const result = await provider.searchTransactions(args);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "send_payment",
    "[business] Send a MINA payment between accounts (tutorial mode only). Uses the daemon's wallet to sign.",
    {
      from: z.string().describe("Sender public key (must be tracked by daemon)"),
      to: z.string().describe("Receiver public key"),
      amount: z.string().describe("Amount in nanomina (1 MINA = 1000000000 nanomina)"),
      fee: z.string().default("100000000").describe("Fee in nanomina (default: 0.1 MINA)"),
      memo: z.string().optional().describe("Transaction memo"),
    },
    async (args) => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider)) {
        return {
          content: [{ type: "text", text: "This tool is only available in tutorial mode." }],
        };
      }
      try {
        const result = await provider.sendPayment(args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Payment failed: ${(e as Error).message}` }],
        };
      }
    }
  );

  server.tool(
    "send_delegation",
    "[business] Delegate stake to a block producer (tutorial mode only).",
    {
      from: z.string().describe("Delegator public key (must be tracked by daemon)"),
      to: z.string().describe("Block producer public key to delegate to"),
      fee: z.string().default("100000000").describe("Fee in nanomina (default: 0.1 MINA)"),
      memo: z.string().optional().describe("Transaction memo"),
    },
    async (args) => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider)) {
        return {
          content: [{ type: "text", text: "This tool is only available in tutorial mode." }],
        };
      }
      try {
        const result = await provider.sendDelegation(args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Delegation failed: ${(e as Error).message}` }],
        };
      }
    }
  );

  server.tool(
    "get_transaction_status",
    "[business] Check the status of a pending transaction (tutorial mode only).",
    {
      payment: z.string().optional().describe("Payment transaction ID"),
      zkappTransaction: z.string().optional().describe("zkApp transaction ID"),
    },
    async ({ payment, zkappTransaction }) => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider)) {
        return {
          content: [{ type: "text", text: "This tool is only available in tutorial mode." }],
        };
      }
      try {
        const result = await provider.getTransactionStatus(payment, zkappTransaction);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Transaction status error: ${(e as Error).message}` }],
        };
      }
    }
  );

  server.tool(
    "get_mempool",
    "[business] View pending transactions in the mempool (tutorial mode only).",
    {
      publicKey: z.string().optional().describe("Filter by public key"),
    },
    async ({ publicKey }) => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider)) {
        return {
          content: [{ type: "text", text: "This tool is only available in tutorial mode." }],
        };
      }
      const result = await provider.getMempool(publicKey);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
