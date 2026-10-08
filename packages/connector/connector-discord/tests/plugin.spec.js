import { Context } from '@deepseek-ai/cordis';
import { ConnectorChannelId } from '@deepseek-ai/dsh-connector';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apply } from "../src/index.js";
/** Minimal stand-in for the global WebSocket the gateway connects with. */
class FakeWebSocket {
    url;
    static instances = [];
    readyState = 0;
    onopen = null;
    onmessage = null;
    onclose = null;
    constructor(url) {
        this.url = url;
        FakeWebSocket.instances.push(this);
    }
    send(data) {
        void data;
    }
    close() {
        if (this.readyState === 3)
            return;
        this.readyState = 3;
        this.onclose?.();
    }
}
const contexts = [];
afterEach(async () => {
    await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
    vi.unstubAllGlobals();
});
/** Context with only the services direct apply reads. */
function harness() {
    const ctx = new Context();
    contexts.push(ctx);
    const removeProvider = vi.fn();
    const registerProvider = vi.fn(() => removeProvider);
    ctx.provide('connector', { registerProvider });
    ctx.provide('credentials', { resolve: async () => ({ value: 'bot-token-1', source: 'environment' }) });
    return { ctx, registerProvider, removeProvider };
}
const valid = {
    botTokenEnv: 'DSH_DISCORD_BOT_TOKEN',
};
describe('Discord connector plugin config', () => {
    it('registers one provider and one gateway connection, both removed with the plugin fiber', async () => {
        vi.stubGlobal('WebSocket', FakeWebSocket);
        FakeWebSocket.instances = [];
        const fetchMock = vi.fn()
            .mockImplementation(async () => new Response(null, { status: 204 }));
        vi.stubGlobal('fetch', fetchMock);
        const test = harness();
        apply(test.ctx, { ...valid, intents: 512, timeoutMs: 5_000 });
        expect(test.registerProvider).toHaveBeenCalledWith(expect.objectContaining({ id: 'discord' }));
        expect(FakeWebSocket.instances[0].url).toBe('wss://gateway.discord.gg/?v=10&encoding=json');
        await test.ctx.fiber.dispose();
        expect(test.removeProvider).toHaveBeenCalledOnce();
        expect(FakeWebSocket.instances[0].readyState).toBe(3);
    });
    it('pushes through the configured origin and defaults to discord.com', async () => {
        vi.stubGlobal('WebSocket', FakeWebSocket);
        FakeWebSocket.instances = [];
        const fetchMock = vi.fn()
            .mockImplementation(async () => new Response(null, { status: 204 }));
        vi.stubGlobal('fetch', fetchMock);
        const proxied = harness();
        apply(proxied.ctx, { ...valid, apiBaseUrl: 'https://discord.example.com/api/v10/' });
        const proxiedProvider = proxied.registerProvider.mock.calls[0][0];
        await proxiedProvider.push(ConnectorChannelId('c-1'), { text: 'hi' });
        expect(fetchMock.mock.calls[0][0]).toBe('https://discord.example.com/api/v10/channels/c-1/messages');
        const plain = harness();
        apply(plain.ctx, valid);
        const plainProvider = plain.registerProvider.mock.calls[0][0];
        await plainProvider.push(ConnectorChannelId('c-1'), { text: 'hi' });
        expect(fetchMock.mock.calls[1][0]).toBe('https://discord.com/api/v10/channels/c-1/messages');
    });
    it.each([
        [{ ...valid, botTokenEnv: 'not valid' }, /credential ref/],
        [{ ...valid, apiBaseUrl: 'not a URL' }, /absolute URL/],
        [{ ...valid, apiBaseUrl: 'http://discord.com' }, /https/],
        [{ ...valid, apiBaseUrl: 'https://discord.com/?q=1' }, /https/],
        [{ ...valid, gatewayUrl: 'not a URL' }, /absolute URL/],
        [{ ...valid, gatewayUrl: 'ws://gateway.discord.gg' }, /wss/],
    ])('rejects invalid config %# before registration', (config, message) => {
        const test = harness();
        expect(() => { apply(test.ctx, config); }).toThrow(message);
        expect(test.registerProvider).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=plugin.spec.js.map