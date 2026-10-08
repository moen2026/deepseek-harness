/**
 * Vocabulary for the Slack connector adapter: the provider id it reserves,
 * and the structured failures (`SLACK_*` codes) callers and operators branch
 * on instead of parsing `message`.
 * @module @deepseek-ai/dsh-connector-slack/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Provider id this adapter reserves on `ctx.connector`. */
export const SLACK_PROVIDER_ID = 'slack'

/**
 * Stable, machine-routable codes for Slack connector failures, carried on
 * {@link SlackError}.
 */
export type SlackErrorCode =
  | 'SLACK_CREDENTIALS_UNAVAILABLE'
  | 'SLACK_DELIVERY_FAILED'

/**
 * Structured Slack connector failure. Extends {@link HarnessError} with one
 * {@link SlackErrorCode}.
 */
export class SlackError extends HarnessError {
  override readonly code: SlackErrorCode

  /**
   * @param message - human-readable failure detail.
   * @param code - the stable machine-routable failure code.
   * @param options - optional error cause chain.
   */
  constructor(message: string, code: SlackErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}
