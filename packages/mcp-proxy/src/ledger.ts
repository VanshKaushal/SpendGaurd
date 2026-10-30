import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { backup, DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { sha256 } from "./fingerprint.js";
import type { Outcome, PaidRequest, PolicyHistory, Task } from "./types.js";

type DbRow = Record<string, SQLInputValue>;
const chainTables = new Map([["tasks", "id"], ["paid_requests", "id"], ["outcomes", "request_id"], ["heartbeats", "id"], ["audit_flags", "id"]]);

export interface ChainVerification {
  valid: boolean;
  checked: number;
  firstBrokenLink: number | null;
  message: string;
}

function canonicalRow(row: DbRow): string {
  return JSON.stringify(Object.fromEntries(Object.keys(row).sort().map((key) => [key, row[key]])));
}

export class Ledger {
  private readonly db: DatabaseSync;
  private executionToken: string | undefined;
  private readonly rowReaders = new Map<string, StatementSync>();

  constructor(readonly path: string) {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(resolve(path));
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;");
    this.migrate();
  }

  close(): void {
    if (this.executionToken) {
      this.db.prepare("DELETE FROM execution_owner WHERE token = ?").run(this.executionToken);
      this.executionToken = undefined;
    }
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, repo TEXT NOT NULL, repo_id TEXT NOT NULL, agent_id TEXT NOT NULL,
        description TEXT NOT NULL, budget_cap REAL NOT NULL, start_state_hash TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS paid_requests (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), repo_id TEXT NOT NULL, agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL, tool TEXT NOT NULL, provider TEXT NOT NULL, params_hash TEXT NOT NULL,
        fingerprint TEXT NOT NULL, near_duplicate_key TEXT NOT NULL, repo_state_hash TEXT NOT NULL,
        price REAL NOT NULL, decision TEXT NOT NULL, reason_code TEXT NOT NULL, reason TEXT NOT NULL,
        approval_granted INTEGER, config_hash TEXT NOT NULL DEFAULT '', ap2_mandate_ref TEXT,
        heartbeat_present INTEGER NOT NULL, timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_requests_fingerprint ON paid_requests(task_id, fingerprint);
      CREATE INDEX IF NOT EXISTS idx_requests_near ON paid_requests(task_id, near_duplicate_key, repo_state_hash);
      CREATE INDEX IF NOT EXISTS idx_requests_tool ON paid_requests(task_id, tool);
      CREATE INDEX IF NOT EXISTS idx_requests_decision ON paid_requests(task_id, decision);
      CREATE TABLE IF NOT EXISTS outcomes (
        request_id TEXT PRIMARY KEY REFERENCES paid_requests(id), repo_state_after_hash TEXT NOT NULL,
        tests_before TEXT, tests_after TEXT, diff_summary TEXT NOT NULL, output_hash TEXT NOT NULL,
        judged_useful INTEGER, test_assertions_before INTEGER, test_assertions_after INTEGER,
        test_files_hash_after TEXT NOT NULL DEFAULT '', suspicious_test_delta INTEGER NOT NULL,
        provider_succeeded INTEGER NOT NULL, timestamp TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS heartbeats (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, agent_id TEXT NOT NULL, repo_id TEXT NOT NULL, timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_heartbeat_session ON heartbeats(session_id);
      CREATE TABLE IF NOT EXISTS audit_flags (
        id TEXT PRIMARY KEY, request_id TEXT, code TEXT NOT NULL, detail TEXT NOT NULL, timestamp TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chain_link (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, row_id TEXT NOT NULL,
        prev_hash TEXT NOT NULL, row_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS execution_owner (id INTEGER PRIMARY KEY CHECK(id = 1), pid INTEGER NOT NULL, token TEXT NOT NULL);
    `);
    const outcomeColumns = this.db.prepare("PRAGMA table_info(outcomes)").all() as Array<{ name: string }>;
    if (!outcomeColumns.some((column) => column.name === "test_files_hash_after")) {
      this.db.exec("ALTER TABLE outcomes ADD COLUMN test_files_hash_after TEXT NOT NULL DEFAULT ''");
    }
    const requestColumns = this.db.prepare("PRAGMA table_info(paid_requests)").all() as Array<{ name: string }>;
    if (!requestColumns.some((column) => column.name === "config_hash")) {
      this.db.exec("ALTER TABLE paid_requests ADD COLUMN config_hash TEXT NOT NULL DEFAULT ''");
    }
  }

  /** One executing proxy per ledger; readers and reports may still open it. */
  acquireExecution(): void {
    if (this.executionToken) throw new Error("This ledger already has an executing guard");
    const token = randomUUID();
    this.transaction(() => {
      const owner = this.db.prepare("SELECT pid FROM execution_owner WHERE id = 1").get() as { pid: number } | undefined;
      if (owner) {
        let alive = true;
        try { process.kill(owner.pid, 0); }
        catch (error) { alive = !(error && typeof error === "object" && "code" in error && error.code === "ESRCH"); }
        if (alive) throw new Error("Another Spend Guard proxy owns this ledger. Stop it before starting a second proxy");
        this.db.prepare("DELETE FROM execution_owner WHERE id = 1").run();
      }
      this.db.prepare("INSERT INTO execution_owner(id, pid, token) VALUES (1, ?, ?)").run(process.pid, token);
    });
    this.executionToken = token;
  }

  private row(table: string, idColumn: string, id: string): DbRow {
    if (chainTables.get(table) !== idColumn) throw new Error("Invalid chain table");
    let reader = this.rowReaders.get(table);
    if (!reader) { reader = this.db.prepare(`SELECT * FROM ${table} WHERE ${idColumn} = ?`); this.rowReaders.set(table, reader); }
    // Cache the prepared query, never its result: every integrity check rereads every chained row.
    const value = reader.get(id) as DbRow | undefined;
    if (!value) throw new Error(`Cannot chain missing ${table} row ${id}`);
    return value;
  }

  private link(table: string, idColumn: string, id: string): void {
    const prior = this.db.prepare("SELECT row_hash FROM chain_link ORDER BY sequence DESC LIMIT 1").get() as
      | { row_hash: string }
      | undefined;
    const prevHash = prior?.row_hash ?? "GENESIS";
    const rowHash = sha256(`${canonicalRow(this.row(table, idColumn, id))}\0${prevHash}`);
    this.db.prepare("INSERT INTO chain_link(table_name, row_id, prev_hash, row_hash) VALUES (?, ?, ?, ?)")
      .run(table, id, prevHash, rowHash);
  }

  private transaction(action: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      action();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  ensureTask(task: Task): void {
    const exists = this.db.prepare("SELECT id FROM tasks WHERE id = ?").get(task.id);
    if (exists) return;
    this.transaction(() => {
      this.db.prepare(`INSERT INTO tasks
        (id, repo, repo_id, agent_id, description, budget_cap, start_state_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(task.id, task.repo, task.repoId, task.agentId, task.description, task.budgetCap, task.startStateHash, task.createdAt);
      this.link("tasks", "id", task.id);
    });
  }

  heartbeat(input: { id: string; sessionId: string; agentId: string; repoId: string; timestamp: string }): void {
    this.transaction(() => {
      this.db.prepare("INSERT INTO heartbeats(id, session_id, agent_id, repo_id, timestamp) VALUES (?, ?, ?, ?, ?)")
        .run(input.id, input.sessionId, input.agentId, input.repoId, input.timestamp);
      this.link("heartbeats", "id", input.id);
    });
  }

  hasHeartbeat(sessionId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM heartbeats WHERE session_id = ? LIMIT 1").get(sessionId));
  }

  recordRequest(request: PaidRequest): void {
    this.transaction(() => {
      this.db.prepare(`INSERT INTO paid_requests
        (id, task_id, repo_id, agent_id, session_id, tool, provider, params_hash, fingerprint,
         near_duplicate_key, repo_state_hash, price, decision, reason_code, reason, approval_granted,
         config_hash, ap2_mandate_ref, heartbeat_present, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(request.id, request.taskId, request.repoId, request.agentId, request.sessionId,
          request.tool, request.provider, request.paramsHash, request.fingerprint, request.nearDuplicateKey,
          request.repoStateHash, request.price, request.decision, request.reasonCode, request.reason,
          request.approvalGranted === null ? null : Number(request.approvalGranted), request.configHash,
          request.ap2MandateRef ?? null,
          Number(request.heartbeatPresent), request.timestamp);
      this.link("paid_requests", "id", request.id);
    });
  }

  recordOutcome(outcome: Outcome): void {
    this.transaction(() => {
      this.db.prepare(`INSERT INTO outcomes
        (request_id, repo_state_after_hash, tests_before, tests_after, diff_summary, output_hash, judged_useful,
         test_assertions_before, test_assertions_after, test_files_hash_after, suspicious_test_delta, provider_succeeded, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(outcome.requestId, outcome.repoStateAfterHash, outcome.testsBefore, outcome.testsAfter,
          outcome.diffSummary, outcome.outputHash, outcome.judgedUseful === null ? null : Number(outcome.judgedUseful),
          outcome.testAssertionsBefore, outcome.testAssertionsAfter, outcome.testFilesHashAfter, Number(outcome.suspiciousTestDelta),
          Number(outcome.providerSucceeded), outcome.timestamp);
      this.link("outcomes", "request_id", outcome.requestId);
    });
  }

  latestTestEvidence(taskId: string): { testFilesHash: string; assertionCount: number } | null {
    const row = this.db.prepare(`SELECT o.test_files_hash_after AS testFilesHash,
      o.test_assertions_after AS assertionCount FROM outcomes o
      JOIN paid_requests r ON r.id = o.request_id WHERE r.task_id = ?
      ORDER BY o.timestamp DESC LIMIT 1`).get(taskId) as { testFilesHash: string; assertionCount: number | null } | undefined;
    if (!row || row.assertionCount === null) return null;
    return { testFilesHash: row.testFilesHash, assertionCount: row.assertionCount };
  }

  latestConfigHash(taskId: string): string | null {
    const row = this.db.prepare("SELECT config_hash AS configHash FROM paid_requests WHERE task_id = ? ORDER BY timestamp DESC LIMIT 1")
      .get(taskId) as { configHash: string } | undefined;
    return row?.configHash || null;
  }

  flag(input: { id: string; requestId?: string; code: string; detail: string; timestamp: string }): void {
    this.transaction(() => {
      this.db.prepare("INSERT INTO audit_flags(id, request_id, code, detail, timestamp) VALUES (?, ?, ?, ?, ?)")
        .run(input.id, input.requestId ?? null, input.code, input.detail, input.timestamp);
      this.link("audit_flags", "id", input.id);
    });
  }

  policyHistory(input: {
    taskId: string; fingerprint: string; nearDuplicateKey: string; repoStateHash: string; tool: string; provider: string;
  }, since?: string): PolicyHistory {
    const authorized = " AND (decision = 'allow' OR approval_granted = 1)";
    const timeClause = `${authorized}${since ? " AND timestamp >= ?" : ""}`;
    const exactArgs = since ? [input.taskId, input.fingerprint, since] : [input.taskId, input.fingerprint];
    const exactFingerprintSeen = Boolean(this.db.prepare(
      `SELECT 1 FROM paid_requests WHERE task_id = ? AND fingerprint = ?${timeClause} LIMIT 1`,
    ).get(...exactArgs));
    const nearArgs = since
      ? [input.taskId, input.nearDuplicateKey, input.repoStateHash, since]
      : [input.taskId, input.nearDuplicateKey, input.repoStateHash];
    const nearDuplicateSeenWithSameState = Boolean(this.db.prepare(
      `SELECT 1 FROM paid_requests WHERE task_id = ? AND near_duplicate_key = ? AND repo_state_hash = ?${timeClause} LIMIT 1`,
    ).get(...nearArgs));
    const spend = this.db.prepare(`SELECT COALESCE(SUM(CAST(ROUND(price * 1000000) AS INTEGER)), 0) / 1000000.0 AS value FROM paid_requests
      WHERE task_id = ? AND (decision = 'allow' OR approval_granted = 1)`).get(input.taskId) as { value: number };
    const failures = this.db.prepare(`SELECT COUNT(*) AS value FROM outcomes o
      JOIN paid_requests r ON r.id = o.request_id WHERE r.task_id = ? AND r.tool = ? AND o.provider_succeeded = 0`)
      .get(input.taskId, input.tool) as { value: number };
    const toolSeenForTask = Boolean(this.db.prepare(
      `SELECT 1 FROM paid_requests WHERE task_id = ? AND provider = ? AND tool = ?${authorized} LIMIT 1`,
    ).get(input.taskId, input.provider, input.tool));
    const providerSeenForTask = Boolean(this.db.prepare(
      `SELECT 1 FROM paid_requests WHERE task_id = ? AND provider = ?${authorized} LIMIT 1`,
    ).get(input.taskId, input.provider));
    const noProgress = this.db.prepare(`SELECT COUNT(*) AS value FROM paid_requests
      WHERE task_id = ? AND repo_state_hash = ?${authorized}`).get(input.taskId, input.repoStateHash) as { value: number };
    return {
      exactFingerprintSeen,
      nearDuplicateSeenWithSameState,
      spentUsd: spend.value,
      priorFailedAttempts: failures.value,
      providerSeenForTask,
      toolSeenForTask,
      callsWithoutProgress: noProgress.value,
    };
  }

  verifyChain(): ChainVerification {
    const links = this.db.prepare("SELECT * FROM chain_link ORDER BY sequence").all() as Array<{
      sequence: number; table_name: string; row_id: string; prev_hash: string; row_hash: string;
    }>;
    let expectedPrev = "GENESIS";
    for (const [index, link] of links.entries()) {
      if (link.sequence !== index + 1) {
        return { valid: false, checked: index, firstBrokenLink: link.sequence, message: "Missing chain sequence" };
      }
      const idColumn = link.table_name === "outcomes" ? "request_id" : "id";
      let row: DbRow;
      try {
        row = this.row(link.table_name, idColumn, link.row_id);
      } catch {
        return { valid: false, checked: index, firstBrokenLink: link.sequence, message: "Chained row is missing" };
      }
      const expectedHash = sha256(`${canonicalRow(row)}\0${expectedPrev}`);
      if (link.prev_hash !== expectedPrev || link.row_hash !== expectedHash) {
        return { valid: false, checked: index, firstBrokenLink: link.sequence, message: "Hash-chain mismatch" };
      }
      expectedPrev = link.row_hash;
    }
    const rowCount = ["tasks", "paid_requests", "outcomes", "heartbeats", "audit_flags"].reduce((total, table) => {
      const count = this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      return total + count.n;
    }, 0);
    const duplicateLinks = this.db.prepare(`SELECT 1 FROM chain_link GROUP BY table_name, row_id HAVING COUNT(*) > 1 LIMIT 1`).get();
    if (rowCount !== links.length || duplicateLinks) {
      return { valid: false, checked: links.length, firstBrokenLink: null, message: "Unchained rows or duplicate chain links" };
    }
    return { valid: true, checked: links.length, firstBrokenLink: null, message: "Ledger chain is valid" };
  }

  assertIntegrity(): void {
    const status = this.verifyChain();
    if (!status.valid) throw new Error(`Ledger integrity check failed: ${status.message}`);
  }

  activity(limit = 100, taskId?: string): Array<Record<string, SQLInputValue>> {
    return this.db.prepare(`SELECT r.id, r.task_id, r.tool, r.provider, r.price, r.decision,
      r.reason_code, r.reason, r.approval_granted, r.timestamp, o.provider_succeeded, o.output_hash
      FROM paid_requests r LEFT JOIN outcomes o ON o.request_id = r.id
      ${taskId ? "WHERE r.task_id = ?" : ""} ORDER BY r.rowid DESC LIMIT ?`)
      .all(...(taskId ? [taskId] : []), Math.min(1000, Math.max(1, limit))) as Array<Record<string, SQLInputValue>>;
  }

  tasks(): Array<Record<string, SQLInputValue>> {
    return this.db.prepare("SELECT id, description, budget_cap, created_at FROM tasks ORDER BY rowid DESC").all() as Array<Record<string, SQLInputValue>>;
  }

  /** Authorized without an outcome can mean a crash before or after a provider charged. Never retry automatically. */
  unresolved(taskId?: string): Array<Record<string, SQLInputValue>> {
    this.assertIntegrity();
    return this.db.prepare(`SELECT r.id, r.task_id, r.provider, r.tool, r.price AS reserved_usd, r.timestamp
      FROM paid_requests r LEFT JOIN outcomes o ON o.request_id = r.id
      WHERE (r.decision = 'allow' OR r.approval_granted = 1) AND o.request_id IS NULL
      ${taskId ? "AND r.task_id = ?" : ""} ORDER BY r.rowid`).all(...(taskId ? [taskId] : [])) as Array<Record<string, SQLInputValue>>;
  }

  report(taskId?: string): {
    totalRequests: number; blocked: number; blockedUsd: number; requiredApproval: number; allowed: number;
    blockedByReason: Array<{ reasonCode: string; count: number; usd: number }>;
  } {
    const scope = taskId ? " WHERE task_id = ?" : "";
    const args = taskId ? [taskId] : [];
    const totals = this.db.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN decision = 'block' OR (decision = 'require_approval' AND approval_granted = 0) THEN 1 ELSE 0 END), 0) AS blocked,
      COALESCE(SUM(CASE WHEN decision = 'block' OR (decision = 'require_approval' AND approval_granted = 0) THEN price ELSE 0 END), 0) AS blocked_usd,
      COALESCE(SUM(CASE WHEN decision = 'require_approval' THEN 1 ELSE 0 END), 0) AS approvals,
      COALESCE(SUM(CASE WHEN decision = 'allow' OR approval_granted = 1 THEN 1 ELSE 0 END), 0) AS allowed
      FROM paid_requests${scope}`).get(...args) as { total: number; blocked: number; blocked_usd: number; approvals: number; allowed: number };
    const blockedByReason = this.db.prepare(`SELECT reason_code AS reasonCode, COUNT(*) AS count, SUM(price) AS usd
      FROM paid_requests WHERE (decision = 'block' OR (decision = 'require_approval' AND approval_granted = 0))
      ${taskId ? "AND task_id = ?" : ""} GROUP BY reason_code ORDER BY count DESC`).all(...args) as Array<{ reasonCode: string; count: number; usd: number }>;
    return {
      totalRequests: totals.total, blocked: totals.blocked, blockedUsd: totals.blocked_usd,
      requiredApproval: totals.approvals, allowed: totals.allowed, blockedByReason,
    };
  }

  async backupTo(directory: string): Promise<string> {
    mkdirSync(directory, { recursive: true });
    const destination = resolve(directory, `${Date.now()}-${basename(this.path)}`);
    // SQLite's backup API includes committed WAL pages; copying only the .db file would not.
    await backup(this.db, destination);
    return destination;
  }

  /** Test-only raw access, deliberately absent from runtime call paths. */
  unsafeDatabaseForTests(): DatabaseSync {
    return this.db;
  }
}
