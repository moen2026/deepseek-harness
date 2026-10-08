---
description: "The filesystem repo-wiki provider (dsh-repo-wiki-generator): generates Markdown wiki pages from workspace source documents through a deployment-configured LLM route, records per-page source fingerprints in front matter, and serves the ctx.repoWiki read routes from <root>/.dsh/wiki/."
kind: "package-reference"
---

# @deepseek-ai/dsh-repo-wiki-generator

English | [中文](README.zh.md)

## Summary

Use `dsh-repo-wiki-generator` to populate the repo-wiki seam: it walks configured source globs, generates one consolidated Markdown wiki page per source through the deployment's LLM route, and serves the seam's read routes from plain files under `<root>/.dsh/wiki/`. Each page's front matter records its source path and generation-time fingerprint, so a changed source reads back as `stale` — the generator never rewrites a page behind a reader's back, and regeneration runs only when explicitly kicked off. Pages are plain Markdown, directly readable and committable to Git for team sharing.

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

Mount the plugin with a workspace root and an LLM route; it reserves the seam and, by default, kicks off one regeneration pass at startup.

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `root` | *(required)* | Absolute workspace root the wiki describes and under which pages are stored |
| `outDir` | `.dsh/wiki` | Wiki storage directory relative to `root` |
| `sources` | `['docs/subsystems/*.md', 'packages/*/README.md', 'packages/*/*/README.md']` | Glob patterns of source documents, relative to `root` |
| `llmProvider` | *(required)* | LLM provider name owning the generation route |
| `llmModel` | *(required)* | LLM model name used for generation |
| `maxSourceChars` | `24000` | Largest source excerpt per generation call, in characters |
| `maxTokens` | `4096` | Generation-call output budget in tokens |
| `timeoutMs` | `300000` | Per-call generation timeout budget in ms |
| `regenerateAt` | `startup` | Whether `apply` kicks off one regeneration pass at startup (`startup` or `never`) |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-repo-wiki-generator) is the exhaustive source for every accepted field.

### Storage layout and staleness

Each source becomes one flat page (for example `packages/wiki/tool-repo-wiki/README.md` becomes `packages-wiki-tool-repo-wiki-README.md`); non-alphanumeric runs collapse into hyphens. A page is Markdown with a front-matter block recording `dsh-wiki-source` (the workspace-relative source path) and `dsh-wiki-fingerprint` (a size-and-mtime fingerprint taken at generation time). Reads compare the recorded fingerprint against the source's current stat, so staleness needs no side table; a page without well-formed front matter still reads, as `stale`. A regeneration pass generates pages for new or changed sources, leaves matching pages untouched, and removes pages whose source disappeared. A startup regeneration failure is swallowed so a broken LLM route never blocks startup.

### Failures

`REPO_WIKI_GENERATION_TIMEOUT` surfaces when one generation call exceeds `timeoutMs`. A model response without text content is an error — the pass reports it through the swallowed startup path or rejects the caller's `regenerate` promise. Malformed configuration (non-positive integers, a blank `outDir`) fails loud at plugin load.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider and where the code realizes them; observable behavior is covered in [Use this package](#use-this-package).

### Design notes

- **Staleness is metadata, not a trigger.** The generator never rewrites a page because its source changed; regeneration happens only when a pass runs, and until then readers see `stale: true` alongside unchanged content.
- **Front matter is the only bookkeeping.** Source path and fingerprint live inside each page, so the wiki is self-describing, readable as plain files, and shareable through Git with no database.
- **One page per source, one call per page.** `buildGenerationRequest` frames a truncated source excerpt with a fixed system prompt that demands a standalone page preserving concrete facts; `extractText` refuses an empty response rather than writing an empty page.
- **Deterministic helpers stay pure.** Naming, (de)serialization, fingerprints, prompt construction, and outline extraction live in `pages.ts`, unit-tested without I/O or an LLM.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, `FsWikiProvider` registration, and the regeneration pass |
| [`src/pages.ts`](src/pages.ts) | Pure helpers: page naming, front-matter (de)serialization, fingerprints, prompt framing, outline extraction |
| — | No runtime invariant companion is published; the wiki directory, its page front matter, and the regeneration pass are private implementation state, and this provider publishes no independent lifecycle event stream or enumerable snapshot. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the provider to the seam it populates and the tool that exposes it.

- [Repository wiki subsystem](../../../docs/subsystems/repo-wiki.md) — the three-package split, storage layout, and staleness semantics in context.
- [`dsh-repo-wiki`](../repo-wiki/README.md) — the seam this provider reserves and serves.
- [`dsh-tool-repo-wiki`](../tool-repo-wiki/README.md) — the model-facing `read_wiki` tool that reads the pages this generator writes.

<a id="model-experience"></a>
## Model Experience

None, as the provider generates and stores wiki pages without contributing anything to agent model requests; `dsh-tool-repo-wiki` owns the model-facing schema and rendering.

#### KV Cache effect

No effect; this provider contributes nothing to agent model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is a poor fit. They are current package constraints, not a task backlog.

- **One page per source document** — the wiki's granularity follows its sources; the generator cannot merge several sources into one page or split one source across pages.
- **Size-and-mtime fingerprints** — a same-size touch marks a page stale, and an edit preserving both leaves it fresh; content hashing is deferred.
- **Startup failures are silent** — a failed startup regeneration pass is swallowed by design so startup never blocks; watch the pages' `stale` flags instead of expecting an error report.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
