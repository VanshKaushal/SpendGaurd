import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { fingerprintRequest } from "../src/fingerprint.js";
import { Ledger } from "../src/ledger.js";
import { PolicyEngine } from "../src/policy-engine.js";
import type { SpendGuardConfig, Task } from "../src/types.js";

it("decides in under 200ms with 10,000 indexed prior requests", () => {
  const directory = mkdtempSync(join(tmpdir(), "spendguard-perf-"));
  writeFileSync(join(directory, "tracked.txt"), "small state");
  const ledger = new Ledger(join(directory, "ledger.db"));
  const task: Task = { id: "perf", repo: directory, repoId: "repo", agentId: "mcp:perf", description: "perf",
    budgetCap: 1_000_000, startStateHash: "start", createdAt: new Date().toISOString() };
  ledger.ensureTask(task);
  const db = ledger.unsafeDatabaseForTests();
  const insert = db.prepare(`INSERT INTO paid_requests
    (id, task_id, repo_id, agent_id, session_id, tool, provider, params_hash, fingerprint, near_duplicate_key,
     repo_state_hash, price, decision, reason_code, reason, approval_granted, ap2_mandate_ref, heartbeat_present, timestamp)
    VALUES (?, 'perf', 'repo', 'mcp:perf', 'session', 'tool', 'provider', ?, ?, ?, 'old-state', 0,
      'allow', 'R7_ALLOWED', 'seed', NULL, NULL, 1, ?)`);
  db.exec("BEGIN");
  for (let index = 0; index < 10_000; index += 1) {
    const value = String(index);
    insert.run(randomUUID(), value, `fp-${value}`, `near-${value}`, new Date().toISOString());
  }
  db.exec("COMMIT");
  const config: SpendGuardConfig = { task_budget_usd: 1_000_000, soft_approval_threshold_usd: 2,
    max_failed_attempts: 3, provider_allowlist: ["provider"], duplicate_window: "task_lifetime",
    verification_full_threshold_usd: 2, task_id: "perf", task_description: "perf", repo_path: directory,
    tracked_paths: ["tracked.txt"], agent_id: "mcp:perf", repo_id: "repo",
    provider: { id: "provider", transport: "stdio", command: "node", args: [] }, tool_prices_usd: {},
    remote_sync: { enabled: false, directory: "backups" } };
  const started = performance.now();
  const fingerprint = fingerprintRequest({ tool: "tool", provider: "provider", params: { unique: true },
    repoPath: directory, trackedPaths: ["tracked.txt"] });
  const decision = new PolicyEngine(() => config, (request, since) => ledger.policyHistory(request, since)).evaluate({
    taskId: "perf", provider: "provider", tool: "tool", price: 1, fingerprint: fingerprint.fingerprint,
    nearDuplicateKey: fingerprint.nearDuplicateKey, repoStateHash: fingerprint.repoStateHash,
  });
  const elapsed = performance.now() - started;
  expect(decision.decision).toBe("allow");
  expect(elapsed).toBeLessThan(200);
  ledger.close();
});
