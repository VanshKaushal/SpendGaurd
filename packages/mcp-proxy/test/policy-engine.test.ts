import { describe, expect, it } from "vitest";
import { PolicyEngine } from "../src/policy-engine.js";
import type { DecisionInput, PolicyHistory, SpendGuardConfig } from "../src/types.js";

const input: DecisionInput = { taskId: "task", provider: "provider", tool: "tool", price: 1,
  fingerprint: "fp", nearDuplicateKey: "near", repoStateHash: "state" };
const history: PolicyHistory = { exactFingerprintSeen: false, nearDuplicateSeenWithSameState: false,
  spentUsd: 0, priorFailedAttempts: 0, providerSeenForTask: true, toolSeenForTask: true };
const config = {
  task_budget_usd: 10, soft_approval_threshold_usd: 2, max_failed_attempts: 3,
  provider_allowlist: ["provider"], duplicate_window: "task_lifetime", verification_full_threshold_usd: 2,
  task_id: "task", task_description: "test", repo_path: ".", tracked_paths: ["."], agent_id: "mcp:test",
  repo_id: "repo", provider: { id: "provider", transport: "stdio", command: "node", args: [] },
  tool_prices_usd: {}, remote_sync: { enabled: false, directory: "backups" },
} satisfies SpendGuardConfig;

function evaluate(historyOverride: Partial<PolicyHistory> = {}, configOverride: Partial<SpendGuardConfig> = {}, inputOverride: Partial<DecisionInput> = {}) {
  return new PolicyEngine(() => ({ ...config, ...configOverride }), () => ({ ...history, ...historyOverride }))
    .evaluate({ ...input, ...inputOverride });
}

describe("fixed-order deterministic policy", () => {
  it("R1 requires approval for a provider outside the allowlist", () =>
    expect(evaluate({}, { provider_allowlist: [] }).reasonCode).toBe("R1_PROVIDER_NOT_ALLOWED"));
  it("R1A requires approval for a provider new to this task", () =>
    expect(evaluate({ providerSeenForTask: false }).reasonCode).toBe("R1A_NOVEL_PROVIDER"));
  it("R1B requires approval for a novel tool", () =>
    expect(evaluate({ toolSeenForTask: false }).reasonCode).toBe("R1B_NOVEL_TOOL"));
  it("R2 blocks an exact duplicate", () =>
    expect(evaluate({ exactFingerprintSeen: true }).reasonCode).toBe("R2_EXACT_DUPLICATE"));
  it("R3 blocks near-duplicate no-progress spend", () =>
    expect(evaluate({ nearDuplicateSeenWithSameState: true }).reasonCode).toBe("R3_NEAR_DUPLICATE_NO_PROGRESS"));
  it("R4 blocks a request that would exceed the task cap", () =>
    expect(evaluate({ spentUsd: 9.5 }, {}, { price: 1 }).reasonCode).toBe("R4_BUDGET_EXCEEDED"));
  it("R5 requires approval after more than the configured failures", () =>
    expect(evaluate({ priorFailedAttempts: 4 }).reasonCode).toBe("R5_FAILED_ATTEMPTS_EXCEEDED"));
  it("R6 requires approval above the soft price threshold", () =>
    expect(evaluate({}, {}, { price: 2.01 }).reasonCode).toBe("R6_SOFT_PRICE_THRESHOLD"));
  it("R7 allows when no prior rule matches", () =>
    expect(evaluate()).toEqual({ decision: "allow", reasonCode: "R7_ALLOWED", reason: "All deterministic policy checks passed" }));
  it("fails closed on internal exceptions", () => {
    const decision = new PolicyEngine(() => { throw new Error("forced"); }, () => history).evaluate(input);
    expect(decision.decision).toBe("block");
    expect(decision.reasonCode).toBe("INTERNAL_ERROR");
  });
  it("fails closed on malformed prices", () => expect(evaluate({}, {}, { price: Number.NaN }).decision).toBe("block"));
});
