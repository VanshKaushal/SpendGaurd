# Agent setup

Spend Guard replaces the paid provider's MCP registration. Do not leave the original paid server registered alongside the proxy, or an agent can select the unguarded route.

Install the release archive or build the source first. `spendguard init`, `spendguard doctor`, and `spendguard mcp-config` create/check the YAML and generate registration JSON. Set the provider's stdio command or HTTP URL, known maximum prices, allowlist, repository paths, and budget. Use environment references for provider secrets; never commit API keys. See QUICKSTART.md.

## Claude Code

Current Claude Code supports project-scoped stdio servers through `.mcp.json` or `claude mcp add`. From the protected project, use an absolute path to the compiled entry point:

```sh
claude mcp add --transport stdio --scope project spend-guard -- node /absolute/path/to/spend-guard/dist/packages/mcp-proxy/src/server.js --config /absolute/path/to/spendguard.config.yaml --ledger /absolute/path/to/ledger.db
```

Equivalent project `.mcp.json`:

```json
{
  "mcpServers": {
    "spend-guard": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/spend-guard/dist/packages/mcp-proxy/src/server.js",
        "--config",
        "/absolute/path/to/spendguard.config.yaml",
        "--ledger",
        "/absolute/path/to/ledger.db"
      ]
    }
  }
}
```

Run `claude mcp list`, inspect `/mcp`, and approve the project server when prompted. The current format is documented by [Claude Code's MCP guide](https://code.claude.com/docs/en/mcp).

## Cursor

Cursor reads project MCP configuration from `.cursor/mcp.json` and global configuration from `~/.cursor/mcp.json`. Add:

```json
{
  "mcpServers": {
    "spend-guard": {
      "command": "node",
      "args": [
        "/absolute/path/to/spend-guard/dist/packages/mcp-proxy/src/server.js",
        "--config",
        "/absolute/path/to/spendguard.config.yaml",
        "--ledger",
        "/absolute/path/to/ledger.db"
      ]
    }
  }
}
```

Verify with `cursor-agent mcp list` and `cursor-agent mcp list-tools spend-guard`. See [Cursor's current MCP documentation](https://docs.cursor.com/context/model-context-protocol).

## Approval-channel requirement

The stdio stream is reserved for MCP JSON-RPC. Spend Guard opens the controlling terminal (`/dev/tty` or `CONIN$`) for approval prompts. If no controlling terminal is available—for example, a non-interactive background session—the approval adapter denies the request. This is the intended fail-closed behavior.

For IDE/background sessions, generate registration with `spendguard mcp-config --approval browser`, or append `--approval browser` to the proxy arguments. Open its private loopback inbox URL from stderr. Review task, request fingerprint, configured price and policy hash. The inbox never displays raw arguments; inspect the agent's tool request before approving. It requires a capability, exact Host/Origin and an unexpired one-use ID. Keep its URL out of shared logs. This does not isolate review from a malicious local process with the same permissions.

Approval times out after 60 seconds by default. A hard cap or duplicate cannot be overridden. Request-argument/repository/configuration changes while waiting invalidate approval. One executing proxy owns each ledger; use a new task ID for a new assignment.

## HTTP discovery boundary

In v0.3, raw signed retries are rejected before forwarding. This proxy cannot verify a serialized transaction's real amount, mint, recipient, or network, so configured USD prices do not make signed forwarding safe. Use it only for unsigned x402 GET/HEAD discovery against a trusted endpoint. Ordinary billed authenticated HTTP APIs are outside this assumption.

Configure `http_fallback` with `upstream_url`, `listen_port`, optional `timeout_ms` (default 30000), `max_body_bytes` and `max_response_bytes` (default 5 MiB). It binds loopback, validates Host/Origin, refuses redirects outside manual response handling, and bounds upstream reads. Live wallet integrations are deferred.
