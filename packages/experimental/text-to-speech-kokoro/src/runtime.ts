/** Verified runtime assets and managed extraction for the local Kokoro synthesizer. */
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { access, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { SpeechPreparationState } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { Asset } from '@deepseek-ai/dsh-experimental-local-speech-runtime'
import { downloadAsset, matchesAsset, orderAssetSources, SpeechDownloadError } from '@deepseek-ai/dsh-experimental-local-speech-runtime'
import type { Config } from './config.ts'

interface RuntimeLock {
  tarball: Asset
  files: Record<string, Asset>
  espeak: { files: number; bytes: number }
  dict: { files: number; bytes: number }
  /** Voice id to speaker id, pinned to the extracted voices.bin order. */
  voices: Record<string, number>
}

/** Verified model files handed to the worker process. */
export interface InferencePaths {
  readonly model: string
  readonly voicesBin: string
  readonly tokens: string
  readonly lexicons: readonly string[]
  readonly fst: readonly string[]
  readonly espeakData: string
  readonly dict: string
}

/** Prepared model and process paths, private to the local provider. */
export interface RuntimePaths extends InferencePaths {
  readonly worker: string
}

const extract = promisify(execFile)

function resolveRuntime(config: Config) {
  const supported = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64']
  if (!supported.includes(`${process.platform}-${process.arch}`)) throw new Error(`Local speech is unavailable for ${process.platform}-${process.arch}`)
  const lock = JSON.parse(readFileSync(new URL('../runtime/assets.json', import.meta.url), 'utf8')) as RuntimeLock
  const bundleRoot = config.modelDirectory ?? join(config.dataRoot, 'models', 'kokoro-multi-lang-v1_1')
  const paths: RuntimePaths = {
    model: join(bundleRoot, 'model.onnx'), voicesBin: join(bundleRoot, 'voices.bin'), tokens: join(bundleRoot, 'tokens.txt'),
    lexicons: [join(bundleRoot, 'lexicon-us-en.txt'), join(bundleRoot, 'lexicon-zh.txt'), join(bundleRoot, 'lexicon-gb-en.txt')],
    fst: [join(bundleRoot, 'date-zh.fst'), join(bundleRoot, 'number-zh.fst'), join(bundleRoot, 'phone-zh.fst')],
    espeakData: config.espeakDataDir ?? join(bundleRoot, 'espeak-ng-data'),
    dict: join(bundleRoot, 'dict'),
    /* v8 ignore next -- built worker resolution is exercised by real Node and Electron process smokes */
    worker: fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url)),
  }
  return { lock, bundleRoot, paths }
}

async function directoryMatches(path: string, expected: { files: number; bytes: number }): Promise<boolean> {
  let info
  try { info = await stat(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
  if (!info.isDirectory()) return false
  const entries = await readdir(path, { recursive: true, withFileTypes: true })
  let bytes = 0
  let files = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    files++
    bytes += (await stat(join(entry.parentPath, entry.name))).size
  }
  return files === expected.files && bytes === expected.bytes
}

async function verifyRuntime(config: Config, bundleRoot: string, paths: RuntimePaths, lock: RuntimeLock,
  signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted()
  try {
    await Promise.all([...paths.lexicons, ...paths.fst, paths.model, paths.voicesBin, paths.tokens].map(path => access(path)))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
  if (!await directoryMatches(paths.espeakData, lock.espeak)) return false
  if (!await directoryMatches(paths.dict, lock.dict)) return false
  if (config.modelDirectory === undefined) {
    for (const [name, asset] of Object.entries(lock.files)) {
      if (name === 'LICENSE' || name === 'README.md') continue
      signal.throwIfAborted()
      if (!await matchesAsset(join(bundleRoot, name), asset, signal)) return false
    }
  }
  signal.throwIfAborted()
  return true
}

/**
 * Read the pinned voice catalog from the runtime lock.
 * @returns voice id to speaker id, as embedded in the verified voices.bin order.
 */
export function voiceCatalog(): Record<string, number> {
  return (JSON.parse(readFileSync(new URL('../runtime/assets.json', import.meta.url), 'utf8')) as RuntimeLock).voices
}

/**
 * Inspect existing models without downloading, writing files or starting the worker.
 * @param config - model paths and default voice.
 * @param signal - provider cancellation or inspection deadline.
 * @returns cached paths when the bundle exists and managed assets match their pinned size and hash; otherwise undefined.
 */
export async function inspectRuntime(config: Config, signal: AbortSignal): Promise<RuntimePaths | undefined> {
  const { lock, bundleRoot, paths } = resolveRuntime(config)
  return await verifyRuntime(config, bundleRoot, paths, lock, signal) ? paths : undefined
}

/**
 * Resolve the bundled native runtime and prepare the verified Kokoro bundle on demand.
 * @param _ctx - Host context owning the preparation task.
 * @param config - model paths and download source policy.
 * @param signal - preparation cancellation or deadline.
 * @param report - Host-owned progress publisher.
 * @returns verified model and worker paths.
 */
export async function prepareRuntime(_ctx: Context, config: Config, signal: AbortSignal,
  report: (state: SpeechPreparationState) => void = () => {}): Promise<RuntimePaths> {
  const { lock, bundleRoot, paths } = resolveRuntime(config)
  if (config.modelDirectory === undefined) {
    report({ phase: 'checking', step: 'model', startedAt: Date.now() })
    const tarball = join(config.dataRoot, 'models', lock.tarball.name)
    if (!await matchesAsset(tarball, lock.tarball, signal)) {
      const origins = config.modelOrigin === undefined ? config.modelOrigins : [config.modelOrigin]
      const urls = await orderAssetSources(origins, config.modelProbeTimeoutMs, signal)
      for (const [index, url] of urls.entries()) {
        try {
          await downloadAsset({ ...lock.tarball, url }, join(config.dataRoot, 'models'), signal, (state) => { report({ ...state, step: 'model' }) })
          break
        } catch (error) {
          if (signal.aborted || !(error instanceof SpeechDownloadError) || error.download.reason === 'storage'
            || error.download.reason === 'unknown' || index === urls.length - 1) throw error
        }
      }
    }
    await mkdir(dirname(bundleRoot), { recursive: true })
    await rm(bundleRoot, { recursive: true, force: true })
    const extractionRoot = await mkdtemp(join(tmpdir(), 'dsh-kokoro-'))
    try {
      await extract('tar', ['-xjf', tarball, '-C', extractionRoot])
      await extract(process.execPath, ['-e', 'require("node:fs").cpSync(process.argv[1], process.argv[2], { recursive: true })',
        join(extractionRoot, 'kokoro-multi-lang-v1_1'), bundleRoot])
    } finally {
      await rm(extractionRoot, { recursive: true, force: true })
    }
  }
  report({ phase: 'checking', step: 'verify', startedAt: Date.now() })
  if (!await verifyRuntime(config, bundleRoot, paths, lock, signal)) throw new Error('Speech model verification failed: missing or corrupted model files')
  return paths
}
