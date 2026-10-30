import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startHttpFallback } from "../../http-fallback-proxy/src/server.js";

async function listen(server: Server) {
  await new Promise<void>(ready => server.listen(0, "127.0.0.1", ready));
  const a = server.address(); if (!a || typeof a === "string") throw new Error("No port"); return a.port;
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }

it("bounds discovery responses/time and refuses raw signed retries before reaching a provider", async () => {
  let upstreamCalls = 0;
  const upstream = createServer((req, res) => { upstreamCalls++;
    if (req.url === "/hang") return;
    if (req.url === "/large") { res.end("x".repeat(256)); return; }
    res.writeHead(402, { "payment-required": "challenge" }).end("quote");
  });
  const dir = mkdtempSync(join(tmpdir(), "spendguard-discovery-"));
  const port = await listen(upstream); const probe = createServer(); const local = await listen(probe); await close(probe);
  writeFileSync(join(dir, "tracked.txt"), "state");
  const config = join(dir, "config.yaml");
  writeFileSync(config, `repo_path: .\ntracked_paths: [tracked.txt]\nprovider: {id: discovery, transport: stdio, command: node}\nhttp_fallback: {upstream_url: 'http://127.0.0.1:${port}', listen_port: ${local}, timeout_ms: 150, max_response_bytes: 64}\n`);
  const proxy = await startHttpFallback(config, join(dir, "ledger.db"));
  try {
    expect((await fetch(`${proxy.address}/quote`)).status).toBe(402); expect(upstreamCalls).toBe(1);
    expect((await fetch(`${proxy.address}/quote`, { headers: { "payment-signature": "unverifiable" } })).status).toBe(403);
    expect(upstreamCalls).toBe(1);
    expect((await fetch(`${proxy.address}/quote`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${proxy.address}/quote`, { headers: { origin: "https://attacker.example" } })).status).toBe(403);
    expect((await fetch(`${proxy.address}/large`)).status).toBe(500);
    expect((await fetch(`${proxy.address}/hang`)).status).toBe(500);
  } finally { await proxy.close(); await close(upstream); rmSync(dir, { recursive: true, force: true }); }
});
