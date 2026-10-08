/** Native synthesis applies bounded inputs, pinned voices, and Electron-safe WAV buffers. */
import { beforeEach, expect, it, vi } from 'vitest'
import { Config } from '../src/config.ts'
import { createSynthesizer, wavSampleRate } from '../src/inference.ts'
import type { RuntimePaths } from '../src/runtime.ts'

const native = vi.hoisted(() => ({ configs: [] as object[], calls: [] as Array<{ text: string; sid: number; speed: number }> }))
vi.mock('sherpa-onnx-node', () => {
  const OfflineTts = class {
    constructor(config: object) { native.configs.push(structuredClone(config)) }
    generate(call: { text: string; sid: number; speed: number }) {
      native.calls.push(structuredClone(call))
      return { samples: Float32Array.of(0.5, -0.5, 1.5, -2), sampleRate: 24000 }
    }
  }
  return { OfflineTts, default: { OfflineTts } }
})
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: vi.fn((path: Parameters<typeof actual.readFileSync>[0]) => {
      if (String(path).endsWith('assets.json')) return JSON.stringify({ voices: { zf_001: 3, zm_009: 58 } })
      return actual.readFileSync(path)
    }),
  }
})

const paths: RuntimePaths = { model: '/model.onnx', voicesBin: '/voices.bin', tokens: '/tokens.txt',
  lexicons: ['/us-en', '/zh', '/gb-en'], fst: ['/date', '/number', '/phone'], espeakData: '/espeak-ng-data', dict: '/dict', worker: '/worker' }

beforeEach(() => { native.calls.length = 0; native.configs.length = 0 })

it('loads one Kokoro model and routes bounded synthesis through the pinned voice table', () => {
  const synthesize = createSynthesizer(Config({ dataRoot: '/cache', threads: 3 }), paths)
  const result = synthesize('你好。', 'zm_009', 1.2)
  expect(native.configs[0]).toMatchObject({ model: { kokoro: { model: '/model.onnx', voices: '/voices.bin', tokens: '/tokens.txt',
    dataDir: '/espeak-ng-data', lexicon: '/us-en,/zh,/gb-en', dictDir: '/dict', lang: '' } }, numThreads: 3, provider: 'cpu' })
  expect(native.calls[0]).toEqual({ text: '你好。', sid: 58, speed: 1.2 })
  expect(result.sampleRate).toBe(24000)
  expect(result.audio.length).toBe(44 + 4 * 2)
  expect(result.audio.toString('ascii', 0, 4)).toBe('RIFF')
  expect(result.audio.toString('ascii', 8, 12)).toBe('WAVE')
  expect(result.audio.readUInt32LE(24)).toBe(24000)
  expect(result.audio.subarray(44)).toEqual(Buffer.from([0x00, 0x40, 0x00, 0xc0, 0xff, 0x7f, 0x00, 0x80]))
  expect(wavSampleRate(result.audio)).toBe(24000)
})

it('rejects oversized text, unknown voices, and out-of-range speed without touching the model', () => {
  const synthesize = createSynthesizer(Config({ dataRoot: '/cache', maxTextChars: 10 }), paths)
  expect(() => synthesize('', 'zf_001', 1)).toThrow('size')
  expect(() => synthesize('x'.repeat(11), 'zf_001', 1)).toThrow('size')
  expect(() => synthesize('你好', 'zf_999', 1)).toThrow('Unknown voice')
  expect(() => synthesize('你好', 'zf_001', 0.4)).toThrow('speed')
  expect(() => synthesize('你好', 'zf_001', Number.NaN)).toThrow('speed')
  expect(native.calls).toEqual([])
})

it('refuses malformed audio replies', () => {
  expect(() => wavSampleRate(new Uint8Array(20))).toThrow('Invalid speech audio reply')
  expect(() => wavSampleRate(new Uint8Array(Buffer.from('NOTWAVE'.padEnd(44, '\0'))))).toThrow('Invalid speech audio reply')
})
