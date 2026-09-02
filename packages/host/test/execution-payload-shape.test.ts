import { describe, expect, it } from 'vitest'
import {
  capabilitySurfaceFromDataSource,
  createEndpoint,
  createStandardSurfaceRegistry,
  protocolLimits,
  type Endpoint,
  type Frame,
  type FramePort,
  type SurfaceRegistry,
} from '../src/execution/index.js'

/**
 * What a multi-buffer result costs at the capability boundary.
 *
 * Wave 2B found an audio stage that took a minute per `readPcm` while the image stage's
 * `readRegion` over the same RPC was instant, and the visible difference was the SHAPE of the
 * result: several typed arrays in an array rather than one. This pins the answer so a future API
 * that returns several buffers — audio channels, image subresources, sprite frames — cannot
 * quietly reintroduce a per-element path, and so the next person does not have to rediscover it
 * through a ten-minute installed run.
 *
 * The numbers are deliberately loose: this is a shape regression guard, not a performance target.
 * A per-element crossing is orders of magnitude slower than a buffer crossing, so a ceiling that a
 * healthy machine clears by 100x still catches it.
 */

function loopback(): { a: FramePort; b: FramePort } {
  const handlers = { a: new Set<(f: unknown) => void>(), b: new Set<(f: unknown) => void>() }
  const port = (side: 'a' | 'b'): FramePort => ({
    post: (frame: Frame, transfer) => {
      const cloned = structuredClone(frame, { transfer: [...transfer] })
      const targets = handlers[side === 'a' ? 'b' : 'a']
      queueMicrotask(() => {
        for (const handler of targets) handler(cloned)
      })
    },
    onFrame: handler => {
      handlers[side].add(handler)
      return () => handlers[side].delete(handler)
    },
  })
  return { a: port('a'), b: port('b') }
}

function endpoints(
  surfaces: SurfaceRegistry,
  module: Record<string, unknown>,
): { host: Endpoint; failures: unknown[] } {
  const wire = loopback()
  const failures: unknown[] = []
  const limits = protocolLimits({ defaultCallDeadlineMs: 30_000 })
  const host = createEndpoint({
    role: 'host',
    port: wire.a,
    session: 'shape',
    generation: 1,
    surfaces,
    limits,
    onFailure: failure => void failures.push(failure),
  })
  createEndpoint({
    role: 'worker',
    port: wire.b,
    session: 'shape',
    generation: 1,
    surfaces,
    limits,
    loader: async () => ({ module, surface: { contract: 'x3.test/root', major: 1 } }),
    onFailure: failure => void failures.push(failure),
  })
  return { host, failures }
}

const load = {
  moduleUrl: 'file:///shape.js',
  contributionId: 'org.example/shape',
  variantId: 'v',
  artifactDigest: 'd',
}

/** One real StarCraft II UI sound: 3 985 ms of 44 100 Hz stereo. */
const FRAMES = 175_740
const CHANNELS = 2

describe('capability boundary — result shape', () => {
  const surface = capabilitySurfaceFromDataSource('x3.test/payload', 1, {
    methods: { oneBuffer: { kind: 'value' }, manyBuffers: { kind: 'value' } },
  })
  const registry = createStandardSurfaceRegistry({
    surfaces: [
      surface,
      {
        contract: 'x3.test/root',
        major: 1,
        methods: { payload: { kind: 'lease', result: { contract: 'x3.test/payload', major: 1 } } },
      },
    ],
  })

  const target = {
    async oneBuffer() {
      return { pixels: new Uint8Array(FRAMES * CHANNELS * 4) }
    },
    async manyBuffers() {
      return {
        sampleRate: 44_100,
        fromFrame: 0n,
        frameCount: FRAMES,
        channels: Array.from({ length: CHANNELS }, () => new Float32Array(FRAMES)),
      }
    },
  }

  const proxy = async () => {
    const pair = endpoints(registry, { payload: () => target })
    const loaded = await pair.host.load(load)
    const root = pair.host.materialize(loaded.root)
    const value = (await (root['payload'] as () => Promise<Record<string, unknown>>)()) as {
      oneBuffer(): Promise<{ pixels: Uint8Array }>
      manyBuffers(): Promise<{ frameCount: number; channels: readonly Float32Array[] }>
    }
    return { value, failures: pair.failures }
  }

  it('carries one large buffer across without walking its elements', async () => {
    const { value, failures } = await proxy()
    const started = performance.now()
    const result = await value.oneBuffer()
    const elapsed = performance.now() - started
    expect(result.pixels.byteLength).toBe(FRAMES * CHANNELS * 4)
    expect(elapsed).toBeLessThan(2_000)
    expect(failures).toEqual([])
  })

  it('carries several buffers across at the same order of cost, not per element', async () => {
    const { value, failures } = await proxy()
    const started = performance.now()
    const result = await value.manyBuffers()
    const elapsed = performance.now() - started
    expect(result.frameCount).toBe(FRAMES)
    expect(result.channels).toHaveLength(CHANNELS)
    expect(result.channels[0]).toBeInstanceOf(Float32Array)
    expect(result.channels[0]?.length).toBe(FRAMES)
    /*
     * The ceiling that matters. A per-element crossing of 351 480 floats takes tens of seconds;
     * a buffer crossing takes milliseconds. Anything under two seconds is the second kind.
     */
    expect(elapsed).toBeLessThan(2_000)
    expect(failures).toEqual([])
  })
})
