/** Private sherpa-onnx Kokoro synthesis with bounded inputs and WAV replies. */
import sherpaOnnx from 'sherpa-onnx-node'
import { readFileSync } from 'node:fs'
import type { Config } from './config.ts'
import type { InferencePaths } from './runtime.ts'
import { SpeechInputError } from '@deepseek-ai/dsh-experimental-local-speech-runtime'

/** Encode one mono float32 waveform as a 16-bit PCM WAV container. */
function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const buffer = Buffer.alloc(44 + samples.length * 2)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples.length * 2, 4); buffer.write('WAVE', 8)
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(samples.length * 2, 40)
  for (let index = 0; index < samples.length; index++) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0))
    buffer.writeInt16LE(Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff), 44 + index * 2)
  }
  return buffer
}

/**
 * Read the PCM byte rate from a complete WAV container; malformed replies fail the request.
 * @param wav - complete WAV container bytes.
 * @returns the sample rate recorded in the header.
 */
export function wavSampleRate(wav: Uint8Array): number {
  const buffer = Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength)
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Invalid speech audio reply')
  }
  return buffer.readUInt32LE(24)
}

/** One bounded synthesis reply. */
type SynthesisReply = { audio: Buffer; sampleRate: number }

/**
 * Load the bundled Kokoro model once per worker process.
 * @param config - bounded text, voice, and thread settings.
 * @param paths - verified model bundle locations.
 * @returns one bounded synthesizer for the worker endpoint.
 */
export function createSynthesizer(config: Config, paths: InferencePaths): (text: string, voiceId: string, speed: number) => SynthesisReply {
  const lock = JSON.parse(readFileSync(new URL('../runtime/assets.json', import.meta.url), 'utf8')) as { voices: Record<string, number> }
  const tts = new sherpaOnnx.OfflineTts({
    model: { kokoro: {
      model: paths.model, voices: paths.voicesBin, tokens: paths.tokens, dataDir: paths.espeakData,
      lexicon: paths.lexicons.join(','), dictDir: paths.dict, lang: '',
    } },
    numThreads: config.threads, provider: 'cpu', debug: false,
  })
  return (text, voiceId, speed) => {
    if (text.length < 1 || text.length > config.maxTextChars) throw new SpeechInputError('Invalid speech text size')
    const sid = lock.voices[voiceId]
    if (sid === undefined) throw new SpeechInputError(`Unknown voice: ${voiceId}`)
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new SpeechInputError(`Invalid speech speed: ${speed}`)
    const audio = tts.generate({ text, sid, speed })
    return { audio: encodeWav(audio.samples, audio.sampleRate), sampleRate: audio.sampleRate }
  }
}
