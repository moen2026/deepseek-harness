---
description: "Synthesize speech in a cloned voice through an externally managed OpenVoice v2 service."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-text-to-speech-openvoice

English | [中文](README.zh.md)

## Summary

This provider routes synthesis to an externally managed OpenVoice v2 service over loopback HTTP. The service runs MeloTTS-Chinese plus the OpenVoice tone-color converter, so a short reference recording becomes a selectable voice. Activation performs no downloads and loads no models; the Host treats the running service as an operational prerequisite.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

`serviceOrigin` points at the service (default `http://127.0.0.1:9092`); `voice` selects the cloned voice used when a caller omits one, and `speed` scales between 0.5 and 2. Cloned voices are the WAV files in the service's `references/` directory: the file stem is the voice id, and the service extracts a tone embedding per request, so adding or replacing a recording needs no restart. The provider re-probes the roster before every synthesis and announces the result through the service's `catalogChanged()`, so a newly dropped recording becomes selectable in the settings page after the next synthesis.

`displayName` names the provider in the settings page, so one deployment can register a second service under its own id and origin; each registration carries its own `providerId`, `displayName`, `serviceOrigin`, and `requestTimeoutMs`.

The service is started and upgraded outside the Host. While it is unreachable, registration still succeeds with an empty roster, and synthesis fails with the transport error.

The provider advertises recording intake — `audio/wav` and `audio/flac`, bounded by `maxReferenceBytes` — and `intakeVoice()` stores one recording under the given voice id through `PUT /references?name=`, then re-probes the roster, so a stored recording becomes selectable immediately instead of waiting for the next synthesis.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The provider owns no subprocess and no preparation: readiness belongs to the service, and `TtsPreparation` is omitted so the settings page reports the provider as ready. `/health` publishes the cloned-voice roster and is validated with a schema; `/synthesize` takes `{text, voice, speed}` and returns a complete PCM WAV container whose header carries the sample rate. `/references` stores one request body under the query name and answers with the updated roster; an intake failure leaves the previous roster untouched. `maxTextChars`, `maxAudioBytes`, `maxReferenceBytes`, `requestTimeoutMs`, and `healthTimeoutMs` bound intake and replies, and caller cancellation propagates to the in-flight request. Every successful probe publishes the roster through `catalogChanged()`; a probe failure at activation logs a warning and defers discovery to the next synthesis.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Voice input subsystem](../../../docs/subsystems/voice-input.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as synthesis requests remain outside model requests.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- For out-of-band file drops the roster is pull-based: a reference placed into `references/` outside the provider becomes visible only once the next synthesis or intake re-probes it, and no preparation state covers service deployment.
- Service availability is not supervised by the Host; a durable auto-start belongs to the deployment, not this package.
