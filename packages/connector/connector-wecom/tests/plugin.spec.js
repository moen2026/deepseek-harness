import { Context } from '@deepseek-ai/cordis';
import { ConnectorChannelId } from '@deepseek-ai/dsh-connector';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apply } from "../src/index.js";
const contexts = [];
afterEach(async () => {
    await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
    vi.unstubAllGlobals();
});
/** Context with only the services direct apply reads. */
function harness() {
    const ctx = new Context();
    contexts.push(ctx);
    const remove = vi.fn();
    const removeProvider = vi.fn();
    const register = vi.fn(() => remove);
    const registerProvider = vi.fn(() => removeProvider);
    ctx.provide('webServer', { register });
    ctx.provide('connector', { registerProvider });
    ctx.provide('credentials', { resolve: async () => ({ value: 'fixture-secret', source: 'environment' }) });
    return { ctx, register, registerProvider, remove, removeProvider };
}
const valid = {
    path: '/wecom',
    callbackTokenEnv: 'DSH_WECOM_TOKEN',
    encodingAesKeyEnv: 'DSH_WECOM_AES_KEY',
    corpIdEnv: 'DSH_WECOM_CORP_ID',
    corpSecretEnv: 'DSH_WECOM_CORP_SECRET',
    agentId: 100_000_2,
    maxBodyBytes: 1024,
};
describe('WeCom connector plugin config', () => {
    it('registers one exact route and one provider, removed with the plugin fiber', async () => {
        const test = harness();
        apply(test.ctx, { ...valid, timeoutMs: 5_000 });
        expect(test.register).toHaveBeenCalledWith(expect.objectContaining({ kind: 'exact', path: '/wecom' }));
        expect(test.registerProvider).toHaveBeenCalledWith(expect.objectContaining({ id: 'wecom' }));
        await test.ctx.fiber.dispose();
        expect(test.remove).toHaveBeenCalledOnce();
        expect(test.removeProvider).toHaveBeenCalledOnce();
    });
    it('pushes through the configured origin and defaults to qyapi.weixin.qq.com', async () => {
        const fetchMock = vi.fn()
            .mockImplementation(async (url) => {
            if (url.includes('/cgi-bin/gettoken')) {
                return Response.json({ errcode: 0, errmsg: 'ok', access_token: 'token-1', expires_in: 7200 });
            }
            return Response.json({ errcode: 0, errmsg: 'ok' });
        });
        vi.stubGlobal('fetch', fetchMock);
        const proxied = harness();
        apply(proxied.ctx, { ...valid, apiBaseUrl: 'https://qyapi.example.com/' });
        const proxiedProvider = proxied.registerProvider.mock.calls[0][0];
        await proxiedProvider.push(ConnectorChannelId('u-1'), { text: 'hi' });
        expect(fetchMock.mock.calls[0][0]).toBe('https://qyapi.example.com/cgi-bin/gettoken?corpid=fixture-secret&corpsecret=fixture-secret');
        const plain = harness();
        apply(plain.ctx, valid);
        const plainProvider = plain.registerProvider.mock.calls[0][0];
        await plainProvider.push(ConnectorChannelId('u-1'), { text: 'hi' });
        expect(fetchMock.mock.calls[2][0]).toBe('https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=fixture-secret&corpsecret=fixture-secret');
    });
    it.each([
        [{ ...valid, path: 'wecom' }, /path/],
        [{ ...valid, path: '/' }, /path/],
        [{ ...valid, path: '/wecom/' }, /path/],
        [{ ...valid, path: '/wecom?q=1' }, /path/],
        [{ ...valid, path: '/wecom#x' }, /path/],
        [{ ...valid, apiBaseUrl: 'not a URL' }, /absolute URL/],
        [{ ...valid, apiBaseUrl: 'http://qyapi.weixin.qq.com' }, /https/],
        [{ ...valid, apiBaseUrl: 'https://qyapi.weixin.qq.com/?q=1' }, /https/],
        [{ ...valid, callbackTokenEnv: 'not valid' }, /credential ref/],
        [{ ...valid, encodingAesKeyEnv: 'not valid' }, /credential ref/],
        [{ ...valid, corpIdEnv: 'not valid' }, /credential ref/],
        [{ ...valid, corpSecretEnv: 'not valid' }, /credential ref/],
    ])('rejects invalid config %# before registration', (config, message) => {
        const test = harness();
        expect(() => { apply(test.ctx, config); }).toThrow(message);
        expect(test.register).not.toHaveBeenCalled();
        expect(test.registerProvider).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=plugin.spec.js.map