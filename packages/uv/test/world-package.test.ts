import { describe, expect, it } from 'vitest'

import { isModkitError } from '@modkit/core'
import { decodePngSamples } from '@modkit/codec-kit/raster'
import type { RasterResourcePort } from '@modkit/sdk'
import { materializeUvmCore } from '../src/model/materializer.js'
import { readUvmContainer } from '../src/model/container.js'
import { createEmbeddedUvmWorldModelDecoder } from '../../scene/src/world/embedded-uvm.js'

import {
  createUvwWorldSceneSource,
  materializeWorldToUvpMap,
  openUvpMapBundle,
  packUvpArchive,
  type UvwProfileDocument,
} from '../src/world/index.js'
// the host's ZIP codec reads what packUvpArchive writes: the reader is the oracle
import {
  extractZipArchiveEntry,
  parseZipArchive,
} from '../../../extensions/archives/src/zip/codec.js'

const rgba = Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 128)

/** The fixture's own one-byte texture, or a PNG the packer wrote (8-bit RGBA). */
async function decodeFixtureRaster(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.byteLength === 1) return rgba.slice()
  const image = await decodePngSamples(bytes)
  expect(image).toMatchObject({ width: 2, height: 2, bitDepth: 8, channels: 4 })
  return Uint8Array.from(image.samples)
}

const rasterResources: RasterResourcePort = {
  async read(request) {
    if (request.kind !== 'embedded') throw new Error('fixture accepts embedded bytes only')
    return {
      state: 'decoded',
      diagnostics: [],
      info: {
        width: 2,
        height: 2,
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
        width: 2,
        height: 2,
        rowStride: 8,
        pixelFormat: 'rgba8',
        pixels: await decodeFixtureRaster(request.bytes),
      },
    }
  },
}

const document: UvwProfileDocument = {
  uv: { format: 'UVW', version: '1.0', status: 'profile' },
  spaces: [
    {
      id: 'main',
      topology: 'heightfield',
      basis: { handedness: 'right', upAxis: 'y', forwardAxis: '+z', unit: 'meter' },
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      layers: [
        {
          id: 'terrain',
          kind: 'heightfield',
          columns: 2,
          rows: 2,
          cellSize: 1,
          origin: [0, 0, 0],
          samples: [
            [0, 1],
            [1, 0],
          ],
        },
        {
          schemaVersion: 1,
          id: 'materials',
          kind: 'terrain-materials',
          columns: 2,
          rows: 2,
          cellSize: 1,
          origin: [0, 0, 0],
          materials: [{ id: 'grass', baseColorResourceId: 'source-grass' }],
          samples: [
            [
              { weights: [{ materialId: 'grass', weight: 1 }] },
              { weights: [{ materialId: 'grass', weight: 1 }] },
            ],
            [
              { weights: [{ materialId: 'grass', weight: 1 }] },
              { weights: [{ materialId: 'grass', weight: 1 }] },
            ],
          ],
        },
        {
          schemaVersion: 1,
          id: 'resources',
          kind: 'resources',
          resources: [{ id: 'source-grass', kind: 'media', uri: 'source/grass.bin' }],
        },
      ],
    },
  ],
  connections: [],
}

function source() {
  return createUvwWorldSceneSource(document, {
    snapshotId: 'source-snapshot',
    embeddedResources: new Map([['uvw-resource:main/source-grass', { bytes: Uint8Array.of(1) }]]),
    rasterResources,
  })
}

