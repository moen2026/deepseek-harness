/**
 * Vocabulary for the DingTalk connector adapter: the provider id it reserves,
 * and the structured failures (`DINGTALK_*` codes) callers and operators branch
 * on instead of parsing `message`.
 * @module @deepseek-ai/dsh-connector-dingtalk/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Provider id this adapter reserves on `ctx.connector`. */
export const DINGTALK_PROVIDER_ID = 'dingtalk'

/**
 * Stable, machine-routable codes for DingTalk connector failures, carried on
 * {@link DingtalkError}.
 */
export type DingtalkErrorCode =
  | 'DINGTALK_SESSION_UNAVAILABLE'
  | 'DINGTALK_DELIVERY_FAILED'

/**
 * Structured DingTalk connector failure. Extends {@link HarnessError} with one
 * {@link DingtalkErrorCode}.
 */
export class DingtalkError extends HarnessError {
  override readonly code: DingtalkErrorCode

  /**
   * @param message - human-readable failure detail.
   * @param code - the stable machine-routable failure code.
   * @param options - optional error cause chain.
   */
  constructor(message: string, code: DingtalkErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}
