/**
 * Retained call values across a capability-RPC boundary: a host-owned immutable value crosses once
 * per worker, later calls refer to the worker's deep-frozen copy by id, the host releases the least
 * recently used copies beyond its byte budget, and every disagreement between the two sides fails
 * closed. Frames go through `structuredClone` like a MessagePort, so identities prove reuse.
 */
import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_RPC_DOMAIN,
  CAPABILITY_RPC_VERSION,
  RETAINED_MARKER,
  createEndpoint,
  createSurfaceRegistry,
  protocolLimits,
  type Endpoint,
  type Frame,
  type FramePort,
  type ProtocolViolation,
  type RemoteCapability,
  type RetainedValuePolicy,
} from '../src/execution/index.js'
import {
  LANGUAGE_RETAINED_VALUE_BYTES,
  languageRetainedValues,
} from '../src/node/execution-backends.js'
import { ModkitError } from '@modkit/core'

type Side = 'host' | 'worker'

/** Back-to-back ports with a frame log and an optional tap that rewrites one side's frames. */
class Wire {
  readonly log: { readonly from: Side; readonly frame: Frame }[] = []
  tap: Partial<Record<Side, (frame: Frame) => Frame>> = {}
  private readonly handlers: Record<Side, Set<(frame: unknown) => void>> = {
    host: new Set(),
    worker: new Set(),
  }
  readonly host = this.port('host')
  readonly worker = this.port('worker')

  private port(side: Side): FramePort {
    return {
      post: (frame, transfer) => {
        let cloned = structuredClone(frame, { transfer: [...transfer] }) as Frame
        cloned = this.tap[side]?.(cloned) ?? cloned
        // the receiver owns its frame and resolves retained markers in place; log what was sent
        this.log.push({ from: side, frame: structuredClone(cloned) })
        const targets = this.handlers[side === 'host' ? 'worker' : 'host']
        queueMicrotask(() => {
          for (const handler of targets) handler(cloned)
        })
      },
      onFrame: handler => {
        this.handlers[side].add(handler)
        return () => this.handlers[side].delete(handler)
      },
    }
  }

  inject(to: Side, raw: unknown): void {
    queueMicrotask(() => {
      for (const handler of this.handlers[to]) handler(raw)
    })
  }

  /** Retained markers of the host's call frames, in order: definitions carry a value. */
  markers(): { readonly id: string; readonly defined: boolean }[] {
    const found: { id: string; defined: boolean }[] = []
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(visit)
      else if (typeof value === 'object' && value !== null) {
        const inner = (value as Record<string, unknown>)[RETAINED_MARKER] as
          | { id: string; value?: unknown }
          | undefined
        if (inner !== undefined) found.push({ id: inner.id, defined: 'value' in inner })
        else Object.values(value).forEach(visit)
      }
    }
    for (const entry of this.log) if (entry.from === 'host' && entry.frame.t === 'call') visit(entry.frame.args)
    return found
  }

  frames(t: Frame['t'], from: Side): Frame[] {
    return this.log.filter(entry => entry.from === from && entry.frame.t === t).map(entry => entry.frame)
  }
}

const surfaces = createSurfaceRegistry([
  {
    contract: 'x3.test/retained',
    major: 1,
    methods: {
      take: { kind: 'value' },
      takeTwo: { kind: 'value' },
      mutate: { kind: 'value' },
      checked: {
        kind: 'value',
        validateArgs: args => (args.length === 1 ? undefined : 'expects one argument'),
      },
    },
  },
])

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 5))

interface World {
  readonly wire: Wire
  readonly host: Endpoint
  readonly worker: Endpoint
  readonly received: unknown[]
  readonly failures: { host: (ProtocolViolation | ModkitError)[]; worker: (ProtocolViolation | ModkitError)[] }
  readonly owned: WeakSet<object>
  root(): Promise<RemoteCapability>
}

