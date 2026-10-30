# Changelog

## 0.3.0

- Updated MCP client/server, Zod and Vitest; pinned patched production dependencies and checked the complete dependency tree.
- Added a loopback approval inbox for headless MCP sessions, with capability authentication, origin/host restrictions, expiry and one-use decisions.
- Bound approvals to request fingerprints, including rejection when caller-owned arguments change while awaiting approval.
- Added read-only recovery reporting for interrupted authorizations. Reservations survive restart; no automatic replay or release occurs.
- Added runnable local MCP sandbox onboarding with explicitly simulated prices.
- Bounded HTTP discovery responses and timeouts. Disabled unverifiable signed raw retries.
- Clarified blocked-price reporting, launch evidence, security boundaries and hiring demonstration material.
- Payment collection and live wallet settlement are deferred at the owner's request.

## 0.2.0

Local developer preview with deterministic budgets, duplicate detection, terminal review, hash-chained ledger, reports, dashboard, external-signer x402 interface and public pilot enquiries.
