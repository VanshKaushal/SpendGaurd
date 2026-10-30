import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Ledger } from "../../mcp-proxy/src/ledger.js";

export async function startDashboard(ledgerPath: string, port = 4403) {
  const ledger = new Ledger(ledgerPath);
  const token = randomBytes(32).toString("hex");
  const nonce = randomBytes(18).toString("base64");
  const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Spend Guard · Local audit</title><style>
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#101512;color:#ebf1e7;font:16px system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:40px 24px}h1{font-size:36px;margin:12px 0}a{color:#c8ff74}.tag{font:12px monospace;letter-spacing:2px;color:#c8ff74}p{color:#aebbae;line-height:1.6}.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap}select,button{background:#1e2921;border:1px solid #526453;color:inherit;padding:10px;border-radius:6px}button{cursor:pointer}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:28px 0}.stat{border:1px solid #344036;padding:20px;border-radius:10px}.stat b{display:block;font-size:32px;margin-bottom:8px}table{border-collapse:collapse;min-width:780px;width:100%;font-size:14px}td,th{text-align:left;border-bottom:1px solid #344036;padding:14px 8px}th{color:#aebbae}.scroll{overflow:auto}.allow{color:#c8ff74}.block{color:#ffb5a5}.review{color:#ffe19a}#status{min-height:24px}@media(max-width:650px){.stats{grid-template-columns:repeat(2,1fr)}main{padding:24px 16px}}
  </style><main><div class="tag">SPEND GUARD / LOCAL AUDIT</div><h1>Every purchase has a reason.</h1>
  <p>Read-only view of your local ledger. Configured prices are spending estimates; this dashboard does not reconcile invoices or send repository data.</p>
  <div class="toolbar"><label for="task">Task</label><select id="task"><option value="">All tasks</option></select><button id="refresh">Refresh</button><button id="export">Export JSON</button></div>
  <p id="status" role="status"></p><div class="stats"><div class="stat"><b id="total">—</b>Requests</div><div class="stat"><b id="allowed">—</b>Authorized</div><div class="stat"><b id="blocked">—</b>Blocked / denied</div><div class="stat"><b id="usd">—</b>Blocked-price estimate</div></div>
  <div class="scroll"><table><thead><tr><th>Time</th><th>Task / tool</th><th>Price</th><th>Decision</th><th>Reason</th><th>Outcome</th></tr></thead><tbody id="events"></tbody></table></div>
  <p>Showing up to 1,000 recent requests. Hash-chain verification detects changed or unchained rows; external snapshots are needed to detect a full ledger rewrite.</p></main>
  <script nonce="${nonce}">
  const token=location.hash.slice(1)||sessionStorage.getItem('spendguard-token'); if(token)sessionStorage.setItem('spendguard-token',token);history.replaceState(null,'',location.pathname);
  const el=id=>document.getElementById(id);let current=null;
  async function refresh(){try{const response=await fetch('/api/report?task='+encodeURIComponent(el('task').value),{headers:{authorization:'Bearer '+token}});const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to read ledger');current=data;
    const selected=el('task').value;el('task').replaceChildren(new Option('All tasks',''),...data.tasks.map(t=>new Option(t.description+' ('+t.id+')',t.id)));el('task').value=selected;
    el('total').textContent=data.report.totalRequests;el('allowed').textContent=data.report.allowed;el('blocked').textContent=data.report.blocked;el('usd').textContent='$'+data.report.blockedUsd.toFixed(2);
    el('events').replaceChildren(...data.activity.map(e=>{const row=document.createElement('tr');const authorized=e.decision==='allow'||e.approval_granted===1;const values=[new Date(e.timestamp).toLocaleString(),e.task_id+' / '+e.tool,'$'+Number(e.price).toFixed(6),authorized?'authorized':e.decision==='block'?'blocked':'denied',e.reason_code+' — '+e.reason,e.provider_succeeded===null?'Not recorded':e.provider_succeeded?'Provider succeeded':'Provider failed'];for(const [i,value]of values.entries()){const td=document.createElement('td');td.textContent=value;if(i===3)td.className=authorized?'allow':'block';row.append(td)}return row}));el('status').textContent='Ledger verified · '+data.verification.checked+' links · refreshed '+new Date().toLocaleTimeString();
  }catch(error){el('status').textContent=error.message;}}
  el('refresh').onclick=refresh;el('task').onchange=refresh;el('export').onclick=()=>{if(!current)return;const url=URL.createObjectURL(new Blob([JSON.stringify(current,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='spendguard-audit.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};refresh();
  </script></html>`;
  const server = createServer((request, response) => {
    const address = server.address();
    const actualPort = address && typeof address === "object" ? address.port : port;
    const host = request.headers.host;
    if (host !== `127.0.0.1:${actualPort}` && host !== `localhost:${actualPort}`) {
      response.writeHead(403).end("Invalid Host"); return;
    }
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("content-security-policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`);
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (request.method !== "GET") { response.writeHead(405).end(); return; }
    if (url.pathname === "/") { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page); return; }
    if (url.pathname !== "/api/report") { response.writeHead(404).end(); return; }
    const supplied = request.headers.authorization?.replace(/^Bearer /u, "") ?? "";
    if (Buffer.byteLength(supplied) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) {
      response.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "Open the authenticated dashboard URL printed by the CLI" })); return;
    }
    const origin = request.headers.origin;
    if (origin && origin !== `http://${host}`) { response.writeHead(403).end(); return; }
    try {
      const verification = ledger.verifyChain();
      if (!verification.valid) throw new Error(verification.message);
      const taskId = url.searchParams.get("task") || undefined;
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        report: ledger.report(taskId), tasks: ledger.tasks(), activity: ledger.activity(1000, taskId), verification,
      }));
    } catch (error) { response.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: String(error) })); }
  });
  try { await new Promise<void>((ready, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", ready); }); }
  catch (error) { ledger.close(); throw error; }
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("Dashboard did not bind");
  return { url: `http://127.0.0.1:${address.port}/#${token}`, async close() {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    ledger.close();
  } };
}
