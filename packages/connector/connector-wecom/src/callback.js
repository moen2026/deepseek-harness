/**
 * WeCom callback intake: the bounded raw request body, the `msg_signature`
 * check, and the platform's AES-256-CBC message envelope. The signature is
 * the SHA-1 of the four protocol values sorted lexicographically and joined,
 * compared timing-safe; every refusal is an HTTP-status-bearing error that
 * carries no request data.
 * @module @deepseek-ai/dsh-connector-wecom/callback
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
/** HTTP refusal whose message is safe to return without request data. */
export class WecomCallbackError extends Error {
    status;
    name = 'WecomCallbackError';
    /**
     * @param status - the HTTP status this refusal answers with.
     * @param message - refusal detail safe to send to the callback sender.
     */
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
/* jscpd:ignore-start -- the sibling connector providers and the webhook ingress intentionally
   keep product-private bounded-body plumbing; each owner refuses through its own error type
   and pre-checks instead of a shared reader that would couple the packages. */
/**
 * Read one callback request body as exact, bounded raw bytes. The untouched
 * bytes are what the signature covers, so they are never re-encoded.
 * @param request - incoming request before any parser consumes it.
 * @param maxBodyBytes - positive byte ceiling.
 * @returns the raw body after EOF.
 * @throws {WecomCallbackError} for excessive bytes or an aborted stream.
 */
export async function readRawBody(request, maxBodyBytes) {
    const chunks = [];
    let size = 0;
    try {
        for await (const raw of request) {
            const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
            size += chunk.byteLength;
            if (size > maxBodyBytes) {
                request.resume();
                throw new WecomCallbackError(413, 'request body is too large');
            }
            chunks.push(chunk);
        }
    }
    catch (error) {
        if (error instanceof WecomCallbackError)
            throw error;
        throw new WecomCallbackError(400, 'request body was aborted');
    }
    if (!request.complete)
        throw new WecomCallbackError(400, 'request body was aborted');
    return Buffer.concat(chunks, size);
}
/* jscpd:ignore-end */
/**
 * Compute one `msg_signature` value: the SHA-1 of the protocol values sorted
 * lexicographically and joined.
 * @param values - the values the signature covers, `token` included.
 * @returns the hex digest WeCom compares against `msg_signature`.
 */
export function wecomSignature(values) {
    return createHash('sha1').update([...values].sort().join('')).digest('hex');
}
/**
 * Verify one `msg_signature` over the values WeCom sent.
 * @param values - the timestamp, nonce, and encrypted payload from the request.
 * @param token - the configured callback token.
 * @param signature - the `msg_signature` value from the request.
 * @returns `'ok'` when the timing-safe comparison passes, `'invalid'` otherwise.
 */
export function verifyWecomSignature(values, token, signature) {
    const expected = wecomSignature([token, values.timestamp, values.nonce, values.encrypt]);
    const expectedBytes = Buffer.from(expected, 'utf8');
    const receivedBytes = Buffer.from(signature, 'utf8');
    return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
        ? 'ok'
        : 'invalid';
}
/**
 * Derive the AES key from the configured encoding key. WeCom ships the key
 * as 43 base64 characters without padding.
 * @param encodingAesKey - the 43-character `EncodingAESKey` credential value.
 * @returns the 32-byte AES key whose first 16 bytes are the IV.
 * @throws {WecomCallbackError} when the key is not the documented 43 characters.
 */
export function wecomAesKey(encodingAesKey) {
    if (!/^[A-Za-z0-9]{43}$/.test(encodingAesKey)) {
        throw new WecomCallbackError(503, 'encoding AES key must be 43 base64 characters');
    }
    return Buffer.from(`${encodingAesKey}=`, 'base64');
}
/**
 * Decrypt one WeCom message envelope. The plaintext after AES-256-CBC
 * decryption is a 16-byte random prefix, a 4-byte big-endian length, the
 * message, and the receive id, which must match the configured corp id.
 * @param aesKey - the key derived from the configured `EncodingAESKey`.
 * @param encrypt - the base64 ciphertext from the callback or query string.
 * @param receiveId - the configured corp id the envelope must carry.
 * @returns the decrypted message as UTF-8.
 * @throws {WecomCallbackError} for malformed ciphertext or a mismatched receive id.
 */
export function decryptWecomMessage(aesKey, encrypt, receiveId) {
    let plain;
    try {
        const decipher = createDecipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16));
        plain = Buffer.concat([decipher.update(Buffer.from(encrypt, 'base64')), decipher.final()]);
    }
    catch {
        // Decryption is the only statement in the try; ciphertext it cannot
        // decrypt is exactly this refusal.
        throw new WecomCallbackError(400, 'callback payload is not a decryptable WeCom envelope');
    }
    if (plain.byteLength < 20) {
        throw new WecomCallbackError(400, 'callback payload envelope is too short');
    }
    const length = plain.readUInt32BE(16);
    if (20 + length > plain.byteLength) {
        throw new WecomCallbackError(400, 'callback payload envelope carries a truncated message');
    }
    const receive = plain.subarray(20 + length).toString('utf8');
    if (receive !== receiveId) {
        throw new WecomCallbackError(401, 'callback envelope receive id does not match the configured corp id');
    }
    return plain.subarray(20, 20 + length).toString('utf8');
}
/**
 * Build one WeCom message envelope. The inverse of
 * {@link decryptWecomMessage}, used by round-trip verification and by
 * callback fixtures that exercise the intake path.
 * @param aesKey - the key derived from the configured `EncodingAESKey`.
 * @param plaintext - the message to seal.
 * @param receiveId - the receive id appended after the message.
 * @returns the base64 ciphertext WeCom transports in the `Encrypt` field.
 */
export function encryptWecomMessage(aesKey, plaintext, receiveId) {
    const message = Buffer.from(plaintext, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(message.byteLength);
    const cipher = createCipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16));
    return Buffer.concat([
        cipher.update(Buffer.concat([randomBytes(16), length, message, Buffer.from(receiveId, 'utf8')])),
        cipher.final(),
    ]).toString('base64');
}
/**
 * Extract the flat leaf fields of one WeCom XML document. WeCom callback XML
 * is one level deep and every value is either CDATA-wrapped or plain text;
 * anything nested is skipped, so a structural surprise fails through missing
 * fields rather than through wrong values.
 * @param text - the XML document as UTF-8.
 * @returns the leaf fields keyed by tag name.
 */
export function parseWecomXmlFields(text) {
    const fields = {};
    const tag = /<([A-Za-z][A-Za-z0-9_.]*)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g;
    for (const match of text.matchAll(tag)) {
        const [, name, cdata, plain] = match;
        if (name === undefined)
            continue;
        fields[name] = cdata ?? (plain ?? '').trim();
    }
    return fields;
}
/** Require one field as a non-empty string. */
export function requiredField(fields, name) {
    const value = fields[name];
    if (value === undefined || value.trim() === '') {
        throw new WecomCallbackError(400, `WeCom callback carries no ${name} field`);
    }
    return value;
}
//# sourceMappingURL=callback.js.map