/**
 * Outbound GitHub commenting for webhook-driven review Sessions: a
 * model-facing `github_comment` tool posts one Markdown comment on a GitHub
 * issue or pull request through the REST API, authenticating with a Bearer
 * token resolved from the credential seam. The plugin is opt-in — a
 * deployment mounts it next to the webhook rules that scope which
 * repositories a Session may touch — and a missing token credential answers
 * an actionable unavailable result instead of failing the Session.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-tool-github
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

/** Stable Loader identity. */
export const name = 'tool-github'

/** Services used to register the comment tool and resolve its token. */
export const inject = ['tools', 'credentials']

/** Deployment settings. Invalid values fail plugin load. */
export interface Config {
  /** Credential reference holding the GitHub API token (a PAT with pull request write access). */
  tokenEnv: string
  /** GitHub REST API root; override only for GitHub Enterprise Server (default `https://api.github.com`). */
  apiBaseUrl: string
  /** Per-request timeout in milliseconds (default 30 000). */
  timeoutMs: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  tokenEnv: z.string().role('credential-ref').required(),
  apiBaseUrl: z.string().default('https://api.github.com'),
  timeoutMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(30_000),
})

/** The outcome shape of `github_comment`. */
const COMMENT_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true, enum: ['ok', 'unavailable'] },
    commentUrl: { type: 'string' },
  },
} as const

/** GitHub's dated REST API version header. */
const GITHUB_API_VERSION = '2022-11-28'

/** Unavailable answer text naming the reference to configure. */
function unavailableText(tokenEnv: string): string {
  return `GitHub commenting is unavailable: the credential reference "${tokenEnv}" has no configured value. `
    + 'Set that credential to a GitHub personal access token with pull request write access, '
    + 'then call github_comment again.'
}

/**
 * Register the `github_comment` tool.
 * @param ctx - host context with `tools` and `credentials`.
 * @param config - validated deployment settings.
 */
export function apply(ctx: Context, config: Config): void {
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1) {
    throw new Error('tool-github requires a positive integer timeoutMs')
  }
  if (config.apiBaseUrl.length === 0) throw new Error('tool-github requires a non-empty apiBaseUrl')
  ctx.tools.register(defineTool({
    name: 'github_comment',
    description:
      'Post one Markdown comment on a GitHub issue or pull request through the GitHub REST API. '
      + 'repository is "owner/repo", number is the issue or pull request number, and body is the comment '
      + 'text (GitHub Flavored Markdown is supported). The deployment mounts this tool and its token '
      + 'credential explicitly; without a configured token the call returns an unavailable answer rather '
      + 'than an error. Posting is an external, visible side effect — confirm the comment content with '
      + 'the user when the governing workflow does not already mandate it.',
    parameters: {
      repository: { type: 'string', required: true, description: 'Repository as "owner/repo".' },
      number: { type: 'number', required: true, description: 'The issue or pull request number to comment on.' },
      body: {
        type: 'string',
        required: true,
        description: 'Markdown comment body (GitHub Flavored Markdown is supported).',
      },
    },
    output: {
      schema: COMMENT_OUTPUT_SCHEMA,
      render: (_args, value) => [
        {
          type: 'text',
          text: value.status === 'ok'
            ? `Comment posted: ${value.commentUrl ?? ''}`
            : unavailableText(config.tokenEnv),
        },
      ],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const repository = typeof args.repository === 'string' ? args.repository : undefined
      const number = typeof args.number === 'number' && Number.isInteger(args.number) && args.number > 0
        ? args.number
        : undefined
      const body = typeof args.body === 'string' && args.body.length > 0 ? args.body : undefined
      if (repository === undefined || number === undefined || body === undefined) {
        throw new Error('github_comment requires repository "owner/repo", a positive integer number, and a non-empty body')
      }
      const slash = repository.indexOf('/')
      if (slash <= 0 || slash === repository.length - 1 || repository.indexOf('/', slash + 1) !== -1) {
        throw new Error(`github_comment: "${repository}" is not an "owner/repo" repository name`)
      }
      const token = await ctx.credentials.resolve(credentialRef(config.tokenEnv))
      if (token === undefined) return { status: 'unavailable' as const }
      const owner = repository.slice(0, slash)
      const repo = repository.slice(slash + 1)
      const url = `${config.apiBaseUrl}/repos/${owner}/${repo}/issues/${String(number)}/comments`
      let response: Response
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${token.value}`,
            'content-type': 'application/json',
            'x-github-api-version': GITHUB_API_VERSION,
          },
          body: JSON.stringify({ body }),
          signal: AbortSignal.any([AbortSignal.timeout(config.timeoutMs), exec.signal]),
        })
      } catch (error: unknown) {
        throw new Error('github_comment: the GitHub API request failed', { cause: error })
      }
      if (!response.ok) {
        const excerpt = (await response.text()).trim().slice(0, 200)
        const detail = excerpt.length > 0 ? `: ${excerpt}` : ''
        throw new Error(`github_comment: GitHub API returned ${String(response.status)} ${response.statusText}${detail}`)
      }
      const payload = (await response.json()) as { html_url?: unknown }
      if (typeof payload.html_url !== 'string') {
        throw new Error('github_comment: the GitHub API response carries no comment html_url')
      }
      return { status: 'ok' as const, commentUrl: payload.html_url }
    },
    presentCall: args => ({
      card: 'generic' as const,
      kind: 'other' as const,
      title: typeof args.repository === 'string'
        ? `GitHub comment: ${args.repository}#${String(typeof args.number === 'number' ? args.number : '?')}`
        : 'GitHub comment',
    }),
  }))
}
