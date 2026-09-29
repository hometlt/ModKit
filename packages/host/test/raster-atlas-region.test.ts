import { describe, expect, it } from 'vitest'
import { revisionId, type LogicalResourceRequirement, type ResourceSessionPort } from '@modkit/sdk'
import { createSubjectRasterResources } from '../src/raster-resources.js'

const budget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 10_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

/** A 4x2 atlas: `Metal01` the left 2x2 (red), `Glass` the right 2x2 (blue). */
const atlas = { width: 4, height: 2 }
const pixelAt = (x: number) => (x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255])

function reader(asked: string[]) {
  const port: ResourceSessionPort = {
    sessionId: 'atlas',
    revision: revisionId('provider-token:atlas'),
    state: () => 'live',
    async resolve(requirement: LogicalResourceRequirement) {
      asked.push(requirement.logicalId)
      return {
        state: 'resolved' as const,
        revision: revisionId('provider-token:gaf'),
        provenance: {} as never,
        lease: {
          value: {
            kind: 'bytes',
            ref: { id: 'tex.gaf', uri: 'test:tex.gaf' },
            revision: revisionId('provider-token:gaf'),
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
      ...atlas,
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
      atlasRegions: [
        { x: 0, y: 0, width: 2, height: 2, name: 'Metal01' },
        { x: 2, y: 0, width: 2, height: 2, name: 'Glass' },
      ],
    }),
    readRegion: async (request: { x: number; y: number; width: number; height: number }) => {
      const pixels = new Uint8Array(request.width * request.height * 4)
      for (let row = 0; row < request.height; row += 1)
        for (let column = 0; column < request.width; column += 1)
          pixels.set(pixelAt(request.x + column), (row * request.width + column) * 4)
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

describe('a named atlas region of an image', () => {
  it('is read as an image of its own, the rest of the atlas left out', async () => {
    const asked: string[] = []
    const raster = reader(asked)
    const result = await raster.read({
      kind: 'logical',
      requirement: {
        id: 'texture-0',
        logicalId: 'textures/tex.gaf#region=Glass',
        role: 'texture',
        scopes: ['workspace-dependency-layer'],
      },
      maxBytes: 1024,
    } as never)
    expect(asked).toEqual(['textures/tex.gaf'])
    if (result.state !== 'decoded') throw new Error(JSON.stringify(result))
    expect([result.info.width, result.info.height]).toEqual([2, 2])
    expect([...result.region.pixels.subarray(0, 4)]).toEqual([0, 0, 255, 255])
    const missing = await raster.read({
      kind: 'logical',
      requirement: {
        id: 'texture-1',
        logicalId: 'textures/tex.gaf#region=Wood',
        role: 'texture',
        scopes: ['workspace-dependency-layer'],
      },
      maxBytes: 1024,
    } as never)
    expect(missing.state).toBe('unresolved')
  })
})
