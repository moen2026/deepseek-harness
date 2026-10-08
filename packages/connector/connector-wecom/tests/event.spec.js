import { describe, expect, it } from 'vitest';
import { parseWecomXmlFields } from "../src/callback.js";
import { translateWecomFields } from "../src/event.js";
/** Parse one decrypted inner document the way the handler does. */
function fields(xml) {
    return parseWecomXmlFields(xml);
}
describe('translateWecomFields', () => {
    it('translates a text message with the member as channel and sender', () => {
        expect(translateWecomFields(fields('<xml><ToUserName><![CDATA[corp-1]]></ToUserName><FromUserName><![CDATA[u-1]]></FromUserName>'
            + '<MsgType><![CDATA[text]]></MsgType><Content><![CDATA[hello there]]></Content><MsgId>7001</MsgId></xml>'))).toEqual({
            kind: 'message',
            message: {
                provider: 'wecom',
                channel: 'u-1',
                messageId: '7001',
                sender: 'u-1',
                text: 'hello there',
            },
        });
    });
    it('ignores a text message without content', () => {
        expect(translateWecomFields(fields('<xml><MsgType><![CDATA[text]]></MsgType><Content></Content></xml>'))).toEqual({ kind: 'ignored' });
    });
    it('translates a template-card click whose key carries the adapter prefix into a resolution', () => {
        expect(translateWecomFields(fields('<xml><FromUserName><![CDATA[u-1]]></FromUserName><MsgType><![CDATA[event]]></MsgType>'
            + '<Event><![CDATA[template_card_event]]></Event><TaskId>task-7</TaskId><EventKey><![CDATA[dsh-approve-1]]></EventKey></xml>'))).toEqual({
            kind: 'message',
            message: {
                provider: 'wecom',
                channel: 'u-1',
                messageId: 'task-7:dsh-approve-1',
                sender: 'u-1',
                text: '',
                resolution: { actionId: 'approve-1', value: '' },
            },
        });
    });
    it('ignores card events whose key is not this adapter\'s button', () => {
        expect(translateWecomFields(fields('<xml><Event><![CDATA[template_card_event]]></Event><TaskId>t</TaskId><EventKey>foreign</EventKey></xml>'))).toEqual({ kind: 'ignored' });
    });
    it('ignores other message types and events', () => {
        expect(translateWecomFields(fields('<xml><MsgType><![CDATA[image]]></MsgType></xml>'))).toEqual({ kind: 'ignored' });
        expect(translateWecomFields(fields('<xml><Event><![CDATA[subscribe]]></Event></xml>'))).toEqual({ kind: 'ignored' });
    });
    it('refuses a consumed message without a message id or sender', () => {
        expect(() => translateWecomFields(fields('<xml><MsgType><![CDATA[text]]></MsgType><Content>hi</Content><FromUserName><![CDATA[u-1]]></FromUserName></xml>'))).toThrow(/MsgId/);
        expect(() => translateWecomFields(fields('<xml><MsgType><![CDATA[text]]></MsgType><Content>hi</Content><MsgId>1</MsgId></xml>')))
            .toThrow(/FromUserName/);
    });
    it('refuses a consumed click without a task id or sender', () => {
        expect(() => translateWecomFields(fields('<xml><Event><![CDATA[template_card_event]]></Event><EventKey>dsh-a1</EventKey><FromUserName><![CDATA[u-1]]></FromUserName></xml>'))).toThrow(/TaskId/);
        expect(() => translateWecomFields(fields('<xml><Event><![CDATA[template_card_event]]></Event><EventKey>dsh-a1</EventKey><TaskId>task-7</TaskId></xml>'))).toThrow(/FromUserName/);
    });
});
//# sourceMappingURL=event.spec.js.map