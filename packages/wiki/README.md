---
description: "The wiki group map: the repository wiki through the repo-wiki seam, its filesystem generator with deployment-configured LLM routes, and the model-facing read_wiki tool, for users and maintainers navigating the group."
kind: "package-group"
---

# wiki/ — Repository wiki for agents

English | [中文](README.zh.md)

## Summary

The wiki group gives agents a consolidated, generated view of repository documentation: `read_wiki` lists pages (with per-page staleness), returns one page's full Markdown, or its heading outline. Use `repo-wiki-generator` to populate the wiki from configured source globs through a deployment-configured LLM route into `<root>/.dsh/wiki/` — plain Markdown that reads directly and commits to Git for team sharing. The shared `repo-wiki` package keeps the page vocabulary (path, title, staleness, content) provider-neutral, and staleness is metadata only: a source change never rewrites a page behind a reader's back. The group answers nothing when no provider is mounted.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`repo-wiki/`](repo-wiki/README.md) | Defines the repository-wiki service: an exclusive single-provider reservation and read-only routes (getPage, listPages, outline) | `ctx.repoWiki` |
| [`repo-wiki-generator/`](repo-wiki-generator/README.md) | Generates Markdown pages from workspace sources through a deployment-configured LLM route and serves the seam from `<root>/.dsh/wiki/` | registers on `ctx.repoWiki` |
| [`tool-repo-wiki/`](tool-repo-wiki/README.md) | Exposes the wiki to the model through `read_wiki` | registers on `ctx.tools` |

Providers generate and store pages, not tools: `tool-repo-wiki` is the only owner of the model-facing name, schema, prompt guidance, and presentation, so swapping a provider never changes how the model asks for the wiki.

-----

<a id="related-documentation"></a>
## Related documentation

- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-repo-wiki) — the `read_wiki` schema the model receives.
- [Repository wiki subsystem](../../docs/subsystems/repo-wiki.md) — the group's registration surface and how the three packages compose.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
