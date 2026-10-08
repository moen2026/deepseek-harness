/** Durable webhook outbox records and the authoritative domain that stores them. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { isJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import { WebhookDeliveryId, WebhookSourceId } from '@deepseek-ai/dsh-webhook'
import { z } from 'zod'

/** Identifies one outbox entry: the base64url encoding of its `[kind, source, deliveryId]` triple. */
export type WebhookOutboxKey = Branded<'WebhookOutboxKey'>

const nonBlankString = z.string().min(1).refine(value => value.trim() !== '', {
  message: 'Expected a non-blank string',
})

const epochMillis = z.number().refine(value => Number.isSafeInteger(value) && value >= 0, {
  message: 'Expected a non-negative safe integer epoch in milliseconds',
})

/**
 * One stored delivery: the verified webhook payload plus its dispatch ledger.
 * Strict: the attempt ledger is authoritative, so an unknown key rejects the record.
 */
export const webhookOutboxDeliverySchema = z.object({
  kind: nonBlankString,
  source: nonBlankString.transform(WebhookSourceId),
  deliveryId: nonBlankString.transform(WebhookDeliveryId),
  event: z.custom<JsonValue>(isJsonValue, { message: 'Expected a lossless JSON value' }),
  receivedAt: epochMillis,
  state: z.enum(['pending', 'delivered', 'failed']),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().optional(),
  updatedAt: epochMillis,
}).strict()

/** Stored delivery record produced by {@link webhookOutboxDeliverySchema}. */
export type WebhookOutboxDelivery = z.infer<typeof webhookOutboxDeliverySchema>

/** Authoritative outbox storage: one durable record per provider delivery triple. */
export const webhookOutboxDomain = defineDomain({
  name: 'webhook_outbox', version: 1, layout: 'per-record',
  tables: {
    deliveries: domainTable<WebhookOutboxKey, WebhookOutboxDelivery>(webhookOutboxDeliverySchema),
  },
})
