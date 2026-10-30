# Spend Guard interview guide

Use this guide to explain the v0.3 local platform and its evidence. It does not establish affiliation with Solana, Mastercard, YC, or any customer. Use the generated proof map in [SHOWCASE.md](SHOWCASE.md); read final totals and status from the artifacts rather than manually copied claims. The owner has deferred payment collection and live wallet/Devnet work. Those are not acceptance gates for this release.

## The thirty-second explanation

> Spend Guard is a local spending-control layer for coding agents that buy paid tools. It checks the maximum configured request price against a task budget, detects repeated or equivalent requests, and asks for human review when appropriate. It records decisions and execution evidence in a local ledger. The important boundary is before provider execution or external payment signing; code-quality signals do not authorize spending.

The specific problem is a repeated paid tool action or uncontrolled task run. This version does not cover every model token, subscription, cloud resource, or route to a provider. The intended first user is a developer or small team with separately metered tools and a workflow that accepts a proxy.

## Explain the architecture in two minutes

```text
MCP tool request                         x402 resource request
       │                                          │
Discover schema, resolve price          Discover and pin quote
       └────────────────┬─────────────────────────┘
                        ▼
          Task / config / repository context
                        ▼
       Deterministic policy + authorization history
       budget and duplicates before approval rules
                        ▼
         Approval, if needed; revalidate context
                        ▼
      Provider call / caller-supplied external signer
                        ▼
        Outcome evidence + hash-chained SQLite
                        ▼
          Task report / local read-only dashboard
```

The raw signed-HTTP fallback is disabled fail-closed: already signed retries are rejected. The remaining unsigned GET/HEAD discovery path has bounded timeouts and response size. It is not an alternative payment-authorization or settlement path. The guarded x402 client can be discussed as a locally tested external-signer contract; live wallet/settlement use remains deferred.

| Area | Source to open | Decision worth discussing |
| --- | --- | --- |
| Guard boundary | `packages/mcp-proxy/src/guard.ts` | Serialize authorization and execution; do not turn approval into a hard-cap bypass. |
| Policy | `packages/mcp-proxy/src/policy-engine.ts` | Small deterministic rules with reason codes; internal errors fail closed. |
| Money | `packages/mcp-proxy/src/money.ts` | Integer millionths of USD, explicit precision, no binary-float budget comparison. |
| Identity | `packages/mcp-proxy/src/fingerprint.ts` | Canonical arguments, provider/tool identity, repository state, and narrowly ignored metadata. |
| Audit trail | `packages/mcp-proxy/src/ledger.ts` | Transactional records, integrity checks, conservative reservations, and the limits of a local hash chain. |
| Approval | `packages/mcp-proxy/src/approval.ts`, `browser-approval.ts` | Expiring, one-use decisions via a local capability inbox; bind to task/fingerprint/config and revalidate context. |
| MCP transport | `packages/mcp-proxy/src/forward.ts` | Discover actual tools and forward their results; credentials are environment references rather than committed literals. |
| x402 client | `packages/x402-client/src/client.ts` | Validate quotes and authorize before handing work to an external signer. |
| Product onboarding | `packages/report-cli/src/setup.ts`, `demo.ts`, `dashboard.ts`; `packages/mcp-proxy/src/sandbox-provider.ts` | A bundled MCP provider makes first use possible without an account, network search, or real charge. |
| Recovery visibility | `packages/report-cli/src/cli.ts`; `packages/mcp-proxy/test/recovery.test.ts` | List unresolved authorizations without replaying requests or releasing reservations. |
| Deployment boundary | `site-worker/` and its tests | Keep private enquiry/admin data separate from public showcase content. Payment collection is deferred. |

Use the final code and run evidence for claims about approval and recovery. A diagram or interface is not evidence that an external provider or wallet supports reconciliation. An enquiry form, proposed price, or future checkout design does not establish payment collection.

## Let a reviewer try it

With the release installed and Node.js 24+, run from a repository the reviewer can safely use for testing:

