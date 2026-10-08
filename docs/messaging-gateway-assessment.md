# Messaging platform gateway assessment

English | [中文](messaging-gateway-assessment.zh.md)

## Summary

Use this assessment to decide whether extending Damon's messaging-platform gateway deserves a standalone project, and what that project should cover. The conclusion: the transport seam already exists — the [Connector subsystem](subsystems/connector.md) landed with verified callbacks, durable dispatch, channel-to-Session bindings, and two platform adapters — so the remaining work is structured platform interaction, bidirectional attachments, per-sender authorization, and additional providers. None of those fit inside one adapter package, which is why they need their own project.

## What exists today

- **The routing seam.** `ctx.connector` ([connector/](../packages/connector/connector/README.md)) owns the provider registry, the inbound rule that derives one durable Session per platform channel, the outbound route from Session events, and the 1:1 channel-to-Session binding table. The [implemented decision](../.agents/notes/implemented/architecture/2026-09-28-im-connector-seam.md) records why the seam sits between the webhook runtime and the platform adapters.
- **Verified ingress and durable dispatch.** The [webhook family](../packages/webhook/README.md) verifies provider callbacks and creates Sessions with full validation and rollback; the outbox adds an at-least-once queue whose deduplication key is the platform message id, so redelivered callbacks never run twice.
- **Two platform adapters.** `connector-feishu` and `connector-dingtalk` own callback verification, message translation, and platform delivery for their platforms.
- **Session-side primitives.** Approval waits and user questions already produce Session events and Surface-provider alerts, and the [notification seam](subsystems/notification.md) routes Host alerts per profile.

## Gap analysis

The four gaps below are ordered by how much they constrain real use; each is a change to shared vocabulary or lifecycle, not to one adapter.

1. **Structured outbound.** `ConnectorOutboundMessage` carries optional `title` and required `text`. An approval wait therefore reaches the platform as prose, and the reply comes back as free text that an adapter must parse. Interactive cards (Feishu cards, DingTalk action cards, Slack Block Kit) need a merge-extensible outbound payload with an interaction callback route, and the callback must re-enter the Session as a durable resolution, not a parsed chat line.
2. **Per-sender authorization.** The inbound options apply one `permissionPreset` to every message of a provider, and `sender` is recorded but unmapped. A group channel where one member approves a file write on behalf of everyone is the standing hazard; the project needs an explicit sender-to-identity mapping with a documented default-deny posture for approval resolutions.
3. **Attachments.** `ConnectorInboundMessage` is text-only, so images and documents sent to a chat never reach the Session. Inbound attachments map onto the existing admission vocabulary (`AttachmentAdmissionPart`); outbound ones need platform upload rules per adapter.
4. **Platform coverage.** Telegram, Slack, Discord, and WeCom adapters are absent. Each is a contained package against the existing `ConnectorProvider` contract, so coverage scales linearly once gaps 1–3 settle the shared vocabulary.

## Suggested phases

- **P1 — interactive outbound:** extend the outbound vocabulary with structured actions, add the inbound callback route for resolutions, and rebuild the two existing adapters' approval presentation on it.
- **P2 — sender identity and attachments:** add the sender-to-identity mapping with default-deny approval resolution, and map inbound attachments onto prompt admission.
- **P3 — coverage:** add Telegram, Slack, Discord, and WeCom adapters against the settled contracts.

## Risks and open questions

- **Security surface.** A public callback endpoint is a remote prompt-admission path. Callback verification, replay protection, and the sender mapping need review by someone owning the security invariants before P1 lands.
- **Scope containment.** Interactive cards vary per platform; the outbound payload must stay backend-independent (the provider owns rendering, as it does today for text) or the seam becomes a lowest-common-denominator leak.
- **Open question — turn-length UX.** A long turn produces one eventual reply; whether interim tool narration belongs in chat at all, and at what throttle, is a product decision this assessment deliberately leaves open.

## Related documentation

- [Connector seam](subsystems/connector.md) — the routing seam's types and semantics.
- [Webhook package map](../packages/webhook/README.md) — verified ingress, rules, and Session creation.
- [Notification seam](subsystems/notification.md) — Host alert routing the gateway may reuse for delivery notices.
