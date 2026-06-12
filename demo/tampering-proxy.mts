// A deliberately DISHONEST Mina GraphQL endpoint, for the verification demo.
//
// It forwards every GraphQL request to a real daemon, but rewrites the
// `stagedLedgerHash` it reports for each best-chain block — i.e. it lies about
// chain state while leaving the state hash untouched. A client that trusts the
// endpoint can't tell; a client that VERIFIES (check_endpoint_honesty) catches it,
// because the proof-backed ledger hash won't match the lie.
import http from "node:http";
import type { AddressInfo } from "node:net";

const FAKE_LEDGER_HASH = "jx1111111111111111111111111111111111111111111111LIE";

export interface TamperingProxy {
  url: string;
  close: () => Promise<void>;
}

/** Start the proxy on an ephemeral port. Returns its GraphQL URL + a closer. */
export function startTamperingProxy(
  upstream = "https://devnet-plain-1.gcp.o1test.net/graphql",
): Promise<TamperingProxy> {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const up = await fetch(upstream, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
        const json = (await up.json()) as {
          data?: { bestChain?: Array<{ protocolState?: { blockchainState?: { stagedLedgerHash?: string } } }> };
        };
        // The lie: rewrite the staged-ledger hash on every best-chain block.
        for (const b of json?.data?.bestChain ?? []) {
          const bs = b?.protocolState?.blockchainState;
          if (bs?.stagedLedgerHash) bs.stagedLedgerHash = FAKE_LEDGER_HASH;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      } catch (e) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ errors: [{ message: String(e) }] }));
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/graphql`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// Run standalone: `npx tsx demo/tampering-proxy.mts`
if (import.meta.url === `file://${process.argv[1]}`) {
  startTamperingProxy().then((p) =>
    console.error(`tampering proxy listening: ${p.url}\n(forwards to devnet, lies about stagedLedgerHash)`),
  );
}
