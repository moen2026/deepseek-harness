/** Runtime preparation verifies pinned assets and joins managed extraction processes. */
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Config } from '../src/config.ts'
import { inspectRuntime, prepareRuntime, voiceCatalog, type RuntimePaths } from '../src/runtime.ts'

const state = vi.hoisted(() => ({ lock: '', stagedBundle: '' }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readFileSync: vi.fn((path: Parameters<typeof actual.readFileSync>[0],
    options?: Parameters<typeof actual.readFileSync>[1]) =>
    String(path).endsWith('assets.json') ? state.lock : actual.readFileSync(path, options)) }
})
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFile: vi.fn((file: string, args: string[], callback: (error: Error | null) => void) => {
    try {
      if (file === 'tar') cpSync(state.stagedBundle, join(args[3]!, 'kokoro-multi-lang-v1_1'), { recursive: true })
      else if (file === process.execPath) cpSync(args[2]!, args[3]!, { recursive: true })
      callback(null)
    } catch (error) { callback(error as Error) }
  }) }
})

const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const tarball = Buffer.from('kokoro tarball bytes')
const files: Record<string, Buffer> = {
  'model.onnx': Buffer.from('model weights'),
  'voices.bin': Buffer.from('voice table'),
  'tokens.txt': Buffer.from('tokens'),
  'lexicon-zh.txt': Buffer.from('zh'),
  'lexicon-us-en.txt': Buffer.from('us'),
  'lexicon-gb-en.txt': Buffer.from('gb'),
  'date-zh.fst': Buffer.from('date'),
  'number-zh.fst': Buffer.from('number'),
  'phone-zh.fst': Buffer.from('phone'),
}
state.lock = JSON.stringify({
  tarball: { name: 'kokoro-multi-lang-v1_1.tar.bz2', url: 'https://example.invalid/kokoro.tar.bz2', sha256: digest(tarball), bytes: tarball.length },
  files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, { name, url: '', sha256: digest(bytes), bytes: bytes.length }])),
  espeak: { files: 2, bytes: 6 },
  dict: { files: 1, bytes: 3 },
  voices: { zf_001: 3, zm_009: 58 },
})

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { vi.unstubAllGlobals(); vi.clearAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })

