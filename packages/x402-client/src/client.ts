import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SpendGuard, type GuardCallResult } from "../../mcp-proxy/src/guard.js";
import { canonicalizeParams } from "../../mcp-proxy/src/fingerprint.js";
import { microUsd } from "../../mcp-proxy/src/money.js";

const requirementSchema = z.object({ scheme: z.literal("exact"), network: z.string(), amount: z.string().regex(/^\d+$/u),
  asset: z.string().min(1), payTo: z.string().min(1), maxTimeoutSeconds: z.number().int().positive(),
  extra: z.record(z.string(), z.unknown()).optional() }).passthrough();
const requiredSchema = z.object({ x402Version: z.literal(2), resource: z.object({ url: z.url() }).passthrough(),
  accepts: z.array(requirementSchema).min(1), extensions: z.record(z.string(), z.unknown()).optional() }).passthrough();
export type PaymentRequired = z.infer<typeof requiredSchema>;
export type PaymentRequirements = z.infer<typeof requirementSchema>;

/** The caller supplies a wallet/SDK integration. Spend Guard never receives wallet private keys. */
export interface ExternalX402Signer {
  createPaymentPayload(required: PaymentRequired): Promise<{
    x402Version: 2; accepted: PaymentRequirements; payload: Record<string, unknown>;
    resource?: Record<string, unknown>; extensions?: Record<string, unknown>;
  }>;
}
export interface SolanaPaymentPolicy {
  network: string;
  /** Explicitly pin a trusted six-decimal USDC mint; never trust the provider's token label. */
  asset: string;
  allowedRecipients: string[];
  /** A user-supplied conservative USD valuation. No price oracle or guaranteed peg is claimed. */
  usdPerToken: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
}
export interface PaidResource { status: number; bodyBase64: string; receipt: Record<string, unknown> | null; isError: boolean }

function decodeHeader(value: string): unknown {
  if (value.length > 64 * 1024 || !/^[A-Za-z0-9+/=_-]+$/u.test(value)) throw new Error("Invalid x402 header");
  return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as unknown;
}
async function boundedBody(response: Response, maximum: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw new Error("Paid resource exceeds the response limit");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel(); }
}

/** x402 v2 GET resources, exact Solana USDC quotes, one signed retry, external signer. */
export class GuardedSolanaX402Client {
  constructor(private readonly guard: SpendGuard, private readonly signer: ExternalX402Signer,
    private readonly paymentPolicy: SolanaPaymentPolicy, private readonly fetcher: typeof fetch = fetch) {
    if (!/^solana:[A-Za-z0-9]+$/u.test(paymentPolicy.network) || !paymentPolicy.asset || !paymentPolicy.allowedRecipients.length ||
      paymentPolicy.usdPerToken <= 0) throw new Error("Pin a Solana network, USDC mint, recipient allowlist, and positive USD valuation");
    microUsd(paymentPolicy.usdPerToken);
  }

  async get(resourceUrl: string): Promise<GuardCallResult<PaidResource>> {
    const url = new URL(resourceUrl);
    if (url.username || url.password || url.hash || (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)))) throw new Error("Use HTTPS or explicit loopback development URLs");
    const timeoutMs = this.paymentPolicy.timeoutMs ?? 30_000;
    const probe = await this.fetcher(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    if (probe.status !== 402) { await probe.body?.cancel(); throw new Error(`Expected an unsigned x402 challenge, received HTTP ${probe.status}`); }
    const header = probe.headers.get("payment-required");
    await probe.body?.cancel();
    if (!header) throw new Error("Missing x402 v2 PAYMENT-REQUIRED header");
    const required = requiredSchema.parse(decodeHeader(header));
    if (new URL(required.resource.url).href !== url.href) throw new Error("Payment challenge refers to a different resource");
    const requirement = required.accepts.find((entry) => entry.network === this.paymentPolicy.network &&
      entry.asset === this.paymentPolicy.asset && this.paymentPolicy.allowedRecipients.includes(entry.payTo));
    if (!requirement) throw new Error("No quote matches the pinned network, asset, and recipient policy");
    const atomic = BigInt(requirement.amount);
    const rate = BigInt(microUsd(this.paymentPolicy.usdPerToken));
    const estimatedMicros = (atomic * rate + 999_999n) / 1_000_000n;
    if (atomic === 0n || estimatedMicros > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Quote amount is invalid or too large");
    const price = Number(estimatedMicros) / 1_000_000;
    const pinned = { ...required, accepts: [requirement] };
    const issuedAt = Date.now();
    return this.guard.call({ tool: `HTTP GET ${url.pathname}`, provider: url.hostname, price,
      params: { url: url.href, network: requirement.network, asset: requirement.asset, payTo: requirement.payTo } }, async () => {
      // This callback is invoked only after policy and human approval, inside the guard's serial queue.
      if (Date.now() - issuedAt >= requirement.maxTimeoutSeconds * 1000) throw new Error("Payment quote expired while waiting for authorization");
      const payment = await this.signer.createPaymentPayload(structuredClone(pinned));
      if (payment.x402Version !== 2 || canonicalizeParams(payment.accepted) !== canonicalizeParams(requirement) ||
        !payment.payload || typeof payment.payload !== "object") throw new Error("External signer changed the authorized payment requirements");
      const signature = Buffer.from(JSON.stringify(payment)).toString("base64");
      if (signature.length > 128 * 1024) throw new Error("External signer returned an oversized payment");
      const response = await this.fetcher(url, { method: "GET", redirect: "manual",
        headers: { "PAYMENT-SIGNATURE": signature }, signal: AbortSignal.timeout(timeoutMs) });
      const bytes = await boundedBody(response, this.paymentPolicy.maxResponseBytes ?? 5 * 1024 * 1024);
      const encodedReceipt = response.headers.get("payment-response");
      let receipt: Record<string, unknown> | null = null;
      if (encodedReceipt) {
        receipt = z.object({ success: z.boolean(), transaction: z.string(), network: z.string() }).passthrough().parse(decodeHeader(encodedReceipt));
        if (receipt.network !== requirement.network) throw new Error("Receipt network differs from the authorized quote");
        this.guard.ledger.flag({ id: randomUUID(), code: "X402_PROVIDER_RECEIPT", detail: JSON.stringify(receipt), timestamp: new Date().toISOString() });
      }
      return { status: response.status, bodyBase64: bytes.toString("base64"), receipt,
        isError: !response.ok || !receipt || receipt.success !== true };
    });
  }
}
