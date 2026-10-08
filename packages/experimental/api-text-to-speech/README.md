---
description: "Expose bounded speech synthesis through the authenticated Web Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-api-text-to-speech

English | [中文](README.zh.md)

## Summary

The `tts` Remote connects browser read-aloud requests to `ctx.textToSpeech`. It exposes provider discovery, one bounded synthesis call, and one bounded recording intake.

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

Compose with the synthesis Service Definition and Typert. `maxTextChars`, `maxAudioBytes`, and `maxReferenceBytes` bound accepted text, returned audio, and accepted recordings. The browser UI mounts this package's generated `/remote` contribution when enabled.

`prepare(providerId, { downloadSource })` forwards one advertised source to the provider; omission keeps its configured policy. The catalog carries `downloadSources` for the picker. The provider rejects unavailable choices and changes to an active task's source.

`intakeVoice(providerId, voiceId, audioBase64)` stores one recording as a new selectable voice; the payload must be canonical base64 within the advertised byte budget.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`catalog()` exposes provider identities, the default selection and synthesis limits. `synthesize()` validates the text length before resolving the selected provider, then checks the encoded result against `maxAudioBytes`. `intakeVoice()` rejects an encoded payload beyond the byte budget with `tts/invalid-recording` and reports non-canonical base64, oversized decoded bytes, or provider rejection as `tts/intake-failed`. The existing gateway owns authentication and cancellation transport. Audio is transient, never a Session event or attachment. No runtime invariant companion is published because validation is stateless and preparation belongs to the provider.

`follow()` streams complete catalogs, including preparation states and current preferences. `prepare()` starts or joins a Host task; `cancelPreparation()` explicitly cancels it. `configure()` persists the supplied preference fields. A disconnected observer does not cancel preparation.

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

- No streaming protocol is exposed; base64 adds transport overhead bounded by the advertised limits.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