```powershell
spendguard init --sandbox --config .spendguard/sandbox.yaml --repo .
spendguard doctor --config .spendguard/sandbox.yaml
spendguard mcp-config --config .spendguard/sandbox.yaml --ledger .spendguard/sandbox.db --approval browser
```

Merge the printed MCP entry into the agent's existing configuration and reconnect its MCP server. Ask it to call Spend Guard's `search` tool with `query: "authentication bug"`. Open the capability-protected approval inbox printed to proxy stderr/MCP logs, compare the task/fingerprint/config binding with the requested action, and approve once. Repeat the query to inspect a duplicate block; change it to `session cookie settings` to inspect a distinct request. The transport is real MCP; responses and USD prices are simulated, with no purchase or live search.

Then inspect the same ledger:

```powershell
spendguard report --ledger .spendguard/sandbox.db --json
spendguard verify --ledger .spendguard/sandbox.db
spendguard recover --ledger .spendguard/sandbox.db --json
```

PowerShell users can use `spendguard.cmd` if script execution is restricted. A built source checkout can invoke `node dist/packages/report-cli/src/cli.js` in place of `spendguard`. Keep capability tokens out of public evidence. See [SHOWCASE.md](SHOWCASE.md) for the complete recording and onboarding script.

## Show the generated evidence

Run `npm.cmd run verify` from the source checkout to regenerate the platform checks, clean-install proof, and benchmark. Read the resulting runtime/version/timestamp/archive identity before quoting results; an old artifact is not evidence that a failed rerun passed.

- [release/platform-verification.json](../release/platform-verification.json) contains the aggregate results and declared scope. The deployed showcase embeds this at `/proof.json`; consult the actual deployed release rather than assuming publication completed.
- [.spendguard/qa/platform-tests.json](../.spendguard/qa/platform-tests.json) contains individual test outcomes and totals from the JSON reporter. Open named regressions when explaining what a passing test establishes.
- [release/verification.json](../release/verification.json) records clean package installation, packaged demo, sandbox initialization, browser registration, and recovery-command checks.
- [release/benchmark.json](../release/benchmark.json) records the measured local guard path and its environment/exclusions. It uses a synthetic callback and does not establish production throughput or provider/payment latency.

