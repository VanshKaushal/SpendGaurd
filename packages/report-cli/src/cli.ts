#!/usr/bin/env node
import { resolve } from "node:path";
import { stdout, stderr } from "node:process";
import { fileURLToPath } from "node:url";
import { Ledger } from "../../mcp-proxy/src/ledger.js";
import { existsSync } from "node:fs";
import { initialize, doctor, mcpRegistration } from "./setup.js";
import { runDemo } from "./demo.js";
import { startDashboard } from "./dashboard.js";

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

export function formatReport(summary: ReturnType<Ledger["report"]>): string {
  const lines = [
    "Spend Guard — spending-control report",
    `Total requests seen: ${summary.totalRequests}`,
    `Allowed/forwarded: ${summary.allowed}`,
    `Required approval: ${summary.requiredApproval}`,
    `Blocked/denied: ${summary.blocked}`,
    `Blocked-request price estimate: $${summary.blockedUsd.toFixed(2)}`,
  ];
  if (summary.blockedByReason.length) {
    lines.push("", "Blocked by reason:");
    for (const reason of summary.blockedByReason) {
      lines.push(`  ${reason.reasonCode}: ${reason.count} request(s), $${reason.usd.toFixed(2)}`);
    }
  }
  lines.push("", "Configured blocked prices are counterfactual estimates, not measured invoice savings. Execution evidence does not prove work quality.");
  return lines.join("\n");
}

export async function main(): Promise<number> {
  const command = process.argv[2] ?? "report";
  const configPath = resolve(option("--config", process.env.SPENDGUARD_CONFIG ?? "spendguard.config.yaml"));
  const ledgerPath = resolve(option("--ledger", process.env.SPENDGUARD_LEDGER ?? ".spendguard/ledger.db"));
  const json = process.argv.includes("--json");
  if (command === "help" || command === "--help") {
    stdout.write("Spend Guard 0.3.0\nCommands: init, doctor, mcp-config, demo, dashboard, report, verify, recover\nOptions: --config path --ledger path --repo path --task id --json --port number --approval terminal|browser\n"); return 0;
  }
  if (command === "init") {
    const sandbox = process.argv.includes("--sandbox");
    initialize(configPath, option("--repo", "."), sandbox);
    stdout.write(`Created ${configPath}\n${sandbox ? "SIMULATED local MCP provider configured. No real purchases." : "Edit provider and prices."}\nRun spendguard doctor. Existing files are never overwritten.\n`); return 0;
  }
  if (command === "doctor") {
    const checks = doctor(configPath);
    stdout.write(json ? `${JSON.stringify(checks, null, 2)}\n` : checks.map((check) => `${check.status.toUpperCase()} ${check.name}: ${check.detail}`).join("\n") + "\n");
    return checks.some((check) => check.status === "fail") ? 1 : 0;
  }
  if (command === "mcp-config") { loadValidatedConfig(); stdout.write(`${mcpRegistration(configPath, ledgerPath, option("--approval", "terminal"))}\n`); return 0; }
  function loadValidatedConfig() { const checks = doctor(configPath); if (checks.some((check) => check.status === "fail")) throw new Error("Run spendguard doctor and fix failing checks first"); }
  if (command === "demo") {
    const result = await runDemo();
    stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : "SIMULATION — no real purchases or network requests\n" +
      result.events.map((event) => `${event.forwarded ? "FORWARDED" : "BLOCKED"} ${event.label}: ${event.reason}`).join("\n") +
      `\n${formatReport(result.report)}\nLedger: ${result.ledgerPath}\nOpen: spendguard dashboard --ledger "${result.ledgerPath}"\n`); return 0;
  }
  if (!["report", "verify", "dashboard", "recover"].includes(command)) { stderr.write("Unknown command. Run spendguard help\n"); return 1; }
  if (!existsSync(ledgerPath)) throw new Error(`Ledger does not exist: ${ledgerPath}. Run spendguard demo or connect a provider first`);
  if (command === "dashboard") {
    const port = Number(option("--port", "4403"));
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port");
    const dashboard = await startDashboard(ledgerPath, port);
    stdout.write(`Read-only local dashboard: ${dashboard.url}\nKeep this authenticated URL private. Press Ctrl+C to stop.\n`);
    await new Promise<void>((done) => { const stop = () => { void dashboard.close().finally(done); }; process.once("SIGINT", stop); process.once("SIGTERM", stop); });
    return 0;
  }
  const ledger = new Ledger(ledgerPath);
  try {
    if (command === "recover") {
      const unresolved = ledger.unresolved(process.argv.includes("--task") ? option("--task", "") : undefined);
      const recovery = { unresolved, count: unresolved.length, budgetReleased: false, retried: false,
        nextAction: "Reconcile these request IDs against provider records. A missing outcome is not proof of no charge. Reservations remain; no request is retried." };
      stdout.write(json ? `${JSON.stringify(recovery, null, 2)}\n` : `${recovery.count} unresolved authorized request(s).\n${recovery.nextAction}\n${JSON.stringify(unresolved, null, 2)}\n`);
      return unresolved.length ? 2 : 0;
    }
    if (command === "report") {
      ledger.assertIntegrity();
      const summary = ledger.report(process.argv.includes("--task") ? option("--task", "") : undefined);
      stdout.write(json ? `${JSON.stringify(summary, null, 2)}\n` : `${formatReport(summary)}\n`);
      return 0;
    }
    if (command === "verify") {
      const verification = ledger.verifyChain();
      stdout.write(json ? `${JSON.stringify(verification, null, 2)}\n` : `${verification.message}; checked ${verification.checked} link(s)` +
        `${verification.firstBrokenLink === null ? "" : `; first broken link: ${verification.firstBrokenLink}`}\n`);
      return verification.valid ? 0 : 2;
    }
    stderr.write("Usage: spendguard <report|verify> [--ledger path]\n");
    return 1;
  } finally {
    ledger.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    stderr.write(`Spend Guard: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1;
  });
}
