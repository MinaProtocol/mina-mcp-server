import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpServer, RunningHttpServer } from "../../src/transports/http.js";
import { TutorialProvider } from "../../src/providers/tutorial.js";
import { SessionTracker } from "../../src/session/tracker.js";
import { ResetController } from "../../src/reset/controller.js";
import {
  createMockDb,
  createMockGraphQL,
  createMockArchiveApi,
  createMockAccountsManager,
} from "./helpers.js";
import { AccountsManager } from "../../src/graphql/accounts-manager.js";

describe("http transport", () => {
  let httpServer: RunningHttpServer;
  let provider: TutorialProvider;
  let tracker: SessionTracker;
  let mockAccountsManager: AccountsManager;

  beforeAll(async () => {
    const mockDb = createMockDb();
    const mockGraphQL = createMockGraphQL();
    const mockArchiveApi = createMockArchiveApi();
    mockAccountsManager = createMockAccountsManager();
    tracker = new SessionTracker(mockAccountsManager);
    const resetController = new ResetController();
    provider = new TutorialProvider(
      mockDb,
      mockGraphQL,
      mockArchiveApi,
      mockAccountsManager,
      tracker,
      resetController
    );

    httpServer = await startHttpServer({ port: 0, provider, mode: "tutorial" });
  });

  afterAll(async () => {
    await httpServer.close();
  });

  it("/health returns ok and current session count", async () => {
    const res = await fetch(`http://127.0.0.1:${httpServer.port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.mode).toBe("tutorial");
    expect(typeof body.sessions).toBe("number");
  });

  it("rejects POST /mcp with no Mcp-Session-Id and no initialize body", async () => {
    const res = await fetch(`http://127.0.0.1:${httpServer.port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/Missing Mcp-Session-Id/);
  });

  it("end-to-end: initialize, list tools, faucet, then explicit session terminate releases the account", async () => {
    const baseUrl = new URL(`http://127.0.0.1:${httpServer.port}/mcp`);

    (mockAccountsManager.acquireAccount as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      pk: "B62qhttp1",
      sk: "EKhttp1",
    });

    const client = new Client({ name: "http-test-client", version: "0.0.1" });
    const transport = new StreamableHTTPClientTransport(baseUrl);
    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("faucet");
    expect(names).toContain("describe_state");
    expect(names).toContain("list_examples");

    const faucetResult = await client.callTool({ name: "faucet", arguments: {} });
    const text = (faucetResult.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(text).publicKey).toBe("B62qhttp1");

    expect(httpServer.sessionCount()).toBe(1);
    expect(tracker.sessionIds()).toHaveLength(1);
    const [sessionId] = tracker.sessionIds();

    await client.close();

    // Explicit DELETE — MCP's terminate semantic. The client SDK doesn't always send it
    // on close, but real clients on graceful shutdown do; the server-side onclose hook
    // is what releases tracked accounts, regardless of who triggers DELETE.
    const terminate = await fetch(`http://127.0.0.1:${httpServer.port}/mcp`, {
      method: "DELETE",
      headers: { "mcp-session-id": sessionId },
    });
    expect([200, 202, 204]).toContain(terminate.status);

    // releaseSession runs asynchronously inside transport.onclose
    for (let i = 0; i < 40 && tracker.sessionIds().length > 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(tracker.sessionIds()).toEqual([]);
    expect(httpServer.sessionCount()).toBe(0);
    expect(mockAccountsManager.releaseAccount).toHaveBeenCalledWith({ pk: "B62qhttp1", sk: "EKhttp1" });
  });
});

describe("http transport: limits + metrics", () => {
  function makeProvider() {
    return new TutorialProvider(
      createMockDb(),
      createMockGraphQL(),
      createMockArchiveApi(),
      createMockAccountsManager()
    );
  }

  it("rate-limits /mcp per IP and records it in /metrics", async () => {
    const server = await startHttpServer({
      port: 0,
      provider: makeProvider(),
      mode: "tutorial",
      rateLimitPerMinute: 2,
    });
    try {
      const url = `http://127.0.0.1:${server.port}/mcp`;
      const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

      const statuses: number[] = [];
      for (let i = 0; i < 3; i++) {
        const r = await fetch(url, { method: "POST", headers, body });
        statuses.push(r.status);
      }
      // First two clear the limiter (then 400 for the missing session); the
      // third trips it.
      expect(statuses).toEqual([400, 400, 429]);

      const metrics = await (await fetch(`http://127.0.0.1:${server.port}/metrics`)).text();
      expect(metrics).toContain("mina_mcp_requests_total 3");
      expect(metrics).toContain("mina_mcp_rate_limited_total 1");
      expect(metrics).toContain("mina_mcp_sessions_active 0");
    } finally {
      await server.close();
    }
  });

  it("rejects new sessions past maxSessions with 503", async () => {
    const server = await startHttpServer({
      port: 0,
      provider: makeProvider(),
      mode: "tutorial",
      maxSessions: 1,
    });
    try {
      const url = `http://127.0.0.1:${server.port}/mcp`;
      const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
      const init = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      });

      const first = await fetch(url, { method: "POST", headers, body: init });
      expect(first.status).toBe(200);
      expect(server.sessionCount()).toBe(1);

      const second = await fetch(url, { method: "POST", headers, body: init });
      expect(second.status).toBe(503);
      expect((await second.json()).error.message).toMatch(/capacity/);

      const metrics = await (await fetch(`http://127.0.0.1:${server.port}/metrics`)).text();
      expect(metrics).toContain("mina_mcp_sessions_rejected_total 1");
    } finally {
      await server.close();
    }
  });
});
