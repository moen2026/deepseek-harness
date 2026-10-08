/**
 * Shared Discord adapter vocabulary: the provider id and the package-owned
 * error that carries a stable code for rejection matching.
 * @module @deepseek-ai/dsh-connector-discord/types
 */
import { HarnessError } from '@deepseek-ai/dsh-llm';
/** Provider id this adapter reserves on the connector seam. */
export const DISCORD_PROVIDER_ID = 'discord';
/**
 * Package-owned rejection for outbound Discord requests. Extends
 * {@link HarnessError} with one {@link DiscordErrorCode}.
 */
export class DiscordError extends HarnessError {
    code;
    /**
     * @param message - detail safe to log; never includes the bot token.
     * @param code - stable rejection code.
     * @param options - standard error options, such as `cause`.
     */
    constructor(message, code, options) {
        super(message, code, options);
        this.code = code;
    }
}
//# sourceMappingURL=types.js.map