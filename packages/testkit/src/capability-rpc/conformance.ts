/**
 * FramePort conformance kit for the capability-RPC core (NXT-105 → F1).
 *
 * A transport (Node `worker_threads`, browser `Worker`, Electron preload/IPC, a loopback) is
 * conformant when a pair of its `FramePort`s carries the protocol *unchanged*: frames arrive
 * whole, once, in order, asynchronously, structured-clone data (bigint, `Uint8Array`) survives,
 * transfer lists are honoured (or bytes are copied — the kit records which), malformed objects
 * are delivered as-is (or refused at `post`), and endpoints on both ends reach the same
 * lifecycle states they reach over the reference loopback. The run is framework-agnostic: it
 * returns a report; a test asserts on it. Cases are the loopback hostile suite of
 * `packages/host/test/execution-endpoint.test.ts`, re-expressed against an abstract pair.
 *
 * Scope: `CASES` holds 26 cases — round trip (`rt-*`), lifecycle (`lc-*`) and hostile (`hs-*`).
 * In-process pairs (a `MessageChannel`, an in-memory loopback, an Electron
 * `MessageChannelMain`) run every case; host-only pairs (`farSide: 'demo-world'` — the far end is
 * a real thread/process already running a worker endpoint over the demo world, e.g. the testkit
 * `demo-worker` fixture) run the host-observable subset and skip the rest. Crash/hang/exit
 * behaviour of a *real* worker is backend acceptance (THREAT_MODEL_WORKER_BOUNDARY §4/§5), not
 * FramePort conformance.
 */

import {
  ModkitError,
  OperationCancelledError,
  isCancellation,
  isModkitError,
} from '@modkitx-x3/core'
import {
  CAPABILITY_OF,
  CAPABILITY_RPC_DOMAIN,
  CAPABILITY_RPC_VERSION,
  createEndpoint,
  protocolLimits,
  type Endpoint,
  type Frame,
  type FramePort,
  type ProtocolLimits,
  type ProtocolViolation,
  type RemoteCapability,
} from '@modkitx-x3/host/execution'
import {
  DEMO_LOAD_REQUEST,
  DEMO_SOURCE,
  DEMO_SURFACES,
  DEMO_TEXT,
  createDemoWorld,
  type DemoWorld,
} from './demo-world.js'

// ---------------------------------------------------------------------------------------------
// public API

/**
 * What a transport under test hands to the kit. Two modes:
 *  - **in-process** — both ends of one channel live in this thread (`worker` present): the kit runs
 *    a worker endpoint over the demo world itself and every case, hostile ones included;
 *  - **host-only** — `worker` is absent and `farSide: 'demo-world'` promises that the far end
 *    already runs a worker-role endpoint serving `createDemoWorld()` (e.g. the testkit
 *    `demo-worker` fixture in a real thread, an Electron utility process, a browser `Worker`):
 *    the kit runs the host-observable subset and reports the rest as `skipped`.
 */
export interface ConformancePair {
  /** Human-readable transport label for the report (`loopback:microtask`, `node:MessageChannel`). */
  readonly transport: string
  readonly host: FramePort
  readonly worker?: FramePort
  readonly farSide?: 'demo-world'
  close?(): Promise<void> | void
}

/**
 * Creates one fresh pair per case. The kit passes the `session`/`generation` its host endpoint will
 * use so a remote far side (host-only mode) can be spawned with the same identity; in-process
 * transports ignore the argument.
 */
export type ConformancePairFactory = (identity: {
  readonly session: string
  readonly generation: number
}) => ConformancePair | Promise<ConformancePair>

export interface ConformanceOptions {
  /** Endpoint limits for every case (cases that need tighter limits override individual keys). */
  readonly limits?: ProtocolLimits
  readonly only?: readonly string[]
  readonly skip?: readonly string[]
  /** Per-case budget; a transport that stalls a case fails it. Default 10 s. */
  readonly caseTimeoutMs?: number
  /** How long "nothing else happens" checks wait for the transport. Default 25 ms. */
  readonly settleMs?: number
}

export interface ConformanceFailure {
  readonly caseId: string
  readonly message: string
}

export interface ConformanceSkip {
  readonly caseId: string
  readonly reason: string
}

export interface ConformanceReport {
  readonly transport: string
  readonly passed: readonly string[]
  readonly failures: readonly ConformanceFailure[]
  readonly skipped: readonly ConformanceSkip[]
  /** Facts about the transport that are not pass/fail (`transfer`, `delivery`). */
  readonly observations: Readonly<Record<string, string>>
}

// ---------------------------------------------------------------------------------------------
// assertions (no test framework inside the kit)

class ConformanceAssertion extends Error {
  override readonly name = 'ConformanceAssertion'
}

/** The transport refused a raw (malformed) object at `post`; hostile cases are then skipped. */
class TransportRefusedRaw extends Error {
  override readonly name = 'TransportRefusedRaw'
}

/** Host-only pair: the far side is remote, so raw injection and world introspection are unavailable. */
class RemoteFarSide extends Error {
  override readonly name = 'RemoteFarSide'
}

function fail(message: string): never {
  throw new ConformanceAssertion(message)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message)
}

function showView(view: ArrayBufferView): string {
  const items = Array.from(view as unknown as ArrayLike<unknown>)
  const head = items.slice(0, 8).map(item => (typeof item === 'bigint' ? `${item}n` : String(item)))
  return `${view.constructor.name}(${items.length})[${head.join(',')}${items.length > 8 ? ',…' : ''}]`
}