Pair these with `sandbox-smoke.test.ts`, `browser-approval.test.ts`, `safety-regression.test.ts`, `recovery.test.ts`, and `http-discovery.test.ts` in `packages/mcp-proxy/test/`, plus the external-signer contract tests in `packages/x402-client/test/client.test.ts`. Use [the source repository](https://github.com/VanshKaushal/SpendGaurd) and [Actions](https://github.com/VanshKaushal/SpendGaurd/actions) to consult the live revision and its run. Local generated proof and a configured workflow do not themselves establish a successful public CI run.

## Decisions and tradeoffs

**Deterministic policy rather than an LLM judge.** A spending authorization must be explainable and reproducible. An LLM may help summarize incidents, but it should not silently grant permission to spend. Repository hashes and test signals can request review without claiming that the work is correct.

**A local proxy rather than immediate centralized control.** It fits an individual developer's workflow and avoids uploading repository content by default. It also inherits local permissions: another process with the same provider credentials can bypass it. A shared service would need identity, tenant isolation, central reservations, policy distribution, and operational ownership.

**Configured maximum prices rather than pretending to know invoices.** A hard cap is only meaningful against a known conservative price. Unknown prices block. Real provider billing, token usage, taxes, FX, and transaction fees may be different; provider reconciliation and explicit fee policies are separate work.

**Integer micro-USD rather than floating-point totals.** The unit supports fractional tool prices and exact boundary comparisons. Rejecting unsupported precision is preferable to accepting a value that rounds silently. This does not establish live exchange rates or token valuation.

**Exact/equivalent fingerprints rather than semantic similarity.** Canonical JSON removes key-order differences. Ignoring only known metadata catches some retry evasion while preserving real queries. Semantic detection might catch more waste but introduces false blocks and a harder-to-explain authorization boundary.

**Serialization and one owner per ledger rather than multi-agent claims.** These simplify a single-agent task's budget consistency. Independent ledgers do not share a global cap. A distributed system would need atomic reservations and idempotency across processes and provider/payment boundaries.

**A local hash chain rather than a tamper-proof claim.** Verification can reveal inconsistent stored rows and broken links. A writer who can replace both data and chain can forge a new coherent history; externally retained checkpoints address a different threat. Do not call a hash chain a blockchain or an independent financial audit.

**Conservative reservations rather than auto-refunds on errors.** A timeout or failed local result does not prove that no charge occurred. Releasing budget too early can permit a second purchase after a lost response. Payment state and reconciliation should establish what can safely change; uncertainty must stay visible.

## Questions a reviewer is likely to ask

### Why is this more than a budget counter?

The hypothesis is that task/request context matters: a repeated query against the same repository state is different from a fresh query in the same task. The project connects a spending decision with that context and an audit trail. Whether this reduces real waste better than existing tools requires user evidence; a local demo alone does not prove differentiation.

### What prevents an approval from overriding a budget?

The non-overridable checks run before novelty and price-review rules. Inspect the complete request path as well as the isolated policy engine. The regression should assert that an over-budget request invokes neither the approval adapter nor provider/signing path. Revalidate if task/config/repository context can change during the wait.

### What happens when the provider charges and the response disappears?

A transport error cannot safely be interpreted as “unpaid.” The read-only `spendguard recover --ledger PATH --json` command exposes unresolved authorizations while retaining reservations. Exit code 2 means unresolved entries exist; the command never replays a request or releases budget. Reconcile with the provider before deciding what to do next. This is recovery visibility, not an automated financial reconciliation service or an exactly-once delivery guarantee.

### How do you distinguish approval from authentication?

Generate MCP registration with `--approval browser` to use the local capability-protected inbox. Its URL is printed to proxy stderr, and pending decisions expire and are consumed once. The displayed request binds task, fingerprint, and configuration; the guard revalidates context before forwarding. The inbox omits raw arguments, so review the agent's request as well. Show origin/Host/authentication/expiry/replay tests and keep tokens out of public recordings. This is local capability access, not enterprise user identity. Terminal mode still requires a controlling terminal and fails closed when unavailable.

### Why can a different query proceed when the repository did not change?

Reading documentation or gathering information may be legitimate without a file change. Meaningful arguments remain part of the fingerprint. A configurable series of distinct requests without tracked progress can request review; it is a signal, not proof of waste. This is the reason to demonstrate both equivalent and different requests.

### Can a malicious agent evade the system?

With direct credentials or equivalent filesystem/process rights, yes. The proxy is an authorized workflow control, not hostile-agent isolation. Stronger enforcement requires credential separation and constrained execution. Prompt injection can also target an already approved tool's arguments; an allowlist is not an argument-safety proof.

### Does the Solana receipt prove a purchase?

A locally generated or provider-returned receipt is not independent chain confirmation. The current showcase does not need a wallet or live transaction: that work is explicitly deferred. The local tests demonstrate quote validation and authorization-before-signer ordering with simulated receipts. If live work is resumed later, independent cluster/transaction/asset/recipient/value confirmation, resource delivery, and restart/replay behavior need separate evidence.

### What does the product charge for?

The core is MIT. A proposed $149 four-week assisted pilot covers one provider/workflow, setup help, policy tuning, and incident review. Payment collection is deferred; no paid pilot or revenue is claimed. An enquiry is a request to discuss scope, not a payment. A recurring plan needs demonstrated ongoing value and renewal demand; shared team policies are not established by a local prototype.

### Why TypeScript? Would Rust make this stronger?

TypeScript fits the current MCP and developer-tool integration surface. The important evidence is the authorization boundary, money handling, recovery behavior, and reproducible operation. A Rust migration can make sense for measured constraints or a specific integration need; it does not create payment correctness, distribution, or adoption by itself.

## Frame it for the role

| Audience | Lead with | Demonstrate | Keep the boundary explicit |
| --- | --- | --- | --- |
| Solana-oriented engineering | Authorization before wallet interaction; pinned network/mint/recipient; conservative handling of uncertain outcomes | Local external-signer contract tests, blocked calls invoking no signer, and recoverable authorization records | Wallet/Devnet/Mainnet work is deferred and is not needed to accept this release. Simulated receipts do not establish settlement; custody remains external to the core. |
| Mastercard or payments engineering | Authorization controls, precise amounts, durable records, replay handling, and auditability | Hard-cap failure, one-use/stale browser approval, unresolved authorization inspection, and restart reservations | This is not an integration with Mastercard rails or Agent Pay. It does not implement card tokenization, scheme settlement, disputes, or establish PCI compliance. |
| Security/backend engineering | Trust boundaries, resource limits, dependency reproducibility, authentication, and fail-closed behavior | Negative tests, lockfile audit, bounded network behavior, token/origin checks, and a reproducible release | A healthy dependency audit is time-bounded evidence, not a complete security assessment; same-user bypass remains. |
| Product/startup review | A specific separately billed agent workflow and a clear onboarding path | Time to first guarded request, reviewed false blocks, provider bill comparison, and continued use when collected | No invented customers, savings, revenue, grants, funding, or YC acceptance. Proposed pricing is an experiment. |

These are ways to discuss transferable engineering work, not assertions about an employer's current hiring criteria or proprietary systems. Research the actual role before tailoring an application.

## Failure cases worth showing

| Failure | Evidence to present | What to avoid saying |
| --- | --- | --- |
| Over-budget novel tool/provider | No prompt bypass; no provider or signer invocation | “A person can approve any request.” |
| Denied first request | Later approval still required; denied attempt does not count as prior execution | “Any seen provider is trusted.” |
| Changed repo/config during approval | Stale decision rejected before forwarding | “A prompt freezes the world.” |
| Unknown/malformed price or config | Fails closed with a reason | “Missing prices are free.” |
| Long/large/redirected network response | Current timeout/body/origin tests; show the exact enforced limits | “HTTP is safe because it uses localhost.” |
| Missing outcome after authorization | Reopened ledger exposes the entry through read-only `recover`; reservation stays; exit code 2 | “Recovery automatically retries or refunds the request.” |
| Duplicate after restart | Persisted request/history tests; show the exact execution boundary the test establishes | “An in-memory mutex gives exactly-once payments.” |
| Ledger mutation | Verification failure in a disposable fixture | “The ledger cannot be rewritten.” |
| Wrong payment network/mint/recipient | Rejection before signing/submission | “A metadata match proves every signed instruction is safe.” |
| Already signed raw HTTP retry | Rejected fail-closed; unsigned discovery has explicit timeout/size limits | “The raw fallback safely verifies arbitrary signed transactions.” |

## A useful next experiment

Ask another developer to complete the bundled MCP onboarding, including a browser approval, duplicate block, different query, and ledger inspection. Record setup friction and false blocks. Then choose a willing team with separately metered tools, route a bounded task, and compare estimates with actual provider charges before describing money as saved. Payment collection and live wallet work remain deferred.

## Human follow-through

Push credentials for [VanshKaushal/SpendGaurd](https://github.com/VanshKaushal/SpendGaurd) are available, so GitHub authentication is not an outstanding owner task. The engineering workflow handles checks and publication; consult [Actions](https://github.com/VanshKaushal/SpendGaurd/actions) and the actual source/release for its completed state. This guide does not claim that a dry run published the project.

Recording the short demo, inviting outside developers, and collecting consent-backed feedback are useful human follow-through, not implementation blockers. No wallet funding, keys, processor account, Devnet transaction, or collected payment is required for this release.

Link the final source revision, generated platform/clean-install/benchmark proof, actual CI run, and short demo when available. A reviewer should be able to see exactly what ran, what failed, and what remains unverified.
