---
description: "Named experimental synthesis providers with explicit routing and preparation ownership."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-text-to-speech

English | [中文](README.zh.md)

## Summary

This Service Definition selects named speech synthesizers through `ctx.textToSpeech`. Consumers resolve their request before execution; providers register independently.

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

Compose the service with a provider and a consumer. `defaultProvider` selects an exact registered id and is optional when the composition registers exactly one provider; an ambiguous roster fails explicitly. `voiceId` supplies the omitted voice and `speed` the omitted rate; both are volatile preferences. A missing or duplicate provider fails explicitly.

Providers advertise preparation origins through `downloadSources`. `prepare(id, options)` forwards an optional `downloadSource` for one task; the provider validates the choice and refuses source changes during active preparation. Omission retains provider policy. Source choices are not persisted synthesis preferences.

Providers that accept recordings advertise their intake facts through `intake`; `intakeVoice(id, intake, signal)` runs the submitted recording through the exact registration and returns the selectable voice once the provider's roster reflects it. A provider without `intake` refuses explicitly.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`resolve()` captures the provider instance, text, voice and rate. `synthesize()` rejects a withdrawn or replaced registration. A registration disposer closes admission, aborts accepted requests and joins provider settlement; providers must honor cancellation. No fallback selects a different synthesizer. No runtime invariant companion is published because the registry is the sole source of provider and preparation observations.

`intakeVoice()` applies the same registration discipline as `synthesize()`: the combined caller and registration signal aborts waiting and running intake, and a withdrawn registration joins submitted intake before settling.

`defaultProvider`, `voiceId` and `speed` are volatile Config fields: `configure()` writes the supplied fields into this plugin's profile entry through the `settings` service, and the running instance reads the updated values without remounting. `configure()` fails without `settings` or a profile entry, and rejects a voice or rate unsupported by the selected provider before saving. Providers advertise accepted voices through `voices`; `resolve()` validates the selected voice and rate before synthesis. A provider whose `voices` roster changes outside registration announces it through `catalogChanged()`, and readiness followers re-read the announced facts from a new snapshot. Provider-owned preparation is observed through complete `TtsSnapshot` values; closing an observer never cancels preparation.

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

- Streaming synthesis and provider-side pronunciation lexicons are not exposed.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
