/**
 * Provider for the repo-wiki capability seam (`ctx.repoWiki`): generates Markdown
 * wiki pages from workspace source documents through a deployment-configured LLM
 * route, records each page's generation-time source fingerprint in its front
 * matter, and serves the seam's read routes from a plain directory of pages under
 * `<root>/.dsh/wiki/`.
 *
 * Generation and regeneration are the provider's private concern — the seam only
 * ever reads. A source whose fingerprint no longer matches its page's recorded
 * fingerprint makes the page read back as `stale` instead of triggering an
 * automatic rewrite, so a wiki never changes behind a reader's back.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-repo-wiki-generator
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Location attribution; readers preserve the page content without this producer.
     * @persistenceAttribution
     */
    'dsh-repo-wiki-generator': { kind: 'dsh-repo-wiki-generator' } & ContextFormed
  }
}
import { MAX_TIMER_DELAY_MS, deadline } from '@deepseek-ai/dsh-timeout'
import { RepoWikiError, normalizeWikiPath } from '@deepseek-ai/dsh-repo-wiki'
import type { RepoWikiProvider, WikiListing, WikiOutlineEntry, WikiPage, WikiPageSummary } from '@deepseek-ai/dsh-repo-wiki'
import {
  buildGenerationRequest,
  extractText,
  headingTitle,
  isStale,
  outlineHeadings,
  pageNameFor,
  parsePage,
  serializePage,
  sourceFingerprint,
} from './pages.ts'

export {
  buildGenerationRequest,
  headingTitle,
  isStale,
  outlineHeadings,
  pageNameFor,
  parsePage,
  serializePage,
  sourceFingerprint,
} from './pages.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'repo-wiki-generator'

/** Services required by this plugin. */
export const inject = ['repoWiki']

/** Directories the source walk never enters. */
const SKIP_DIRS = new Set(['.dsh', '.git', '.agents', 'coverage', 'dist', 'lib', 'node_modules'])

/** Provider identity presented to the seam. */
const PROVIDER_ID = 'fs-wiki'

/** The minimal LLM surface the generator consumes; structurally satisfied by ctx.llm. */
export interface WikiLlm {
  /** Stream one completion; the generator aggregates text deltas into the page body. */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

/** Plugin configuration: where sources live, where pages go, and the LLM route. */
export interface Config {
  /** Absolute workspace root the wiki describes and under which pages are stored. */
  root: string
  /** Wiki storage directory relative to `root` (default `.dsh/wiki`). */
  outDir?: string
  /** Glob patterns (`*` within a segment, `**` across segments) of source documents, relative to `root`. */
  sources?: string[]
  /** LLM provider name owning the generation route (required). */
  llmProvider: string
  /** LLM model name used for generation (required). */
  llmModel: string
  /** Largest source excerpt per generation call, in characters (default 24000). */
  maxSourceChars?: number
  /** Generation-call output budget in tokens (default 4096). */
  maxTokens?: number
  /** Per-call generation timeout budget in ms (default 300000). */
  timeoutMs?: number
  /** Whether `apply` kicks off one regeneration pass at startup (default `startup`). */
  regenerateAt?: 'startup' | 'never'
}

export const Config: z<Config> = z.object({
  root: z.string().required(),
  outDir: z.string().default('.dsh/wiki'),
  sources: z.array(z.string()).default(['docs/subsystems/*.md', 'packages/*/README.md', 'packages/*/*/README.md']),
  llmProvider: z.string().required(),
  llmModel: z.string().required(),
  maxSourceChars: z.number().default(24_000),
  maxTokens: z.number().default(4_096),
  timeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(300_000),
  regenerateAt: z.union(['startup', 'never'] as const).default('startup'),
})

type ResolvedConfig = Required<Config>

/** The outcome of one regeneration pass. */
export interface RegenerateOutcome {
  /** Pages freshly generated or rewritten from changed sources. */
  readonly generated: readonly string[]
  /** Pages whose recorded fingerprint still matches their source; left untouched. */
  readonly skipped: readonly string[]
  /** Pages removed because their source disappeared. */
  readonly removed: readonly string[]
}

/** Test whether one workspace-relative path matches a `*`/`**` glob pattern.
 * @param rel - the workspace-relative path under test.
 * @param pattern - the source glob pattern, `/`-separated.
 * @returns whether the path matches the pattern.
 */
export function matchesSourceGlob(rel: string, pattern: string): boolean {
  const segments = pattern.split('/')
  const regex = new RegExp(
    segments
      .map((segment, index) => {
        const literal = segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^/]+').replace(/\\\?/g, '[^/]')
        if (segment === '**') return index === segments.length - 1 ? '(?:[^/]+/)*[^/]+' : '(?:[^/]+/)*'
        return index === segments.length - 1 ? literal : `${literal}/`
      })
      .join('')
      .replace(/^/, '^')
      .concat('$'),
  )
  return regex.test(rel.replace(/\\/g, '/'))
}

