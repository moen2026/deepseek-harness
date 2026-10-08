/**
 * Vocabulary for the Feishu connector adapter: the provider id it reserves,
 * and the structured failures (`FEISHU_*` codes) callers and operators branch
 * on instead of parsing `message`.
 * @module @deepseek-ai/dsh-connector-feishu/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Provider id this adapter reserves on `ctx.connector`. */
export const FEISHU_PROVIDER_ID = 'feishu'

/**
 * Stable, machine-routable codes for Feishu connector failures, carried on
 * {@link FeishuError}.
 */
export type FeishuErrorCode =
  | 'FEISHU_CREDENTIALS_UNAVAILABLE'
  | 'FEISHU_DELIVERY_FAILED'

/**
 * Structured Feishu connector failure. Extends {@link HarnessError} with one
 * {@link FeishuErrorCode}.
 */
export class FeishuError extends HarnessError {
  override readonly code: FeishuErrorCode

  /**
   * @param message - human-readable failure detail.
   * @param code - the stable machine-routable failure code.
   * @param options - optional error cause chain.
   */
  constructor(message: string, code: FeishuErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}