/** A worker module whose methods record what they received; the host retains `owned` values. */
function world(options: { maxBytes?: number; announce?: boolean } = {}): World {
  const wire = new Wire()
  const received: unknown[] = []
  const owned = new WeakSet<object>()
  const failures = { host: [] as (ProtocolViolation | ModkitError)[], worker: [] as (ProtocolViolation | ModkitError)[] }
  if (options.announce === false) {
    wire.tap.worker = frame => {
      if (frame.t !== 'ready') return frame
      const older: Record<string, unknown> = { ...frame }
      delete older['features']
      return older as unknown as Frame
    }
  }
  const policy: RetainedValuePolicy = {
    isRetainable: value => owned.has(value),
    maxBytes: options.maxBytes ?? 1_000_000,
  }
  const limits = protocolLimits({ defaultCallDeadlineMs: 2_000 })
  const host = createEndpoint({
    role: 'host',
    port: wire.host,
    session: 'retained',
    generation: 1,
    surfaces,
    limits,
    retainedValues: policy,
    onFailure: failure => void failures.host.push(failure),
  })
  const module = {
    take: async (value: unknown) => {
      received.push(value)
      return 'ok'
    },
    takeTwo: async (left: unknown, right: unknown) => {
      received.push(left, right)
      return left === right
    },
    mutate: async (value: { items: string[] }) => {
      received.push(value)
      value.items.push('changed')
      return 'mutated'
    },
    checked: async (value: unknown) => {
      received.push(value)
      return 'checked'
    },
  }
  const worker = createEndpoint({
    role: 'worker',
    port: wire.worker,
    session: 'retained',
    generation: 1,
    surfaces,
    limits,
    loader: async () => ({ module, surface: { contract: 'x3.test/retained', major: 1 } }),
    onFailure: failure => void failures.worker.push(failure),
  })
  return {
    wire,
    host,
    worker,
    received,
    failures,
    owned,
    root: async () =>
      (
        await host.load({
          moduleUrl: 'file:///retained.js',
          contributionId: 'org.example/retained',
          variantId: 'portable',
          artifactDigest: 'sha256:retained',
        })
      ).root,
  }
}

/** A deep-frozen host-owned value, the way language captures are. */
function ownedValue(w: World, label: string, size = 4): Readonly<Record<string, unknown>> {
  const value = Object.freeze({
    label,
    items: Object.freeze(Array.from({ length: size }, (_, index) => `${label}-${index}`)),
    nested: Object.freeze({ count: size }),
  })
  w.owned.add(value)
  return value
}

