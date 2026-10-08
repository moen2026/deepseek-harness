/**
 * Parser and argument-layer behavior against recorded CLI captures: the pinned
 * entry resolution, print-mode argv composition, task flattening, and the
 * `--output-format=json` reply contract including its noisy-capture tolerance.
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QODER_PERMISSION_MODE,
  QODER_PERMISSION_MODES,
  parseQoderReply,
  qoderCommandArgv,
  qoderRunArgs,
  resolveQoderCliEntry,
  textTask,
} from '../src/cli.ts'
import { fixture } from './harness.ts'

describe('qoderCommandArgv', () => {
  it('resolves the pinned package-local entry and caches it', () => {
    const argv = qoderCommandArgv()
    expect(argv).toHaveLength(2)
    expect(argv[0]).toBe(process.execPath)
    expect(argv[1]).toMatch(/qodercli/i)
    expect(qoderCommandArgv()).toEqual(argv)
  })
})

describe('resolveQoderCliEntry', () => {
  it('resolves the declared binary against the manifest directory', () => {
    const manifest = fileURLToPath(new URL('./fixtures/manifest-pinned.json', import.meta.url))
    expect(resolveQoderCliEntry(manifest)).toBe(resolve(dirname(manifest), 'bundle/qodercli.js'))
  })

  it('rejects a manifest without a qodercli binary', () => {
    const manifest = fileURLToPath(new URL('./fixtures/manifest-no-qodercli.json', import.meta.url))
    expect(() => resolveQoderCliEntry(manifest)).toThrow('declares no qodercli binary')
  })
})

describe('qoderRunArgs', () => {
  it('composes the bare json print contract by default', () => {
    expect(qoderRunArgs({ permissionMode: DEFAULT_QODER_PERMISSION_MODE }))
      .toEqual(['--print', '--output-format', 'json'])
  })

  it('forwards the full deployment selection', () => {
    expect(qoderRunArgs({
      model: 'qoder-pro',
      maxTurns: 4,
      allowedTools: ['Read', 'Write'],
      disallowedTools: ['Bash'],
      permissionMode: 'bypass',
    })).toEqual([
      '--print', '--output-format', 'json',
      '--model', 'qoder-pro',
      '--max-turns', '4',
      '--allowed-tools=Read,Write',
      '--disallowed-tools=Bash',
      '--yolo',
    ])
  })

  it('omits empty tool lists', () => {
    expect(qoderRunArgs({ allowedTools: [], disallowedTools: [], permissionMode: 'default' }))
      .toEqual(['--print', '--output-format', 'json'])
  })
})

describe('textTask', () => {
  it('joins multiple text blocks into one task', () => {
    expect(textTask([
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
    ])).toBe('first\n\nsecond')
  })

  it('rejects an empty, blank, or non-text task', () => {
    expect(() => textTask([])).toThrow('only text blocks')
    expect(() => textTask([{ type: 'reasoning', text: 'planning' }])).toThrow('only text blocks')
    expect(() => textTask([{ type: 'text', text: '  \n ' }])).toThrow('must not be empty')
  })
})

describe('parseQoderReply', () => {
  it('reads the official success capture', () => {
    expect(parseQoderReply(fixture('print-json-success.json'))).toEqual({
      kind: 'result',
      text: 'ok',
      maxTokens: false,
    })
  })

  it('carries the token-ceiling stop reason', () => {
    expect(parseQoderReply(fixture('print-json-max-tokens.json'))).toEqual({
      kind: 'result',
      text: 'The refactor begins by extracting the shared option',
      maxTokens: true,
    })
  })

  it('classifies the recorded unauthenticated reply as a product error', () => {
    expect(parseQoderReply(fixture('print-json-not-logged-in.json')))
      .toEqual({ kind: 'product-error' })
  })

  it('tolerates Windows first-run setup noise before the reply object', () => {
    expect(parseQoderReply(fixture('print-json-noisy.txt'))).toEqual({
      kind: 'result',
      text: 'noise survived',
      maxTokens: false,
    })
  })

  it('reports plain-text crash output as unparsable', () => {
    expect(parseQoderReply(fixture('print-json-plain-text.txt')))
      .toEqual({ kind: 'unparsable' })
  })

  it('treats a product error without an answer as a product error', () => {
    expect(parseQoderReply('{"is_error":true}')).toEqual({ kind: 'product-error' })
  })

  it('rejects absent, blank, or non-text answers as unparsable', () => {
    expect(parseQoderReply('')).toEqual({ kind: 'unparsable' })
    expect(parseQoderReply('5')).toEqual({ kind: 'unparsable' })
    expect(parseQoderReply('{}')).toEqual({ kind: 'unparsable' })
    expect(parseQoderReply('{"result":"   "}')).toEqual({ kind: 'unparsable' })
    expect(parseQoderReply('{"result":5}')).toEqual({ kind: 'unparsable' })
    expect(parseQoderReply('{"result":null}')).toEqual({ kind: 'unparsable' })
    expect(parseQoderReply('{"result":[1,2]}')).toEqual({ kind: 'unparsable' })
  })

  it('accepts a bounded compatibility key when the official one is absent', () => {
    expect(parseQoderReply('{"content":[{"type":"text","text":"hi"}]}')).toEqual({
      kind: 'result',
      text: 'hi',
      maxTokens: false,
    })
  })

  it('ignores answers nested deeper than the compatibility bound', () => {
    let nested = '{"result":"deep"}'
    for (let depth = 0; depth < 18; depth += 1) nested = `{"result":${nested}}`
    expect(parseQoderReply(nested)).toEqual({ kind: 'unparsable' })
  })

  it('falls back to the outermost object window on noisy captures', () => {
    expect(parseQoderReply('warning: retrying\n{"result":"recovered"}\ntrailing')).toEqual({
      kind: 'result',
      text: 'recovered',
      maxTokens: false,
    })
    expect(parseQoderReply('{not json}')).toEqual({ kind: 'unparsable' })
  })
})

describe('Qoder permission modes', () => {
  it('exposes the default and the full mode list', () => {
    expect(DEFAULT_QODER_PERMISSION_MODE).toBe('default')
    expect(QODER_PERMISSION_MODES).toEqual(['default', 'bypass'])
  })
})
