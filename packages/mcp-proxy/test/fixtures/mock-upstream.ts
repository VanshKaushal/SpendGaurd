import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

serveStdio(() => {
  const server = new McpServer({ name: "mock-paid-provider", version: "1.0.0" });
  server.registerTool("paid-search", {
    description: "A mock paid search tool",
    inputSchema: z.object({ query: z.string(), limit: z.number().int().optional() }),
    outputSchema: z.object({ answer: z.string() }),
  }, async ({ query }) => ({
    content: [{ type: "text", text: query }],
    structuredContent: { answer: query },
  }));
  return server;
});
