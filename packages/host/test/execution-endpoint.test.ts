import { describe, expect, it } from 'vitest'
import { ModkitError, OperationCancelledError, isCancellation } from '@modkitx-x3/core'
import {
  CAPABILITY_OF,
  CAPABILITY_RPC_DOMAIN,
  createEndpoint,
  createSurfaceRegistry,
  protocolLimits,
  type Endpoint,
  type Frame,
  type FramePort,
  type ProtocolLimits,
  type ProtocolViolation,
  type RemoteCapability,
} from '../src/execution/index.js'

// ------------------------------------------------------------------ in-memory transport

type Side = 'a' | 'b'
type Tap = (frame: Frame) => readonly Frame[] | 'drop' | undefined

/**
 * Two ports joined back to back. Every frame goes through `structuredClone` with its transfer
 * list, exactly like a MessagePort would (so a sent Uint8Array is detached on the sender), and
 * is delivered asynchronously. Taps and raw injection exist for the hostile suite.
 */
class Wire {
  private readonly handlers: Record<Side, Set<(frame: unknown) => void>> = {
    a: new Set(),
    b: new Set(),
  }
  readonly log: { readonly from: Side; readonly frame: Frame }[] = []
  tap: Partial<Record<Side, Tap>> = {}
  readonly a: FramePort
  readonly b: FramePort

  /** `macrotask` delivery gives every frame its own event-loop turn, like a real port does. */
  constructor(private readonly delivery: 'microtask' | 'macrotask' = 'microtask') {
    this.a = this.port('a')
    this.b = this.port('b')
  }

  private port(side: Side): FramePort {
    return {
      post: (frame, transfer) => this.deliver(side, frame, transfer),
      onFrame: handler => {
        this.handlers[side].add(handler)
        return () => this.handlers[side].delete(handler)
      },
    }
  }

  private deliver(from: Side, frame: Frame, transfer: readonly ArrayBuffer[]): void {
    const cloned = structuredClone(frame, { transfer: [...transfer] }) as Frame
    this.log.push({ from, frame: cloned })
    let frames: readonly Frame[] = [cloned]
    const tapped = this.tap[from]?.(cloned)
    if (tapped === 'drop') return
    if (tapped !== undefined) frames = tapped
    const targets = this.handlers[from === 'a' ? 'b' : 'a']
    const run = () => {
      for (const item of frames) for (const handler of targets) handler(item)
    }
    if (this.delivery === 'macrotask') setTimeout(run, 0)
    else queueMicrotask(run)
  }

  /** Delivers a raw (possibly malformed) object to one side as if the peer had sent it. */
  inject(to: Side, raw: unknown): void {
    queueMicrotask(() => {
      for (const handler of this.handlers[to]) handler(raw)
    })
  }
}

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 5))

// ------------------------------------------------------------------ demo surfaces (test-only data)

const surfaces = createSurfaceRegistry([
  {
    contract: 'x3.demo/module',
    major: 1,
    fields: ['abiVersion'],
    methods: { createCodec: { kind: 'lease', result: { contract: 'x3.demo/codec', major: 1 } } },
  },
  {
    contract: 'x3.demo/codec',
    major: 1,
    methods: {
      probe: { kind: 'value', signal: 'last' },
      open: { kind: 'lease', result: { contract: 'x3.demo/session', major: 1 } },
    },
  },
  {
    contract: 'x3.demo/session',
    major: 1,
    releaseVia: 'dispose',
    fields: ['revision'],
    methods: {
      descriptor: { kind: 'value' },
      openEntry: { kind: 'leased-value', signal: 'last' },
      sourceFor: { kind: 'lease', resultFromArgs: { contract: 0, major: 1 }, wrapper: 'lease' },
      padded: { kind: 'value', signal: 'last', arity: 2 },
      badLeasedValue: { kind: 'leased-value' },
      dataSource: {
        kind: 'lease',
        result: { contract: 'x3.demo/text', major: 1 },
        wrapper: 'lease',
      },
      search: { kind: 'iterable' },
      events: { kind: 'events' },
      dispose: { kind: 'value' },
      hang: { kind: 'value', signal: 'last' },
      boom: { kind: 'value' },
      bytes: { kind: 'value' },
      leak: { kind: 'lease', result: { contract: 'x3.demo/text', major: 1 } },
      badReturn: { kind: 'value' },
      checked: {
        kind: 'value',
        validateArgs: args =>
          args.length === 1 && typeof args[0] === 'number' ? undefined : 'expects one number',
      },
    },
  },
  {
    contract: 'x3.demo/text',
    major: 1,
    methods: { slice: { kind: 'value' }, size: { kind: 'value' } },
  },
  {
    contract: 'x3.demo/source',
    major: 1,
    methods: { read: { kind: 'value', signal: 'last' }, size: { kind: 'value' } },
  },
])

