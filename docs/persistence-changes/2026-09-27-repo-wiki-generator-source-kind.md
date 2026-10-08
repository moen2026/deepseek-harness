---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-27-repo-wiki-generator-source-kind

English | [中文](2026-09-27-repo-wiki-generator-source-kind.zh.md)

## Summary

Add the `dsh-repo-wiki-generator` message source kind: wiki page generation prompts carry explicit source attribution in the repository-wiki generation pipeline.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-27-repo-wiki-generator-source-kind
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-16-session-format-v4"
    after: "8a250f1bffe1987f17208cb1adb112574b525d2af3623abc83a319edd71ed82a"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-16-session-format-v4"
    after: "69d8f2d2ea43a7e41b74d49bdc707771fc80e5c4217c2873813219a0ad7e4400"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-16-session-format-v4"
    after: "f72b4d4854f1b3f1fc36c53e2a5d9582b55bc1f39e38ebb21c26c67a9d3fac6a"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-16-session-format-v4"
    after: "66fc84f350891800c645b093f222396c35a0204a76f4c7d0cef0e20cae73d7a1"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The new kind only extends the explicitly qualified attribution union on the message source slot; existing kinds and their supported policies are unchanged, so no logged data is rewritten and the Session header stays V4. Readers that reject unknown attribution kinds are the only affected surface.

<a id="verification"></a>
## Verification

The generated persistence catalog pair and schema inventory are regenerated; the classifier accepts the added attribution kind under the same supported policy, and the bilingual record pair verifies consistent.

<a id="dev-note"></a>
## Dev Note

None.