function show(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? `${item}n` : ArrayBuffer.isView(item) ? showView(item) : item,
    )
  } catch {
    return String(value)
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (!deepEqual(actual, expected))
    fail(`${label}: expected ${show(expected)}, received ${show(actual)}`)
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object' || a === null || b === null) return false
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    /*
     * Kind first, then elements. Falling through to the object path would compare a typed array by
     * its index keys, under which a Float32Array and an Int32Array holding the same numbers are
     * "equal" — and a case whose whole point is that the element type survived would pass without
     * it having survived.
     */
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) return false
    if (a.constructor !== b.constructor) return false
    const left = a as unknown as ArrayLike<unknown>
    const right = b as unknown as ArrayLike<unknown>
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i += 1) if (!Object.is(left[i], right[i])) return false
    return true
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!(Array.isArray(a) && Array.isArray(b)) || a.length !== b.length) return false
    return a.every((item, index) => deepEqual(item, b[index]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every(key => Object.hasOwn(right, key) && deepEqual(left[key], right[key]))
}

function codeOf(error: unknown): string | undefined {
  return isModkitError(error) ? error.code : undefined
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  return fail('expected a rejection, the promise resolved')
}

async function expectCode(
  promise: Promise<unknown>,
  code: string,
  label: string,
): Promise<ModkitError> {
  const error = await rejection(promise)
  assert(
    codeOf(error) === code,
    `${label}: expected error code ${code}, received ${show(codeOf(error) ?? String(error))}`,
  )
  return error as ModkitError
}

// ---------------------------------------------------------------------------------------------
// case context

type Side = 'host' | 'worker'

interface WireRecord {
  readonly from: Side
  readonly frame: Frame
}

interface WireSpy {
  readonly records: WireRecord[]
  readonly lastId: Record<Side, number>
  /** Depth of `post` calls in progress on either side (both spy ports share one spy). */
  postingDepth: number
  /** Frames handed to a handler while a `post` was still on the stack — must stay 0. */
  syncDeliveries: number
}

interface OpenedSession {
  readonly root: RemoteCapability
  readonly codec: Record<string, unknown>
  readonly session: Record<string, unknown>
  readonly remote: RemoteCapability
}

interface CaseContext {
  readonly pair: ConformancePair
  readonly host: Endpoint
  /** In-process mode only: the kit's own worker endpoint and world; `undefined` in host-only mode. */
  readonly worker: Endpoint | undefined
  readonly world: DemoWorld | undefined
  /** In-process pair (both ends here) — hostile injection and world assertions are available. */
  readonly local: boolean
  readonly limits: ProtocolLimits
  readonly session: string
  readonly spy: WireSpy
  readonly failures: Record<Side, (ProtocolViolation | ModkitError)[]>
  readonly diagnostics: string[]
  readonly terminated: string[]
  readonly observations: Record<string, string>
  settle(): Promise<void>
  waitFor(predicate: () => boolean, what: string, timeoutMs?: number): Promise<void>
  /** Post an arbitrary object *to the host* as if the worker had sent it. */
  postRawToHost(raw: unknown): void
  /** Post an arbitrary object *to the worker* as if the host had sent it. */
  postRawToWorker(raw: unknown): void
  /** A valid envelope for a frame injected on behalf of `from`, with a monotonic id. */
  envelope(from: Side, offset?: number): Record<string, unknown>
  openSession(): Promise<OpenedSession>
  /** A second, independent pair+endpoints on the same transport (cleaned up with the case). */
  fresh(overrides?: Partial<ProtocolLimits>): Promise<CaseContext>
}

interface ConformanceCase {
  readonly id: string
  readonly title: string
  readonly limits?: Partial<ProtocolLimits>
  readonly hostile?: boolean
  /** The case only makes sense with the kit's own worker endpoint (skipped in host-only mode). */
  readonly needsLocalWorker?: boolean
  run(context: CaseContext): Promise<void>
}

function spyPort(port: FramePort, side: Side, spy: WireSpy): FramePort {
  return {
    post(frame, transfer) {
      spy.records.push({ from: side, frame })
      if (typeof frame.id === 'number' && frame.id > spy.lastId[side]) spy.lastId[side] = frame.id
      spy.postingDepth += 1
      try {
        port.post(frame, transfer)
      } finally {
        spy.postingDepth -= 1
      }
    },
    onFrame(handler) {
      return port.onFrame(frame => {
        if (spy.postingDepth > 0) spy.syncDeliveries += 1
        handler(frame)
      })
    },
  }
}

let sessionCounter = 0

async function createContext(
  createPair: ConformancePairFactory,
  options: Required<Pick<ConformanceOptions, 'settleMs'>> & { readonly limits: ProtocolLimits },
  cleanups: (() => Promise<void> | void)[],
  observations: Record<string, string>,
): Promise<CaseContext> {
  sessionCounter += 1
  const session = `conformance-${sessionCounter}-${Math.random().toString(36).slice(2, 10)}`
  const generation = 1
  const pair = await createPair({ session, generation })
  const local = pair.worker !== undefined
  if (!local && pair.farSide !== 'demo-world') {
    throw new RemoteFarSide(
      'a pair without a worker port must declare farSide: "demo-world" (a remote worker endpoint serving createDemoWorld())',
    )
  }
  const world = local ? createDemoWorld() : undefined
  const spy: WireSpy = {
    records: [],
    lastId: { host: 0, worker: 0 },
    postingDepth: 0,
    syncDeliveries: 0,
  }
  const failures: Record<Side, (ProtocolViolation | ModkitError)[]> = { host: [], worker: [] }
  const diagnostics: string[] = []
  const terminated: string[] = []
  const hostPort = spyPort(pair.host, 'host', spy)
  const host = createEndpoint({
    role: 'host',
    port: hostPort,
    session,
    generation,
    surfaces: DEMO_SURFACES,
    limits: options.limits,
    onFailure: failure => void failures.host.push(failure),
    onDiagnostic: diagnostic => void diagnostics.push(diagnostic.code),
  })
  const worker =
    pair.worker === undefined || world === undefined
      ? undefined
      : createEndpoint({
          role: 'worker',
          port: spyPort(pair.worker, 'worker', spy),
          session,
          generation,
          surfaces: DEMO_SURFACES,
          limits: options.limits,
          loader: world.loader,
          onFailure: failure => void failures.worker.push(failure),
          onDiagnostic: diagnostic => void diagnostics.push(diagnostic.code),
          onTerminate: reason => void terminated.push(reason),
        })
  cleanups.push(async () => {
    await host.close('conformance case finished').catch(() => undefined)
    await worker?.close('conformance case finished').catch(() => undefined)
    await pair.close?.()
  })
  const settle = () => new Promise<void>(resolve => setTimeout(resolve, options.settleMs))
  const waitFor = async (predicate: () => boolean, what: string, timeoutMs = 2_000) => {
    const started = Date.now()
    while (!predicate()) {
      if (Date.now() - started > timeoutMs) fail(`timed out waiting for ${what}`)
      await new Promise<void>(resolve => setTimeout(resolve, 5))
    }
  }
  const raw = (port: FramePort | undefined, object: unknown) => {
    if (port === undefined) {
      throw new RemoteFarSide(
        'far side is remote: raw injection through the peer port is unavailable',
      )
    }
    try {
      port.post(object as Frame, [])
    } catch (error) {
      throw new TransportRefusedRaw(
        `transport refused a raw object at post: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  const context: CaseContext = {
    pair,
    host,
    worker,
    world,
    local,
    limits: options.limits,
    session,
    spy,
    failures,
    diagnostics,
    terminated,
    observations,
    settle,
    waitFor,
    postRawToHost: object => raw(pair.worker, object),
    postRawToWorker: object => raw(pair.host, object),
    envelope: (from, offset = 1_000) => ({
      domain: CAPABILITY_RPC_DOMAIN,
      version: CAPABILITY_RPC_VERSION,
      session,
      generation,
      id: spy.lastId[from] + offset,
    }),
    async openSession() {
      const loaded = await host.load(DEMO_LOAD_REQUEST)
      const created = await loaded.root.call('createCodec', [{ budgets: { maxNodes: 10 } }])
      assert(created.kind === 'lease', 'createCodec must produce a lease')
      const codec = host.materialize(created.remote)
      const open = codec['open'] as (input: unknown) => Promise<Record<string, unknown>>
      const opened = await open({ bindings: [] })
      const remote = (opened as unknown as Record<symbol, RemoteCapability | undefined>)[
        CAPABILITY_OF
      ]
      assert(remote !== undefined, 'materialized session must carry its remote capability')
      return { root: loaded.root, codec, session: opened, remote }
    },
    fresh: overrides =>
      createContext(
        createPair,
        { ...options, limits: protocolLimits({ ...options.limits, ...overrides }) },
        cleanups,
        observations,
      ),
  }
  return context
}

// ---------------------------------------------------------------------------------------------
// cases

/** In-process only: the kit's own worker endpoint / world (cases flagged `needsLocalWorker`). */
const localWorker = (ctx: CaseContext): Endpoint => {
  assert(ctx.worker !== undefined, 'this case needs the in-process worker endpoint')
  return ctx.worker
}
const localWorld = (ctx: CaseContext): DemoWorld => {
  assert(ctx.world !== undefined, 'this case needs the in-process demo world')
  return ctx.world
}

const asFn = <T>(target: Record<string, unknown>, name: string): T => {
  const fn = target[name]
  assert(typeof fn === 'function', `materialized object must expose ${name}()`)
  return fn as T
}

/** Id of the last `call` frame the host sent for `method` — hostile cases forge replies to it. */
const lastHostCallId = (ctx: CaseContext, method: string): number => {
  for (let index = ctx.spy.records.length - 1; index >= 0; index -= 1) {
    const record = ctx.spy.records[index]
    if (record === undefined) continue
    if (record.from === 'host' && record.frame.t === 'call' && record.frame.method === method)
      return record.frame.id
  }
  return fail(`no outbound call frame for ${method} was observed`)
}

/**
 * Opens a session and parks a `hang` call on the far side, so a hostile case has a real pending
 * id to forge a reply for. Returns that id and the (eventual) outcome of the parked call.
 */
const parkPendingHang = async (
  ctx: CaseContext,
): Promise<{ readonly id: number; readonly settled: Promise<unknown> }> => {
  const { remote } = await ctx.openSession()
  const settled = remote.call('hang', [{}]).catch((error: unknown) => error)
  await ctx.waitFor(() => ctx.host.counters().pendingCalls === 1, 'hang to be pending')
  return { id: lastHostCallId(ctx, 'hang'), settled }
}

const CASES: readonly ConformanceCase[] = [
  {
    id: 'rt-load-call-lease-iterate-dispose',
    title: 'load → callback into a host source → lease → iterate → dispose, handles balanced',
    async run(ctx) {
      const source = ctx.host.expose(
        {
          size: async () => 4,
          read: async (offset: number, length: number) =>
            new Uint8Array([10, 20, 30, 40]).slice(offset, offset + length),
        },
        DEMO_SOURCE,
      )
      const loaded = await ctx.host.load(DEMO_LOAD_REQUEST)
      assertEqual(loaded.exports, ['abiVersion', 'createCodec'], 'exports')
      const created = await loaded.root.call('createCodec', [{ budgets: { maxNodes: 10 } }])
      assert(created.kind === 'lease', 'createCodec must lease')
      const codec = ctx.host.materialize(created.remote)
      const probe = asFn<(r: unknown) => Promise<unknown>>(codec, 'probe')
      assertEqual(
        await probe({ source, plan: { kind: 'bytes' } }),
        { codecId: 'x3.testkit/plain', confidence: 0.9, size: 4, head: [10, 20] },
        'probe result (worker called back into the host source)',
      )
      if (ctx.world !== undefined)
        assert(
          ctx.world.log.includes('probe:size=4,head=10,20'),
          'worker must have read the host source',
        )
      const open = asFn<(i: unknown) => Promise<Record<string, unknown>>>(codec, 'open')
      const session = await open({ bindings: [] })
      assertEqual(
        await asFn<() => Promise<unknown>>(session, 'descriptor')(),
        { id: 'demo', traits: ['content.text'] },
        'descriptor',
      )
      const lease = await asFn<
        (
          c: string,
          m: number,
        ) => Promise<{ value: Record<string, unknown>; release(): Promise<void> }>
      >(session, 'dataSource')(DEMO_TEXT.contract, DEMO_TEXT.major)
      assertEqual(
        await asFn<(a: number, b: number) => Promise<string>>(lease.value, 'slice')(0, 5),
        'hello',
        'slice',
      )
      assertEqual(await asFn<() => Promise<number>>(lease.value, 'size')(), 11, 'size')
      const bytes = await asFn<() => Promise<Uint8Array>>(session, 'bytes')()
      assert(bytes instanceof Uint8Array, 'bytes must arrive as a Uint8Array')
      assertEqual([...bytes], [9, 8, 7], 'bytes content')
      const found: string[] = []
      for await (const item of await asFn<(q: string) => Promise<AsyncIterable<string>>>(
        session,
        'search',
      )('a'))
        found.push(item)
      assertEqual(found, ['alpha', 'beta', 'gamma'], 'iterable items')
      await lease.release()
      const { world, worker } = ctx
      if (world !== undefined)
        assertEqual(world.released.text, 1, 'text lease released on the executing side')
      await asFn<() => Promise<void>>(session, 'dispose')()
      if (world !== undefined) assertEqual(world.released.session, 1, 'session disposed')
      if (worker !== undefined)
        await ctx.waitFor(
          () => worker.counters().localHandles === 2,
          'worker to hold module+codec only',
        )
      assertEqual(ctx.host.counters().remoteHandles, 2, 'host remote handles after dispose')
      await loaded.root.release()
      if (world !== undefined)
        await ctx.waitFor(() => world.released.module === 1, 'module release')
      if (worker !== undefined)
        await ctx.waitFor(() => worker.counters().localHandles === 0, 'worker handles to drain')
      assertEqual(ctx.host.counters().remoteHandles, 0, 'host remote handles after root release')
      assertEqual(ctx.host.counters().pendingCalls, 0, 'host pending calls')
      assertEqual(ctx.failures.host, [], 'host failures')
      assertEqual(ctx.failures.worker, [], 'worker failures')
    },
  },
  {
    id: 'rt-wire-values',
    title:
      'structured-clone values survive the transport unchanged (bigint, bytes, unicode, nesting)',
    async run(ctx) {
      const { session } = await ctx.openSession()
      const echo = asFn<(v: unknown) => Promise<unknown>>(session, 'echo')
      const nested = (depth: number): unknown =>
        depth === 0 ? { leaf: true } : { d: [nested(depth - 1)] }
      const value = {
        s: 'héllo — 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 \u0000 😀',
        n: [0, -0, 1.5, -1e-300, Number.MAX_SAFE_INTEGER, 2 ** 53 + 2],
        big: [0n, -1n, 123456789012345678901234567890n],
        b: [true, false, null],
        bytes: new Uint8Array([0, 1, 2, 255, 254]),
        empty: { a: [], o: {} },
        deep: nested(10),
        keys: { '': 1, ' ': 2, ünï: 3, 'x-y.z': 4 },
      }
      const expected = structuredClone(value) // the transport may detach `value.bytes` on send
      const back = await echo(value)
      assertEqual(back, expected, 'echoed value')
      const negZero = ((await echo([-0])) as number[])[0]
      assert(Object.is(negZero, -0), 'negative zero must survive')
      // a value method may complete with nothing (dispose-style); the transport must carry that too
      const { session: other } = await ctx.fresh().then(c => c.openSession())
      assert((await asFn<() => Promise<unknown>>(other, 'dispose')()) === undefined, 'void result')
    },
  },
  {
    id: 'rt-typed-arrays',
    title: 'typed arrays survive with their element type (model geometry, decoded audio)',
    async run(ctx) {
      /*
       * Not a hypothetical. `ModelPrimitive.positions` is a `Float32Array` and its `indices` a
       * `Uint32Array`; `AudioSamples.channels` is `Float32Array[]`. A transport that carries only
       * `Uint8Array` cannot carry a mesh or decoded audio at all, and the failure looks like a
       * viewer that mounts and then quietly says it cannot render.
       */
      const { session } = await ctx.openSession()
      const echo = asFn<(v: unknown) => Promise<unknown>>(session, 'echo')
      const primitive = {
        id: 'mesh-0',
        topology: 'triangles',
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      }
      const expected = structuredClone(primitive)
      assertEqual(await echo(primitive), expected, 'model primitive')

      // every kind the protocol admits, including the extremes each one can represent
      const kinds = {
        i8: new Int8Array([-128, 0, 127]),
        u8c: new Uint8ClampedArray([0, 128, 255]),
        i16: new Int16Array([-32768, 0, 32767]),
        u16: new Uint16Array([0, 1, 65535]),
        i32: new Int32Array([-2147483648, 0, 2147483647]),
        u32: new Uint32Array([0, 1, 4294967295]),
        f32: new Float32Array([-0, 1.5, 3.4028234663852886e38]),
        f64: new Float64Array([-0, Number.MIN_VALUE, Number.MAX_VALUE]),
        i64: new BigInt64Array([-9223372036854775808n, 0n, 9223372036854775807n]),
        u64: new BigUint64Array([0n, 18446744073709551615n]),
        bytes: new Uint8Array([0, 255]),
      }
      const back = (await echo(kinds)) as Record<string, ArrayBufferView>
      assertEqual(back, structuredClone(kinds), 'every wire typed-array kind')
      // -0 in a float array is not the same value as 0, and a codec that normalises would lose it
      assert(Object.is((back['f32'] as unknown as number[])[0], -0), 'f32 keeps negative zero')
      assert(Object.is((back['f64'] as unknown as number[])[0], -0), 'f64 keeps negative zero')
    },
  },
  {
    id: 'rt-transfer',
    title: 'bytes arrive intact; the kit records whether the transport detached or copied them',
    async run(ctx) {
      const payload = new Uint8Array(4096)
      for (let i = 0; i < payload.length; i += 1) payload[i] = i % 251
      const expected = payload.slice()
      const source = ctx.host.expose(
        { size: async () => payload.length, read: async () => payload },
        DEMO_SOURCE,
      )
      const { codec } = await ctx.openSession()
      const probe = asFn<(r: unknown) => Promise<{ head: number[]; size: number }>>(codec, 'probe')
      const result = await probe({ source })
      assertEqual(result.size, 4096, 'size seen by the worker')
      assertEqual(result.head.length, 4096, 'the worker received the whole buffer')
      assertEqual(
        result.head.slice(0, 4),
        [...expected.slice(0, 4)],
        'leading bytes seen by the worker',
      )
      assertEqual(result.head[4095], expected[4095], 'trailing byte seen by the worker')
      ctx.observations['transfer'] = payload.byteLength === 0 ? 'detached' : 'copied'
      await source.release()
    },
  },
  {
    id: 'rt-ordering',
    title: 'concurrent calls map to their own replies; events keep FIFO order',
    async run(ctx) {
      const eventCount = ctx.world === undefined ? 3 : 200
      if (ctx.world !== undefined) ctx.world.eventsControl.count = eventCount
      const { session } = await ctx.openSession()
      const checked = asFn<(n: number) => Promise<number>>(session, 'checked')
      const results = await Promise.all(Array.from({ length: 64 }, (_, i) => checked(i)))
      assertEqual(
        results,
        Array.from({ length: 64 }, (_, i) => i * 2),
        'call/reply correlation',
      )
      const events = asFn<() => Promise<AsyncIterable<{ tick: number }>>>(session, 'events')
      const seen: number[] = []
      for await (const event of await events()) seen.push(event.tick)
      assertEqual(
        seen,
        Array.from({ length: eventCount }, (_, i) => i),
        'event order',
      )
      assertEqual(
        ctx.spy.syncDeliveries,
        0,
        'the transport must not deliver synchronously inside post',
      )
      ctx.observations['delivery'] = 'asynchronous'
    },
  },
  {
    id: 'rt-errors',
    title: 'errors rehydrate with code/context/retryability; target faults are not violations',
    async run(ctx) {
      const { session } = await ctx.openSession()
      const boom = await expectCode(
        asFn<() => Promise<unknown>>(session, 'boom')(),
        'x3.testkit/boom',
        'boom',
      )
      assertEqual(boom.message, 'kaboom', 'boom message')
      assertEqual(boom.context, { where: 'worker' }, 'boom context')
      assertEqual(boom.retryability, 'safe', 'boom retryability')
      assert(!('stack' in (boom.context ?? {})), 'no stack crosses the boundary')
      await expectCode(
        asFn<() => Promise<unknown>>(session, 'badReturn')(),
        'x3.host/rpc-bad-return',
        'badReturn',
      )
      assertEqual(ctx.host.state, 'open', 'a bad target return keeps the endpoint open')
      const checked = asFn<(n: unknown) => Promise<unknown>>(session, 'checked')
      await expectCode(checked('x'), 'x3.host/rpc-bad-argument', 'checked("x")')
      assertEqual(await checked(21), 42, 'checked(21)')
    },
  },
  {
    id: 'rt-large-payload',
    title: 'payloads up to maxTransferBytes pass; larger ones are refused locally, never sent',
    limits: { maxTransferBytes: 1 << 20 },
    async run(ctx) {
      const { session, remote } = await ctx.openSession()
      const echo = asFn<(v: unknown) => Promise<Uint8Array>>(session, 'echo')
      const big = new Uint8Array((1 << 20) - 64)
      big.fill(7)
      const back = await echo(big)
      assertEqual(back.byteLength, (1 << 20) - 64, 'large payload length')
      assert(back[0] === 7 && back[back.length - 1] === 7, 'large payload content')
      const sentBefore = ctx.spy.records.length
      await expectCode(
        remote.call('echo', [new Uint8Array((1 << 20) + 1)]),
        'x3.host/rpc-outbound-value-invalid',
        'oversized outbound',
      )
      assertEqual(ctx.spy.records.length, sentBefore, 'no frame left for an oversized value')
      assertEqual(ctx.host.state, 'open', 'endpoint stays open')
    },
  },
  {
    id: 'lc-events-end-and-failure',
    title: 'push events end cleanly; a stream failure reaches the consumer after queued events',
    async run(ctx) {
      const { session } = await ctx.openSession()
      const events = asFn<() => Promise<AsyncIterable<{ tick: number }>>>(session, 'events')
      const seen: number[] = []
      for await (const event of await events()) seen.push(event.tick)
      assertEqual(seen, [0, 1, 2], 'events')
      const { world, worker } = ctx
      if (world === undefined || worker === undefined) return // failure injection needs the local world
      world.eventsControl.fail = true
      const seen2: number[] = []
      const error = await rejection(
        (async () => {
          for await (const event of await events()) seen2.push(event.tick)
        })(),
      )
      assertEqual(codeOf(error), 'x3.testkit/stream-failed', 'stream failure code')
      assertEqual((error as ModkitError).context, { after: 3 }, 'stream failure context')
      assertEqual(seen2, [0, 1, 2], 'queued events delivered before the failure')
      await ctx.waitFor(
        () => worker.counters().localHandles === 3,
        'no events handle left on the worker',
      )
    },
  },
  {
    id: 'lc-events-abandon',
    title: 'an abandoned event stream unsubscribes and releases its handle on both sides',
    async run(ctx) {
      if (ctx.world !== undefined) {
        ctx.world.eventsControl.count = 1000
        ctx.world.eventsControl.delayMs = 1
      }
      const { session } = await ctx.openSession()
      const events = asFn<() => Promise<AsyncIterable<{ tick: number }>>>(session, 'events')
      let count = 0
      for await (const event of await events()) {
        count += event.tick >= 0 ? 1 : 0
        if (count === 2) break
      }
      const { worker } = ctx
      if (worker !== undefined)
        await ctx.waitFor(
          () => worker.counters().localHandles === 3,
          'worker events handle release',
        )
      assertEqual(ctx.host.counters().subscriptions, 0, 'host subscriptions')
      assert(
        ctx.spy.records.some(r => r.from === 'host' && r.frame.t === 'unsubscribe'),
        'an unsubscribe frame must have been sent',
      )
    },
  },
  {
    id: 'lc-events-overflow',
    title: 'a slow consumer overflows a bounded queue with a structured error, endpoint stays open',
    limits: { maxQueuedEvents: 2 },
    needsLocalWorker: true,
    async run(ctx) {
      if (ctx.world !== undefined) ctx.world.eventsControl.count = 50
      const { session } = await ctx.openSession()
      const events = asFn<() => Promise<AsyncIterable<{ tick: number }>>>(session, 'events')
      const iterator = (await events())[Symbol.asyncIterator]()
      await iterator.next()
      await ctx.settle()
      await ctx.settle()
      let error: unknown
      try {
        for (;;) {
          const step = await iterator.next()
          if (step.done) break
        }
      } catch (caught) {
        error = caught
      }
      assertEqual(codeOf(error), 'x3.host/rpc-events-overflow', 'overflow error')
      assertEqual(ctx.host.state, 'open', 'endpoint state')
    },
  },
  {
    id: 'lc-cancel',
    title: 'aborting a call sends cancel, the worker sees the abort, the late reply is dropped',
    async run(ctx) {
      const { session } = await ctx.openSession()
      const hang = asFn<(i: unknown, s?: AbortSignal) => Promise<unknown>>(session, 'hang')
      const controller = new AbortController()
      const promise = hang({}, controller.signal)
      await ctx.waitFor(
        () =>
          ctx.spy.records.some(
            r => r.from === 'host' && r.frame.t === 'call' && r.frame.method === 'hang',
          ),
        'the hang call to be sent',
      )
      controller.abort(new Error('user cancelled'))
      const error = await rejection(promise)
      assert(
        error instanceof OperationCancelledError && isCancellation(error),
        'caller sees cancellation',
      )
      await ctx.waitFor(() => ctx.host.counters().pendingCalls === 0, 'pending calls to drain')
      await ctx.settle()
      assertEqual(ctx.host.state, 'open', 'a late reply after cancel is not a violation')
      assert(
        ctx.spy.records.some(r => r.from === 'host' && r.frame.t === 'cancel'),
        'cancel frame sent',
      )
      assertEqual(ctx.failures.host, [], 'host failures')
    },
  },
  {
    id: 'lc-deadline',
    title: 'a deadline cancels a hanging call with a structured, retryable error',
    async run(ctx) {
      const { remote } = await ctx.openSession()
      const error = await expectCode(
        remote.call('hang', [{}], { deadlineMs: 30 }),
        'x3.host/rpc-deadline-exceeded',
        'deadline',
      )
      assertEqual(error.retryability, 'conditional', 'deadline retryability')
      await ctx.waitFor(() => ctx.host.counters().pendingCalls === 0, 'pending to drain')
      assertEqual(ctx.host.state, 'open', 'endpoint state')
    },
  },
  {
    id: 'lc-lease-after-cancel',
    title: 'a lease produced after cancellation is released instead of leaking',
    async run(ctx) {
      const { remote } = await ctx.openSession()
      const controller = new AbortController()
      const promise = remote.call('leak', [], { signal: controller.signal })
      controller.abort()
      const error = await rejection(promise)
      assert(error instanceof OperationCancelledError, 'caller sees cancellation')
      await ctx.settle()
      await ctx.settle()
      const { worker } = ctx
      if (worker !== undefined)
        await ctx.waitFor(
          () => worker.counters().localHandles === 3,
          'worker handles (module, codec, session)',
        )
      await ctx.waitFor(() => ctx.host.counters().pendingCalls === 0, 'discard request to settle')
      assertEqual(ctx.host.counters().remoteHandles, 3, 'host remote handles')
      assertEqual(ctx.host.counters().pendingCalls, 0, 'host pending')
      assertEqual(ctx.host.state, 'open', 'endpoint state')
    },
  },
  {
    id: 'lc-release-cascade',
    title: 'release is idempotent, cascades to children on both sides, released handles are errors',
    async run(ctx) {
      const { remote } = await ctx.openSession()
      const leased = await remote.call('dataSource', [DEMO_TEXT.contract, DEMO_TEXT.major])
      assert(leased.kind === 'lease', 'dataSource must lease')
      await remote.release()
      await remote.release()
      assert(remote.isReleased, 'session capability released')
      assert(leased.remote.isReleased, 'child lease released on the consuming side')
      const { world } = ctx
      if (world !== undefined) {
        await ctx.waitFor(() => world.released.text === 1, 'child released on the executing side')
        assertEqual(world.released.session, 0, 'release is not dispose')
      }
      await expectCode(
        remote.call('descriptor'),
        'x3.host/rpc-released-handle',
        'call after release',
      )
      await expectCode(
        leased.remote.call('size'),
        'x3.host/rpc-released-handle',
        'child call after release',
      )
      assertEqual(ctx.host.state, 'open', 'endpoint state')
    },
  },
  {
    id: 'lc-pending-limit',
    title: 'the pending-call limit is a local structured error; close rejects what is in flight',
    limits: { maxPendingCalls: 2 },
    async run(ctx) {
      const { remote } = await ctx.openSession()
      const first = remote.call('hang', [{}]).catch((error: unknown) => error)
      const second = remote.call('hang', [{}]).catch((error: unknown) => error)
      await expectCode(remote.call('descriptor'), 'x3.host/rpc-limit-exceeded', 'third call')
      await ctx.host.close('conformance: pending limit')
      assertEqual(codeOf(await first), 'x3.host/rpc-endpoint-closed', 'first in-flight call')
      assertEqual(codeOf(await second), 'x3.host/rpc-endpoint-closed', 'second in-flight call')
    },
  },
  {
    id: 'lc-graceful-close',
    title: 'a graceful close terminates the peer, which releases targets and reports the reason',
    async run(ctx) {
      await ctx.openSession()
      await ctx.host.close('conformance: shutdown')
      assert(
        ctx.spy.records.some(r => r.from === 'host' && r.frame.t === 'terminate'),
        'a terminate frame must have been sent',
      )
      const h = ctx.host.counters()
      assertEqual(
        [h.pendingCalls, h.localHandles, h.remoteHandles, h.subscriptions],
        [0, 0, 0, 0],
        'host counters after close',
      )
      const { world, worker } = ctx
      if (world === undefined || worker === undefined) return
      await ctx.waitFor(() => ctx.terminated.length > 0, 'worker to observe terminate')
      assertEqual(worker.state, 'closed', 'worker state after terminate')
      assertEqual(ctx.terminated, ['conformance: shutdown'], 'terminate reason on the worker')
      await ctx.waitFor(() => world.released.module === 1, 'module release')
      assertEqual(world.released.session, 0, 'release is not dispose')
      const w = worker.counters()
      assertEqual(
        [w.pendingCalls, w.localHandles, w.remoteHandles, w.subscriptions],
        [0, 0, 0, 0],
        'worker counters after close',
      )
    },
  },
  {
    id: 'lc-peer-exit',
    title: 'peer exit rejects pending calls, releases every local target and closes the endpoint',
    async run(ctx) {
      const source = ctx.host.expose(
        { size: async () => 1, read: async () => new Uint8Array(1) },
        DEMO_SOURCE,
      )
      const { remote } = await ctx.openSession()
      const pending = remote.call('hang', [{}])
      await ctx.waitFor(() => ctx.host.counters().pendingCalls === 1, 'hang to be pending')
      await ctx.host.peerClosed('worker crashed')
      const error = await expectCode(pending, 'x3.host/rpc-peer-exited', 'pending after peer exit')
      assertEqual(error.retryability, 'conditional', 'peer-exit retryability')
      assert(source.isReleased, 'exposed source released')
      assertEqual(ctx.host.counters().localHandles, 0, 'host local handles')
      assertEqual(ctx.host.state, 'closed', 'host state')
      await expectCode(remote.call('descriptor'), 'x3.host/rpc-endpoint-closed', 'call after exit')
    },
  },
  {
    id: 'lc-local-misuse',
    title:
      'misuse (unknown surface/method, released or invalid arguments) is local, not a violation',
    async run(ctx) {
      let threw = false
      try {
        ctx.host.expose({}, { contract: 'x3.testkit/nope', major: 1 })
      } catch (error) {
        threw = codeOf(error) === 'x3.host/rpc-unknown-surface'
      }
      assert(threw, 'exposing with an unregistered surface must throw x3.host/rpc-unknown-surface')
      const { remote } = await ctx.openSession()
      await expectCode(remote.call('nope'), 'x3.host/rpc-unknown-method', 'unknown method')
      const source = ctx.host.expose(
        { size: async () => 1, read: async () => new Uint8Array(1) },
        DEMO_SOURCE,
      )
      await source.release()
      await expectCode(
        remote.call('descriptor', [source]),
        'x3.host/rpc-released-handle',
        'released argument',
      )
      await expectCode(
        remote.call('descriptor', [{ fn: () => 1 }]),
        'x3.host/rpc-outbound-value-invalid',
        'invalid outbound argument',
      )
      assertEqual(ctx.host.state, 'open', 'endpoint state')
    },
  },
  {
    id: 'hs-malformed-frames',
    title:
      'garbage, foreign-session, stale-generation, non-monotonic and orphan-reply frames fail closed',
    hostile: true,
    needsLocalWorker: true,
    async run(ctx) {
      const probes: readonly {
        readonly code: string
        readonly raw: (c: CaseContext) => unknown
      }[] = [
        { code: 'not-an-object', raw: () => 'garbage' },
        {
          code: 'bad-envelope',
          raw: c => ({ ...c.envelope('worker'), t: 'cancel', target: 1, session: 'other' }),
        },
        {
          code: 'stale-generation',
          raw: c => ({ ...c.envelope('worker'), generation: 2, t: 'cancel', target: 1 }),
        },
        {
          code: 'non-monotonic-id',
          raw: c => ({ ...c.envelope('worker'), id: 1, t: 'cancel', target: 1 }),
        },
        {
          code: 'unknown-reply-target',
          raw: c => ({ ...c.envelope('worker'), t: 'return', inReplyTo: 999_999 }),
        },
      ]
      let first = true
      for (const probe of probes) {
        const c = first ? ctx : await ctx.fresh()
        first = false
        const { remote } = await c.openSession()
        const pending = remote.call('hang', [{}]).catch((error: unknown) => error)
        await c.waitFor(() => c.host.counters().pendingCalls === 1, 'hang to be pending')
        c.postRawToHost(probe.raw(c))
        await c.waitFor(() => c.host.state === 'failed', `host to fail closed on ${probe.code}`)
        const failure = c.failures.host[0]
        assert(failure !== undefined, `${probe.code}: onFailure must fire`)
        assertEqual((failure as ProtocolViolation).code, probe.code, 'violation code')
        assertEqual(
          codeOf(await pending),
          'x3.host/rpc-protocol-violation',
          `${probe.code}: pending call`,
        )
        assert(
          c.spy.records.some(r => r.from === 'host' && r.frame.t === 'terminate'),
          `${probe.code}: terminate frame sent`,
        )
        assertEqual(c.host.counters().pendingCalls, 0, `${probe.code}: pending drained`)
        assertEqual(c.host.counters().localHandles, 0, `${probe.code}: local handles released`)
        await c.waitFor(
          () => localWorker(c).state !== 'open',
          `${probe.code}: worker to observe terminate`,
        )
      }
    },
  },
  {
    id: 'hs-duplicate-reply',
    title:
      'a duplicate reply for a settled call is a violation (transport must not deduplicate it away)',
    hostile: true,
    needsLocalWorker: true,
    async run(ctx) {
      const { remote } = await ctx.openSession()
      const before = ctx.spy.records.length
      const outcome = await remote.call('descriptor')
      assert(outcome.kind === 'value', 'descriptor must return a value')
      assertEqual(outcome.value, { id: 'demo', traits: ['content.text'] }, 'descriptor value')
      const reply = ctx.spy.records
        .slice(before)
        .find(r => r.from === 'worker' && r.frame.t === 'return')
      assert(
        reply !== undefined && reply.frame.t === 'return',
        'reply frame must have been observed',
      )
      ctx.postRawToHost({ ...reply.frame, id: ctx.spy.lastId.worker + 500 })
      await ctx.waitFor(() => ctx.host.state === 'failed', 'host to fail on the duplicate reply')
      assertEqual(
        (ctx.failures.host[0] as ProtocolViolation).code,
        'duplicate-reply',
        'violation code',
      )
    },
  },
  {
    id: 'hs-unknown-handle-and-method',
    title:
      'calls on unknown/foreign handles or unknown methods are violations on the executing side',
    hostile: true,
    needsLocalWorker: true,
    async run(ctx) {
      await ctx.openSession()
      ctx.postRawToWorker({
        ...ctx.envelope('host'),
        t: 'call',
        handle: 'w1-77',
        method: 'descriptor',
        args: [],
      })
      await ctx.waitFor(
        () => localWorker(ctx).state === 'failed',
        'worker to fail on an unknown handle',
      )
      assertEqual(
        (ctx.failures.worker[0] as ProtocolViolation).code,
        'unknown-handle',
        'unknown handle',
      )
      await ctx.waitFor(
        () => localWorld(ctx).released.module === 1,
        'worker released its module on failure',
      )
      assertEqual(localWorker(ctx).counters().localHandles, 0, 'worker local handles')

      const q = await ctx.fresh()
      await q.openSession()
      const sessionRecord = q.spy.records.find(
        r =>
          r.from === 'worker' &&
          r.frame.t === 'return' &&
          typeof r.frame.value === 'object' &&
          r.frame.value !== null &&
          '@x3.handle' in r.frame.value,
      )
      assert(
        sessionRecord !== undefined && sessionRecord.frame.t === 'return',
        'a leased handle must have been observed',
      )
      const handleId = (
        sessionRecord.frame.value as { readonly '@x3.handle': { readonly id: string } }
      )['@x3.handle'].id
      q.postRawToWorker({
        ...q.envelope('host'),
        t: 'call',
        handle: handleId,
        method: 'notAMethod',
        args: [],
      })
      await q.waitFor(
        () => localWorker(q).state === 'failed',
        'worker to fail on an unknown method',
      )
      assertEqual(
        (q.failures.worker[0] as ProtocolViolation).code,
        'unknown-method',
        'unknown method',
      )

      const r = await ctx.fresh()
      await r.openSession()
      r.postRawToWorker({
        ...r.envelope('host'),
        t: 'call',
        handle: 'h1-1',
        method: 'descriptor',
        args: [],
      })
      await r.waitFor(
        () => localWorker(r).state === 'failed',
        'worker to fail on a foreign-owner handle',
      )
      assertEqual(
        (r.failures.worker[0] as ProtocolViolation).code,
        'unknown-handle',
        'foreign owner handle',
      )
    },
  },
  {
    id: 'hs-iterator-busy-and-stale-generation',
    title: 'a concurrent next on one iterator and a stale-generation frame are violations',
    hostile: true,
    needsLocalWorker: true,
    async run(ctx) {
      const { session } = await ctx.openSession()
      const search = asFn<(q: string) => Promise<AsyncIterable<string>>>(session, 'slowSearch')
      const iterator = (await search('a'))[Symbol.asyncIterator]()
      await iterator.next()
      const record = ctx.spy.records.find(
        r =>
          r.from === 'worker' &&
          r.frame.t === 'return' &&
          typeof r.frame.value === 'object' &&
          r.frame.value !== null &&
          (r.frame.value as { readonly '@x3.handle'?: { readonly kind?: string } })['@x3.handle']
            ?.kind === 'iterator',
      )
      assert(
        record !== undefined && record.frame.t === 'return',
        'iterator handle must have been observed',
      )
      const handleId = (record.frame.value as { readonly '@x3.handle': { readonly id: string } })[
        '@x3.handle'
      ].id
      ctx.postRawToWorker({ ...ctx.envelope('host', 900), t: 'next', handle: handleId })
      ctx.postRawToWorker({ ...ctx.envelope('host', 901), t: 'next', handle: handleId })
      await ctx.waitFor(
        () => localWorker(ctx).state === 'failed',
        'worker to fail on a busy iterator',
      )
      assertEqual(
        (ctx.failures.worker[0] as ProtocolViolation).code,
        'iterator-busy',
        'iterator busy',
      )

      const stale = await ctx.fresh()
      await stale.openSession()
      stale.postRawToWorker({
        ...stale.envelope('host'),
        generation: 2,
        t: 'call',
        handle: 'w1-1',
        method: 'createCodec',
        args: [],
      })
      await stale.waitFor(
        () => localWorker(stale).state === 'failed',
        'worker to fail on a stale generation',
      )
      assertEqual(
        (stale.failures.worker[0] as ProtocolViolation).code,
        'stale-generation',
        'stale generation',
      )
    },
  },
  {
    id: 'hs-proto-pollution-reply',
    title:
      'an own __proto__ key in a forged reply is a violation and never reaches Object.prototype',
    hostile: true,
    needsLocalWorker: true,
    async run(ctx) {
      const parked = await parkPendingHang(ctx)
      ctx.postRawToHost({
        ...ctx.envelope('worker'),
        t: 'return',
        inReplyTo: parked.id,
        // JSON.parse creates an *own* «__proto__» key; an object literal only sets the prototype
        value: JSON.parse('{"id":"demo","__proto__":{"admin":true}}'),
      })
      await ctx.waitFor(() => ctx.host.state === 'failed', 'host to fail on a forbidden key')
      assertEqual(
        (ctx.failures.host[0] as ProtocolViolation).code,
        'forbidden-key',
        'violation code',
      )
      assert(
        (Object.prototype as { admin?: unknown }).admin === undefined,
        'Object.prototype must not have been polluted',
      )
      assert(({} as { admin?: unknown }).admin === undefined, 'fresh objects must stay clean')
      assertEqual(codeOf(await parked.settled), 'x3.host/rpc-protocol-violation', 'the parked call')
      assertEqual(ctx.host.counters().pendingCalls, 0, 'pending drained')
    },
  },
  {
    id: 'hs-bad-values-reply',
    title:
      'NaN, partial views, shared buffers, over-deep values and unknown frame keys fail closed',
    hostile: true,
    needsLocalWorker: true,
    async run(ctx) {
      const nested = (depth: number): unknown =>
        depth === 0 ? { leaf: true } : { d: nested(depth - 1) }
      const sharedAvailable = typeof SharedArrayBuffer === 'function'
      if (!sharedAvailable)
        ctx.observations['sharedArrayBuffer'] = 'unavailable — shared-buffer probe not run'
      const probes: readonly {
        readonly code: string
        readonly reply: () => Record<string, unknown>
      }[] = [
        { code: 'bad-value', reply: () => ({ value: { n: Number.NaN } }) },
        {
          code: 'partial-typed-array',
          reply: () => ({ value: new Uint8Array(new ArrayBuffer(16), 4, 4) }),
        },
        ...(sharedAvailable
          ? [
              {
                code: 'shared-buffer',
                reply: () => ({ value: new Uint8Array(new SharedArrayBuffer(8)) }),
              },
            ]
          : []),
        { code: 'depth-exceeded', reply: () => ({ value: nested(40) }) },
        { code: 'unknown-key', reply: () => ({ value: 1, extra: 1 }) },
      ]
      let first = true
      for (const probe of probes) {
        const c = first ? ctx : await ctx.fresh()
        first = false
        const parked = await parkPendingHang(c)
        c.postRawToHost({
          ...c.envelope('worker'),
          t: 'return',
          inReplyTo: parked.id,
          ...probe.reply(),
        })
        await c.waitFor(() => c.host.state === 'failed', `host to fail closed on ${probe.code}`)
        assertEqual(
          (c.failures.host[0] as ProtocolViolation).code,
          probe.code,
          `${probe.code}: violation code`,
        )
        assertEqual(
          codeOf(await parked.settled),
          'x3.host/rpc-protocol-violation',
          `${probe.code}: the parked call`,
        )
        assertEqual(c.host.counters().pendingCalls, 0, `${probe.code}: pending drained`)
        assertEqual(c.host.counters().localHandles, 0, `${probe.code}: local handles released`)
      }
    },
  },
  {
    id: 'hs-event-unknown-subscription',
    title: 'an event for a subscription this side never opened is dropped and counted, not fatal',
    hostile: true,
    needsLocalWorker: true,
    async run(ctx) {
      await ctx.openSession()
      const before = ctx.host.counters().droppedEvents
      ctx.postRawToHost({
        ...ctx.envelope('worker'),
        t: 'event',
        subscription: 'ws1-999',
        value: 1,
      })
      await ctx.waitFor(
        () => ctx.host.counters().droppedEvents === before + 1,
        'the stray event to be dropped and counted',
      )
      await ctx.settle()
      assertEqual(ctx.host.state, 'open', 'endpoint state')
      assertEqual(ctx.failures.host.length, 0, 'a stray event is not a failure')
      assertEqual(ctx.host.counters().droppedEvents, before + 1, 'droppedEvents')
    },
  },
  {
    id: 'hs-progress-after-settle',
    title:
      'progress after a call settled is noise; progress for a call that never existed is fatal',
    hostile: true,
    needsLocalWorker: true,
    async run(ctx) {
      const { remote } = await ctx.openSession()
      const outcome = await remote.call('descriptor')
      assert(outcome.kind === 'value', 'descriptor must return a value')
      ctx.postRawToHost({
        ...ctx.envelope('worker'),
        t: 'progress',
        inReplyTo: lastHostCallId(ctx, 'descriptor'),
        progress: { completed: 1 },
      })
      await ctx.settle()
      await ctx.settle()
      assertEqual(ctx.host.state, 'open', 'progress after settle keeps the endpoint open')
      assertEqual(ctx.failures.host.length, 0, 'progress after settle is not a failure')

      const orphan = await ctx.fresh()
      await orphan.openSession()
      orphan.postRawToHost({
        ...orphan.envelope('worker'),
        t: 'progress',
        inReplyTo: 999_999,
        progress: { completed: 1 },
      })
      await orphan.waitFor(
        () => orphan.host.state === 'failed',
        'host to fail on progress for a call that never existed',
      )
      assertEqual(
        (orphan.failures.host[0] as ProtocolViolation).code,
        'unknown-reply-target',
        'violation code',
      )
    },
  },
]

export const CONFORMANCE_CASE_IDS: readonly string[] = Object.freeze(CASES.map(item => item.id))

// ---------------------------------------------------------------------------------------------
// runner

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ConformanceAssertion(`${label} did not finish within ${ms} ms`)),
      ms,
    )
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/**
 * Runs every conformance case against fresh pairs from `createPair` and reports. A transport is
 * conformant when `failures` is empty; `skipped` lists hostile cases the transport refused to
 * carry raw objects for (a validating adapter — acceptable, and worth knowing).
 */
export async function runFramePortConformance(
  createPair: ConformancePairFactory,
  options: ConformanceOptions = {},
): Promise<ConformanceReport> {
  const baseLimits = options.limits ?? protocolLimits({ defaultCallDeadlineMs: 2_000 })
  const settleMs = options.settleMs ?? 25
  const caseTimeoutMs = options.caseTimeoutMs ?? 10_000
  const passed: string[] = []
  const failures: ConformanceFailure[] = []
  const skipped: ConformanceSkip[] = []
  const observations: Record<string, string> = {}
  let transport = 'unknown'
  const selected = CASES.filter(
    item =>
      (options.only === undefined || options.only.includes(item.id)) &&
      !(options.skip?.includes(item.id) ?? false),
  )
  for (const item of selected) {
    const cleanups: (() => Promise<void> | void)[] = []
    try {
      const context = await createContext(
        createPair,
        { settleMs, limits: protocolLimits({ ...baseLimits, ...item.limits }) },
        cleanups,
        observations,
      )
      transport = context.pair.transport
      observations['mode'] = context.local ? 'in-process' : 'host-only'
      if (!context.local && item.needsLocalWorker === true) {
        skipped.push({
          caseId: item.id,
          reason: 'host-only pair: the case needs the in-process worker endpoint or raw injection',
        })
        continue
      }
      await withTimeout(item.run(context), caseTimeoutMs, `case ${item.id}`)
      passed.push(item.id)
    } catch (error) {
      if (error instanceof TransportRefusedRaw && item.hostile === true) {
        skipped.push({ caseId: item.id, reason: error.message })
      } else if (error instanceof RemoteFarSide) {
        skipped.push({ caseId: item.id, reason: error.message })
      } else {
        failures.push({
          caseId: item.id,
          message: isModkitError(error)
            ? `${error.code}: ${error.message}`
            : error instanceof Error
              ? `${error.name}: ${error.message}`
              : String(error),
        })
      }
    } finally {
      for (const cleanup of cleanups.reverse()) {
        try {
          await cleanup()
        } catch {
          // a transport that fails to close after a failed case has already been reported
        }
      }
    }
  }
  return Object.freeze({
    transport,
    passed: Object.freeze(passed),
    failures: Object.freeze(failures),
    skipped: Object.freeze(skipped),
    observations: Object.freeze({ ...observations }),
  })
}

/** One-line summary for test output. */
export function describeConformanceReport(report: ConformanceReport): string {
  const lines = [
    `${report.transport}: ${report.passed.length} passed, ${report.failures.length} failed, ${report.skipped.length} skipped`,
    ...Object.entries(report.observations).map(([key, value]) => `  ${key}: ${value}`),
    ...report.failures.map(item => `  ✗ ${item.caseId}: ${item.message}`),
    ...report.skipped.map(item => `  – ${item.caseId}: ${item.reason}`),
  ]
  return lines.join('\n')
}
