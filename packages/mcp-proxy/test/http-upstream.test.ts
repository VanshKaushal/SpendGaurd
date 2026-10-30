import { createServer } from "node:http";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import { expect, it } from "vitest";
import { McpForwarder } from "../src/forward.js";

it("connects to an HTTP MCP provider with configured credentials and forwards tool results", async () => {
  const handler = createMcpHandler(() => {
    const mcp = new McpServer({ name: "http-test-provider", version: "1.0.0" });
    mcp.registerTool("paid-search", { inputSchema: z.object({ query: z.string() }) }, async ({ query }) => ({
      content: [{ type: "text", text: `result: ${query}` }],
    }));
    return mcp;
  }, { responseMode: "json" });
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.authorization !== "Bearer test-only-token") { response.writeHead(401).end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(key, value);
      const method = request.method ?? "GET";
      const fetchRequest = new Request(`http://${request.headers.host}${request.url}`, { method, headers,
        ...(method === "POST" ? { body: new Uint8Array(Buffer.concat(chunks)).buffer } : {}) });
      const result = await handler.fetch(fetchRequest);
      response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) { response.writeHead(500).end(String(error)); }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("Missing provider address");
  const forwarder = new McpForwarder();
  try {
    await forwarder.connect({ id: "remote-test-provider", transport: "http", url: `http://127.0.0.1:${address.port}/mcp`,
      headers: { Authorization: "Bearer test-only-token" } });
    expect(await forwarder.listTools()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "paid-search" })]));
    expect(await forwarder.callTool("paid-search", { query: "different useful query" })).toMatchObject({
      content: [{ type: "text", text: "result: different useful query" }],
    });
  } finally {
    await forwarder.close(); await handler.close(); server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
}, 20_000);
