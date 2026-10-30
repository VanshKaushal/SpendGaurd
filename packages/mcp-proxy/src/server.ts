#!/usr/bin/env node
import { resolve } from "node:path";
import { stderr } from "node:process";
import { fileURLToPath } from "node:url";
import { McpServer, fromJsonSchema, type CallToolResult, type JsonSchemaType } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { TerminalApprovalChannel, BrowserApprovalChannel } from "./approval.js";
import { McpForwarder } from "./forward.js";
import { SpendGuard } from "./guard.js";
import { Ledger } from "./ledger.js";
import { loadConfig } from "../../policy-dsl/src/config.js";

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function toolError(message: string): CallToolResult {
  return { content: [{ type: "text", text: `Spend Guard blocked this paid action: ${message}` }], isError: true };
}

export async function startProxy(options?: { configPath?: string; ledgerPath?: string }): Promise<{
  close(): Promise<void>;
}> {
  const configPath = resolve(options?.configPath ?? argument("--config", process.env.SPENDGUARD_CONFIG ?? "spendguard.config.yaml"));
  const ledgerPath = resolve(options?.ledgerPath ?? argument("--ledger", process.env.SPENDGUARD_LEDGER ?? ".spendguard/ledger.db"));
  const ledger = new Ledger(ledgerPath);
  const forwarder = new McpForwarder();
  const mode = argument("--approval", "terminal");
  if (!["browser", "terminal"].includes(mode)) { ledger.close(); throw new Error("Use --approval browser or terminal"); }
  let timeout: number | undefined;
  try { timeout = loadConfig(configPath).approval_timeout_ms; } catch (error) { ledger.close(); throw error; }
  const approval = mode === "browser" ? new BrowserApprovalChannel(timeout) : new TerminalApprovalChannel(timeout);
  try {
  const guard = new SpendGuard(configPath, ledger, approval);
  if (approval instanceof BrowserApprovalChannel) await approval.start();
  await forwarder.connect(guard.config().provider);
  const upstreamTools = await forwarder.listTools();

  const buildServer = () => {
    const server = new McpServer({ name: "spend-guard", version: "0.3.0" });
    for (const tool of upstreamTools) {
      const inputSchema = fromJsonSchema(tool.inputSchema as JsonSchemaType);
      const outputSchema = tool.outputSchema ? fromJsonSchema(tool.outputSchema as JsonSchemaType) : undefined;
      server.registerTool(tool.name, {
        ...(tool.title ? { title: tool.title } : {}),
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema,
        ...(outputSchema ? { outputSchema } : {}),
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
        ...(tool._meta ? { _meta: tool._meta } : {}),
      }, async (args) => {
        const guarded = await guard.call({ tool: tool.name, params: args }, () =>
          forwarder.callTool(tool.name, args as Record<string, unknown>));
        if (!guarded.forwarded || guarded.error) return toolError(guarded.error ?? "Policy denied the request");
        return guarded.result as CallToolResult;
      });
    }
    return server;
  };

  const handle = serveStdio(buildServer, { onerror: (error) => stderr.write(`Spend Guard MCP error: ${error.message}\n`) });
  let syncTimer: NodeJS.Timeout | undefined;
  const syncConfig = guard.config().remote_sync;
  if (syncConfig.enabled) {
    // Scheduled snapshots provide an external tamper anchor without putting storage in the decision path.
    syncTimer = setInterval(() => {
      void ledger.backupTo(syncConfig.directory).catch((error: unknown) => {
        stderr.write(`Spend Guard backup failed: ${error instanceof Error ? error.message : String(error)}\n`);
      });
    }, 15 * 60_000);
    syncTimer.unref();
  }
  return {
    async close() {
      if (syncTimer) clearInterval(syncTimer);
      await handle.close();
      await forwarder.close();
      if (approval instanceof BrowserApprovalChannel) await approval.close();
      ledger.close();
    },
  };
  } catch (error) { await forwarder.close().catch(() => {}); if (approval instanceof BrowserApprovalChannel) await approval.close(); ledger.close(); throw error; }
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isEntrypoint) {
  startProxy().then((proxy) => {
    let stopping = false;
    const stop = () => { if (!stopping) { stopping = true; void proxy.close().finally(() => { process.exitCode = 0; }); } };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
  }).catch((error) => {
    stderr.write(`Spend Guard failed closed during startup: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
