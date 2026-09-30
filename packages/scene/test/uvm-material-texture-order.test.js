import assert from 'node:assert/strict'
import { it } from 'node:test'
import { materializeUvmCore } from '@modkit/uv/model/materializer'
import { readUvmContainer, writeUvmContainer } from '@modkit/uv/model/container'
import { renderUvm } from '../src/uvm/render.js'
import { renderHeadless } from '../src/render/headless.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/**
 * A triangle whose game material draws `layer.dds` and whose glTF base colour, the fallback drawn
 * while the game layers are unresolved, is `base.dds`.
 */
function model() {
  const { bytes } = materializeUvmCore(
    {
      info: { scenes: 1, nodes: 1, meshes: 1, primitives: 1, materials: 1, textures: 1, geometryAccess: 'decoded' },
      nodes: [{ id: 'node', childIds: [], meshIds: ['mesh'], transform: identity }],
      meshes: [{ id: 'mesh', primitiveIds: ['triangle'] }],
      primitives: [
        {
          id: 'triangle',
          topology: 'triangles',
          positions: Float32Array.from([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
          normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]),
          textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1]),
          indices: Uint32Array.from([0, 1, 2]),
          materialId: 'surface',
        },
      ],
      materials: [{ id: 'surface', layers: [{ slot: 'diffuse', resourceId: 'base.dds' }] }],
      resourceClosure: { mode: 'logical', entries: [{ role: 'texture', logicalId: 'base.dds' }] },
    },
    {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: 'provider-token:material-texture-order',
      options: { assetId: 'fixture/material-texture-order', sourceFormat: 'json' },
    },
  )
  const container = readUvmContainer(bytes)
  const layer = {
    channels: 0,
    clampResult: true,
    colorAdd: { value: 0 },
    colorMultiply: { value: 1 },
    invert: false,
    op: 2,
    slot: 'emissive1',
    teamColorMode: 0,
    texturePath: 'layer.dds',
    uvSource: 0,
    wrapX: true,
    wrapY: true,
  }
  const document = {
    ...container.document,
    extensionsUsed: [...new Set([...(container.document.extensionsUsed ?? []), 'UV_game_material'])],
    materials: container.document.materials.map(material => ({
      ...material,
      extensions: {
        ...material.extensions,
        UV_game_material: {
          shader: 'modkit.render-material.v1',
          params: {
            renderModel: {
              version: 1,
              layers: [{ label: 'emissive1', path: 'layer.dds' }],
              standard: {
                alphaTestThreshold: 0,
                blendMode: 0,
                clampOutput: false,
                depthPrepass: false,
                doubleLambert: false,
                emisMult: 1,
                environmentMultipliers: [1, 0, 0],
                layers: { emissive1: layer },
                materialClass: 0,
                priority: 0,
                specMode: 0,
                specMult: 1,
                specularity: 20,
                twoSided: true,
                unshaded: true,
                usesVertexAlpha: false,
                usesVertexColor: false,
              },
            },
          },
        },
      },
    })),
  }
  return writeUvmContainer({ ...container, document })
}

async function render(resolved) {
  const requested = []
  const frame = await renderUvm(
    model(),
    {
      schemaVersion: 1,
      time: 0,
      viewport: { width: 8, height: 8 },
      camera: { viewProjection: identity },
    },
    {
      contracts: {
        async resolve() {
          return { value: { render: renderHeadless }, release: () => Promise.resolve() }
        },
      },
      rasterResources: {
        async read(request) {
          const logicalId = request.requirement?.logicalId ?? request.logicalId
          requested.push(logicalId)
          if (!resolved.includes(logicalId)) return { state: 'unresolved', diagnostics: [] }
          return {
            state: 'decoded',
            diagnostics: [],
            info: { width: 1, height: 1, faces: 1, orientation: 'top-left', alphaMode: 'straight' },
            region: {
              width: 1,
              height: 1,
              rowStride: 4,
              pixelFormat: 'rgba8',
              pixels: Uint8Array.of(0, 255, 0, 255),
            },
          }
        },
      },
      budget: {
        maxInputBytes: 8_388_608n,
        maxScalarBytes: 8_388_608,
        maxNodes: 10000,
        maxDepth: 64,
        maxDiagnostics: 100,
      },
    },
  )
  return { requested, frame }
}

it('decodes a game material its own layers and leaves the unneeded base-colour fallback alone', async () => {
  // Decoding every fallback first spent the shared budget on textures the material shader never
  // samples, and a model with large layers then lost whole materials to their fallback.
  const { requested, frame } = await render(['layer.dds', 'base.dds'])
  assert.deepEqual(requested, ['layer.dds'])
  assert.ok(frame.statistics.fragments > 0)
  assert.ok(!frame.diagnostics.some(item => item.code === 'common.scene/material-texture-unresolved'))
})

it('still decodes the base-colour fallback of a game material whose layers are unresolved', async () => {
  const { requested } = await render(['base.dds'])
  assert.deepEqual(requested, ['layer.dds', 'base.dds'])
})
