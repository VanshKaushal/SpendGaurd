import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Ledger } from "../src/ledger.js";
import type { PaidRequest, Task } from "../src/types.js";

function task(): Task {
  return { id: "task", repo: ".", repoId: "repo", agentId: "mcp:test", description: "test", budgetCap: 10,
    startStateHash: "state", createdAt: new Date().toISOString() };
}

function request(): PaidRequest {
  return { id: randomUUID(), taskId: "task", repoId: "repo", agentId: "mcp:test", sessionId: "session",
    tool: "paid", provider: "provider", paramsHash: "params", fingerprint: "fingerprint",
    nearDuplicateKey: "near", repoStateHash: "state", price: 1, decision: "allow", reasonCode: "R7_ALLOWED",
    reason: "allowed", approvalGranted: null, configHash: "config", heartbeatPresent: true,
    timestamp: new Date().toISOString() };
}

describe("hash-chained ledger", () => {
  it("verifies an intact append-only chain", () => {
    const ledger = new Ledger(join(mkdtempSync(join(tmpdir(), "spendguard-ledger-")), "ledger.db"));
    ledger.ensureTask(task());
    ledger.heartbeat({ id: randomUUID(), sessionId: "session", agentId: "mcp:test", repoId: "repo", timestamp: new Date().toISOString() });
    ledger.recordRequest(request());
    expect(ledger.verifyChain()).toMatchObject({ valid: true, checked: 3 });
    ledger.close();
  });

  it("detects the first tampered row", () => {
    const ledger = new Ledger(join(mkdtempSync(join(tmpdir(), "spendguard-tamper-")), "ledger.db"));
    ledger.ensureTask(task());
    const paid = request();
    ledger.recordRequest(paid);
    ledger.unsafeDatabaseForTests().prepare("UPDATE paid_requests SET price = 999 WHERE id = ?").run(paid.id);
    expect(ledger.verifyChain()).toMatchObject({ valid: false, firstBrokenLink: 2 });
    ledger.close();
  });

  it("creates a WAL-consistent verifiable backup", async () => {
    const directory = mkdtempSync(join(tmpdir(), "spendguard-backup-"));
    const ledger = new Ledger(join(directory, "ledger.db"));
    ledger.ensureTask(task());
    ledger.recordRequest(request());
    const backupPath = await ledger.backupTo(join(directory, "remote"));
    const restored = new Ledger(backupPath);
    expect(restored.verifyChain()).toMatchObject({ valid: true, checked: 2 });
    restored.close();
    ledger.close();
  });
});
