import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { canonicalizeParams, fingerprintRequest, sha256 } from "./fingerprint.js";
import { captureEvidence, captureTestSignals } from "./evidence.js";
import { Ledger } from "./ledger.js";
import { PolicyEngine } from "./policy-engine.js";
import type { ApprovalChannel, PaidRequest, PolicyDecision, SpendGuardConfig } from "./types.js";
import { HotReloadingConfig } from "../../policy-dsl/src/config.js";

export interface GuardCallResult<T> {
  forwarded: boolean;
  result?: T;
  error?: string;
  request: PaidRequest;
}

function safeJson(value: unknown): string {
  try { return canonicalizeParams(value); } catch { return String(value); }
}

export class SpendGuard {
  private readonly configSource: HotReloadingConfig;
  private readonly sessionId = randomUUID();
  private readonly policy: PolicyEngine;
  private readonly initialConfig: SpendGuardConfig;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly configPath: string, readonly ledger: Ledger, private readonly approval: ApprovalChannel) {
    this.configSource = new HotReloadingConfig(configPath);
    this.policy = new PolicyEngine(() => this.resolvedConfig(), (input, since) => this.ledger.policyHistory(input, since));
    const config = this.resolvedConfig();
    this.initialConfig = config;
    this.ledger.assertIntegrity();
    this.ledger.acquireExecution();
    const startStateHash = captureEvidence(config, this.configPath, false).repoStateHash;
    this.ledger.ensureTask({ id: config.task_id, repo: config.repo_path, repoId: config.repo_id, agentId: config.agent_id,
      description: config.task_description, budgetCap: config.task_budget_usd, startStateHash, createdAt: new Date().toISOString() });
    this.ledger.heartbeat({ id: randomUUID(), sessionId: this.sessionId, agentId: config.agent_id,
      repoId: config.repo_id, timestamp: new Date().toISOString() });
  }

  private resolvedConfig(): SpendGuardConfig {
    const config = this.configSource.read();
    const base = dirname(resolve(this.configPath));
    return {
      ...config,
      repo_path: resolve(base, config.repo_path),
      provider: { ...config.provider, ...("cwd" in config.provider && config.provider.cwd ? { cwd: resolve(base, config.provider.cwd) } : {}) },
      remote_sync: { ...config.remote_sync, directory: resolve(base, config.remote_sync.directory) },
      ...(config.verification ? { verification: { ...config.verification,
        ...(config.verification.cwd ? { cwd: resolve(base, config.verification.cwd) } : {}) } } : {}),
    };
  }

  config(): SpendGuardConfig { return this.resolvedConfig(); }

  private makeRequest(input: {
    tool: string; provider: string; params: unknown; price: number; decision: PolicyDecision;
    fingerprint: ReturnType<typeof fingerprintRequest>; approvalGranted: boolean | null; configHash: string;
  }): PaidRequest {
    const config = this.resolvedConfig();
    return {
      id: randomUUID(), taskId: config.task_id, repoId: config.repo_id, agentId: config.agent_id,
      sessionId: this.sessionId, tool: input.tool.toLowerCase(), provider: input.provider.toLowerCase(),
      paramsHash: input.fingerprint.paramsHash, fingerprint: input.fingerprint.fingerprint,
      nearDuplicateKey: input.fingerprint.nearDuplicateKey, repoStateHash: input.fingerprint.repoStateHash,
      price: input.price, decision: input.decision.decision, reasonCode: input.decision.reasonCode,
      reason: input.decision.reason, approvalGranted: input.approvalGranted,
      configHash: input.configHash,
      heartbeatPresent: this.ledger.hasHeartbeat(this.sessionId), timestamp: new Date().toISOString(),
    };
  }

  call<T>(input: { tool: string; params: unknown; provider?: string; price?: number }, forward: () => Promise<T>): Promise<GuardCallResult<T>> {
    let executed = false;
    const job = this.queue.then(() => this.callSerial(input, () => { executed = true; return forward(); })).catch((error: unknown) => {
      const config = this.initialConfig;
      const message = error instanceof Error ? error.message : String(error);
      const request: PaidRequest = { id: randomUUID(), taskId: config.task_id, repoId: config.repo_id,
        agentId: config.agent_id, sessionId: this.sessionId, tool: input.tool, provider: input.provider ?? config.provider.id,
        paramsHash: sha256("unavailable"), fingerprint: sha256("unavailable"), nearDuplicateKey: sha256("unavailable"),
        repoStateHash: sha256("unavailable"), price: 0, decision: "block", reasonCode: "INTERNAL_ERROR",
        reason: `${executed ? "Provider callback started; charge status may be unknown. " : ""}Internal failure; human review required: ${message}`, approvalGranted: null, configHash: "",
        heartbeatPresent: false, timestamp: new Date().toISOString() };
      try { this.ledger.recordRequest(request); } catch { /* audit failure must still block */ }
      return { forwarded: executed, error: request.reason, request } satisfies GuardCallResult<T>;
    });
    this.queue = job.then(() => undefined, () => undefined);
    return job;
  }

  private async callSerial<T>(input: { tool: string; params: unknown; provider?: string; price?: number }, forward: () => Promise<T>): Promise<GuardCallResult<T>> {
    this.ledger.assertIntegrity();
    const config = this.resolvedConfig();
    if (config.task_id !== this.initialConfig.task_id || config.repo_path !== this.initialConfig.repo_path ||
      canonicalizeParams(config.provider) !== canonicalizeParams(this.initialConfig.provider)) {
      throw new Error("Task, repository, and provider changes require restarting the proxy");
    }
    const provider = (input.provider ?? config.provider.id).toLowerCase();
    const configHash = sha256(readFileSync(this.configPath));
    const configuredPrice = input.price ?? config.tool_prices_usd[input.tool];
    const priceKnown = typeof configuredPrice === "number" && Number.isFinite(configuredPrice) && configuredPrice >= 0;
    const price = priceKnown ? configuredPrice : 0;
    const fingerprint = fingerprintRequest({ tool: input.tool, provider, params: input.params,
      repoPath: config.repo_path, trackedPaths: config.tracked_paths, configPath: this.configPath,
      ignoredParams: config.duplicate_ignored_params ?? [] });
    let decision: PolicyDecision = priceKnown
      ? this.policy.evaluate({ taskId: config.task_id, provider, tool: input.tool.toLowerCase(), price,
          fingerprint: fingerprint.fingerprint, nearDuplicateKey: fingerprint.nearDuplicateKey,
          repoStateHash: fingerprint.repoStateHash })
      : { decision: "block", reasonCode: "PRICE_UNKNOWN",
          reason: `No non-negative price is configured for tool ${input.tool}; human review is required` };

    const priorConfigHash = this.ledger.latestConfigHash(config.task_id);
    if (decision.decision === "allow" && priorConfigHash && priorConfigHash !== configHash) {
      decision = { decision: "require_approval", reasonCode: "R1D_CONFIG_CHANGED",
        reason: "Spend Guard policy configuration changed since the prior paid request" };
    }

    if (decision.decision === "allow") {
      const priorTests = this.ledger.latestTestEvidence(config.task_id);
      const currentTests = captureTestSignals(config, this.configPath);
      if (priorTests && priorTests.testFilesHash !== currentTests.hash && currentTests.assertions <= priorTests.assertionCount) {
        decision = { decision: "require_approval", reasonCode: "R1C_SUSPICIOUS_TEST_DELTA",
          reason: "Test files changed without a net increase in assertion signals since the prior paid outcome" };
      }
    }

    let approvalGranted: boolean | null = null;
    if (decision.decision === "require_approval") {
      approvalGranted = await this.approval.requestApproval({ taskId: config.task_id, paramsHash: fingerprint.paramsHash,
        fingerprint: fingerprint.fingerprint, configHash, provider, tool: input.tool, price,
        reasonCode: decision.reasonCode, reason: decision.reason });
    }
    if (approvalGranted) {
      const stateNow = fingerprintRequest({ tool: input.tool, provider, params: input.params,
        repoPath: config.repo_path, trackedPaths: config.tracked_paths, configPath: this.configPath,
        ignoredParams: config.duplicate_ignored_params ?? [] });
      if (configHash !== sha256(readFileSync(this.configPath)) || fingerprint.fingerprint !== stateNow.fingerprint) {
        decision = { decision: "block", reasonCode: "APPROVAL_STALE", reason: "Configuration, repository, or request arguments changed while waiting for approval; request again" };
        approvalGranted = false;
      } else {
        const checked = this.policy.evaluate({ taskId: config.task_id, provider, tool: input.tool.toLowerCase(), price,
          fingerprint: fingerprint.fingerprint, nearDuplicateKey: fingerprint.nearDuplicateKey, repoStateHash: fingerprint.repoStateHash });
        if (checked.decision === "block") { decision = checked; approvalGranted = false; }
      }
    }
    const request = this.makeRequest({ tool: input.tool, provider, params: input.params, price,
      decision, fingerprint, approvalGranted, configHash });
    this.ledger.recordRequest(request);
    if (!request.heartbeatPresent) {
      this.ledger.flag({ id: randomUUID(), requestId: request.id, code: "HEARTBEAT_MISSING",
        detail: "Paid action has no heartbeat in the current session; proxy bypass is possible", timestamp: new Date().toISOString() });
    }
    if (decision.decision === "block" || (decision.decision === "require_approval" && !approvalGranted)) {
      return { forwarded: false, error: decision.reason, request };
    }

    const fullVerification = price >= config.verification_full_threshold_usd;
    const before = captureEvidence(config, this.configPath, fullVerification);
    let providerSucceeded = false;
    let result: T | undefined;
    let providerError: unknown;
    try {
      result = await forward();
      providerSucceeded = !(result && typeof result === "object" && "isError" in result && result.isError === true);
    } catch (error) {
      providerError = error;
    }
    let after: ReturnType<typeof captureEvidence>;
    try { after = captureEvidence(config, this.configPath, fullVerification); }
    catch (error) {
      this.ledger.flag({ id: randomUUID(), requestId: request.id, code: "OUTCOME_CAPTURE_FAILED",
        detail: "Provider may already have charged; outcome evidence is unavailable", timestamp: new Date().toISOString() });
      return { forwarded: true, error: `Provider executed, but evidence capture failed: ${String(error)}`, request };
    }
    const suspiciousTestDelta = before.testFilesHash !== after.testFilesHash && after.assertionCount <= before.assertionCount;
    try { this.ledger.recordOutcome({ requestId: request.id, repoStateAfterHash: after.repoStateHash,
      testsBefore: before.tests, testsAfter: after.tests,
      diffSummary: `${before.repoStateHash} -> ${after.repoStateHash}\n${after.diffSummary}`,
      outputHash: sha256(providerError ? safeJson(providerError) : safeJson(result)), judgedUseful: null,
      testAssertionsBefore: before.assertionCount, testAssertionsAfter: after.assertionCount,
      testFilesHashAfter: after.testFilesHash,
      suspiciousTestDelta, providerSucceeded, timestamp: new Date().toISOString() }); }
    catch (error) { return { forwarded: true, error: `Provider executed, but ledger outcome write failed: ${String(error)}`, request }; }
    if (suspiciousTestDelta) {
      this.ledger.flag({ id: randomUUID(), requestId: request.id, code: "SUSPICIOUS_TEST_DELTA",
        detail: "Test files changed without a net increase in assertion signals; this is evidence for human review, not proof of quality",
        timestamp: new Date().toISOString() });
    }
    if (providerError) {
      return { forwarded: true, error: providerError instanceof Error ? providerError.message : String(providerError), request };
    }
    return { forwarded: true, result: result as T, request };
  }
}
