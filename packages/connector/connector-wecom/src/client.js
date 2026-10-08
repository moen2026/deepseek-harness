/**
 * WeCom outbound delivery: post one application message to a member — plain
 * text by default, or a template card of buttons when the message carries
 * actions (each button key carries its action id back in the
 * `template_card_event` callback). The access token is exchanged from the
 * corp credentials, cached until shortly before expiry, and re-fetched in
 * flight by concurrent sends; secrets are never logged or echoed.
 * @module @deepseek-ai/dsh-connector-wecom/client
 */
import { randomUUID } from 'node:crypto';
import { WecomError } from "./types.js";
/** Read one member of an unknown JSON value. */
function fieldOf(value, key) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value[key]
        : undefined;
}
/**
 * Render the template card one action-bearing message posts: one button per
 * action whose key carries the action id the card event echoes back.
 * @param message - the outbound message to render.
 * @param taskId - the unique card task id WeCom echoes with each click.
 * @returns the `template_card` body member.
 */
export function templateCardOf(message, taskId) {
    return {
        card_type: 'text_notice',
        main_title: { title: message.title ?? 'DSH' },
        sub_title_text: message.text,
        task_id: taskId,
        button_list: (message.actions ?? []).map(action => ({
            type: 1,
            key: `dsh-${action.id}`,
            name: action.label,
            style: action.style === 'primary' ? 1 : 2,
        })),
    };
}
/**
 * Build a WeCom client over the corp credential pair.
 * @param ctx - the plugin context carrying credentials.
 * @param options - resolved origin, credential references, agent id, and timeout.
 * @returns a client that exchanges, caches, and uses the access token.
 */
export function createWecomClient(ctx, options) {
    let cached;
    let inFlight;
    const resolveCredential = async (ref, label) => {
        const credential = await ctx.credentials.resolve(ref);
        if (credential === undefined || credential.value === '') {
            throw new WecomError(`connector-wecom: WeCom ${label} is unavailable`, 'WECOM_CREDENTIALS_UNAVAILABLE');
        }
        return credential.value;
    };
    const fetchJson = async (url, body, signal) => {
        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.any([AbortSignal.timeout(options.timeoutMs), signal]),
            });
        }
        catch (error) {
            throw new WecomError('connector-wecom: WeCom API request failed', 'WECOM_DELIVERY_FAILED', { cause: error });
        }
        if (!response.ok) {
            throw new WecomError(`connector-wecom: WeCom API responded ${response.status}`, 'WECOM_DELIVERY_FAILED');
        }
        return response.json();
    };
    const assertOk = (payload, context) => {
        const errcode = fieldOf(payload, 'errcode');
        if (typeof errcode === 'number' && errcode !== 0) {
            const errmsg = fieldOf(payload, 'errmsg');
            throw new WecomError(`connector-wecom: WeCom API ${context} failed: ${typeof errmsg === 'string' ? errmsg : `errcode ${errcode}`}`, 'WECOM_DELIVERY_FAILED');
        }
    };
    // The token exchange shares one promise across concurrent sends, so a burst
    // of deliveries after a cache miss performs exactly one exchange.
    const accessToken = (signal) => {
        if (cached !== undefined && cached.expiresAt > Date.now())
            return Promise.resolve(cached.token);
        inFlight ??= (async () => {
            try {
                const [corpId, corpSecret] = await Promise.all([
                    resolveCredential(options.corpIdRef, 'corp id'),
                    resolveCredential(options.corpSecretRef, 'corp secret'),
                ]);
                const query = new URLSearchParams({ corpid: corpId, corpsecret: corpSecret });
                let response;
                try {
                    response = await fetch(`${options.apiBaseUrl}/cgi-bin/gettoken?${query}`, {
                        signal: AbortSignal.any([AbortSignal.timeout(options.timeoutMs), signal]),
                    });
                }
                catch (error) {
                    throw new WecomError('connector-wecom: WeCom API token request failed', 'WECOM_DELIVERY_FAILED', { cause: error });
                }
                if (!response.ok) {
                    throw new WecomError(`connector-wecom: WeCom API responded ${response.status}`, 'WECOM_DELIVERY_FAILED');
                }
                const payload = await response.json();
                assertOk(payload, 'token exchange');
                const token = fieldOf(payload, 'access_token');
                const expiresIn = fieldOf(payload, 'expires_in');
                if (typeof token !== 'string' || token === '' || typeof expiresIn !== 'number') {
                    throw new WecomError('connector-wecom: WeCom API token response is incomplete', 'WECOM_DELIVERY_FAILED');
                }
                // Refresh a minute early so a send never uses an expiring token.
                cached = { token, expiresAt: Date.now() + expiresIn * 1000 - 60_000 };
                return token;
            }
            finally {
                inFlight = undefined;
            }
        })();
        return inFlight;
    };
    return {
        async push(channel, message, signal = new AbortController().signal) {
            const token = await accessToken(signal);
            const text = message.title === undefined ? message.text : `${message.title}\n${message.text}`;
            const body = message.actions === undefined
                ? { touser: channel, msgtype: 'text', agentid: options.agentId, text: { content: text } }
                : {
                    touser: channel,
                    msgtype: 'template_card',
                    agentid: options.agentId,
                    template_card: templateCardOf(message, randomUUID()),
                };
            const payload = await fetchJson(`${options.apiBaseUrl}/cgi-bin/message/send?access_token=${token}`, body, signal);
            assertOk(payload, 'message/send');
        },
    };
}
//# sourceMappingURL=client.js.map