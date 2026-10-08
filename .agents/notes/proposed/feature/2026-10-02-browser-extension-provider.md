# Agent Note: Browser extension provider

Status: proposed

English | [中文](2026-10-02-browser-extension-provider.zh.md)

## Problem

All three [browser-use providers](../../../../docs/subsystems/browser-use.md) reach a browser through the Chrome DevTools Protocol or by launching their own Playwright or Stagehand browser. Both paths miss the browser a person actually uses: CDP attachment requires a debug port started for the occasion and sees only what DevTools sees, and a launched browser starts without the person's profiles, logins, and extensions. Tasks that need an authenticated session in the daily browser — intranet pages, logged-in SaaS — are out of reach, and an in-page extension can observe content and events that page-level automation approximates only awkwardly.

## Proposal

Ship a DSH-owned Chromium extension as a fourth browser-use provider. The extension connects **out** to the Host over one WebSocket — the reverse of the debug-port model, so the person's machine opens no inbound port — and pairs with a token the Host surfaces beside the same place the Web UI is served. The provider registers through the unchanged [`ctx.browserUse` slot](../../implemented/architecture/2026-09-12-browser-use-provider-registration.md) under its own name, owns its tools (tab navigation, DOM read, click and type, screenshot where the page permits), and keeps per-Session ownership: one Session reserves the paired browser, Session disposal releases the reservation and leaves the browser and its state untouched.

Because the extension runs inside the person's own browser, logins and profile state persist across tool calls without a separate profile store. First scope is desktop Chrome and Chromium; the extension ships as a sideloaded bundle for developer deployments first, with a store distribution as a later, separate qualification.

### Pairing and trust

Pairing is explicit: the Host shows a short-lived token, the extension sends it once, and the Host pins the connection to that token's session. A second browser pairs as a separate attachment and competes for the same single-provider reservation semantics the attachment path uses today. The extension requests host permissions for the origins a deployment configures, not `<all_urls>` by default.

## Alternatives considered

**Extend Stagehand attachment with a persistent CDP connection.** Rejected as the general answer: a debug port is still required, content-script presence still does not persist, and the browser must be started in a special mode. It remains the fallback for automation-only setups.

**Playwright persistent context.** Rejected: a separate profile can hold logins, but it is not the person's daily browser, duplicates their state, and silently diverges from it.

**An MCP server inside the extension.** Rejected: the MCP plumbing exists, but ownership, per-Session queues, and reservation semantics already live in the browser-use provider model; an MCP layer would move Session ownership into `mcp-client` against the registration decision.

**Forking Chromium with native integration.** Rejected: the build and release cost is out of scale for the capability gained.

## Acceptance criteria

- With the extension loaded and paired, a Session's browser tools operate tabs of the person's own browser; disposal releases the reservation, and the browser keeps its state and stays open.
- Only one Session owns the paired browser at a time, matching the existing attachment reservation semantics.
- Extension tool calls are recorded in the Session log like other provider tools; no new persistence events or Session schema changes.
- Without the extension, deployments behave exactly as today: the provider is absent and contributes no tools.

## Risks

Store policies constrain remote-control extensions (broad host permissions, remote code); the first distribution is therefore sideload and the store path needs its own qualification. The person's browser exposes real credentials to automation, so tool scope must stay on explicit, user-visible actions and never read credentials autonomously. Pairing must not weaken profile isolation or let one paired Host observe another origin the token did not grant. Firefox and mobile are deferred, and the WebSocket channel inherits the usual hijack and denial risks, bounded by the token's lifetime.
