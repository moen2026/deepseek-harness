import { ConnectorChannelId } from '@deepseek-ai/dsh-connector';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { componentsOf, createDiscordClient } from "../src/client.js";
const BOT_TOKEN_REF = credentialRef('DSH_DISCORD_BOT_TOKEN');
afterEach(() => {
    vi.unstubAllGlobals();
});
/** Context with only the credential service the client reads. */
function fakeContext(values = { DSH_DISCORD_BOT_TOKEN: 'bot-token-1' }) {
    const map = new Map(Object.entries(values));
    return {
        credentials: {
            resolve: async (ref) => {
                const value = map.get(ref);
                return value === undefined ? undefined : { value, source: 'environment' };
            },
        },
    };
}
describe('componentsOf', () => {
    it('renders one button per action with the style hint and the action id as custom_id', () => {
        expect(componentsOf({
            text: 'Run the tool?',
            actions: [
                { id: 'a1', label: 'Approve', style: 'primary' },
                { id: 'a2', label: 'Reject', style: 'danger' },
                { id: 'a3', label: 'Later' },
            ],
        })).toEqual({
            components: [
                {
                    type: 1,
                    components: [
                        { type: 2, style: 1, label: 'Approve', custom_id: 'a1' },
                        { type: 2, style: 4, label: 'Reject', custom_id: 'a2' },
                        { type: 2, style: 2, label: 'Later', custom_id: 'a3' },
                    ],
                },
            ],
        });
    });
});
describe('createDiscordClient', () => {
    function stubFetch() {
        const mock = vi.fn();
        vi.stubGlobal('fetch', mock);
        return mock;
    }
    it('posts plain text to the channel message URL with the bot token', async () => {
        const fetchMock = stubFetch().mockResolvedValue(new Response(null, { status: 204 }));
        const client = createDiscordClient(fakeContext(), { apiBaseUrl: 'https://discord.com/api/v10', botTokenRef: BOT_TOKEN_REF, timeoutMs: 1000 });
        await client.push(ConnectorChannelId('c-1'), { title: 'T', text: 'hello' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://discord.com/api/v10/channels/c-1/messages');
        expect(JSON.parse(init?.body)).toEqual({ content: 'T\nhello' });
        expect(init?.headers).toMatchObject({ authorization: 'Bot bot-token-1' });
    });
    it('posts an action row when the message carries actions', async () => {
        const fetchMock = stubFetch().mockResolvedValue(new Response(null, { status: 204 }));
        const client = createDiscordClient(fakeContext(), { apiBaseUrl: 'https://discord.com/api/v10', botTokenRef: BOT_TOKEN_REF, timeoutMs: 1000 });
        await client.push(ConnectorChannelId('c-1'), { text: 'hi', actions: [{ id: 'a1', label: 'Go' }] });
        expect(JSON.parse(fetchMock.mock.calls[0][1]?.body)).toEqual({
            content: 'hi',
            components: [{ type: 1, components: [{ type: 2, style: 2, label: 'Go', custom_id: 'a1' }] }],
        });
    });
    it('acknowledges a component interaction with a deferred-update callback', async () => {
        const fetchMock = stubFetch().mockResolvedValue(new Response(null, { status: 204 }));
        const client = createDiscordClient(fakeContext(), { apiBaseUrl: 'https://discord.com/api/v10', botTokenRef: BOT_TOKEN_REF, timeoutMs: 1000 });
        await client.ackInteraction('i-1', 'it-1');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://discord.com/api/v10/interactions/i-1/it-1/callback');
        expect(JSON.parse(init?.body)).toEqual({ type: 6 });
    });
    it('refuses a token-less credential before any request', async () => {
        const fetchMock = stubFetch();
        const client = createDiscordClient(fakeContext({}), { apiBaseUrl: 'https://discord.com/api/v10', botTokenRef: BOT_TOKEN_REF, timeoutMs: 1000 });
        await expect(client.push(ConnectorChannelId('c-1'), { text: 'hi' })).rejects.toMatchObject({ code: 'DISCORD_CREDENTIALS_UNAVAILABLE' });
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('maps transport, HTTP, and API failures onto DISCORD_DELIVERY_FAILED', async () => {
        const client = createDiscordClient(fakeContext(), { apiBaseUrl: 'https://discord.com/api/v10', botTokenRef: BOT_TOKEN_REF, timeoutMs: 1000 });
        const transport = stubFetch().mockRejectedValueOnce(new Error('offline'));
        await expect(client.push(ConnectorChannelId('c-1'), { text: 'hi' })).rejects.toThrow('Discord REST request failed');
        expect(transport).toHaveBeenCalled();
        stubFetch().mockResolvedValueOnce(new Response(null, { status: 500 }));
        await expect(client.push(ConnectorChannelId('c-1'), { text: 'hi' })).rejects.toThrow('responded 500');
        stubFetch().mockResolvedValueOnce(Response.json({ message: 'You are being rate limited' }, { status: 429 }));
        await expect(client.push(ConnectorChannelId('c-1'), { text: 'hi' })).rejects.toThrow('rate limited');
        stubFetch().mockResolvedValueOnce(new Response('not json', { status: 403 }));
        await expect(client.push(ConnectorChannelId('c-1'), { text: 'hi' })).rejects.toThrow('responded 403');
        stubFetch().mockResolvedValueOnce(new Response(null, { status: 204 }));
        await expect(client.ackInteraction('i-1', 'it-1')).resolves.toBeUndefined();
    });
});
//# sourceMappingURL=client.spec.js.map