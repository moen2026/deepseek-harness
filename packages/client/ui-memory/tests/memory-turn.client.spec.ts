import { describe, expect, it } from 'vitest'
import {
  MEMORY_WRITE_TOOL, memoryTurnDefinition, memoryWriteEntry, selectMemoryRemembered,
  type MemoryRemembered,
} from '../src/client/memory-turn.ts'

const call = { name: MEMORY_WRITE_TOOL, argsRaw: JSON.stringify({ text: '用户偏好深色主题', namespace: 'preference' }) }

function resultMessage(id: string): { isError?: boolean; content: { type: string; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify({ status: 'ok', id }) }] }
}

describe('memoryWriteEntry', () => {
  it('narrows a settled ok result with its call arguments', () => {
    const entry = memoryWriteEntry('call-1', resultMessage('mem-1'), call, 7)
    expect(entry).toEqual({ callId: 'call-1', seq: 7, id: 'mem-1', text: '用户偏好深色主题', namespace: 'preference' })
  })

  it('drops an unknown namespace instead of rendering it', () => {
    const call = { name: MEMORY_WRITE_TOOL, argsRaw: JSON.stringify({ text: 'fact', namespace: 'junk' }) }
    const entry = memoryWriteEntry('call-1', resultMessage('mem-1'), call, 7)
    expect(entry).toMatchObject({ id: 'mem-1' })
    expect(entry).not.toHaveProperty('namespace')
  })

  it('rejects a failed result, a non-ok status, and a missing identity', () => {
    expect(memoryWriteEntry('c', { isError: true, content: [{ type: 'text', text: '{}' }] }, call, 1)).toBeUndefined()
    const rejected = { content: [{ type: 'text', text: JSON.stringify({ status: 'rejected', findings: [] }) }] }
    expect(memoryWriteEntry('c', rejected, call, 1)).toBeUndefined()
    const noId = { content: [{ type: 'text', text: JSON.stringify({ status: 'ok' }) }] }
    expect(memoryWriteEntry('c', noId, call, 1)).toBeUndefined()
  })

  it('rejects malformed result JSON and a call without text arguments', () => {
    const truncated = { content: [{ type: 'text', text: '{"status":"ok"' }] }
    expect(memoryWriteEntry('c', truncated, call, 1)).toBeUndefined()
    expect(memoryWriteEntry('c', resultMessage('m'), { name: MEMORY_WRITE_TOOL, argsRaw: '{}' }, 1)).toBeUndefined()
  })
})

describe('selectMemoryRemembered', () => {
  const entry: MemoryRemembered = { callId: 'call-1', seq: 5, id: 'mem-1', text: '用户偏好深色主题' }
  const turn = { data: new Map([['memory-remembered', { remembered: [entry] }]]) } as never

  it('returns the Turn\'s writes', () => {
    expect(selectMemoryRemembered({ turn, seq: 9 })).toEqual({ remembered: [entry] })
  })

  it('excludes writes settled after the Turn tail bound', () => {
    expect(selectMemoryRemembered({ turn, seq: 4 })).toBeNull()
  })

  it('uses the Turn\'s recorded end over the owner sequence', () => {
    const boundedTurn = { data: new Map([['memory-remembered', { remembered: [entry] }]]), end: { seq: 6 } } as never
    expect(selectMemoryRemembered({ turn: boundedTurn, seq: 3 })).toEqual({ remembered: [entry] })
  })

  it('returns null for a Turn without writes', () => {
    expect(selectMemoryRemembered({ turn: { data: new Map() } as never, seq: 3 })).toBeNull()
  })
})

describe('memoryTurnDefinition', () => {
  type Event = Parameters<typeof memoryTurnDefinition.match>[0]
  const location = { kind: 'session' } as const
  const startEvent = { type: 'turn/start', data: { turn: 1 } } as unknown as Event
  const callEvent = { type: 'tool/call', data: { turn: 1, callId: 'call-1', name: MEMORY_WRITE_TOOL, arguments: call.argsRaw } } as unknown as Event
  const resultEvent = {
    type: 'tool/result',
    seq: 5,
    surfaceOp: 'append',
    data: { turn: 1, message: { source: { callId: 'call-1' }, isError: false, content: resultMessage('mem-1').content } },
  } as unknown as Event
  const otherCallEvent = { type: 'tool/call', data: { turn: 1, callId: 'call-2', name: 'bash', arguments: '{}' } } as unknown as Event

  it('accumulates memory_write results per Turn and publishes them against the turn location', () => {
    const match = (event: Event) => memoryTurnDefinition.match(event)
    expect(match(startEvent)).toEqual({ id: '1', role: 'start' })
    const state = memoryTurnDefinition.start(
      { state: undefined } as never,
      { event: startEvent, role: 'start', location },
      {} as never,
    )
    expect(match(otherCallEvent)).toEqual({ id: '1', role: 'update' })
    const afterOther = memoryTurnDefinition.update({ state } as never, { event: otherCallEvent, role: 'update', location })
    const afterCall = memoryTurnDefinition.update({ state: afterOther } as never, { event: callEvent, role: 'update', location })
    expect(match(resultEvent)).toEqual({ id: '1', role: 'update' })
    const settled = memoryTurnDefinition.update({ state: afterCall } as never, { event: resultEvent, role: 'update', location })
    expect(settled.remembered).toEqual([expect.objectContaining({ id: 'mem-1', text: '用户偏好深色主题' })])
    expect(memoryTurnDefinition.buildLocationData?.({ state: settled } as never, 'turn', null))
      .toEqual({ kind: 'turn', turn: 1, key: 'memory-remembered', value: { remembered: [expect.objectContaining({ id: 'mem-1' })] } })
  })
})
