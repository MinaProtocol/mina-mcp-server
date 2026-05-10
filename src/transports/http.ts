import express, { Request, Response } from "express";
import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SnapshotProvider } from "../providers/snapshot.js";
import { TutorialProvider } from "../providers/tutorial.js";
import { Mode, buildMcpServer } from "../server-factory.js";

interface SessionEntry {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

export interface HttpServerOptions {
  port: number;
  host?: string;
  provider: SnapshotProvider | TutorialProvider;
  mode: Mode;
}

export interface RunningHttpServer {
  port: number;
  close: () => Promise<void>;
  sessionCount: () => number;
}

export async function startHttpServer(opts: HttpServerOptions): Promise<RunningHttpServer> {
  const sessions = new Map<string, SessionEntry>();
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", mode: opts.mode, sessions: sessions.size });
  });

  const releaseSessionAccounts = async (sessionId: string) => {
    if (!(opts.provider instanceof TutorialProvider) || !opts.provider.tracker) return;
    try {
      const result = await opts.provider.tracker.releaseSession(sessionId);
      if (result.released > 0 || result.errors.length > 0) {
        console.error(
          `[session ${sessionId}] released ${result.released} accounts on close` +
            (result.errors.length ? `, ${result.errors.length} failed: ${result.errors.join("; ")}` : "")
        );
      }
    } catch (e) {
      console.error(`[session ${sessionId}] release threw:`, e);
    }
  };

  const handleMcp = async (req: Request, res: Response) => {
    const sessionId = req.header("mcp-session-id");
    const existing = sessionId ? sessions.get(sessionId) : undefined;

    if (existing) {
      // Existing session: just route; onsessionclosed handles cleanup on DELETE.
      await existing.transport.handleRequest(req, res, req.body);
      return;
    }

    const isInitialize =
      req.method === "POST" &&
      typeof req.body === "object" &&
      req.body !== null &&
      (req.body as { method?: string }).method === "initialize";

    if (!isInitialize) {
      res.status(sessionId ? 404 : 400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: sessionId ? `Unknown session id ${sessionId}` : "Missing Mcp-Session-Id header",
        },
        id: (req.body as { id?: string | number | null })?.id ?? null,
      });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessionclosed: async (id: string) => {
        sessions.delete(id);
        await releaseSessionAccounts(id);
      },
    });
    const server = buildMcpServer(opts.provider, opts.mode);
    await server.connect(transport);

    await transport.handleRequest(req, res, req.body);
    if (transport.sessionId) {
      sessions.set(transport.sessionId, { server, transport });
    }
  };

  app.post("/mcp", handleMcp);
  app.get("/mcp", handleMcp);
  app.delete("/mcp", handleMcp);

  const host = opts.host ?? "0.0.0.0";
  const httpServer: HttpServer = app.listen(opts.port, host);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });

  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : opts.port;

  return {
    port,
    sessionCount: () => sessions.size,
    close: async () => {
      const ids = [...sessions.keys()];
      for (const id of ids) {
        const entry = sessions.get(id);
        if (!entry) continue;
        try {
          await entry.transport.close();
        } catch {
          // ignore
        }
        await releaseSessionAccounts(id);
      }
      sessions.clear();
      await new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve()))
      );
    },
  };
}
