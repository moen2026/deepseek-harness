/** Private child entry; the Host owns termination, and stdout carries only readiness. */
import { z } from 'zod'
import { SpeechInputError, startLoopbackServer } from '@deepseek-ai/dsh-experimental-local-speech-runtime'
import { Config } from './config.ts'
import { createSynthesizer } from './inference.ts'

const raw: unknown = JSON.parse(z.string().parse(process.argv[2]))
const paths = z.object({
  model: z.string().min(1), voicesBin: z.string().min(1), tokens: z.string().min(1),
  lexicons: z.array(z.string().min(1)).length(3), fst: z.array(z.string().min(1)).length(3),
  espeakData: z.string().min(1), dict: z.string().min(1),
}).parse(raw)
const config = Object.assign(Config(z.record(z.string(), z.unknown()).parse(raw)), paths)
const token = z.string().regex(/^[a-f0-9]{64}$/).parse(process.env.DSH_SPEECH_TOKEN)
delete process.env.DSH_SPEECH_TOKEN
const synthesize = createSynthesizer(config, paths)
const { port } = await startLoopbackServer(token, config.maxTextChars * 4 + 1024, ({ url, body }) => {
  if (url.pathname !== '/synthesize') return { status: 404, body: { error: 'Unknown endpoint' } }
  const request = z.object({ text: z.string(), voiceId: z.string(), speed: z.number() }).strict()
    .parse(JSON.parse(body.toString('utf8')))
  const audio = synthesize(request.text, request.voiceId, request.speed)
  if (audio.audio.length > config.maxAudioBytes) throw new SpeechInputError('Invalid speech audio size')
  return { status: 200, body: audio.audio, contentType: 'audio/wav' }
})
process.stdout.write(`${JSON.stringify({ port })}\n`)