/** One data root with a staged extraction source matching the pinned lock. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-speech-runtime-'))
  cleanup.push(async () => { await rm(root, { recursive: true, force: true }) })
  mkdirSync(join(root, 'models'), { recursive: true })
  const staged = await mkdtemp(join(tmpdir(), 'dsh-speech-staged-'))
  cleanup.push(async () => { await rm(staged, { recursive: true, force: true }) })
  const bundle = join(staged, 'kokoro-multi-lang-v1_1')
  mkdirSync(join(bundle, 'espeak-ng-data'), { recursive: true }); mkdirSync(join(bundle, 'dict'), { recursive: true })
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(bundle, name), bytes)
  writeFileSync(join(bundle, 'espeak-ng-data', 'one'), 'aaa'); writeFileSync(join(bundle, 'espeak-ng-data', 'two'), 'bbb')
  writeFileSync(join(bundle, 'dict', 'only'), 'xyz')
  state.stagedBundle = bundle
  return { root, bundle, config: Config({ dataRoot: root, modelOrigins: ['https://example.invalid/kokoro.tar.bz2'] }) }
}

function expectedPaths(bundleRoot: string): Omit<RuntimePaths, 'worker'> {
  return { model: join(bundleRoot, 'model.onnx'), voicesBin: join(bundleRoot, 'voices.bin'), tokens: join(bundleRoot, 'tokens.txt'),
    lexicons: [join(bundleRoot, 'lexicon-us-en.txt'), join(bundleRoot, 'lexicon-zh.txt'), join(bundleRoot, 'lexicon-gb-en.txt')],
    fst: [join(bundleRoot, 'date-zh.fst'), join(bundleRoot, 'number-zh.fst'), join(bundleRoot, 'phone-zh.fst')],
    espeakData: join(bundleRoot, 'espeak-ng-data'), dict: join(bundleRoot, 'dict') }
}

const signal = (): AbortSignal => new AbortController().signal
const workerPath = fileURLToPath(new URL('../src/worker.ts', import.meta.url))

it('reads the pinned voice order from the runtime lock', () => {
  expect(voiceCatalog()).toEqual({ zf_001: 3, zm_009: 58 })
})

it('accepts verified bundles and rejects corrupted, incomplete, or mismatched caches', async () => {
  const { root, config } = await fixture()
  const bundleRoot = join(root, 'models', 'kokoro-multi-lang-v1_1')
  mkdirSync(bundleRoot, { recursive: true })
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(bundleRoot, name), bytes)
  mkdirSync(join(bundleRoot, 'espeak-ng-data'), { recursive: true }); mkdirSync(join(bundleRoot, 'dict'), { recursive: true })
  writeFileSync(join(bundleRoot, 'espeak-ng-data', 'one'), 'aaa'); writeFileSync(join(bundleRoot, 'espeak-ng-data', 'two'), 'bbb')
  writeFileSync(join(bundleRoot, 'dict', 'only'), 'xyz')
  expect(await inspectRuntime(config, signal())).toEqual({ ...expectedPaths(join(root, 'models', 'kokoro-multi-lang-v1_1')), worker: workerPath })
  await writeFile(join(bundleRoot, 'model.onnx'), 'corrupted weights!')
  expect(await inspectRuntime(config, signal())).toBeUndefined()
  await writeFile(join(bundleRoot, 'model.onnx'), files['model.onnx']!)
  await rm(join(bundleRoot, 'tokens.txt'))
  expect(await inspectRuntime(config, signal())).toBeUndefined()
  await writeFile(join(bundleRoot, 'tokens.txt'), files['tokens.txt']!)
  await rm(join(bundleRoot, 'espeak-ng-data', 'two'))
  expect(await inspectRuntime(config, signal())).toBeUndefined()
  writeFileSync(join(bundleRoot, 'espeak-ng-data', 'two'), 'bbb')
  const explicit = Config(Object.assign({}, config, { modelDirectory: bundleRoot }))
  await writeFile(join(bundleRoot, 'model.onnx'), 'externally managed weights')
  expect(await inspectRuntime(explicit, signal())).toEqual({ ...expectedPaths(bundleRoot), worker: workerPath })
})

it('extracts a verified cached tarball without downloading', async () => {
  const { root, config } = await fixture()
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await writeFile(join(root, 'models', 'kokoro-multi-lang-v1_1.tar.bz2'), tarball)
  const phases: unknown[] = []
  const paths = await prepareRuntime(undefined as never, config, signal(), (report) => { phases.push(report) })
  expect(paths).toEqual({ ...expectedPaths(join(root, 'models', 'kokoro-multi-lang-v1_1')), worker: workerPath })
  expect(fetcher).not.toHaveBeenCalled()
  expect(phases).toContainEqual(expect.objectContaining({ phase: 'checking', step: 'model' }))
  expect(phases).toContainEqual(expect.objectContaining({ phase: 'checking', step: 'verify' }))
})

it('downloads, extracts, and verifies on demand', async () => {
  const { root, config } = await fixture()
  const fetcher = vi.fn(async () => new Response(tarball))
  vi.stubGlobal('fetch', fetcher)
  const paths = await prepareRuntime(undefined as never, config, signal())
  expect(paths).toEqual({ ...expectedPaths(join(root, 'models', 'kokoro-multi-lang-v1_1')), worker: workerPath })
  expect(fetcher).toHaveBeenCalledOnce()
  expect(await readFile(join(root, 'models', 'kokoro-multi-lang-v1_1.tar.bz2'))).toEqual(tarball)
  expect(await readdir(join(root, 'models', 'kokoro-multi-lang-v1_1'))).toContain('model.onnx')
})

it('fails loudly when extraction produces an unverified bundle', async () => {
  const { root, config, bundle } = await fixture()
  await writeFile(join(root, 'models', 'kokoro-multi-lang-v1_1.tar.bz2'), tarball)
  await writeFile(join(bundle, 'model.onnx'), 'corrupted weights!')
  await expect(prepareRuntime(undefined as never, config, signal())).rejects.toThrow('verification failed')
})

it('skips downloads and extraction for explicit model directories', async () => {
  const { config, bundle } = await fixture()
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const explicit = Config(Object.assign({}, config, { modelDirectory: bundle }))
  const paths = await prepareRuntime(undefined as never, explicit, signal())
  expect(paths).toEqual({ ...expectedPaths(bundle), worker: workerPath })
  expect(fetcher).not.toHaveBeenCalled()
  expect(await readdir(bundle)).toContain('model.onnx')
})
