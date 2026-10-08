/**
 * Discord Gateway lifecycle: one long-lived WebSocket connection that
 * identifies with the bot token, answers the server's heartbeat interval,
 * and hands MESSAGE_CREATE and message-component dispatches to the connector
 * seam. Disconnects reconnect after a fixed delay; the connection is not
 * resumed, so messages sent while offline are not replayed.
 * @module @deepseek-ai/dsh-connector-discord/gateway
 */
import { translateDispatch } from "./event.js";
/** Op codes this adapter consumes from the Gateway protocol. */
const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RECONNECT = 7;
const OP_INVALID_SESSION = 9;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;
/**
 * Build the Gateway connection manager.
 * @param ctx - the plugin context carrying credentials, the connector seam, and logging.
 * @param client - the outbound client that acknowledges component interactions.
 * @param options - validated endpoint, intents, token reference, and reconnect delay.
 * @returns a lifecycle handle; `open()` starts, `close()` stops permanently.
 */
export function createDiscordGateway(ctx, client, options) {
    let socket;
    let heartbeat;
    let reconnect;
    let lastSeq = null;
    let disposed = false;
    const stopHeartbeat = () => {
        if (heartbeat !== undefined) {
            clearInterval(heartbeat);
            heartbeat = undefined;
        }
    };
    const send = (payload) => {
        try {
            socket?.send(JSON.stringify(payload));
        }
        catch (error) {
            // send is the only statement in the try; a socket that closed between
            // events is exactly this failure, and onclose owns the reconnect.
            ctx.logger.warn('connector-discord: gateway send failed', error);
        }
    };
    const identify = async () => {
        const credential = await ctx.credentials.resolve(options.botTokenRef);
        if (credential === undefined || credential.value === '') {
            ctx.logger.warn('connector-discord: bot token is unavailable; gateway stays disconnected');
            socket?.close();
            return;
        }
        send({
            op: OP_IDENTIFY,
            d: {
                token: credential.value,
                intents: options.intents,
                properties: { os: process.platform, browser: 'dsh-connector-discord', device: 'dsh-connector-discord' },
            },
        });
    };
    const admit = async (payload) => {
        try {
            await ctx.connector.deliver(payload.message);
        }
        catch (error) {
            ctx.logger.warn('connector-discord: delivery failed', error);
        }
    };
    const handleDispatch = async (type, data) => {
        const translated = translateDispatch(type, data);
        if (translated.kind === 'ignored')
            return;
        if (translated.kind === 'interaction') {
            // The client's loading state must stop whether or not the seam accepts
            // the click, so the acknowledgement is best-effort and its failure is
            // logged, never fatal.
            try {
                await client.ackInteraction(translated.interactionId, translated.interactionToken);
            }
            catch (error) {
                ctx.logger.warn('connector-discord: interaction acknowledgement failed', error);
            }
            await admit(translated);
            return;
        }
        await admit(translated);
    };
    const handlePayload = (payload) => {
        if (typeof payload.s === 'number')
            lastSeq = payload.s;
        switch (payload.op) {
            case OP_HELLO: {
                const hello = payload.d !== null && typeof payload.d === 'object'
                    ? payload.d
                    : undefined;
                const interval = typeof hello?.heartbeat_interval === 'number' ? hello.heartbeat_interval : undefined;
                if (interval === undefined || interval <= 0) {
                    ctx.logger.warn('connector-discord: gateway hello carried no heartbeat interval');
                    socket?.close();
                    return;
                }
                stopHeartbeat();
                heartbeat = setInterval(() => {
                    send({ op: OP_HEARTBEAT, d: lastSeq });
                }, interval);
                void identify();
                return;
            }
            case OP_HEARTBEAT_ACK:
                return;
            case OP_RECONNECT:
            case OP_INVALID_SESSION:
                socket?.close();
                return;
            case OP_DISPATCH:
                void handleDispatch(payload.t, payload.d);
                return;
            default:
                return;
        }
    };
    const handleRaw = (data) => {
        if (typeof data !== 'string')
            return;
        let payload;
        try {
            payload = JSON.parse(data);
        }
        catch {
            // JSON.parse is the only statement in the try; a non-JSON frame is not
            // a Gateway payload.
            ctx.logger.warn('connector-discord: gateway frame was not JSON');
            return;
        }
        if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
            ctx.logger.warn('connector-discord: gateway frame was not an object');
            return;
        }
        const envelope = payload;
        if (typeof envelope.op !== 'number') {
            ctx.logger.warn('connector-discord: gateway frame carried no op code');
            return;
        }
        handlePayload({ op: envelope.op, d: envelope.d, s: envelope.s, t: envelope.t });
    };
    const connect = () => {
        if (disposed)
            return;
        socket = new WebSocket(options.gatewayUrl);
        socket.onopen = () => undefined;
        socket.onmessage = (event) => {
            handleRaw(event.data);
        };
        socket.onclose = () => {
            stopHeartbeat();
            socket = undefined;
            if (disposed)
                return;
            // No resume is requested: a fresh identify keeps the state machine
            // minimal, and the durable outbox deduplicates what does arrive.
            reconnect = setTimeout(connect, options.reconnectDelayMs);
        };
        socket.onerror = () => undefined;
    };
    return {
        open() {
            connect();
        },
        close() {
            disposed = true;
            if (reconnect !== undefined) {
                clearTimeout(reconnect);
                reconnect = undefined;
            }
            stopHeartbeat();
            socket?.close();
            socket = undefined;
        },
    };
}
//# sourceMappingURL=gateway.js.map