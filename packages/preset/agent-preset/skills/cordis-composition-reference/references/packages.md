# Loadable Harness plugin packages

This file is GENERATED from workspace manifests (`scripts/gen-plugin-packages.ts`) and verified fresh by `pnpm run verify-plugin-packages` (part of `doc-sync`); do not edit it by hand.

Every package below exports a Cordis plugin that a bundle patch can name in a Loader row. `Config` marks packages whose row accepts a `config` mapping; query `Config.listConfigs` through `cordis_inspect_query` (filter by `name`, then query the `entry` id) for the mounted schema. Packages under `experimental` are pre-stable.

## acp

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-acp` | yes | Automation-only Agent Client Protocol server for driving DeepSeek Harness agents over JSON-RPC stdio |

## api

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-api-account-controller` | no | Expose safe account operations over authenticated Remote |
| `@deepseek-ai/dsh-api-gateway` | yes | Typert Remote Host dispatcher and Client API endpoint |
| `@deepseek-ai/dsh-api-job-controller` | yes | Job Remote observation stream and the reference-counted client job-output service |
| `@deepseek-ai/dsh-api-remotes` | no | Remote BFF assembly for application-selected Host capabilities |
| `@deepseek-ai/dsh-api-session-controller` | yes | Session Remote commands, cold reads, and live control transport |
| `@deepseek-ai/dsh-api-settings-controller` | yes | Remote owner for the configuration surfaces over the settings-domain seams |
| `@deepseek-ai/dsh-api-terminal-controller` | yes | Session-owned interactive terminals with shell discovery, screen recovery and typed Remote control |
| `@deepseek-ai/dsh-api-workspace-controller` | yes | Workspace Remote commands and reconnect-safe state transport |
| `@deepseek-ai/dsh-api-workspace-files` | yes | Workspace file service and Client resource provider: bounded reads, directory listing, and live metadata over the workspaceFiles Remote namespace |

## attachment

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-attachment-local` | yes | Private content-addressed DSH_HOME attachment storage |

## audio

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-audio` | no | Abstract audio-transcription capability seam (ctx.audio) for the DeepSeek Harness — single-provider registry with a branded reservation, a normalized transcribe contract over raw audio bytes, the AudioTranscribeRequest/AudioTranscript vocabulary, and the AudioError taxonomy |
| `@deepseek-ai/dsh-audio-http` | yes | OpenAI-compatible HTTP transcription provider for the DeepSeek Harness audio seam (ctx.audio) — uploads raw audio bytes as multipart/form-data to a deployment-configured /audio/transcriptions endpoint, reads the bearer token from a named environment variable at call time, and surfaces endpoint failures as typed AUDIO_PROVIDER_FAILED errors with no local fallback |
| `@deepseek-ai/dsh-tool-audio` | yes | Model-facing transcribe_audio tool over the DeepSeek Harness audio seam (ctx.audio) and filesystem (ctx.fs) — bounded audio reads, normalized arguments, bounded transcript rendering, and a graceful unavailable answer when no provider is mounted |

## boot

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-config-editor` | no | Persist plugin configuration through profile patches and Loader reconciliation |
| `@deepseek-ai/dsh-hmr` | yes | Coordinated module and profile configuration hot reload |
| `@deepseek-ai/dsh-plugin-manager` | yes | Current-profile plugin and bundle management shared by dsh CLI, Web and agent tools |

## browser-use

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-browser-use` | no | Exclusive named browser-use provider registration |

