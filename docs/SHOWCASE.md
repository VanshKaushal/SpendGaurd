# Spend Guard showcase

Spend Guard puts a deterministic spending decision between a coding agent and a paid tool. The strongest demonstration shows a permitted request, an equivalent retry stopped before provider execution, a different request permitted, and a hard budget enforced. It then connects those decisions to a ledger that the viewer can inspect.

This guide is a recording script and evidence map for the v0.3 local platform. Read final totals and status from the generated proof, not manually maintained claims in this document. Proof and public release references must identify the same release before sharing them. Payment collection, wallet work, and live Devnet/Mainnet activity are explicitly deferred; they are not acceptance gates for this release.

## What to say

> I built Spend Guard because a coding agent can repeat a paid tool call without making progress. It checks each routed purchase against a task budget, request history, and repository state before execution. It records why the request was allowed, blocked, or sent for human approval. You can try the real MCP transport with a bundled local provider and simulated prices, without a wallet or paid account.

Use “paid tool requests” rather than “all AI spending.” Model-token subscriptions, direct provider calls, and unrelated cloud bills are outside the proxy's coverage.

## Prepare before recording

Use Node.js 24 or later. From the `spend-guard` source directory, run these commands in PowerShell:

```powershell
node --version
npm.cmd ci
npm.cmd run verify
```

`verify` runs typecheck, the core and hosted API tests, build, the full dependency audit, benchmark, and clean-install release checks. It writes `release/platform-verification.json` only after those steps succeed. Read the generated artifact's runtime, timestamp, archive identity, results, and declared scope before recording. A failed later attempt does not erase an older successful file; an old file is not evidence for the failed run.

Installation and release verification may need network access. Some integration tests bind loopback servers. A network-permission failure is not a passing test and should be recorded separately from an application assertion failure. Use the audit result from the final lockfile; an old audit or a successful fresh install does not establish the checked-in lockfile's status.

Record the source revision and working-tree state with `git rev-parse HEAD` and `git status --short` where a Git checkout exists. If it does not, retain the source archive's SHA-256. Do not describe uncommitted changes as part of a published commit.

Keep the terminal large enough to read and close unrelated applications. Use demo data, not a customer's repository, credentials, or invoices. The dashboard's authenticated URL is a secret: do not put its token in a public video, screenshot, or transcript.

## Practical onboarding: use a coding agent without buying anything

The offline `demo` below is a scripted core walkthrough. The bundled sandbox is a separate onboarding path: it runs a real stdio MCP server whose `search` responses and prices are simulated. It makes no network search or purchase.

With the release package installed, run these commands from the repository your coding agent will use:

```powershell
spendguard init --sandbox --config .spendguard/sandbox.yaml --repo .
spendguard doctor --config .spendguard/sandbox.yaml
spendguard mcp-config --config .spendguard/sandbox.yaml --ledger .spendguard/sandbox.db --approval browser
```

In PowerShell, use `spendguard.cmd` if script execution is restricted. From a built source checkout, replace `spendguard` with `node dist/packages/report-cli/src/cli.js`. Initialization never overwrites an existing config; reuse it or choose another config path.

1. Merge the printed `mcpServers.spend-guard` entry into the agent's existing MCP configuration, preserving unrelated servers. See [AGENT_SETUP.md](AGENT_SETUP.md). Reload/reconnect the agent's MCP server after changing its configuration.
2. Ask the agent: “Call the search tool exposed by spend-guard with query `authentication bug`. Wait for my approval.” The first routed request should pause for review.
3. Open the local approval inbox URL printed to the proxy's stderr/MCP logs. Review task identity, fingerprint, config binding, provider, price, and expiry. Compare with the agent's tool request; raw arguments are intentionally omitted from the inbox. Choose **Approve once** or **Deny**. The capability URL is private, and each pending decision is expiring and one-use.
4. Repeat the same search to inspect a duplicate block, then use query `session cookie settings` to inspect a different request. These are actual MCP calls to the bundled local provider; their USD values are simulated.
5. Inspect the sandbox ledger rather than the scripted demo ledger:

```powershell
spendguard report --ledger .spendguard/sandbox.db --json
spendguard verify --ledger .spendguard/sandbox.db
spendguard recover --ledger .spendguard/sandbox.db --json
spendguard dashboard --ledger .spendguard/sandbox.db
```

