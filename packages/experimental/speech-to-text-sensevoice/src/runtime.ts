/** Verified runtime assets and managed command execution for local transcription. */
import { readFileSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { Config } from './config.ts'
import type { SpeechPreparationState } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import {
  downloadAsset, matchesAsset, orderModelSources, SpeechDownloadError, type Asset,
} from '@deepseek-ai/dsh-experimental-local-speech-runtime'

export type { Asset }

interface RuntimeLock {
  models: Record<Config['precision'], Asset>
  tokens: Asset
  vad: Asset
}

/** Prepared model and process paths, private to the local provider. */
export interface RuntimePaths {
  readonly model: string
  readonly tokens: string
  readonly vad: string
  readonly worker: string
}

function resolveRuntime(config: Config) {
  const supported = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64']
  if (!supported.includes(`${process.platform}-${process.arch}`)) throw new Error(`Local speech is unavailable for ${process.platform}-${process.arch}`)
  const lock = JSON.parse(readFileSync(new URL('../runtime/assets.json', import.meta.url), 'utf8')) as RuntimeLock
  const modelRoot = config.modelDirectory ?? join(config.dataRoot, 'models', 'sensevoice-onnx')
  const paths: RuntimePaths = {
    model: join(modelRoot, lock.models[config.precision].name), tokens: join(modelRoot, lock.tokens.name),
    vad: config.vadModelPath ?? join(config.dataRoot, 'models', 'silero', lock.vad.name),
    /* v8 ignore next -- built worker resolution is exercised by real Node and Electron process smokes */
    worker: fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url)),
  }
  return { lock, modelRoot, paths }
}

async function verifyRuntime(config: Config, paths: RuntimePaths, lock: RuntimeLock, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted()
  try { await Promise.all([paths.model, paths.tokens, paths.vad].map(path => access(path))) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
  const verified = [
    ...config.modelDirectory === undefined ? [[paths.model, lock.models[config.precision]], [paths.tokens, lock.tokens]] as const : [],
    ...config.vadModelPath === undefined ? [[paths.vad, lock.vad]] as const : [],
  ]
  for (const [path, asset] of verified) if (!await matchesAsset(path, asset, signal)) return false
  signal.throwIfAborted()
  return true
}

/**
 * Inspect existing models without downloading, writing files or starting the worker.
 * @param config - model paths and selected precision.
 * @param signal - provider cancellation or inspection deadline.
 * @returns cached paths when all files exist and managed assets match their pinned size and hash; otherwise undefined.
 */
export async function inspectRuntime(config: Config, signal: AbortSignal): Promise<RuntimePaths | undefined> {
  const { lock, paths } = resolveRuntime(config)
  return await verifyRuntime(config, paths, lock, signal) ? paths : undefined
}

/**
 * Resolve the bundled native runtime and prepare verified ONNX models on demand.
 * @param _ctx - Host context owning the preparation task.
 * @param config - model paths, precision, and download source policy.
 * @param signal - preparation cancellation or deadline.
 * @param report - Host-owned progress publisher.
 * @returns verified model and worker paths.
 */
export async function prepareRuntime(_ctx: Context, config: Config, signal: AbortSignal,
  report: (state: SpeechPreparationState) => void = () => {}): Promise<RuntimePaths> {
  const { lock, modelRoot, paths } = resolveRuntime(config)
  const download = async (asset: Asset, root: string, step: 'model' | 'vad'): Promise<void> => {
    if (await matchesAsset(join(root, asset.name), asset, signal)) return
    const origins = config.modelOrigin === undefined ? config.modelOrigins : [config.modelOrigin]
    const urls = await orderModelSources(asset.url, origins, config.modelProbeTimeoutMs, signal)
    for (const [index, url] of urls.entries()) {
      try {
        await downloadAsset({ ...asset, url }, root, signal, (state) => { report({ ...state, step }) })
        return
      } catch (error) {
        if (signal.aborted || !(error instanceof SpeechDownloadError) || error.download.reason === 'storage'
          || error.download.reason === 'unknown' || index === urls.length - 1) throw error
      }
    }
  }
  if (config.modelDirectory === undefined) {
    report({ phase: 'checking', step: 'model', startedAt: Date.now() })
    await download(lock.models[config.precision], modelRoot, 'model')
    await download(lock.tokens, modelRoot, 'model')
  }
  if (config.vadModelPath === undefined) {
    report({ phase: 'checking', step: 'vad', startedAt: Date.now() })
    await download(lock.vad, join(config.dataRoot, 'models', 'silero'), 'vad')
  }
  report({ phase: 'checking', step: 'verify', startedAt: Date.now() })
  if (!await verifyRuntime(config, paths, lock, signal)) throw new Error('Speech model verification failed: missing or corrupted model files')
  return paths
}
