import type { RasterResourceRequest, RasterResourceResult, SceneRenderRequest } from '@modkit/sdk'
import { getEventListeners } from 'node:events'
import { describe, expect, it } from 'vitest'
import { effectFraming, rememberingRasterPort, withModelEffectLayer } from '../src/model/effects.js'

const triangle = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0])
const decoded: RasterResourceResult = {
  state: 'decoded',
  info: {
    width: 1,
    height: 1,
    depth: 1,
    layers: 1,
    faces: 1,
    mipLevels: 1,
    frames: 1,
    channels: 4,
    bitDepth: 8,
    colorSpace: 'srgb',
    alphaMode: 'straight',
    orientation: 'top-left',
    decodedAccess: true,
  },
  region: {
    width: 1,
    height: 1,
    rowStride: 4,
    pixelFormat: 'rgba8',
    pixels: Uint8Array.of(1, 2, 3, 255),
  },
  diagnostics: [],
}
const logical: RasterResourceRequest = {
  kind: 'logical',
  maxBytes: 1024,
  requirement: { id: 't', logicalId: 'spark.blp', role: 'texture', scopes: ['sibling-directory'] },
}
const embedded: RasterResourceRequest = {
  kind: 'embedded',
  maxBytes: 1024,
  bytes: new Uint8Array(1),
}
function pendingRaster() {
  let resolve!: (value: RasterResourceResult) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<RasterResourceResult>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const stage: SceneRenderRequest = {
  scene: {
    primitives: [{ id: 'hull', topology: 'triangles', positions: triangle, materialId: 'm' }],
    materials: [{ id: 'm', baseColor: [1, 1, 1, 1] }],
  },
  camera: { viewProjection: new Float32Array(16) },
  viewport: { width: 4, height: 4 },
  outputKind: 'rgba8',
}

describe('the effects of a model as a layer of its frame', () => {
  it('adds only the effect primitives, back in source units, with their materials and textures renamed', () => {
    const merged = withModelEffectLayer(stage, {
      metersPerSourceUnit: 0.5,
      effectPrimitiveIds: ['uvm-effect-particle-0'],
      request: {
        ...stage,
        scene: {
          primitives: [
            { id: 'mesh-0-primitive-0', topology: 'triangles', positions: triangle },
            {
              id: 'uvm-effect-particle-0',
              topology: 'triangles',
              positions: triangle,
              materialId: 'm',
              transform: Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 0, 0, 1]),
            },
          ],
          materials: [
            {
              id: 'm',
              baseColor: [1, 0.5, 0, 1],
              baseColorTexture: 'uvm-texture-1',
              textureBindings: [{ resourceId: 'spark', textureId: 'uvm-texture-1' }],
            },
          ],
          textures: [
            { id: 'uvm-texture-1', width: 1, height: 1, rgba: new Uint8Array(4) },
            { id: 'uvm-texture-2', width: 1, height: 1, rgba: new Uint8Array(4) },
          ],
        },
      },
    })
    expect(merged.scene.primitives.map(item => item.id)).toEqual([
      'hull',
      'effect:uvm-effect-particle-0',
    ])
    const effect = merged.scene.primitives[1]
    expect(effect?.materialId).toBe('effect:m')
    // metres back to source units: two source units per metre, the translation included
    expect(Array.from(effect?.transform ?? [])).toEqual([
      2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 6, 0, 0, 1,
    ])
    expect(merged.scene.materials?.map(item => item.id)).toEqual(['m', 'effect:m'])
    expect(merged.scene.materials?.[1]).toMatchObject({
      baseColorTexture: 'effect:uvm-texture-1',
      textureBindings: [{ resourceId: 'spark', textureId: 'effect:uvm-texture-1' }],
    })
    expect(merged.scene.textures?.map(item => item.id)).toEqual(['effect:uvm-texture-1'])
    // a frame without effects leaves the stage's request as it was
    expect(
      withModelEffectLayer(stage, {
        request: stage,
        metersPerSourceUnit: 1,
        effectPrimitiveIds: [],
      }),
    ).toBe(stage)
  })

  it('frames the same model in the frame’s metres', () => {
    expect(effectFraming({ center: [1, 2, 3], radius: 4 }, 0.5)).toEqual({
      center: [0.5, 1, 1.5],
      radius: 2,
    })
  })

  it('reads a named texture once, an embedded one every time, and asks again after a failure', async () => {
    const asked: string[] = []
    let fail = true
    const port = rememberingRasterPort(
      {
        async read(request) {
          asked.push(request.kind)
          if (request.kind === 'logical' && fail) {
            fail = false
            throw new Error('busy')
          }
          return decoded
        },
      },
      new AbortController().signal,
    )
    const logical = {
      kind: 'logical',
      maxBytes: 1024,
      requirement: {
        id: 't',
        logicalId: 'spark.blp',
        role: 'texture',
        scopes: ['sibling-directory'],
      },
    } as unknown as RasterResourceRequest
    await expect(port.read(logical)).rejects.toThrow('busy')
    await port.read(logical)
    await port.read(logical)
    const embedded = { kind: 'embedded', maxBytes: 1024, bytes: new Uint8Array(1) } as const
    await port.read(embedded)
    await port.read(embedded)
    expect(asked).toEqual(['logical', 'logical', 'embedded', 'embedded'])
  })
})

