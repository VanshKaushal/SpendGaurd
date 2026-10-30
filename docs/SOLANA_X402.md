# Solana / x402 integration (experimental, live payments deferred)

The `spend-guard/x402` export provides `GuardedSolanaX402Client` for x402 v2 GET resources, exact-scheme Solana quotes, and a caller-supplied wallet integration. Spend Guard never receives wallet private keys or broadcasts transactions itself.

It discovers a price without payment, validates a pinned network, trusted six-decimal USDC mint, and recipient allowlist, estimates USD cost, and asks Spend Guard for authorization. Only the authorized callback invokes the external signer. One signed retry is sent; provider receipts are recorded. Blocked duplicates do not call the signer.

```ts
import { SpendGuard } from 'spend-guard';
import { Ledger } from 'spend-guard/ledger';
import { TerminalApprovalChannel } from 'spend-guard/approval';
import { GuardedSolanaX402Client } from 'spend-guard/x402';

const ledger = new Ledger('.spendguard/ledger.db');
const guard = new SpendGuard('spendguard.config.yaml', ledger, new TerminalApprovalChannel());
const client = new GuardedSolanaX402Client(guard, {
  createPaymentPayload: (required) => externalWalletClient.createPaymentPayload(required),
}, {
  network: 'solana:YOUR_VERIFIED_NETWORK_REFERENCE',
  asset: 'YOUR_VERIFIED_USDC_MINT',
  allowedRecipients: ['YOUR_VERIFIED_PROVIDER_RECIPIENT'],
  usdPerToken: 1, // explicit valuation assumption, not a price oracle
});
try {
  const result = await client.get('https://your-provider.example/paid-resource');
  console.log(result.forwarded, result.request.reasonCode);
} finally { ledger.close(); }
```

Supply a real `externalWalletClient` from your wallet/official x402 SDK. The example does not supply a signer. Verify network/mint/recipient values independently. Network fees are outside quoted tool-price budgets. Matching payment metadata cannot prove that a signed transaction is safe; the external signer must inspect it.

Loopback tests use simulated signatures/receipts and prove ordering, hard caps, duplicate blocking, recipient pinning, and signer metadata checks. No devnet/mainnet transaction has been submitted or independently confirmed.

Before claiming live integration, connect a supported wallet/SDK, inspect a signed test transaction, validate the complete provider flow, and reconcile the receipt against an independent chain lookup.

References: https://solana.com/docs/payments/agentic-payments and https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md.
