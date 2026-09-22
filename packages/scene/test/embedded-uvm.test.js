import assert from 'node:assert/strict'
import { it } from 'node:test'
import { readUvmContainer, writeUvmContainer } from '@modkit/uv/model/container'
import { appendUvmAccessors } from '@modkit/uv/model/accessor-write'
import { createEmbeddedUvmWorldModelDecoder } from '../src/world/embedded-uvm.js'
import { createWorldWebGlPlan } from '../src/world/webgl.js'

const budget = {
  maxBytes: 65536,
  maxMeshes: 8,
  maxPrimitives: 8,
  maxPrimitiveBytes: 4096,
  maxTextureBytes: 64,
  maxTextureTotalBytes: 128,
}
const payload = Uint8Array.of(0, 255, 128)
function input(images, mediaByUri = new Map()) {
  return {
    resourceId: 'model',
    uri: 'models/model.uvm.glb',
    mediaByUri,
    bytes: writeUvmContainer({
      format: 'glb',
      extraChunks: [],
      binary: payload,
      document: {
        asset: {
          version: '2.0',
          extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } },
        },
        extensionsUsed: ['UV_asset', 'UV_provenance'],
        extensions: {
          UV_asset: { id: 'embedded-texture', class: 'model' },
          UV_provenance: { source: { format: 'uvm' }, importer: { id: 'test', version: '1' } },
        },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{}],
        buffers: [{ byteLength: payload.length }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: payload.length }],
        images,
      },
    }),
  }
}
function rasterPort(reads, mutate = () => {}) {
  return {
    async read(request) {
      reads.push(request)
      assert.equal(request.kind, 'embedded')
      assert.deepEqual(request.bytes, payload)
      const result = {
        state: 'decoded',
        diagnostics: [],
        info: { width: 1, height: 2, orientation: 'bottom-left', alphaMode: 'premultiplied' },
        region: {
          width: 1,
          height: 2,
          rowStride: 8,
          pixelFormat: 'rgba8',
          pixels: Uint8Array.of(7, 8, 9, 0, 99, 99, 99, 99, 64, 32, 16, 128),
        },
      }
      mutate(result)
      return result
    },
  }
}

it('joins portable base-color image references to decoded textures in the world renderer', async () => {
  const source = input([{ bufferView: 0, mimeType: 'image/png' }])
  const appended = appendUvmAccessors(readUvmContainer(source.bytes), [
    { type: 'VEC3', values: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0) },
    { type: 'VEC2', values: Float32Array.of(0, 0, 1, 0, 0, 1) },
  ])
  const container = structuredClone(appended.container)
  container.document.nodes[0].mesh = 0
  container.document.meshes = [
    {
      primitives: [
        {
          mode: 4,
          material: 0,
          attributes: { POSITION: appended.accessors[0], TEXCOORD_0: appended.accessors[1] },
        },
      ],
    },
  ]
  container.document.textures = [{ source: 0 }]
  container.document.materials = [
    {
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        metallicFactor: 0,
        roughnessFactor: 1,
      },
    },
  ]
  const model = await createEmbeddedUvmWorldModelDecoder(rasterPort([]))(
    { ...source, bytes: writeUvmContainer(container) },
    budget,
  )
  const plan = createWorldWebGlPlan({
    items: [
      {
        facet: 'objects',
        id: 'portable-object',
        layerId: 'objects',
        coordinateSpaceId: 'uvw',
        kind: 'unit',
        objectId: 1,
        position: { x: 0, y: 0, z: 0 },
        uvwPosition: { x: 0, y: 0, z: 0 },
        resourceId: 'portable-model',
      },
    ],
    models: new Map([['portable-model', model]]),
  })
  assert.equal(plan.stats.modelTriangles, 1)
  assert.equal(plan.texturedTriangles.length, 1)
  assert.equal(plan.texturedTriangles[0].texture.id, model.textures[0].id)
  assert.deepEqual(plan.texturedTriangles[0].texture.rgba, model.textures[0].rgba)
})

for (const image of [
  { bufferView: 0, mimeType: 'image/png' },
  { uri: 'data:image/png;base64,AP+A' },
  { uri: 'data:image/png,%00%ff%80' },
]) {
  it(`decodes self-contained world UVM images: ${image.uri ?? 'BIN bufferView'}`, async () => {
    const reads = []
    const result = await createEmbeddedUvmWorldModelDecoder(rasterPort(reads))(
      input([{ ...image, name: 'body' }]),
      budget,
    )
    assert.equal(result.complete, true)
    assert.equal(result.resources.length, 1)
    assert.equal(result.textures[0].id, 'body')
    assert.deepEqual(result.textures[0].rgba, Uint8Array.of(64, 32, 16, 128, 7, 8, 9, 0))
    assert.equal(reads[0].mediaType, 'image/png')
  })
}

it('resolves external images only from owned package bytes and reports missing images', async () => {
  const reads = [],
    decode = createEmbeddedUvmWorldModelDecoder(rasterPort(reads))
  const image = { uri: 'media/body.png', name: 'body' }
  const available = await decode(
    input([image], new Map([['media/body.png', { bytes: payload, mediaType: 'image/png' }]])),
    budget,
  )
  assert.equal(available.complete, true)
  const missing = await decode(input([image]), budget)
  assert.equal(missing.complete, false)
  assert.equal(missing.diagnostics[0].code, 'x3.scene/embedded-uvm-texture-unavailable')
  assert.equal(reads.length, 1)
  const noDecoder = await createEmbeddedUvmWorldModelDecoder()(
    input([{ bufferView: 0, mimeType: 'image/png' }]),
    budget,
  )
  assert.equal(noDecoder.complete, false)
  assert.equal(noDecoder.resources.length, 1)
})

it('enforces encoded, decoded and aggregate image budgets', async () => {
  const fixture = input([{ bufferView: 0, mimeType: 'image/png' }])
  const reads = [],
    decode = createEmbeddedUvmWorldModelDecoder(rasterPort(reads))
  await assert.rejects(decode(fixture, { ...budget, maxTextureBytes: 2 }), /maxTextureBytes/)
  assert.equal(reads.length, 0)
  await assert.rejects(
    decode(fixture, { ...budget, maxTextureTotalBytes: 4 }),
    /maxTextureTotalBytes/,
  )
  await assert.rejects(
    decode(
      input([
        { bufferView: 0, mimeType: 'image/png' },
        { bufferView: 0, mimeType: 'image/png' },
      ]),
      { ...budget, maxTextureTotalBytes: 12 },
    ),
    /maxTextureTotalBytes/,
  )
})

it('validates image regions and observes cancellation after raster acquisition', async () => {
  const fixture = input([{ bufferView: 0, mimeType: 'image/png' }])
  await assert.rejects(
    createEmbeddedUvmWorldModelDecoder(
      rasterPort([], result => {
        result.region.pixels = new Uint8Array(1)
      }),
    )(fixture, budget),
    /region/,
  )
  const controller = new AbortController()
  await assert.rejects(
    createEmbeddedUvmWorldModelDecoder(
      rasterPort([], () => {
        controller.abort()
      }),
    )(fixture, budget, controller.signal),
    { name: 'AbortError' },
  )
})
