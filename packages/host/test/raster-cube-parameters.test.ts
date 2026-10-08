import { describe, expect, it } from 'vitest'
import { revisionId, type LogicalResourceRequirement, type ResourceSessionPort } from '@modkit/sdk'
import { createSubjectRasterResources, rasterIdParameters } from '../src/raster-resources.js'

/**
 * A cube array of prefiltered levels — Warcraft III Reforged's IBL probe: element 0 the irradiance,
 * element 1 the specular, mip k the blur of roughness k, faces stored with −X and −Z swapped. A
 * logical id names the element (`#layer=`), the level (`#mip=`) and the stored order (`#faces=`).
 */
const budget = { maxInputBytes: 1_000_000n, maxDepth: 64, maxNodes: 10_000, maxScalarBytes: 1_000_000, maxDiagnostics: 100 }

function reader(reads: { layer: number; face: number; mipLevel: number }[]) {
  const port: ResourceSessionPort = {
    sessionId: 'probe',
    revision: revisionId('provider-token:probe'),
    state: () => 'live',
    async resolve(_requirement: LogicalResourceRequirement) {
      return {
        state: 'resolved' as const,
        revision: revisionId('provider-token:ibl'),
        provenance: {} as never,
        lease: {
          value: {
            kind: 'bytes',
            ref: { id: 'day_ibl.dds', uri: 'test:day_ibl.dds' },
            revision: revisionId('provider-token:ibl'),
            size: 1n,
            read: async () => new Uint8Array(1),
            async *stream() {},
          },
          release: async () => undefined,
        },
      } as never
    },
    provenance: () => [],
    dispose: async () => undefined,
  }
  const raster = {
    info: async () => ({
      width: 4,
      height: 4,
      depth: 1,
      layers: 2,
      faces: 6,
      mipLevels: 3,
      frames: 1,
      channels: 4,
      bitDepth: 8,
      colorSpace: 'srgb',
      alphaMode: 'straight',
      orientation: 'top-left',
      decodedAccess: true,
    }),
    // Each texel says where it came from: red the layer, green the stored face, blue the level.
    readRegion: async (request: { width: number; height: number; layer?: number; face?: number; mipLevel?: number }) => {
      const at = { layer: request.layer ?? 0, face: request.face ?? 0, mipLevel: request.mipLevel ?? 0 }
      reads.push(at)
      const pixels = new Uint8Array(request.width * request.height * 4)
      for (let index = 0; index < request.width * request.height; index += 1) pixels.set([at.layer, at.face, at.mipLevel, 255], index * 4)
      return { width: request.width, height: request.height, rowStride: request.width * 4, pixelFormat: 'rgba8', pixels }
    },
  }
  return createSubjectRasterResources({
    state: { live: true, reservedBytes: 0, resources: port },
    budget,
    isAuthorized: () => true,
    open: async () =>
      ({
        state: 'opened',
        diagnostics: [],
        descriptor: { dataSources: [{ contract: 'common.view/raster-image-source', major: 1 }] },
        session: { dataSource: async () => ({ value: raster, release: async () => undefined }), dispose: async () => undefined },
      }) as never,
  })
}

const request = (logicalId: string) =>
  ({
    kind: 'logical',
    requirement: { id: 'texture', logicalId, role: 'texture', scopes: ['current-mount'] },
    maxBytes: 4096,
    selection: { face: 'all', mipLevel: 'fit' },
  }) as never

describe('a cube array element, level and face order named by the logical id', () => {
  it('reads that element at that level, each face from where the file keeps it', async () => {
    const reads: { layer: number; face: number; mipLevel: number }[] = []
    const result = await reader(reads).read(request('day_ibl.dds#layer=1&mip=2&faces=0,5,2,3,4,1'))
    if (result.state !== 'decoded-surfaces') throw new Error(JSON.stringify(result))
    expect(result.info.layers).toBe(1)
    expect(result.surfaces.map(surface => surface.subresource.face)).toEqual([0, 1, 2, 3, 4, 5])
    expect(result.surfaces.every(surface => surface.subresource.layer === 0 && surface.subresource.mipLevel === 2)).toBe(true)
    // face 1 (−X) is stored face 5, face 5 (−Z) stored face 1
    expect(result.surfaces.map(surface => [...surface.region.pixels.subarray(0, 3)])).toEqual([
      [1, 0, 2],
      [1, 5, 2],
      [1, 2, 2],
      [1, 3, 2],
      [1, 4, 2],
      [1, 1, 2],
    ])
    expect(new Set(reads.map(read => read.layer))).toEqual(new Set([1]))
  })

  it('refuses a face order that is no permutation and keeps other words as the name', () => {
    expect(() => rasterIdParameters('a.dds#faces=0,0,2,3,4,1')).toThrow(/six faces/u)
    expect(() => rasterIdParameters('a.dds#layer=-1')).toThrow(/layer/u)
    expect(rasterIdParameters('a.dds#layer=1&mip=3')).toEqual({ name: 'a.dds', layer: 1, mip: 3 })
  })
})
