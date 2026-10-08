/** Workspace-backed Session creation for one settled webhook rule result. */

import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { boundContextSummary, createUserMessage, errorChain, type ContentBlock, type LlmCallConfig, type UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'
import type { WebhookRuleId } from './brand.ts'
import type { AdmittedAttachmentBlock, VerifiedWebhookDelivery, WebhookSessionRequest } from './types.ts'

/** Detached values the creation transaction keeps across asynchronous preflight. */
interface ResolvedWebhookSessionRequest {
  readonly workspacePath: string
  readonly title: string
  readonly prompt: string
  readonly attachments: readonly AdmittedAttachmentBlock[]
  readonly agentPreset: string
  readonly permissionPreset: string
  readonly sessionId: SessionId
  readonly modelSelection: ModelSelection
  readonly agentOptions: {
    readonly provider: string
    readonly model: string
    readonly maxTokens?: number
  }
}

/** Require one non-empty string field from an untyped rule result. */
function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`webhook Session request ${field} must be a non-empty string`)
  }
  return value
}

/** Require one positive safe integer dimension from an untyped attachment reference. */
function positiveDimension(record: Record<string, unknown>, field: string): number {
  const value = record[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`webhook Session request image attachment ${field} must be a positive safe integer`)
  }
  return value
}

/**
 * Validate one admitted attachment block from an untyped rule result and
 * return its typed form. The block crossed the rule registration boundary, so
 * the durable reference is rebuilt field by field rather than trusted.
 */
function admittedBlockOf(entry: unknown): AdmittedAttachmentBlock {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError('webhook Session request attachments entries must be JSON objects')
  }
  const record = entry as Record<string, unknown>
  const kind = record['type']
  if (kind !== 'image' && kind !== 'file') {
    throw new TypeError("webhook Session request attachments entry type must be 'image' or 'file'")
  }
  const ref = record['attachment']
  if (ref === null || typeof ref !== 'object' || Array.isArray(ref)) {
    throw new TypeError('webhook Session request attachments entries must carry an attachment reference object')
  }
  const reference = ref as Record<string, unknown>
  const attachmentId = reference['attachmentId']
  if (typeof attachmentId !== 'string' || attachmentId.trim() === '') {
    throw new TypeError('webhook Session request attachment reference attachmentId must be a non-empty string')
  }
  const bytes = reference['bytes']
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
    throw new TypeError('webhook Session request attachment reference bytes must be a non-negative safe integer')
  }
  const name = reference['name']
  if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
    throw new TypeError('webhook Session request attachment reference name must be a non-empty string when present')
  }
  if (kind === 'file') {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new TypeError('webhook Session request file attachment reference name must be a non-empty string')
    }
    return {
      type: 'file',
      attachment: { attachmentId: brandString<AttachmentId>(attachmentId), name, bytes },
    }
  }
  const mediaType = reference['mediaType']
  if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp' && mediaType !== 'image/gif') {
    throw new TypeError('webhook Session request image attachment mediaType must be one of the accepted raster image types')
  }
  const original = reference['originalDimensions']
  let originalDimensions: { width: number; height: number } | undefined
  if (original !== undefined) {
    if (original === null || typeof original !== 'object' || Array.isArray(original)) {
      throw new TypeError('webhook Session request image attachment originalDimensions must be an object when present')
    }
    const dims = original as Record<string, unknown>
    originalDimensions = { width: positiveDimension(dims, 'width'), height: positiveDimension(dims, 'height') }
  }
  return {
    type: 'image',
    attachment: {
      attachmentId: brandString<AttachmentId>(attachmentId),
      mediaType,
      bytes,
      width: positiveDimension(reference, 'width'),
      height: positiveDimension(reference, 'height'),
      ...(name === undefined ? {} : { name }),
      ...(originalDimensions === undefined ? {} : { originalDimensions }),
    },
  }
}

/** Snapshot, validate, and resolve one same-process rule result before crossing awaits. */
function resolveRequest(ctx: Context, input: WebhookSessionRequest): ResolvedWebhookSessionRequest {
  const candidate: unknown = input
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('webhook rule result must be null or a Session request object')
  }
  const record = candidate as Record<string, unknown>
  const workspacePath = requiredString(record, 'workspacePath')
  if (!isAbsolute(workspacePath)) {
    throw new TypeError(`webhook Session request workspacePath must be absolute, got ${JSON.stringify(workspacePath)}`)
  }
  const title = requiredString(record, 'title')
  const prompt = requiredString(record, 'prompt')
  const rawAttachments = record['attachments']
  if (rawAttachments !== undefined && !Array.isArray(rawAttachments)) {
    throw new TypeError('webhook Session request attachments must be an array when present')
  }
  const attachments = (rawAttachments ?? []).map(admittedBlockOf)
  const agentPreset = requiredString(record, 'agentPreset')
  const permissionPreset = requiredString(record, 'permissionPreset')
  const requestedSessionId = record['sessionId']
  if (requestedSessionId !== undefined
    && (typeof requestedSessionId !== 'string' || requestedSessionId.trim() === '')) {
    throw new TypeError('webhook Session request sessionId must be a non-empty string')
  }
  const model = record['model']
  if (model !== undefined && (model === null || typeof model !== 'object' || Array.isArray(model))) {
    throw new TypeError('webhook Session request model must be an object')
  }
  let agentOptions: ResolvedWebhookSessionRequest['agentOptions']
  let modelSelection: ModelSelection
  if (model === undefined) {
    const selected = ctx.agentDefaultModel.currentSelection()
    agentOptions = { provider: selected.provider, model: selected.model }
    modelSelection = { ...selected }
  } else {
    const modelRecord = model as Record<string, unknown>
    const provider = requiredString(modelRecord, 'provider')
    const modelId = requiredString(modelRecord, 'model')
    const maxTokens = modelRecord['maxTokens']
    if (maxTokens !== undefined
      && (typeof maxTokens !== 'number' || !Number.isSafeInteger(maxTokens) || maxTokens <= 0)) {
      throw new TypeError('webhook Session request model.maxTokens must be a positive safe integer')
    }
    agentOptions = {
      provider,
      model: modelId,
      ...(maxTokens === undefined ? {} : { maxTokens }),
    }
    modelSelection = { provider, model: modelId }
  }
  return {
    workspacePath,
    title,
    prompt,
    attachments,
    agentPreset,
    permissionPreset,
    sessionId: brandString<SessionId>(requestedSessionId ?? `webhook-${randomUUID()}`),
    modelSelection,
    agentOptions,
  }
}

