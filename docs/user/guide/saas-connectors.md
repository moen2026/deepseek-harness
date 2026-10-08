# Connect a SaaS provider through MCP

English | [中文](saas-connectors.zh.md)

These three **default-off reference configurations** connect one SaaS provider to DSH through [`@deepseek-ai/dsh-mcp-client`](../../../packages/mcp/mcp-client/README.md). Pick the provider you use, or copy the same generic MCP row for another one.

These third-party configurations are provided as interoperability examples only. Their inclusion does not imply endorsement, recommendation, partnership, or ongoing support by DeepSeek.

## What DSH does

DSH parses the selected Cordis overlay, starts a configured stdio command or connects to a configured Streamable HTTP URL, discovers MCP tools, and exposes them as `mcp__<serverName>__<tool>`. DSH does not create provider accounts, mint tokens, or negotiate OAuth; each section below uses the token or local endpoint the provider documents for unattended clients.

For stdio, the generic client launches and stops the child with the DSH plugin lifecycle, and it strips ambient variables whose names usually identify credentials before launching; the example adds back only the variable it needs. For Streamable HTTP, the upstream service must already be reachable.

## Choose one

| Provider | Endpoint | Transport | Prerequisite |
|---|---|---|---|
| [Stripe](https://docs.stripe.com/mcp) | `https://mcp.stripe.com` | Streamable HTTP | A restricted API key in `STRIPE_SECRET_KEY` |
| [Supabase](https://supabase.com/docs/guides/getting-started/mcp) | local stdio | stdio | Node 22.18+ and a personal access token in `SUPABASE_ACCESS_TOKEN` |
| [Figma Dev Mode](https://developers.figma.com/docs/figma-mcp-server/) | `http://127.0.0.1:3845/mcp` | Streamable HTTP | The Figma desktop app running with Dev Mode MCP enabled |

## Enable one

```sh
dsh web --patch "$PWD/apps/cli/config/examples/saas-connectors/stripe.cordis.yml"
```

Replace the filename with `supabase.cordis.yml` or `figma.cordis.yml`. No SaaS connector is present in the shipped composition, so omitting `--patch` keeps all three disabled. To keep the selection across runs, merge the chosen file's single `insert` patch into a user patch layer — `$DSH_HOME/profiles/<name>/cordis.patch.yml` for one profile, or `$DSH_HOME/cordis.patch.yml` for every profile on the machine. Do not copy over an existing file: it may already contain unrelated user patches.

## Provider setup

### Stripe

```sh
dsh web --patch "$PWD/apps/cli/config/examples/saas-connectors/stripe.cordis.yml"
```

Set `STRIPE_SECRET_KEY` before launching. A [restricted API key](https://docs.stripe.com/keys) that grants only what this agent needs is the safer choice; the hosted server also supports OAuth, which `dsh-mcp-client` does not negotiate. Stripe requires human confirmation for sensitive actions such as refunds: the server returns an approval URL, the agent relays it, and you approve in the browser.

### Supabase

```sh
npm install --global @supabase/mcp-server-supabase@latest
dsh web --patch "$PWD/apps/cli/config/examples/saas-connectors/supabase.cordis.yml"
```

Create a [personal access token](https://supabase.com/docs/guides/getting-started/mcp) scoped to the projects this agent may touch, and set `SUPABASE_ACCESS_TOKEN` before launching. The stdio bridge strips that variable from the ambient environment, so the example's `config.env` entry is the only path it reaches the server through. Pin the installed version in the guide above when you want a frozen reference.

### Figma

```sh
dsh web --patch "$PWD/apps/cli/config/examples/saas-connectors/figma.cordis.yml"
```

In the Figma desktop app, enable **Enable Dev Mode MCP Server** in the preferences and keep the app running; it serves `http://127.0.0.1:3845/mcp` locally. The hosted remote endpoint `https://mcp.figma.com/mcp` needs OAuth, which `dsh-mcp-client` does not negotiate.

## Lark and Feishu

The Lark (Feishu) bridge is native, not MCP: [`connector-feishu`](../../../packages/connector/connector-feishu/README.md) verifies callbacks, continues one deterministic Session per channel, and pushes replies back through Feishu's API. Use it instead of a Lark MCP row.

## Verify

In a new DSH session, ask one read-only question that only the provider can answer — "List my Stripe products", "List my Supabase projects", or "Search Figma for the checkout frame". Confirm the model called the matching `mcp__stripe__…`, `mcp__supabase__…`, or `mcp__figma__…` tool and answered from its result. Initial discovery is asynchronous, so wait for the provider's `mcp__...` tools before sending the first prompt.
