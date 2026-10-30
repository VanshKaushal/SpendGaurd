import { Client, StreamableHTTPClientTransport, type CallToolResult, type Tool } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import type { ProviderConfig } from "./types.js";

export class McpForwarder {
  private readonly client = new Client({ name: "spend-guard-upstream-client", version: "0.3.0" });
  private transport?: StdioClientTransport | StreamableHTTPClientTransport;

  async connect(provider: ProviderConfig): Promise<void> {
    this.transport = provider.transport === "http"
      ? new StreamableHTTPClientTransport(new URL(provider.url), { requestInit: { headers: provider.headers ?? {} } })
      : new StdioClientTransport({
      command: provider.command,
      args: provider.args,
      env: { ...getDefaultEnvironment(), ...provider.env },
      ...(provider.cwd ? { cwd: provider.cwd } : {}),
      stderr: "inherit",
    });
    await this.client.connect(this.transport);
  }

  async listTools(): Promise<Tool[]> {
    const tools: Tool[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await this.client.listTools(cursor ? { cursor } : {});
      tools.push(...page.tools);
      cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error("Provider returned a repeated tool-list cursor");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return this.client.callTool({ name, arguments: args });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
