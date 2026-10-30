import { expect, it } from "vitest";
import { BrowserApprovalChannel } from "../src/browser-approval.js";
import { request as httpRequest } from "node:http";

const request = { provider: "provider", tool: "search", price: 0.25, reasonCode: "R1A_NOVEL_PROVIDER" as const,
  reason: "New provider", taskId: "task", paramsHash: "params", fingerprint: "exact", configHash: "policy" };

it("requires a capability and same origin, binds details, and consumes approval once", async () => {
  const channel = new BrowserApprovalChannel(5000, () => {});
  try {
    const url = new URL(await channel.start()); const token = url.hash.slice(1); const base = url.origin;
    const pending = channel.requestApproval(request);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect((await fetch(`${base}/api/pending`)).status).toBe(401);
    const headers = { authorization: `Bearer ${token}` };
    const items = await (await fetch(`${base}/api/pending`, { headers })).json();
    expect(items).toHaveLength(1); expect(items[0].request).toEqual(request);
    const body = JSON.stringify({ id: items[0].id, approved: true });
    const post = (origin: string) => fetch(`${base}/api/decision`, { method: "POST", headers: { ...headers, origin, "content-type": "application/json" }, body });
    expect((await post("https://untrusted.example")).status).toBe(403);
    expect((await post(base)).status).toBe(200); expect(await pending).toBe(true);
    expect((await post(base)).status).toBe(409);
    const invalidHost = await new Promise<number>((done, reject) => {
      const req = httpRequest(`${base}/api/pending`, { headers: { ...headers, host: "untrusted.example" } }, res => { res.resume(); done(res.statusCode ?? 0); });
      req.once("error", reject); req.end();
    });
    expect(invalidHost).toBe(403);
  } finally { await channel.close(); }
});

it("denies expired requests and pending decisions when the channel closes", async () => {
  const channel = new BrowserApprovalChannel(30, () => {});
  try { expect(await channel.requestApproval(request)).toBe(false); }
  finally { await channel.close(); }
  expect(await channel.requestApproval(request)).toBe(false);
  const other = new BrowserApprovalChannel(5000, () => {});
  await other.start(); const pending = other.requestApproval(request);
  await new Promise<void>(resolve => setImmediate(resolve));
  await other.close(); expect(await pending).toBe(false);
});
