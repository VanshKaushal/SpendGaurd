import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { initialize, doctor } from "../src/setup.js";
import { runDemo } from "../src/demo.js";
import { startDashboard } from "../src/dashboard.js";
import { request as httpRequest } from "node:http";

it("initializes safely and reports the unconfigured provider instead of saying ready", () => {
  const directory = mkdtempSync(join(tmpdir(), "spendguard-setup-"));
  const config = join(directory, "config.yaml");
  initialize(config, directory);
  expect(existsSync(config)).toBe(true);
  expect(() => initialize(config, directory)).toThrow("already exists");
  expect(doctor(config)).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Provider configured", status: "fail" }),
    expect.objectContaining({ name: "Tool prices", status: "fail" })]));
});

it("runs a repeatable demo and protects read-only dashboard data with an authenticated local URL", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spendguard-dashboard-"));
  const one = await runDemo(directory);
  const two = await runDemo(directory);
  expect(one.report).toMatchObject({ allowed: 2, blocked: 3, blockedUsd: 3.5 });
  expect(two.report).toMatchObject({ allowed: 2, blocked: 3, blockedUsd: 3.5 });
  expect(two.verification.valid).toBe(true);
  const dashboard = await startDashboard(two.ledgerPath, 0);
  try {
    const url = new URL(dashboard.url);
    const api = `${url.origin}/api/report?task=${two.taskId}`;
    expect((await fetch(api)).status).toBe(401);
    const authorization = `Bearer ${url.hash.slice(1)}`;
    const allowed = await fetch(api, { headers: { authorization } });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ report: { totalRequests: 5, allowed: 2, blocked: 3 }, verification: { valid: true } });
    expect((await fetch(api, { headers: { authorization, origin: "https://attacker.example" } })).status).toBe(403);
    expect((await fetch(api, { method: "POST", headers: { authorization } })).status).toBe(405);
    const invalidHostStatus = await new Promise<number>((done, reject) => {
      const request = httpRequest(`${url.origin}/`, { headers: { host: "attacker.example" } }, (response) => {
        response.resume(); done(response.statusCode ?? 0);
      });
      request.once("error", reject); request.end();
    });
    expect(invalidHostStatus).toBe(403);
  } finally { await dashboard.close(); }
}, 20_000);
