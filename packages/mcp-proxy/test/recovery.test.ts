import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { Ledger } from "../src/ledger.js";
import { SpendGuard } from "../src/guard.js";
import { FixedApprovalChannel } from "../src/approval.js";

it("keeps crash-interrupted authorizations reserved after reopening and exposes them without retrying", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spendguard-recovery-"));
  const path = join(dir, "ledger.db"); const config = join(dir, "config.yaml");
  writeFileSync(join(dir, "tracked.txt"), "state");
  writeFileSync(config, "task_id: recovery\nrepo_path: .\ntracked_paths: [tracked.txt]\ntask_budget_usd: 1\nprovider_allowlist: [provider]\nprovider: {id: provider, transport: stdio, command: node}\ntool_prices_usd: {search: 1}\n");
  let ledger = new Ledger(path);
  try {
    const guard = new SpendGuard(config, ledger, new FixedApprovalChannel(true));
    const first = await guard.call({ tool: "search", price: 0, params: { q: "one" } }, async () => ({ ok: true }));
    // Model the durable boundary after authorization and before a provider outcome is recorded.
    const pending = { ...first.request, id: "interrupted-request", price: 1, timestamp: new Date().toISOString() };
    ledger.recordRequest(pending); ledger.close(); ledger = new Ledger(path);
    expect(ledger.unresolved()).toMatchObject([{ id: "interrupted-request", reserved_usd: 1 }]);
    const restarted = new SpendGuard(config, ledger, new FixedApprovalChannel(true)); let callbacks = 0;
    const result = await restarted.call({ tool: "search", params: { q: "two" } }, async () => { callbacks++; });
    expect(result.request.reasonCode).toBe("R4_BUDGET_EXCEEDED"); expect(callbacks).toBe(0);
    expect(ledger.verifyChain().valid).toBe(true);
  } finally { ledger.close(); rmSync(dir, { recursive: true, force: true }); }
});