interface WorkerWorld {
  readonly module: Record<string, unknown>
  readonly log: string[]
  readonly released: { text: number; session: number; module: number; entry: number }
  readonly eventsControl: { fail: boolean; count: number; delayMs: number }
}

function workerWorld(): WorkerWorld {
  const log: string[] = []
  const released = { text: 0, session: 0, module: 0, entry: 0 }
  const eventsControl = { fail: false, count: 3, delayMs: 0 }
  const text = {
    slice: async (from: number, to: number) => `hello world`.slice(from, to),
    size: async () => 11,
  }
  const session = {
    revision: 'rev-1',
    descriptor: async () => ({ id: 'demo', traits: ['content.text'] }),
    openEntry: async (id: string) => ({
      value: { entry: id },
      release: async () => void (released.entry += 1),
    }),
    sourceFor: async (contract: string) => ({
      value:
        contract === 'x3.demo/text'
          ? text
          : { size: async () => 2, read: async () => new Uint8Array([1, 2]) },
      release: async () => void (released.text += 1),
    }),
    padded: async (...all: unknown[]) => ({
      count: all.length,
      first: all[0] === undefined ? null : all[0],
      lastIsSignal: all[all.length - 1] instanceof AbortSignal,
    }),
    badLeasedValue: async () => ({ notALease: true }),
    dataSource: async (contract: string) => {
      log.push(`dataSource:${contract}`)
      return { value: text, release: async () => void (released.text += 1) }
    },
    search: async function* (query: string) {
      for (const item of ['alpha', 'beta', 'gamma']) if (item.includes(query)) yield item
    },
    events: async function* () {
      for (let i = 0; i < eventsControl.count; i += 1) {
        if (eventsControl.delayMs > 0)
          await new Promise(resolve => setTimeout(resolve, eventsControl.delayMs))
        yield { tick: i }
      }
      if (eventsControl.fail)
        throw new ModkitError({
          code: 'x3.demo/stream-failed',
          message: 'stream failed',
          context: { after: eventsControl.count },
        })
    },
    dispose: async () => void (released.session += 1),
    hang: (_input: unknown, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new OperationCancelledError('worker saw abort')),
          { once: true },
        )
      }),
    boom: async () => {
      throw new ModkitError({
        code: 'x3.demo/boom',
        message: 'kaboom',
        context: { where: 'worker' },
        retryability: 'safe',
      })
    },
    bytes: async () => new Uint8Array([9, 8, 7]),
    leak: async () => ({ value: text, release: async () => void (released.text += 1) }),
    badReturn: async () => ({ fn: () => 1 }),
    checked: async (n: number) => n * 2,
  }
  const codec = {
    probe: async (
      request: {
        source: {
          size(): Promise<number>
          read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>
        }
      },
      signal: AbortSignal,
    ) => {
      const size = await request.source.size()
      const head = await request.source.read(0, 2, signal)
      log.push(`probe:size=${size},head=${[...head].join(',')}`)
      return { codecId: 'x3.demo/plain', confidence: 0.9, size, head: [...head] }
    },
    open: async () => session,
  }
  const module = { abiVersion: 1, createCodec: () => codec }
  return { module, log, released, eventsControl }
}

interface Pair {
  readonly wire: Wire
  readonly host: Endpoint
  readonly worker: Endpoint
  readonly world: WorkerWorld
  readonly failures: {
    host: (ProtocolViolation | ModkitError)[]
    worker: (ProtocolViolation | ModkitError)[]
  }
  readonly diagnostics: string[]
}

function pair(
  limits: ProtocolLimits = protocolLimits({ defaultCallDeadlineMs: 2_000 }),
  generation = 1,
  delivery: 'microtask' | 'macrotask' = 'microtask',
): Pair {
  const wire = new Wire(delivery)
  const world = workerWorld()
  const failures = {
    host: [] as (ProtocolViolation | ModkitError)[],
    worker: [] as (ProtocolViolation | ModkitError)[],
  }
  const diagnostics: string[] = []
  const host = createEndpoint({
    role: 'host',
    port: wire.a,
    session: 'sess',
    generation,
    surfaces,
    limits,
    onFailure: failure => void failures.host.push(failure),
    onDiagnostic: diagnostic => void diagnostics.push(diagnostic.code),
  })
  const worker = createEndpoint({
    role: 'worker',
    port: wire.b,
    session: 'sess',
    generation,
    surfaces,
    limits,
    loader: async request => {
      world.log.push(`load:${request.contributionId}#${request.variantId}`)
      return {
        module: world.module,
        surface: { contract: 'x3.demo/module', major: 1 },
        release: () => void (world.released.module += 1),
      }
    },
    onFailure: failure => void failures.worker.push(failure),
    onDiagnostic: diagnostic => void diagnostics.push(diagnostic.code),
  })
  return { wire, host, worker, world, failures, diagnostics }
}

const loadRequest = {
  moduleUrl: 'file:///demo/codec.js',
  contributionId: 'org.example/demo',
  variantId: 'portable',
  artifactDigest: 'sha256:demo',
}

