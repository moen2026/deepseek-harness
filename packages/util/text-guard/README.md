---
description: "Safety scan for untrusted text entering persisted model context: invisible-Unicode detection, bilingual prompt-injection patterns, and credential-shaped tokens with redacted findings."
kind: "package-library"
---

# @deepseek-ai/dsh-text-guard

English | [中文](README.zh.md)

## Summary

`dsh-text-guard` scans untrusted text before it is persisted into model-visible context — long-term memories, agent-authored skill files — and reports three finding kinds: invisible or bidirectionally-reordering Unicode, narrow bilingual prompt-injection patterns, and credential-shaped tokens. Findings never echo a secret: credential matches are redacted to their provider prefix plus a body length, and invisible-Unicode details name code points rather than surrounding text.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Call `scanUntrustedText` at every write path where untrusted text becomes model-visible context. Findings are reasons to reject or redact; the caller owns the rejection policy.

```ts
import { scanUntrustedText } from '@deepseek-ai/dsh-text-guard'

const findings = scanUntrustedText(candidate.text)
if (findings.length > 0) return reject(findings)   // or drop the candidate and log
```

A clean scan returns `[]`. Each finding carries a `kind` (`invisible-unicode`, `injection-pattern`, `credential-like`) and a bounded, redacted `detail` safe to log or show.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The module is one pure function over three pattern tables. Invisible Unicode covers zero-width characters, bidirectional marks and overrides (U+200B–U+200F, U+202A–U+202E), word joiners (U+2060–U+2064), the byte-order mark, and Unicode tag characters (U+E0000–U+E007F). Injection patterns are phrase-anchored directive-verb plus instruction-object pairs in English and Chinese, chosen narrow so ordinary technical prose never matches. Credential patterns require provider-specific prefixes (`sk-`, `ghp_`, `github_pat_`, `AKIA…`, `xox…-`, `eyJ…` JWT, PEM private-key headers) plus long bodies, so short lookalike identifiers pass. One aggregated finding per kind keeps output bounded.

</details>

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Advisory, not a guarantee** — a clean scan does not prove text is safe; determined smuggling outside these pattern classes is not detected.
- **No normalization** — homoglyph and Unicode-normalization smuggling is out of scope; only the literal code-point classes above are detected.
- **No I/O, no policy** — the module never reads, writes, or decides; consumers own rejection, redaction, and logging.
