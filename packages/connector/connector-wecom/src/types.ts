/**
 * Shared WeCom adapter vocabulary: the provider id and the package-owned
 * error that carries a stable code for rejection matching.
 * @module @deepseek-ai/dsh-connector-wecom/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Provider id this adapter reserves on the connector seam. */
export const WECOM_PROVIDER_ID = 'wecom'

/** Prefix every button key this adapter renders carries. */
export const WECOM_ACTION_PREFIX = 'dsh-'

/**
 * Stable, machine-routable codes for WeCom connector failures, carried on
 * {@link WecomError}.
 */
export type WecomErrorCode =
  | 'WECOM_CREDENTIALS_UNAVAILABLE'
  | 'WECOM_DELIVERY_FAILED'

/**
 * Package-owned rejection for outbound WeCom requests. Extends
 * {@link HarnessError} with one {@link WecomErrorCode}.
 */
export class WecomError extends HarnessError {
  override readonly code: WecomErrorCode

  /**
   * @param message - detail safe to log; never includes a secret.
   * @param code - the stable machine-routable failure code.
   * @param options - standard error options, such as `cause`.
   */
  constructor(message: string, code: WecomErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}
