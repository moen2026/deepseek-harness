/**
 * Discord Gateway adapter for the connector seam. One plugin instance opens
 * one long-lived Gateway WebSocket identified by the bot token and registers
 * one `discord` provider on `ctx.connector`. Text messages and message-
 * component interactions arrive over the Gateway and enter
 * `ctx.connector.deliver()`; component interactions are acknowledged with a
 * deferred-update callback before delivery. The provider pushes outbound
 * messages over the REST API as text or an action row of buttons. Both
 * registrations are effect-scoped: disposal closes the connection and
 * unregisters the provider.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-connector-discord
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import z from '@deepseek-ai/schemastery';
import { createDiscordClient } from "./client.js";
import { createDiscordGateway } from "./gateway.js";
import { DISCORD_PROVIDER_ID } from "./types.js";
export { DiscordError, DISCORD_PROVIDER_ID } from "./types.js";
/** Cordis function-plugin name. */
export const name = 'connector-discord';
/** Host services required before the provider and gateway can register. */
export const inject = ['connector', 'credentials'];
/** Default per-request outbound timeout (ms). */
export const CONNECTOR_DISCORD_DEFAULT_TIMEOUT_MS = 10_000;
/** Default intent bitfield: GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT. */
export const CONNECTOR_DISCORD_DEFAULT_INTENTS = 37_376;
/** Default delay before reconnecting after a disconnect (ms). */
export const CONNECTOR_DISCORD_DEFAULT_RECONNECT_DELAY_MS = 5_000;
/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config = z.object({
    botTokenEnv: z.string().role('credential-ref').required(),
    intents: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(CONNECTOR_DISCORD_DEFAULT_INTENTS),
    timeoutMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(CONNECTOR_DISCORD_DEFAULT_TIMEOUT_MS),
    apiBaseUrl: z.string(),
    gatewayUrl: z.string(),
    reconnectDelayMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(CONNECTOR_DISCORD_DEFAULT_RECONNECT_DELAY_MS),
});
/** Validate origin facts that Schemastery cannot express. */
function assertConfig(config) {
    if (config.apiBaseUrl !== undefined) {
        let origin;
        try {
            origin = new URL(config.apiBaseUrl);
        }
        catch {
            throw new Error('connector-discord apiBaseUrl must be an absolute URL');
        }
        if (origin.protocol !== 'https:' || origin.search !== '' || origin.hash !== '') {
            throw new Error('connector-discord apiBaseUrl must be an https URL without query or fragment');
        }
    }
    if (config.gatewayUrl !== undefined) {
        let gateway;
        try {
            gateway = new URL(config.gatewayUrl);
        }
        catch {
            throw new Error('connector-discord gatewayUrl must be an absolute URL');
        }
        if (gateway.protocol !== 'wss:') {
            throw new Error('connector-discord gatewayUrl must be a wss URL');
        }
    }
}
/**
 * Resolve the effective REST origin. The explicit resolve step owns the
 * deployment default, so no request path hides one.
 * @param config - the validated plugin configuration.
 * @returns the REST origin without trailing slashes.
 */
function resolveApiBaseUrl(config) {
    return (config.apiBaseUrl ?? 'https://discord.com/api/v10').replace(/\/+$/, '');
}
/**
 * Resolve the effective Gateway endpoint.
 * @param config - the validated plugin configuration.
 * @returns the Gateway endpoint.
 */
function resolveGatewayUrl(config) {
    return config.gatewayUrl ?? 'wss://gateway.discord.gg/?v=10&encoding=json';
}
/**
 * Register the Discord provider and open the Gateway connection.
 * @param ctx - the plugin context (must inject `connector` and `credentials`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx, config) {
    assertConfig(config);
    const botTokenRef = credentialRef(config.botTokenEnv);
    const client = createDiscordClient(ctx, {
        apiBaseUrl: resolveApiBaseUrl(config),
        botTokenRef,
        timeoutMs: config.timeoutMs ?? CONNECTOR_DISCORD_DEFAULT_TIMEOUT_MS,
    });
    const gateway = createDiscordGateway(ctx, client, {
        gatewayUrl: resolveGatewayUrl(config),
        intents: config.intents ?? CONNECTOR_DISCORD_DEFAULT_INTENTS,
        botTokenRef,
        reconnectDelayMs: config.reconnectDelayMs ?? CONNECTOR_DISCORD_DEFAULT_RECONNECT_DELAY_MS,
    });
    ctx.effect(() => ctx.connector.registerProvider({
        id: DISCORD_PROVIDER_ID,
        push: (channel, message, signal) => client.push(channel, message, signal),
    }), 'connector-discord: provider');
    ctx.effect(() => {
        gateway.open();
        return () => {
            gateway.close();
        };
    }, 'connector-discord: gateway');
}
//# sourceMappingURL=index.js.map