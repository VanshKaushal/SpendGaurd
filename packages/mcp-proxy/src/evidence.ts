import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { computeRepoStateHash, listTaskFiles, sha256 } from "./fingerprint.js";
import type { SpendGuardConfig } from "./types.js";

export interface EvidenceSnapshot {
  repoStateHash: string;
  testFilesHash: string;
  assertionCount: number;
  tests: string | null;
  diffSummary: string;
}

function isTestFile(path: string): boolean {
  return /(^|\/)(__tests__\/|test\/|tests\/)|\.(test|spec)\.[cm]?[jt]sx?$/iu.test(path);
}

function testEvidence(repo: string, files: string[]): { hash: string; assertions: number } {
  let assertions = 0;
  const hashes: string[] = [];
  for (const path of files.filter(isTestFile)) {
    const absolute = resolve(repo, path);
    if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink()) continue;
    const content = readFileSync(absolute, "utf8");
    assertions += (content.match(/\b(?:expect|assert|it|test)\s*\(/gu) ?? []).length;
    hashes.push(`${path}\0${sha256(content)}`);
  }
  return { hash: sha256(hashes.sort().join("\n")), assertions };
}

export function captureTestSignals(config: SpendGuardConfig, configPath: string): { hash: string; assertions: number } {
  const repo = resolve(config.repo_path);
  return testEvidence(repo, listTaskFiles(repo, config.tracked_paths, configPath));
}

function runTests(config: SpendGuardConfig, repo: string): string | null {
  if (!config.verification) return null;
  const run = spawnSync(config.verification.command, config.verification.args ?? [], {
    cwd: resolve(repo, config.verification.cwd ?? "."), encoding: "utf8", windowsHide: true,
    timeout: config.verification.timeout_ms ?? 120_000, maxBuffer: 5 * 1024 * 1024,
  });
  const combined = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  return JSON.stringify({ status: run.status, signal: run.signal, outputHash: sha256(combined),
    timedOut: Boolean(run.error && "code" in run.error && run.error.code === "ETIMEDOUT") });
}

function workingDiff(repo: string): string {
  if (!existsSync(resolve(repo, ".git"))) return "No Git metadata; compare repository state hashes";
  const run = spawnSync("git", ["-C", repo, "diff", "--stat", "--", "."], { encoding: "utf8", windowsHide: true });
  return run.status === 0 ? run.stdout.trim() : "Git diff unavailable; compare repository state hashes";
}

export function captureEvidence(config: SpendGuardConfig, configPath: string, fullVerification: boolean): EvidenceSnapshot {
  const repo = resolve(config.repo_path);
  const tests = captureTestSignals(config, configPath);
  return {
    repoStateHash: computeRepoStateHash(repo, config.tracked_paths, configPath),
    testFilesHash: tests.hash,
    assertionCount: tests.assertions,
    tests: fullVerification ? runTests(config, repo) : null,
    diffSummary: workingDiff(repo),
  };
}
