import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import type { FingerprintResult } from "./types.js";

const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage", ".spendguard", "remote-ledger-backups"]);

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonicalValue(object[key])]));
  }
  return value;
}

/** Canonical JSON removes representational whitespace but preserves case-sensitive string content. */
export function canonicalizeParams(params: unknown): string {
  return JSON.stringify(canonicalValue(params ?? {}));
}

/** Ignore explicitly configured transport metadata, preserving meaningful arguments. */
export function equivalentParams(params: unknown, ignoredKeys: string[]): string {
  const ignored = new Set(ignoredKeys);
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !ignored.has(key)).map(([key, entry]) => [key, visit(entry)]));
    }
    return value;
  };
  return canonicalizeParams(visit(params));
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function walkFiles(root: string, current: string, output: string[]): void {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    if (entry.isFile() && /(?:\.db(?:-(?:shm|wal))?|\.log)$/iu.test(entry.name)) continue;
    const absolute = resolve(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walkFiles(root, absolute, output);
    else if (entry.isFile() && isInside(root, absolute)) output.push(relative(root, absolute).replaceAll("\\", "/"));
  }
}

function gitTrackedFiles(repoRoot: string, scopes: string[]): string[] | null {
  // Avoid process-spawn overhead for explicitly configured roots that are not Git repositories.
  // Worktrees are covered because `.git` may be either a directory or a pointer file.
  if (!existsSync(resolve(repoRoot, ".git"))) return null;
  const result = spawnSync("git", ["-C", repoRoot, "ls-files", "--cached", "--others", "--exclude-standard", "--", ...scopes], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/u).filter(Boolean);
}

export function listTaskFiles(repoPath: string, trackedPaths: string[], configPath?: string): string[] {
  const root = realpathSync(resolve(repoPath));
  const safeScopes = trackedPaths.map((scope) => {
    const candidate = resolve(root, scope);
    if (!isInside(root, candidate)) throw new Error(`Tracked path escapes repository: ${scope}`);
    return relative(root, candidate) || ".";
  });
  let files = gitTrackedFiles(root, safeScopes);
  if (!files) {
    files = [];
    for (const scope of safeScopes) {
      const absolute = resolve(root, scope);
      if (!existsSync(absolute)) continue;
      const stat = lstatSync(absolute);
      if (stat.isFile()) files.push(relative(root, absolute).replaceAll("\\", "/"));
      else if (stat.isDirectory()) walkFiles(root, absolute, files);
    }
  }
  if (configPath) {
    const absoluteConfig = resolve(configPath);
    if (existsSync(absoluteConfig) && isInside(root, absoluteConfig)) {
      files.push(relative(root, absoluteConfig).replaceAll("\\", "/"));
    }
  }
  return [...new Set(files)].sort();
}

export function computeRepoStateHash(repoPath: string, trackedPaths: string[], configPath?: string): string {
  const root = realpathSync(resolve(repoPath));
  const records = listTaskFiles(root, trackedPaths, configPath).map((path) => {
    const absolute = resolve(root, path);
    if (!isInside(root, absolute)) throw new Error("File escapes repository");
    if (!existsSync(absolute)) return `${path}\0DELETED`;
    const contentHash = lstatSync(absolute).isSymbolicLink()
      ? sha256(`SYMLINK:${readlinkSync(absolute)}`) : sha256(readFileSync(absolute));
    return `${path}\0${contentHash}`;
  });
  return sha256(records.join("\n"));
}

export function fingerprintRequest(input: {
  tool: string;
  provider: string;
  params: unknown;
  repoPath: string;
  trackedPaths: string[];
  configPath?: string;
  ignoredParams?: string[];
}): FingerprintResult {
  const tool = input.tool.toLowerCase();
  const provider = input.provider.toLowerCase();
  const canonicalParams = canonicalizeParams(input.params);
  const paramsHash = sha256(canonicalParams);
  const repoStateHash = computeRepoStateHash(input.repoPath, input.trackedPaths, input.configPath);
  return {
    canonicalParams,
    paramsHash,
    repoStateHash,
    fingerprint: sha256(`${tool}\0${provider}\0${canonicalParams}\0${repoStateHash}`),
    nearDuplicateKey: sha256(`${tool}\0${provider}\0${equivalentParams(input.params,
      input.ignoredParams ?? ["requestId", "request_id", "traceId", "trace_id"])}\0${repoStateHash}`),
  };
}
