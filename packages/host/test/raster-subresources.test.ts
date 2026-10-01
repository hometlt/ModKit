import { join } from 'node:path'
import { beforeAll, expect, it } from 'vitest'
import type { RasterImageSource, RasterRegionRequest, RasterResourceSelection } from '@modkit/sdk'
import {
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openSubject,
} from '../src/index.js'
import { loadExtensionDirectory } from '../src/node/index.js'
import { createSubjectRasterResources } from '../src/raster-resources.js'
import { cubeTextureFixture } from '../../testkit/test/fixtures/cube-texture.js'

const root = join(import.meta.dirname, '../../..')
const budget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 10000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'raster-subresources', classes: ['read-source'] } as const
const backends = createExecutionBackendRegistry([
  {
    profile: 'trusted-in-process',
    supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
    async activate(context) {
      return {
        module: (await import(context.entrypoint.href)) as Record<string, unknown>,
        release: async () => undefined,
      }
    },
  },
])
let inventory: Awaited<ReturnType<typeof buildInventory>>
beforeAll(async () => {
  inventory = await buildInventory(
    [
      {
        ...(await loadExtensionDirectory(join(root, 'extensions/images'))),
        execution: { origin: 'bundled', allowTrustedInProcess: true },
      },
    ],
    createHostContributionContractRegistry(),
  )
})
function fixture(
  hooks: {
    afterInfo?: () => void
    afterRead?: (request: RasterRegionRequest) => void | Promise<void>
  } = {},
) {
  const state = { live: true, authorized: true, reservedBytes: 0 }
  const counts = { opened: 0, disposed: 0 }
  const rasterCounts = { leases: 0, released: 0, faces: [] as number[] }
  const port = createSubjectRasterResources({
    state,
    budget,
    isAuthorized: () => state.authorized,
    async open(source, hint) {
      counts.opened++
      const opened = await openSubject({
        inventory,
        executionBackends: backends,
        source,
        ...hint,
        target,
        grant,
        budget,
        intent: 'full',
      })
      if (opened.state !== 'opened') return opened
      return {
        ...opened,
        session: {
          ...opened.session,
          async dataSource(contract, major) {
            const lease = await opened.session.dataSource(contract, major)
            if (contract !== 'common.view/raster-image-source') return lease
            const raster = lease.value as RasterImageSource
            const readRegion = raster.readRegion
            if (readRegion === undefined) throw new Error('fixture image does not decode regions')
            rasterCounts.leases++
            return {
              ...lease,
              value: {
                ...lease.value,
                async info(signal?: AbortSignal) {
                  const result = await raster.info(signal)
                  hooks.afterInfo?.()
                  return result
                },
                async readRegion(request: RasterRegionRequest, signal?: AbortSignal) {
                  rasterCounts.faces.push(request.face ?? 0)
                  const result = await readRegion.call(raster, request, signal)
                  await hooks.afterRead?.(request)
                  return result
                },
              },
              async release() {
                rasterCounts.released++
                await lease.release()
              },
            }
          },
          async dispose() {
            counts.disposed++
            await opened.session.dispose()
          },
        },
      }
    },
  })
  return { port, counts, rasterCounts, state, ...cubeTextureFixture() }
}

it('acquires all six faces in one codec lease, preserving pixels, mip and owned buffers', async () => {
  const f = fixture()
  const selection: { face: 'all'; mipLevel: number } = { face: 'all', mipLevel: 1 }
  const reading = f.port.read({
    kind: 'embedded',
    bytes: f.bytes,
    mediaType: 'image/vnd-ms.dds',
    maxBytes: 6 * 2 * 2 * 4,
    selection,
  })
  selection.mipLevel = 0
  const result = await reading
  if (result.state !== 'decoded-surfaces') throw new Error(JSON.stringify(result))
  // two stored levels and the 1x1 computed one (15b2d098)
  expect(result.info).toMatchObject({
    width: 4,
    height: 4,
    faces: 6,
    mipLevels: 3,
    storedMipLevels: 2,
  })
  expect(result.surfaces).toHaveLength(6)
  for (const [face, surface] of result.surfaces.entries()) {
    expect(surface.subresource).toEqual({ frame: 0, layer: 0, face, mipLevel: 1, slice: 0 })
    expect(surface.region).toMatchObject({
      width: 2,
      height: 2,
      rowStride: 8,
      pixelFormat: 'rgba8',
    })
    expect(surface.region.pixels).toEqual(f.surfaces[face]?.[1])
    expect(surface.region.pixels.byteLength).toBe(surface.region.pixels.buffer.byteLength)
  }
  expect(new Set(result.surfaces.map(surface => surface.region.pixels.buffer)).size).toBe(6)
  expect(f.counts).toEqual({ opened: 1, disposed: 1 })
  expect(f.state.reservedBytes).toBe(0)
})