## bundle

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-acp-app` | no | The dsh ACP profile bundle: automation-only JSON-RPC stdio and process lifecycle over dsh-base |
| `@deepseek-ai/dsh-headless` | yes | The dsh one-shot bundle: a direct core Agent/Session runner over dsh-base with no Host, HTTP, or browser layer |
| `@deepseek-ai/dsh-sdk-app` | yes | The dsh SDK profile bundle: stdio JSON-RPC serving and process lifecycle over dsh-base |
| `@deepseek-ai/dsh-web-app` | yes | The dsh browser-surface bundle: the web patch layer over dsh-base plus the runtime glue plugin (frontend dist serving, web-surface prompt, bash runtime variables, URL line) |

## client

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-client-connection` | yes | Authenticated RPC transport and generation lifecycle |
| `@deepseek-ai/dsh-client-file-upload` | no | Agent-scoped browser file upload, streaming intake, and staged receipt service |
| `@deepseek-ai/dsh-client-hmr` | yes | Web client graph synchronization and rebuilt-bundle reload transport |
| `@deepseek-ai/dsh-client-locale` | no | Locale plugin: Host-backed preference, extensible language catalog, browser fallback, and typed built-in dictionaries |
| `@deepseek-ai/dsh-client-modules` | no | Client module system, dual-face: node half composes the __DSH_BOOT__ entry graph (incremental dsh.client scan, bundle route, index tap, webPlugins service); browser half is the lazy-CJS module table the vendored cordis Loader consumes as its internal seam |
| `@deepseek-ai/dsh-client-resources` | no | Unified client resource model: protocol-registered providers turn URL addresses into live values, consumed through the useResource global standard hook |
| `@deepseek-ai/dsh-client-shortcuts` | yes | Application keyboard command registry and physical-key routing |
| `@deepseek-ai/dsh-client-ui-agent-preset` | no | Agent-preset surfaces: the default for later sessions, this session's seat, and the composition editor |
| `@deepseek-ai/dsh-client-ui-approval` | no | Approval composer takeover over the scoped Remote Event waterfall |
| `@deepseek-ai/dsh-client-ui-attachment` | no | Dynamic attachment presentation plugin for conversation input, message-image, and trajectory image slots |
| `@deepseek-ai/dsh-client-ui-brand-official` | no | Official DeepSeek Harness brand occupants for the Web client's sidebar slots |
| `@deepseek-ai/dsh-client-ui-chat` | no | Chat Conversation target, node definitions, renderers, and details surface |
| `@deepseek-ai/dsh-client-ui-commands` | no | Client command surface: global directory cache, '/' source, three command UI kinds, popupSelect registry |
| `@deepseek-ai/dsh-client-ui-conversation` | no | Target-neutral Conversation assembly, shell, composer, queue, and view navigation |
| `@deepseek-ai/dsh-client-ui-deliverables` | no | Changed-files card with per-file comparison tabs, delivery cards, and clickable final-response file references for Web |
| `@deepseek-ai/dsh-client-ui-directory-picker-browse` | no | In-app directory browsing surface: the workspace directory-flow owner rendering the host's listing and creation primitives |
| `@deepseek-ai/dsh-client-ui-directory-picker-native` | no | Native directory-picker surface: the renderless workspace directory-flow occupant driving the local Desktop or Host OS chooser |
| `@deepseek-ai/dsh-client-ui-goal` | no | Session goal surface: GoalBar docked above the composer, read from the goal session projection |
| `@deepseek-ai/dsh-client-ui-input-trigger` | no | Input trigger pipeline: '/' and '@' detection, candidate menu, pick routing to registered sources |
| `@deepseek-ai/dsh-client-ui-jobs` | no | Session-header background-job list with on-demand streaming record panels |
| `@deepseek-ai/dsh-client-ui-knowledge` | no | Web knowledge center: the right-Sidebar page listing the deployment's stored knowledge documents |
| `@deepseek-ai/dsh-client-ui-layout` | no | Shell plugin: three-column AppFrame with drag handles, ctx.layout viewing-state service (navigation + panels) |
| `@deepseek-ai/dsh-client-ui-mcp` | no | Web MCP panel: the right-Sidebar page listing the deployment's connected MCP servers with their tools and resources |
| `@deepseek-ai/dsh-client-ui-memory` | no | Web memory center: the right-Sidebar page listing the deployment's stored long-term memories, with the transcript card of one remembered entry |
| `@deepseek-ai/dsh-client-ui-message-feedback` | no | The Web feedback surface: per-message Like/Dislike in the assistant-message action strip and the feedback dialog behind both ratings and /feedback, backed by the messageFeedback and sessionFeedback Host Remotes |
| `@deepseek-ai/dsh-client-ui-model-selection` | no | Model selection over the shared model catalog, Session projection, and session.selectModel |
| `@deepseek-ai/dsh-client-ui-notification` | no | Notification surface: presents Host-raised alerts through the browser's Web Notification API |
| `@deepseek-ai/dsh-client-ui-open-in-app` | no | Web "Open In..." controls: the Session-header split button opening the workspace directory in an installed application, and the document preview's default-application controls for one file |
| `@deepseek-ai/dsh-client-ui-permission-presets` | no | Permission surfaces: a new-session default in General settings and a current-session /permission popup over the permissions projection |
| `@deepseek-ai/dsh-client-ui-plan` | no | Plan mode controls, persistent transcript plan cards, and sidebar Markdown previews |
| `@deepseek-ai/dsh-client-ui-plugin-manager` | yes | Plugin management for the dsh web client: the sidebar Plugins panel installs, enables, disables, retries, and composes installed plugin packages |
| `@deepseek-ai/dsh-client-ui-reference` | no | Unified Web @file and @session reference source |
| `@deepseek-ai/dsh-client-ui-renderer` | no | Browser UI renderer: React slot bindings, ctx.uiRenderer, and the assembled application root |
| `@deepseek-ai/dsh-client-ui-schedule` | no | Host task management page and Session reminder catalog |
| `@deepseek-ai/dsh-client-ui-session` | no | Session Controller adapter for React and session-scoped slots |
| `@deepseek-ai/dsh-client-ui-settings` | no | Settings domain base plugin: shared configuration forms and the canonical settings slot-type contract |
| `@deepseek-ai/dsh-client-ui-settings-account` | yes | Manage DeepSeek login and open Platform billing pages |
| `@deepseek-ai/dsh-client-ui-settings-agent-loop` | no | Settings page of the agent loop on the dsh web client's Plugins page: the parallel tool-call cap of the agent-loop namespace |
| `@deepseek-ai/dsh-client-ui-settings-general` | no | Settings ownerless-copy and product onboarding plugin: the General section, shell trigger/header chrome content, settings dictionaries, and the versioned welcome notice |
| `@deepseek-ai/dsh-client-ui-settings-models` | yes | Models settings and shared product-onboarding dialogs over existing settings and credential joins |
| `@deepseek-ai/dsh-client-ui-settings-plugin-inventory` | no | Read-only Cordis Loader inventory tab in Web Plugins settings |
| `@deepseek-ai/dsh-client-ui-settings-plugins` | no | Built-in plugins settings section for the dsh web client: the Settings navigation entry and the tab chrome feature-owned tabs register into |
| `@deepseek-ai/dsh-client-ui-settings-shell` | no | Settings page of the shell executor on the dsh web client's Plugins page: the command timeout and the per-stream output cap of the shell namespace |
| `@deepseek-ai/dsh-client-ui-settings-speech` | no | Settings page of the speech synthesis Remote on the dsh web client's Plugins page: provider readiness, the voice selection, the reading speed, and a preview |
| `@deepseek-ai/dsh-client-ui-settings-subagent` | no | Settings page of Subagent delegation on the dsh web client's Plugins page: recursion depth, parallel capacity, and the models agents may choose for subagents |
| `@deepseek-ai/dsh-client-ui-settings-web-search` | no | Settings page of the DeepSeek web-search provider on the dsh web client's Plugins page: its API key, endpoint, and per-request search budget |
| `@deepseek-ai/dsh-client-ui-shortcuts` | no | Keyboard shortcut reference, recording, and local preference editing |
| `@deepseek-ai/dsh-client-ui-sidebar` | no | Sidebar plugin: session multi-level tree, search, grouping, state dots |
| `@deepseek-ai/dsh-client-ui-sidebar-browser` | no | Sandboxed Web browser tabs for the right Sidebar |
| `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` | yes | Extensible Sidebar previews for Office documents, spreadsheets, Markdown, code, images, PDF, HTML, and plain text |
| `@deepseek-ai/dsh-client-ui-sidebar-files` | no | Workspace file tree tab type for the right Sidebar: lazy directory listing over the workspaceFiles Remote namespace, opening files into the Sidebar |
| `@deepseek-ai/dsh-client-ui-sidebar-right` | no | Right Sidebar: the docking surface's session-bound state, its panel and header expand control, and the navigation service over it |
| `@deepseek-ai/dsh-client-ui-sidebar-terminal` | no | Interactive shell tabs for the right Sidebar |
| `@deepseek-ai/dsh-client-ui-skill` | no | Web skill references and the dedicated skill tool row |
| `@deepseek-ai/dsh-client-ui-subagent` | no | Subagent conversation catalog, continuation routing UI, and '@' reference source |
| `@deepseek-ai/dsh-client-ui-theme` | yes | Theme plugin: Host bootstrap for the pre-plugin palette; DOM-free ThemeRuntime for light/dark/system state; --dsw-* token styles and Appearance settings row |
| `@deepseek-ai/dsh-client-ui-tool` | no | Client Tool call-tree renderer and keyed per-tool presentation slot |
| `@deepseek-ai/dsh-client-ui-trajectory` | no | Trajectory event ledger with an interactive timing overview: pure-consumer plugin registering into the conversation ViewMap (no service) |
| `@deepseek-ai/dsh-client-ui-user-questions` | no | Web ask_user_question composer takeover and plan-review presentation UI |
| `@deepseek-ai/dsh-client-ui-workflow-run` | no | Durable workflow-run Conversation Node and nested member disclosure for dsh web |
| `@deepseek-ai/dsh-client-ui-workspace` | no | Workspace picker plugin: one WorkspacePicker registered into the sidebar and empty-state workspace slots |

