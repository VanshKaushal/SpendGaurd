import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalizeParams, fingerprintRequest } from "../src/fingerprint.js";

describe("fingerprinting", () => {
  it("canonicalizes recursively reordered JSON without changing string case", () => {
    const left = canonicalizeParams({ z: "CaseSensitive/Path", a: { y: 2, x: 1 } });
    const right = canonicalizeParams({ a: { x: 1, y: 2 }, z: "CaseSensitive/Path" });
    expect(left).toBe(right);
    expect(left).toContain("CaseSensitive/Path");
  });

  it("uses a stable exact and near-duplicate key for reordered params", () => {
    const repo = mkdtempSync(join(tmpdir(), "spendguard-fingerprint-"));
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "a.ts"), "export const A = 1;\n");
    const common = { tool: "PaidSearch", provider: "Example.COM", repoPath: repo, trackedPaths: ["src"] };
    const one = fingerprintRequest({ ...common, params: { q: "hello", options: { limit: 5, mode: "x" } } });
    const two = fingerprintRequest({ ...common, params: { options: { mode: "x", limit: 5 }, q: "hello" } });
    expect(one.fingerprint).toBe(two.fingerprint);
    expect(one.nearDuplicateKey).toBe(two.nearDuplicateKey);
  });

  it("ignores request-id differences only in the intentionally loose near key", () => {
    const repo = mkdtempSync(join(tmpdir(), "spendguard-near-"));
    writeFileSync(join(repo, "tracked.txt"), "same state");
    const common = { tool: "search", provider: "provider", repoPath: repo, trackedPaths: ["tracked.txt"] };
    const one = fingerprintRequest({ ...common, params: { requestId: "one", query: "x" } });
    const two = fingerprintRequest({ ...common, params: { requestId: "two", query: "x" } });
    expect(one.fingerprint).not.toBe(two.fingerprint);
    expect(one.nearDuplicateKey).toBe(two.nearDuplicateKey);
  });
});
