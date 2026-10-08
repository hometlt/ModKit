/**
 * The palette an indexed image is drawn with (`#palette=temperat.pal`): Red Alert 2 ore lies in the
 * theater palette though its file is of the kind a tree draws in the isometric one.
 */
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

/** A 2x1 two-frame indexed sprite that can be drawn with two palettes, red by default. */
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
      ...(indexed ? { indexed: true, palettes: ['isotem.pal', 'temperat.pal'] } : {}),
    }),
    readRegion: async (request: {
      width: number
      height: number
      frame?: number
      plane?: string
      palette?: string
      pixelFormat: string
    }) => {
      asked.push({ palette: request.palette, pixelFormat: request.pixelFormat })
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
            pixels:
              request.palette === 'temperat.pal'
                ? Uint8Array.of(0, 0, 200, 255, 0, 0, 200, 255)
                : Uint8Array.of(200, 0, 0, 255, 0, 200, 0, 255),
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

describe('the palette an indexed image is drawn with (#palette=)', () => {
  it('reaches the codec, which colours the pixels with it', async () => {
    const asked: object[] = []
    const read = await reader(true, asked).read(request('ore01.tem#frame=1&palette=temperat.pal'))
    if (read.state !== 'decoded') throw new Error(JSON.stringify(read))
    expect(asked).toEqual([{ palette: 'temperat.pal', pixelFormat: 'rgba8' }])
    expect([...read.region.pixels]).toEqual([0, 0, 200, 255, 0, 0, 200, 255])
  })

  it('is refused where the image does not list it, and must name a .pal file', async () => {
    const unlisted = await reader(false, []).read(request('ore01.tem#palette=temperat.pal'))
    expect(unlisted.diagnostics.map(item => item.code)).toEqual(['x3.host/raster-palette-missing'])
    const other = await reader(true, []).read(request('ore01.tem#palette=../x'))
    expect(other.diagnostics.map(item => item.code)).toEqual(['x3.host/raster-request-invalid'])
    expect(rasterIdParameters('ore01.tem#frame=3&palette=temperat.pal')).toEqual({
      name: 'ore01.tem',
      frame: 3,
      palette: 'temperat.pal',
    })
  })
})