## code-index

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-code-index` | no | Abstract code-index capability seam (ctx.codeIndex) for the DeepSeek Harness — single-provider registry with a branded reservation, a normalized lexical code-search request and ranked result page, and the CodeIndexError taxonomy |
| `@deepseek-ai/dsh-code-index-hybrid` | yes | Opt-in hybrid code-index provider for the DeepSeek Harness code seam (ctx.codeIndex) — structure-aware block chunking, BM25 over node:sqlite FTS5, and vectors from a deployment-supplied OpenAI-compatible embeddings endpoint, fused by reciprocal-rank fusion |
| `@deepseek-ai/dsh-code-index-sqlite` | yes | SQLite FTS5 code-index provider for the DeepSeek Harness code seam (ctx.codeIndex) — walks a configured workspace root into a derived BM25-ranked line-chunk index over node:sqlite and answers normalized lexical code-search queries |
| `@deepseek-ai/dsh-tool-code-index` | yes | Model-facing search_codebase tool over the DeepSeek Harness code-index seam (ctx.codeIndex) — one read-only lexical code search with optional glob and language filters, bounded BM25-ranked result rendering, and a graceful unavailable answer when no provider is mounted |

## compaction

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-command-compact` | no | Human-facing slash command for explicit session compaction |
| `@deepseek-ai/dsh-compaction-basic` | yes | Token-meter-driven compaction policy and LLM summarization backend for the DeepSeek Harness |
| `@deepseek-ai/dsh-compaction-image-offload` | no | Durable image offload for image-capable routes: replace over-budget request images with placeholders and retry |
| `@deepseek-ai/dsh-compaction-tool-result-pruner` | yes | Replay-safe model-free head/middle/tail pruning for tool-result surface nodes |

## computer-use

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-computer-use` | no | Exclusive named computer-use provider registration |

## connector

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-connector` | no | Bidirectional IM connector seam (ctx.connector): verified platform messages into the webhook runtime, Session events out to bound channels |
| `@deepseek-ai/dsh-connector-approval` | yes | Approval bridge for the connector seam: platform interactive-card callbacks answer approval requests as durable resolutions |
| `@deepseek-ai/dsh-connector-dingtalk` | yes | DingTalk callback adapter for the connector seam: signed robot-message callbacks into Sessions, session-webhook text replies out |
| `@deepseek-ai/dsh-connector-discord` | yes | Discord Gateway adapter for the connector seam: gateway text and component interactions into Sessions, bot-token text and action-row pushes out |
| `@deepseek-ai/dsh-connector-feishu` | yes | Feishu (Lark) callback adapter for the connector seam: verified event callbacks into Sessions, tenant-token text pushes out |
| `@deepseek-ai/dsh-connector-slack` | yes | Slack callback adapter for the connector seam: signed Events API callbacks into Sessions, bot-token text and Block Kit pushes out |
| `@deepseek-ai/dsh-connector-telegram` | yes | Telegram callback adapter for the connector seam: secret-token webhook updates into Sessions, bot-token text and inline-keyboard pushes out |
| `@deepseek-ai/dsh-connector-wecom` | yes | WeCom callback adapter for the connector seam: signed, AES-decrypted callbacks into Sessions, token-cached text and template-card pushes out |

## context

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-agent-instructions` | yes | Workspace context loader for AGENTS.md/CLAUDE.md instruction files |
| `@deepseek-ai/dsh-file-reference-local` | yes | Local-filesystem ctx.fileReferences provider with bounded fuzzy indexes |
| `@deepseek-ai/dsh-session-reference` | yes | Cross-session snapshot references and durable untrusted model context (ctx.sessionReferenceResolver) |
| `@deepseek-ai/dsh-time-context` | yes | Durable per-step context with the current time and elapsed time |
| `@deepseek-ai/dsh-tmux-context` | yes | Opt-in durable per-step context with this agent's tmux pane and window location |

## core

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-agent` | no | Agent interface, registry, initiator scope, and event vocabulary for the DeepSeek Harness |
| `@deepseek-ai/dsh-agent-default-model` | yes | Default model selection shared by Agent entry points |
| `@deepseek-ai/dsh-agent-loop` | yes | The concrete agent loop plugin for the DeepSeek Harness |
| `@deepseek-ai/dsh-agent-tool-presentation` | yes | Agent-plane presentation selector: composes one agent's tools as PTC mode, native, or both |
| `@deepseek-ai/dsh-session` | no | Event-sourced session store for the DeepSeek Harness |
| `@deepseek-ai/dsh-system-prompt` | yes | System prompt assembly registry for the DeepSeek Harness |
| `@deepseek-ai/dsh-tools` | yes | Tool registry and execution pipeline for the DeepSeek Harness |

