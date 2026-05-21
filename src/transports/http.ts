import express, { Request, Response, NextFunction } from "express";
import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { TutorialProvider } from "../providers/tutorial.js";
import { AnyProvider, Mode, buildMcpServer } from "../server-factory.js";

interface SessionEntry {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

export interface HttpServerOptions {
  port: number;
  host?: string;
  provider: AnyProvider;
  mode: Mode;
  /**
   * Max /mcp requests per client IP per minute. 0 disables. Defaults to
   * env MINA_MCP_RATE_LIMIT_RPM, else 120. The hosted sandbox is public and
   * unauthenticated, so this is the front line against runaway clients.
   */
  rateLimitPerMinute?: number;
  /**
   * Max concurrent sessions. 0 disables. Defaults to env MINA_MCP_MAX_SESSIONS,
   * else 0. Each session can acquire faucet accounts, so capping concurrency
   * bounds the worst-case account drain on the shared sandbox.
   */
  maxSessions?: number;
}

export interface RunningHttpServer {
  port: number;
  close: () => Promise<void>;
  sessionCount: () => number;
}

const RATE_WINDOW_MS = 60_000;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export async function startHttpServer(opts: HttpServerOptions): Promise<RunningHttpServer> {
  const sessions = new Map<string, SessionEntry>();
  const rateMax = opts.rateLimitPerMinute ?? envInt("MINA_MCP_RATE_LIMIT_RPM", 120);
  const maxSessions = opts.maxSessions ?? envInt("MINA_MCP_MAX_SESSIONS", 0);

  const metrics = {
    requestsTotal: 0,
    rateLimitedTotal: 0,
    sessionsCreatedTotal: 0,
    sessionsRejectedTotal: 0,
  };

  const app = express();
  // Behind Fly's TLS terminator / proxy, the real client IP is in
  // X-Forwarded-For. Trust it so req.ip is the client, not the proxy.
  app.set("trust proxy", true);
  app.use(express.json({ limit: "1mb" }));

  // Fixed-window per-IP rate limiter. In-memory: the sandbox is a single
  // machine, so a shared Map is sufficient and avoids a Redis dependency.
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const isRateLimited = (ip: string): boolean => {
    if (!rateMax) return false;
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + RATE_WINDOW_MS };
      buckets.set(ip, b);
    }
    b.count++;
    return b.count > rateMax;
  };
  // Periodically evict expired buckets so idle clients don't leak memory.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, b] of buckets) if (now >= b.resetAt) buckets.delete(ip);
  }, 5 * RATE_WINDOW_MS);
  sweep.unref?.();

  const rateLimit = (req: Request, res: Response, next: NextFunction) => {
    metrics.requestsTotal++;
    if (isRateLimited(req.ip ?? "unknown")) {
      metrics.rateLimitedTotal++;
      res.status(429).json({
        jsonrpc: "2.0",
        error: { code: -32029, message: `Rate limit exceeded (${rateMax}/min). Slow down.` },
        id: (req.body as { id?: string | number | null } | undefined)?.id ?? null,
      });
      return;
    }
    next();
  };

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", mode: opts.mode, sessions: sessions.size });
  });

  // Prometheus text exposition. Scrape-friendly; no auth (counts only, no PII).
  app.get("/metrics", (_req: Request, res: Response) => {
    const lines = [
      "# HELP mina_mcp_sessions_active Currently open MCP sessions.",
      "# TYPE mina_mcp_sessions_active gauge",
      `mina_mcp_sessions_active ${sessions.size}`,
      "# HELP mina_mcp_requests_total Total /mcp requests received.",
      "# TYPE mina_mcp_requests_total counter",
      `mina_mcp_requests_total ${metrics.requestsTotal}`,
      "# HELP mina_mcp_rate_limited_total /mcp requests rejected by the rate limiter.",
      "# TYPE mina_mcp_rate_limited_total counter",
      `mina_mcp_rate_limited_total ${metrics.rateLimitedTotal}`,
      "# HELP mina_mcp_sessions_created_total MCP sessions created since boot.",
      "# TYPE mina_mcp_sessions_created_total counter",
      `mina_mcp_sessions_created_total ${metrics.sessionsCreatedTotal}`,
      "# HELP mina_mcp_sessions_rejected_total Session creations refused by the session cap.",
      "# TYPE mina_mcp_sessions_rejected_total counter",
      `mina_mcp_sessions_rejected_total ${metrics.sessionsRejectedTotal}`,
    ];
    res.type("text/plain; version=0.0.4").send(lines.join("\n") + "\n");
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

    // New session: enforce the concurrency cap before allocating.
    if (maxSessions && sessions.size >= maxSessions) {
      metrics.sessionsRejectedTotal++;
      res.status(503).json({
        jsonrpc: "2.0",
        error: { code: -32030, message: `Server at capacity (${maxSessions} sessions). Try again later.` },
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
      metrics.sessionsCreatedTotal++;
    }
  };

  app.post("/mcp", rateLimit, handleMcp);
  app.get("/mcp", rateLimit, handleMcp);
  app.delete("/mcp", rateLimit, handleMcp);

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
      clearInterval(sweep);
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
