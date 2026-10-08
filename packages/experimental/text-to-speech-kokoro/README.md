---
description: "Prepare and operate a local CPU Kokoro synthesis worker on demand."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-text-to-speech-kokoro

English | [中文](README.zh.md)

## Summary

This provider synthesizes speech with Kokoro-82M v1.1-zh ONNX and espeak-ng phonemization on the Host CPU. The platform-specific sherpa-onnx Node package includes ONNX Runtime; users need no Python, compiler or model conversion. Activation checks cached resources without loading models or downloading assets.

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

The bundle supplies an absolute `dataRoot` under the DSH home. Preparation downloads the revision-pinned `kokoro-multi-lang-v1_1` tarball, verifies its size and SHA-256 hash, extracts it, then verifies every managed file. `voice` defaults to `zf_001` and selects any advertised `zf_*` or `zm_*` voice; `speed` scales between 0.5 and 2. `modelDirectory` supplies an existing absolute directory containing the extracted bundle; `espeakDataDir` selects an existing espeak-ng-data directory. Verified completed files remain reusable after cancellation or failure.

Before the tarball is downloaded, the Host probes the configured `modelOrigins`, which default to the official GitHub release and two mirror prefixes. `modelProbeTimeoutMs` defaults to 3000 ms; when every probe fails, downloads use the configured order. Network, HTTP, certificate and integrity failures try the remaining sources; cancellation, storage failures and unclassified failures stop preparation. Pinned size and SHA-256 hash apply to every source. An explicit `modelOrigin` uses only that source, without probing or fallback. Fully offline deployments advertise no download sources.

Every activation checks the extracted bundle on disk. Complete verified caches restore readiness immediately after inspection; the first synthesis wakes the worker. Missing files or mismatched managed checksums require explicit preparation, while unreadable paths report an error.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

One managed Node subprocess serializes inference. Text submitted during wake-up joins the bounded queue. At execution, the worker requires ready or standby resources. Synthesis never starts preparation downloads. `threads` tunes CPU inference; `maxTextChars` and `maxAudioBytes` bound intake and replies; `maxPending` bounds accepted work. Preparation and inference have separate deadlines. Invalid text, voice or speed input is rejected before native inference and retains the loaded worker; inference failures, malformed replies and transport failures reclaim it. Cancellation terminates an active worker and joins its process range; cancelled queued text never runs. `idleTimeoutMs` releases the worker after inactivity, with zero retaining it until disposal. Models remain cached. Authenticated loopback requests keep audio in memory; the private worker replies with a complete PCM16 WAV container whose header carries the native sample rate. The bundled `runtime/assets.json` pins every managed file hash and the voice-to-speaker order embedded in `voices.bin`. No runtime invariant companion is published because `dsh-subprocess` owns process-range observations and this provider has no independent projection to reconcile.

The Host owns preparation across page and Session changes: check resources, download the tarball, extract and copy the bundle, verify files, and load the worker. Explicit model paths omit their download steps. Downloads report bytes; other steps report elapsed time. An idle worker retains prepared paths and needs only model loading on wake-up.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Voice input subsystem](../../../docs/subsystems/voice-input.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as synthesis requests and preparation remain outside model requests.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Streaming synthesis and GPU acceleration are not exposed; long text is bounded by `maxTextChars` rather than chunked.
- Voice selection is exposed through configuration and the catalog; a dedicated picker is deferred.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

The model ships under the Apache-2.0 license; the pinned tarball hash is recorded in `runtime/assets.json` and was measured from the official release archive.

</details>