it('retains the admitted node budget through UVP media binding and detached reopen', async () => {
  const n = 200, maxBytes = 128 * 1024 * 1024
  const large: UvwProfileDocument = {
    ...document,
    spaces: document.spaces.map(space => ({ ...space, bounds: { min: [0, 0, 0], max: [n - 1, 1, n - 1] },
      layers: space.layers.map(layer => layer.kind === 'heightfield' ? { ...layer, columns: n, rows: n,
        samples: Array.from({ length: n }, () => Array(n).fill(0)) } :
        layer.kind === 'terrain-materials' ? { ...layer, columns: n, rows: n,
          materials: layer.materials.map(material => ({ ...material, atlas: { rows: 2 } })),
          samples: Array.from({ length: n }, () => Array.from({ length: n }, () => ({
            weights: [{ materialId: 'grass', weight: 1 }], layers: [
              { materialId: 'grass', tile: { column: 0, row: 0 }, cornerAlpha: [1, 1, 1, 1] as const },
              { materialId: 'grass', tile: { column: 1, row: 1 }, cornerAlpha: [0, 0.5, 1, 0.5] as const },
            ],
          }))) } : layer),
    })),
  }
  const original = createUvwWorldSceneSource(large, { snapshotId: 'large-material-grid',
    limits: { maxNodes: maxBytes }, rasterResources,
    embeddedResources: new Map([['uvw-resource:main/source-grass', { bytes: Uint8Array.of(1) }]]),
  })
  const packed = await materializeWorldToUvpMap(original, { ...options, maxPageItems: 4096,
    maxTerrainItems: n * n, maxFacetItems: 2 * n * n + 128, maxOutputBytes: maxBytes })
  if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
  expect(packed.state).toBe('materialized')
  const reopened = await openUvpMapBundle(packed.entries, { snapshotId: 'detached-large', maxWorldBytes: maxBytes })
  const materials = reopened.document.spaces[0]!.layers.find(layer => layer.kind === 'terrain-materials')!
  if (materials.kind !== 'terrain-materials') throw new Error('missing materials')
  expect(materials.samples!.length).toBe(n)
  expect(materials.samples![n - 1]![n - 1]!.layers).toEqual(large.spaces[0]!.layers
    .filter(layer => layer.kind === 'terrain-materials')[0]!.samples![n - 1]![n - 1]!.layers)
  expect(reopened.embeddedResources.size).toBe(1)
  await expect(openUvpMapBundle(packed.entries, { snapshotId: 'too-small', maxWorldBytes: 1 })).rejects.toThrow('byte budget')
}, 30000)

function sourceWithWeightRaster() {
  const rasterDocument: UvwProfileDocument = {
    ...document,
    spaces: document.spaces.map(space => ({
      ...space,
      layers: space.layers.map(layer => {
        if (layer.kind === 'terrain-materials') {
          const { samples: _samples, ...withoutSamples } = layer
          return {
            ...withoutSamples,
            materials: layer.materials.map(material => ({ ...material, atlas: { rows: 2 } })),
            weightRasters: [
              {
                resourceId: 'source-weights',
                width: 2,
                height: 2,
                materialIds: ['grass'],
                encoding: 'rgba8-unorm' as const,
                normalization: 'sum' as const,
              },
            ],
          }
        }
        if (layer.kind === 'resources')
          return {
            ...layer,
            resources: [
              ...layer.resources,
              { id: 'source-weights', kind: 'media' as const, uri: 'source/weights.bin' },
            ],
          }
        return layer
      }),
    })),
  }
  return createUvwWorldSceneSource(rasterDocument, {
    snapshotId: 'source-weight-raster-snapshot',
    embeddedResources: new Map([
      ['uvw-resource:main/source-grass', { bytes: Uint8Array.of(1) }],
      ['uvw-resource:main/source-weights', { bytes: Uint8Array.of(1) }],
    ]),
    rasterResources,
  })
}

function sourceWithDualWaterTextures() {
  const main = document.spaces[0]!
  const resourceLayer = main.layers.find(layer => layer.kind === 'resources')!
  if (resourceLayer.kind !== 'resources') throw new Error('fixture resource layer missing')
  const waterDocument: UvwProfileDocument = {
    ...document,
    spaces: [
      {
        ...main,
        layers: [
          ...main.layers.filter(layer => layer !== resourceLayer),
          {
            schemaVersion: 1,
            id: 'water',
            kind: 'water',
            materials: [
              {
                id: 'water-surface',
                classification: 'water',
                shorelineMode: 'zone',
                color: [0.18, 0.33, 0.42, 0.45],
                baseColorResourceId: 'source-water-primary',
                secondaryColorResourceId: 'source-water-secondary',
                uvScale: [1 / 512, 1 / 512, 1 / 640, 1 / 640],
                scroll: [1 / 80, 1 / 40, 0, -1 / 40],
                colorFalloff: 0,
              },
            ],
            zones: [
              {
                id: 'pool',
                minimum: [0, 0],
                maximum: [1, 1],
                elevation: 0.5,
                materialId: 'water-surface',
              },
            ],
          },
          {
            ...resourceLayer,
            resources: [
              ...resourceLayer.resources,
              { id: 'source-water-primary', kind: 'media', uri: 'source/water-primary.bin' },
              {
                id: 'source-water-secondary',
                kind: 'media',
                uri: 'source/water-secondary.bin',
              },
            ],
          },
        ],
      },
    ],
  }
  return createUvwWorldSceneSource(waterDocument, {
    snapshotId: 'dual-water-source-snapshot',
    embeddedResources: new Map([
      ['uvw-resource:main/source-grass', { bytes: Uint8Array.of(1) }],
      ['uvw-resource:main/source-water-primary', { bytes: Uint8Array.of(1) }],
      ['uvw-resource:main/source-water-secondary', { bytes: Uint8Array.of(1) }],
    ]),
    rasterResources,
  })
}

