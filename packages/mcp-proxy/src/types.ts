export type Decision = "allow" | "block" | "require_approval";

export type ReasonCode =
  | "R1_PROVIDER_NOT_ALLOWED"
  | "R1A_NOVEL_PROVIDER"
  | "R1B_NOVEL_TOOL"
  | "R1C_SUSPICIOUS_TEST_DELTA"
  | "R1D_CONFIG_CHANGED"
  | "R2_EXACT_DUPLICATE"
  | "R3_NEAR_DUPLICATE_NO_PROGRESS"
  | "R4_BUDGET_EXCEEDED"
  | "R5_FAILED_ATTEMPTS_EXCEEDED"
  | "R6_SOFT_PRICE_THRESHOLD"
  | "R7_ALLOWED"
  | "PRICE_UNKNOWN"
  | "INTERNAL_ERROR"
  | "APPROVAL_GRANTED"
  | "APPROVAL_DENIED"
  | "APPROVAL_STALE"
  | "R3A_NO_PROGRESS_LIMIT";

export interface Task {
  id: string;
  repo: string;
  repoId: string;
  agentId: string;
  description: string;
  budgetCap: number;
  startStateHash: string;
  createdAt: string;
}

export interface PaidRequest {
  id: string;
  taskId: string;
  repoId: string;
  agentId: string;
  sessionId: string;
  tool: string;
  provider: string;
  paramsHash: string;
  fingerprint: string;
  nearDuplicateKey: string;
  repoStateHash: string;
  price: number;
  decision: Decision;
  reasonCode: ReasonCode;
  reason: string;
  approvalGranted: boolean | null;
  configHash: string;
  ap2MandateRef?: string;
  heartbeatPresent: boolean;
  timestamp: string;
}

export interface Outcome {
  requestId: string;
  repoStateAfterHash: string;
  testsBefore: string | null;
  testsAfter: string | null;
  diffSummary: string;
  outputHash: string;
  judgedUseful: boolean | null;
  testAssertionsBefore: number | null;
  testAssertionsAfter: number | null;
  testFilesHashAfter: string;
  suspiciousTestDelta: boolean;
  providerSucceeded: boolean;
  timestamp: string;
}

export interface FingerprintResult {
  canonicalParams: string;
  paramsHash: string;
  repoStateHash: string;
  fingerprint: string;
  nearDuplicateKey: string;
}

export interface PolicyDecision {
  decision: Decision;
  reasonCode: ReasonCode;
  reason: string;
}

export interface ApprovalRequest {
  taskId?: string;
  paramsHash?: string;
  fingerprint?: string;
  configHash?: string;
  provider: string;
  tool: string;
  price: number;
  reasonCode: ReasonCode;
  reason: string;
}

export interface ApprovalChannel {
  requestApproval(request: ApprovalRequest): Promise<boolean>;
}

export type ProviderConfig = {
  id: string;
  transport: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
} | {
  id: string;
  transport: "http";
  url: string;
  headers?: Record<string, string>;
};

export interface VerificationConfig {
  command: string;
  args?: string[];
  cwd?: string;
  timeout_ms?: number;
}

export interface SpendGuardConfig {
  task_budget_usd: number;
  soft_approval_threshold_usd: number;
  max_failed_attempts: number;
  provider_allowlist: string[];
  duplicate_window: "task_lifetime" | string;
  verification_full_threshold_usd: number;
  task_id: string;
  task_description: string;
  repo_path: string;
  tracked_paths: string[];
  agent_id: string;
  repo_id: string;
  provider: ProviderConfig;
  tool_prices_usd: Record<string, number>;
  verification?: VerificationConfig;
  http_fallback?: {
    upstream_url: string;
    listen_port: number;
    max_body_bytes?: number;
    max_response_bytes?: number;
    timeout_ms?: number;
  };
  remote_sync: { enabled: boolean; directory: string };
  duplicate_ignored_params?: string[];
  max_calls_without_progress?: number;
  approval_timeout_ms?: number;
}

export interface PolicyHistory {
  exactFingerprintSeen: boolean;
  nearDuplicateSeenWithSameState: boolean;
  spentUsd: number;
  priorFailedAttempts: number;
  providerSeenForTask: boolean;
  toolSeenForTask: boolean;
  callsWithoutProgress?: number;
}

export interface DecisionInput {
  taskId: string;
  provider: string;
  tool: string;
  price: number;
  fingerprint: string;
  nearDuplicateKey: string;
  repoStateHash: string;
}

export interface SettlementAdapter {
  readonly name: string;
  authorize(request: PaidRequest): Promise<{ authorized: boolean; reference?: string }>;
}

/** Phase 1 is observation-only: Spend Guard never holds, moves, or releases funds. */
export class LogOnlySettlementAdapter implements SettlementAdapter {
  readonly name = "log-only";
  async authorize(): Promise<{ authorized: boolean }> {
    return { authorized: true };
  }
}

/** Stub only. Implementing settlement is explicitly gated on real partner demand. */
export interface SolanaPaySettlementAdapter extends SettlementAdapter {
  readonly name: "solana-pay";
}
