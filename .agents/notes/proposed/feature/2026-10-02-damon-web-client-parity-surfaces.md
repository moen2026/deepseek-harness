# Agent Note: Damon web client parity surfaces

Status: proposed

English | [中文](2026-10-02-damon-web-client-parity-surfaces.zh.md)

## Problem

A capability review against a comparable agent desktop client (Qoder) found the Damon web client already covers the large majority of its surface with existing packages: session list and management (`ui-workspace`), conversation with model and agent-preset selection (`ui-conversation`, `ui-model-selection`, `ui-agent-preset`), changed-files review cards (`ui-deliverables`), a right sidebar with summary, terminal, and files tabs (`ui-sidebar-right` over `ui-trajectory`, `ui-sidebar-terminal`, `ui-sidebar-files`, freely dockable through `ui-dockkit`), todo progress, references and skills (`ui-reference`, `ui-skill`), scheduled tasks (`ui-schedule`), plugin management (`ui-plugin-manager`), and "open in application" (`ui-open-in-app`). The desktop client itself is an Electron shell around a web UI; DSH already ships that shell as `apps/desktop`, so the remaining gap is not the shell but four UI surfaces the web client does not render yet:

1. **Knowledge center** — the [knowledge seam](../../../../docs/subsystems/knowledge.md) ships `ctx.knowledge` and the `tool_knowledge` tools, but no web surface browses or manages stored knowledge.
2. **Memory management** — `dsh-memory` serves memory and `tool_memory` records changes into sessions, with no surface to list, inspect, or remove memories outside a conversation.
3. **MCP status and resources** — `dsh-mcp` connects servers and `mcp-resources` serves shared resources, but no panel shows server connection state or browsable resources; the plugin settings list covers only plugin inventory.
4. **Composer voice input** — the composer has no dictation entry.

Each is an independent feature; none depends on another, and each can ship alone.

## Proposal

Deliver four web surfaces as separate client packages, each consuming existing services and session events — no agent-loop or session-format changes.

### Knowledge center surface

A `ui-knowledge` package renders knowledge activity cards in the conversation from raw `tool_knowledge` events and persisted result metadata, and a management view (a right-sidebar tab type or a workspace page, decided at implementation) listing stored records. Records live in the configured knowledge provider — SQLite, not the session log — so the management view reads through a Host query endpoint in the pattern of the storage package's browser-safe entries, scoped to the provider the deployment configured. Remove routes through the same `tool_knowledge` remove operation the model uses, with the same approval expectations.

### Memory management surface

A `ui-memory` package lists memory entries with their sources, renders per-entry activity from logged `tool_memory` calls, and exposes removal through the existing service operation. Memory content is durable state outside the session log; the listing reads a Host endpoint, and the conversation cards derive from raw events.

### MCP status and resources panel

A `ui-mcp` package shows connected servers, their tools and resources, and per-Session resource usage. `mcp-resources` already serves resource calls in the caller's scope, and MCP server instructions and resources already reach the Session — the panel surfaces existing state, it does not add a second connection path.

### Composer voice input

Dictation in the composer using the browser SpeechRecognition API where available, degrading to a hidden control where the browser does not provide it. Audio is not uploaded by DSH; the browser's own speech service handles recognition, so no session event, no credential, and no transcript persistence is added beyond the composed text the person chooses to send.

## Alternatives considered

**Align by shipping a richer desktop shell.** Rejected: the shell is not the gap — every missing surface is a web UI concern, and `apps/desktop` already hosts the same web client; duplicating capabilities into shell-only native code would fork them from the browser experience.

**Deliver all four inside one new "console" plugin.** Rejected: the surfaces share no state, and the codebase's convention is one domain per package with its own registration, tests, and README; a combined package would couple four independent approval and release cycles.

**Route the knowledge and memory listings through agent tools instead of Host endpoints.** Rejected: listing and removal would then require a live model call to manage data, and agent-visible inventory would grow request prefixes for a purely human management task.

**Native shell speech recognition.** Rejected for the web client: it would make dictation desktop-only, and the browser API covers the web client without new transports.

## Acceptance criteria

- Each surface ships and is approved independently; a deployment that does not mount it sees no change, and every existing surface behaves exactly as today.
- Knowledge and memory management views read the deployment's configured provider through its Host endpoint, respect its availability (the knowledge tools' not-available copy pattern), and never invent a fallback listing.
- Conversation cards for knowledge, memory, and MCP derive from raw session events and persisted result metadata; no new session events and no `SESSION_FORMAT_VERSION` change.
- All product copy routes through locale dictionaries; the knowledge center and memory views are reachable without any agent call.
- Voice input works in Chromium-based browsers, renders nothing where unsupported, and adds no audio capture, storage, or transport owned by DSH.

## Risks

The knowledge and memory endpoints expose durable stores to the browser, so their authorization surface must match the existing session-data endpoints rather than widen it; a provider without the query capability must degrade visibly, not silently. The MCP panel depends on what servers report, so capability gaps in a server will read as missing features unless labeled as server-reported. SpeechRecognition quality and availability vary by browser and platform, and the browser's speech service is a third party the person implicitly trusts by dictating; the control must make that obvious. Scope creep is the quiet risk: each surface should ship against the services listed here and resist growing agent-loop or persistence changes to reach parity checkboxes.
