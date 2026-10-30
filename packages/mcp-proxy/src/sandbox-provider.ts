#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

/** Runnable onboarding provider. Prices are simulated; this process never purchases or accesses a network. */
export function createSandboxProvider(): McpServer {
  const server = new McpServer({ name: "spendguard-sandbox", version: "0.3.0" });
  server.registerTool("search", { description: "SIMULATED search for Spend Guard onboarding. No network or real charge.",
    inputSchema: { query: z.string().min(1).max(500) } }, async ({ query }) => ({
      content: [{ type: "text", text: JSON.stringify({ simulation: true, query,
        result: "Sandbox response: inspect the approval and local ledger, then repeat this query to observe a duplicate block." }) }],
    }));
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) serveStdio(createSandboxProvider);