## credentials

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-authorization` | no | Authorization seam (ctx.authorization): plugin-owned flows that obtain a credential through a conversation with the human |
| `@deepseek-ai/dsh-credentials-local` | yes | File-backed credentials provider ($DSH_HOME/.env under the live process environment) for the DeepSeek Harness |
| `@deepseek-ai/dsh-deepseek-account-platform` | yes | Authorize DeepSeek accounts through browser PKCE |

## deliverables

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-tool-present` | yes | Explicit workspace file delivery declarations for the DeepSeek Harness |
| `@deepseek-ai/dsh-workspace-changes` | yes | Per-turn workspace file changes recorded from git working-tree snapshots and whole-file captures, with per-file comparisons, for the DeepSeek Harness |

## document

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-documents` | no | Abstract document-creation capability seam (ctx.documents) for the DeepSeek Harness — single-provider registry with a branded reservation, a normalized create contract over Office formats and neutral content blocks, the DocumentCreateRequest/DocumentResult vocabulary, and the DocumentsError taxonomy |
| `@deepseek-ai/dsh-office-create` | yes | LibreOffice-kit document-creation provider for ctx.documents — translates neutral content blocks into OpenDocument intermediates and exports DOCX/XLSX/PPTX through the kit converter (native engine with Node WASM fallback) |
| `@deepseek-ai/dsh-office-to-pdf` | yes | Shared Office-to-PDF conversion with bounded queues and caching |
| `@deepseek-ai/dsh-tool-document` | yes | Model-facing create_document tool for the DeepSeek Harness — creates DOCX/XLSX/PPTX through the documents seam, writes the bytes into the Session workspace, and declares the file through the shared deliverables/presented chain |

## experimental

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-experimental-agent-team` | yes | Implicit-root Agent Teams roster, durable peer mailbox, and shared task DAG |
| `@deepseek-ai/dsh-experimental-api-speech-to-text` | yes | Authenticated experimental speech transcription for browser clients |
| `@deepseek-ai/dsh-experimental-api-text-to-speech` | yes | Authenticated experimental speech synthesis for browser clients |
| `@deepseek-ai/dsh-experimental-auto-review` | no | Per-tool LLM authorization review for the DeepSeek Harness Auto permission preset |
| `@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp` | yes | Experimental per-Session Chromium browser tools through chrome-devtools-mcp |
| `@deepseek-ai/dsh-experimental-browser-use-playwright-mcp` | yes | Experimental per-Session Chromium browser tools through @playwright/mcp |
| `@deepseek-ai/dsh-experimental-browser-use-stagehand-native` | yes | Experimental Stagehand browser tools with separately configured native models |
| `@deepseek-ai/dsh-experimental-client-ui-agent-team` | no | Web Agent Teams roster, task board, and teammate navigation |
| `@deepseek-ai/dsh-experimental-client-ui-voice-input` | no | Record speech and insert editable text into the conversation draft |
| `@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp` | yes | Experimental computer use through an installed Cua Driver MCP executable |
| `@deepseek-ai/dsh-experimental-computer-use-cua-driver-native` | no | Experimental computer-use provider embedding the Cua Driver native npm SDK |
| `@deepseek-ai/dsh-experimental-inspector` | yes | Experimental cross-realm CDP hub for Host debugging and Client Runtime inspection |
| `@deepseek-ai/dsh-experimental-ptc-runtime-python` | yes | CPython subprocess implementation of the DeepSeek Harness PTC execution seam |
| `@deepseek-ai/dsh-experimental-speech-to-text` | yes | Experimental speech recognition with independently selectable providers |
| `@deepseek-ai/dsh-experimental-speech-to-text-sensevoice` | yes | Local SenseVoice ONNX transcription with a managed sherpa-onnx process |
| `@deepseek-ai/dsh-experimental-text-to-speech` | yes | Experimental speech synthesis with independently selectable providers |
| `@deepseek-ai/dsh-experimental-text-to-speech-kokoro` | yes | Local Kokoro ONNX synthesis with a managed sherpa-onnx process |
| `@deepseek-ai/dsh-experimental-text-to-speech-openvoice` | yes | Local OpenVoice v2 voice-cloning synthesis through an externally managed service |
| `@deepseek-ai/dsh-experimental-tool-agent-team` | yes | Scoped model-facing Agent Teams tools over ctx.agentTeams |

## extensions

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-cordis` | no | Cordis dynamic-plugin definition card: the keyed cordis_define tool row with its run/stop switch |
| `@deepseek-ai/dsh-cordis-client-runner` | no | Browser half of dynamic dual-half plugin packages: event subscription, closure evaluation, guard facade, and loader entries |
| `@deepseek-ai/dsh-cordis-host-runner` | yes | Dynamic package definition registry, host-half sandbox lifecycle, and invoke handler table for model-mounted dual-half packages |
| `@deepseek-ai/dsh-tool-cordis` | no | Read-only runtime API inspection for Harness plugin development |

## feedback

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-command-feedback` | no | Log-only session feedback: the record event, the sessionFeedback Host Remote, and the human-facing slash command |
| `@deepseek-ai/dsh-message-feedback` | yes | Canonical Session-log ratings and notes for finalized assistant messages |

## fs

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-fs-local` | yes | Local-filesystem implementation of the DeepSeek Harness filesystem seam (ctx.fs) |
| `@deepseek-ai/dsh-fs-observation-policy` | no | File-context policy plugin for the DeepSeek Harness — observed-state, read-before-edit, and version-guarded write/edit added over the ctx.fs provider seam through the fs/* event gate (no service API) |
| `@deepseek-ai/dsh-fs-sandbox` | yes | Sandbox-enforcing implementation of the DeepSeek Harness filesystem seam: fences write/edit by the per-call sandbox mode (read-only denies mutation, workspace-write contains it to the workspace + temp roots) while reads pass through |
| `@deepseek-ai/dsh-tool-fs` | yes | Model-facing filesystem tools (read, write, edit) over the DeepSeek Harness filesystem seam (ctx.fs) |
| `@deepseek-ai/dsh-tool-fs-search` | yes | Model-facing filesystem discovery tools (glob, grep) backed by the packaged ripgrep binary (@vscode/ripgrep) |
| `@deepseek-ai/dsh-tool-str-replace-editor` | yes | Model-facing view, create, literal replace, and line insert tool over the Harness filesystem service |

## git

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-tool-git-track` | no | Model-facing worktree and pull-request tracking tools for DeepSeek Harness agent sessions, backed by a durable storage domain |

