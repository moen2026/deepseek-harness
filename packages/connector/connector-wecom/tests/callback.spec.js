import { afterEach, describe, expect, it, vi } from 'vitest';
import { decryptWecomMessage, encryptWecomMessage, parseWecomXmlFields, readRawBody, requiredField, verifyWecomSignature, wecomAesKey, wecomSignature, WecomCallbackError, } from "../src/callback.js";
const AES_KEY = wecomAesKey('A'.repeat(43));
const CORP_ID = 'corp-1';
afterEach(() => {
    vi.restoreAllMocks();
});
describe('wecomSignature and verifyWecomSignature', () => {
    it('sorts the protocol values before hashing and verifies its own signature', () => {
        const signature = wecomSignature(['token-1', '1717171717', 'nonce-1', 'ciphertext']);
        expect(signature).toBe(wecomSignature(['ciphertext', 'nonce-1', 'token-1', '1717171717']));
        expect(verifyWecomSignature({ timestamp: '1717171717', nonce: 'nonce-1', encrypt: 'ciphertext' }, 'token-1', signature)).toBe('ok');
    });
    it('refuses a signature over different values', () => {
        expect(verifyWecomSignature({ timestamp: '1', nonce: 'n', encrypt: 'e' }, 'token-1', 'deadbeef')).toBe('invalid');
    });
});
describe('wecomAesKey', () => {
    it('refuses a key that is not 43 base64 characters', () => {
        expect(() => wecomAesKey('short')).toThrow(WecomCallbackError);
    });
});
describe('encryptWecomMessage and decryptWecomMessage', () => {
    it('round-trips a message and verifies the receive id', () => {
        const encrypt = encryptWecomMessage(AES_KEY, '<xml><MsgType><![CDATA[text]]></MsgType></xml>', CORP_ID);
        expect(decryptWecomMessage(AES_KEY, encrypt, CORP_ID)).toBe('<xml><MsgType><![CDATA[text]]></MsgType></xml>');
    });
    it('round-trips multi-byte content', () => {
        const encrypt = encryptWecomMessage(AES_KEY, '内容 <content> mixed', CORP_ID);
        expect(decryptWecomMessage(AES_KEY, encrypt, CORP_ID)).toBe('内容 <content> mixed');
    });
    it('refuses a foreign receive id with 401', () => {
        const encrypt = encryptWecomMessage(AES_KEY, 'hello', 'corp-other');
        expect(() => decryptWecomMessage(AES_KEY, encrypt, CORP_ID)).toThrow(/receive id/);
    });
    it('refuses ciphertext that does not decrypt', () => {
        expect(() => decryptWecomMessage(AES_KEY, Buffer.from('not ciphertext').toString('base64'), CORP_ID)).toThrow(/decryptable/);
    });
});
describe('parseWecomXmlFields', () => {
    it('extracts CDATA and plain leaf fields and skips the document and declaration', () => {
        const document = '<?xml version="1.0" encoding="UTF-8"?>'
            + '<xml><Encrypt><![CDATA[enc]]></Encrypt><MsgSignature>sig</MsgSignature>'
            + '<TimeStamp>1717171717</TimeStamp><Nonce><![CDATA[n1]]></Nonce></xml>';
        expect(parseWecomXmlFields(document)).toEqual({
            Encrypt: 'enc',
            MsgSignature: 'sig',
            TimeStamp: '1717171717',
            Nonce: 'n1',
        });
    });
    it('skips nested tags without failing', () => {
        expect(parseWecomXmlFields('<xml><item><Name>x</Name></item><Top>y</Top></xml>')).toEqual({ Name: 'x', Top: 'y' });
    });
});
describe('requiredField', () => {
    it('refuses a missing or empty field with 400', () => {
        expect(() => requiredField({}, 'Encrypt')).toThrow(/Encrypt/);
        expect(() => requiredField({ Encrypt: '  ' }, 'Encrypt')).toThrow(/Encrypt/);
    });
});
describe('readRawBody', () => {
    function fakeRequest(chunks, complete = true) {
        const resume = vi.fn();
        const request = {
            async *[Symbol.asyncIterator]() {
                yield* chunks;
            },
            resume,
            complete,
        };
        return { request, resume };
    }
    it('concatenates the body bytes exactly', async () => {
        const { request } = fakeRequest([Buffer.from('hello '), Buffer.from('world')]);
        await expect(readRawBody(request, 100)).resolves.toEqual(Buffer.from('hello world'));
    });
    it('refuses an over-limit body with 413 and resumes the stream', async () => {
        const { request, resume } = fakeRequest([Buffer.alloc(11, 'a')]);
        await expect(readRawBody(request, 10)).rejects.toMatchObject({ status: 413 });
        expect(resume).toHaveBeenCalled();
    });
    it('refuses an incomplete body with 400', async () => {
        const { request } = fakeRequest([Buffer.from('x')], false);
        await expect(readRawBody(request, 100)).rejects.toMatchObject({ status: 400 });
    });
});
//# sourceMappingURL=callback.spec.js.map