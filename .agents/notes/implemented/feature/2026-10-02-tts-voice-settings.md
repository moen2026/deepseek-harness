# Agent Note: TTS voice settings page

Status: implemented

English | [中文](2026-10-02-tts-voice-settings.zh.md)

## Problem

Read-aloud synthesis is configurable only through composition config: `voiceId` and `speed` live in the `text-to-speech` plugin's volatile Config, so changing a voice means editing a patch file and restarting. The synthesis Remote already serves everything a client needs — `catalog`, `follow`, `configure`, `prepare`, and `synthesize` over the `tts` namespace — but no client surface consumes the choice it exposes. A user who wants 云舟 instead of 晴岚, or a slower reading pace, has no in-product path.

## Decision

`packages/client/ui-settings-speech` (`@deepseek-ai/dsh-client-ui-settings-speech`) ships as a companion settings page in the established one-package-per-host-namespace pattern: the Host half is an empty `apply` and the browser half registers a `plugins.item` card titled Speech on the Plugins page.

The card mirrors provider readiness through the same `observeTtsReadiness` mirror the Chat read-aloud action already builds, exported from `@deepseek-ai/dsh-client-ui-chat/client`. While a provider is cataloged the page renders: a provider selector, a voice selector listing the selected provider's voices by display name, a speed field (0.5–2), and a preview button that synthesizes one short sample and plays it. Writes go through `ctx.remote.tts.configure({ voiceId, speed })` and take effect immediately — the service Config is volatile by design, and the follow stream confirms the new selection back.

A deployment without the read-aloud bundle serves no `tts` namespace; the readiness stream then never reports a provider, and the page registers no trace. The card shows a connected-but-empty state only while the stream is live with no provider.

## Alternatives considered

**Fold the page into `ui-settings-general`.** Rejected: the settings family already assigns one companion package per host-plane namespace, and general-section rows are static browser-side entries rather than Host-conditional pages.

**Route the selection through a settings namespace and `configForms`.** Rejected: the selection already persists through the `text-to-speech` service's own settings entry; a second store would fork the source of truth the read-aloud action reads.

**Put a voice menu in the message action row.** Rejected as the whole surface: picking a voice is a one-time preference, not a per-message action, and the action row stays one click deep.

## Consequences

- Deployments with the read-aloud bundle gain a Host-conditional Speech card — provider voice list, persisted selection, speed, and preview — whose changes survive client reloads and Host restarts through the service's settings entry; deployments without the bundle gain no entry and no stream traffic beyond the readiness mirror the read-aloud action already owns.
- All copy is locale-owned through the package dictionary in English and Simplified Chinese.
- The page's deployment contract spans three compositions: `ui-chat` exposing the `readAloud` service, the experimental client half mounting the `tts` namespace, and the bundle registered in the profile's `dsh.profile.bundles` list.

## Implementation notes

Shipped as proposed, with six composition decisions the proposal could not see:

- **The page consumes a cordis service, not Chat exports.** The client bundle purity gate forbids cross-plugin runtime value imports, so `ui-chat` provides a `readAloud` service (`readiness` snapshot store plus `speak`) and `@deepseek-ai/dsh-api-gateway/client` joined the web platform module table — the carrier-error class its streams share needs one runtime identity.
- **The `tts` Remote mounts from an experimental client half.** The default `api-remotes` client assembly may not inline experimental artifacts (bundle input isolation), so `@deepseek-ai/dsh-experimental-api-text-to-speech` gained a `./client` entry that mounts its own generated contribution; the read-aloud bundle patch already inserts the plugin, so the namespace appears exactly where the Host synthesizer does. `ui-chat` joins the readiness mirror and synthesizer binding through `ctx.inject(['remote.tts'])`, keeping the browser-engine fallback for compositions without the bundle.
- **Writes surface Host refusals.** Generated Remote stubs resolve `RemoteResult` instead of throwing, so `configure` unwraps `ok` and shows the failure inline. The Host config editor refuses profile writes while a CLI patch overrides the entry's config — a deployment launched with the bundle's `cordis.patch.yml` carrying `config` therefore rejects every save, and the page displays that error verbatim.
- **The bundle deploys through the profile's bundle list.** The config editor recomputes the composition from the profile directory and CLI overlays; a home-patch config row for an entry whose insert comes only from a CLI patch has no base entry to land on, so every save was refused regardless of config. Registering `@deepseek-ai/dsh-experimental-read-aloud-bundle` in the profile's `dsh.profile.bundles` places the inserts inside the recomputed layers, and `defaultProvider` became optional — a composition with exactly one registered provider resolves it — so the bundle patch carries no entry config and the voice page owns persistence.
- **Voice cloning ships as a second provider, not a surface change.** `@deepseek-ai/dsh-experimental-text-to-speech-openvoice` is a stateless HTTP client for an externally managed OpenVoice v2 service (MeloTTS-Chinese plus the tone-color converter): `/health` publishes the cloned-voice roster, `/synthesize` returns a complete WAV, and `TtsPreparation` is omitted so the page reports readiness directly. With two providers registered the bundle's `text-to-speech` insert must carry `defaultProvider` again. Composition config semantics matter here: a later non-insert patch replaces an entry's `config` wholesale (`applyEntryPatches`), so the home-patch row a previous settings save wrote silently dropped bundle-added keys until it was rewritten with the full config — settings saves stay safe because they always persist the merged config, not just the changed fields.
- **The provider selector writes through the same `configure` call, and a changed roster re-publishes.** A provider switch resolves a voice the target catalogs (the current one when it is listed there) so the Host never rejects a pair the previous provider selected, and the page echoes the accepted write before the follow stream confirms it. A provider's `voices` roster can change without a registration event, so `textToSpeech.catalogChanged()` re-publishes provider facts to readiness followers; the OpenVoice provider announces every successful probe, so a reference recording dropped into the service becomes selectable right after the next synthesis instead of only after a page reload.
