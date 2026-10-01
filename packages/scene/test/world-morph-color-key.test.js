import assert from 'node:assert/strict'
import { it } from 'node:test'
import { materializeUvmCore } from '@modkit/uv/model/materializer'
import { createWorldWebGlPlan } from '../src/world/webgl.js'
import { presentWorldModelTextures } from '../src/world/color-keys.js'
import { createEmbeddedUvmWorldModelDecoder } from '../src/world/embedded-uvm.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const values = plan =>
  JSON.stringify(plan, (_, value) => (value instanceof Map ? [...value] : value))

const actor = {
  facet: 'objects',
  id: 'actor',
  layerId: 'objects',
  coordinateSpaceId: 'uvw',
  kind: 'doodad',
  objectId: 1,
  resourceId: 'actor',
  position: { x: 0, y: 0, z: 0 },
  uvwPosition: { x: 0, y: 0, z: 0 },
}

/** An object whose only motion is a vertex animation: its Stand clip keys morph weights. */
function morphModel() {
  return {
    state: 'converted',
    sourceKey: 'actor',
    complete: true,
    diagnostics: [],
    nodes: [{ id: 'root', childIds: [], meshIds: ['mesh'], transform: identity }],
    meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
    primitives: [
      {
        id: 'triangle',
        topology: 'triangles',
        positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, -1),
        morphTargets: [{ positions: Float32Array.of(0, 2, 0, 0, 0, 0, 0, 0, 0) }],
      },
    ],
    animations: [
      {
        id: 'stand',
        name: 'Stand',
        kind: 'animation',
        provenance: 'direct',
        frames: 2,
        durationSeconds: 1,
        looping: true,
        channels: [
          {
            target: 'root',
            kind: 'weights',
            firstFrame: 0,
            lastFrame: 1,
            interpolation: 'linear',
            samples: [
              { frame: 0, timeSeconds: 0, value: [0] },
              { frame: 1, timeSeconds: 1, value: [1] },
            ],
          },
        ],
      },
    ],
  }
}

// one model result for every plan, as the world viewer keeps it while the clock runs
function world(timeSeconds, model = morphModel()) {
  const terrain = Array.from({ length: 4 }, (_, i) => ({
    facet: 'terrain',
    id: `ground:${i}`,
    layerId: 'ground',
    coordinateSpaceId: 'height-grid',
    lod: 'exact',
    x: i % 2,
    y: Math.floor(i / 2),
    heightBase: 0,
    heightAdjustment: 0,
    mask: 0,
    uvwPosition: { x: i % 2, y: 0, z: -Math.floor(i / 2) },
  }))
  return {
    items: [...terrain, actor],
    models: new Map([['actor', model]]),
    timeSeconds,
  }
}

it('follows the clock for an object whose clip keys only morph weights', () => {
  const model = morphModel()
  const first = createWorldWebGlPlan(world(0, model))
  const next = createWorldWebGlPlan(world(0.5, model), first)
  // the first vertex rides the morph target: 0 at the start, half of its 2 at half a second
  const lift = plan => plan.picking.objects.at(-1).triangles[1]
  assert.equal(lift(first), 0)
  // a vertex animation moves the geometry, so the object is not kept from the previous plan
  assert.notEqual(next.picking.objects.at(-1), first.picking.objects.at(-1))
  assert.equal(lift(next), 1)
  assert.equal(values(next), values(createWorldWebGlPlan(world(0.5))))
})

/** A UVM whose one texture the game loads with a magenta colour key. */
function keyedUvm() {
  const { bytes } = materializeUvmCore(
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
      nodes: [{ id: 'girder', childIds: [], meshIds: ['mesh'], transform: identity }],
      meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
      primitives: [
        {
          id: 'triangle',
          topology: 'triangles',
          positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
          textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1),
          indices: Uint32Array.of(0, 1, 2),
          materialId: 'girder',
        },
      ],
      materials: [
        { id: 'girder', layers: [{ slot: 'diffuse', resourceId: 'hk_maingirder_128.tga' }] },
      ],
      resourceClosure: {
        mode: 'logical',
        entries: [
          {
            role: 'texture',
            logicalId: 'hk_maingirder_128.tga',
            colorKey: { color: [255, 0, 255] },
          },
        ],
      },
    },
    {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: 'provider-token:world-color-key',
      options: { assetId: 'fixture/world-color-key', sourceFormat: 'json' },
    },
  )
  return bytes
}
const magenta = () => Uint8Array.of(255, 0, 255, 255, 10, 20, 30, 255)

it('keys the texels of a map model texture the game loads with a colour key', () => {
  const result = {
    state: 'converted',
    sourceKey: 'girder',
    uvmBytes: keyedUvm(),
    complete: true,
    diagnostics: [],
    meshes: [],
    primitives: [],
    textures: [
      { id: 'hk_maingirder_128.tga', width: 2, height: 1, rgba: magenta() },
      {
        id: 'hk_maingirder_128.tga',
        width: 4,
        height: 4,
        rgba: new Uint8Array(0),
        compressed: { format: 'bc1', dimensions: { width: 4, height: 4 }, subresources: [] },
      },
    ],
  }
  const keyed = presentWorldModelTextures(result)
  assert.deepEqual([...keyed.textures[0].rgba], [0, 0, 0, 0, 10, 20, 30, 255])
  // blocks are drawn as stored: the key cannot reach them, and the model says so
  assert.equal(keyed.textures[1], result.textures[1])
  assert.deepEqual(
    keyed.diagnostics.map(item => item.code),
    ['x3.scene/world-texture-color-key-compressed'],
  )
  // a model without the extension comes back as it was
  const plain = { ...result, uvmBytes: undefined }
  assert.equal(presentWorldModelTextures(plain), plain)
})

it('keys a colour-keyed texture of a model packaged in a world', async () => {
  const bytes = keyedUvm()
  const decode = createEmbeddedUvmWorldModelDecoder({
    async read() {
      return {
        state: 'decoded',
        info: {
          width: 2,
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
          x: 0,
          y: 0,
          width: 2,
          height: 1,
          rowStride: 8,
          pixelFormat: 'rgba8',
          pixels: magenta(),
        },
        diagnostics: [],
      }
    },
  })
  const result = await decode(
    {
      resourceId: 'girder',
      uri: 'models/girder.uvm.glb',
      bytes,
      mediaByUri: new Map([
        ['hk_maingirder_128.tga', { bytes: Uint8Array.of(0), mediaType: 'image/x-tga' }],
      ]),
    },
    {
      maxBytes: 16_000_000,
      maxNodes: 16,
      maxMeshes: 16,
      maxPrimitives: 16,
      maxPrimitiveBytes: 1_000_000,
      maxResources: 16,
      maxTextureBytes: 1_000_000,
      maxTextureTotalBytes: 1_000_000,
    },
  )
  assert.equal(result.state, 'converted')
  assert.deepEqual([...result.textures[0].rgba], [0, 0, 0, 0, 10, 20, 30, 255])
})
