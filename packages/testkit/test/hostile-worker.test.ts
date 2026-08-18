/**
 * Hostile-worker acceptance over real `worker_threads` (THREAT_MODEL_WORKER_BOUNDARY §4/§5).
 * Every fixture runs in its own thread with the isolation options of §2; the reference supervisor
 * reacts as the threat model prescribes; the assertions are the acceptance criteria acc-1…acc-5,
 * acc-8…acc-10 that any production supervisor (NXT-114) must reproduce.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { OperationCancelledError } from '@modkitx-x3/core'
import {
  CAPABILITY_OF,
  protocolLimits,
  type Endpoint,
  type RemoteCapability,
} from '@modkitx-x3/host/execution'
import {
  DEMO_LOAD_REQUEST,
  DEMO_SOURCE,
  DEMO_SURFACES,
  superviseFixtureWorker,
  type HostileWorkerFixtureId,
  type SupervisedWorker,
  type SuperviseOptions,
} from '@modkitx-x3/testkit'

const live: SupervisedWorker[] = []
let sessions = 0

function supervise(
  fixture: HostileWorkerFixtureId,
  options: Partial<SuperviseOptions> = {},
): SupervisedWorker {
  sessions += 1
  const supervised = superviseFixtureWorker(fixture, {
    session: `hostile-${sessions}`,
    generation: 1,
    surfaces: DEMO_SURFACES,
    limits: protocolLimits({ defaultCallDeadlineMs: 2_000 }),
    graceMs: 250,
    ...options,
  })
  live.push(supervised)
  return supervised
}

afterEach(async () => {
  for (const item of live.splice(0)) {
    await item.spawned.terminate().catch(() => undefined)
  }
})

async function openSession(
  endpoint: Endpoint,
): Promise<{ session: Record<string, unknown>; remote: RemoteCapability }> {
  const loaded = await endpoint.load(DEMO_LOAD_REQUEST)
  const created = await loaded.root.call('createCodec', [])
  if (created.kind !== 'lease') throw new Error('createCodec must lease')
  const codec = endpoint.materialize(created.remote)
  const session = await (codec['open'] as (i: unknown) => Promise<Record<string, unknown>>)({})
  const remote = (session as unknown as Record<symbol, RemoteCapability | undefined>)[CAPABILITY_OF]
  if (remote === undefined) throw new Error('materialized session must carry its remote')
  return { session, remote }
}

const drained = (endpoint: Endpoint) => {
  const c = endpoint.counters()
  return [c.pendingCalls, c.activeCalls, c.localHandles, c.remoteHandles, c.subscriptions]
}

const withinCode = async (promise: Promise<unknown>, code: string) => {
  await expect(promise).rejects.toMatchObject({ code })
}

describe('hostile workers — positive control across a real thread boundary', () => {
  it('demo-worker: load, callbacks into a host lease, transfer, iterate, events, cancel, close → exit 0', async () => {
    const s = supervise('demo-worker')
    const payload = new Uint8Array([10, 20, 30, 40])
    const source = s.endpoint.expose(
      {
        size: async () => 4,
        read: async (offset: number, length: number) => payload.slice(offset, offset + length),
      },
      DEMO_SOURCE,
    )
    const loaded = await s.endpoint.load(DEMO_LOAD_REQUEST)
    expect(loaded.exports).toEqual(['abiVersion', 'createCodec'])
    const created = await loaded.root.call('createCodec', [{}])
    if (created.kind !== 'lease') throw new Error('createCodec must lease')
    const codec = s.endpoint.materialize(created.remote)
    const probe = codec['probe'] as (r: unknown) => Promise<{ size: number; head: number[] }>
    expect(await probe({ source })).toEqual({
      codecId: 'x3.testkit/plain',
      confidence: 0.9,
      size: 4,
      head: [10, 20],
    })
    const session = await (codec['open'] as (i: unknown) => Promise<Record<string, unknown>>)({})
    const bytes = await (session['bytes'] as () => Promise<Uint8Array>)()
    expect([...bytes]).toEqual([9, 8, 7])
    const found: string[] = []
    for await (const item of await (
      session['search'] as (q: string) => Promise<AsyncIterable<string>>
    )('a'))
      found.push(item)
    expect(found).toEqual(['alpha', 'beta', 'gamma'])
    const seen: number[] = []
    for await (const event of await (
      session['events'] as () => Promise<AsyncIterable<{ tick: number }>>
    )())
      seen.push(event.tick)
    expect(seen).toEqual([0, 1, 2])
    const controller = new AbortController()
    const hanging = (session['hang'] as (i: unknown, sig?: AbortSignal) => Promise<unknown>)(
      {},
      controller.signal,
    )
    await new Promise(resolve => setTimeout(resolve, 20))
    controller.abort()
    await expect(hanging).rejects.toBeInstanceOf(OperationCancelledError)
    const end = await s.release('test finished')
    expect(end.kind).toBe('closed')
    expect(end.exit.code).toBe(0)
    expect(s.terminations).toEqual([])
    expect(drained(s.endpoint)).toEqual([0, 0, 0, 0, 0])
    expect(source.isReleased).toBe(true)
  }, 20_000)

  it('demo-worker: 8 MiB transfer both ways keeps bytes intact and detaches the sender', async () => {
    const s = supervise('demo-worker')
    const { session } = await openSession(s.endpoint)
    const size = 8 * 1024 * 1024 // well inside the default maxTransferBytes (64 MiB)
    const big = new Uint8Array(size)
    big.fill(0xab)
    big[0] = 1
    big[big.length - 1] = 2
    const back = await (session['echo'] as (v: unknown) => Promise<Uint8Array>)(big)
    expect(back.byteLength).toBe(size)
    expect(back[0]).toBe(1)
    expect(back[back.length - 1]).toBe(2)
    expect(back[size >> 1]).toBe(0xab)
    expect(big.byteLength).toBe(0) // detached: the buffer was transferred, not copied
    const checked = session['checked'] as (n: number) => Promise<number>
    const results = await Promise.all(Array.from({ length: 200 }, (_, i) => checked(i)))
    expect(results).toEqual(Array.from({ length: 200 }, (_, i) => i * 2))
    const end = await s.release('done')
    expect(end.kind).toBe('closed')
    expect(end.exit.code).toBe(0)
    expect(drained(s.endpoint)).toEqual([0, 0, 0, 0, 0])
  }, 30_000)

  it('release() is idempotent: every call resolves with the same end, one termination at most (acc-9)', async () => {
    const s = supervise('demo-worker')
    await openSession(s.endpoint)
    const [a, b, c] = await Promise.all([s.release('a'), s.release('b'), s.release('c')])
    const d = await s.release('d')
    expect(b).toBe(a)
    expect(c).toBe(a)
    expect(d).toBe(a)
    expect(a.kind).toBe('closed')
    expect(a.exit.code).toBe(0)
    expect(s.terminations).toEqual([])

    // a worker that ignores the terminate frame is killed exactly once, however often we ask
    const stubborn = supervise('ignore-terminate', { graceMs: 200 })
    await openSession(stubborn.endpoint)
    const [x, y, z] = await Promise.all([
      stubborn.release('x'),
      stubborn.release('y'),
      stubborn.release('z'),
    ])
    expect(y).toBe(x)
    expect(z).toBe(x)
    expect(x.kind).toBe('closed')
    expect(stubborn.terminations).toEqual(['terminate frame not honoured within 200 ms'])
  }, 25_000)
})

describe('hostile workers — crash and exit (T2/T14, acc-1, acc-2)', () => {
  it('exit-early: activation rejects with peer-exited, nothing stays behind (acc-1)', async () => {
    const s = supervise('exit-early')
    await withinCode(s.endpoint.load(DEMO_LOAD_REQUEST), 'x3.host/rpc-peer-exited')
    const end = await s.end
    expect(end.kind).toBe('peer-exited')
    expect(end.exit.code).toBe(3)
    expect(s.terminations).toEqual([])
    expect(s.endpoint.state).toBe('closed')
    expect(drained(s.endpoint)).toEqual([0, 0, 0, 0, 0])
  }, 15_000)

  it('exit-after-ready: an in-flight call rejects with peer-exited, host leases are released (acc-2)', async () => {
    const s = supervise('exit-after-ready')
    const source = s.endpoint.expose(
      { size: async () => 1, read: async () => new Uint8Array(1) },
      DEMO_SOURCE,
    )
    const { remote } = await openSession(s.endpoint)
    await withinCode(remote.call('hang', [{}]), 'x3.host/rpc-peer-exited')
    const end = await s.end
    expect(end).toMatchObject({ kind: 'peer-exited', exit: { code: 7 } })
    expect(source.isReleased).toBe(true)
    expect(drained(s.endpoint)).toEqual([0, 0, 0, 0, 0])
    await withinCode(remote.call('descriptor'), 'x3.host/rpc-endpoint-closed')
  }, 15_000)

  it('throw-uncaught: an uncaught error is an error + exit, seen by the host as a peer exit', async () => {
    const s = supervise('throw-uncaught')
    const { remote } = await openSession(s.endpoint)
    await withinCode(remote.call('hang', [{}]), 'x3.host/rpc-peer-exited')
    const end = await s.end
    expect(end.kind).toBe('peer-exited')
    expect(end.exit.error?.message).toContain('boom from the fixture')
    expect(end.exit.code).not.toBe(0)
  }, 15_000)
})

describe('hostile workers — hangs and the watchdog (T3/T13, acc-4)', () => {
  it('hang-sync: a dead event loop is ended by terminate() after deadline + grace', async () => {
    const s = supervise('hang-sync', { graceMs: 200 })
    const { remote } = await openSession(s.endpoint)
    const started = Date.now()
    await withinCode(
      s.watched(() => remote.call('hang', [{}], { deadlineMs: 100 })),
      'x3.host/rpc-deadline-exceeded',
    )
    const end = await s.end
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(s.terminations).toEqual(['cancel not honoured within 200 ms after a deadline'])
    expect(end.kind).toBe('peer-exited')
    expect(end.exit.code).toBe(1)
    expect(drained(s.endpoint)).toEqual([0, 0, 0, 0, 0])
  }, 15_000)

  it('hang-async: a live worker that ignores cancel is terminated after grace; one that honours it is not', async () => {
    const ignoring = supervise('hang-async', { graceMs: 200 })
    const a = await openSession(ignoring.endpoint)
    await withinCode(
      ignoring.watched(() => a.remote.call('hang', [{}], { deadlineMs: 100 })),
      'x3.host/rpc-deadline-exceeded',
    )
    expect((await ignoring.end).kind).toBe('peer-exited')
    expect(ignoring.terminations).toHaveLength(1)

    const honouring = supervise('hang-async', {
      graceMs: 400,
      fixtureOptions: { honourCancel: true },
    })
    const b = await openSession(honouring.endpoint)
    await withinCode(
      honouring.watched(() => b.remote.call('hang', [{}], { deadlineMs: 100 })),
      'x3.host/rpc-deadline-exceeded',
    )
    expect(honouring.terminations).toEqual([])
    expect(honouring.endpoint.state).toBe('open')
    expect(honouring.endpoint.counters().droppedLateReplies).toBe(1)
    const end = await honouring.release('done')
    expect(end).toMatchObject({ kind: 'closed', exit: { code: 0 } })
  }, 20_000)

  it('ignore-terminate: release() resolves within grace even when the worker keeps its port', async () => {
    const s = supervise('ignore-terminate', { graceMs: 200 })
    await openSession(s.endpoint)
    const started = Date.now()
    const end = await s.release('bye')
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(s.terminations).toEqual(['terminate frame not honoured within 200 ms'])
    expect(end.kind).toBe('closed')
    expect(end.exit.code).toBe(1)
    expect(drained(s.endpoint)).toEqual([0, 0, 0, 0, 0])
  }, 15_000)
})

describe('hostile workers — resource abuse (T4, acc-5)', () => {
  it('oom: a heap-limited worker dies with ERR_WORKER_OUT_OF_MEMORY; the host sees a peer exit', async () => {
    const s = supervise('oom', {
      resourceLimits: { maxOldGenerationSizeMb: 24, maxYoungGenerationSizeMb: 8 },
    })
    const { remote } = await openSession(s.endpoint)
    await withinCode(remote.call('hang', [{}], { deadlineMs: 20_000 }), 'x3.host/rpc-peer-exited')
    const end = await s.end
    expect(end.kind).toBe('peer-exited')
    expect((end.exit.error as { code?: string } | undefined)?.code).toBe('ERR_WORKER_OUT_OF_MEMORY')
    expect(s.terminations).toEqual([])
  }, 30_000)

  it('event-flood: a flood overflows the bounded consumer queue with a structured error; the endpoint stays open', async () => {
    const s = supervise('event-flood', {
      limits: protocolLimits({ defaultCallDeadlineMs: 2_000, maxQueuedEvents: 8 }),
      fixtureOptions: { count: 50_000 },
    })
    const { remote } = await openSession(s.endpoint)
    const outcome = await remote.call('events')
    if (outcome.kind !== 'events') throw new Error('events must produce an event stream')
    const iterator = outcome.events[Symbol.asyncIterator]()
    await iterator.next() // subscribes; the flood begins
    await new Promise(resolve => setTimeout(resolve, 100)) // slow consumer
    let error: unknown
    try {
      for (;;) {
        const step = await iterator.next()
        if (step.done) break
      }
    } catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({ code: 'x3.host/rpc-events-overflow' })
    expect(s.endpoint.state).toBe('open')
    expect(s.endpoint.counters().subscriptions).toBe(0)
    const end = await s.release('done')
    expect(end.kind).toBe('closed')
    expect(s.endpoint.counters().droppedEvents).toBeGreaterThanOrEqual(0)
  }, 30_000)

  it('noisy: a stdout/stderr flood is capped by the harness and flagged truncated (acc-10)', async () => {
    const cap = 16 * 1024
    const s = supervise('noisy', { outputCapBytes: cap })
    await openSession(s.endpoint)
    await new Promise(resolve => setTimeout(resolve, 200))
    const end = await s.release('done')
    expect(end.kind).toBe('closed')
    expect(s.spawned.output.stdout.length).toBeLessThanOrEqual(cap)
    expect(s.spawned.output.stderr.length).toBeLessThanOrEqual(cap)
    expect(s.spawned.output.truncated).toBe(true)
  }, 20_000)
})

describe('hostile workers — protocol violations fail closed and terminate (T1/T7/T8, acc-3)', () => {
  const violation = async (
    fixture: HostileWorkerFixtureId,
    fixtureOptions: Record<string, unknown>,
    code: string,
  ) => {
    const s = supervise(fixture, { fixtureOptions })
    const { remote } = await openSession(s.endpoint)
    // any interaction after `open` provokes the fixture; the descriptor call may or may not
    // settle before the endpoint fails
    void remote.call('descriptor').catch(() => undefined)
    const end = await s.end
    expect(end.kind, `${fixture} ${JSON.stringify(fixtureOptions)}`).toBe('violation')
    if (end.kind === 'violation') expect(end.violation.code).toBe(code)
    expect(s.terminations).toEqual([`protocol failure: ${code}`])
    expect(s.endpoint.state).toBe('failed')
    expect(drained(s.endpoint)).toEqual([0, 0, 0, 0, 0])
    // the failing endpoint also sends a `terminate` frame; a fixture that honours it exits 0 before
    // `worker.terminate()` (exit 1) lands — either way the worker is gone
    expect(s.spawned.exited).toBe(true)
    expect([0, 1]).toContain(end.exit.code)
    return s
  }

  it('proto-pollution: an own __proto__ key in a return value is a violation and never reaches Object.prototype', async () => {
    await violation('proto-pollution', {}, 'forbidden-key')
    expect((Object.prototype as { admin?: unknown }).admin).toBeUndefined()
    expect(({} as { admin?: unknown }).admin).toBeUndefined()
  }, 15_000)

  it('bad-values: NaN, partial views, shared buffers, deep nesting and unknown frame keys are violations', async () => {
    await violation('bad-values', { variant: 'nan' }, 'bad-value')
    await violation('bad-values', { variant: 'partial-view' }, 'partial-typed-array')
    await violation('bad-values', { variant: 'shared' }, 'shared-buffer')
    await violation('bad-values', { variant: 'deep' }, 'depth-exceeded')
    await violation('bad-values', { variant: 'unknown-frame-key' }, 'unknown-key')
  }, 40_000)

  it('wrong-session: forged session/domain are bad-envelope, any other generation is stale-generation', async () => {
    await violation('wrong-session', { variant: 'session' }, 'bad-envelope')
    await violation('wrong-session', { variant: 'domain' }, 'bad-envelope')
    await violation('wrong-session', { variant: 'generation' }, 'stale-generation')
    // a worker left over from before a restart speaks the *previous* generation (acc-8)
    await violation('wrong-session', { variant: 'previous-generation' }, 'stale-generation')
  }, 40_000)

  it('reply-games: duplicate, orphan and mistyped replies are violations; a late reply after cancel is only counted', async () => {
    await violation('reply-games', { variant: 'duplicate' }, 'duplicate-reply')
    await violation('reply-games', { variant: 'unknown-id' }, 'unknown-reply-target')
    await violation('reply-games', { variant: 'ready-for-call' }, 'unexpected-frame')

    const s = supervise('reply-games', {
      fixtureOptions: { variant: 'late-after-cancel' },
      graceMs: 400,
    })
    const { remote } = await openSession(s.endpoint)
    await withinCode(
      s.watched(() => remote.call('hang', [{}], { deadlineMs: 50 })),
      'x3.host/rpc-deadline-exceeded',
    )
    expect(s.terminations).toEqual([])
    expect(s.endpoint.state).toBe('open')
    expect(s.endpoint.counters().droppedLateReplies).toBe(1)
    const end = await s.release('done')
    expect(end).toMatchObject({ kind: 'closed', exit: { code: 0 } })
  }, 40_000)

  it('forged-handles: unknown or foreign-owner handles are violations; a released handle is a structured error', async () => {
    await violation('forged-handles', { variant: 'unknown' }, 'unknown-handle')
    await violation('forged-handles', { variant: 'foreign-owner' }, 'unknown-handle')

    const s = supervise('forged-handles', { fixtureOptions: { variant: 'released' } })
    const { session } = await openSession(s.endpoint)
    const echo = session['echo'] as (v: unknown) => Promise<unknown>
    const source = s.endpoint.expose(
      { size: async () => 1, read: async () => new Uint8Array(1) },
      DEMO_SOURCE,
    )
    expect(await echo(source)).toEqual({ seen: source.ref['@x3.handle'].id })
    await source.release()
    expect(await echo('forge')).toBe('forging')
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(await echo('forged-reply')).toBe('x3.host/rpc-released-handle')
    expect(s.endpoint.state).toBe('open')
    const end = await s.release('done')
    expect(end).toMatchObject({ kind: 'closed', exit: { code: 0 } })
  }, 30_000)
})

describe('hostile workers — a restart is a new endpoint and a new generation (acc-8)', () => {
  it('demo-worker: generation 2 serves the same session; handles from generation 1 do not travel', async () => {
    const first = supervise('demo-worker', { session: 'restart-1', generation: 1 })
    const before = await openSession(first.endpoint)
    expect(await before.remote.call('descriptor')).toMatchObject({ kind: 'value' })
    expect(await first.release('restarting')).toMatchObject({ kind: 'closed', exit: { code: 0 } })

    const second = supervise('demo-worker', { session: 'restart-1', generation: 2 })
    const after = await openSession(second.endpoint)
    expect(await after.remote.call('descriptor')).toMatchObject({
      kind: 'value',
      value: { id: 'demo', traits: ['content.text'] },
    })
    // the pre-restart remote belongs to the closed endpoint; it never reaches the new worker
    await withinCode(before.remote.call('descriptor'), 'x3.host/rpc-endpoint-closed')
    expect(first.endpoint.state).toBe('closed')
    expect(drained(first.endpoint)).toEqual([0, 0, 0, 0, 0])
    expect(await second.release('done')).toMatchObject({ kind: 'closed', exit: { code: 0 } })
    expect(drained(second.endpoint)).toEqual([0, 0, 0, 0, 0])
  }, 30_000)
})
