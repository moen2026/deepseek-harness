import z from '@deepseek-ai/schemastery'

export const name = 'connector-inbound-rule'
export const inject = ['connector']

export const Config = z.object({
  provider: z.string().required(),
  workspacePath: z.string().required(),
  agentPreset: z.string().required(),
  permissionPreset: z.string().required(),
})

export function apply(ctx, config) {
  ctx.effect(() => ctx.connector.inbound({
    provider: config.provider,
    workspacePath: config.workspacePath,
    agentPreset: config.agentPreset,
    permissionPreset: config.permissionPreset,
  }))
}
