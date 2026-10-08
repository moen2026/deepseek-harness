/** Provider-neutral webhook deliveries, rules, and Session requests. */

import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { WebhookDeliveryId, WebhookRuleId, WebhookSourceId } from './brand.ts'

/** Provider adapters add their normalized event type through declaration merging. */
export interface WebhookEventMap {}

/** Event value for a known provider kind, or generic lossless JSON for an out-of-tree kind. */
export type WebhookEventOf<K extends string> =
  K extends keyof WebhookEventMap ? WebhookEventMap[K] : JsonValue

/** One authenticated and parsed provider delivery. */
export interface VerifiedWebhookDelivery<K extends string = string> {
  /** Provider family such as `github`. */
  readonly kind: K
  /** Configured adapter instance such as `primary-github`. */
  readonly source: WebhookSourceId
  /** Provider delivery identifier exposed in message sources, never as built-in deduplication state. */
  readonly deliveryId: WebhookDeliveryId
  /** Provider-normalized lossless JSON. */
  readonly event: WebhookEventOf<K>
  /** Host receipt time in Unix epoch milliseconds. */
  readonly receivedAt: number
}

/** Optional explicit model route and output cap for a webhook-created Agent. */
export interface WebhookModelSelection {
  /** Registered provider route. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
  /** Optional positive output-token cap. */
  readonly maxTokens?: number
}

/**
 * One admitted attachment block a Session prompt may carry beyond its text:
 * the durable reference the attachment capability committed before the
 * request was built. The prompt text stays in `prompt`; these blocks append
 * after it in the admitted user message.
 */
export type AdmittedAttachmentBlock =
  | { readonly type: 'image'; readonly attachment: ImageAttachmentRef }
  | { readonly type: 'file'; readonly attachment: FileAttachmentRef }

/** The sole runtime action: create and prompt one root Session. */
export interface WebhookSessionRequest {
  /** Existing local directory to resolve or create as a Web Workspace. */
  readonly workspacePath: string
  /** Explicit Session title. */
  readonly title: string
  /** Non-empty initial text prompt. */
  readonly prompt: string
  /**
   * Admitted attachment blocks appended after the prompt text; omission means
   * a text-only prompt. Every reference must already be durable: the caller
   * admits attachments through `ctx.attachments` before building the request.
   */
  readonly attachments?: readonly AdmittedAttachmentBlock[]
  /** Agent composition mounted before publication. */
  readonly agentPreset: string
  /** Sandbox and approval preset applied before prompt admission. */
  readonly permissionPreset: string
  /** Caller-chosen Session identity reused across creation retries; omission generates `webhook-<uuid>`. */
  readonly sessionId?: SessionId
  /** Optional explicit route; omission uses the complete current default, including reasoning effort. */
  readonly model?: WebhookModelSelection
}

/** Trusted code that optionally creates one Session for a delivery. */
export interface WebhookRule<K extends string = string> {
  /** Globally unique diagnostic identity. */
  readonly id: WebhookRuleId
  /** Provider kind this rule receives. */
  readonly kind: K
  /**
   * Run arbitrary trusted code and optionally request one Session.
   * @param delivery - immutable authenticated provider data.
   * @param signal - aborts when this registration or the runtime unloads.
   * @returns one Session request, or `null` for no action.
   */
  run(
    delivery: Readonly<VerifiedWebhookDelivery<K>>,
    signal: AbortSignal,
  ): WebhookSessionRequest | null | Promise<WebhookSessionRequest | null>
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Programmatic input admitted from one verified webhook rule. */
    webhook: {
      readonly kind: 'webhook'
      readonly provider: string
      readonly source: WebhookSourceId
      readonly deliveryId: WebhookDeliveryId
      readonly ruleId: WebhookRuleId
      readonly form: 'notice'
      readonly summary: string
    }
  }
}
