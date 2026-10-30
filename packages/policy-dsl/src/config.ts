import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { microUsd } from "../../mcp-proxy/src/money.js";
import { isoDurationStart } from "../../mcp-proxy/src/policy-engine.js";
import type { SpendGuardConfig } from "../../mcp-proxy/src/types.js";

const amount = z.number().nonnegative().refine((value) => {
  try { microUsd(value); return true; } catch { return false; }
}, "USD amounts must have at most six decimal places and fit safe integer arithmetic");
const name = z.string().trim().min(1);
const schema = z.object({
  task_budget_usd: amount.default(10), soft_approval_threshold_usd: amount.default(2),
  max_failed_attempts: z.number().int().nonnegative().default(3),
  provider_allowlist: z.array(name).default([]).transform((items) => items.map((item) => item.toLowerCase())),
  duplicate_window: z.string().refine((value) => {
    try { isoDurationStart(value); return true; } catch { return false; }
  },
    "Use task_lifetime or an ISO8601 duration such as PT10M").default("task_lifetime"),
  verification_full_threshold_usd: amount.default(2), task_id: name.default("default-task"),
  task_description: name.default("Spend Guard task"), repo_path: name.default("."),
  tracked_paths: z.array(name).min(1).default(["."]), agent_id: name.default("mcp:local"), repo_id: name.default("local-repo"),
  provider: z.discriminatedUnion("transport", [
    z.object({ id: name, transport: z.literal("stdio"), command: name, args: z.array(z.string()).default([]),
      env: z.record(z.string(), z.string()).optional(), cwd: name.optional() }).strict(),
    z.object({ id: name, transport: z.literal("http"), url: z.url().refine((value) => {
      const url = new URL(value); return url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    }, "Remote MCP providers require HTTPS"), headers: z.record(z.string(), z.string()).optional() }).strict(),
  ]),
  tool_prices_usd: z.record(name, amount).default({}),
  verification: z.object({ command: name, args: z.array(z.string()).optional(), cwd: name.optional(),
    timeout_ms: z.number().int().positive().max(600_000).optional() }).strict().optional(),
  http_fallback: z.object({ upstream_url: z.url(), listen_port: z.number().int().min(1).max(65535),
    max_body_bytes: z.number().int().positive().max(50 * 1024 * 1024).optional(),
    max_response_bytes: z.number().int().positive().max(50 * 1024 * 1024).optional(),
    timeout_ms: z.number().int().positive().max(120_000).optional() }).strict().optional(),
  remote_sync: z.object({ enabled: z.boolean().default(false), directory: name.default("remote-ledger-backups") })
    .strict().default({ enabled: false, directory: "remote-ledger-backups" }),
  duplicate_ignored_params: z.array(name).default(["requestId", "request_id", "traceId", "trace_id"]),
  max_calls_without_progress: z.number().int().positive().default(5),
  approval_timeout_ms: z.number().int().positive().max(600_000).default(60_000),
}).strict();

export function loadConfig(path: string): SpendGuardConfig {
  const parsed: unknown = YAML.parse(readFileSync(resolve(path), "utf8"));
  const config = schema.parse(parsed) as SpendGuardConfig;
  const expand = (value: string) => value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu, (_, key: string) => {
    const resolved = process.env[key];
    if (!resolved) throw new Error(`Missing provider environment variable: ${key}`);
    return resolved;
  });
  if (config.provider.transport === "stdio" && config.provider.env) {
    config.provider.env = Object.fromEntries(Object.entries(config.provider.env).map(([key, value]) => [key, expand(value)]));
  }
  if (config.provider.transport === "http" && config.provider.headers) {
    config.provider.headers = Object.fromEntries(Object.entries(config.provider.headers).map(([key, value]) => [key, expand(value)]));
  }
  return config;
}

export class HotReloadingConfig {
  constructor(readonly path: string) {}
  read(): SpendGuardConfig {
    return loadConfig(this.path);
  }
}
