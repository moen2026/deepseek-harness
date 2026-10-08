# Agent Note: Plugin marketplace catalog

Status: proposed

English | [中文](2026-10-02-plugin-marketplace.zh.md)

## Problem

Installing a bundle today means typing a raw spec — an npm package name, a Git URL, or a tarball — into the Web plugin page, the `plugin_manager` tool, or `dsh plugin`. The [registry plan](../../implemented/architecture/2026-09-18-plugin-install-registries.md) decided which registry answers a spec; nothing helps a person discover what exists. `inspect` answers only the fields a package manifest carries, there is no curated set of recommended bundles, no reviewed version, and no place to read what a bundle contains before installing it. A distribution that wants to offer a controlled catalog — an enterprise shipping a vetted internal set, a team sharing profile bundles — must document package names in prose.

## Proposal

Add an optional **catalog source** to plugin management: a versioned JSON document at a URL, typically a raw file in a Git repository. A catalog lists curated entries — package spec, display name, category, one or more pinned reviewed versions, license, and an optional safety note — and is data only: it never hosts code, and the catalog client validates it against a schema before any entry is shown.

The client lives in `dsh-plugin-manager` beside the existing spec operations. It fetches with the same proxy environment installs use, caches the document, and reports staleness instead of silently serving an old copy. The Web plugin page gains a browse surface over configured catalogs; installing from a catalog entry routes through the unchanged `inspect` and `installBundle` pipeline, pinned to the entry's reviewed version. Multiple catalogs may be configured; none ships enabled, and a deployment without one sees no new surface.

### Trust and review

A catalog earns trust from its curator, not from the transport. Entries pin exact versions so a reviewed version cannot silently drift; an entry without a pinned version is flagged in the browse surface rather than rendered like a reviewed one. Curator identity and the review process are deployment decisions — the format carries the fields, not the policy.

## Alternatives considered

**A hosted marketplace service** with search, ratings, and a publish API. Rejected for now: it buys infrastructure and moderation ownership DSH does not have, while a static catalog delivers discovery at near-zero cost; the catalog format should be a subset of any later service's response.

**npm search as the discovery surface.** Rejected as the only answer: every published name appears, including typosquats, and nothing distinguishes a reviewed bundle from an arbitrary one. Catalog curation is the feature.

**Baking a shipped catalog into the application.** Rejected: it date-stamps the bundle set at build time and only an application update can change it; a remote document lets a curator revise recommendations independently.

**Replacing pnpm with a custom install transport for catalog entries.** Rejected: the registry plan just hardened pnpm-based installs (mirror fallback, file restore on failure, build-script approval); a second transport would re-own all of it.

## Acceptance criteria

- A deployment can configure a catalog URL and browse its entries in the Web plugin page; installing an entry produces an ordinary bundle through the existing registry plan.
- Pinned entries install the pinned version; an unpinned or stale entry is visibly flagged, and a malformed or unreachable catalog degrades to an explicit error state, never to an unreviewed fallback listing.
- With no catalog configured, every existing surface behaves exactly as today.
- The `plugin_manager` tool can list catalog entries so an agent can browse on request.

## Risks

Dependency confusion through a curated name is mitigated only by the existing private-registry isolation and exact-version pinning; a catalog that pins loosely reintroduces the risk the registries note closed. Curation is a human process the tooling cannot enforce — the catalog's value equals its review discipline. Git-hosted raw documents have caching and availability quirks, and a stale catalog can advertise versions the registry no longer holds.