it('selects one face while default reads retain the first-surface response', async () => {
  const f = fixture()
  const read = (selection?: RasterResourceSelection) =>
    f.port.read({
      kind: 'embedded',
      bytes: f.bytes,
      maxBytes: 64,
      ...(selection === undefined ? {} : { selection }),
    })
  const first = await read(),
    last = await read({ face: 5 })
  if (first.state !== 'decoded' || last.state !== 'decoded') throw new Error('DDS surface absent')
  expect(first.subresource).toBeUndefined()
  expect(first.region.pixels).toEqual(f.surfaces[0]?.[0])
  expect(last.subresource?.face).toBe(5)
  expect(last.region.pixels).toEqual(f.surfaces[5]?.[0])
  f.bytes.fill(0)
  expect(last.region.pixels).toEqual(f.surfaces[5]?.[0])
  expect(f.counts).toEqual({ opened: 2, disposed: 2 })
})

it('selects the most detailed mip that fits without reopening the raster source', async () => {
  const f = fixture()
  const result = await f.port.read({
    kind: 'embedded',
    bytes: f.bytes,
    maxBytes: 16,
    selection: { mipLevel: 'fit' },
  })
  if (result.state !== 'decoded') throw new Error(JSON.stringify(result))
  expect(result.subresource).toEqual({ frame: 0, layer: 0, face: 0, mipLevel: 1, slice: 0 })
  expect(result.region).toMatchObject({ width: 2, height: 2, rowStride: 8 })
  expect(result.region.pixels).toEqual(f.surfaces[0]?.[1])
  expect(f.counts).toEqual({ opened: 1, disposed: 1 })
  expect(f.rasterCounts).toEqual({ leases: 1, released: 1, faces: [0] })
  expect(f.state.reservedBytes).toBe(0)
})

it('holds a fit read to what the subject budget has left instead of refusing it', async () => {
  const f = fixture()
  // the subject budget is 1 000 000 bytes: a caller asking for more still gets a fitting level
  const fitted = await f.port.read({
    kind: 'embedded',
    bytes: f.bytes,
    maxBytes: 2_000_000,
    selection: { mipLevel: 'fit' },
  })
  if (fitted.state !== 'decoded') throw new Error(JSON.stringify(fitted))
  expect(fitted.subresource?.mipLevel).toBe(0)
  expect(f.state.reservedBytes).toBe(0)
  // a read of one exact level is not resized: it is refused as before
  const exact = await f.port.read({
    kind: 'embedded',
    bytes: f.bytes,
    maxBytes: 2_000_000,
    selection: { mipLevel: 0 },
  })
  expect(exact).toMatchObject({
    state: 'unresolved',
    diagnostics: [{ code: 'x3.host/resource-budget-exceeded' }],
  })
})

it('refuses fit selection when no available mip satisfies the shared surface budget', async () => {
  const f = fixture()
  const result = await f.port.read({
    kind: 'embedded',
    bytes: f.bytes,
    // six faces of the smallest, computed 1x1 level need 24 bytes
    maxBytes: 23,
    selection: { face: 'all', mipLevel: 'fit' },
  })
  expect(result).toMatchObject({
    state: 'unresolved',
    diagnostics: [{ code: 'x3.host/resource-budget-exceeded' }],
  })
  expect(f.counts).toEqual({ opened: 1, disposed: 1 })
  expect(f.rasterCounts).toEqual({ leases: 1, released: 1, faces: [] })
  expect(f.state.reservedBytes).toBe(0)
})

it.each([{ face: 6 }, { mipLevel: 3 }, { frame: 1 }, { layer: 1 }, { slice: 1 }])(
  'refuses an absent selected subresource %j and releases its codec',
  async selection => {
    const f = fixture()
    const result = await f.port.read({
      kind: 'embedded',
      bytes: f.bytes,
      maxBytes: 1000,
      selection,
    })
    expect(result).toMatchObject({
      state: 'unresolved',
      diagnostics: [{ code: 'x3.host/raster-selection-invalid' }],
    })
    expect(f.counts).toEqual({ opened: 1, disposed: 1 })
    expect(f.state.reservedBytes).toBe(0)
  },
)

