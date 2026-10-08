---
description: "The model-facing read_wiki tool over the ctx.repoWiki seam: read one generated wiki page (or its heading outline), list the whole wiki, and see per-page staleness, with an actionable unavailable answer when no provider is mounted, for users and maintainers composing repository documentation workflows."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-repo-wiki

English | [中文](README.zh.md)

## Summary

`dsh-tool-repo-wiki` gives a model one tool over `ctx.repoWiki`: `read_wiki` reads one generated wiki page's full Markdown content (optionally as its heading outline) or, without arguments, lists every page with its path, title, and staleness flag. The tool is unavailable until a repo-wiki provider is mounted; without one it returns an actionable "repo wiki unavailable" message instead of failing the session. A page whose sources changed after generation carries a staleness notice so the model can verify against live files when precision matters. The package runtime-injects only `tools`, `repoWiki`, and `systemPrompt` and imports no provider.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

A model calls `read_wiki` when it needs consolidated repository documentation; the tool's prompt guidance tells it to check the wiki before re-deriving architecture answers from source, and to fall back to search/read while the capability is not configured.

### The tool

`read_wiki` takes an optional `path` and an optional `outline` flag. Omitting `path` lists every page; `path` alone returns one page's full content; `path` plus `outline=true` returns that page's heading structure instead. Arguments are trimmed and validated before the seam — a blank or non-`.md` path, or `outline` without a path, is an actionable argument error rather than a crash.

### What the model gets back

A listing renders one `path — title [stale]` line per page; an outline adds the page's indented `#`-prefixed heading lines under each `path — title` line; a page read renders the page's Markdown content prefixed by a `[stale: …]` notice when its sources changed after generation. An empty wiki renders `The wiki has no pages yet.` Every render is bounded by `maxResultChars` with a truncation notice counted inside the cap. When no provider is mounted, the render is the actionable unavailable message instead of an error.

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `maxResultChars` | `16000` | Largest complete rendered result, including the truncation notice |
| `timeoutMs` | `30000` | Tool-call timeout budget, covering one provider read |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-repo-wiki) is the exhaustive source for every accepted field.

### Failures and recovery

A `REPO_WIKI_UNAVAILABLE` from the seam is caught and returned as `status: 'unavailable'` so the session keeps running. `REPO_WIKI_NOT_FOUND` (no page at the requested path, including an outline request) and any other `RepoWikiError` propagate as structured tool errors the model can read and route on.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tool and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design notes

- **Consumer-only.** The tool runtime-injects only `tools`, `repoWiki`, and `systemPrompt`, imports no provider, and passes no cancellation signal — one wiki read is fast and idempotent.
- **Argument normalization before the seam.** `parseReadWikiArgs` trims inputs and enforces the `.md` suffix and the `outline`-requires-`path` rule, so the provider receives a canonical request and malformed input is an actionable error rather than a crash.
- **Availability is data, not a crash.** `execute` catches `RepoWikiError` with code `REPO_WIKI_UNAVAILABLE` and returns an `unavailable` status; every other error rethrows, so a genuinely broken provider is still surfaced.
- **Bounded render.** `boundResult` caps the complete rendered text, with the truncation notice counted inside the cap.
- **Concurrency-safe read.** `read_wiki` returns `isConcurrencySafe: () => true` — read-only routing with no shared mutable state.
- **Search-kind call card.** `presentReadWikiCall` renders `{ card: 'generic', kind: 'search', title }` — `Read wiki: <path>` for a page read, `Read wiki: list pages` for the listing.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, prompt section, `read_wiki` registration and execution |
| [`src/render.ts`](src/render.ts) | Pure argument validation, listing/outline/page rendering with result caps, UI presentation |
| — | No runtime invariant companion is published; this stateless adapter contributes one tool and prompt section, while page lifecycle and staleness relations remain owned by the repo-wiki seam it composes. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the model-facing surface to the seam and the provider.

- [Repository wiki subsystem](../../../docs/subsystems/repo-wiki.md) — the three-package split, storage layout, and staleness semantics in context.
- [`dsh-repo-wiki`](../repo-wiki/README.md) — the seam this tool reads through.
- [`dsh-repo-wiki-generator`](../repo-wiki-generator/README.md) — the provider that generates and stores the pages this tool serves.
- [Tool Schema Catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-repo-wiki) — the generated schema this page documents.

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

One system-prompt section (first-party order 2260) positions the wiki among the repository-reading tools with the following text:

##### Verbatim guidance

```markdown
Before answering questions about this repository's architecture, packages, or documented behavior, check read_wiki: the repo wiki holds generated, consolidated pages (with a per-page heading outline) that are cheaper to read than re-deriving the same picture from source. Pages marked stale may be outdated — verify against the live files when precision matters. The wiki is unavailable until a repo-wiki provider is configured; then fall back to search/read.
```

#### Token effect

Fixed guidance cost on every request while the plugin is active.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged; activation or disposal may invalidate reuse from this section.

### Tool schema

#### What the model sees

The model sees the generated [`read_wiki` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-repo-wiki).

#### Token effect

Fixed schema cost on every request while enabled; the `timeoutMs` budget is never sent to the model.

#### KV Cache effect

Prefix-stable while the visible tool definition and order are unchanged; registration lifecycle or scoped restrictions may invalidate reuse from the first changed schema token.

### Results

#### What the model sees

A listing renders one `path — title [stale]` line per page; an outline adds indented headings under each line; a page read renders the page's Markdown with a stale notice when its sources changed. Every render is bounded by `maxResultChars`. When no provider is mounted, the result is the actionable unavailable message instead of an error.

#### Token effect

Every rendered result is capped by `maxResultChars` regardless of the wiki's size.

#### KV Cache effect

Tool results append after the cached request prefix and do not directly invalidate it.

### UI presentation

#### What the model sees

Nothing. The client renders a generic card — `{ card: 'generic', kind: 'search', title }` — titled `Read wiki: <path>` or `Read wiki: list pages`; there is no rendered target, so no locations are attached.

#### Token effect

Zero direct token effect because rendering is client-side only.

#### KV Cache effect

None; UI presentation is outside the model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the tool is a poor fit. They are current package constraints, not a task backlog.

- **Provider-gated availability** — with no repo-wiki provider mounted the tool always returns the unavailable message; it never generates pages itself, so a deployment must mount `dsh-repo-wiki-generator` (or another provider) for real content.
- **One page or one listing per call** — reading several pages is several calls; there is no multi-page parameter.
- **No write or search surface** — the tool reads pages, outlines, and listings only; there is no wiki-side search, and text search belongs to the workspace tools.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
