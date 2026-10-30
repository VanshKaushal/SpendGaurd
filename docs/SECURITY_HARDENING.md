# Security hardening status

- [x] Session heartbeat is hash-chained before paid calls; it cannot observe bypass traffic.
- [x] Provider allowlist is read from a local YAML file on every decision and has no runtime mutation API.
- [x] Allowlisted-but-novel providers and novel tools require task-specific approval regardless of price.
- [x] Changed tests with no net increase in assertion signals create a human-review audit flag.
- [x] The policy configuration is included in the repository-state hash and any mutation after the first paid request requires approval.
- [x] SQLite uses WAL plus an append-only row chain; scheduled snapshots use SQLite's WAL-aware backup API.
- [x] Internal policy errors and unknown prices block instead of allowing.
- [x] Approval prompts use the controlling terminal, never the MCP stdio stream.
- [x] Verification depth is price-tiered.
- [x] The HTTP discovery proxy binds to loopback, validates Host/Origin and upstream protocol, bounds response size/time, and rejects raw signed retries.

The remote snapshot target is a user-supplied directory, such as a mounted remote volume. Spend Guard does not provide hosted synchronization in v1.

## v0.2 hardening

- [x] Hard caps and duplicates precede approval rules; approval never overrides them.
- [x] Denied attempts do not establish trust or poison legitimate retries.
- [x] Fingerprints include provider identity and meaningful request arguments.
- [x] Policy arithmetic uses integer micro-USD.
- [x] Calls are serialized and one executing guard owns a ledger.
- [x] Stale approvals are rejected; terminal approval has a timeout.
- [x] Ledger integrity is checked before authorization, including unchained rows.
- [x] HTTP MCP upstreams require HTTPS except loopback development.
- [x] Dashboard data requires a random token, loopback Host validation, and same-origin access.
- [x] x402 external signing occurs after authorization, with pinned quotes and one signed retry.

## v0.3 platform hardening

- [x] Patched/pinned MCP and Zod dependencies; patched Vitest and its matching coverage provider. The complete audit is a release gate.
- [x] Local browser approval supports IDE sessions with capability authentication, exact Origin/Host, expiry, and one-use request-bound decisions.
- [x] Mutated request arguments invalidate pending approval, in addition to repository/configuration changes.
- [x] Interrupted authorization reporting preserves budget reservations and performs no replay or automatic release.
- [x] A bundled, no-network sandbox provides real MCP transport for onboarding with simulated prices.

Fresh counts, audit results and package identity are recorded by `npm run verify` in release/platform-verification.json. Live settlement, provider invoice accuracy, hostile-process isolation, and multi-agent operation are not established by local tests. Wallet/payment activation is deferred by the owner.
