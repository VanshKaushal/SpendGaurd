import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import YAML from "yaml";
import { SpendGuard } from "../../mcp-proxy/src/guard.js";
import { FixedApprovalChannel } from "../../mcp-proxy/src/approval.js";
import { Ledger } from "../../mcp-proxy/src/ledger.js";

/** Explicitly simulated prices. No network, signer, payment, or provider account. */
export async function runDemo(directory = resolve(".spendguard/demo")) {
  const repo = join(directory, "repo");
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "source.txt"), "Demo repository: fix an authentication bug\n");
  const taskId = `demo-${randomUUID()}`;
  const configPath = join(directory, "config.yaml");
  const ledgerPath = join(directory, "ledger.db");
  writeFileSync(configPath, YAML.stringify({ task_id: taskId, task_description: "Simulated spending-control demonstration",
    repo_path: "repo", tracked_paths: ["source.txt"], task_budget_usd: 1, provider_allowlist: ["demo-provider"],
    provider: { id: "demo-provider", transport: "stdio", command: "node", args: [] },
    tool_prices_usd: { "paid-search": 0.25, "paid-sandbox": 3 } }));
  const ledger = new Ledger(ledgerPath);
  try {
    const guard = new SpendGuard(configPath, ledger, new FixedApprovalChannel(true));
    const steps = [
      { label: "First search (demo approval)", tool: "paid-search", params: { query: "authentication bug", requestId: "one" } },
      { label: "Exact retry", tool: "paid-search", params: { query: "authentication bug", requestId: "one" } },
      { label: "Retry with a changed request ID", tool: "paid-search", params: { query: "authentication bug", requestId: "two" } },
      { label: "Different useful search", tool: "paid-search", params: { query: "session cookie settings" } },
      { label: "Sandbox above remaining budget", tool: "paid-sandbox", params: { command: "run" } },
    ];
    const events = [];
    for (const step of steps) {
      const result = await guard.call(step, async () => ({ content: [{ type: "text", text: "Simulated provider response" }] }));
      events.push({ label: step.label, forwarded: result.forwarded, reason: result.request.reasonCode, price: result.request.price });
    }
    const report = ledger.report(taskId);
    const result = { simulation: true, taskId, ledgerPath, configPath, events, report, verification: ledger.verifyChain() };
    writeFileSync(join(directory, "latest.json"), JSON.stringify(result, null, 2));
    return result;
  } finally { ledger.close(); }
}