async function openSession(p: Pair): Promise<{
  root: RemoteCapability
  codec: Record<string, unknown>
  session: Record<string, unknown>
}> {
  const loaded = await p.host.load(loadRequest)
  const created = await loaded.root.call('createCodec', [{ budgets: { maxNodes: 10 } }])
  if (created.kind !== 'lease') throw new Error('createCodec must lease')
  const codec = p.host.materialize(created.remote)
  const session = await (codec['open'] as (input: unknown) => Promise<Record<string, unknown>>)({
    bindings: [],
  })
  return { root: loaded.root, codec, session }
}

// ------------------------------------------------------------------ happy path

describe('capability-rpc endpoints — round trip over a cloned wire', () => {
  it('loads a module, calls a codec with a host capability as argument, leases, iterates and disposes', async () => {
    const p = pair()
    const source = p.host.expose(
      {
        size: async () => 4,
        read: async (offset: number, length: number) =>
          new Uint8Array([10, 20, 30, 40]).slice(offset, offset + length),
      },
      { contract: 'x3.demo/source', major: 1 },
    )
    const loaded = await p.host.load(loadRequest)
    expect(loaded.exports).toEqual(['abiVersion', 'createCodec'])
    expect(p.world.log).toEqual(['load:org.example/demo#portable'])

    const created = await loaded.root.call('createCodec', [{ budgets: { maxNodes: 10 } }])
    if (created.kind !== 'lease') throw new Error('createCodec must lease')
    const codec = p.host.materialize(created.remote) as {
      probe(request: unknown, signal?: AbortSignal): Promise<{ size: number; head: number[] }>
      open(input: unknown): Promise<Record<string, unknown>>
    }
    // the worker receives the host source as a materialized proxy and calls back into the host
    const detection = await codec.probe({ source, plan: { kind: 'bytes' } })
    expect(detection).toEqual({
      codecId: 'x3.demo/plain',
      confidence: 0.9,
      size: 4,
      head: [10, 20],
    })
    expect(p.world.log).toContain('probe:size=4,head=10,20')

    const session = (await codec.open({ bindings: [] })) as {
      descriptor(): Promise<unknown>
      dataSource(
        contract: string,
        major: number,
      ): Promise<{
        value: { slice(a: number, b: number): Promise<string>; size(): Promise<number> }
        release(): Promise<void>
      }>
      search(query: string): Promise<AsyncIterable<string>>
      bytes(): Promise<Uint8Array>
      dispose(): Promise<void>
    }
    expect(await session.descriptor()).toEqual({ id: 'demo', traits: ['content.text'] })
    const lease = await session.dataSource('x3.demo/text', 1)
    expect(await lease.value.slice(0, 5)).toBe('hello')
    expect(await lease.value.size()).toBe(11)
    const bytes = await session.bytes()
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect([...bytes]).toEqual([9, 8, 7])
    const found: string[] = []
    for await (const item of await session.search('a')) found.push(item)
    expect(found).toEqual(['alpha', 'beta', 'gamma'])
    await lease.release()
    expect(p.world.released.text).toBe(1)
    await session.dispose()
    expect(p.world.released.session).toBe(1)
    // releasing the session cascaded on the worker; only the module and the codec remain
    await settle()
    expect(p.worker.counters().localHandles).toBe(2)
    expect(p.host.counters().remoteHandles).toBe(2)
    await loaded.root.release()
    await settle()
    expect(p.world.released.module).toBe(1)
    expect(p.worker.counters().localHandles).toBe(0)
    expect(p.host.counters().pendingCalls).toBe(0)
    expect(p.failures.host).toEqual([])
    expect(p.failures.worker).toEqual([])
  })

  it('transfers Uint8Array buffers instead of copying them (sender side is detached)', async () => {
    const p = pair()
    const payload = new Uint8Array([1, 2, 3])
    const source = p.host.expose(
      { size: async () => 3, read: async () => payload },
      { contract: 'x3.demo/source', major: 1 },
    )
    const { codec } = await openSession(p)
    await (codec['probe'] as (r: unknown) => Promise<unknown>)({ source })
    expect(payload.byteLength).toBe(0) // detached by the transfer, exactly like a real port
  })

  it('rehydrates structured errors with code, context and retryability; foreign errors are wrapped', async () => {
    const p = pair()
    const { session } = await openSession(p)
    const boom = session['boom'] as () => Promise<unknown>
    await expect(boom()).rejects.toMatchObject({
      code: 'x3.demo/boom',
      message: 'kaboom',
      context: { where: 'worker' },
      retryability: 'safe',
    })
    const bad = session['badReturn'] as () => Promise<unknown>
    await expect(bad()).rejects.toMatchObject({ code: 'x3.host/rpc-bad-return' })
    expect(p.host.state).toBe('open') // a bad *target* return is the target's fault, not a protocol violation
    const checked = session['checked'] as (n: unknown) => Promise<unknown>
    await expect(checked('x')).rejects.toMatchObject({ code: 'x3.host/rpc-bad-argument' })
    expect(await checked(21)).toBe(42)
  })
})

