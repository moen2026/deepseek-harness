---
description: "The speech synthesis Remote's settings page on the dsh web client's Plugins page: provider switching, the voice selection, the reading speed, and a preview."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-speech

English | [中文](README.zh.md)

## Summary

Open **Plugins** in the sidebar and select **Speech** in the Official group to pick the read-aloud provider — a Host synthesizer or the built-in browser voice — along with the voice and pace. The page mirrors the synthesis catalog over the `tts` Remote namespace and applies each change immediately — there is no staged draft — and the preview button reads one short sample with the current selection; for a provider that accepts recordings, an upload action stores a picked file as a new selectable voice. The browser voice is a client-local choice: it writes no Host state, persists in this browser, and plays previews and later readings through the speech engine with no synthesis delay. The page exists only while a synthesis provider is cataloged, so a deployment without the read-aloud bundle shows no trace of it.

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

The **Speech** card in the Official group opens the page. **Provider** switches between the cataloged synthesizers and the built-in browser voice; a switch writes the voice the new provider catalogs — the current one when it is listed there, otherwise the provider's first. **Voice** lists the selected provider's voices by display name; **Speed** accepts a pace between 0.5 and 2. Every change writes through the Remote namespace at once and the follow stream confirms it back, so the next read-aloud — including the one from another open client — uses the new selection. **Preview** synthesizes one short sample and plays it; a second click while one plays cancels it. **Upload recording** appears while the selected provider advertises recording intake: the picked file is stored as a new voice, named from the file, and selected right away. Choosing the built-in browser voice replaces the voice row with the disabled system-default voice, hides the upload action, and plays previews through the browser's speech engine with no synthesis delay; the choice persists in this browser, and choosing any synthesizer returns to Host synthesis. Failures keep the page intact and appear as a line under the controls.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. The browser half observes provider readiness through the same `observeTtsReadiness` mirror the Chat read-aloud action builds, exported from `dsh-client-ui-chat`, and keeps the page projection in `SpeechCardController` over a `SnapshotStore`. Selections go through `remote.tts.configure` and previews through the Chat plugin's `readAloud.speak` service; the built-in browser voice is the Chat plugin's `readAloud.engine` store — a persisted client preference that writes no Host state — and its previews go through `readAloud.speakBrowser`. Uploads derive a voice id from the picked file's name and go through `remote.tts.intakeVoice`. The page registers `SpeechCard` into the Plugins page's `plugins.item` slot while the mirror reports a connected stream with a cataloged provider, and collapses when the stream drops or empties.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page and the `plugins.item` slot the page registers into.
- [ui-chat](../ui-chat/README.md) — the readiness mirror and the WAV playback helper the page reuses.
- [text-to-speech](../../experimental/text-to-speech/README.md) — the service whose volatile Config the page writes through.
- [api-text-to-speech](../../experimental/api-text-to-speech/README.md) — the Remote namespace the page reads and writes.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Runtime invariant:** No companion is published. The page holds no owned relationship of its own: what it shows derives from the readiness mirror, and what it writes the Host service validates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
