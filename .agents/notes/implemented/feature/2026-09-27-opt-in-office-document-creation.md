# Agent Note: Opt-in office document creation

Status: implemented

English | [中文](2026-09-27-opt-in-office-document-creation.zh.md)

## Problem

Models are often asked to deliver a formatted document — a report, a spreadsheet, a slide deck — but the harness could only *convert* Office files, not *create* them: `office-to-pdf` turns existing LibreOffice-readable files into PDFs, yet there was no first-party path from a model's structured content to a DOCX/XLSX/PPTX deliverable. QoderWork parity (roadmap A2) requires the model to author Office documents on request, and the generated file must flow through the same deliverable presentation chain as every other durable output.

## Decision

Document creation ships as the standard three-layer family on top of the existing `packages/document` group: the [dsh-documents](../../../../packages/document/documents) seam (`ctx.documents`: a single-provider reservation plus one order-independent `create` route taking neutral content blocks — heading, text, bullets, table, chart placeholder — and returning finished document bytes), the [dsh-office-create](../../../../packages/document/office-create) provider, and the [dsh-tool-document](../../../../packages/document/tool-document) consumer (the `create_document` tool: create, then write the bytes into the Session workspace with `fs.writeBytes` under a never-overwrite policy, then declare the file through the shared `deliverables/presented` chain so it presents like any other deliverable).

The provider reuses the LibreOffice engine already in the repo instead of introducing a second Office writer:

- **OpenDocument intermediates.** The provider renders the neutral blocks into a minimal ODT/ODS/ODP zip (fflate, `mimetype` first entry stored uncompressed), then converts to the requested OOXML format through the existing libreoffice-kit `convert` path. One writer serves three output formats, and the intermediate format is a private concern of the provider.
- **Budget and cleanup discipline.** Per-call scratch directories are cleaned up even on failure; engine calls are bounded by `timeoutMs` and output size by `maxOutputBytes` (both config, no hardcoded tunables).
- **Typed failures.** Every engine-side failure is a typed `DocumentError` `DOCUMENT_PROVIDER_FAILED`; no provider registered means the tool answers "unavailable" in a form the model can report and suggest from, never a broken session.

The `full` preset mounts an isolated `documents` group in which the seam and the tool always load and the provider loads with the documents group; the tool schema does not depend on any provider, so its model-visible surface is stable across deployments.

## Alternatives considered

**Emitting OOXML directly from the provider.** Writing DOCX/XLSX/PPTX by hand triples the surface (three markup vocabularies), and the repo already trusts LibreOffice to read those formats for `office-to-pdf`; routing creation through the same engine keeps one Office dependency.

**A second seam for document generation.** The roadmap item names one capability; a separate `document-create` seam would duplicate the reservation/routing pattern for a single operation. The `documents` seam follows the image/audio template: one seam, one provider slot, one route.

**Returning a path without present.** The deliverables chain already renders durable files with review affordances; bypassing it would make created documents second-class outputs.

## Consequences

- A deployment that loads the group gets `create_document`; without a provider it answers "unavailable" and the session continues.
- Created documents appear in the workspace and the deliverables chain like hand-written files; the `deliverables/presented` event type remains owned by the present tool's package (one declaration), and this consumer reuses it.
- `docs/subsystems/documents.md` gains a generated Cordis API section; `create_document` is catalogued in `docs/tool-catalog.md` with its system-prompt section at first-party order 2457.
