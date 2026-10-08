/** Profile defaults and explicit overrides for the shipped Browser entry. */
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import * as Browser from '@deepseek-ai/dsh-client-ui-sidebar-browser'
import { expect, it, onTestFinished } from 'vitest'

it.each([
  { profile: 'web', override: undefined, disabled: true },
  { profile: 'custom-web', override: undefined, disabled: true },
  { profile: undefined, override: undefined, disabled: true },
  { profile: 'desktop', override: undefined, disabled: false },
  { profile: 'web', override: false, disabled: false },
  { profile: 'desktop', override: true, disabled: true },
])('applies Browser availability for $profile with override $override', async ({ profile, override, disabled }) => {
  const rows = loadOverlayPatches('browser-defaults', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
    .flatMap(patch => patch.insert ?? []).filter(row => row.id === 'ui-sidebar-browser')
  expect(rows).toHaveLength(1)
  expect(rows[0]!.name).toBe('@deepseek-ai/dsh-client-ui-sidebar-browser')
  const configured = applyEntryPatches(rows, override === undefined ? [] : [{ id: 'ui-sidebar-browser', disabled: override }],
    (message) => { throw new Error(message) })
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  if (profile !== undefined) {
    ctx.provide('profileContext', {
      name: profile, dir: '/profile', patchPath: '/profile/cordis.patch.yml', installAnchor: '/profile/package.json',
      cwd: '/workspace', home: '/home', startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
    })
  }
  ctx.baseUrl = 'file:///'
  await ctx.plugin(Loader).await()
  // Keep the real companion in the source-plane loader without native package resolution.
  ctx.loader.builtins.browser = Browser
  await ctx.loader.root.update([{ ...configured[0]!, name: 'cordis:browser' }])
  await ctx.loader.await()
  const entry = ctx.loader.resolve('ui-sidebar-browser')
  expect(entry.disabled).toBe(disabled)
  expect(entry.fiber !== undefined).toBe(!disabled)
})

it.each([
  { profile: 'web', id: 'notification-web', disabled: false },
  { profile: 'desktop', id: 'notification-web', disabled: true },
  { profile: undefined, id: 'notification-web', disabled: false },
  { profile: 'web', id: 'notification-desktop', disabled: true },
  { profile: 'desktop', id: 'notification-desktop', disabled: false },
  { profile: undefined, id: 'notification-desktop', disabled: true },
])('applies $id availability for $profile', async ({ profile, id, disabled }) => {
  const rows = loadOverlayPatches('browser-defaults', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
    .flatMap(patch => patch.insert ?? []).filter(row => row.id === id)
  expect(rows).toHaveLength(1)
  expect(rows[0]!.name).toBe(`@deepseek-ai/dsh-${id}`)
  const configured = applyEntryPatches(rows, [], (message) => { throw new Error(message) })
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  if (profile !== undefined) {
    ctx.provide('profileContext', {
      name: profile, dir: '/profile', patchPath: '/profile/cordis.patch.yml', installAnchor: '/profile/package.json',
      cwd: '/workspace', home: '/home', startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
    })
  }
  ctx.baseUrl = 'file:///'
  await ctx.plugin(Loader).await()
  // Keep both provider rows in the source-plane loader without native package resolution.
  ctx.loader.builtins['notification-web'] = { apply: () => {} }
  ctx.loader.builtins['notification-desktop'] = { apply: () => {} }
  await ctx.loader.root.update([{ ...configured[0]!, name: `cordis:${id}` }])
  await ctx.loader.await()
  const entry = ctx.loader.resolve(id)
  expect(entry.disabled).toBe(disabled)
  expect(entry.fiber !== undefined).toBe(!disabled)
})
