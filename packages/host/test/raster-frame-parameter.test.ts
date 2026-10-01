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

/** A 2x2 sprite of two frames: frame 0 red, frame 1 green; `Head` its top row. */
const colourOf = (frame: number) => (frame === 0 ? [255, 0, 0, 255] : [0, 255, 0, 255])

function reader(asked: string[], frames: number[]) {
  const port: ResourceSessionPort = {
    sessionId: 'sprite',
    revision: revisionId('provider-token:sprite'),
    state: () => 'live',
    async resolve(requirement: LogicalResourceRequirement) {
      asked.push(requirement.logicalId)
      return {
        state: 'resolved' as const,
        revision: revisionId('provider-token:shp'),
        provenance: {} as never,
        lease: {
          value: {
            kind: 'bytes',
            ref: { id: 'gi.shp', uri: 'test:gi.shp' },
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
      height: 2,
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
      atlasRegions: [{ x: 0, y: 0, width: 2, height: 1, name: 'Head' }],
    }),
    readRegion: async (request: { width: number; height: number; frame?: number }) => {
      frames.push(request.frame ?? 0)
      const pixels = new Uint8Array(request.width * request.height * 4)
      for (let index = 0; index < request.width * request.height; index += 1)
        pixels.set(colourOf(request.frame ?? 0), index * 4)
      return {
        width: request.width,
        height: request.height,
        rowStride: request.width * 4,
        pixelFormat: 'rgba8',
        pixels,
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

const request = (logicalId: string, selection?: object) =>
  ({
    kind: 'logical',
    requirement: { id: 'texture', logicalId, role: 'texture', scopes: ['current-mount'] },
    maxBytes: 1024,
    ...(selection === undefined ? {} : { selection }),
  }) as never

describe('a named frame of a many-frame image (C2, DM2, V3)', () => {
  it('is read as a one-frame image of its own, alone or with an area of that frame', async () => {
    const asked: string[] = []
    const frames: number[] = []
    const raster = reader(asked, frames)
    const frame = await raster.read(request('gi.shp#frame=1', { face: 'all', mipLevel: 'fit' }))
    if (frame.state !== 'decoded-surfaces') throw new Error(JSON.stringify(frame))
    expect(asked).toEqual(['gi.shp'])
    expect(frames).toEqual([1])
    expect(frame.info.frames).toBe(1)
    expect(frame.surfaces[0]?.subresource.frame).toBe(0)
    expect([...frame.surfaces[0]!.region.pixels.subarray(0, 4)]).toEqual([0, 255, 0, 255])

    const head = await raster.read(request('gi.shp#frame=1&region=Head'))
    if (head.state !== 'decoded') throw new Error(JSON.stringify(head))
    expect([head.info.width, head.info.height, head.info.frames]).toEqual([2, 1, 1])
    expect([...head.region.pixels.subarray(0, 4)]).toEqual([0, 255, 0, 255])
  })

  it('refuses a frame the image lacks or cannot be', async () => {
    const raster = reader([], [])
    const missing = await raster.read(request('gi.shp#frame=5'))
    expect(missing.diagnostics.map(item => item.code)).toEqual(['x3.host/raster-frame-missing'])
    const invalid = await raster.read(request('gi.shp#frame=x'))
    expect(invalid.diagnostics.map(item => item.code)).toEqual(['x3.host/raster-request-invalid'])
  })

  it('keeps a fragment of other words as part of the name', () => {
    expect(rasterIdParameters('textures/#odd.dds')).toEqual({ name: 'textures/#odd.dds' })
    expect(rasterIdParameters('a.gaf#region=Metal%2001')).toEqual({
      name: 'a.gaf',
      region: 'Metal 01',
    })
  })
})
