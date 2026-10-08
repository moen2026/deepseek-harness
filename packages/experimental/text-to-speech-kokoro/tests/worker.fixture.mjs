/** Protocol fixture replacing the native synthesizer, with real process and HTTP lifetimes. */
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

function wav() {
  const b = Buffer.alloc(52)
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(24000, 28); b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(8, 40)
  return b
}

const root = JSON.parse(process.argv[2]).model
const server = createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${process.env.DSH_SPEECH_TOKEN}`) {
    response.writeHead(401).end(); return
  }
  const chunks = []
  request.on('data', chunk => chunks.push(chunk))
  request.on('end', () => {
    if (new URL(request.url, 'http://localhost').pathname !== '/synthesize') {
      response.writeHead(404).end(); return
    }
    const text = JSON.parse(Buffer.concat(chunks).toString('utf8')).text
    appendFileSync(join(root, 'requests'), `${text}\n`)
    if (text === 'hold') return
    if (text === 'crash') { process.exit(1); return }
    if (text === 'invalid-input') { response.writeHead(400).end(JSON.stringify({ error: 'invalid input', code: 'invalid-input' })); return }
    if (text === 'error') { response.writeHead(400).end(JSON.stringify({ error: 'provider failed' })); return }
    response.setHeader('content-type', 'audio/wav')
    response.end(wav())
  })
})
server.listen(0, '127.0.0.1', () => { process.stdout.write(`${JSON.stringify({ port: server.address().port })}\n`) })