const triangle = {
  nodes: [
    {
      id: 'node-0',
      childIds: [],
      meshIds: ['mesh-0'],
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    },
  ],
  meshes: [{ id: 'mesh-0', primitiveIds: ['mesh-0-primitive-0'] }],
  primitives: [
    {
      id: 'mesh-0-primitive-0',
      topology: 'triangles' as const,
      positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
      indices: Uint32Array.of(0, 1, 2),
      textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
      materialId: 'material-0',
    },
  ],
  materials: [{ id: 'material-0', simpleEffect: { textureResource: 'texture.dds' } }],
}

const modelBytes = materializeUvmCore(
  {
    info: {
      scenes: 1,
      nodes: 1,
      meshes: 1,
      primitives: 1,
      materials: 1,
      textures: 1,
      animations: 0,
      geometryAccess: 'decoded',
    },
    ...triangle,
    resourceClosure: {
      mode: 'content-qualified',
      entries: [{ role: 'texture', logicalId: 'texture.dds', mediaHint: 'image/vnd-ms.dds' }],
    },
  },
  {
    scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
    profile: 'UVM/core@1.0',
    subjectRevision: 'provider-token:portable-model' as never,
    options: { assetId: 'fixture/triangle', sourceFormat: 'fixture' },
  },
).bytes

function sourceWithModel() {
  const main = document.spaces[0]!
  const resourceLayer = main.layers.find(layer => layer.kind === 'resources')!
  if (resourceLayer.kind !== 'resources') throw new Error('fixture resource layer missing')
  const modelDocument: UvwProfileDocument = {
    ...document,
    spaces: [
      {
        ...main,
        layers: [
          ...main.layers.filter(layer => layer !== resourceLayer),
          {
            schemaVersion: 1,
            id: 'objects',
            kind: 'objects',
            instances: [
              {
                id: 'triangle',
                objectKind: 'doodad',
                position: [0.5, 0, 0.5],
                rotation: [0, 0, 0, 1],
                scale: [1, 1, 1],
                resourceIds: ['source-model'],
                modelComponents: [{ id: 'body', resourceId: 'source-model' }],
              },
            ],
          },
          {
            ...resourceLayer,
            resources: [
              ...resourceLayer.resources,
              { id: 'source-model', kind: 'uvm', uri: 'source/model.uvm.glb' },
            ],
          },
        ],
      },
    ],
  }
  const base = createUvwWorldSceneSource(modelDocument, {
    snapshotId: 'model-source-snapshot',
    embeddedResources: new Map([['uvw-resource:main/source-grass', { bytes: Uint8Array.of(1) }]]),
    rasterResources,
  })
  return Object.freeze({
    ...base,
    async model(resourceId: string) {
      expect(resourceId).toBe('uvw-resource:main/source-model')
      return {
        state: 'converted' as const,
        sourceKey: 'fixture-model-revision',
        uvmBytes: modelBytes.slice(),
        ...triangle,
        resources: [
          { id: 'texture.dds', role: 'texture' as const, provenance: 'companion' as const },
        ],
        textures: [{ id: 'texture.dds', width: 2, height: 2, rgba: rgba.slice() }],
        diagnostics: [],
        complete: true,
      }
    },
  })
}

const options = {
  packageId: 'test-vendor/portable-map',
  packageVersion: '1.0.0',
  title: 'Portable terrain map',
  maxPageItems: 16,
  maxTerrainItems: 16,
  maxFacetItems: 64,
  maxOutputBytes: 1024 * 1024,
  maxTextureBytes: 1024,
  maxMediaBytes: 1024 * 1024,
}

