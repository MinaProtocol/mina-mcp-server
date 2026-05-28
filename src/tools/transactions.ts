import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AnyProvider, Mode } from "../server-factory.js";
import { TutorialProvider } from "../providers/tutorial.js";
import { LiveWriteProvider } from "../providers/live-write.js";

export function registerTransactionTools(
  server: McpServer,
  getProvider: () => AnyProvider,
  mode: Mode
) {
  if (mode === "tutorial") {
    server.tool(
      "get_transaction",
      "Look up a transaction by its hash in the archive database.",
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
      "Search user commands in the archive database by sender, receiver, and/or amount range.",
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
  }

  // send_payment / send_delegation register when *either*:
  //   - mode is "tutorial" (daemon holds keys and signs server-side), OR
  //   - mode is "live" AND a LiveWriteProvider was constructed (we hold
  //     plaintext keys and sign client-side via mina-signer).
  // In live mode without wallets the tools are not registered at all.
  const isLiveWrite = mode === "live" && getProvider() instanceof LiveWriteProvider;

  if (mode === "tutorial" || isLiveWrite) {
    server.tool(
      "send_payment",
      isLiveWrite
        ? "Send a MINA payment from a loaded wallet (live-write mode). Signs client-side with mina-signer and submits via the daemon. Use `list_wallets` to see configured aliases. Pass `dry_run: true` to inspect the signed payload without submitting."
        : "Send a MINA payment between accounts (tutorial mode). Uses the daemon's wallet to sign.",
      {
        from: z.string().optional().describe("Sender public key. In tutorial mode this must be a daemon-tracked key; in live-write mode it's resolved against the loaded wallets. Either this or from_alias is required (unless a defaultWallet is configured)."),
        from_alias: z.string().optional().describe("[live-write] Wallet alias from wallets.json (e.g. 'warm', 'demo'). Mutually exclusive with passing a different `from`."),
        to: z.string().describe("Receiver public key"),
        amount: z.string().describe("Amount in nanomina (1 MINA = 1000000000 nanomina)"),
        fee: z.string().default("100000000").describe("Fee in nanomina (default: 0.1 MINA)"),
        memo: z.string().optional().describe("Transaction memo"),
        dry_run: z.boolean().default(false).describe("[live-write] If true, returns the signed payload without submitting."),
      },
      async (args) => {
        const provider = getProvider();
        // Live-write path: client-signed.
        if (provider instanceof LiveWriteProvider) {
          const { wallet, error } = provider.resolveWallet({
            alias: args.from_alias,
            publicKey: args.from,
          });
          if (!wallet) {
            return { content: [{ type: "text", text: error ?? "Could not resolve wallet." }] };
          }
          try {
            const result = await provider.sendSignedPayment({
              wallet,
              payment: { to: args.to, amount: args.amount, fee: args.fee, memo: args.memo },
              dryRun: args.dry_run,
            });
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          } catch (e) {
            return {
              content: [{ type: "text", text: `Payment failed: ${(e as Error).message}` }],
            };
          }
        }
        // Tutorial path: daemon-signed.
        if (!(provider instanceof TutorialProvider)) {
          return {
            content: [{ type: "text", text: "This tool is only available in tutorial mode or live-write mode." }],
          };
        }
        if (!args.from) {
          return { content: [{ type: "text", text: "tutorial mode: 'from' is required." }] };
        }
        try {
          const result = await provider.sendPayment({
            from: args.from,
            to: args.to,
            amount: args.amount,
            fee: args.fee,
            memo: args.memo,
          });
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
      isLiveWrite
        ? "Delegate stake from a loaded wallet to a block producer (live-write mode). Signs client-side, submits via the daemon. Pass `dry_run: true` to inspect without submitting."
        : "Delegate stake to a block producer (tutorial mode).",
      {
        from: z.string().optional().describe("Delegator public key (tutorial: must be daemon-tracked; live-write: resolved against loaded wallets)."),
        from_alias: z.string().optional().describe("[live-write] Wallet alias from wallets.json."),
        to: z.string().describe("Block producer public key to delegate to"),
        fee: z.string().default("100000000").describe("Fee in nanomina (default: 0.1 MINA)"),
        memo: z.string().optional().describe("Transaction memo"),
        dry_run: z.boolean().default(false).describe("[live-write] If true, returns the signed payload without submitting."),
      },
      async (args) => {
        const provider = getProvider();
        if (provider instanceof LiveWriteProvider) {
          const { wallet, error } = provider.resolveWallet({
            alias: args.from_alias,
            publicKey: args.from,
          });
          if (!wallet) {
            return { content: [{ type: "text", text: error ?? "Could not resolve wallet." }] };
          }
          try {
            const result = await provider.sendSignedDelegation({
              wallet,
              delegation: { to: args.to, fee: args.fee, memo: args.memo },
              dryRun: args.dry_run,
            });
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          } catch (e) {
            return {
              content: [{ type: "text", text: `Delegation failed: ${(e as Error).message}` }],
            };
          }
        }
        if (!(provider instanceof TutorialProvider)) {
          return {
            content: [{ type: "text", text: "This tool is only available in tutorial mode or live-write mode." }],
          };
        }
        if (!args.from) {
          return { content: [{ type: "text", text: "tutorial mode: 'from' is required." }] };
        }
        try {
          const result = await provider.sendDelegation({
            from: args.from,
            to: args.to,
            fee: args.fee,
            memo: args.memo,
          });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return {
            content: [{ type: "text", text: `Delegation failed: ${(e as Error).message}` }],
          };
        }
      }
    );
  }

  if (mode !== "snapshot") {
    server.tool(
      "get_transaction_status",
      "Check the daemon's status for a submitted transaction (PENDING / INCLUDED / " +
        "UNKNOWN). Pass the id returned by send_payment as `payment` (or a zkApp tx id " +
        "as `zkappTransaction`) — exactly one. Use this to poll after a send; for an " +
        "already-mined tx, prefer get_transaction / search_transactions against the archive.",
      {
        payment: z.string().optional().describe("Payment transaction ID"),
        zkappTransaction: z.string().optional().describe("zkApp transaction ID"),
      },
      async ({ payment, zkappTransaction }) => {
        const provider = getProvider();
        if (!(provider instanceof TutorialProvider)) {
          return {
            content: [{ type: "text", text: "This tool requires a live daemon connection." }],
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
      "List transactions currently pending in the daemon's mempool (not yet in a block), " +
        "optionally filtered by `publicKey`. Each entry has top-level `from`/`to` (B62q… " +
        "pubkeys) plus `amount`/`fee`/`nonce`/`hash`/`kind`/`memo`/`failureReason`. " +
        "Empty once everything has been included — does not show mined txs.",
      {
        publicKey: z.string().optional().describe("Filter by public key"),
      },
      async ({ publicKey }) => {
        const provider = getProvider();
        if (!(provider instanceof TutorialProvider)) {
          return {
            content: [{ type: "text", text: "This tool requires a live daemon connection." }],
          };
        }
        const result = await provider.getMempool(publicKey);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
    );
  }
}
