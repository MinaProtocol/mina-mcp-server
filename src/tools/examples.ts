import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SnapshotProvider } from "../providers/snapshot.js";
import { TutorialProvider } from "../providers/tutorial.js";
import { EXAMPLES, getExample, listExamples } from "../examples/library.js";

export function registerExampleTools(
  server: McpServer,
  getProvider: () => SnapshotProvider | TutorialProvider
) {
  server.tool(
    "list_examples",
    "[infra] List curated example workflows (each is a sequence of tool calls). Filter by the current server mode by default; pass `all` to see every workflow regardless of mode.",
    {
      include: z.enum(["current", "all"]).default("current").describe("'current' filters to workflows runnable in this server's mode; 'all' shows every workflow."),
    },
    async ({ include }) => {
      const provider = getProvider();
      const mode = provider instanceof TutorialProvider ? "tutorial" : "snapshot";
      const items = include === "all"
        ? EXAMPLES.map((e) => ({ name: e.name, summary: e.summary, mode: e.mode }))
        : listExamples(mode);
      return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
    }
  );

  server.tool(
    "get_example",
    "[infra] Get the full step list for a single named example workflow. Use list_examples first to discover names.",
    {
      name: z.string().describe("Example name from list_examples (e.g. 'send_payment', 'verify_in_archive')."),
    },
    async ({ name }) => {
      const example = getExample(name);
      if (!example) {
        const known = EXAMPLES.map((e) => e.name).join(", ");
        return { content: [{ type: "text", text: `Unknown example '${name}'. Known: ${known}` }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(example, null, 2) }] };
    }
  );
}
