import type { DecisionInput, PolicyDecision, PolicyHistory, SpendGuardConfig } from "./types.js";
import { microUsd } from "./money.js";

export type HistoryReader = (input: DecisionInput, since?: string) => PolicyHistory;
export type ConfigReader = () => SpendGuardConfig;

export function isoDurationStart(duration: string, now = new Date()): string | undefined {
  if (duration === "task_lifetime") return undefined;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/u.exec(duration);
  if (!match) throw new Error(`Invalid duplicate_window ISO8601 duration: ${duration}`);
  const milliseconds =
    Number(match[1] ?? 0) * 86_400_000 + Number(match[2] ?? 0) * 3_600_000 +
    Number(match[3] ?? 0) * 60_000 + Number(match[4] ?? 0) * 1_000;
  if (milliseconds <= 0) throw new Error("duplicate_window duration must be greater than zero");
  return new Date(now.getTime() - milliseconds).toISOString();
}

/** Deterministic only. LLM signals must never be an authorization gate. */
export class PolicyEngine {
  constructor(private readonly configReader: ConfigReader, private readonly historyReader: HistoryReader) {}

  evaluate(input: DecisionInput): PolicyDecision {
    try {
      const config = this.configReader(); // Intentionally hot-reloaded for every decision.
      const history = this.historyReader(input, isoDurationStart(config.duplicate_window));
      const provider = input.provider.toLowerCase();
      // Non-overridable limits run before any human-approval rule.
      const cost = microUsd(input.price);
      const spent = microUsd(history.spentUsd);
      const cap = microUsd(config.task_budget_usd);
      if (cost > cap - spent) {
        return { decision: "block", reasonCode: "R4_BUDGET_EXCEEDED",
          reason: `Request would exceed the $${config.task_budget_usd.toFixed(2)} task budget` };
      }
      if (history.exactFingerprintSeen) {
        return { decision: "block", reasonCode: "R2_EXACT_DUPLICATE",
          reason: "Exact paid request fingerprint was already seen in this task window" };
      }
      if (history.nearDuplicateSeenWithSameState) {
        return { decision: "block", reasonCode: "R3_NEAR_DUPLICATE_NO_PROGRESS",
          reason: "Equivalent paid request was already seen and repository state is unchanged" };
      }
      if (!config.provider_allowlist.includes(provider)) {
        return { decision: "require_approval", reasonCode: "R1_PROVIDER_NOT_ALLOWED",
          reason: `Provider ${input.provider} is not in the configured allowlist` };
      }
      if (!history.providerSeenForTask) {
        return { decision: "require_approval", reasonCode: "R1A_NOVEL_PROVIDER",
          reason: `Provider ${input.provider} has not previously been approved for this task` };
      }
      if (!history.toolSeenForTask) {
        return { decision: "require_approval", reasonCode: "R1B_NOVEL_TOOL",
          reason: `Tool ${input.tool} has not previously been approved for this task` };
      }
      if ((history.callsWithoutProgress ?? 0) >= (config.max_calls_without_progress ?? 5)) {
        return { decision: "require_approval", reasonCode: "R3A_NO_PROGRESS_LIMIT",
          reason: "Multiple paid calls occurred without a change to the tracked repository; review the task" };
      }
      if (history.priorFailedAttempts > 0 && history.priorFailedAttempts >= config.max_failed_attempts) {
        return { decision: "require_approval", reasonCode: "R5_FAILED_ATTEMPTS_EXCEEDED",
          reason: `${history.priorFailedAttempts} prior failures exceed the configured threshold` };
      }
      if (cost > microUsd(config.soft_approval_threshold_usd)) {
        return { decision: "require_approval", reasonCode: "R6_SOFT_PRICE_THRESHOLD",
          reason: `Price exceeds the $${config.soft_approval_threshold_usd.toFixed(2)} soft approval threshold` };
      }
      return { decision: "allow", reasonCode: "R7_ALLOWED", reason: "All deterministic policy checks passed" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { decision: "block", reasonCode: "INTERNAL_ERROR",
        reason: `Policy engine failed closed; human review required: ${message}` };
    }
  }
}