/** Recursively collect `.md` files under `root` matching any source pattern.
 * @param root - the workspace root to walk.
 * @param patterns - the source glob patterns to match against.
 * @returns the matching workspace-relative paths, sorted.
 */
export function collectSources(root: string, patterns: readonly string[]): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(abs)
        continue
      }
      if (!entry.name.endsWith('.md')) continue
      const rel = relative(root, abs).replace(/\\/g, '/')
      if (patterns.some(pattern => matchesSourceGlob(rel, pattern))) found.push(rel)
    }
  }
  walk(root)
  return found.sort()
}

/**
 * The filesystem-backed repo-wiki provider. Pages are plain Markdown files with
 * a front matter recording their source path and generation-time fingerprint.
 */
export class FsWikiProvider implements RepoWikiProvider {
  readonly id = PROVIDER_ID

  private readonly root: string
  private readonly outDir: string
  private readonly sources: readonly string[]
  private readonly llm: WikiLlm
  private readonly route: { llmProvider: string; llmModel: string; maxSourceChars: number; maxTokens: number; timeoutMs: number }

  constructor(config: ResolvedConfig, llm: WikiLlm) {
    this.root = config.root
    this.outDir = resolve(config.root, config.outDir)
    this.sources = config.sources
    this.llm = llm
    this.route = {
      llmProvider: config.llmProvider, llmModel: config.llmModel, maxSourceChars: config.maxSourceChars,
      maxTokens: config.maxTokens, timeoutMs: config.timeoutMs,
    }
  }

  // oxlint-disable-next-line typescript/require-await -- the seam contract returns a Promise; the body is fully synchronous
  async getPage(path: string): Promise<WikiPage> {
    const normalized = normalizeWikiPath(path)
    const abs = resolve(this.outDir, normalized)
    if (!abs.startsWith(this.outDir) || !existsSync(abs)) {
      throw new RepoWikiError(`no wiki page at ${JSON.stringify(normalized)}`, 'REPO_WIKI_NOT_FOUND')
    }
    const content = readFileSync(abs, 'utf8')
    return { path: normalized, ...this.summarize(content), content }
  }

  // oxlint-disable-next-line typescript/require-await -- the seam contract returns a Promise; the body is fully synchronous
  async listPages(): Promise<WikiListing> {
    return { pages: this.listSummaries() }
  }

  // oxlint-disable-next-line typescript/require-await -- the seam contract returns a Promise; the body is fully synchronous
  async outline(): Promise<readonly WikiOutlineEntry[]> {
    return this.listSummaries().map((summary) => {
      const content = readFileSync(resolve(this.outDir, summary.path), 'utf8')
      return { ...summary, headings: outlineHeadings(parsePage(content).body) }
    })
  }

