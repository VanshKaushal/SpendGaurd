# Spend Guard threat model

1. Proxy bypass/disablement → remove direct provider registrations and isolate credentials. A session heartbeat records proxy activity; it cannot detect purchases outside the proxy.
2. Fingerprint evasion → canonicalization + near-duplicate key.
3. Concurrent purchases → serialized execution and one executing proxy per ledger. Changes during approval invalidate it. Multiple ledgers, machines, or agents remain out of scope.
4. Prompt injection → novel provider/tool always requires approval.
5. Gameable/flaky tests → test-diff meaningfulness check, human review on suspicious trivial diffs.
6. Ledger tampering → hash chain + scheduled remote sync.
7. Approval fatigue → keep approval events rare by design; don't over-trigger.
8. Verification cost exceeding value → tiered verification depth by price threshold.
9. Regulatory drift from careless settlement adapters → non-custodial only, hard constraint, legal review gate before any custody-adjacent feature.
10. Over-trust in "verified execution" as "verified quality" → explicit language discipline everywhere in product surface.

## v0.3 review and residual limitations

The browser approval inbox uses a randomly generated bearer capability, exact loopback Host/Origin checks, bounded JSON, expiring one-use IDs, and a strict CSP. It binds the review to the task, request fingerprint, and configuration hash. The guard rechecks request arguments and repository/configuration state after approval. Same-privilege local malware remains outside the trust boundary.

The discovery proxy refuses raw signed transactions because it cannot verify their serialized spend. Its unsigned GET/HEAD flow assumes a trusted unbilled discovery endpoint. The guarded x402 library has a separate external-signer contract; wallet transactions and payment collection are deferred.

- The proxy prevents direct access only when the original provider registration is removed and credentials are not exposed through another route.
- A local attacker with write access can delete the ledger and its final chain links. Scheduled snapshots to a user-controlled remote or mounted directory provide an external anchor, but Spend Guard does not host that storage in v1.
- Single-agent/single-repository scope avoids rather than solves concurrent time-of-check/time-of-use races.
- Near-duplicate detection compares meaningful arguments after removing explicitly configured metadata keys. Do not ignore fields affecting the resource. Distinct paid calls without repository change trigger review after a configurable threshold. Repository changes are progress signals, not proof of useful work.
- Evidence captured immediately after an MCP provider returns describes that provider call. Work performed later by the agent appears in the repository state used by the next paid decision; it cannot retroactively prove the quality of the earlier response.
- Budget totals are maximum authorized configured prices, including unsuccessful or uncertain calls. They are not invoice reconciliation. USD arithmetic uses integer millionths.
- A malicious local process with the same filesystem rights can bypass the proxy or rewrite and recompute a ledger. This is not isolation from a hostile local agent.
- x402 quotes pin network/mint/recipient; signing and transaction verification remain external. Provider receipts are not independently verified chain confirmations. Network fees are outside the tool-price budget.