## goal

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-command-goal` | no | Human-facing slash command for persisted same-session goals |
| `@deepseek-ai/dsh-goal` | yes | Event-sourced same-session goal state and lifecycle service for the DeepSeek Harness |
| `@deepseek-ai/dsh-goal-round-driver` | no | Race-fenced same-session goal-round driver |
| `@deepseek-ai/dsh-tool-goal` | yes | Model-facing same-session goal tools with execution-time authority checks |

## guard

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-context-checkpoint` | yes | Pinned-context checkpoint guard: reminds the model to re-obtain pinned context that compaction removed |
| `@deepseek-ai/dsh-repeat-tool-reminder` | yes | Repeat-tool-call guard plugin: advisory reminders when an agent loops on identical tool calls |
| `@deepseek-ai/dsh-tool-call-timeout-policy` | no | Tool-call timeout policy: a tools/execute wrapper that arms a per-tool deadline on exec.signal and returns TOOL_TIMEOUT when it wins |

## hooks

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-hooks-claude-code` | yes | Bridge plugin: run a Claude Code hooks.json / settings hook config on the DeepSeek Harness interception seams |
| `@deepseek-ai/dsh-hooks-codex` | yes | Bridge plugin: run a Codex hooks.json hook config on the DeepSeek Harness interception seams |

## host

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-host-directory-picker-auto` | no | Adaptive chooser of the directory-picker seam: resolves the host situation at boot and mounts the native or browse backend for the DeepSeek Harness web GUI host |
| `@deepseek-ai/dsh-host-directory-picker-browse` | yes | In-app browsing backend of the directory-picker seam (listing/creation primitives over the host filesystem) |
| `@deepseek-ai/dsh-host-directory-picker-native` | no | Native-OS-chooser backend of the directory-picker seam for the DeepSeek Harness web GUI host |
| `@deepseek-ai/dsh-host-frontend-static` | yes | SPA dist server for the Web shell: owns the webserver fallback seat, serving explicit index entries and static assets with traversal rejection and 404 misses |
| `@deepseek-ai/dsh-host-open-in-app` | yes | Host half of open-in-app: resolved application catalog, icons, and the launch endpoint as three webServer routes |
| `@deepseek-ai/dsh-host-plugin-inventory` | no | Read-only Remote projection of current Cordis Loader plugin state |
| `@deepseek-ai/dsh-host-product-telemetry-otel` | yes | Explicit product usage events exported through OpenTelemetry HTTP logs |
| `@deepseek-ai/dsh-host-webserver` | yes | Web route-registration plugin: HTTP and upgrade routes, index transform taps, and static dist fallback; knows no harness concepts |

## image

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-image` | no | Abstract image-generation capability seam (ctx.image) for the DeepSeek Harness — single-provider registry with a branded reservation, a normalized generate contract over text prompts and raw image bytes, the ImageGenerateRequest/ImageResult vocabulary, and the ImageError taxonomy |
| `@deepseek-ai/dsh-image-http` | yes | OpenAI-compatible HTTP image-generation provider for the DeepSeek Harness image seam (ctx.image) — posts text prompts as JSON to a deployment-configured /images/generations endpoint requesting base64 answers, reads the bearer token from a named environment variable at call time, and surfaces endpoint failures as typed IMAGE_PROVIDER_FAILED errors with no local fallback |
| `@deepseek-ai/dsh-image-wuyinkeji` | yes | Wuyinkeji (api.wuyinkeji.com) async image-generation provider for the DeepSeek Harness image seam (ctx.image) — submits text prompts to the public GPT-Image-2.5 task endpoint, polls its result-detail endpoint until the task settles, downloads the URL-scoped answer into raw bytes, reads the API key from a named environment variable at call time, and surfaces endpoint failures as typed IMAGE_PROVIDER_FAILED errors with no local fallback |
| `@deepseek-ai/dsh-tool-image` | yes | Model-facing generate_image tool over the DeepSeek Harness image seam (ctx.image) and attachment store (ctx.attachments) — prompt-normalized generation with the image durably committed as an attachment and returned beside a bounded text envelope, and a graceful unavailable answer when no provider or store is mounted |

## interaction

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-commands` | no | Plugin-owned human command registry for DeepSeek Harness UIs |
| `@deepseek-ai/dsh-permission-presets` | yes | User-facing permission presets (ctx.permissionPresets) for the DeepSeek Harness: one product-level Permissions select bundling the sandbox-mode and approval-policy knobs, written through to their own session events |
| `@deepseek-ai/dsh-tool-ask-user` | no | Model-facing ask_user_question tool over the ctx.userQuestions seam |
| `@deepseek-ai/dsh-user-approval` | yes | User-approval seam (ctx.approval) for the DeepSeek Harness: one-shot permission decisions dispatched to composed answerers over the approval/request waterfall, fail-closed by default |
| `@deepseek-ai/dsh-user-questions` | no | Abstract user-questions seam (ctx.userQuestions) for asking the human during agent runs |

## jobs

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-jobs-local` | yes | Process-local implementation of the DeepSeek Harness background job registry seam |
| `@deepseek-ai/dsh-tool-jobs` | yes | Model-facing background job control tools (job_output, job_list, job_kill) over the ctx.jobs registry |

## knowledge

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-knowledge` | no | Abstract knowledge-base capability seam (ctx.knowledge) for the DeepSeek Harness — single-provider registry with a branded reservation, normalized ingest/search/remove/list contracts, the KnowledgeRecord/KnowledgeHit vocabulary, and the KnowledgeError taxonomy |
| `@deepseek-ai/dsh-knowledge-sqlite` | yes | SQLite knowledge-base provider for the DeepSeek Harness knowledge seam (ctx.knowledge) — a zero-dependency FTS5/BM25 lexical store over node:sqlite returning ranked documents with bounded excerpts, titled and optionally sourced |
| `@deepseek-ai/dsh-tool-knowledge` | yes | Model-facing knowledge_ingest, knowledge_search, knowledge_remove, and knowledge_list tools over the DeepSeek Harness knowledge seam (ctx.knowledge) — argument-normalized shared knowledge-base documents with bounded rendered results, a safety-scanned ingest path, and a graceful unavailable answer when no provider is mounted |

