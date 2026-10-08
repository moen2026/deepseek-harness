# Agent Note: Recording voice intake

Status: implemented

English | [中文](2026-10-03-recording-voice-intake.zh.md)

## Problem

The speech settings page could only select clone voices whose reference WAV files already sat in the OpenVoice service's `references/` directory. Cloning a voice meant dropping a recording into that directory out of band and waiting for the next synthesis or roster probe, and the page offered no entry point at all — a dead end for Web and Desktop users who never touch the service host. Parity requires cloning a voice from a recording picked on the settings page itself.

## Decision

Recording intake ships as one longitudinal capability across the seam, the provider, the Remote API, and the client:

- **Seam.** `TtsProvider.intake` advertises the accepted media types and byte budget, and `ctx.textToSpeech.intakeVoice(id, intake, signal)` runs one submitted recording through the exact registration, applying the same registration discipline as `synthesize()`: the combined caller and registration signal aborts waiting and running intake, a withdrawn registration joins submitted intake before settling, and a provider without `intake` refuses explicitly.
- **Provider.** OpenVoice `intakeVoice()` stores the recording under the given voice id through `PUT /references?name=` on the service, then re-probes the roster, so the stored recording becomes selectable immediately instead of waiting for the next synthesis.
- **Remote API.** `intakeVoice(providerId, voiceId, audioBase64)` takes one base64 payload; the encoded length is pre-checked against `maxReferenceBytes` and rejected with `tts/invalid-recording`, while non-canonical base64, oversized decoded bytes, and provider rejection report `tts/intake-failed`.
- **Client.** An **Upload recording** control appears on the Speech card while the selected provider advertises intake; the picked file's name becomes the voice id (CJK preserved), and a successful intake selects the new voice right away.

The recording stays transient: it enters neither the session log nor the attachment store, so no model-visible ⟺ logged obligation arises. Voice id derivation and validation live on both the client and the service as independent defenses.

## Alternatives considered

**The client speaking HTTP to the OpenVoice service directly.** The provider owns the service protocol; a client-side request would fork that knowledge outside the seam, skip the registration discipline and cancellation propagation, and bypass Remote namespace authentication.

**Keeping the `references/` directory drop as the only path.** The directory workflow stays possible for operators, but it is not reachable from the page and silently depends on filesystem access to the service host; it remains documented as an out-of-band limitation rather than the primary flow.

**Storing recordings as attachments or session events.** Recordings are transient synthesis inputs just like requested audio; giving them durable session lifecycle would extend `SessionEventMap` and attachment storage for data that must not become model input.

## Consequences

- Four package READMEs and the voice-input subsystem page describe intake; `docs/config-catalog.md` carries the two `maxReferenceBytes` fields.
- Intake success depends on the deployed service implementing `PUT /references`; against a service without it, intake fails as a transport error while synthesis and roster probes keep working.
- Uploaded recordings live as WAV files in the service's `references/` directory, so they survive service restarts and remain operator-manageable outside the page.
