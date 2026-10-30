import { closeSync, createReadStream, openSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stderr } from "node:process";
import type { ApprovalChannel, ApprovalRequest } from "./types.js";
export { BrowserApprovalChannel } from "./browser-approval.js";

export class DenyApprovalChannel implements ApprovalChannel {
  async requestApproval(): Promise<boolean> {
    return false;
  }
}

/**
 * Uses the controlling terminal instead of process.stdin. In stdio MCP mode,
 * process.stdin belongs exclusively to JSON-RPC and must never be consumed by a prompt.
 */
export class TerminalApprovalChannel implements ApprovalChannel {
  constructor(private readonly timeoutMs = 60_000) {}
  async requestApproval(request: ApprovalRequest): Promise<boolean> {
    let fd: number | undefined;
    let input: ReturnType<typeof createReadStream> | undefined;
    let terminal: ReturnType<typeof createInterface> | undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      fd = openSync(process.platform === "win32" ? "CONIN$" : "/dev/tty", "r");
      input = createReadStream("", { fd, autoClose: false });
      terminal = createInterface({ input, output: stderr, terminal: true });
      stderr.write(`\nSpend Guard approval required\nTask: ${request.taskId ?? "unspecified"}\nRequest fingerprint: ${request.fingerprint ?? "unspecified"}\nProvider: ${request.provider}\nTool: ${request.tool}\n` +
        `Price: $${request.price.toFixed(4)}\nReason: ${request.reasonCode} — ${request.reason}\n`);
      const answer = (await terminal.question("Approve this paid action? [y/N] ", { signal: controller.signal })).trim().toLowerCase();
      return answer === "y" || answer === "yes";
    } catch {
      // No controlling TTY is an ambiguous state. Fail closed.
      return false;
    } finally {
      clearTimeout(timer);
      terminal?.close();
      input?.destroy();
      if (fd !== undefined) {
        try { closeSync(fd); } catch { /* stream may already have closed it */ }
      }
    }
  }
}

export class FixedApprovalChannel implements ApprovalChannel {
  constructor(private readonly answer: boolean) {}
  async requestApproval(): Promise<boolean> { return this.answer; }
}
