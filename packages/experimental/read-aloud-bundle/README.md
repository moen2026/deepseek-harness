---
description: "Enable experimental read-aloud from the plugin manager."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-read-aloud-bundle

English | [中文](README.zh.md)

## Summary

This optional bundle composes a synthesis Service Definition, local Kokoro provider, and authenticated Remote for the browser read-aloud action. Shipped profiles leave it disabled.

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

Open Plugins in the Web sidebar and enable Read Aloud, marked by a blue speaker icon. If models need preparation, a dialog offers Go to setup or Later; Go to setup opens the bundle details. In the details, choose Download and prepare; the collapsed current-step summary expands to the complete step list. Downloads report actual bytes; verification and loading show elapsed time. Once a provider is ready, the read-aloud button on assistant messages switches from the browser speech engine to local Kokoro synthesis; clicking Stop during playback stops the audio immediately. Disabling the bundle cancels active work; cached assets remain on disk.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The static `cordis.patch.yml` adds the synthesis service, its Kokoro, OpenVoice, and CosyVoice provider rows, and the authenticated Remote; it selects `openvoice-local` as the default provider and supplies the Kokoro cache directory with `dshHomePath`. The Chat plugin mounts no Remote itself: it observes `tts.follow` and reads a failed stream as the browser-engine fallback, so without this bundle the read-aloud button keeps working through Web Speech. Optional-bundle installation makes the package available to management without selecting it in default profiles. No runtime invariant companion is published because this configuration-only package has no independently mutable runtime state.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Voice input subsystem](../../../docs/subsystems/voice-input.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as synthesis consumes assistant output and preparation remains outside model requests.

#### KV Cache effect

No direct effect; the model is never sent synthesized audio.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The initial bundle supplies one local synthesizer. Additional providers register with the same service under distinct ids — the bundled patch already registers the service-backed client twice, with per-instance ids, display names, origins, and budgets. Cloud synthesis requires an explicit new provider and credential configuration. The bundle does not add a model tool or change the agent loop.
- Installing dsh also installs `sherpa-onnx-node` and its platform-specific native runtime, including ONNX Runtime, even when this bundle is disabled. Runtime installation adds disk and download costs separate from the model downloaded by Download and prepare; the native package size varies by platform and version.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
