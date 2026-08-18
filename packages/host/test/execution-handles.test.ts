import { describe, expect, it } from 'vitest'
import {
  ActiveCalls,
  HandleTable,
  PendingCalls,
  Subscriptions,
  protocolLimits,
} from '../src/execution/index.js'

const limits = protocolLimits({
  maxHandles: 4,
  maxIterators: 1,
  maxSubscriptions: 1,
  maxPendingCalls: 2,
  maxQueuedEvents: 2,
})

describe('handle table (generation-aware, cascade, idempotent release)', () => {
  it('allocates owner-prefixed ids, cascades release to children in reverse order and stays idempotent', async () => {
    const table = new HandleTable('w', 3, limits)
    const order: string[] = []
    const parent = table.allocate({
      kind: 'lease',
      target: {},
      release: () => void order.push('parent'),
      contract: 'x3.demo/a',
      major: 1,
    })
    const child1 = table.allocate({
      kind: 'lease',
      target: {},
      release: () => void order.push('child1'),
      parent: parent.id,
      contract: 'x3.demo/b',
      major: 1,
    })
    const child2 = table.allocate({
      kind: 'iterator',
      target: {},
      release: () => void order.push('child2'),
      parent: parent.id,
    })
    expect(parent.id).toBe('w3-1')
    expect(child1.id).toBe('w3-2')
    expect(child2.id).toBe('w3-3')
    expect(table.owns('w3-9')).toBe(true)
    expect(table.owns('h3-1')).toBe(false)
    expect(table.lookup('w3-2').state).toBe('live')
    const first = await table.release(parent.id)
    expect(first.released).toBe(true)
    expect(order).toEqual(['child2', 'child1', 'parent'])
    expect(table.lookup(parent.id)).toEqual({ state: 'released' })
    expect(table.lookup('w3-2')).toEqual({ state: 'released' })
    expect(table.lookup('w3-7')).toEqual({ state: 'unknown' })
    expect(table.lookup('w2-1')).toEqual({ state: 'foreign-generation' })
    expect(table.lookup('h3-1')).toEqual({ state: 'foreign-generation' })
    const second = await table.release(parent.id)
    expect(second.released).toBe(false)
    expect(table.counts()).toMatchObject({ live: 0, allocated: 3, releasedTotal: 3 })
  })

  it('enforces handle/iterator/subscription limits and refuses allocation after invalidation', async () => {
    const table = new HandleTable('h', 1, limits)
    table.allocate({ kind: 'iterator', target: {}, release: () => undefined })
    expect(() =>
      table.allocate({ kind: 'iterator', target: {}, release: () => undefined }),
    ).toThrow(/iterators limit 1/)
    table.allocate({ kind: 'events', target: {}, release: () => undefined })
    expect(() => table.allocate({ kind: 'events', target: {}, release: () => undefined })).toThrow(
      /events limit 1/,
    )
    table.allocate({
      kind: 'lease',
      target: {},
      release: () => undefined,
      contract: 'x3.demo/a',
      major: 1,
    })
    table.allocate({
      kind: 'lease',
      target: {},
      release: () => undefined,
      contract: 'x3.demo/a',
      major: 1,
    })
    expect(() => table.allocate({ kind: 'lease', target: {}, release: () => undefined })).toThrow(
      /handles limit 4/,
    )
    const failing = new HandleTable('h', 1, protocolLimits())
    failing.allocate({
      kind: 'lease',
      target: {},
      release: () => {
        throw new Error('release boom')
      },
    })
    failing.allocate({ kind: 'lease', target: {}, release: () => undefined })
    const result = await failing.invalidate()
    expect(result.released).toEqual(['h1-2', 'h1-1'])
    expect(result.failures).toHaveLength(1)
    expect(failing.isInvalidated).toBe(true)
    expect(() => failing.allocate({ kind: 'lease', target: {}, release: () => undefined })).toThrow(
      /invalidated/,
    )
  })
})

