import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FixedApprovalChannel } from "../src/approval.js";
import type { ApprovalChannel } from "../src/types.js";
import { SpendGuard } from "../src/guard.js";
import { Ledger } from "../src/ledger.js";

function writeConfig(directory: string): string {
  const path = join(directory, "spendguard.config.yaml");
  writeFileSync(path, `
task_budget_usd: 10
soft_approval_threshold_usd: 2
max_failed_attempts: 3
provider_allowlist: [provider]
duplicate_window: task_lifetime
verification_full_threshold_usd: 2
task_id: retry-loop
task_description: Retry loop integration test
repo_path: .
tracked_paths: [tracked.txt]
agent_id: mcp:test
repo_id: test-repo
provider:
  id: provider
  transport: stdio
  command: node
  args: []
tool_prices_usd:
  paid-tool: 1
remote_sync:
  enabled: false
  directory: backups
`);
  return path;
}

describe("retry-loop interception", () => {
  it("forwards approved call 1 and blocks unchanged calls 2-5", async () => {
    const directory = mkdtempSync(join(tmpdir(), "spendguard-loop-"));
    writeFileSync(join(directory, "tracked.txt"), "unchanged repository state");
    const configPath = writeConfig(directory);
    const ledger = new Ledger(join(directory, "ledger.db"));
    const guard = new SpendGuard(configPath, ledger, new FixedApprovalChannel(true));
    let forwards = 0;
    const results = [];
    for (let index = 0; index < 5; index += 1) {
      results.push(await guard.call({ tool: "paid-tool", params: { query: "same" } }, async () => {
        forwards += 1;
        return { content: [{ type: "text", text: "provider output" }] };
      }));
    }
    expect(forwards).toBe(1);
    expect(results[0]).toMatchObject({ forwarded: true, request: { decision: "require_approval", approvalGranted: true } });
    expect(results.slice(1).every((result) => !result.forwarded)).toBe(true);
    expect(results.slice(1).every((result) => result.request.reasonCode === "R2_EXACT_DUPLICATE")).toBe(true);
    expect(ledger.report()).toMatchObject({ totalRequests: 5, allowed: 1, blocked: 4, blockedUsd: 4 });
    expect(ledger.verifyChain().valid).toBe(true);
    ledger.close();
  });

  it("requires review when tests change without added assertion signals", async () => {
    const directory = mkdtempSync(join(tmpdir(), "spendguard-test-delta-"));
    writeFileSync(join(directory, "tracked.txt"), "state");
    writeFileSync(join(directory, "behavior.test.ts"), "test('one', () => expect(1).toBe(1));\n");
    const configPath = writeConfig(directory);
    const raw = readFileSync(configPath, "utf8");
    writeFileSync(configPath, raw.replace("tracked_paths: [tracked.txt]", "tracked_paths: [.]") );
    let approvals = 0;
    const approval: ApprovalChannel = { async requestApproval() { approvals += 1; return approvals === 1; } };
    const ledger = new Ledger(join(directory, "ledger.db"));
    const guard = new SpendGuard(configPath, ledger, approval);
    const first = await guard.call({ tool: "paid-tool", params: { query: "first" } }, async () => ({ ok: true }));
    expect(first.forwarded).toBe(true);
    writeFileSync(join(directory, "behavior.test.ts"), "test('changed', () => expect(2).toBe(2));\n");
    const second = await guard.call({ tool: "paid-tool", params: { query: "different" } }, async () => ({ ok: true }));
    expect(second).toMatchObject({ forwarded: false, request: {
      decision: "require_approval", reasonCode: "R1C_SUSPICIOUS_TEST_DELTA", approvalGranted: false,
    } });
    ledger.close();
  });

  it("requires review after any policy configuration mutation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "spendguard-config-change-"));
    writeFileSync(join(directory, "tracked.txt"), "state");
    const configPath = writeConfig(directory);
    let approvals = 0;
    const approval: ApprovalChannel = { async requestApproval() { approvals += 1; return approvals === 1; } };
    const ledger = new Ledger(join(directory, "ledger.db"));
    const guard = new SpendGuard(configPath, ledger, approval);
    const first = await guard.call({ tool: "paid-tool", params: { query: "first" } }, async () => ({ ok: true }));
    expect(first.forwarded).toBe(true);
    writeFileSync(configPath, `${readFileSync(configPath, "utf8")}\n# reviewed mutation candidate\n`);
    const second = await guard.call({ tool: "paid-tool", params: { query: "second" } }, async () => ({ ok: true }));
    expect(second).toMatchObject({ forwarded: false, request: {
      decision: "require_approval", reasonCode: "R1D_CONFIG_CHANGED", approvalGranted: false,
    } });
    ledger.close();
  });
});