describe('the model effect raster cache lifecycle', () => {
  it.each(['compressed', 'decoded-surfaces'] as const)(
    'retains a successful %s result and still checks cancellation on its cache hits',
    async state => {
      const root = new AbortController(),
        caller = new AbortController()
      const subresource = { frame: 0, mipLevel: 0, layer: 0, face: 0, slice: 0 }
      const value: RasterResourceResult =
        state === 'decoded-surfaces'
          ? {
              state,
              info: decoded.info,
              surfaces: [{ subresource, region: decoded.region }],
              diagnostics: [],
            }
          : {
              state,
              info: {
                ...decoded.info,
                width: 4,
                height: 4,
                channels: 3,
                alphaMode: 'none',
                compression: 'bc1',
              },
              subresource,
              diagnostics: [],
              texture: {
                schemaVersion: 1,
                format: 'bc1-rgb-unorm',
                dimensions: { width: 4, height: 4, depth: 1 },
                mipLevelCount: 1,
                layerCount: 1,
                faceCount: 1,
                colorSpace: 'srgb',
                alphaMode: 'none',
                block: { width: 4, height: 4, depth: 1, bytes: 8 },
                subresources: [
                  {
                    mipLevel: 0,
                    layer: 0,
                    face: 0,
                    depthSlice: 0,
                    width: 4,
                    height: 4,
                    depth: 1,
                    data: new Uint8Array(8),
                  },
                ],
                source: {
                  codecId: 'test/blocks',
                  containerFormat: 'dds',
                  preservation: 'source-bytes',
                },
              },
            }
      const request: RasterResourceRequest =
        state === 'decoded-surfaces'
          ? { ...logical, selection: { face: 'all' } }
          : { ...logical, compressedFormats: ['bc1-rgb-unorm'] }
      let reads = 0
      const port = rememberingRasterPort(
        {
          read: async () => {
            reads++
            return value
          },
        },
        root.signal,
      )
      expect(await port.read(request)).toBe(value)
      expect(await port.read(request)).toBe(value)
      expect(reads).toBe(1)
      caller.abort(new Error('variant frame stopped'))
      await expect(port.read(request, caller.signal)).rejects.toThrow('variant frame stopped')
      root.abort(new Error('variant model closed'))
      await expect(port.read(request)).rejects.toThrow('variant model closed')
      expect(reads).toBe(1)
    },
  )

  it('does not retain a lifetime listener when constructed after the model closed', async () => {
    const root = new AbortController()
    root.abort(new Error('already closed'))
    let calls = 0
    const port = rememberingRasterPort(
      {
        read: async () => {
          calls++
          return decoded
        },
      },
      root.signal,
    )
    await expect(port.read(logical)).rejects.toThrow('already closed')
    expect(calls).toBe(0)
    expect(getEventListeners(root.signal, 'abort')).toHaveLength(0)
  })
  it.each(['root', 'caller'] as const)(
    'checks %s cancellation between provider settlement and the frame continuation',
    async which => {
      const root = new AbortController(),
        caller = new AbortController()
      const port = rememberingRasterPort({ read: () => Promise.resolve(decoded) }, root.signal)
      const result = port.read(logical, caller.signal)
      queueMicrotask(() =>
        (which === 'root' ? root : caller).abort(new Error('settled frame cancelled')),
      )
      await expect(result).rejects.toThrow('settled frame cancelled')
      expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0)
    },
  )

  it('retries a provider that throws before returning its promise', async () => {
    let calls = 0
    const port = rememberingRasterPort(
      {
        read() {
          if (++calls === 1) throw new Error('synchronous provider failure')
          return Promise.resolve(decoded)
        },
      },
      new AbortController().signal,
    )
    await expect(port.read(logical)).rejects.toThrow('synchronous provider failure')
    expect(await port.read(logical)).toBe(decoded)
    expect(calls).toBe(2)
  })
  it('retries unresolved and rejected reads, deduplicates in-flight work and retains successful pixels', async () => {
    const pending = pendingRaster()
    let calls = 0
    const port = rememberingRasterPort(
      {
        read: async () => {
          calls++
          if (calls === 1) return { state: 'unresolved', diagnostics: [] }
          if (calls === 2) throw new Error('retryable')
          return pending.promise
        },
      },
      new AbortController().signal,
    )
    expect((await port.read(logical)).state).toBe('unresolved')
    await expect(port.read(logical)).rejects.toThrow('retryable')
    const a = port.read(logical),
      b = port.read(logical)
    pending.resolve(decoded)
    expect(await a).toBe(decoded)
    expect(await b).toBe(decoded)
    expect(await port.read(logical)).toBe(decoded)
    expect(calls).toBe(3)
  })

  it.each(['miss', 'hit', 'embedded'] as const)(
    'refuses a pre-aborted caller on a %s without provider work',
    async kind => {
      let calls = 0
      const port = rememberingRasterPort(
        {
          read: async () => {
            calls++
            return decoded
          },
        },
        new AbortController().signal,
      )
      if (kind === 'hit') await port.read(logical)
      const before = calls,
        caller = new AbortController()
      caller.abort(new Error('caller stopped'))
      await expect(
        port.read(kind === 'embedded' ? embedded : logical, caller.signal),
      ).rejects.toThrow('caller stopped')
      expect(calls).toBe(before)
    },
  )

  it('isolates one cancelled waiter and keeps the root-owned read for other and later waiters', async () => {
    const root = new AbortController(),
      caller = new AbortController(),
      pending = pendingRaster()
    let calls = 0,
      providerSignal: AbortSignal | undefined
    const port = rememberingRasterPort(
      {
        read: async (_request, signal) => {
          calls++
          providerSignal = signal
          return pending.promise
        },
      },
      root.signal,
    )
    const a = port.read(logical, caller.signal),
      b = port.read(logical)
    const rejected = expect(a).rejects.toThrow('one frame stopped')
    caller.abort(new Error('one frame stopped'))
    await rejected
    expect(providerSignal).toBe(root.signal)
    expect(providerSignal?.aborted).toBe(false)
    const later = port.read(logical)
    expect(calls).toBe(1)
    pending.resolve(decoded)
    expect(await b).toBe(decoded)
    expect(await later).toBe(decoded)
    expect(await port.read(logical)).toBe(decoded)
    expect(calls).toBe(1)
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0)
  })

  it('rejects root cancellation while the provider ignores it and never publishes its late result', async () => {
    const root = new AbortController(),
      caller = new AbortController(),
      pending = pendingRaster()
    let calls = 0
    const port = rememberingRasterPort(
      {
        read: async () => {
          calls++
          return pending.promise
        },
      },
      root.signal,
    )
    const a = port.read(logical, caller.signal),
      b = port.read(logical)
    const rejectedA = expect(a).rejects.toThrow('model closed'),
      rejectedB = expect(b).rejects.toThrow('model closed')
    root.abort(new Error('model closed'))
    await Promise.all([rejectedA, rejectedB])
    pending.resolve(decoded)
    await pending.promise
    await expect(port.read(logical)).rejects.toThrow('model closed')
    expect(calls).toBe(1)
    expect(getEventListeners(root.signal, 'abort')).toHaveLength(0)
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0)
  })

  it.each(['miss', 'hit', 'embedded'] as const)('checks a closed root on a %s', async kind => {
    const root = new AbortController()
    let calls = 0
    const port = rememberingRasterPort(
      {
        read: async () => {
          calls++
          return decoded
        },
      },
      root.signal,
    )
    if (kind === 'hit') await port.read(logical)
    const before = calls
    root.abort(new Error('model closed'))
    await expect(port.read(kind === 'embedded' ? embedded : logical)).rejects.toThrow(
      'model closed',
    )
    expect(calls).toBe(before)
  })

  it('forwards cancellation to uncached embedded work without cancelling the root', async () => {
    const root = new AbortController(),
      caller = new AbortController(),
      pending = pendingRaster()
    let providerSignal: AbortSignal | undefined,
      calls = 0
    const port = rememberingRasterPort(
      {
        read: async (_request, signal) => {
          calls++
          providerSignal = signal
          return calls === 1 ? pending.promise : decoded
        },
      },
      root.signal,
    )
    const result = port.read(embedded, caller.signal)
    const rejected = expect(result).rejects.toThrow('embedded stopped')
    caller.abort(new Error('embedded stopped'))
    await rejected
    expect(providerSignal?.aborted).toBe(true)
    expect(root.signal.aborted).toBe(false)
    pending.reject(new Error('late underlying failure'))
    await expect(pending.promise).rejects.toThrow('late underlying failure')
    expect(await port.read(embedded)).toBe(decoded)
    expect(await port.read(embedded)).toBe(decoded)
    expect(calls).toBe(3)
  })

  it('keeps budget, subresource selection and compressed-format preferences in the key', async () => {
    let calls = 0
    const port = rememberingRasterPort(
      {
        read: async () => {
          calls++
          return decoded
        },
      },
      new AbortController().signal,
    )
    const requests: RasterResourceRequest[] = [
      logical,
      { ...logical, maxBytes: 2048 },
      { ...logical, selection: { mipLevel: 1 } },
      { ...logical, compressedFormats: ['bc1-rgb-unorm'] },
    ]
    for (const request of requests) await port.read(request)
    for (const request of requests) await port.read(request)
    expect(calls).toBe(4)
  })

  it.each(['resolve', 'reject'] as const)(
    'removes per-waiter listeners after provider %s',
    async outcome => {
      const root = new AbortController(),
        caller = new AbortController(),
        pending = pendingRaster()
      const port = rememberingRasterPort({ read: () => pending.promise }, root.signal)
      const rootBaseline = getEventListeners(root.signal, 'abort').length
      const result = port.read(logical, caller.signal)
      if (outcome === 'resolve') {
        pending.resolve(decoded)
        expect(await result).toBe(decoded)
      } else {
        pending.reject(new Error('provider failed'))
        await expect(result).rejects.toThrow('provider failed')
      }
      expect(getEventListeners(root.signal, 'abort')).toHaveLength(rootBaseline)
      expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0)
      root.abort()
      expect(getEventListeners(root.signal, 'abort')).toHaveLength(0)
    },
  )
})
