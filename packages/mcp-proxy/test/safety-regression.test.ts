import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FixedApprovalChannel } from "../src/approval.js";
import { SpendGuard } from "../src/guard.js";
import { Ledger } from "../src/ledger.js";
import { fingerprintRequest } from "../src/fingerprint.js";
import { microUsd } from "../src/money.js";
import { loadConfig } from "../../policy-dsl/src/config.js";
import type { ApprovalChannel } from "../src/types.js";

function fixture(approval: ApprovalChannel = new FixedApprovalChannel(true), extra = "") {
  const directory = mkdtempSync(join(tmpdir(), "spendguard-safety-"));
  const configPath = join(directory, "config.yaml");
  writeFileSync(join(directory, "tracked.txt"), "initial");
  writeFileSync(configPath, `task_id: safety\nrepo_path: .\ntracked_paths: [tracked.txt]\nprovider_allowlist: [provider]\n` +
    `provider: {id: provider, transport: stdio, command: node}\ntool_prices_usd: {search: 1}\n${extra}`);
  const ledger = new Ledger(join(directory, "ledger.db"));
  const guard = new SpendGuard(configPath, ledger, approval);
  return { directory, configPath, ledger, guard };
}

describe("spend safety across the complete request lifecycle", () => {
  it("invalidates approval when caller-owned request arguments mutate while approval is pending", async () => {
    const params = { q: "approved query" }; let calls = 0;
    const f = fixture({ async requestApproval() { params.q = "different purchase"; return true; } });
    try {
      const result = await f.guard.call({ tool: "search", params }, async () => { calls++; });
      expect(result.request.reasonCode).toBe("APPROVAL_STALE"); expect(calls).toBe(0);
    } finally { f.ledger.close(); }
  });
  it("does not offer an approval bypass for an over-budget novel provider", async () => {
    let prompts = 0;
    const f = fixture({ async requestApproval() { prompts++; return true; } }, "task_budget_usd: 0.5\n");
    try {
      const result = await f.guard.call({ tool: "search", params: { q: "one" } }, async () => { throw new Error("must not execute"); });
      expect(result).toMatchObject({ forwarded: false, request: { reasonCode: "R4_BUDGET_EXCEEDED" } });
      expect(prompts).toBe(0);
    } finally { f.ledger.close(); }
  });

  it("denied attempts neither establish trust nor poison a later approved retry", async () => {
    let prompts = 0;
    const f = fixture({ async requestApproval() { return ++prompts === 2; } });
    try {
      const one = await f.guard.call({ tool: "search", params: { q: "same" } }, async () => ({ ok: true }));
      const two = await f.guard.call({ tool: "search", params: { q: "same" } }, async () => ({ ok: true }));
      expect(one.forwarded).toBe(false);
      expect(two.forwarded).toBe(true);
      expect(two.request.reasonCode).toBe("R1A_NOVEL_PROVIDER");
      expect(prompts).toBe(2);
    } finally { f.ledger.close(); }
  });

  it("allows different meaningful queries in an unchanged repository", async () => {
    const f = fixture();
    try {
      await f.guard.call({ tool: "search", params: { q: "typescript" } }, async () => ({ ok: true }));
      const two = await f.guard.call({ tool: "search", params: { q: "rust" } }, async () => ({ ok: true }));
      expect(two).toMatchObject({ forwarded: true, request: { decision: "allow" } });
    } finally { f.ledger.close(); }
  });

  it("blocks transport metadata evasion while preserving meaningful parameters", async () => {
    const f = fixture();
    try {
      await f.guard.call({ tool: "search", params: { q: "same", requestId: "one" } }, async () => ({ ok: true }));
      const two = await f.guard.call({ tool: "search", params: { q: "same", requestId: "two" } }, async () => ({ ok: true }));
      expect(two).toMatchObject({ forwarded: false, request: { reasonCode: "R3_NEAR_DUPLICATE_NO_PROGRESS" } });
    } finally { f.ledger.close(); }
  });

  it("serializes simultaneous distinct purchases against a shared cap", async () => {
    const f = fixture(undefined, "task_budget_usd: 1\n");
    try {
      let executions = 0;
      const run = () => new Promise<{ ok: boolean }>((resolve) => setTimeout(() => { executions++; resolve({ ok: true }); }, 10));
      const results = await Promise.all([f.guard.call({ tool: "search", params: { q: "one" } }, run),
        f.guard.call({ tool: "search", params: { q: "two" } }, run)]);
      expect(executions).toBe(1);
      expect(results[1]?.request.reasonCode).toBe("R4_BUDGET_EXCEEDED");
    } finally { f.ledger.close(); }
  });

  it("invalidates approval if the repository changes while the human is deciding", async () => {
    let change = () => {};
    const f = fixture({ async requestApproval() { change(); return true; } });
    change = () => writeFileSync(join(f.directory, "tracked.txt"), "changed");
    try {
      const result = await f.guard.call({ tool: "search", params: {} }, async () => ({ ok: true }));
      expect(result).toMatchObject({ forwarded: false, request: { reasonCode: "APPROVAL_STALE" } });
    } finally { f.ledger.close(); }
  });

  it("fails closed on malformed hot-reloaded config without calling the provider", async () => {
    const f = fixture();
    try {
      writeFileSync(f.configPath, "task_budget_usd: not-money\n");
      const result = await f.guard.call({ tool: "search", params: {} }, async () => ({ ok: true }));
      expect(result).toMatchObject({ forwarded: false, request: { reasonCode: "INTERNAL_ERROR" } });
    } finally { f.ledger.close(); }
  });

  it("checks ledger integrity before authorization", async () => {
    const f = fixture();
    try {
      f.ledger.unsafeDatabaseForTests().prepare("UPDATE tasks SET budget_cap = 999").run();
      const result = await f.guard.call({ tool: "search", params: {} }, async () => ({ ok: true }));
      expect(result.forwarded).toBe(false);
      expect(result.error).toContain("integrity");
    } finally { f.ledger.close(); }
  });

  it("refuses a second executing guard on the same ledger", () => {
    const f = fixture();
    const second = new Ledger(f.ledger.path);
    try { expect(() => new SpendGuard(f.configPath, second, new FixedApprovalChannel(true))).toThrow("Another Spend Guard"); }
    finally { second.close(); f.ledger.close(); }
  });

  it("escalates a configurable run of distinct calls without repository progress", async () => {
    let prompts = 0;
    const f = fixture({ async requestApproval() { return ++prompts === 1; } }, "max_calls_without_progress: 2\n");
    try {
      await f.guard.call({ tool: "search", params: { q: "one" } }, async () => ({ ok: true }));
      await f.guard.call({ tool: "search", params: { q: "two" } }, async () => ({ ok: true }));
      const third = await f.guard.call({ tool: "search", params: { q: "three" } }, async () => ({ ok: true }));
      expect(third).toMatchObject({ forwarded: false, request: { reasonCode: "R3A_NO_PROGRESS_LIMIT" } });
    } finally { f.ledger.close(); }
  });

  it("uses exact micro-USD arithmetic at decimal budget boundaries", async () => {
    const f = fixture(undefined, "task_budget_usd: 0.3\n");
    try {
      await f.guard.call({ tool: "search", price: 0.1, params: { q: "one" } }, async () => ({ ok: true }));
      const two = await f.guard.call({ tool: "search", price: 0.2, params: { q: "two" } }, async () => ({ ok: true }));
      expect(two.forwarded).toBe(true);
      expect(microUsd(0.3)).toBe(300_000);
      expect(() => microUsd(0.0000001)).toThrow();
    } finally { f.ledger.close(); }
  });

  it("includes provider identity in exact fingerprints", () => {
    const f = fixture();
    try {
      const input = { tool: "search", params: {}, repoPath: f.directory, trackedPaths: ["tracked.txt"] };
      expect(fingerprintRequest({ ...input, provider: "one" }).fingerprint)
        .not.toBe(fingerprintRequest({ ...input, provider: "two" }).fingerprint);
    } finally { f.ledger.close(); }
  });

  it("rejects misspelled policy keys instead of silently ignoring them", () => {
    const f = fixture();
    try {
      writeFileSync(f.configPath, `${readFileSync(f.configPath, "utf8")}task_budegt_usd: 100\n`);
      expect(() => loadConfig(f.configPath)).toThrow();
    } finally { f.ledger.close(); }
  });
});