/** Log a rollback failure without replacing the operation's original failure. */
function reportRollbackFailure(ctx: Context, subject: string, error: unknown): void {
  ctx.logger.warn(`webhook: ${subject} rollback failed: ${errorChain(error)}`)
}

/** Apply the creation-time selection until its first durable request header exists. */
function installInitialModelSelection(agentCtx: Context, selection: ModelSelection): void {
  agentCtx.on('agent/request', async ({ agent }, next): Promise<LlmCallConfig> => {
    const resolved = await next()
    if (agent.session.requestHeader() !== undefined
      || resolved.provider !== selection.provider
      || resolved.model !== selection.model) return resolved
    const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
    return {
      ...withoutInheritedEffort,
      ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
    }
  })
}

/**
 * Build the user message one webhook delivery admits to a Session, so every
 * continuation path records the same verified source.
 * @param delivery - exact verified provider delivery recorded in the message source.
 * @param ruleId - rule that handled the delivery.
 * @param content - prompt content admitted to the Session: the text prompt plus any admitted attachment blocks.
 * @returns an immutable user message tagged with the webhook source.
 */
export function webhookDeliveryMessage(
  delivery: VerifiedWebhookDelivery,
  ruleId: WebhookRuleId,
  content: readonly ContentBlock[],
): UserMessage {
  return createUserMessage({
    content: [...content],
    source: {
      kind: 'webhook',
      provider: delivery.kind,
      source: delivery.source,
      deliveryId: delivery.deliveryId,
      ruleId,
      form: 'notice',
      summary: boundContextSummary(`${delivery.kind} webhook handled by ${ruleId}`),
    },
  })
}

/**
 * Create, attach, title, configure, and prompt one ordinary root Session.
 * Successful prompt admission ends webhook ownership of the operation; the
 * Agent remains lifecycle-owned by `ctx` and follows normal Session behavior.
 *
 * @param ctx - untraced runtime context that owns the resulting Agent.
 * @param delivery - exact verified provider delivery recorded in the message source.
 * @param ruleId - rule that returned the request.
 * @param request - same-process rule result.
 * @param signal - registration lifetime cancellation through publication.
 * @returns the created Session id: the caller-supplied one, or the generated `webhook-<uuid>`.
 */
export async function createWebhookSession(
  ctx: Context,
  delivery: VerifiedWebhookDelivery,
  ruleId: WebhookRuleId,
  request: WebhookSessionRequest,
  signal: AbortSignal,
): Promise<SessionId> {
  const resolved = resolveRequest(ctx, request)
  ctx.permissionPresets.resolve(resolved.permissionPreset)
  const preset = await ctx.agentPresets.resolve(resolved.agentPreset)
  await using presetScope = await ctx.agentPresets.acquireScope(preset.id)
  void presetScope
  signal.throwIfAborted()

  const workspace = await ctx.workspaceRegistry.create(resolved.workspacePath)
  signal.throwIfAborted()
  const { sessionId } = resolved
  const handle = await ctx.agents.create({
    sessionId,
    signal,
    meta: { cwd: workspace.path, agentPreset: preset.id },
    agentOptions: resolved.agentOptions,
    setup: async (agentCtx) => {
      await ctx.agentPresets.mount(agentCtx, preset.id)
      installInitialModelSelection(agentCtx, resolved.modelSelection)
    },
  })

  let attached = false
  try {
    signal.throwIfAborted()
    await workspace.attachSession(sessionId)
    attached = true
    signal.throwIfAborted()
    ctx.permissionPresets.set(handle.agent.session, resolved.permissionPreset)
    ctx.sessionTitle.rename(handle.agent.session, resolved.title)
    handle.agent.followup(webhookDeliveryMessage(delivery, ruleId, [
      { type: 'text', text: resolved.prompt },
      ...resolved.attachments,
    ]))
  } catch (error: unknown) {
    if (attached) {
      try {
        await workspace.detachSession(sessionId)
      } catch (rollbackError: unknown) {
        reportRollbackFailure(ctx, `Workspace detach for Session "${sessionId}"`, rollbackError)
      }
    }
    try {
      await handle.dispose()
    } catch (rollbackError: unknown) {
      reportRollbackFailure(ctx, `Agent disposal for Session "${sessionId}"`, rollbackError)
    }
    throw error
  }
  return sessionId
}