  /**
   * One regeneration pass: generate pages for new or changed sources, leave
   * matching pages untouched, and remove pages whose source disappeared.
   * @param signal - abort signal cancelling the in-flight generation call.
   * @returns the pass's outcome, partitioned into generated/skipped/removed pages.
   */
  async regenerate(signal?: AbortSignal): Promise<RegenerateOutcome> {
    const generated: string[] = []
    const skipped: string[] = []
    const removed: string[] = []
    mkdirSync(this.outDir, { recursive: true })

    const sources = collectSources(this.root, this.sources)
    const livePages = new Set<string>()
    for (const sourceRel of sources) {
      const pageName = pageNameFor(sourceRel)
      livePages.add(pageName)
      const current = sourceFingerprint(statSync(resolve(this.root, sourceRel)))
      const abs = resolve(this.outDir, pageName)
      if (existsSync(abs)) {
        const recorded = parsePage(readFileSync(abs, 'utf8'))
        if (recorded.source === sourceRel && !isStale(recorded.fingerprint, current)) {
          skipped.push(pageName)
          continue
        }
      }
      const body = await this.generatePage(sourceRel, readFileSync(resolve(this.root, sourceRel), 'utf8'), signal)
      writeFileSync(abs, serializePage(sourceRel, current, body), { encoding: 'utf8' })
      generated.push(pageName)
    }
    for (const pageName of readdirSync(this.outDir)) {
      if (!pageName.endsWith('.md') || livePages.has(pageName)) continue
      rmSync(resolve(this.outDir, pageName))
      removed.push(pageName)
    }
    return { generated, skipped, removed }
  }

  private async generatePage(sourceRel: string, sourceContent: string, signal?: AbortSignal): Promise<string> {
    const request = buildGenerationRequest(sourceRel, sourceContent, this.route.maxSourceChars)
    using callDeadline = deadline(signal, this.route.timeoutMs, 'REPO_WIKI_GENERATION_TIMEOUT')
    const options: GenerateOptions = {
      provider: this.route.llmProvider,
      model: this.route.llmModel,
      messages: [createUserMessage({ content: [{ type: 'text', text: request.text }], source: { kind: 'dsh-repo-wiki-generator' } })],
      system: request.system,
      maxTokens: this.route.maxTokens,
      signal: callDeadline.signal,
    }
    const assembler = new BlockAssembler()
    for await (const chunk of this.llm.stream(options)) {
      callDeadline.signal.throwIfAborted()
      assembler.push(chunk)
    }
    return extractText(assembler.blocks())
  }

  private listSummaries(): WikiPageSummary[] {
    if (!existsSync(this.outDir)) return []
    return readdirSync(this.outDir)
      .filter(entryName => entryName.endsWith('.md'))
      .sort()
      .map((pageName) => {
        const content = readFileSync(resolve(this.outDir, pageName), 'utf8')
        return { path: pageName, ...this.summarize(content) }
      })
  }

  /** Compute a page's title and staleness against its source's current fingerprint. */
  private summarize(content: string): { title: string; stale: boolean } {
    const parsed = parsePage(content)
    let stale = true
    if (parsed.source !== undefined && parsed.fingerprint !== undefined) {
      const abs = resolve(this.root, parsed.source)
      if (existsSync(abs)) {
        stale = isStale(parsed.fingerprint, sourceFingerprint(statSync(abs)))
      }
    }
    return { title: headingTitle(parsed.body), stale }
  }
}

/** Reject a non-positive-integer config value at load, so misconfiguration fails loud. */
function assertPositiveInteger(configName: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`repo-wiki-generator: ${configName} must be a positive integer`)
  }
}

/**
 * Register the filesystem repo-wiki provider against `ctx.repoWiki`.
 * @param ctx - the plugin context (must inject `repoWiki`).
 * @param config - the resolved plugin configuration; `llm` is read from the context.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveInteger('maxSourceChars', resolved.maxSourceChars)
  assertPositiveInteger('maxTokens', resolved.maxTokens)
  if (resolved.outDir.trim() === '') throw new Error('repo-wiki-generator: outDir must be a non-empty string')

  const provider = new FsWikiProvider(resolved, ctx.llm)
  const unregister = ctx.repoWiki.registerProvider(provider)
  ctx.effect(() => () => { unregister() }, 'repoWikiGenerator.provider')
  if (resolved.regenerateAt === 'startup') {
    void provider.regenerate().catch(() => undefined)
  }
}
