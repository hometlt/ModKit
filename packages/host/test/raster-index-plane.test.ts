import { describe, expect, it } from 'vitest'
import { revisionId, type LogicalResourceRequirement, type ResourceSessionPort } from '@modkit/sdk'
import { createSubjectRasterResources, rasterIdParameters } from '../src/raster-resources.js'

const budget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 10_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

/** A 2x1 two-frame sprite whose pixels are palette indices: frame f holds 80 + f and 81 + f. */
function reader(indexed: boolean, asked: object[]) {
  const port: ResourceSessionPort = {
    sessionId: 'sprite',
    revision: revisionId('provider-token:sprite'),
    state: () => 'live',
    async resolve(_requirement: LogicalResourceRequirement) {
      return {
        state: 'resolved' as const,
        revision: revisionId('provider-token:shp'),
        provenance: {} as never,
        lease: {
          value: {
            kind: 'bytes',
            ref: { id: 'unit.shp', uri: 'test:unit.shp' },
            revision: revisionId('provider-token:shp'),
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
      width: 2,
      height: 1,
      depth: 1,
      layers: 1,
      faces: 1,
      mipLevels: 1,
      frames: 2,
      channels: 4,
      bitDepth: 8,
      colorSpace: 'srgb',
      alphaMode: 'straight',
      orientation: 'top-left',
      decodedAccess: true,
      ...(indexed ? { indexed: true } : {}),
    }),
    readRegion: async (request: {
      width: number
      height: number
      frame?: number
      plane?: string
      pixelFormat: string
    }) => {
      asked.push({ plane: request.plane, pixelFormat: request.pixelFormat })
      const frame = request.frame ?? 0
      return request.plane === 'indices'
        ? {
            width: 2,
            height: 1,
            rowStride: 2,
            pixelFormat: 'gray8',
            pixels: Uint8Array.of(80 + frame, 81 + frame),
          }
        : {
            width: 2,
            height: 1,
            rowStride: 8,
            pixelFormat: 'rgba8',
            pixels: Uint8Array.of(200, 0, 0, 255, 0, 200, 0, 255),
          }
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
        session: {
          dataSource: async () => ({ value: raster, release: async () => undefined }),
          dispose: async () => undefined,
        },
      }) as never,
  })
}

const request = (logicalId: string) =>
  ({
    kind: 'logical',
    requirement: { id: 'texture', logicalId, role: 'texture', scopes: ['current-mount'] },
    maxBytes: 1024,
    selection: { mipLevel: 'fit' },
  }) as never

describe('the palette indices of an image (#plane=indices, П40 ramps)', () => {
  it('are read as gray8 and handed on as the index in red, green and blue', async () => {
    const asked: object[] = []
    const read = await reader(true, asked).read(request('unit.shp#frame=1&plane=indices'))
    if (read.state !== 'decoded') throw new Error(JSON.stringify(read))
    expect(asked).toEqual([{ plane: 'indices', pixelFormat: 'gray8' }])
    expect([...read.region.pixels]).toEqual([81, 81, 81, 255, 82, 82, 82, 255])
  })

  it('are refused where the image stores none, and another plane is no plane', async () => {
    const plain = await reader(false, []).read(request('unit.shp#plane=indices'))
    expect(plain.diagnostics.map(item => item.code)).toEqual(['x3.host/raster-plane-missing'])
    const other = await reader(true, []).read(request('unit.shp#plane=alpha'))
    expect(other.diagnostics.map(item => item.code)).toEqual(['x3.host/raster-request-invalid'])
    expect(rasterIdParameters('unit.shp#frame=3&plane=indices')).toEqual({
      name: 'unit.shp',
      frame: 3,
      plane: 'indices',
    })
  })
})
