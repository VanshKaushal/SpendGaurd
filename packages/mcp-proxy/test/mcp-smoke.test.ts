import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { Ledger } from "../src/ledger.js";
import { sha256 } from "../src/fingerprint.js";

it("republishes tool schemas, forwards an authorized stdio call, and blocks a duplicate through MCP", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spendguard-mcp-smoke-"));
  writeFileSync(join(directory, "tracked.txt"), "state");
  const fixture = fileURLToPath(new URL("./fixtures/mock-upstream.ts", import.meta.url));
  const proxy = fileURLToPath(new URL("../src/server.ts", import.meta.url));
  const tsx = resolve("node_modules/tsx/dist/cli.mjs");
  const config = join(directory, "spendguard.config.yaml");
  const quote = (value: string) => JSON.stringify(value);
  writeFileSync(config, `
task_budget_usd: 10
soft_approval_threshold_usd: 2
max_failed_attempts: 3
provider_allowlist: [mock-provider]
duplicate_window: task_lifetime
verification_full_threshold_usd: 2
task_id: smoke
task_description: MCP smoke
repo_path: .
tracked_paths: [tracked.txt]
agent_id: mcp:smoke
repo_id: smoke-repo
provider:
  id: mock-provider
  transport: stdio
  command: ${quote(process.execPath)}
  args: [${quote(tsx)}, ${quote(fixture)}]
tool_prices_usd:
  paid-search: 1
remote_sync:
  enabled: false
  directory: backups
`);
  // Model a previous explicit approval so the stdio integration needs no interactive terminal.
  const ledgerPath = join(directory, "ledger.db");
  const ledger = new Ledger(ledgerPath);
  const now = new Date().toISOString();
  ledger.ensureTask({ id: "smoke", repo: directory, repoId: "smoke-repo", agentId: "mcp:smoke", description: "MCP smoke",
    budgetCap: 10, startStateHash: "previous-state", createdAt: now });
  ledger.recordRequest({ id: "previous-explicit-approval", taskId: "smoke", repoId: "smoke-repo", agentId: "mcp:smoke",
    sessionId: "previous-session", tool: "paid-search", provider: "mock-provider", paramsHash: "previous", fingerprint: "previous",
    nearDuplicateKey: "previous", repoStateHash: "previous-state", price: 0, decision: "require_approval",
    reasonCode: "R1A_NOVEL_PROVIDER", reason: "Test fixture: previously approved provider/tool", approvalGranted: true,
    configHash: sha256(readFileSync(config)), heartbeatPresent: true, timestamp: now });
  ledger.close();
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [tsx, proxy, "--config", config, "--ledger", join(directory, "ledger.db")], stderr: "pipe" });
  const client = new Client({ name: "spend-guard-smoke-client", version: "1.0.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: "paid-search", description: "A mock paid search tool",
      inputSchema: { type: "object", required: ["query"] } });
    const allowed = await client.callTool({ name: "paid-search", arguments: { query: "integration query" } });
    expect(allowed).toMatchObject({ structuredContent: { answer: "integration query" } });
    const duplicate = await client.callTool({ name: "paid-search", arguments: { query: "integration query" } });
    expect(duplicate).toMatchObject({ isError: true });
    expect(JSON.stringify(duplicate.content)).toContain("already seen");
  } finally {
    await client.close();
  }
}, 20_000);