## llm

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-deepseek-llm-api-extensions` | no | Additive request-field registry for the official DeepSeek LLM API adapter |
| `@deepseek-ai/dsh-llm` | no | Provider-neutral LLM service interface for the DeepSeek Harness |
| `@deepseek-ai/dsh-llm-deepseek-account` | yes | DeepSeek account provider authentication and discovery |
| `@deepseek-ai/dsh-llm-deepseek-api-key` | yes | DeepSeek api-key provider authentication and discovery |
| `@deepseek-ai/dsh-llm-pi-ai` | yes | pi-ai-backed DeepSeek adapter for the DeepSeek Harness LLM seam (design-verification twin of dsh-llm-deepseek) |
| `@deepseek-ai/dsh-llm-retry` | yes | Provider-routed LLM request retry policy for the DeepSeek Harness |
| `@deepseek-ai/dsh-llm-router` | yes | Signal-driven explicit model routing for the DeepSeek Harness |
| `@deepseek-ai/dsh-plugin-package-inventory-deepseek` | yes | Active Loader-backed plugin package inventory for official DeepSeek LLM API requests |
| `@deepseek-ai/dsh-token-meter` | yes | Replay-aware token measurement service (ctx.tokenMeter) for the DeepSeek Harness |

## lsp

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-lsp` | no | Abstract LSP capability seam (ctx.lsp) for the DeepSeek Harness — language-server provider registry keyed by branded id and extension mapping, order-independent per-query selection, normalized definition/references/implementation/hover requests and results, and the LspError taxonomy |
| `@deepseek-ai/dsh-lsp-stdio` | yes | Generic stdio language-server provider for the DeepSeek Harness LSP capability seam (ctx.lsp) — spawns configured servers, translates JSON-RPC, and serves transient-open goToDefinition/findReferences/goToImplementation/hover queries in the host filesystem namespace |
| `@deepseek-ai/dsh-tool-lsp` | yes | Model-facing lsp tool over the DeepSeek Harness LSP capability seam (ctx.lsp) — one read-only tool with goToDefinition/findReferences/goToImplementation/hover operations, one-based UTF-16 cursor coordinates, bounded location rendering, and hover normalization |