describe('portable UVP map bundle', () => {
  it('packages geometry without a texture route, but still refuses missing required texture acquisition', async () => {
    const geometry = {
      ...document,
      spaces: document.spaces.map(space => ({
        ...space,
        layers: space.layers.filter(layer => layer.kind === 'heightfield'),
      })),
    }
    const raw = createUvwWorldSceneSource(geometry, { snapshotId: 'geometry-only' })
    const { texture: _texture, ...withoutTexture } = raw
    expect((await materializeWorldToUvpMap(withoutTexture, options)).state).toBe('materialized')
    const { texture: _required, ...missingTexture } = source()
    expect((await materializeWorldToUvpMap(missingTexture, options)).refusalCodes).toEqual([
      'texture-route-missing',
    ])
  })

  it('packages texture closure for layers-only atlas samples and reopens without the source', async () => {
    const layered: UvwProfileDocument = {
      ...document,
      spaces: document.spaces.map(space => ({
        ...space,
        layers: space.layers.map(layer =>
          layer.kind !== 'terrain-materials'
            ? layer
            : {
                ...layer,
                materials: layer.materials.map(material => ({ ...material, atlas: { rows: 2 } })),
                samples: Array.from({ length: 2 }, () =>
                  Array.from({ length: 2 }, () => ({
                    layers: [
                      {
                        materialId: 'grass',
                        tile: { column: 1, row: 1 },
                        cornerAlpha: [0, 0.25, 0.5, 1] as const,
                      },
                    ],
                  })),
                ),
              },
        ),
      })),
    }
    const original = createUvwWorldSceneSource(layered, {
      snapshotId: 'layer-closure',
      rasterResources,
      embeddedResources: new Map([['uvw-resource:main/source-grass', { bytes: Uint8Array.of(1) }]]),
    })
    const packed = await materializeWorldToUvpMap(original, options)
    expect(packed.state).toBe('materialized')
    if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
    expect(packed.packagedTextureCount).toBe(1)
    const reopened = await openUvpMapBundle(packed.entries, {
      snapshotId: 'detached-layers',
      rasterResources,
    })
    const material = reopened.document.spaces[0]!.layers.find(
      layer => layer.kind === 'terrain-materials',
    )!
    if (material.kind !== 'terrain-materials') throw new Error('missing materials')
    expect(material.samples?.[0]?.[0]).toEqual(
      layered.spaces[0]!.layers.find(layer => layer.kind === 'terrain-materials')!
        .samples?.[0]?.[0],
    )
    expect(material.materials[0]?.atlas).toEqual({ rows: 2 })
    const decoded = await reopened.source.texture?.('uvw-resource:main/terrain-media-0000', {
      maxBytes: 1024,
    })
    expect(decoded?.state).toBe('decoded')
    if (decoded?.state === 'decoded') expect(decoded.texture.rgba).toEqual(rgba)
  })

  it('packages both independent water texture channels and reopens them without the source', async () => {
    const packed = await materializeWorldToUvpMap(sourceWithDualWaterTextures(), options)
    expect(packed.state).toBe('materialized')
    if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
    expect(packed.packagedTextureCount).toBe(3)
    expect(packed.unpackagedWaterResourceIds).toEqual([])
    expect([...packed.entries.keys()]).toEqual([
      'uvp.manifest.json',
      'world/main.uvw.json',
      'media/terrain/terrain-media-0000.png',
      'media/water/water-media-0001.png',
      'media/water/water-media-0002.png',
    ])
    const reopened = await openUvpMapBundle(
      new Map([...packed.entries].map(([path, bytes]) => [path, bytes.slice()])),
      { snapshotId: 'detached-dual-water', rasterResources },
    )
    const waterLayer = reopened.document.spaces[0]?.layers.find(layer => layer.kind === 'water')
    if (waterLayer?.kind !== 'water') throw new Error('detached water layer missing')
    expect(waterLayer.materials?.[0]).toMatchObject({
      id: 'water-surface',
      baseColorResourceId: 'water-media-0001',
      secondaryColorResourceId: 'water-media-0002',
    })
    for (const resourceId of ['water-media-0001', 'water-media-0002']) {
      const texture = await reopened.source.texture?.(`uvw-resource:main/${resourceId}`, {
        maxBytes: 1024,
      })
      expect(texture?.state).toBe('decoded')
      if (texture?.state === 'decoded') expect(texture.texture.rgba).toEqual(rgba)
    }
  })

  it('joins prefixed water catalog IDs to portable media and reopens texture bytes', async () => {
    const original = sourceWithDualWaterTextures()
    const source = {
      ...original,
      async page(request: Parameters<typeof original.page>[0], signal?: AbortSignal) {
        const page = await original.page(request, signal)
        if (request.facet !== 'layers' || page.state !== 'available') return page
        return { ...page, items: page.items.map(item => item.facet === 'layers' && item.kind === 'water' ? {
          ...item,
          ...(item.waterMaterials === undefined ? {} : { waterMaterials: item.waterMaterials.map(material => ({
            ...material, materialId: `native:${material.materialId}`,
          })) }),
        } : item) }
      },
    }
    const packed = await materializeWorldToUvpMap(source, options)
    expect(packed.state).toBe('materialized')
    if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
    expect(packed.packagedTextureCount).toBe(3)
    const reopened = await openUvpMapBundle(packed.entries, {
      snapshotId: 'prefixed-water', rasterResources,
    })
    const water = reopened.document.spaces[0]?.layers.find(layer => layer.kind === 'water')
    expect(water?.materials?.[0]).toMatchObject({
      id: 'water-surface', baseColorResourceId: 'water-media-0001',
      secondaryColorResourceId: 'water-media-0002',
    })
    for (const id of ['water-media-0001', 'water-media-0002']) {
      const texture = await reopened.source.texture?.(`uvw-resource:main/${id}`, { maxBytes: 1024 })
      expect(texture?.state).toBe('decoded')
      if (texture?.state === 'decoded') expect(texture.texture.rgba).toEqual(rgba)
    }
  })

  it('packages and independently reopens exact RGBA terrain weight rasters', async () => {
    const packed = await materializeWorldToUvpMap(sourceWithWeightRaster(), options)
    expect(packed.state).toBe('materialized')
    if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
    expect(packed.packagedTextureCount).toBe(2)
    expect([...packed.entries.keys()]).toEqual([
      'uvp.manifest.json',
      'world/main.uvw.json',
      'media/terrain/terrain-media-0000.png',
      'media/terrain/terrain-media-0001.png',
    ])
    const reopened = await openUvpMapBundle(
      new Map([...packed.entries].map(([path, bytes]) => [path, bytes.slice()])),
      { snapshotId: 'detached-weight-raster', rasterResources },
    )
    const materialLayer = reopened.document.spaces[0]?.layers.find(
      layer => layer.kind === 'terrain-materials',
    )
    expect(materialLayer?.samples).toBeUndefined()
    expect(materialLayer?.materials[0]?.atlas).toEqual({ rows: 2 })
    expect(materialLayer?.weightRasters).toEqual([
      {
        resourceId: 'terrain-media-0001',
        width: 2,
        height: 2,
        materialIds: ['grass'],
        encoding: 'rgba8-unorm',
        normalization: 'sum',
      },
    ])
    const texture = await reopened.source.texture?.('uvw-resource:main/terrain-media-0001', {
      maxBytes: 1024,
    })
    expect(texture?.state).toBe('decoded')
    if (texture?.state === 'decoded') expect(texture.texture.rgba).toEqual(rgba)
  })

  it('materializes UVW plus owned texture bytes and reopens without the original source', async () => {
    const packed = await materializeWorldToUvpMap(source(), options)
    expect(packed.state).toBe('materialized')
    if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
    expect(packed.packagedTextureCount).toBe(1)
    expect(Number.isSafeInteger(packed.observedTerrainItems)).toBe(true)
    expect([...packed.entries.keys()]).toEqual([
      'uvp.manifest.json',
      'world/main.uvw.json',
      'media/terrain/terrain-media-0000.png',
    ])

    const detached = new Map(
      [...packed.entries].map(([path, bytes]) => [String(path), Uint8Array.from(bytes)]),
    )
    const reopened = await openUvpMapBundle(detached, {
      snapshotId: 'detached-snapshot',
      rasterResources,
    })
    const materialLayer = reopened.document.spaces[0]?.layers.find(
      layer => layer.kind === 'terrain-materials',
    )
    expect(materialLayer?.materials[0]?.baseColorResourceId).toBe('terrain-media-0000')
    expect(reopened.embeddedResources.size).toBe(1)
    const texture = await reopened.source.texture?.('uvw-resource:main/terrain-media-0000', {
      maxBytes: 1024,
    })
    expect(texture?.state).toBe('decoded')
    if (texture?.state === 'decoded') expect(texture.texture.rgba).toEqual(rgba)
  })

  it('refuses tampered media and path escape manifests', async () => {
    const packed = await materializeWorldToUvpMap(source(), options)
    if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
    const tampered = new Map(packed.entries)
    tampered.set('media/terrain/terrain-media-0000.png', Uint8Array.of(0))
    await expect(openUvpMapBundle(tampered, { snapshotId: 'tampered' })).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.uv/uvp-hash-mismatch',
    )

    const manifest = JSON.parse(new TextDecoder().decode(packed.manifestBytes)) as {
      contents: { family: string; path: string; hash: string }[]
    }
    manifest.contents[0]!.path = '../world.uvw.json'
    const escaped = new Map(packed.entries)
    escaped.set('uvp.manifest.json', new TextEncoder().encode(JSON.stringify(manifest)))
    await expect(openUvpMapBundle(escaped, { snapshotId: 'escaped' })).rejects.toSatisfy(
      error => isModkitError(error) && error.code === 'x3.uv/uvp-path-invalid',
    )
  })

  it('packages object UVM and its raster, then reopens a detached executable model route', async () => {
    const sourceModel = sourceWithModel()
    let requestedModelBytes: number | undefined
    const packed = await materializeWorldToUvpMap(
      {
        ...sourceModel,
        async model(resourceId, request) {
          requestedModelBytes = request.maxBytes
          return sourceModel.model!(resourceId)
        },
      },
      options,
    )
    expect(packed.state).toBe('materialized')
    if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
    expect(packed.packagedModelCount).toBe(1)
    expect(requestedModelBytes).toBe(16 * 1024 * 1024)
    expect(packed.packagedTextureCount).toBe(2)
    expect([...packed.entries.keys()]).toEqual([
      'uvp.manifest.json',
      'world/main.uvw.json',
      'models/object-model-0000.uvm.glb',
      'media/terrain/terrain-media-0000.png',
      'media/models/object-model-0000-texture-0000.png',
    ])
    const detached = new Map([...packed.entries].map(([path, bytes]) => [path, bytes.slice()]))
    const packagedModel = detached.get('models/object-model-0000.uvm.glb')!
    const container = readUvmContainer(packagedModel)
    const images = container.document['images']
    expect(Array.isArray(images)).toBe(true)
    const image = (images as { uri?: string; name?: string }[])[0]!
    expect(image.name).toBe('texture.dds')
    expect(image.uri).toBe('media/models/object-model-0000-texture-0000.png')
    const reopened = await openUvpMapBundle(detached, {
      snapshotId: 'detached-model-snapshot',
      rasterResources,
      modelDecoder: createEmbeddedUvmWorldModelDecoder(rasterResources),
    })
    const objectLayer = reopened.document.spaces[0]?.layers.find(layer => layer.kind === 'objects')
    if (objectLayer?.kind !== 'objects') throw new Error('detached object layer missing')
    expect(objectLayer.instances[0]?.resourceIds).toEqual(['object-model-0000'])
    expect(objectLayer.instances[0]?.modelComponents).toEqual([
      { id: 'body', resourceId: 'object-model-0000' },
    ])
    const model = await reopened.source.model?.('uvw-resource:main/object-model-0000', {
      maxBytes: 1024 * 1024,
      maxMeshes: 8,
      maxPrimitives: 8,
      maxPrimitiveBytes: 1024 * 1024,
    })
    expect(model?.state).toBe('converted')
    if (model?.state !== 'converted') throw new Error('detached model did not decode')
    expect(model.primitives).toHaveLength(1)
    expect(model.animations).toHaveLength(0)
    expect(model.materials).toHaveLength(1)
    expect(model.textures?.[0]?.rgba).toEqual(rgba)
    expect(model.complete).toBe(true)
  })

  it('asks a model with textures inside its maxBytes, and again for what it says it needed', async () => {
    const sourceModel = sourceWithModel()
    const requests: { maxBytes: number; maxTextureTotalBytes?: number }[] = []
    const needed = 20 * 1024 * 1024
    const packed = await materializeWorldToUvpMap(
      {
        ...sourceModel,
        async model(resourceId, request) {
          requests.push(request)
          if (request.maxBytes < needed)
            return {
              state: 'unresolved' as const,
              diagnostics: [
                {
                  severity: 'warning' as const,
                  code: 'x3.host/model-resource-too-large',
                  message: 'too large',
                  data: { maxBytes: request.maxBytes, requiredBytes: needed },
                },
              ],
            }
          return sourceModel.model!(resourceId)
        },
      },
      { ...options, maxMediaBytes: 256 * 1024 * 1024, maxModelBytes: 64 * 1024 * 1024 },
    )
    if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
    expect(packed.packagedModelCount).toBe(1)
    expect(requests.map(request => request.maxBytes)).toEqual([16 * 1024 * 1024, 36 * 1024 * 1024])
    for (const request of requests)
      expect(request.maxTextureTotalBytes).toBeLessThanOrEqual(request.maxBytes)
    // the UVM stays reserved while textures decode: the second ask gives them what it leaves
    expect(requests[1]?.maxTextureTotalBytes).toBe(36 * 1024 * 1024 - needed)
  })

  it('keeps a model whose image came without texels, naming the image', async () => {
    const twoTextures = materializeUvmCore(
      {
        info: {
          scenes: 1,
          nodes: 1,
          meshes: 1,
          primitives: 1,
          materials: 1,
          textures: 2,
          animations: 0,
          geometryAccess: 'decoded',
        },
        ...triangle,
        resourceClosure: {
          mode: 'content-qualified',
          entries: [
            { role: 'texture', logicalId: 'texture.dds', mediaHint: 'image/vnd-ms.dds' },
            { role: 'texture', logicalId: '!fire', mediaHint: 'image/vnd-ms.dds' },
          ],
        },
      },
      {
        scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
        profile: 'UVM/core@1.0',
        subjectRevision: 'provider-token:two-textures' as never,
        options: { assetId: 'fixture/two-textures', sourceFormat: 'fixture' },
      },
    ).bytes
    const sourceModel = sourceWithModel()
    const packed = await materializeWorldToUvpMap(
      {
        ...sourceModel,
        async model(resourceId) {
          const converted = await sourceModel.model!(resourceId)
          return { ...converted, uvmBytes: twoTextures.slice() } as typeof converted
        },
      },
      options,
    )
    if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
    expect(packed.packagedModelCount).toBe(1)
    expect(packed.unpackagedModelTextureIds).toEqual(['!fire'])
    expect(packed.excludedFacetIds).toContain('world.object-model-resources')
    const images = readUvmContainer(packed.entries.get('models/object-model-0000.uvm.glb')!)
      .document['images'] as { uri: string }[]
    expect(images.map(image => image.uri).sort()).toEqual(
      ['!fire', 'media/models/object-model-0000-texture-0000.png'].sort(),
    )
  })
})

