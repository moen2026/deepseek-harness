/**
 * WeCom callback HTTP handler: the URL-verification GET that returns the
 * decrypted echo string, and the encrypted POST intake — bounded raw body,
 * `msg_signature` verification, AES decryption with the receive-id check,
 * translation, and delivery into `ctx.connector`. The handler answers only
 * after the message has a durable webhook delivery (queued or duplicate);
 * every refusal carries no request data. WeCom defines no replay window, so
 * the signature and the outbox deduplication own the admission guarantee.
 * @module @deepseek-ai/dsh-connector-wecom/handler
 */
import { decryptWecomMessage, parseWecomXmlFields, readRawBody, requiredField, verifyWecomSignature, wecomAesKey, WecomCallbackError, } from "./callback.js";
import { translateWecomFields } from "./event.js";
/** Whether Content-Type names one of the XML media types WeCom posts. */
function isXmlMediaType(value) {
    if (value === undefined)
        return false;
    const semicolon = value.indexOf(';');
    const media = (semicolon === -1 ? value : value.slice(0, semicolon)).trim().toLowerCase();
    return media === 'text/xml' || media === 'application/xml';
}
/** Resolve one required credential, refusing while it is unavailable. */
async function resolveCredential(ctx, ref, label) {
    const credential = await ctx.credentials.resolve(ref);
    if (credential === undefined || credential.value === '') {
        throw new WecomCallbackError(503, `WeCom ${label} is unavailable`);
    }
    return credential.value;
}
/** Send one plain-text response exactly once. */
function respond(response, status, message) {
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(message);
}
/**
 * Create one exact-route WeCom callback handler.
 * @param ctx - adapter context carrying credentials and the connector seam.
 * @param config - validated credential references and body ceiling.
 * @returns an HTTP handler that answers after in-memory delivery admission.
 */
export function createWecomCallbackHandler(ctx, config) {
    return async (request, response) => {
        try {
            if (request.method === 'GET') {
                const url = new URL(request.url ?? '/', 'http://localhost');
                const timestamp = url.searchParams.get('timestamp') ?? '';
                const nonce = url.searchParams.get('nonce') ?? '';
                const encrypt = url.searchParams.get('echostr') ?? '';
                if (timestamp === '' || nonce === '' || encrypt === '') {
                    throw new WecomCallbackError(400, 'URL verification requires timestamp, nonce, and echostr');
                }
                const [token, aesKey, corpId] = await Promise.all([
                    resolveCredential(ctx, config.callbackTokenRef, 'callback token'),
                    resolveCredential(ctx, config.encodingAesKeyRef, 'encoding AES key').then(wecomAesKey),
                    resolveCredential(ctx, config.corpIdRef, 'corp id'),
                ]);
                if (verifyWecomSignature({ timestamp, nonce, encrypt }, token, url.searchParams.get('msg_signature') ?? '') !== 'ok') {
                    throw new WecomCallbackError(401, 'invalid webhook signature');
                }
                respond(response, 200, decryptWecomMessage(aesKey, encrypt, corpId));
                return;
            }
            if (request.method !== 'POST') {
                response.setHeader('allow', 'GET, POST');
                throw new WecomCallbackError(405, 'method not allowed');
            }
            if (!isXmlMediaType(request.headers['content-type'])) {
                throw new WecomCallbackError(415, 'content type must be text/xml');
            }
            const rawBody = await readRawBody(request, config.maxBodyBytes);
            const envelope = parseWecomXmlFields(new TextDecoder('utf-8', { fatal: true }).decode(rawBody));
            const encrypt = requiredField(envelope, 'Encrypt');
            const timestamp = requiredField(envelope, 'TimeStamp');
            const nonce = requiredField(envelope, 'Nonce');
            const [token, aesKey, corpId] = await Promise.all([
                resolveCredential(ctx, config.callbackTokenRef, 'callback token'),
                resolveCredential(ctx, config.encodingAesKeyRef, 'encoding AES key').then(wecomAesKey),
                resolveCredential(ctx, config.corpIdRef, 'corp id'),
            ]);
            if (verifyWecomSignature({ timestamp, nonce, encrypt }, token, requiredField(envelope, 'MsgSignature')) !== 'ok') {
                throw new WecomCallbackError(401, 'invalid webhook signature');
            }
            const fields = parseWecomXmlFields(decryptWecomMessage(aesKey, encrypt, corpId));
            const translated = translateWecomFields(fields);
            if (translated.kind === 'message') {
                try {
                    await ctx.connector.deliver(translated.message);
                }
                catch (error) {
                    if (error instanceof TypeError)
                        throw new WecomCallbackError(400, 'WeCom message is not deliverable');
                    throw new WecomCallbackError(503, 'connector delivery is unavailable');
                }
            }
            respond(response, 200, 'success');
        }
        catch (error) {
            if (error instanceof WecomCallbackError) {
                respond(response, error.status, error.message);
                return;
            }
            ctx.logger.warn('connector-wecom: request failed');
            respond(response, 503, 'connector-wecom ingress is unavailable');
        }
    };
}
//# sourceMappingURL=handler.js.map