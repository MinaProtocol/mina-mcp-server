import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AnyProvider, Mode } from "../server-factory.js";
import { TutorialProvider } from "../providers/tutorial.js";

const TUTORIAL_ONLY_MSG = "This tool requires tutorial mode.";

export function registerAdminTools(
  server: McpServer,
  getProvider: () => AnyProvider,
  mode: Mode
) {
  if (mode !== "tutorial") return;

  server.tool(
    "freeze_reset",
    "[admin] Pause the periodic chain-reset janitor for N minutes. Use before a human demo so the chain state stays stable; the freeze auto-expires after the duration. Pass 0 to clear the freeze.",
    {
      minutes: z.number().int().min(0).max(1440).default(60).describe("Minutes to freeze (0 = unfreeze, max 1440 = 24h)"),
    },
    async ({ minutes }) => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider) || !provider.resetController) {
        return { content: [{ type: "text", text: TUTORIAL_ONLY_MSG }] };
      }
      const status = provider.resetController.freeze(minutes * 60_000);
      return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
    }
  );

  server.tool(
    "unfreeze_reset",
    "[admin] Resume the periodic chain-reset janitor immediately, cancelling any active freeze.",
    {},
    async () => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider) || !provider.resetController) {
        return { content: [{ type: "text", text: TUTORIAL_ONLY_MSG }] };
      }
      const status = provider.resetController.unfreeze();
      return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
    }
  );

  server.tool(
    "freeze_status",
    "[admin] Show whether the chain-reset janitor is currently frozen and how much time remains.",
    {},
    async () => {
      const provider = getProvider();
      if (!(provider instanceof TutorialProvider) || !provider.resetController) {
        return { content: [{ type: "text", text: TUTORIAL_ONLY_MSG }] };
      }
      const status = provider.resetController.getStatus();
      return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
    }
  );
}