it('checks all-face bytes together and keeps the reservation reusable after refusal', async () => {
  const f = fixture()
  const result = await f.port.read({
    kind: 'embedded',
    bytes: f.bytes,
    maxBytes: 383,
    selection: { face: 'all' },
  })
  expect(result).toMatchObject({
    state: 'unresolved',
    diagnostics: [{ code: 'x3.host/resource-budget-exceeded' }],
  })
  expect(f.state.reservedBytes).toBe(0)
  expect(
    (
      await f.port.read({
        kind: 'embedded',
        bytes: f.bytes,
        maxBytes: 384,
        selection: { face: 'all' },
      })
    ).state,
  ).toBe('decoded-surfaces')
  expect(f.counts).toEqual({ opened: 2, disposed: 2 })
})

it('rejects malformed coordinates before resource acquisition', async () => {
  const f = fixture()
  for (const face of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
    expect(
      await f.port.read({ kind: 'embedded', bytes: f.bytes, maxBytes: 384, selection: { face } }),
    ).toMatchObject({
      state: 'unresolved',
      diagnostics: [{ code: 'x3.host/raster-request-invalid' }],
    })
  expect(f.counts).toEqual({ opened: 0, disposed: 0 })
})

it.each(['decoder failure', 'abort', 'dispose', 'revoke'] as const)(
  'releases every lease without returning partial faces after %s on the third face',
  async failure => {
    const controller = new AbortController()
    let fail = true
    const f = fixture({
      afterRead(request) {
        if (!fail || request.face !== 2) return
        if (failure === 'decoder failure') throw new Error('fixture third-face decode failure')
        if (failure === 'abort') controller.abort(new DOMException('fixture abort', 'AbortError'))
        if (failure === 'dispose') f.state.live = false
        if (failure === 'revoke') f.state.authorized = false
      },
    })
    const request = {
      kind: 'embedded',
      bytes: f.bytes,
      maxBytes: 384,
      selection: { face: 'all' },
    } as const
    const pending = f.port.read(request, controller.signal)
    if (failure === 'abort') await expect(pending).rejects.toThrow('fixture abort')
    else {
      const result = await pending
      expect(result).toMatchObject({
        state: 'unresolved',
        diagnostics: [
          {
            code:
              failure === 'decoder failure'
                ? 'x3.host/raster-resource-failed'
                : 'x3.host/raster-context-unavailable',
          },
        ],
      })
      expect(result).not.toHaveProperty('surfaces')
      expect(result).not.toHaveProperty('region')
    }
    expect(f.rasterCounts).toEqual({ leases: 1, released: 1, faces: [0, 1, 2] })
    expect(f.counts).toEqual({ opened: 1, disposed: 1 })
    expect(f.state.reservedBytes).toBe(0)
    // Cleanup returns the complete reservation even when acquisition stops midway.
    fail = false
    f.state.live = true
    f.state.authorized = true
    expect((await f.port.read(request)).state).toBe('decoded-surfaces')
    expect(f.rasterCounts).toEqual({
      leases: 2,
      released: 2,
      faces: [0, 1, 2, 0, 1, 2, 3, 4, 5],
    })
    expect(f.state.reservedBytes).toBe(0)
  },
)

it.each(['dispose', 'revoke'] as const)(
  'does not start decoding when the context changes during image info: %s',
  async change => {
    const f = fixture({
      afterInfo() {
        if (change === 'dispose') f.state.live = false
        else f.state.authorized = false
      },
    })
    const result = await f.port.read({
      kind: 'embedded',
      bytes: f.bytes,
      maxBytes: 384,
      selection: { face: 'all' },
    })
    expect(result).toMatchObject({
      state: 'unresolved',
      diagnostics: [{ code: 'x3.host/raster-context-unavailable' }],
    })
    expect(f.rasterCounts).toEqual({ leases: 1, released: 1, faces: [] })
    expect(f.counts).toEqual({ opened: 1, disposed: 1 })
    expect(f.state.reservedBytes).toBe(0)
  },
)