describe('single-file UVP', () => {
  it('packs the bundle as one ZIP the archive codec reads back and the bundle reopens from', async () => {
    const packed = await materializeWorldToUvpMap(source(), options)
    if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
    const budget = { maxNodes: 100, maxInputBytes: 1n << 24n }
    const archive = packUvpArchive(packed.entries, budget)
    // the manifest leads, the contents follow in path order, stored (SPEC_UVP §2)
    const listed = parseZipArchive(archive, 100)
    expect(listed.map(entry => [entry.name, entry.method])).toEqual([
      ['uvp.manifest.json', 0],
      ['media/terrain/terrain-media-0000.png', 0],
      ['world/main.uvw.json', 0],
    ])
    const read = new Map<string, Uint8Array>()
    for (const entry of listed) read.set(entry.name, await extractZipArchiveEntry(archive, entry))
    const reopened = await openUvpMapBundle(read, { snapshotId: 'single-file', rasterResources })
    expect(reopened.embeddedResources.size).toBe(1)
    // the entries' order never reaches the bytes
    expect(packUvpArchive(new Map([...packed.entries].reverse()), budget)).toEqual(archive)
    const headless = new Map([...packed.entries].filter(([path]) => path !== 'uvp.manifest.json'))
    expect(() => packUvpArchive(headless, budget)).toThrow(
      expect.objectContaining({ code: 'x3.uv/uvp-entry-missing' }),
    )
  })

  it('refuses entry names that collide by case or Unicode form, and encoded segments', async () => {
    const packed = await materializeWorldToUvpMap(source(), options)
    if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
    const refusal = (path: string) =>
      openUvpMapBundle(new Map([...packed.entries, [path, new Uint8Array(1)]]), {
        snapshotId: 'names',
      }).then(
        () => 'opened',
        (error: unknown) => (isModkitError(error) ? error.code : String(error)),
      )
    expect(await refusal('World/Main.uvw.json')).toBe('x3.uv/uvp-path-collision')
    expect(await refusal('media/a%2Fb.png')).toBe('x3.uv/uvp-path-invalid')
  })
})
