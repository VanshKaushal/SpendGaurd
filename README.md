# Spend Guard

Spend Guard controls paid tool purchases made by coding agents. It checks each routed request against the task budget, request history, and tracked repository state before forwarding it, and records a reason for every decision.

**v0.3 is a local developer preview.** It covers routed MCP tools, with local browser approvals and conservative recovery reporting. Wallet transactions and payment collection are deferred. It does not control model-token bills, hold funds, or establish that generated code is good.

[Live showcase](https://spend-guard.icy-rat-7140.chatgpt.site) · [Engineering evidence](https://spend-guard.icy-rat-7140.chatgpt.site/engineering) · [Source](https://github.com/VanshKaushal/SpendGaurd) · [Showcase script](docs/SHOWCASE.md) · [Design tradeoffs](docs/INTERVIEW_GUIDE.md)

## Try it in two minutes

Node.js 24+ is required. Download the release archive and run:

```sh
npm install -g ./spend-guard-0.3.0.tgz
spendguard demo
spendguard dashboard --ledger .spendguard/demo/ledger.db
```

In Windows PowerShell, use `npm.cmd` and `spendguard.cmd` if script execution is restricted. The demo makes no purchases and uses simulated prices. The dashboard is read-only, local, and protected by the authenticated URL it prints.

For a source checkout:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run demo
```

## Try real MCP transport without purchases

```sh
spendguard init --sandbox --config .spendguard/sandbox.yaml --repo .
spendguard doctor --config .spendguard/sandbox.yaml
spendguard mcp-config --config .spendguard/sandbox.yaml --ledger .spendguard/sandbox.db --approval browser
```

Register the generated configuration in your agent. Open the private approval inbox URL from proxy stderr, ask the agent to call `search`, approve once, and repeat the same query to see it blocked. The bundled provider is local and its prices are simulated. No wallet, API key, or purchase is needed. Keep the inbox URL private.

## Connect a real provider

```sh
spendguard init --repo .
# Edit the generated provider, prices, task identity, and budget.
spendguard doctor
spendguard mcp-config
```

Merge the generated MCP configuration into your agent's existing configuration. Remove direct registration of the original provider. Upstream stdio and HTTP MCP servers are supported; HTTP uses static headers, not interactive OAuth. Environment references keep credentials out of committed YAML.

Read [QUICKSTART.md](docs/QUICKSTART.md) for the complete workflow and [AGENT_SETUP.md](docs/AGENT_SETUP.md) for Claude Code/Cursor registration.

```text
Coding agent → Spend Guard → paid MCP provider
                    ├── deterministic rules
                    ├── terminal approval
                    └── SQLite ledger / local audit dashboard
```

## Policy behavior

Unknown or invalid prices block. Hard budgets and exact/equivalent duplicates block before approval rules, so approval cannot override them. New providers/tools, too many calls without repository change, prior failures, and expensive calls require human review. Configuration changes and suspicious test-file changes can also trigger review.

Denied requests do not establish trust or poison later approved retries. Equivalent-request detection removes only explicitly configured metadata fields and preserves meaningful arguments. USD arithmetic uses integer millionths. Requests are serialized and only one executing proxy owns a ledger. Approval times out, and configuration/repository changes while waiting invalidate it.

Terminal mode denies requests requiring approval if no controlling terminal exists. Generate `mcp-config --approval browser` for IDE sessions: the loopback inbox requires a capability, exact Origin/Host, an unexpired one-use decision, and unchanged request/configuration/repository state. This is local review, not a remotely hosted approval service. The tool remains single-agent/single-repository; separate ledgers do not share budgets.

## Reporting and evidence

```sh
spendguard report --ledger .spendguard/ledger.db
spendguard report --ledger .spendguard/ledger.db --task YOUR_TASK_ID --json
spendguard verify --ledger .spendguard/ledger.db
spendguard recover --ledger .spendguard/ledger.db --json
spendguard dashboard --ledger .spendguard/ledger.db
```

The hash-chained SQLite ledger records task identity, requests, policy reasons, approvals, output hashes, repository/test evidence, and audit flags. Optional verification commands run before/after higher-priced provider calls. Optional backups use SQLite's WAL-aware backup API.

Blocked-dollar totals sum configured request prices: a counterfactual estimate, not measured invoice savings or proof of waste. Authorized prices remain budget reservations even when provider execution fails or its charge status is uncertain. Repository/test changes are execution evidence, not proof of quality.

## Solana / x402

The `spend-guard/x402` library discovers an exact-scheme Solana quote, pins network/mint/recipient, authorizes before invoking a caller-supplied signer, sends one signed retry, and records the provider receipt. Spend Guard stores no wallet private keys. Loopback integration tests use simulated signatures and receipts; live settlement and chain confirmation remain unverified. See [SOLANA_X402.md](docs/SOLANA_X402.md).

Raw signed HTTP retries are disabled in v0.3 because a configured price cannot verify a transaction's actual amount. The bounded HTTP discovery proxy accepts unsigned GET/HEAD requests only. The guarded x402 library remains experimental; live signing and settlement are deferred.

## Launch assets

- `site-content/`: editable showcase page and browser assets.
- `site-worker/`: dependency-free hosted Worker, private pilot API, D1 schema, and endpoint tests.
- `release/`: generated npm archive and clean-install verification evidence.
- [LAUNCH_PLAYBOOK.md](docs/LAUNCH_PLAYBOOK.md): customer definition, proposed $149 assisted pilot, and validation milestones.

```sh
npm run release:verify
npm run verify
npm run site:prepare
npm run site:preview
node --test site-worker/test/api.test.mjs
```

`npm run verify` checks types, core/API tests, the full dependency audit, complete local-call benchmarks, and a clean installed package. It writes `release/platform-verification.json`. Installation normally needs registry access; an npm archive does not bundle its dependencies. `--offline` verification requires a populated cache.

The website collects pilot enquiries with consent; it does not collect payments. Revenue, real customers, and live Solana use are not claimed. Live wallets and checkout are deferred at the owner's request. Team cloud policies, remote approvals, a Rust migration, and multi-agent operation remain future work driven by actual customer demand. See [SECURITY.md](SECURITY.md), [recovery](docs/RECOVERY.md), and [CHANGELOG.md](CHANGELOG.md).

Read the [threat model](docs/THREAT_MODEL.md) and [hardening status](docs/SECURITY_HARDENING.md) before routing real spend. A local process with the same filesystem rights can bypass the proxy; this is not a security sandbox.

MIT license. Built by Vansh Kaushal.
