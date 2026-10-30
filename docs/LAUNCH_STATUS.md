# Platform release status — 30 October 2026

Version: 0.3.0, local developer preview.

Public showcase: https://spend-guard.icy-rat-7140.chatgpt.site
Engineering evidence: https://spend-guard.icy-rat-7140.chatgpt.site/engineering
Source destination: https://github.com/VanshKaushal/SpendGaurd
CI: https://github.com/VanshKaushal/SpendGaurd/actions

## Current platform

- Deterministic task budgets, unknown-price blocking, exact/equivalent duplicate checks, local evidence and hash-chained SQLite records.
- Terminal review or a loopback browser inbox for IDE/background MCP sessions. Browser decisions require capability authentication, exact Origin/Host, expiry, a one-use ID, and unchanged request/configuration/repository state.
- Bundled sandbox onboarding uses actual MCP transport with simulated prices and local responses. No credentials or purchases are needed.
- Read-only recovery identifies interrupted authorized requests, preserves reservations, and performs no automatic retry or release.
- HTTP discovery has bounded timeouts/responses and refuses unverifiable raw signed retries.
- Patched dependencies, security/disclosure guidance, complete local-call benchmarks, coverage collection, and a reproducible package check.

## Verification and provenance

Run `npm.cmd run verify`. The command checks types, core tests with coverage, pilot API tests, build, the complete dependency audit, full local guard-call benchmarks, and a clean package installation. Its canonical record is `release/platform-verification.json`, served as `/proof.json` on the updated showcase. Consult that timestamp and the actual CI run for current pass/fail counts; this document is not a substitute for those records.

The public download is a compiled npm archive, not an npm-registry publication. Installing its dependencies normally needs registry access. Offline verification requires a populated npm cache. Benchmarks use a synthetic historical ledger and no-network callbacks, and exclude human/provider latency. They establish no production throughput or multi-agent claim.

The existing public v0.2 download is preserved byte-for-byte when v0.3 is added. Source, verification record and archive identity must be checked together when sharing a release. The previous October 14 signup/deletion test remains historical evidence, not a fresh claim about today's live database contents.

## Intentionally deferred

At the owner's request, wallet transactions (including Devnet) and payment collection are set aside. No merchant activation, funded wallet, SDK settlement, real checkout, customer payment, or recurring billing is claimed. The x402 library remains a simulated, external-signer integration boundary.

Multi-agent shared budgets, cloud team policies, remote approvals, interactive provider OAuth and a Rust core remain outside this release's supported scope. No genuine customers, measured savings, revenue, Solana/Mastercard affiliation, hiring outcome or YC acceptance is claimed.

## Use and operate

Start with QUICKSTART.md, then SHOWCASE.md and INTERVIEW_GUIDE.md. Review private enquiries through authorized Sites database tools; the application exposes no public listing and sends no automatic email. Contact configuration is optional and currently empty. Receipts permit visitor deletion. Retention cleanup runs on successful new submissions; it is not an unattended timed purge.

Outside-developer onboarding, feedback, a personal demo recording and job applications are human follow-through. They do not require enabling payments.
