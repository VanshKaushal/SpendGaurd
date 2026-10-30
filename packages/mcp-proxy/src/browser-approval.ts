import { createServer, type Server } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { ApprovalChannel, ApprovalRequest } from "./types.js";

interface Pending { id: string; request: ApprovalRequest; expiresAt: number; finish(approved: boolean): void }

/** Local capability access, one-use expiring decisions. Never exposes raw tool arguments. */
export class BrowserApprovalChannel implements ApprovalChannel {
  private server: Server | undefined;
  private pending = new Map<string, Pending>();
  private token = randomBytes(32).toString("hex");
  private address = "";
  private closed = false;
  private starting: Promise<string> | undefined;
  constructor(private readonly timeoutMs = 60_000, private readonly announce: (url: string) => void =
    (url) => process.stderr.write(`Spend Guard approval inbox: ${url}\n`)) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw new Error("Invalid approval timeout");
  }
  async start(): Promise<string> {
    if (this.closed) throw new Error("Approval channel is closed");
    return this.starting ??= this.listen();
  }
  private async listen(): Promise<string> {
    const nonce = randomBytes(18).toString("base64");
    const server = createServer(async (req, res) => {
      const json = (value: unknown, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value));
      };
      res.setHeader("cache-control", "no-store"); res.setHeader("referrer-policy", "no-referrer");
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("content-security-policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`);
      if (req.headers.host !== new URL(this.address).host) return json({ error: "Invalid Host" }, 403);
      const origin = req.headers.origin;
      if (origin && origin !== this.address) return json({ error: "Invalid Origin" }, 403);
      const path = new URL(req.url ?? "/", this.address).pathname;
      if (path === "/" && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(page(nonce)); return;
      }
      const auth = req.headers.authorization?.replace(/^Bearer /u, "") ?? "";
      if (Buffer.byteLength(auth) !== Buffer.byteLength(this.token) || !timingSafeEqual(Buffer.from(auth), Buffer.from(this.token))) {
        return json({ error: "Open the authenticated URL printed by the proxy" }, 401);
      }
      if (path === "/api/pending" && req.method === "GET") {
        return json([...this.pending.values()].map(({ id, request, expiresAt }) => ({ id, request, expiresAt })));
      }
      if (path !== "/api/decision" || req.method !== "POST") return json({ error: "Unsupported operation" }, 405);
      if (origin !== this.address || req.headers["content-type"] !== "application/json") return json({ error: "Use this approval inbox" }, 403);
      try {
        let body = ""; for await (const chunk of req) { body += chunk.toString(); if (Buffer.byteLength(body) > 2048) throw new Error("Too large"); }
        const input = JSON.parse(body) as { id?: unknown; approved?: unknown };
        if (typeof input.id !== "string" || typeof input.approved !== "boolean") return json({ error: "Invalid decision" }, 400);
        const pending = this.pending.get(input.id);
        if (!pending || pending.expiresAt <= Date.now()) return json({ error: "Approval expired or already consumed" }, 409);
        pending.finish(input.approved); return json({ accepted: true });
      } catch { return json({ error: "Invalid bounded JSON request" }, 400); }
    });
    server.requestTimeout = 10_000; server.headersTimeout = 10_000;
    this.server = server;
    await new Promise<void>((ready, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", ready); });
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Approval inbox unavailable");
    this.address = `http://127.0.0.1:${address.port}`;
    const url = `${this.address}/#${this.token}`; this.announce(url); return url;
  }
  async requestApproval(request: ApprovalRequest): Promise<boolean> {
    try { await this.start(); } catch { return false; }
    if (this.closed) return false;
    return new Promise<boolean>((resolve) => {
      const id = randomUUID(); const expiresAt = Date.now() + this.timeoutMs;
      const finish = (approved: boolean) => { clearTimeout(timer); this.pending.delete(id); resolve(approved); };
      const timer = setTimeout(() => finish(false), this.timeoutMs);
      this.pending.set(id, { id, request: structuredClone(request), expiresAt, finish });
    });
  }
  async close(): Promise<void> {
    this.closed = true; for (const pending of [...this.pending.values()]) pending.finish(false);
    if (this.starting) await this.starting.catch(() => {});
    this.server?.closeAllConnections();
    if (this.server?.listening) await new Promise<void>((done) => this.server!.close(() => done()));
  }
}

function page(nonce: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Spend Guard approvals</title>
  <style>body{font:16px system-ui;max-width:900px;margin:40px auto;padding:20px;background:#101512;color:#ebf1e7}article{border:1px solid #526453;padding:20px;margin:20px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{padding:12px;margin-right:12px;cursor:pointer}p{line-height:1.5}</style>
  <h1>Review a paid action</h1><p>Approvals expire and apply once to the displayed task, request fingerprint, and policy. Hard caps and duplicates remain enforced. Raw arguments are omitted; inspect your agent's request before approving. Keep this URL private.</p><p id="status" role="status"></p><main id="requests"></main>
  <script nonce="${nonce}">const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);const headers={authorization:'Bearer '+token};
  async function refresh(){try{const r=await fetch('/api/pending',{headers});if(!r.ok)throw Error('Authenticated access required. Reopen the printed URL.');const items=await r.json();document.getElementById('requests').replaceChildren(...items.map(x=>{const a=document.createElement('article');const p=document.createElement('pre');p.textContent=JSON.stringify({...x.request,expiresAt:new Date(x.expiresAt).toISOString()},null,2);a.append(p);for(const yes of [true,false]){const b=document.createElement('button');b.textContent=yes?'Approve once':'Deny';b.onclick=async()=>{b.disabled=true;try{const result=await fetch('/api/decision',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({id:x.id,approved:yes})});if(!result.ok)throw Error('Decision expired or unavailable');await refresh()}catch(e){document.getElementById('status').textContent=e.message}};a.append(b)}return a}));document.getElementById('status').textContent=items.length?'Review pending actions below.':'No pending approvals.'}catch(e){document.getElementById('status').textContent=e.message}}refresh();setInterval(refresh,1500);</script></html>`;
}
