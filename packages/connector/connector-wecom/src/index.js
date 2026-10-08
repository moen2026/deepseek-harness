/**
 * WeCom callback adapter for the connector seam. One plugin instance
 * registers one exact callback route on the injected WebServer and one WeCom
 * provider on `ctx.connector`. The route verifies every callback
 * (`msg_signature` over the encrypted payload), decrypts the platform's
 * AES-256-CBC envelope, answers the URL-verification echo, and admits text
 * messages and template-card button clicks through `ctx.connector.deliver()`;
 * the provider pushes outbound messages through the WeCom API as text or a
 * template card of buttons. Both registrations are effect-scoped: disposal
 * unregisters them.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-connector-wecom
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import z from '@deepseek-ai/schemastery';
import { createWecomClient } from "./client.js";
import { createWecomCallbackHandler } from "./handler.js";
import { WECOM_PROVIDER_ID } from "./types.js";
export { WecomError, WECOM_PROVIDER_ID } from "./types.js";
/** Cordis function-plugin name. */
export const name = 'connector-wecom';
/** Host services required before the route and provider can register. */
export const inject = ['webServer', 'connector', 'credentials'];
/** Default per-request outbound timeout (ms). */
export const CONNECTOR_WECOM_DEFAULT_TIMEOUT_MS = 10_000;
/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config = z.object({
    path: z.string().required(),
    callbackTokenEnv: z.string().role('credential-ref').required(),
    encodingAesKeyEnv: z.string().role('credential-ref').required(),
    corpIdEnv: z.string().role('credential-ref').required(),
    corpSecretEnv: z.string().role('credential-ref').required(),
    agentId: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
    maxBodyBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
    timeoutMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(CONNECTOR_WECOM_DEFAULT_TIMEOUT_MS),
    apiBaseUrl: z.string(),
});
/** Validate route and origin facts that Schemastery cannot express. */
function assertConfig(config) {
    if (!config.path.startsWith('/') || config.path === '/' || config.path.endsWith('/')
        || config.path.includes('?') || config.path.includes('#')) {
        throw new Error('connector-wecom path must be an absolute non-root pathname without a trailing slash, query, or fragment');
    }
    if (config.apiBaseUrl !== undefined) {
        let origin;
        try {
            origin = new URL(config.apiBaseUrl);
        }
        catch {
            throw new Error('connector-wecom apiBaseUrl must be an absolute URL');
        }
        if (origin.protocol !== 'https:' || origin.search !== '' || origin.hash !== '') {
            throw new Error('connector-wecom apiBaseUrl must be an https URL without query or fragment');
        }
    }
}
/**
 * Resolve the effective API origin. The explicit resolve step owns the
 * deployment default, so no request path hides one.
 * @param config - the validated plugin configuration.
 * @returns the API origin without trailing slashes.
 */
function resolveApiBaseUrl(config) {
    return (config.apiBaseUrl ?? 'https://qyapi.weixin.qq.com').replace(/\/+$/, '');
}
/**
 * Register the callback route and the WeCom provider on `ctx.connector`.
 * @param ctx - the plugin context (must inject `webServer`, `connector`, and `credentials`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx, config) {
    assertConfig(config);
    const client = createWecomClient(ctx, {
        apiBaseUrl: resolveApiBaseUrl(config),
        corpIdRef: credentialRef(config.corpIdEnv),
        corpSecretRef: credentialRef(config.corpSecretEnv),
        agentId: config.agentId,
        timeoutMs: config.timeoutMs ?? CONNECTOR_WECOM_DEFAULT_TIMEOUT_MS,
    });
    const route = {
        kind: 'exact',
        path: config.path,
        handler: createWecomCallbackHandler(ctx, {
            callbackTokenRef: credentialRef(config.callbackTokenEnv),
            encodingAesKeyRef: credentialRef(config.encodingAesKeyEnv),
            corpIdRef: credentialRef(config.corpIdEnv),
            maxBodyBytes: config.maxBodyBytes,
        }),
    };
    ctx.effect(() => ctx.webServer.register(route), `connector-wecom: ${config.path}`);
    ctx.effect(() => ctx.connector.registerProvider({
        id: WECOM_PROVIDER_ID,
        push: (channel, message, signal) => client.push(channel, message, signal),
    }), 'connector-wecom: provider');
}
//# sourceMappingURL=index.js.map