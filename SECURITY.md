# Security policy

Spend Guard controls only requests routed through it. It is not a sandbox against a local process with the same filesystem rights. Keep provider credentials out of the agent's unguarded routes. Configure conservative maximum prices; budget reservations are not settled invoices.

Use Node 24 or later and the current release. CI checks the locked dependency tree with `npm audit`. Never expose the local dashboard or approval inbox on a public interface. Their printed URLs contain access capabilities; keep them private. Approvals are one-use, expire, and are rechecked against request, repository, and configuration changes.

Do not file public issues containing API keys, approval URLs, private repositories, wallet material, or unredacted ledgers. Use the repository owner's private security reporting facility if enabled. Otherwise report a minimal redacted description through an owner-approved channel before providing sensitive detail. No private disclosure mailbox is configured by this release.

Raw signed HTTP forwarding is disabled in v0.3: a configured price cannot validate a transaction's real amount. The x402 library remains an experimental external-signer interface; settlement and chain confirmation are not provided. Live wallet/payment work is deferred.

See docs/THREAT_MODEL.md for the complete boundary and docs/RECOVERY.md for interrupted requests.
