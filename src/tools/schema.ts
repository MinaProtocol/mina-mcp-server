import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AnyProvider, Mode } from "../server-factory.js";

export function registerSchemaTools(
  server: McpServer,
  getProvider: () => AnyProvider,
  mode: Mode
) {
  if (mode === "live") return;

  server.tool(
    "query_archive_sql",
    "[infra][tutorial+snapshot] Execute a read-only SQL query against the archive database. Only SELECT/WITH/EXPLAIN statements are allowed. Query timeout is 10 seconds. Not available in live mode (no archive DB). Common tables: `blocks`, `user_commands`, `internal_commands`, `public_keys`, `accounts_accessed`. Call `get_archive_schema` first if you don't know the table layout.",
    {
      sql: z.string().describe("Read-only SQL (SELECT / WITH / EXPLAIN only). Example: SELECT state_hash, height FROM blocks WHERE chain_status = 'canonical' ORDER BY height DESC LIMIT 10"),
      params: z.array(z.union([z.string(), z.number()])).optional().describe("Parameterized values: $1, $2, ... in the SQL"),
    },
    async ({ sql, params }) => {
      const provider = getProvider();
      try {
        const result = await provider.rawQuery(sql, params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { rowCount: result.rowCount, rows: result.rows },
                null,
                2
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Query error: ${(e as Error).message}` }],
        };
      }
    }
  );

  server.tool(
    "get_archive_schema",
    "[infra] Get the archive database table names and their columns. Useful for understanding what data is available for SQL queries.",
    {},
    async () => {
      const provider = getProvider();
      const result = await provider.rawQuery(`
        SELECT table_name, column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
      `);

      // Group by table
      const tables: Record<string, Array<{ column: string; type: string; nullable: string }>> = {};
      for (const row of result.rows as Array<Record<string, string>>) {
        const table = row.table_name;
        if (!tables[table]) tables[table] = [];
        tables[table].push({
          column: row.column_name,
          type: row.data_type,
          nullable: row.is_nullable,
        });
      }

      return { content: [{ type: "text", text: JSON.stringify(tables, null, 2) }] };
    }
  );
}
