/**
 * Vocabulary for the Telegram connector adapter: the provider id it reserves,
 * and the structured failures (`TELEGRAM_*` codes) callers and operators
 * branch on instead of parsing `message`.
 * @module @deepseek-ai/dsh-connector-telegram/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Provider id this adapter reserves on `ctx.connector`. */
export const TELEGRAM_PROVIDER_ID = 'telegram'

/**
 * Stable, machine-routable codes for Telegram connector failures, carried on
 * {@link TelegramError}.
 */
export type TelegramErrorCode =
  | 'TELEGRAM_CREDENTIALS_UNAVAILABLE'
  | 'TELEGRAM_DELIVERY_FAILED'

/**
 * Structured Telegram connector failure. Extends {@link HarnessError} with
 * one {@link TelegramErrorCode}.
 */
export class TelegramError extends HarnessError {
  override readonly code: TelegramErrorCode

  /**
   * @param message - human-readable failure detail.
   * @param code - the stable machine-routable failure code.
   * @param options - optional error cause chain.
   */
  constructor(message: string, code: TelegramErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}