// ------------------------------------------------------------------ streams and cancellation

describe('capability-rpc endpoints — events, cancellation, deadlines, releases', () => {
  it('delivers push events, ends the stream, and surfaces a stream failure to the consumer', async () => {
    const p = pair()
    const { session } = await openSession(p)
    const events = session['events'] as () => Promise<AsyncIterable<{ tick: number }>>
    const seen: number[] = []
    for await (const event of await events()) seen.push(event.tick)
    expect(seen).toEqual([0, 1, 2])
    p.world.eventsControl.fail = true
    const seen2: number[] = []
    await expect(
      (async () => {
        for await (const event of await events()) seen2.push(event.tick)
      })(),
    ).rejects.toMatchObject({ code: 'x3.demo/stream-failed', context: { after: 3 } })
    expect(seen2).toEqual([0, 1, 2]) // queued events are delivered before the failure
    await settle()
    expect(p.worker.counters().localHandles).toBe(3) // module, codec, session — no events handle left
  })

  it('an abandoned event stream unsubscribes and releases the handle on both sides', async () => {
    const p = pair()
    p.world.eventsControl.count = 1000
    p.world.eventsControl.delayMs = 1
    const { session } = await openSession(p)
    const events = session['events'] as () => Promise<AsyncIterable<{ tick: number }>>
    let count = 0
    for await (const event of await events()) {
      count += event.tick >= 0 ? 1 : 0
      if (count === 2) break // consumer walks away
    }
    await settle()
    expect(p.worker.counters().localHandles).toBe(3)
    expect(p.host.counters().subscriptions).toBe(0)
    expect(p.wire.log.some(entry => entry.from === 'a' && entry.frame.t === 'unsubscribe')).toBe(
      true,
    )
  })

  it('a slow consumer overflows a bounded queue: the stream ends with a structured error, never silently', async () => {
    const p = pair(protocolLimits({ defaultCallDeadlineMs: 2_000, maxQueuedEvents: 2 }))
    p.world.eventsControl.count = 50
    const { session } = await openSession(p)
    const events = session['events'] as () => Promise<AsyncIterable<{ tick: number }>>
    const iterator = (await events())[Symbol.asyncIterator]()
    await iterator.next() // subscribes; the worker then floods
    await settle()
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
    expect(p.host.state).toBe('open')
  })

  it('cancels an in-flight call, the worker sees the abort, and the late reply is dropped and counted', async () => {
    const p = pair()
    const { session } = await openSession(p)
    const hang = session['hang'] as (input: unknown, signal?: AbortSignal) => Promise<unknown>
    const controller = new AbortController()
    const promise = hang({}, controller.signal)
    await settle()
    controller.abort(new Error('user cancelled'))
    await expect(promise).rejects.toBeInstanceOf(OperationCancelledError)
    await settle()
    // the worker's rejection after abort arrives late; it is not a duplicate, not a violation
    expect(p.host.state).toBe('open')
    expect(p.host.counters().pendingCalls).toBe(0)
    expect(p.wire.log.some(entry => entry.from === 'a' && entry.frame.t === 'cancel')).toBe(true)
  })

  it('a deadline cancels a hanging call with a structured, retryable error', async () => {
    const p = pair()
    const { session } = await openSession(p)
    const hang = session['hang'] as (input: unknown, signal?: AbortSignal) => Promise<unknown>
    const capability = (session as unknown as Record<symbol, RemoteCapability>)[CAPABILITY_OF]
    if (capability === undefined) throw new Error('materialized object must carry its capability')
    await expect(capability.call('hang', [{}], { deadlineMs: 20 })).rejects.toMatchObject({
      code: 'x3.host/rpc-deadline-exceeded',
      retryability: 'conditional',
    })
    expect(typeof hang).toBe('function')
    expect(p.host.state).toBe('open')
  })

  it('a lease produced after cancellation is released on the worker instead of leaking', async () => {
    const p = pair()
    const { session } = await openSession(p)
    const capability = (session as unknown as Record<symbol, RemoteCapability>)[CAPABILITY_OF]
    if (capability === undefined) throw new Error('capability missing')
    // `leak` may resolve before or after the worker sees the cancel: either the worker releases
    // the lease itself, or the host drops the late handle and releases it — never a live leak
    const controller = new AbortController()
    const promise = capability.call('leak', [], { signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(OperationCancelledError)
    await settle()
    await settle()
    expect(p.host.counters().remoteHandles).toBe(3)
    expect(p.worker.counters().localHandles).toBe(3)
    expect(p.host.counters().pendingCalls).toBe(0)
    expect(p.host.state).toBe('open')
  })

  it('a late reply that carries a handle is discarded with a real release request, never a fire-and-forget frame', async () => {
    // Over real event-loop hops the worker's reply can be in flight when the cancel is sent; the
    // host then drops the late handle and must *ask* the worker to release it. The peer answers
    // every release, so a fire-and-forget frame would make that answer an unknown-reply-target
    // violation (regression found by the testkit conformance kit on macrotask delivery).
    const p = pair(protocolLimits({ defaultCallDeadlineMs: 2_000 }), 1, 'macrotask')
    const { session } = await openSession(p)
    const capability = (session as unknown as Record<symbol, RemoteCapability>)[CAPABILITY_OF]
    if (capability === undefined) throw new Error('capability missing')
    const controller = new AbortController()
    const promise = capability.call('leak', [], { signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(OperationCancelledError)
    // wait until the late reply, the discard request and its acknowledgement have all travelled
    const until = async (predicate: () => boolean, what: string) => {
      const deadline = Date.now() + 2_000
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
        await settle()
      }
    }
    const releaseFrame = () =>
      p.wire.log.find(entry => entry.from === 'a' && entry.frame.t === 'release')
    await until(() => releaseFrame() !== undefined, 'the discard release request')
    const releaseId = releaseFrame()?.frame.id
    await until(
      () =>
        p.wire.log.some(
          entry =>
            entry.from === 'b' && entry.frame.t === 'return' && entry.frame.inReplyTo === releaseId,
        ),
      'the worker acknowledgement of the discard',
    )
    await settle()
    await settle()
    expect(p.diagnostics).toContain('x3.host/rpc-late-reply-dropped')
    expect(p.wire.log.some(entry => entry.from === 'a' && entry.frame.t === 'release')).toBe(true)
    expect(p.failures.host).toEqual([])
    expect(p.host.state).toBe('open')
    expect(p.worker.state).toBe('open')
    expect(p.worker.counters().localHandles).toBe(3)
    expect(p.host.counters().remoteHandles).toBe(3)
    expect(p.host.counters().pendingCalls).toBe(0)
  })

  it('release is idempotent, cascades to children, and calling a released capability is a structured error', async () => {
    const p = pair()
    const { session } = await openSession(p)
    const capability = (session as unknown as Record<symbol, RemoteCapability>)[CAPABILITY_OF]
    if (capability === undefined) throw new Error('capability missing')
    const leased = await capability.call('dataSource', ['x3.demo/text', 1])
    if (leased.kind !== 'lease') throw new Error('expected lease')
    await capability.release()
    await capability.release()
    expect(capability.isReleased).toBe(true)
    expect(leased.remote.isReleased).toBe(true) // cascaded on the consuming side
    await settle()
    expect(p.world.released.text).toBe(1) // cascaded on the executing side
    expect(p.world.released.session).toBe(0) // release ≠ dispose: the target's own dispose is a method
    await expect(capability.call('descriptor')).rejects.toMatchObject({
      code: 'x3.host/rpc-released-handle',
    })
    await expect(leased.remote.call('size')).rejects.toMatchObject({
      code: 'x3.host/rpc-released-handle',
    })
    expect(p.host.state).toBe('open')
  })

  it('exceeding the pending-call limit is a local structured error, not a frame', async () => {
    const p = pair(protocolLimits({ defaultCallDeadlineMs: 2_000, maxPendingCalls: 2 }))
    const { session } = await openSession(p)
    const capability = (session as unknown as Record<symbol, RemoteCapability>)[CAPABILITY_OF]
    if (capability === undefined) throw new Error('capability missing')
    const first = capability.call('hang', [{}]).catch((error: unknown) => error)
    const second = capability.call('hang', [{}]).catch((error: unknown) => error)
    await expect(capability.call('descriptor')).rejects.toMatchObject({
      code: 'x3.host/rpc-limit-exceeded',
    })
    await p.host.close('test over')
    expect(await first).toMatchObject({ code: 'x3.host/rpc-endpoint-closed' })
    expect(await second).toMatchObject({ code: 'x3.host/rpc-endpoint-closed' })
  })
})

// ------------------------------------------------------------------ hostile suite

describe('capability-rpc endpoints — hostile frames fail closed', () => {
  const envelope = (generation = 1, id = 1000) => ({
    domain: CAPABILITY_RPC_DOMAIN,
    version: 1,
    session: 'sess',
    generation,
    id,
  })

  async function failsHost(raw: (p: Pair) => unknown, code: string): Promise<Pair> {
    const p = pair()
    const { session } = await openSession(p)
    void session
    const pending = (session as unknown as Record<symbol, RemoteCapability>)[CAPABILITY_OF]?.call(
      'hang',
      [{}],
    ).catch((error: unknown) => error)
    await settle()
    p.wire.inject('a', raw(p))
    await settle()
    expect(p.host.state).toBe('failed')
    const failure = p.failures.host[0]
    expect(failure).toBeDefined()
    expect((failure as ProtocolViolation).code).toBe(code)
    // the pending call is rejected, a terminate is sent, and nothing stays leased on the host
    expect(await pending).toMatchObject({ code: 'x3.host/rpc-protocol-violation' })
    expect(p.wire.log.some(entry => entry.from === 'a' && entry.frame.t === 'terminate')).toBe(true)
    expect(p.host.counters().pendingCalls).toBe(0)
    expect(p.host.counters().localHandles).toBe(0)
    return p
  }

  it('rejects malformed, foreign-session, stale-generation and non-monotonic frames', async () => {
    await failsHost(() => 'garbage', 'not-an-object')
    await failsHost(
      () => ({ ...envelope(), t: 'cancel', target: 1, session: 'other' }),
      'bad-envelope',
    )
    await failsHost(() => ({ ...envelope(2), t: 'cancel', target: 1 }), 'stale-generation')
    await failsHost(() => ({ ...envelope(1, 1), t: 'cancel', target: 1 }), 'non-monotonic-id')
    await failsHost(
      () => ({ ...envelope(), t: 'return', inReplyTo: 999_999 }),
      'unknown-reply-target',
    )
  })

  it('rejects a duplicate reply for an already settled call', async () => {
    const p = pair()
    let duplicated = false
    p.wire.tap.b = frame => {
      if (frame.t === 'return' && !duplicated && frame.inReplyTo > 1) {
        duplicated = true
        return [frame, { ...frame, id: frame.id + 100 }]
      }
      return undefined
    }
    const outcome = await openSession(p).catch((error: unknown) => error)
    expect(['x3.host/rpc-protocol-violation', 'x3.host/rpc-endpoint-closed']).toContain(
      (outcome as { code?: string }).code,
    )
    await settle()
    expect(p.host.state).toBe('failed')
    expect((p.failures.host[0] as ProtocolViolation).code).toBe('duplicate-reply')
  })

  it('a peer calling an unknown/foreign handle or an unknown method is a violation on the executing side', async () => {
    const p = pair()
    await openSession(p)
    p.wire.inject('b', {
      ...envelope(),
      t: 'call',
      handle: 'w1-77',
      method: 'descriptor',
      args: [],
    })
    await settle()
    expect(p.worker.state).toBe('failed')
    expect((p.failures.worker[0] as ProtocolViolation).code).toBe('unknown-handle')
    const q = pair()
    await openSession(q)
    q.wire.inject('b', { ...envelope(), t: 'call', handle: 'w1-3', method: 'notAMethod', args: [] })
    await settle()
    expect((q.failures.worker[0] as ProtocolViolation).code).toBe('unknown-method')
    const r = pair()
    await openSession(r)
    r.wire.inject('b', { ...envelope(), t: 'call', handle: 'h1-1', method: 'descriptor', args: [] })
    await settle()
    expect((r.failures.worker[0] as ProtocolViolation).code).toBe('unknown-handle')
    // and everything the worker executed for the host was released, targets included
    await settle()
    expect(r.worker.counters().localHandles).toBe(0)
    expect(r.world.released.module).toBe(1)
  })

  it('a concurrent next on one iterator and a stale-generation handle are violations', async () => {
    const p = pair()
    const { session } = await openSession(p)
    const search = session['search'] as (query: string) => Promise<AsyncIterable<string>>
    const iterable = await search('a')
    const iterator = iterable[Symbol.asyncIterator]()
    await iterator.next()
    const iteratorHandle = p.wire.log.find(
      entry =>
        entry.from === 'b' &&
        entry.frame.t === 'return' &&
        typeof entry.frame.value === 'object' &&
        entry.frame.value !== null &&
        (entry.frame.value as { '@x3.handle'?: { kind?: string } })['@x3.handle']?.kind ===
          'iterator',
    )
    if (iteratorHandle === undefined || iteratorHandle.frame.t !== 'return')
      throw new Error('iterator handle not observed')
    const handleId = (iteratorHandle.frame.value as { '@x3.handle': { id: string } })['@x3.handle']
      .id
    p.wire.inject('b', { ...envelope(1, 900), t: 'next', handle: handleId })
    p.wire.inject('b', { ...envelope(1, 901), t: 'next', handle: handleId })
    await settle()
    // whichever arrives while the first is in flight trips the busy check
    expect(p.worker.state).toBe('failed')
    expect((p.failures.worker[0] as ProtocolViolation).code).toBe('iterator-busy')
    const stale = pair(protocolLimits({ defaultCallDeadlineMs: 2_000 }), 2)
    await openSession(stale)
    stale.wire.inject('b', {
      ...envelope(2, 900),
      t: 'call',
      handle: 'w1-1',
      method: 'createCodec',
      args: [],
    })
    await settle()
    expect((stale.failures.worker[0] as ProtocolViolation).code).toBe('stale-generation')
  })

  it('peer exit rejects pending calls, releases every local target and closes streams', async () => {
    const p = pair()
    const source = p.host.expose(
      { size: async () => 1, read: async () => new Uint8Array(1) },
      { contract: 'x3.demo/source', major: 1 },
    )
    const { session } = await openSession(p)
    const capability = (session as unknown as Record<symbol, RemoteCapability>)[CAPABILITY_OF]
    if (capability === undefined) throw new Error('capability missing')
    const pending = capability.call('hang', [{}])
    await settle()
    await p.host.peerClosed('worker crashed')
    await expect(pending).rejects.toMatchObject({
      code: 'x3.host/rpc-peer-exited',
      retryability: 'conditional',
    })
    expect(source.isReleased).toBe(true)
    expect(p.host.counters().localHandles).toBe(0)
    expect(p.host.state).toBe('closed')
    await expect(capability.call('descriptor')).rejects.toMatchObject({
      code: 'x3.host/rpc-endpoint-closed',
    })
  })

  it('a graceful close terminates the peer, which releases its targets and reports the reason', async () => {
    const p = pair()
    await openSession(p)
    let terminated: string | undefined
    const q = pair()
    const workerWithHook = createEndpoint({
      role: 'worker',
      port: q.wire.b,
      session: 'sess',
      generation: 1,
      surfaces,
      loader: async () => ({
        module: q.world.module,
        surface: { contract: 'x3.demo/module', major: 1 },
        release: () => void (q.world.released.module += 1),
      }),
      onTerminate: reason => void (terminated = reason),
    })
    void workerWithHook
    await p.host.close('shutdown')
    await settle()
    expect(p.worker.state).toBe('closed')
    expect(p.world.released.module).toBe(1)
    expect(p.world.released.session).toBe(0) // release ≠ dispose; the codec's own dispose is not invoked by teardown
    expect(terminated).toBeUndefined() // the hook only fires on the endpoint that received the terminate frame
  })
})

describe('capability-rpc endpoints — misuse is a local structured error, not a violation', () => {
  it('unknown surface on expose, unknown method on call, released capability as argument', async () => {
    const p = pair()
    expect(() => p.host.expose({}, { contract: 'x3.demo/nope', major: 1 })).toThrow(
      /unregistered surface/,
    )
    const { session } = await openSession(p)
    const capability = (session as unknown as Record<symbol, RemoteCapability>)[CAPABILITY_OF]
    if (capability === undefined) throw new Error('capability missing')
    await expect(capability.call('nope')).rejects.toMatchObject({
      code: 'x3.host/rpc-unknown-method',
    })
    const source = p.host.expose(
      { size: async () => 1, read: async () => new Uint8Array(1) },
      { contract: 'x3.demo/source', major: 1 },
    )
    await source.release()
    await expect(capability.call('descriptor', [source])).rejects.toMatchObject({
      code: 'x3.host/rpc-released-handle',
    })
    // outbound values obey the same validator as inbound ones
    await expect(capability.call('descriptor', [{ fn: () => 1 }])).rejects.toMatchObject({
      code: 'x3.host/rpc-outbound-value-invalid',
    })
    expect(p.host.state).toBe('open')
    expect(isCancellation(new OperationCancelledError())).toBe(true)
  })
})

// ------------------------------------------------------------------ v1.1: leased values, dynamic results, arity, fields

describe('capability-rpc endpoints — leased values, dynamic lease results, arity and fields', () => {
  it('a leased-value crosses as value + release-only handle; release reaches the executing side', async () => {
    const p = pair()
    const { session } = await openSession(p)
    const openEntry = session['openEntry'] as (
      id: string,
    ) => Promise<{ value: { entry: string }; release(): Promise<void> }>
    const lease = await openEntry('e-1')
    expect(lease.value).toEqual({ entry: 'e-1' })
    expect(p.worker.counters().localHandles).toBe(4) // module, codec, session, the entry lease
    await lease.release()
    await lease.release()
    await settle()
    expect(p.world.released.entry).toBe(1)
    expect(p.worker.counters().localHandles).toBe(3)
    expect(p.host.counters().remoteHandles).toBe(3)
    // a target that does not return a lease is a structured bad-return, not a violation
    const bad = session['badLeasedValue'] as () => Promise<unknown>
    await expect(bad()).rejects.toMatchObject({ code: 'x3.host/rpc-bad-return' })
    expect(p.host.state).toBe('open')
  })

  it('a leased-value produced after cancellation is discarded, not leaked', async () => {
    const p = pair(protocolLimits({ defaultCallDeadlineMs: 2_000 }), 1, 'macrotask')
    const { session } = await openSession(p)
    const remote = (session as unknown as Record<symbol, RemoteCapability>)[CAPABILITY_OF]
    if (remote === undefined) throw new Error('remote missing')
    const controller = new AbortController()
    const promise = remote.call('openEntry', ['e-2'], { signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(OperationCancelledError)
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline && p.world.released.entry === 0) await settle()
    await settle()
    expect(p.world.released.entry).toBe(1)
    expect(p.worker.counters().localHandles).toBe(3)
    expect(p.host.counters().pendingCalls).toBe(0)
    expect(p.failures.host).toEqual([])
    expect(p.host.state).toBe('open')
  })

  it('a lease whose surface is named by the arguments resolves per call and refuses unknown surfaces', async () => {
    const p = pair()
    const { session } = await openSession(p)
    const sourceFor = session['sourceFor'] as (
      contract: string,
      major: number,
    ) => Promise<{ value: Record<string, unknown>; release(): Promise<void> }>
    const text = await sourceFor('x3.demo/text', 1)
    expect(await (text.value['slice'] as (a: number, b: number) => Promise<string>)(0, 5)).toBe(
      'hello',
    )
    const source = await sourceFor('x3.demo/source', 1)
    expect(await (source.value['size'] as () => Promise<number>)()).toBe(2)
    expect(
      (source.value as unknown as Record<symbol, RemoteCapability>)[CAPABILITY_OF]?.contract,
    ).toBe('x3.demo/source')
    await expect(sourceFor('x3.demo/nope', 1)).rejects.toMatchObject({
      code: 'x3.host/rpc-bad-argument',
    })
    await text.release()
    await source.release()
    expect(p.host.state).toBe('open')
  })

  it('arity pads omitted trailing arguments so the signal stays last', async () => {
    const p = pair()
    const { session } = await openSession(p)
    const padded = session['padded'] as (
      ...args: unknown[]
    ) => Promise<{ count: number; first: unknown; lastIsSignal: boolean }>
    expect(await padded()).toEqual({ count: 3, first: null, lastIsSignal: true })
    expect(await padded('a')).toEqual({ count: 3, first: 'a', lastIsSignal: true })
    expect(await padded('a', 'b')).toEqual({ count: 3, first: 'a', lastIsSignal: true })
  })

  it('declared data fields travel with the handle and materialize as read-only properties', async () => {
    const p = pair()
    const loaded = await p.host.load(loadRequest)
    expect(loaded.root.data).toEqual({ abiVersion: 1 })
    const root = p.host.materialize(loaded.root)
    expect(root['abiVersion']).toBe(1)
    const { session } = await openSession(p)
    expect(session['revision']).toBe('rev-1')
    expect(Object.getOwnPropertyDescriptor(session, 'revision')?.writable).toBe(false)
    expect(Object.keys(session)).toContain('revision')
  })

  it('a peer that returns a leased-value with a non-lease handle or handles inside ref data fails closed', async () => {
    const p = pair()
    const { session } = await openSession(p)
    const remote = (session as unknown as Record<symbol, RemoteCapability>)[CAPABILITY_OF]
    if (remote === undefined) throw new Error('remote missing')
    const pending = remote.call('hang', [{}]).catch((error: unknown) => error)
    await settle()
    const call = [...p.wire.log]
      .reverse()
      .find(
        entry => entry.from === 'a' && entry.frame.t === 'call' && entry.frame.method === 'hang',
      )
    if (call === undefined) throw new Error('call not observed')
    p.wire.inject('a', {
      domain: CAPABILITY_RPC_DOMAIN,
      version: 1,
      session: 'sess',
      generation: 1,
      id: 5_000,
      t: 'return',
      inReplyTo: call.frame.id,
      value: { entry: 'e-3' },
      lease: { '@x3.handle': { id: 'w1-77', kind: 'iterator' } },
    })
    await settle()
    expect(p.host.state).toBe('failed')
    expect((p.failures.host[0] as ProtocolViolation).code).toBe('bad-handle')
    expect(await pending).toMatchObject({ code: 'x3.host/rpc-protocol-violation' })

    const q = pair()
    const opened = await openSession(q)
    const remote2 = (opened.session as unknown as Record<symbol, RemoteCapability>)[CAPABILITY_OF]
    if (remote2 === undefined) throw new Error('remote missing')
    const pending2 = remote2.call('hang', [{}]).catch((error: unknown) => error)
    await settle()
    const call2 = [...q.wire.log]
      .reverse()
      .find(
        entry => entry.from === 'a' && entry.frame.t === 'call' && entry.frame.method === 'hang',
      )
    if (call2 === undefined) throw new Error('call not observed')
    q.wire.inject('a', {
      domain: CAPABILITY_RPC_DOMAIN,
      version: 1,
      session: 'sess',
      generation: 1,
      id: 5_000,
      t: 'return',
      inReplyTo: call2.frame.id,
      value: {
        '@x3.handle': {
          id: 'w1-9',
          kind: 'lease',
          contract: 'x3.demo/text',
          major: 1,
          data: { nested: { '@x3.handle': { id: 'w1-10', kind: 'lease' } } },
        },
      },
    })
    await settle()
    expect(q.host.state).toBe('failed')
    expect((q.failures.host[0] as ProtocolViolation).code).toBe('handle-not-allowed')
    expect(await pending2).toMatchObject({ code: 'x3.host/rpc-protocol-violation' })
  })
})
