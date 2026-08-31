/**
 * The kit's own capability world: a tiny module → codec → session → data-source chain with one
 * method of every kind (`value`, `lease` in both wrappers, `iterable`, `events`), a host-side
 * source the worker calls back into, and knobs for misbehaviour (hangs, failures, floods).
 *
 * These are **test-only** contracts (`x3.testkit/*`); the kit never embeds standard surfaces —
 * that authority is NXT-103 in `sdk`, and production transports are exercised with the same
 * world, so the run does not depend on any production data.
 */

import { ModkitError, OperationCancelledError } from '@modkit/core'
import {
  createSurfaceRegistry,
  type LoadRequest,
  type LoadedModule,
  type SurfaceRegistry,
} from '@modkit/host/execution'

export const DEMO_MODULE = { contract: 'x3.testkit/module', major: 1 } as const
export const DEMO_CODEC = { contract: 'x3.testkit/codec', major: 1 } as const
export const DEMO_SESSION = { contract: 'x3.testkit/session', major: 1 } as const
export const DEMO_TEXT = { contract: 'x3.testkit/text', major: 1 } as const
export const DEMO_SOURCE = { contract: 'x3.testkit/source', major: 1 } as const

export const DEMO_SURFACES: SurfaceRegistry = createSurfaceRegistry([
  {
    ...DEMO_MODULE,
    methods: { createCodec: { kind: 'lease', result: DEMO_CODEC } },
  },
  {
    ...DEMO_CODEC,
    methods: {
      probe: { kind: 'value', signal: 'last' },
      open: { kind: 'lease', result: DEMO_SESSION },
    },
  },
  {
    ...DEMO_SESSION,
    releaseVia: 'dispose',
    methods: {
      descriptor: { kind: 'value' },
      dataSource: { kind: 'lease', result: DEMO_TEXT, wrapper: 'lease' },
      search: { kind: 'iterable' },
      slowSearch: { kind: 'iterable' },
      events: { kind: 'events' },
      dispose: { kind: 'value' },
      hang: { kind: 'value', signal: 'last' },
      boom: { kind: 'value' },
      bytes: { kind: 'value' },
      echo: { kind: 'value' },
      leak: { kind: 'lease', result: DEMO_TEXT },
      badReturn: { kind: 'value' },
      checked: {
        kind: 'value',
        validateArgs: args =>
          args.length === 1 && typeof args[0] === 'number' ? undefined : 'expects one number',
      },
    },
  },
  {
    ...DEMO_TEXT,
    methods: { slice: { kind: 'value' }, size: { kind: 'value' } },
  },
  {
    ...DEMO_SOURCE,
    methods: { read: { kind: 'value', signal: 'last' }, size: { kind: 'value' } },
  },
])

export interface DemoWorld {
  readonly module: Record<string, unknown>
  readonly log: string[]
  readonly released: { text: number; session: number; module: number }
  readonly eventsControl: { fail: boolean; count: number; delayMs: number }
  /** The `loader` an executing endpoint uses to serve `load` for this world. */
  readonly loader: (request: LoadRequest) => Promise<LoadedModule>
}

export function createDemoWorld(): DemoWorld {
  const log: string[] = []
  const released = { text: 0, session: 0, module: 0 }
  const eventsControl = { fail: false, count: 3, delayMs: 0 }
  const text = {
    slice: async (from: number, to: number) => 'hello world'.slice(from, to),
    size: async () => 11,
  }
  const session = {
    descriptor: async () => ({ id: 'demo', traits: ['content.text'] }),
    dataSource: async (contract: string) => {
      log.push(`dataSource:${contract}`)
      return { value: text, release: async () => void (released.text += 1) }
    },
    search: async function* (query: string) {
      for (const item of ['alpha', 'beta', 'gamma']) if (item.includes(query)) yield item
    },
    /** Each item takes a real event-loop hop, so two overlapping `next` frames are observable. */
    slowSearch: async function* (query: string) {
      for (const item of ['alpha', 'beta', 'gamma']) {
        await new Promise(resolve => setTimeout(resolve, 15))
        if (item.includes(query)) yield item
      }
    },
    events: async function* () {
      for (let i = 0; i < eventsControl.count; i += 1) {
        if (eventsControl.delayMs > 0)
          await new Promise(resolve => setTimeout(resolve, eventsControl.delayMs))
        yield { tick: i }
      }
      if (eventsControl.fail)
        throw new ModkitError({
          code: 'x3.testkit/stream-failed',
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
        code: 'x3.testkit/boom',
        message: 'kaboom',
        context: { where: 'worker' },
        retryability: 'safe',
      })
    },
    bytes: async () => new Uint8Array([9, 8, 7]),
    echo: async (value: unknown) => value,
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
      return { codecId: 'x3.testkit/plain', confidence: 0.9, size, head: [...head] }
    },
    open: async () => session,
  }
  const module = { abiVersion: 1, createCodec: () => codec }
  const loader = async (request: LoadRequest): Promise<LoadedModule> => {
    log.push(`load:${request.contributionId}#${request.variantId}`)
    return {
      module,
      surface: DEMO_MODULE,
      release: () => void (released.module += 1),
    }
  }
  return { module, log, released, eventsControl, loader }
}

export const DEMO_LOAD_REQUEST: LoadRequest = Object.freeze({
  moduleUrl: 'file:///testkit/demo/codec.js',
  contributionId: 'org.example/testkit-demo',
  variantId: 'portable',
  artifactDigest: 'sha256:testkit-demo',
})
