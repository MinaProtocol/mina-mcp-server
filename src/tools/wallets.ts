import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AnyProvider, Mode } from "../server-factory.js";
import { LiveWriteProvider } from "../providers/live-write.js";

// Registered only in live mode AND only when the active provider is a
// LiveWriteProvider (i.e. wallets were configured). The check happens at
// registration time via getProvider() so the tool never appears in
// tools/list for read-only live mode.

export function registerWalletTools(
  server: McpServer,
  getProvider: () => AnyProvider,
  mode: Mode
) {
  if (mode !== "live") return;
  const provider = getProvider();
  if (!(provider instanceof LiveWriteProvider)) return;

  server.tool(
    "list_wallets",
    "[business] List wallets loaded for live-write mode: alias, publicKey, current balance, and nonce. Never returns private keys.",
    {},
    async () => {
      const summaries = await provider.listWallets();
      return { content: [{ type: "text", text: JSON.stringify(summaries, null, 2) }] };
    }
  );
}
