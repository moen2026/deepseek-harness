import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiscordGateway } from "../src/gateway.js";
const BOT_TOKEN_REF = credentialRef('DSH_DISCORD_BOT_TOKEN');
/** Minimal stand-in for the global WebSocket the gateway connects with. */
class FakeWebSocket {
    url;
    static instances = [];
    static reset() {
        FakeWebSocket.instances = [];
    }
    readyState = 0;
    onopen = null;
    onmessage = null;
    onclose = null;
    sent = [];
    constructor(url) {
        this.url = url;
        FakeWebSocket.instances.push(this);
    }
    send(data) {
        this.sent.push(data);
    }
    close() {
        if (this.readyState === 3)
            return;
        this.readyState = 3;
        this.onclose?.();
    }
    /** Test helper: complete the connection handshake. */
    open() {
        this.readyState = 1;
        this.onopen?.();
    }
    /** Test helper: deliver one Gateway frame. */
    receive(payload) {
        this.onmessage?.({ data: JSON.stringify(payload) });
    }
}
/** Credential map plus delivery and diagnostic observation. */
function fakeContext() {
    const deliver = vi.fn(async () => 'queued');
    const warnings = vi.fn();
    return {
        ctx: {
            credentials: {
                resolve: async (ref) => ref === BOT_TOKEN_REF ? { value: 'bot-token-1', source: 'environment' } : undefined,
            },
            connector: { deliver },
            logger: { warn: warnings },
        },
        deliver,
        warnings,
    };
}
/** Open one gateway against the fake socket factory and return the fixtures. */
function build(reconnectDelayMs = 5_000) {
    const test = fakeContext();
    const ack = vi.fn(async () => undefined);
    const client = { push: async () => undefined, ackInteraction: ack };
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const gateway = createDiscordGateway(test.ctx, client, {
        gatewayUrl: 'wss://gateway.example.com',
        intents: 37_376,
        botTokenRef: BOT_TOKEN_REF,
        reconnectDelayMs,
    });
    gateway.open();
    return { test, ack, gateway };
}
/** The current (latest) fake socket. */
function current() {
    return FakeWebSocket.instances.at(-1);
}
/** Drain pending microtasks so the async identify and dispatch handlers finish. */
async function flush() {
    for (let i = 0; i < 10; i += 1)
        await Promise.resolve();
}
/** Complete the hello handshake and return the identify payload. */
async function hello(socket) {
    socket.open();
    socket.receive({ op: 10, d: { heartbeat_interval: 41_000 }, s: null, t: null });
    await flush();
    return JSON.parse(socket.sent[0]);
}
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});
describe('createDiscordGateway', () => {
    it('identifies after hello and answers the heartbeat interval', async () => {
        vi.useFakeTimers();
        FakeWebSocket.reset();
        const { gateway } = build();
        const socket = current();
        const identify = await hello(socket);
        expect(identify.op).toBe(2);
        expect(identify.d).toMatchObject({ token: 'bot-token-1', intents: 37_376 });
        vi.advanceTimersByTime(41_000);
        const heartbeat = JSON.parse(socket.sent.at(-1));
        expect(heartbeat).toEqual({ op: 1, d: null });
        gateway.close();
    });
    it('tracks the dispatch sequence into heartbeats', async () => {
        vi.useFakeTimers();
        FakeWebSocket.reset();
        const { gateway } = build();
        const socket = current();
        await hello(socket);
        socket.receive({ op: 0, t: 'PRESENCE_UPDATE', d: {}, s: 7 });
        vi.advanceTimersByTime(41_000);
        const heartbeat = JSON.parse(socket.sent.at(-1));
        expect(heartbeat.d).toBe(7);
        gateway.close();
    });
    it('delivers MESSAGE_CREATE and ignores bot, system, and empty messages', async () => {
        FakeWebSocket.reset();
        const { test, gateway } = build();
        const socket = current();
        await hello(socket);
        socket.receive({ op: 0, t: 'MESSAGE_CREATE', d: { id: 'm-1', channel_id: 'c-1', author: { id: 'u-1' }, content: 'hello' }, s: 1 });
        await flush();
        expect(test.deliver).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'discord',
            channel: 'c-1',
            messageId: 'm-1',
            sender: 'u-1',
            text: 'hello',
        }));
        const before = test.deliver.mock.calls.length;
        socket.receive({ op: 0, t: 'MESSAGE_CREATE', d: { id: 'm-2', channel_id: 'c-1', author: { id: 'b-1', bot: true }, content: 'echo' }, s: 2 });
        socket.receive({ op: 0, t: 'MESSAGE_CREATE', d: { id: 'm-3', channel_id: 'c-1', author: { id: 'u-1' }, content: 'joined', type: 7 }, s: 3 });
        socket.receive({ op: 0, t: 'MESSAGE_CREATE', d: { id: 'm-4', channel_id: 'c-1', author: { id: 'u-1' } }, s: 4 });
        await flush();
        expect(test.deliver.mock.calls.length).toBe(before);
        gateway.close();
    });
    it('acknowledges a component interaction and delivers the resolution', async () => {
        FakeWebSocket.reset();
        const { test, ack, gateway } = build();
        const socket = current();
        await hello(socket);
        socket.receive({
            op: 0,
            t: 'INTERACTION_CREATE',
            d: { id: 'i-1', type: 3, token: 'it-1', user: { id: 'u-1' }, message: { channel_id: 'c-1' }, data: { custom_id: 'a1' } },
            s: 5,
        });
        await flush();
        expect(ack).toHaveBeenCalledWith('i-1', 'it-1');
        expect(test.deliver).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'discord',
            channel: 'c-1',
            messageId: 'i-1',
            sender: 'u-1',
            resolution: { actionId: 'a1', value: '' },
        }));
        gateway.close();
    });
    it('keeps delivering when the acknowledgement fails', async () => {
        FakeWebSocket.reset();
        const { test, ack, gateway } = build();
        ack.mockRejectedValueOnce(new Error('discord down'));
        const socket = current();
        await hello(socket);
        socket.receive({
            op: 0,
            t: 'INTERACTION_CREATE',
            d: { id: 'i-2', type: 3, token: 'it-2', user: { id: 'u-1' }, message: { channel_id: 'c-1' }, data: { custom_id: 'a1' } },
            s: 6,
        });
        await flush();
        expect(test.deliver).toHaveBeenCalled();
        expect(test.warnings).toHaveBeenCalled();
        gateway.close();
    });
    it('keeps running on malformed frames and a hello without a heartbeat interval', async () => {
        FakeWebSocket.reset();
        const { test, gateway } = build();
        const socket = current();
        socket.open();
        socket.onmessage?.({ data: 'not json' });
        socket.receive([]);
        socket.receive({ d: {} });
        socket.receive({ op: 10, d: {} });
        expect(test.warnings).toHaveBeenCalled();
        expect(FakeWebSocket.instances.length).toBe(1);
        expect(test.deliver).not.toHaveBeenCalled();
        gateway.close();
    });
    it('closes the socket on reconnect and invalid-session op codes', async () => {
        FakeWebSocket.reset();
        const { gateway } = build();
        const socket = current();
        await hello(socket);
        socket.receive({ op: 7, d: null, s: null, t: null });
        expect(socket.readyState).toBe(3);
        gateway.close();
    });
    it('reconnects after a close and stops after close()', async () => {
        vi.useFakeTimers();
        FakeWebSocket.reset();
        const { gateway } = build();
        await hello(current());
        current().close();
        expect(FakeWebSocket.instances.length).toBe(1);
        vi.advanceTimersByTime(5_000);
        expect(FakeWebSocket.instances.length).toBe(2);
        gateway.close();
        current().close();
        vi.advanceTimersByTime(50_000);
        expect(FakeWebSocket.instances.length).toBe(2);
    });
});
//# sourceMappingURL=gateway.spec.js.map