describe('retained call values', () => {
  it('crosses a host-owned value once and hands every later call the same frozen copy', async () => {
    const w = world()
    const root = await w.root()
    const value = ownedValue(w, 'index')
    await root.call('take', [{ document: 'a', context: value }])
    await root.call('take', [{ document: 'b', context: value }])
    const [first, second] = w.received as { document: string; context: unknown }[]
    expect(first?.document).toBe('a')
    expect(second?.document).toBe('b')
    expect(second?.context).toBe(first?.context)
    expect(second?.context).toEqual(value)
    expect(Object.isFrozen(first?.context)).toBe(true)
    expect(Object.isFrozen((first?.context as { items: unknown }).items)).toBe(true)
    // the request envelope itself is still a fresh, ordinary copy
    expect(Object.isFrozen(first)).toBe(false)
    const markers = w.wire.markers()
    expect(markers).toEqual([
      { id: markers[0]?.id, defined: true },
      { id: markers[0]?.id, defined: false },
    ])
    expect(w.host.counters().retainedValues).toBe(1)
    expect(w.worker.counters().retainedValues).toBe(1)
    expect(w.failures).toEqual({ host: [], worker: [] })
  })

  it('copies caller objects on every call, frozen or not', async () => {
    const w = world()
    const root = await w.root()
    const caller = Object.freeze({ label: 'caller', items: Object.freeze(['x']) })
    await root.call('take', [caller])
    await root.call('take', [caller])
    expect(w.received[0]).not.toBe(w.received[1])
    expect(Object.isFrozen(w.received[0])).toBe(false)
    expect(w.wire.markers()).toEqual([])
  })

  it('defines a value once even when one call carries it twice', async () => {
    const w = world()
    const root = await w.root()
    const value = ownedValue(w, 'twice')
    const outcome = await root.call('takeTwo', [value, value])
    expect(outcome).toEqual({ kind: 'value', value: true })
    expect(w.wire.markers().map(marker => marker.defined)).toEqual([true, false])
  })

  it('sends full copies to a worker that did not announce retained values', async () => {
    const w = world({ announce: false })
    const root = await w.root()
    const value = ownedValue(w, 'old-worker')
    await root.call('take', [value])
    await root.call('take', [value])
    expect(w.wire.markers()).toEqual([])
    expect(w.received[0]).not.toBe(w.received[1])
    expect(w.host.counters().retainedValues).toBe(0)
  })

  it('sends full copies to methods that validate their wire arguments', async () => {
    const w = world()
    const root = await w.root()
    const value = ownedValue(w, 'checked')
    await root.call('checked', [value])
    await root.call('checked', [value])
    expect(w.wire.markers()).toEqual([])
  })

  it('releases the least recently used copies beyond the budget and defines them again later', async () => {
    const probe = world()
    const measure = ownedValue(probe, 'a', 64)
    await (await probe.root()).call('take', [measure])
    const oneValue = probe.host.counters().retainedBytes
    expect(oneValue).toBeGreaterThan(0)

    const w = world({ maxBytes: oneValue + 1 })
    const root = await w.root()
    const first = ownedValue(w, 'a', 64)
    const second = ownedValue(w, 'b', 64)
    await root.call('take', [first])
    await root.call('take', [second])
    await settle()
    const releases = w.wire.frames('retain-release', 'host') as { ids: readonly string[] }[]
    const [definedFirst] = w.wire.markers()
    expect(releases.map(frame => frame.ids)).toEqual([[definedFirst?.id]])
    expect(w.worker.counters().retainedValues).toBe(1)

    await root.call('take', [first])
    const markers = w.wire.markers()
    expect(markers.at(-1)?.defined).toBe(true)
    expect(markers.at(-1)?.id).not.toBe(definedFirst?.id)
    expect(w.received.at(-1)).toEqual(first)
    expect(w.failures).toEqual({ host: [], worker: [] })
  })

  it('keeps nothing staged when the call never leaves', async () => {
    const w = world()
    const root = await w.root()
    const bad = Object.freeze({ label: 'bad', run: () => undefined })
    w.owned.add(bad)
    await expect(root.call('take', [bad])).rejects.toMatchObject({ code: 'x3.host/rpc-bad-retained' })
    expect(w.host.counters().retainedValues).toBe(0)
    const good = ownedValue(w, 'good')
    await root.call('take', [good])
    expect(w.wire.markers()).toEqual([{ id: w.wire.markers()[0]?.id, defined: true }])
    expect(w.received).toEqual([good])
  })

  it('makes provider mutation of a kept copy fail instead of leaking into later calls', async () => {
    const w = world()
    const root = await w.root()
    const value = ownedValue(w, 'frozen')
    await expect(root.call('mutate', [value])).rejects.toThrow()
    await root.call('take', [value])
    expect(w.received.at(-1)).toEqual(value)
  })

  it('fails closed on a reference the worker does not hold', async () => {
    const w = world()
    await w.root()
    w.wire.inject('worker', {
      domain: CAPABILITY_RPC_DOMAIN,
      version: CAPABILITY_RPC_VERSION,
      session: 'retained',
      generation: 1,
      id: 99,
      t: 'call',
      handle: 'w1-1',
      method: 'take',
      args: [{ [RETAINED_MARKER]: { id: 'r404' } }],
    })
    await settle()
    expect(w.failures.worker.map(failure => ('code' in failure ? failure.code : ''))).toContain(
      'unknown-retained',
    )
    expect(w.worker.state).not.toBe('open')
  })

  it('refuses retained markers and releases a worker sends to its host', async () => {
    const w = world()
    await w.root()
    w.wire.inject('host', {
      domain: CAPABILITY_RPC_DOMAIN,
      version: CAPABILITY_RPC_VERSION,
      session: 'retained',
      generation: 1,
      id: 50,
      t: 'retain-release',
      ids: ['r0'],
    })
    await settle()
    expect(w.failures.host.map(failure => ('code' in failure ? failure.code : ''))).toContain(
      'bad-retained',
    )
  })

  // Needs `--expose-gc`; `pnpm exec vitest` gets it through NODE_OPTIONS in the retained-values run.
  it.runIf(typeof (globalThis as { gc?: unknown }).gc === 'function')(
    'releases the worker copy once the host collects the value',
    async () => {
      const w = world()
      const root = await w.root()
      const kept = ownedValue(w, 'kept')
      await (async () => {
        // the only reference to this value lives inside this function
        await root.call('take', [ownedValue(w, 'dropped')])
      })()
      await root.call('take', [kept])
      w.received.length = 0
      expect(w.worker.counters().retainedValues).toBe(2)
      for (let attempt = 0; attempt < 50 && w.host.counters().retainedValues > 1; attempt += 1) {
        ;(globalThis as unknown as { gc: () => void }).gc()
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      await settle()
      expect(w.host.counters().retainedValues).toBe(1)
      expect(w.worker.counters().retainedValues).toBe(1)
      expect(w.wire.frames('retain-release', 'host')).toHaveLength(1)
      await root.call('take', [kept])
      expect(w.wire.markers().at(-1)?.defined).toBe(false)
    },
  )

  it('forgets every copy when the endpoints close', async () => {
    const w = world()
    const root = await w.root()
    await root.call('take', [ownedValue(w, 'closing')])
    await w.host.close('test over')
    await settle()
    expect(w.host.counters().retainedValues).toBe(0)
    expect(w.worker.counters().retainedValues).toBe(0)
  })
})

describe('the language captures a Node worker keeps', () => {
  const mebibyte = 1_048_576
  it('follow twice the resolved Data a host holds, never below the default', () => {
    expect(languageRetainedValues(512 * mebibyte).maxBytes).toBe(1_024 * mebibyte)
    expect(languageRetainedValues(64 * mebibyte).maxBytes).toBe(LANGUAGE_RETAINED_VALUE_BYTES)
    expect(languageRetainedValues(0).maxBytes).toBe(LANGUAGE_RETAINED_VALUE_BYTES)
    expect(languageRetainedValues(Number.NaN).maxBytes).toBe(LANGUAGE_RETAINED_VALUE_BYTES)
    expect(languageRetainedValues(512 * mebibyte).isRetainable({})).toBe(false)
  })
})
