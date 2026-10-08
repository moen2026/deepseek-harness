# Agent Note: Generated repository wiki

Status: implemented

English | [中文](2026-09-27-repo-wiki-generated-documentation.zh.md)

## Problem

Models are often asked questions about a repository's architecture, packages, and documented behavior, and every answer re-derives the picture from source through lexical search and file reads. `code-index` makes retrieval cheap but returns fragments, not a consolidated view; nothing in the harness maintains a readable, team-shareable summary a model can consult before re-deriving. Qoder parity (roadmap A1) requires a repository wiki: generated pages that consolidate documented structure, served read-only to the model, without ever changing behind a reader's back.

## Decision

The repository wiki ships as the standard three-layer family in a new `packages/wiki` group: the [dsh-repo-wiki](../../../../packages/wiki/repo-wiki) seam (`ctx.repoWiki`: a single-provider reservation plus read-only `getPage`/`listPages`/`outline` routes over wiki-relative `.md` paths), the [dsh-repo-wiki-generator](../../../../packages/wiki/repo-wiki-generator) provider, and the [dsh-tool-repo-wiki](../../../../packages/wiki/tool-repo-wiki) consumer (the `read_wiki` tool plus a system-prompt section at first-party order 2260 that tells the model to check the wiki before re-deriving architecture answers).

Two decisions define the provider's contract with its readers:

- **Staleness is metadata, never a trigger.** Each generated page carries front matter recording its source path and a generation-time fingerprint (size plus mtime). Reads compare the fingerprint against the source's current stat; a mismatch reads back as `stale: true` alongside the unchanged content. Nothing rewrites a page because its sources changed — regeneration happens only when a pass explicitly runs, so the wiki never mutates between a model's `listPages` and its `getPage`.
- **Plain Markdown with self-describing pages.** Pages live under `<root>/.dsh/wiki/` as ordinary `.md` files whose front matter is the only bookkeeping — no database, no side table — so the wiki reads directly and can be committed to Git for team sharing, matching Qoder's `.qoder/repowiki` positioning.

The `full` preset mounts an isolated `repo-wiki` group in which the seam and the tool always load and the generator loads only when the deployment configures a generation route (`DSH_WIKI_LLM_PROVIDER` and `DSH_WIKI_MODEL`); without a provider the tool answers "unavailable" in a form the model can report and act on.

## Alternatives considered

**Regenerating pages when sources change.** Auto-rewrite on fingerprint mismatch would keep pages fresh but violates read stability: a model that listed pages and then read one could see the wiki change underneath it. Staleness metadata keeps regeneration an explicit, opt-in act.

**Storing staleness in a side database.** A `node:sqlite` fingerprint table would hide the state machine inside the harness and make the wiki directory non-portable; front matter keeps every page self-describing and makes team sharing a plain Git commit.

**Deriving the wiki at read time from `code-index`.** Serving pages by on-demand synthesis would couple every read to an LLM call and make results nondeterministic across calls; pre-generation keeps reads cheap, deterministic, and offline.

## Consequences

- A deployment that sets the two wiki environment variables gets a generated wiki and a `read_wiki` tool that recalls it; without them the tool answers "unavailable" and the session continues.
- Generated pages may be committed and shared; a page whose source changed reads back as stale until someone runs a regeneration pass.
- `docs/subsystems/repo-wiki.md` gains a generated Cordis API section; `read_wiki` is catalogued in `docs/tool-catalog.md` with its system-prompt section at first-party order 2260.
