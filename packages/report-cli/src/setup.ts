import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { loadConfig } from "../../policy-dsl/src/config.js";
import { computeRepoStateHash, sha256 } from "../../mcp-proxy/src/fingerprint.js";

export function initialize(configPath: string, repoPath: string, sandbox = false): void {
  if (existsSync(configPath)) throw new Error(`Configuration already exists: ${configPath}. Choose another --config path`);
  const repo = resolve(repoPath);
  if (!existsSync(repo)) throw new Error(`Repository does not exist: ${repo}`);
  mkdirSync(dirname(resolve(configPath)), { recursive: true });
  const providerScript = fileURLToPath(new URL(`../../mcp-proxy/src/sandbox-provider.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`, import.meta.url));
  writeFileSync(configPath, YAML.stringify({ task_id: `task-${randomUUID()}`, task_description: sandbox ? "SIMULATED local onboarding, no purchases" : "Describe the task being protected",
    repo_path: repo, repo_id: sha256(repo).slice(0, 16), tracked_paths: ["."], task_budget_usd: 5,
    soft_approval_threshold_usd: 1, max_failed_attempts: 3, max_calls_without_progress: 5,
    provider_allowlist: [sandbox ? "local-sandbox" : "REPLACE_WITH_PROVIDER_ID"], provider: sandbox
      ? { id: "local-sandbox", transport: "stdio", command: process.execPath, args: [...(import.meta.url.endsWith(".ts") ? ["--import", "tsx"] : []), providerScript] }
      : { id: "REPLACE_WITH_PROVIDER_ID", transport: "stdio", command: "node", args: ["REPLACE_WITH_PROVIDER_SCRIPT"] },
    tool_prices_usd: sandbox ? { search: 0.25 } : {},
    duplicate_window: "task_lifetime", verification_full_threshold_usd: 1,
    approval_timeout_ms: 60_000, remote_sync: { enabled: false, directory: ".spendguard/backups" } }), { flag: "wx", mode: 0o600 });
}

export interface DoctorCheck { name: string; status: "pass" | "warn" | "fail"; detail: string }
export function doctor(configPath: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "Node runtime", status: major >= 24 ? "pass" : "fail", detail: `Node ${process.versions.node}; requires 24+` });
  let config;
  try { config = loadConfig(configPath); checks.push({ name: "Policy schema", status: "pass", detail: "Configuration validated" }); }
  catch (error) { checks.push({ name: "Policy schema", status: "fail", detail: String(error) }); return checks; }
  const repo = resolve(dirname(configPath), config.repo_path);
  try { computeRepoStateHash(repo, config.tracked_paths, configPath); checks.push({ name: "Tracked repository", status: "pass", detail: repo }); }
  catch (error) { checks.push({ name: "Tracked repository", status: "fail", detail: String(error) }); }
  const placeholder = /REPLACE_|example\.com|path\/to\//u.test(JSON.stringify(config.provider));
  checks.push({ name: "Provider configured", status: placeholder ? "fail" : "pass", detail: placeholder ? "Replace the example provider first" : `${config.provider.id} (${config.provider.transport})` });
  checks.push({ name: "Tool prices", status: Object.keys(config.tool_prices_usd).length ? "pass" : "fail",
    detail: Object.keys(config.tool_prices_usd).length ? "Configured USD prices are maximum authorized estimates, not invoice reconciliation" : "Set tool_prices_usd; unknown prices always block" });
  checks.push({ name: "Provider allowlist", status: config.provider_allowlist.includes(config.provider.id.toLowerCase()) ? "pass" : "warn",
    detail: "A provider outside the allowlist requires approval on every purchase" });
  if (config.provider.transport === "stdio") {
    const command = config.provider.command;
    const found = spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], { windowsHide: true, encoding: "utf8" });
    checks.push({ name: "Provider executable", status: existsSync(command) || found.status === 0 ? "pass" : "fail", detail: command });
  }
  checks.push({ name: "Human approval", status: "warn", detail: "Terminal mode needs a controlling terminal. For IDE/headless sessions generate mcp-config --approval browser and open the private inbox URL from proxy stderr" });
  checks.push({ name: "Coverage boundary", status: "warn", detail: "Remove direct provider registration. Only proxied paid tools are covered; model tokens are excluded" });
  return checks;
}

export function mcpRegistration(configPath: string, ledgerPath: string, approvalMode = "terminal"): string {
  if (!["terminal", "browser"].includes(approvalMode)) throw new Error("Use --approval browser or terminal");
  const entry = fileURLToPath(new URL("../../mcp-proxy/src/server.js", import.meta.url));
  return JSON.stringify({ mcpServers: { "spend-guard": { type: "stdio", command: process.execPath,
    args: [entry, "--config", resolve(configPath), "--ledger", resolve(ledgerPath), "--approval", approvalMode] } } }, null, 2);
}