`recover` is a read-only report of unresolved authorizations. Exit code 2 means unresolved entries exist; the command does not replay a request, retry a payment, or release a reservation. Exit code 0 means it found no unresolved entries, not that external invoices were reconciled. Keep dashboard and approval URLs private.

For a real paid provider later, create a separate configuration and ledger, explicitly review provider credentials, known maximum prices, task identity, and coverage, then follow [QUICKSTART.md](QUICKSTART.md). Wallet setup and payment collection are not needed to try the platform.

## A six-minute local demonstration

### 0:00–0:40 — problem and control point

Show this flow while describing one concrete failure: an agent repeats the same paid search after a failed build.

```text
Coding agent → Spend Guard → paid MCP provider
                    ├─ configured maximum price + task budget
                    ├─ fingerprints + tracked repository state
                    ├─ human approval when required
                    └─ SQLite decisions and execution evidence
```

Say: “This controls the calls that go through it. It is not a sandbox against another local process with the same access.”

### 0:40–2:10 — execute the actual local core

Use the compiled CLI from the checkout. This avoids depending on a global installation or an unpublished registry package:

```powershell
node dist/packages/report-cli/src/cli.js demo
```

The included scenario has a simulated $1 task budget, a $0.25 search, and a $3 sandbox request. It uses a fixed approval adapter for the demonstration; it does not show a person granting real terminal or IDE approval.

Walk through each event shown by the CLI:

| Event | Behavior to inspect | What it establishes |
| --- | --- | --- |
| First search | Forwarded after simulated approval | An approved, within-budget request reaches the simulated provider. |
| Exact retry | `R2_EXACT_DUPLICATE` | The repeated fingerprint is stopped. |
| Same query with changed request ID | `R3_NEAR_DUPLICATE_NO_PROGRESS` | Ignoring configured metadata can catch an equivalent retry. |
| Different query | Forwarded | Meaningful arguments survive normalization; unchanged repository state alone does not mean every request is a duplicate. |
| Sandbox above remaining budget | `R4_BUDGET_EXCEEDED` | A new tool and an approval channel cannot override the hard cap. |

Read the observed output, not a memorized pass statement. If it differs, stop and explain the difference. A forwarded demo callback is not a real tool purchase.

### 2:10–3:10 — inspect the evidence

Each demo run receives a new task ID. Scope the report to that task so earlier runs are not mistaken for the current recording:

```powershell
$showcaseRun = Get-Content -Raw -LiteralPath '.spendguard/demo/latest.json' | ConvertFrom-Json
node dist/packages/report-cli/src/cli.js report --ledger .spendguard/demo/ledger.db --task $showcaseRun.taskId --json
node dist/packages/report-cli/src/cli.js verify --ledger .spendguard/demo/ledger.db
```

Explain the difference between these values:

- Configured authorized price: a conservative budget reservation, including uncertain or failed provider outcomes.
- Blocked request value: the sum of configured prices for blocked or denied attempts. It is a counterfactual estimate, not reconciled invoice savings.
- Hash-chain verification: evidence that the checked ledger is internally consistent. A process with write access can replace the entire ledger; an independently retained snapshot is a different trust anchor.

Open the local read-only dashboard if useful:

```powershell
node dist/packages/report-cli/src/cli.js dashboard --ledger .spendguard/demo/ledger.db
```

Use the authenticated URL printed in your own terminal, select the current task, and inspect reasons and activity. Keep the URL token out of the recording. Press Ctrl+C when finished.

### 3:10–4:30 — show a failure that matters

Run the regression tests for the authorization boundary:

```powershell
npm.cmd test -- packages/mcp-proxy/test/safety-regression.test.ts
npm.cmd test -- packages/mcp-proxy/test/sandbox-smoke.test.ts
npm.cmd test -- packages/mcp-proxy/test/browser-approval.test.ts packages/mcp-proxy/test/recovery.test.ts
npm.cmd test -- packages/mcp-proxy/test/http-discovery.test.ts
npm.cmd test -- packages/x402-client/test/client.test.ts
```

