---
description: "Shared managed worker, download, and loopback protocol primitives for local speech providers."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-local-speech-runtime

English | [中文](README.zh.md)

## Summary

This library package holds the primitives shared by local speech providers: verified asset downloads, mirrored model-source probing, the private loopback protocol, and the managed worker lifecycle. It defines no services and ships no native code.

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

Compose it from a provider package; never mount it directly. `matchesAsset`, `downloadAsset`, and `orderAssetSources` implement size- and digest-pinned downloads with atomic publication. `startLoopbackServer` serves one authenticated private endpoint whose stdout carries only the readiness frame. `ManagedSpeechWorker` owns one serial subprocess across bounded, cancellable calls with idle reclamation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`downloadAsset` streams into a unique partial file, verifies the pinned byte count and SHA-256 digest, then renames it into place; failures are classified into `SpeechDownloadError` diagnostics that omit credentials, query strings, and raw causes. `orderAssetSources` races HEAD probes and prefers the first 2xx response while retaining the configured order as fallback. `readReady`, `readJsonReply`, and `readBufferReply` frame the worker protocol with byte limits. `ManagedSpeechWorker` queues calls behind a serialized tail, publishes complete preparation snapshots with throttled intermediate download progress, applies separate preparation and inference deadlines, and joins accepted work on cancellation or disposal.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Voice input subsystem](../../../docs/subsystems/voice-input.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as it downloads and verifies pinned speech assets without touching model requests.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The protocol assumes one request per connection shape defined by the provider; multiplexing is deferred.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