## mcp

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-mcp-client` | yes | MCP client bridge: connects to MCP servers and registers their tools on ctx.tools |
| `@deepseek-ai/dsh-mcp-resources` | no | Scoped MCP resource discovery and reading through shared model tools |

## memory

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-memory` | no | Abstract long-term-memory capability seam (ctx.memory) for the DeepSeek Harness — single-provider registry with a branded reservation, normalized remember/recall/forget/list contracts, the MemoryRecord/MemoryHit vocabulary, and the MemoryError taxonomy |
| `@deepseek-ai/dsh-memory-profile` | yes | Runtime-context injection of saved collaboration-style memories (the memory seam's `style` namespace) so durable user preferences shape future sessions |
| `@deepseek-ai/dsh-memory-reflection` | yes | Turn-end memory reflection: extracts durable user preferences and style guidance from completed turns through an auxiliary model call and writes them back through the memory seam, asking the user first by default (`write: 'ask'`) or writing directly (`write: 'auto'`) |
| `@deepseek-ai/dsh-memory-sqlite` | yes | SQLite long-term-memory provider for the DeepSeek Harness memory seam (ctx.memory) — a zero-dependency FTS5/BM25 lexical store over node:sqlite with an optional external-embedding vector path fused by reciprocal-rank ranking, degrading to lexical on any embedding failure |
| `@deepseek-ai/dsh-tool-memory` | yes | Model-facing memory_write, memory_search, and memory_forget tools over the DeepSeek Harness memory seam (ctx.memory) 鈥?argument-normalized long-term memory with bounded recall rendering and a graceful unavailable answer when no provider is mounted |

## notification

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-notification` | no | Abstract notification capability seam (ctx.notification) for the DeepSeek Harness — single-provider registry with one routed notify operation over provider-agnostic alerts and the NotificationError taxonomy |
| `@deepseek-ai/dsh-notification-desktop` | no | Electron-shell notification provider for the DeepSeek Harness notification seam (ctx.notification) — reserves the seam and forwards every accepted alert over the Desktop Host IPC channel, where the Electron main process raises a native notification, failing at load without that channel |
| `@deepseek-ai/dsh-notification-triggers` | yes | Alert-raising rules for the DeepSeek Harness notification seam (ctx.notification) — watches pending approvals, turn completion, scheduled deliveries, and goal activation, and raises provider-agnostic alerts through ctx.notification |
| `@deepseek-ai/dsh-notification-web` | no | Browser-surface notification provider for the DeepSeek Harness notification seam (ctx.notification) — reserves the seam and republishes every accepted alert as the process-local notification/raised event for a forwarded-event allowlist to carry to a Client, where the browser surface presents it through the Web Notification API |

## plan

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-plan-mode` | yes | Logged per-agent plan mode with deployment guidance, a direct slash command, and a user-reviewed exit |

## preset

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-agent-preset` | yes | Declare an Agent capability composition in Cordis YAML |
| `@deepseek-ai/dsh-agent-preset-registry` | yes | Declarative Agent preset registry and profile-backed editing |
| `@deepseek-ai/dsh-output-style` | yes | Deployment-wide output style section for the DeepSeek Harness |
| `@deepseek-ai/dsh-persona` | yes | Composition-authored deployment persona section for the DeepSeek Harness |

## ptc-runtime

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-ptc-runtime-node` | yes | Sandboxed Node process implementation of the DeepSeek Harness PTC execution capability |

## runtime-diagnostics

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-invariants` | yes | Registry service for package-owned DeepSeek Harness runtime invariants |

## sandbox

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-sandbox-local` | yes | Local process-sandbox backends for the DeepSeek Harness sandbox seam: bwrap, the npm-distributed landlock-run launcher, macOS Seatbelt, or the Windows ACL restricted-token runner — functionally probed, fail-closed |
| `@deepseek-ai/dsh-sandbox-policy` | yes | Per-call sandbox policy resolver and current model context: deployment fallbacks plus each session's mode and workspace root, shared by every enforcing capability family |

## schedule

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-heartbeat` | yes | Heartbeat patrol: a recurring session reminder that reads the heartbeat file and acts on its pending items |
| `@deepseek-ai/dsh-schedule` | yes | Host-wide durable reminders with shared management and original-Session delivery |

## sdk

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-sdk-jsonrpc-server` | yes | Stdio JSON-RPC server plugin for out-of-process DeepSeek Harness SDK clients |

## session

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-session-checkpoint-policy` | no | Semantic session durability checkpoints before model requests and tool side effects |
| `@deepseek-ai/dsh-session-log-deepseek` | yes | Incremental lossless session-log request extension for the official DeepSeek LLM API |
| `@deepseek-ai/dsh-session-persistence-jsonl` | yes | JSONL durable session persistence backend for the DeepSeek Harness |
| `@deepseek-ai/dsh-session-projection` | no | Session-projection seam: the merge-extensible projection type table, the provider contract, and the ctx.sessionProjections registry serving whole current values of log-derived per-session state |
| `@deepseek-ai/dsh-session-projection-cache` | yes | Persisted projection cache (ctx.sessionProjectionCache): durable per-session checkpoint records on the session_projcache storage domain (per-record layout), throttled write-behind, and the cached listing read |
| `@deepseek-ai/dsh-session-rewind` | yes | Per-turn file-tool rewind with restore-to-turn-start semantics for the DeepSeek Harness |
| `@deepseek-ai/dsh-session-stats` | no | Whole-log conversation counts and wall times projection (sessionStats) for the DeepSeek Harness |
| `@deepseek-ai/dsh-session-telemetry-otel` | yes | OpenTelemetry backend for the DeepSeek Harness telemetry seam: hands captured session records to the OTel JS SDK's log pipeline |
| `@deepseek-ai/dsh-session-title` | yes | Log-backed session title service and provider registry for the DeepSeek Harness |
| `@deepseek-ai/dsh-session-title-all-prompts-llm` | yes | All-user-messages LLM provider plugin for DeepSeek Harness session titles |
| `@deepseek-ai/dsh-session-title-first-prompt-llm` | yes | First-message LLM provider plugin for DeepSeek Harness session titles |
| `@deepseek-ai/dsh-session-turn-outline` | no | Whole-log turn outline projection (turnOutline) for the DeepSeek Harness |

## session-query

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-session-log-export` | yes | Web Session-log export command and shared download dialog |
| `@deepseek-ai/dsh-session-query-sqlite` | yes | Concrete ctx.sessionQuery backend with SQLite FTS5 search |
| `@deepseek-ai/dsh-tool-session-query` | yes | Workspace-authorized model-facing session history search, trace, and event read tools |

## settings

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-settings` | no | Abstract user-settings seam (ctx.settings) for the DeepSeek Harness |

## shell

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-bash-local` | yes | Local-subprocess implementation of the DeepSeek Harness bash executor seam |
| `@deepseek-ai/dsh-bash-sandbox` | yes | Sandbox-consuming implementation of the DeepSeek Harness bash executor seam (confines every command via ctx.sandbox, reports denial/enforcement result facts) |
| `@deepseek-ai/dsh-pwsh-local` | yes | Local PowerShell implementation of the DeepSeek Harness bash executor seam |
| `@deepseek-ai/dsh-pwsh-sandbox` | yes | Sandbox-consuming implementation of the DeepSeek Harness PowerShell executor seam (confines every command via ctx.sandbox, reports denial/enforcement result facts) |
| `@deepseek-ai/dsh-shell-env` | yes | Tool-independent managed DSH_* shell environment registry |
| `@deepseek-ai/dsh-tool-bash` | yes | Model-facing bash tool with optional generic background-job and sandbox-escalation support |
| `@deepseek-ai/dsh-tool-bash-persistent` | yes | Model-facing owner-scoped persistent Bash tool backed by the Harness PTY service |
| `@deepseek-ai/dsh-tool-pwsh` | yes | Model-facing pwsh tool over the bash executor seam |
| `@deepseek-ai/dsh-tool-pwsh-persistent` | yes | Model-facing owner-scoped persistent PowerShell tool backed by the Harness PTY service |

## skill

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-skill` | yes | Agent skill provider registry for the DeepSeek Harness |
| `@deepseek-ai/dsh-skill-badge` | no | Bundled dsh badge skill provider for DeepSeek Harness |
| `@deepseek-ai/dsh-skill-filesystem` | yes | Local filesystem skill provider for the DeepSeek Harness |
| `@deepseek-ai/dsh-skill-office` | yes | Bundled Word, PowerPoint, and Excel workflows and structural checks |
| `@deepseek-ai/dsh-tool-skill` | yes | Model-facing skill loading tool for the DeepSeek Harness |
| `@deepseek-ai/dsh-tool-workspace-dependencies` | yes | The load_workspace_dependencies tool: absolute paths into a bundled Python, Node.js, and pnpm payload |

## spill

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-spill-local` | yes | Local-filesystem implementation of the DeepSeek Harness spill storage seam (private session-scoped files) |
| `@deepseek-ai/dsh-spill-policy` | yes | Token-budgeted tool-result retention with recoverable text and image paths |

## ssh

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-fs-ssh` | no | Filesystem provider over the shared POSIX SSH helper |
| `@deepseek-ai/dsh-sandbox-ssh` | no | Remote POSIX sandbox argv provider over the shared SSH helper |
| `@deepseek-ai/dsh-ssh` | yes | Shared OpenSSH connection and versioned POSIX remote helper |
| `@deepseek-ai/dsh-subprocess-ssh` | no | Subprocess and terminal provider over the shared POSIX SSH helper |

## storage

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-storage` | no | Storage hub (ctx.storage): named backend registry plus mounted data-form facilities for the DeepSeek Harness |
| `@deepseek-ai/dsh-storage-domain` | yes | Domain data form (ctx.storage.domain): schema-validated, event-emitting KV domains over storage backends for the DeepSeek Harness |
| `@deepseek-ai/dsh-storage-json` | yes | JSON file KV storage backend for the DeepSeek Harness storage hub |
| `@deepseek-ai/dsh-storage-sqlite` | yes | SQLite storage backend (kv facet) for the DeepSeek Harness storage hub |

## subagent

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-subagent` | yes | Abstract subagent seam (ctx.subagents): named-provider registry for delegating to child agents |
| `@deepseek-ai/dsh-subagent-acp` | yes | Out-of-process ACP subagent backend: drives a child agent in a spawned subprocess over the Agent Client Protocol |
| `@deepseek-ai/dsh-subagent-claude-code` | yes | One-shot Claude Code subagent provider over the official Agent SDK |
| `@deepseek-ai/dsh-subagent-codex` | yes | One-shot Codex subagent provider over the official app-server protocol |
| `@deepseek-ai/dsh-subagent-dsh-sdk` | yes | Out-of-process SDK subagent backend: drives a child DeepSeek Harness runtime subprocess over stdio JSON-RPC through the TypeScript SDK client |
| `@deepseek-ai/dsh-subagent-fork-in-process` | yes | In-process fork subagent backend: runs a child agent seeded with a prefix of the parent's log |
| `@deepseek-ai/dsh-subagent-qoder` | yes | One-shot Qoder CLI subagent provider over the official headless print mode |
| `@deepseek-ai/dsh-subagent-spawn-in-process` | yes | In-process spawn subagent backend: runs a fresh child agent on ctx.agents |
| `@deepseek-ai/dsh-tool-subagent` | yes | Model-facing subagent delegation tool over the ctx.subagents seam |
| `@deepseek-ai/dsh-tool-subagent-control` | no | Globally named send_message, interrupt_agent, and list_agents tools over ctx.subagents continuations |

## subprocess

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-subprocess-local` | no | Local-subprocess implementation of the DeepSeek Harness subprocess seam |

## terminal

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-terminal` | no | Persistent PTY session seam for the DeepSeek Harness — owner-scoped ids, backend registry, interactive sends, reads, signals, and awaited cleanup |
| `@deepseek-ai/dsh-terminal-bash` | yes | Persistent shell PTY backend over the DeepSeek Harness subprocess terminal primitive |
| `@deepseek-ai/dsh-tool-terminal` | yes | Six model-facing persistent PTY tools with owner isolation and generic background-job integration |

## test-support

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-llm-replay` | yes | Replay LLM plugin: short-circuits llm/stream with model chunks reconstructed from a recorded session JSONL (keyless snapshot tests) |

## todo

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-tool-todo` | yes | Model-facing todo_write tool over the DeepSeek Harness event-sourced session log |

## typert

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-typert-loader` | yes | Loader integration for generated Typert package contributions |

## web

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-tool-web` | yes | Model-facing web tools (web_search, web_fetch) over the DeepSeek Harness web capability seam (ctx.web) |
| `@deepseek-ai/dsh-web` | yes | Abstract web access capability seam (ctx.web) for the DeepSeek Harness — search/fetch provider registry, registration-order-independent selection, request/result vocabulary, and the WebError taxonomy |
| `@deepseek-ai/dsh-web-fetch-http` | yes | Anonymous public HTTP(S) fetch provider for the DeepSeek Harness web capability seam (ctx.web) |
| `@deepseek-ai/dsh-web-search-deepseek` | yes | DeepSeek-backed search provider (native web_search via the Anthropic-compatible API) for the DeepSeek Harness web capability seam (ctx.web) |
| `@deepseek-ai/dsh-web-search-exa` | yes | Exa-backed search provider for the DeepSeek Harness web capability seam (ctx.web) |
| `@deepseek-ai/dsh-web-search-perplexity` | yes | Perplexity-backed search provider for the DeepSeek Harness web capability seam (ctx.web) |

## webhook

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-tool-github` | yes | Outbound GitHub commenting tool for DeepSeek Harness review Sessions |
| `@deepseek-ai/dsh-webhook` | no | Fire-and-forget webhook rule runtime that creates Workspace-backed DeepSeek Harness Sessions |
| `@deepseek-ai/dsh-webhook-github` | yes | Signed GitHub HTTP webhook adapter for the DeepSeek Harness webhook runtime |
| `@deepseek-ai/dsh-webhook-outbox` | yes | Durable at-least-once webhook delivery queue with deduplication, retry, and replay |

## wiki

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-repo-wiki` | no | Abstract repo-wiki capability seam (ctx.repoWiki) for the DeepSeek Harness — single-provider registry with read-only access to generated repository wiki pages: one routed getPage, listPages, and outline over neutral page vocabulary |
| `@deepseek-ai/dsh-repo-wiki-generator` | yes | Repo-wiki provider for the DeepSeek Harness — generates Markdown wiki pages from workspace sources through the configured LLM route, tracks per-page source fingerprints for staleness, stores them under .dsh/wiki/, and serves the read-only repo-wiki seam |
| `@deepseek-ai/dsh-tool-repo-wiki` | yes | Model-facing read_wiki tool for the DeepSeek Harness — reads generated repository wiki pages (one page, the page list, or the heading outline) through the repo-wiki seam, returning an actionable unavailable answer when no provider is mounted |

## workflow

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-tool-ralph` | yes | Model-facing fresh-agent Ralph loop over the workflow and subagent seams |
| `@deepseek-ai/dsh-tool-workflow` | yes | Model-facing workflow tool: run a JavaScript orchestration script over ctx.workflowEngine |
| `@deepseek-ai/dsh-workflow-ptc` | yes | Workflow orchestration in the shared sandboxed Node PTC runtime |

## workspace

| Package | Config | Description |
|---|---|---|
| `@deepseek-ai/dsh-workspace` | no | Workspace entity registry (ctx.workspaceRegistry): durable workspace records with validated session attachment over the domain data form for the DeepSeek Harness |
