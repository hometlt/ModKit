/** P47/U5: compact terrain weights retain every channel through the existing UVP lifecycle. */
import { describe, expect, it } from 'vitest'
import { decodePngSamples } from '@modkit/codec-kit/raster'
import type { RasterResourcePort } from '@modkit/sdk'
import {
  createUvwWorldSceneSource, materializeWorldToUvpMap, openUvpMapBundle,
  parseUvwProfile, serializeUvwProfile, validateUvwProfile,
  type UvwProfileDocument,
} from '../src/world/index.js'

/** Four nonzero, distinguishable channels in each 2×2 raster catch truncation and reordering. */
function pixels(index: number): Uint8Array {
  return Uint8Array.from({ length: 16 }, (_, offset) => 1 + index * 8 + offset)
}

/** Small source with disjoint material channels and no incidental model or image dependencies. */
function documentWithRasters(count: number): UvwProfileDocument {
  const names = Array.from({ length: count }, (_, index) => `weights-${String(index).padStart(2, '0')}`)
  return {
    uv: { format: 'UVW', version: '1.0', status: 'profile' }, connections: [],
    spaces: [{
      id: 'main', topology: 'heightfield',
      basis: { handedness: 'right', upAxis: 'y', forwardAxis: '+z', unit: 'meter' },
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      layers: [
        { id: 'ground', kind: 'heightfield', columns: 2, rows: 2, cellSize: 1,
          origin: [0, 0, 0], samples: [[0, 0], [0, 0]] },
        { schemaVersion: 1, id: 'paint', kind: 'terrain-materials', columns: 2, rows: 2,
          cellSize: 1, origin: [0, 0, 0],
          materials: names.flatMap(name => Array.from({ length: 4 }, (_, channel) => ({ id: `${name}-${channel}` }))),
          weightRasters: names.map(name => ({ resourceId: name, width: 2, height: 2,
            materialIds: Array.from({ length: 4 }, (_, channel) => `${name}-${channel}`),
            encoding: 'rgba8-unorm', normalization: 'sum' })) },
        { schemaVersion: 1, id: 'media', kind: 'resources',
          resources: names.map(name => ({ id: name, kind: 'media', uri: `media/${name}.rgba` })) },
      ],
    }],
  }
}

const rasterResources: RasterResourcePort = {
  async read(request) {
    if (request.kind !== 'embedded') throw new Error('expected owned embedded weight bytes')
    const decoded = request.bytes.length === 16
      ? request.bytes.slice()
      : Uint8Array.from((await decodePngSamples(request.bytes)).samples)
    return {
      state: 'decoded', diagnostics: [],
      info: { width: 2, height: 2, depth: 1, layers: 1, faces: 1, mipLevels: 1, frames: 1,
        channels: 4, bitDepth: 8, colorSpace: 'linear', alphaMode: 'straight',
        orientation: 'top-left', decodedAccess: true },
      region: { width: 2, height: 2, rowStride: 8, pixelFormat: 'rgba8', pixels: decoded },
    }
  },
}

describe('UVW terrain raster capacity', () => {
  it.each([3, 4, 6, 16])('packages and independently reopens all %i weight rasters', async count => {
    const document = documentWithRasters(count)
    const admitted = parseUvwProfile(serializeUvwProfile(document))
    const source = createUvwWorldSceneSource(admitted, {
      snapshotId: 'all-weight-channels', rasterResources,
      embeddedResources: new Map(Array.from({ length: count }, (_, index) => [
        `uvw-resource:main/weights-${String(index).padStart(2, '0')}`, { bytes: pixels(index) },
      ])),
    })
    const packed = await materializeWorldToUvpMap(source, {
      packageId: 'test/weight-rasters', packageVersion: '1.0.0', title: 'Weight rasters',
      maxPageItems: 128, maxTerrainItems: 16, maxFacetItems: 256,
      maxOutputBytes: 1024 * 1024, maxTextureBytes: 1024, maxMediaBytes: 1024 * 1024,
    })
    if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
    expect(packed.packagedTextureCount).toBe(count)
    const reopened = await openUvpMapBundle(
      new Map([...packed.entries].map(([name, bytes]) => [name, Uint8Array.from(bytes)])),
      { snapshotId: 'detached-weight-channels', rasterResources },
    )
    const layer = reopened.document.spaces[0]!.layers.find(item => item.kind === 'terrain-materials')!
    if (layer.kind !== 'terrain-materials') throw new Error('missing terrain material layer')
    expect(layer.materials).toHaveLength(count * 4)
    expect(layer.weightRasters).toHaveLength(count)
    for (const [index, raster] of layer.weightRasters!.entries()) {
      expect(raster.materialIds).toEqual(Array.from({ length: 4 }, (_, channel) =>
        `weights-${String(index).padStart(2, '0')}-${channel}`))
      const image = await reopened.source.texture!(`uvw-resource:main/${raster.resourceId}`, { maxBytes: 1024 })
      if (image.state !== 'decoded') throw new Error('weight texture was not reopened')
      expect(image.texture.rgba).toEqual(pixels(index))
    }
  })

  it('rejects a seventeenth raster and preserves reference, duplicate and sample budget checks', () => {
    expect(() => validateUvwProfile(documentWithRasters(17))).toThrow(/weight rasters/)
    const bad = documentWithRasters(16)
    const layer = bad.spaces[0]!.layers[1]!
    if (layer.kind !== 'terrain-materials') throw new Error('missing fixture layer')
    const duplicate = structuredClone(bad)
    const copied = duplicate.spaces[0]!.layers[1]!
    if (copied.kind !== 'terrain-materials') throw new Error('missing fixture layer')
    ;(copied.weightRasters![15]!.materialIds as string[])[0] = layer.weightRasters![0]!.materialIds[0]!
    expect(() => validateUvwProfile(duplicate)).toThrow(/duplicate materialId/)
    expect(() => validateUvwProfile(bad, { maxSamples: 4 + 15 * 4 })).toThrow(/maxSamples/)
    const unknown = structuredClone(bad)
    const resources = unknown.spaces[0]!.layers[2]!
    if (resources.kind !== 'resources') throw new Error('missing fixture resources')
    ;(resources.resources as unknown[]).pop()
    expect(() => validateUvwProfile(unknown)).toThrow(/unknown resource/)
  })
})
