#!/usr/bin/env node
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { stderr } from "node:process";
import { fileURLToPath } from "node:url";
import { TerminalApprovalChannel } from "../../mcp-proxy/src/approval.js";
import { SpendGuard } from "../../mcp-proxy/src/guard.js";
import { Ledger } from "../../mcp-proxy/src/ledger.js";

const hopByHop = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length", "content-encoding"]);

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error(`Request body exceeds ${limit} bytes`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function headersForFetch(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (hopByHop.has(name.toLowerCase()) || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((entry) => result.append(name, entry));
    else result.set(name, value);
  }
  return result;
}

function send(response: ServerResponse, upstream: { status: number; headers: Array<[string, string]>; body: string }): void {
  response.statusCode = upstream.status;
  for (const [name, value] of upstream.headers) if (!hopByHop.has(name.toLowerCase())) response.appendHeader(name, value);
  response.end(Buffer.from(upstream.body, "base64"));
}

export async function startHttpFallback(configPath: string, ledgerPath: string) {
  const ledger = new Ledger(ledgerPath);
  try {
  const guard = new SpendGuard(configPath, ledger, new TerminalApprovalChannel());
  const fallback = guard.config().http_fallback;
  if (!fallback) throw new Error("http_fallback must be configured before starting the raw x402 proxy");
  const upstreamBase = new URL(fallback.upstream_url);
  if (upstreamBase.username || upstreamBase.password || upstreamBase.hash || (upstreamBase.protocol !== "https:" &&
    !(upstreamBase.protocol === "http:" && ["127.0.0.1", "localhost"].includes(upstreamBase.hostname)))) {
    throw new Error("HTTP fallback upstream must use HTTPS except for explicit localhost development");
  }
  const server = createServer(async (request, response) => {
    try {
      const host = request.headers.host ?? "";
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : fallback.listen_port;
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
        response.writeHead(403).end("Spend Guard rejected an invalid Host header");
        return;
      }
      const method = (request.method ?? "GET").toUpperCase();
      if (request.headers.origin && request.headers.origin !== `http://${host}`) { response.writeHead(403).end("Invalid Origin"); return; }
      // Raw signed bytes cannot be safely priced without a conforming transaction verifier.
      // Retire this unsafe path rather than offering a cap over an unrelated configured price.
      if (request.headers["payment-signature"] || request.headers["x-payment"]) {
        response.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ error: "signed_fallback_disabled",
          reason: "Use the guarded external-signer client. Raw signed transactions cannot be verified by this discovery proxy." })); return;
      }
      if (!["GET", "HEAD"].includes(method)) { response.writeHead(405).end("Discovery supports GET and HEAD only"); return; }
      const incomingUrl = new URL(request.url ?? "/", "http://localhost");
      const target = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, upstreamBase);
      if (target.origin !== upstreamBase.origin) throw new Error("Request escaped the configured upstream origin");
      await readBody(request, fallback.max_body_bytes ?? 5 * 1024 * 1024);
      const forward = async () => {
        const init: RequestInit = { method, headers: headersForFetch(request.headers), redirect: "manual",
          signal: AbortSignal.timeout(fallback.timeout_ms ?? 30_000) };
        const upstream = await fetch(target, init);
        const chunks: Uint8Array[] = []; let size = 0; const reader = upstream.body?.getReader();
        try { if (reader) while (true) { const { done, value } = await reader.read(); if (done) break;
          size += value.length; if (size > (fallback.max_response_bytes ?? 5 * 1024 * 1024)) throw new Error("Upstream response exceeds limit"); chunks.push(value); }
        } finally { await reader?.cancel(); }
        const bytes = Buffer.concat(chunks);
        return { status: upstream.status, headers: [...upstream.headers.entries()], body: bytes.toString("base64"),
          isError: upstream.status >= 500 };
      };

      send(response, await forward());
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({
        error: "spend_guard_internal_error", reason: error instanceof Error ? error.message : String(error),
      }));
    }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000;
  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(fallback.listen_port, "127.0.0.1", resolveReady);
  });
  return { address: `http://127.0.0.1:${fallback.listen_port}`, close: async () => {
    server.closeAllConnections();
    await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
    ledger.close();
  } };
  } catch (error) { ledger.close(); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const config = resolve(process.env.SPENDGUARD_CONFIG ?? "spendguard.config.yaml");
  const ledger = resolve(process.env.SPENDGUARD_LEDGER ?? "ledger.db");
  startHttpFallback(config, ledger).then(({ address }) => stderr.write(`Spend Guard x402 fallback listening at ${address}\n`))
    .catch((error) => { stderr.write(`Spend Guard HTTP fallback failed closed: ${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
}