Choose one test to explain in the editor: over-budget novelty must produce no approval prompt/provider execution; a repository change during approval invalidates the decision; denied attempts must not establish trust; or an over-budget x402 quote must produce zero signer invocations. Show the actual assertions and current result.

Use disposable test fixtures for tampering and failure injection. Do not edit a real-spend ledger to create a dramatic demonstration.

### 4:30–5:20 — show approval and recovery boundaries

Show the sandbox MCP registration with `--approval browser` and the capability-protected inbox. Explain that the request is bound to task/fingerprint/config context, decisions expire and apply once, and changes during review invalidate stale authorization. The fixed adapter in the scripted demo does not establish browser approval; use the sandbox path or its current negative tests for that claim.

Show the read-only recovery report:

```powershell
node dist/packages/report-cli/src/cli.js recover --ledger .spendguard/demo/ledger.db --json
```

Explain that an interrupted authorization can remain reserved without a recorded outcome. Recovery exposes it for investigation; it does not infer that no charge occurred or replay it. Use disposable recovery tests to demonstrate an unresolved entry rather than damaging the demo ledger.

The raw HTTP fallback rejects already signed payment retries fail-closed. Its remaining function is unsigned GET/HEAD discovery with bounded timeouts and responses. The external-signer x402 contract has local simulated tests; live wallet and settlement work are deferred.

### 5:20–6:00 — close with the next measurable step

> The next proof is another developer completing the bundled MCP onboarding, then a suitable team routing a bounded paid-tool task and reviewing false blocks. The local core is MIT. Payment collection and live wallet work are deferred; the proposed $149 assisted pilot is not a collected payment or revenue evidence.

## Deferred wallet and Devnet work

Live wallet integration, Devnet settlement, and Mainnet activity are outside this release's acceptance scope by the owner's choice. Do not fund a wallet, request secrets, activate a processor, or submit transactions as part of this showcase. Local SDK/contracts and simulated receipt tests can be discussed at their demonstrated scope.

If this work is explicitly resumed later, require the following evidence before presenting a payment as demonstrated:

1. Source revision, exact command, SDK versions, UTC run time, and explicit Devnet cluster/RPC identification.
2. Dedicated test-wallet public addresses, pinned network/mint/recipient, approved maximum request value, and a separate fee cap. Never expose a seed, secret key, RPC credential, or signing-service token.
3. Quote and request identity, the policy decision recorded before signing, and the durable payment/request correlation key.
4. A transaction signature and independently retrieved chain status showing the expected asset, recipient, amount, and successful confirmation on the stated network. A receipt string alone is insufficient.
5. Evidence that an equivalent retry and an over-budget quote do not invoke the signer or submit another payment.
6. A lost-response/restart case: show what is recorded as uncertain, what is reconciled, and how a second charge is prevented. Do not claim provider-wide exactly-once execution without provider support and proof.

SDK build verified, wallet funded with test assets, payment submitted, payment confirmed, provider resource delivered, and recovery verified are different milestones. Devnet test assets and transfers are not Mainnet purchases or customer revenue. None is required to accept the current local platform release.

## Reproducible proof map

Run `npm.cmd run verify`, then read the generated files below. Final test totals, audit findings, timings, pass/fail state, and archive identity belong in those artifacts. Do not fill a manual status column or copy old totals into this guide. Older results in [LAUNCH_STATUS.md](LAUNCH_STATUS.md) describe their dated run.

