import assert from 'node:assert/strict'
import { it } from 'node:test'
import { materializeUvmCore } from '@modkit/uv/model/materializer'
import { readUvmContainer, writeUvmContainer } from '@modkit/uv/model/container'
import { decodePngSamples } from '@modkit/codec-kit/raster'
import { encodeRgbaPng } from '../src/output/png.js'
import { prepareUvmRender } from '../src/uvm/render.js'
import { renderHeadless } from '../src/render/headless.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const paths = ['skin.tga', 'normal.tga', 'specular.tga']
const pixels = [
  Uint8Array.of(40, 210, 70, 255),
  Uint8Array.of(128, 128, 255, 23),
  Uint8Array.of(40, 50, 60, 17),
]
const budget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 128,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const request = {
  schemaVersion: 1,
  viewport: { width: 16, height: 16 },
  camera: { viewProjection: identity },
  clearColor: [0, 0, 0, 0],
}

async function fixture() {
  const layers = Object.fromEntries(
    ['diffuse', 'normal', 'specular'].map((slot, index) => [
      slot,
      {
        slot,
        texturePath: paths[index],
        uvSource: 0,
        channels: 1,
        op: 2,
        teamColorMode: 0,
        invert: false,
        clampResult: false,
        wrapX: true,
        wrapY: true,
      },
    ]),
  )
  const { bytes } = materializeUvmCore(
    {
      info: {
        scenes: 1,
        nodes: 1,
        meshes: 1,
        primitives: 1,
        materials: 1,
        textures: 3,
        animations: 0,
        geometryAccess: 'decoded',
      },
      nodes: [{ id: 'root', childIds: [], meshIds: ['mesh'], transform: identity }],
      meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
      primitives: [
        {
          id: 'triangle',
          topology: 'triangles',
          materialId: 'material',
          positions: Float32Array.of(-0.8, -0.8, 0, 0.8, -0.8, 0, 0, 0.8, 0),
          normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1),
          textureCoordinates: Float32Array.of(0, 0, 1, 0, 0.5, 1),
          indices: Uint32Array.of(0, 1, 2),
        },
      ],
      materials: [
        {
          id: 'material',
          layers: paths.map((resourceId, index) => ({
            slot: ['diffuse', 'normal', 'specular'][index],
            resourceId,
          })),
          shader: {
            id: 'modkit.render-material.v1',
            parameters: {
              renderModel: {
                version: 1,
                standard: {
                  layers,
                  blendMode: 0,
                  priority: 0,
                  specularity: 16,
                  specMult: 1,
                  emisMult: 1,
                  specMode: 0,
                  alphaTestThreshold: 0.5,
                  twoSided: true,
                  unshaded: true,
                  doubleLambert: false,
                  clampOutput: true,
                  usesVertexColor: false,
                  usesVertexAlpha: false,
                  normalMapFormat: 'rgb8',
                },
              },
            },
          },
        },
      ],
      resourceClosure: {
        mode: 'logical',
        entries: paths.map(logicalId => ({ role: 'image', logicalId })),
      },
    },
    {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: 'provider-token:embedded-material',
      options: { assetId: 'embedded', sourceFormat: 'fixture' },
    },
  )
  const parsed = readUvmContainer(bytes)
  const container = { ...parsed, document: structuredClone(parsed.document) }
  for (const [index, image] of container.document.images.entries()) {
    const png = await encodeRgbaPng({ width: 1, height: 1, rgba: pixels[index] })
    image.name = image.uri
    image.uri = `data:image/png;base64,${Buffer.from(png).toString('base64')}`
    image.mimeType = 'image/png'
  }
  return writeUvmContainer(container)
}

it('binds embedded native aliases through the raster host without any logical read and preserves data alpha', async () => {
  const bytes = await fixture()
  const reads = []
  const prepared = await prepareUvmRender(bytes, request, {
    budget,
    rasterResources: {
      async read(input) {
        reads.push(input.kind)
        assert.equal(input.kind, 'embedded')
        const decoded = await decodePngSamples(input.bytes)
        return {
          state: 'decoded',
          diagnostics: [],
          info: {
            width: decoded.width,
            height: decoded.height,
            faces: 1,
            layers: 1,
            depth: 1,
            frames: 1,
            mipLevels: 1,
            orientation: 'top-left',
            alphaMode: 'straight',
            channelLayout: 'rgba',
            decodedAccess: true,
          },
          region: {
            width: decoded.width,
            height: decoded.height,
            rowStride: decoded.width * 4,
            pixelFormat: 'rgba8',
            pixels: Uint8Array.from(decoded.samples),
          },
        }
      },
    },
  })
  assert.deepEqual(reads, ['embedded', 'embedded', 'embedded'])
  assert.equal(prepared.request.scene.materials[0].textureBindings.length, 3)
  assert.deepEqual(
    prepared.request.scene.textures.map(texture => [...texture.rgba]),
    pixels.map(pixel => [...pixel]),
  )
  assert.ok(!prepared.diagnostics.some(item => /unresolved|image-unrendered/.test(item.code)))
  const frame = await renderHeadless(prepared.request)
  assert.ok(frame.rgba.some((value, index) => index % 4 === 1 && value > 180))
})

it('reuses caller texels by image alias without a raster host or a second decode', async () => {
  const bytes = await fixture()
  const textures = new Map(
    pixels.map((rgba, index) => [index, { id: 'caller', width: 1, height: 1, rgba }]),
  )
  const prepared = await prepareUvmRender(bytes, request, { budget, textures })
  assert.equal(prepared.request.scene.materials[0].textureBindings.length, 3)
  assert.deepEqual(
    prepared.request.scene.textures.map(texture => texture.id),
    ['uvm-texture-0', 'uvm-texture-1', 'uvm-texture-2'],
  )
  assert.ok(!prepared.diagnostics.some(item => /unresolved|image-unrendered/.test(item.code)))
  const owned = prepared.request.scene.textures[0].rgba.slice()
  textures.get(0).rgba.fill(0)
  assert.deepEqual(prepared.request.scene.textures[0].rgba, owned)
})

it('refuses conflicting embedded image aliases instead of choosing a different texture', async () => {
  const source = readUvmContainer(await fixture())
  const document = structuredClone(source.document)
  document.images[1].name = document.images[0].name
  const bytes = writeUvmContainer({ ...source, document })
  await assert.rejects(
    prepareUvmRender(bytes, request, { budget }),
    /ambiguous UVM material image identity/,
  )
})