describe('pending calls (late-after-cancel, duplicate, unknown)', () => {
  it('distinguishes settled, late-after-cancel, duplicate and unknown replies', () => {
    const pending = new PendingCalls(limits)
    const outcomes: string[] = []
    const open = (id: number) =>
      pending.open({
        id,
        kind: 'call',
        resolve: () => void outcomes.push(`resolve${id}`),
        reject: () => void outcomes.push(`reject${id}`),
      })
    open(1)
    open(2)
    expect(() => open(3)).toThrow(/pending call limit 2/)
    expect(pending.settle(1, { kind: 'return', value: 1 })).toBe('settled')
    // a second reply for an id that existed is a duplicate; an id never opened is unknown
    expect(pending.settle(1, { kind: 'return', value: 1 })).toBe('duplicate')
    expect(pending.cancel(2)).toBeDefined()
    expect(pending.settle(2, { kind: 'return', value: 1 })).toBe('late-after-cancel')
    expect(pending.droppedLateReplies).toBe(1)
    expect(pending.settle(9, { kind: 'return', value: 1 })).toBe('unknown')
    open(3)
    expect(pending.failAll(new (class extends Error {})() as never)).toBe(1)
    expect(outcomes).toEqual(['resolve1', 'reject3'])
    expect(pending.size).toBe(0)
  })

  it('progress reaches only live calls', () => {
    const pending = new PendingCalls(protocolLimits())
    const seen: number[] = []
    pending.open({
      id: 1,
      kind: 'call',
      resolve: () => undefined,
      reject: () => undefined,
      onProgress: p => void seen.push(p.completed),
    })
    expect(pending.progress(1, { completed: 0.5 })).toBe('settled')
    pending.cancel(1)
    expect(pending.progress(1, { completed: 0.9 })).toBe('late-after-cancel')
    expect(pending.progress(2, { completed: 0.9 })).toBe('unknown')
    expect(seen).toEqual([0.5])
  })

  it('keeps cancelled calls within the pending limit until their terminal reply arrives', () => {
    const pending = new PendingCalls(protocolLimits({ maxPendingCalls: 2 }))
    const open = (id: number) =>
      pending.open({
        id,
        kind: 'call',
        resolve: () => undefined,
        reject: () => undefined,
      })
    open(1)
    open(2)
    pending.cancel(1)
    pending.cancel(2)
    expect(() => open(3)).toThrow(/pending call limit 2/)
    expect(pending.settle(1, { kind: 'return', value: undefined })).toBe('late-after-cancel')
    open(3)
    expect(pending.size).toBe(2)
  })
})

describe('active calls and subscriptions', () => {
  it('cancel aborts the executing call signal; cancelAll aborts everything', () => {
    const active = new ActiveCalls()
    const a = active.begin(1)
    const b = active.begin(2)
    expect(active.cancel(1)).toBe(true)
    expect(a.controller.signal.aborted).toBe(true)
    expect(active.cancel(7)).toBe(false)
    active.cancelAll()
    expect(b.controller.signal.aborted).toBe(true)
    expect(active.size).toBe(0)
  })

  it('bounds queued events, keeps a closed record until drained, refuses duplicates', () => {
    const subscriptions = new Subscriptions(limits)
    const record = subscriptions.register('ws1-1', 'w1-2')
    expect(() => subscriptions.register('ws1-1', 'w1-2')).toThrow(/already registered/)
    expect(() => subscriptions.register('ws1-2', 'w1-3')).toThrow(/subscription limit 1/)
    expect(subscriptions.push('ws1-1', 1)).toBe('queued')
    expect(subscriptions.push('ws1-1', 2)).toBe('queued')
    expect(subscriptions.push('ws1-1', 3)).toBe('overflow')
    expect(subscriptions.push('nope', 3)).toBe('unknown')
    subscriptions.close('ws1-1')
    expect(record.closed).toBe(true)
    expect(subscriptions.get('ws1-1')).toBe(record) // still there for the consumer to drain
    expect(subscriptions.push('ws1-1', 4)).toBe('unknown')
    expect(subscriptions.size).toBe(0)
    subscriptions.drop('ws1-1')
    expect(subscriptions.get('ws1-1')).toBeUndefined()
  })
})
