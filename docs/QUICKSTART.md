# Use Spend Guard

Node.js 24+ is required. The archive contains compiled JavaScript; users do not need TypeScript or Rust.

```sh
npm install -g ./spend-guard-0.3.0.tgz
spendguard demo
spendguard dashboard --ledger .spendguard/demo/ledger.db
```

On Windows PowerShell, use `npm.cmd` and `spendguard.cmd` if script execution is restricted. The dashboard prints an authenticated local URL; keep it private. It does not upload the ledger. All demo prices and approvals are simulated; no purchases or network requests occur.

## Protect a real task

For a first run without credentials or purchases, initialize the bundled MCP sandbox:

```sh
spendguard init --sandbox --config .spendguard/sandbox.yaml --repo .
spendguard doctor --config .spendguard/sandbox.yaml
spendguard mcp-config --config .spendguard/sandbox.yaml --ledger .spendguard/sandbox.db --approval browser
```

Register that JSON with your agent, open the private inbox URL printed by the proxy, and ask the agent to use `search` with a `query`. Approve the first call, repeat the query, and inspect the duplicate block. These are real MCP messages with simulated prices and local responses. The sandbox makes no purchases. Close the agent to stop its proxy and approval inbox.

For a separately billed provider:

From the repository you want to protect:

```sh
spendguard init --repo .
```

Edit the generated YAML. Set a real provider, allowlist, known maximum USD tool prices, unique task ID, description, and budget. Keep secrets out of committed configuration. Provider environment values and HTTP headers support `${ENVIRONMENT_VARIABLE}` references.

```yaml
provider:
  id: my-paid-provider
  transport: stdio
  command: node
  args: [/absolute/path/to/provider.js]
  env:
    PROVIDER_API_KEY: ${PROVIDER_API_KEY}
provider_allowlist: [my-paid-provider]
tool_prices_usd:
  paid-search: 0.25
```

For remote MCP, replace `provider` with:

```yaml
provider:
  id: my-paid-provider
  transport: http
  url: https://your-provider.example/mcp
  headers:
    Authorization: Bearer ${PROVIDER_API_KEY}
```

Static API-key headers are supported; interactive OAuth is not implemented.

```sh
spendguard doctor
spendguard mcp-config
```

Merge the generated JSON into `.mcp.json` for Claude Code or `.cursor/mcp.json` for Cursor. Preserve unrelated entries. Remove direct registration of the paid provider; only routed calls are protected. See AGENT_SETUP.md.

First use of a provider/tool requires human approval in the controlling terminal. Headless sessions deny approval requests. Prompts time out after 60 seconds by default. One proxy owns a ledger; multi-agent coordination is unsupported.

```sh
spendguard report --ledger .spendguard/ledger.db
spendguard report --ledger .spendguard/ledger.db --json
spendguard verify --ledger .spendguard/ledger.db
spendguard dashboard --ledger .spendguard/ledger.db
```

Hard budgets cannot be overridden by a prompt. Explicitly review/edit the budget if necessary. Provider, repository, and task identity changes require restarting. Use a new task ID for a new assignment.

`duplicate_ignored_params` removes explicitly listed metadata keys; defaults ignore request/trace IDs, not query content or timestamps. `max_calls_without_progress` defaults to 5 and requests review for distinct calls against unchanged tracked state.

Prices are conservative authorization estimates, not invoice reconciliation. The guard cannot prevent a provider charging beyond an incorrect configured estimate. Model tokens, subscriptions, and direct provider traffic are outside coverage.
