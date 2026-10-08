/**
 * Configuration and vocabulary of the connector approval bridge: the action
 * id encoding the platform buttons carry back, and the plugin config.
 * @module @deepseek-ai/dsh-connector-approval/types
 */

import z from '@deepseek-ai/schemastery'

/** The outcomes a platform click may decide; a bridge click is always one-shot. */
export type BridgedOutcome = 'allowed-once' | 'rejected'

/**
 * Encode one bridged action id: the stable string a provider renders into its
 * platform button and carries back verbatim on the clicked callback.
 * @param correlationId - the bridge's own id pairing a request with its pending wait.
 * @param outcome - the outcome the button decides.
 * @returns the encoded action id.
 */
export function bridgeActionId(correlationId: string, outcome: BridgedOutcome): string {
  return `${ACTION_ID_PREFIX}:${correlationId}:${outcome}`
}

/**
 * Decode one clicked action id back into its correlation pair.
 * @param actionId - the id carried back on the resolution.
 * @returns the correlation id and outcome, or `undefined` when the id was
 * not minted by this bridge or the outcome is not bridge-decidable.
 */
export function decodeBridgeActionId(actionId: string): { readonly correlationId: string; readonly outcome: BridgedOutcome } | undefined {
  if (!actionId.startsWith(`${ACTION_ID_PREFIX}:`)) return undefined
  const rest = actionId.slice(ACTION_ID_PREFIX.length + 1)
  const separator = rest.lastIndexOf(':')
  if (separator <= 0 || separator === rest.length - 1) return undefined
  const correlationId = rest.slice(0, separator)
  const outcome = rest.slice(separator + 1)
  if (outcome !== 'allowed-once' && outcome !== 'rejected') return undefined
  return { correlationId, outcome }
}

/** The action id namespace this bridge mints and decodes. */
const ACTION_ID_PREFIX = 'dsh-approval'

/** Required bridge configuration. */
export interface Config {
  /** Registered connector providers whose interactive callbacks answer approvals. */
  readonly providers: string[]
  /** Button label deciding `allowed-once`. Defaults to `Approve`. */
  readonly allowLabel?: string
  /** Button label deciding `rejected`. Defaults to `Reject`. */
  readonly rejectLabel?: string
  /**
   * Platform sender ids allowed to decide approvals, each mapped to a
   * human-readable identity recorded in the decision log. When present, a
   * resolution from any other sender is rejected (default-deny); when
   * absent, every member of the channel may decide.
   */
  readonly approvers?: Record<string, string>
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  providers: z.array(z.string()).required(),
  allowLabel: z.string().default('Approve'),
  rejectLabel: z.string().default('Reject'),
  approvers: z.dict(z.string()),
})
