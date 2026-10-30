# Interrupted requests and recovery

An authorization is recorded before the provider callback. It reserves the configured maximum price. If the process stops after that write, the provider may or may not have executed or charged. Restarting must not erase the reservation or automatically retry.

```sh
spendguard recover --ledger .spendguard/ledger.db --json
```

The command verifies the hash chain and lists authorized requests without an outcome. It is read-only, releases no budget, and sends no provider request. Exit 0 means none were found; exit 2 means reconciliation is needed. Requests with an explicit failed provider outcome also retain their reservations: a failure response does not establish that no charge occurred.

For each request, compare the request ID, timestamp, provider, tool and reserved price with provider-side records. Preserve this evidence. If a provider cannot establish a final outcome, keep its charge status unknown. There is deliberately no automatic refund, reset, reservation release, or replay command. Start a new task only after a person has reconciled the old task and intentionally authorized new work.

This is local execution recovery, not blockchain or merchant settlement reconciliation. Wallet transactions and checkout are deferred. Backups remain user-controlled SQLite snapshots; test restoration on a copy, not over the only live ledger.
