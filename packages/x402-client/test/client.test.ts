import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Ledger } from "../../mcp-proxy/src/ledger.js";
import { SpendGuard } from "../../mcp-proxy/src/guard.js";
import { FixedApprovalChannel } from "../../mcp-proxy/src/approval.js";
import { GuardedSolanaX402Client, type ExternalX402Signer, type PaymentRequired } from "../src/client.js";

async function scenario(budget: number) {
  const dir = mkdtempSync(join(tmpdir(), "spendguard-x402-"));
  writeFileSync(join(dir, "tracked.txt"), "state");
  const config = join(dir, "config.yaml");
  writeFileSync(config, `task_id: x402-test\nrepo_path: .\ntracked_paths: [tracked.txt]\ntask_budget_usd: ${budget}\n` +
    "provider_allowlist: [127.0.0.1]\nprovider: {id: 127.0.0.1, transport: stdio, command: node}\n");
  const ledger = new Ledger(join(dir, "ledger.db"));
  const guard = new SpendGuard(config, ledger, new FixedApprovalChannel(true));
  let signedRequests = 0;
  let signerCalls = 0;
  let resource = "";
  const server = createServer((request, response) => {
    if (!request.headers["payment-signature"]) {
      const challenge: PaymentRequired = { x402Version: 2, resource: { url: resource }, accepts: [
        { scheme: "exact", network: "solana:TestNetwork", asset: "TestUsdcMint", payTo: "TestRecipient", amount: "250000", maxTimeoutSeconds: 60 },
      ] };
      response.writeHead(402, { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(challenge)).toString("base64") }).end();
    } else {
      signedRequests++;
      response.writeHead(200, { "PAYMENT-RESPONSE": Buffer.from(JSON.stringify({ success: true, transaction: "SIMULATED_RECEIPT", network: "solana:TestNetwork" })).toString("base64") }).end("paid data");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("No address");
  resource = `http://127.0.0.1:${addr.port}/data`;
  const signer: ExternalX402Signer = { async createPaymentPayload(required) {
    signerCalls++;
    return { x402Version: 2, accepted: required.accepts[0]!, payload: { transaction: "SIMULATED_SIGNATURE" } };
  } };
  const policy = { network: "solana:TestNetwork", asset: "TestUsdcMint", allowedRecipients: ["TestRecipient"], usdPerToken: 1 };
  return { ledger, resource, policy, guard, signer, counts: () => ({ signerCalls, signedRequests }),
    async close() { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); ledger.close(); } };
}

it("authorizes before invoking a signer, records a receipt, and prevents a duplicate signed retry", async () => {
  const s = await scenario(1);
  try {
    const client = new GuardedSolanaX402Client(s.guard, s.signer, s.policy);
    const one = await client.get(s.resource);
    const two = await client.get(s.resource);
    expect(one).toMatchObject({ forwarded: true, result: { status: 200, receipt: { transaction: "SIMULATED_RECEIPT" } } });
    expect(two.forwarded).toBe(false);
    expect(s.counts()).toEqual({ signerCalls: 1, signedRequests: 1 });
    expect(s.ledger.verifyChain().valid).toBe(true);
  } finally { await s.close(); }
});

it("does not call the signer or send payment when the discovered quote exceeds budget", async () => {
  const s = await scenario(0.1);
  try {
    const result = await new GuardedSolanaX402Client(s.guard, s.signer, s.policy).get(s.resource);
    expect(result.request.reasonCode).toBe("R4_BUDGET_EXCEEDED");
    expect(s.counts()).toEqual({ signerCalls: 0, signedRequests: 0 });
  } finally { await s.close(); }
});

it("rejects an unpinned payment recipient before signing", async () => {
  const s = await scenario(1);
  try {
    await expect(new GuardedSolanaX402Client(s.guard, s.signer, { ...s.policy, allowedRecipients: ["different"] }).get(s.resource)).rejects.toThrow("No quote");
    expect(s.counts()).toEqual({ signerCalls: 0, signedRequests: 0 });
  } finally { await s.close(); }
});

it("rejects signer mutation of the approved amount before sending payment", async () => {
  const s = await scenario(1);
  try {
    const signer: ExternalX402Signer = { async createPaymentPayload(required) {
      return { x402Version: 2, accepted: { ...required.accepts[0]!, amount: "99999999" }, payload: {} };
    } };
    const result = await new GuardedSolanaX402Client(s.guard, signer, s.policy).get(s.resource);
    expect(result.error).toContain("changed the authorized");
    expect(s.counts().signedRequests).toBe(0);
  } finally { await s.close(); }
});