| Evidence | Generated artifact or source | How to inspect or reproduce it |
| --- | --- | --- |
| Release-wide checks and scope | [release/platform-verification.json](../release/platform-verification.json) | `npm run verify`; read `version`, `checkedAt`, runtime, check results, archive SHA-256, and scope. |
| Individual core results | [.spendguard/qa/platform-tests.json](../.spendguard/qa/platform-tests.json) | Produced by the JSON reporter during `verify`; inspect named tests, failures, and observed totals. This checkout-local report is not assumed to be in the published package. |
| Packaged clean installation | [release/verification.json](../release/verification.json) | `npm run release:verify`; inspect package version/integrity, clean install, packaged demo, ledger verification, sandbox setup, browser registration, and recovery-command results. |
| Full-path local timing | [release/benchmark.json](../release/benchmark.json) | `npm run build` then `npm run benchmark`; read runtime, timestamp, sample/history sizes, percentiles, and declared exclusions. The synthetic no-network callback excludes real provider latency, human wait, and wallet payments; it is not a production-throughput claim. |
| Hard caps and stale/denied approval behavior | `packages/mcp-proxy/test/safety-regression.test.ts`, `policy-engine.test.ts` | Run the named tests; inspect no-prompt/no-provider assertions and exact money boundaries. |
| Real MCP sandbox onboarding | `packages/mcp-proxy/test/sandbox-smoke.test.ts` | Run the test and the onboarding steps above; distinguish real transport from simulated responses/prices. |
| Browser capability, binding, expiry, replay | `packages/mcp-proxy/test/browser-approval.test.ts`; guard stale-approval regressions | Inspect unauthorized/wrong-origin/wrong-Host, consumed-decision, expiry, and context-change assertions. |
| Interrupted authorization visibility | `packages/mcp-proxy/test/recovery.test.ts`; `recover --ledger ... --json` | Inspect reopen/reservation/no-forward assertions; the CLI reports unresolved entries without replay or budget release. |
| Disabled signed fallback and bounded discovery | `packages/mcp-proxy/test/http-discovery.test.ts` | Inspect rejection and unsigned-discovery limit tests. |
| External-signer contract | `packages/x402-client/test/client.test.ts` | Inspect quote pinning, signer ordering, and duplicate/hard-cap assertions with simulated signatures/receipts. No live settlement claim follows. |
| Task decisions and ledger | `.spendguard/demo/latest.json`; task-scoped `report` and `verify` | Re-run the local demo and inspect its own task ID and chain result. |
| Hosted enquiry API | `site-worker/test/api.test.mjs`; aggregate API result in platform proof | `node --test site-worker/test/api.test.mjs`; private enquiry behavior does not establish payments or customers. |
| Public source and observed CI | [VanshKaushal/SpendGaurd](https://github.com/VanshKaushal/SpendGaurd), [Actions](https://github.com/VanshKaushal/SpendGaurd/actions) | Consult the live source revision and its actual run. A configured workflow or available push credentials are not a completed public CI run. |
| Deployed proof | The showcase's `/proof.json` endpoint | Site preparation embeds the generated platform proof. After deployment, compare its version/time/archive hash with the intended release and consult the returned deployment result; this document does not assert that publication is complete. |

Inspect the aggregate directly in PowerShell:

```powershell
Get-Content -Raw -LiteralPath 'release/platform-verification.json' | ConvertFrom-Json | Format-List
Get-Content -Raw -LiteralPath 'release/verification.json' | ConvertFrom-Json | Format-List
Get-Content -Raw -LiteralPath 'release/benchmark.json' | ConvertFrom-Json | Format-List
```

Wallet/Devnet/Mainnet and payment collection remain **deferred, outside release acceptance**. Customers, paid pilots, measured savings, and revenue are not claimed by generated engineering proof.

## Human follow-through after implementation

GitHub push credentials are available; authentication is not an outstanding owner task. Publication and release checks are handled by the engineering workflow. Consult the [repository](https://github.com/VanshKaushal/SpendGaurd) and [live CI runs](https://github.com/VanshKaushal/SpendGaurd/actions) for their resulting state rather than assuming that a dry run published anything.

The useful human follow-through is to record the short demonstration, try onboarding in the chosen coding agent, invite outside developers to repeat it, and review consent-backed feedback and false blocks. These validate communication and adoption; they are not implementation blockers. Choose contact details when ready to accept enquiries. No wallet keys, funding, processor account, Devnet transaction, or collected payment is required for this release.

## Materials to share

Share the source or exact release archive, a short recording, this guide, [INTERVIEW_GUIDE.md](INTERVIEW_GUIDE.md), and the matching generated proof files. Include [THREAT_MODEL.md](THREAT_MODEL.md), [SOLANA_X402.md](SOLANA_X402.md), and [QUICKSTART.md](QUICKSTART.md) so a reviewer can reproduce the scope and limitations.

Do not publish raw customer repositories, private pilot enquiries, wallet secrets, dashboard/approval tokens, full signed payment payloads, or credentials in screenshots or artifacts. Redact sensitive data without removing the public transaction identity and network information needed to verify a claimed Devnet transaction.
