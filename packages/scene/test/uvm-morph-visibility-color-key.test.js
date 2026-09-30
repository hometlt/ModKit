import assert from 'node:assert/strict'
import { it } from 'node:test'
import { materializeUvmCore } from '@modkit/uv/model/materializer'
import { readUvmContainer } from '@modkit/uv/model/container'
import { readUvmModel } from '../src/uvm/model.js'
import { createModelSceneSampler } from '../src/model/sampler.js'
import { renderUvm } from '../src/uvm/render.js'
import { renderHeadless } from '../src/render/headless.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const triangle = (id, extra = {}) => ({
  id,
  topology: 'triangles',
  positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  textureCoordinates: Float32Array.from([0, 0, 1, 0, 0, 1]),
  indices: Uint32Array.from([0, 1, 2]),
  materialId: 'surface',
  ...extra,
})

/**
 * A worm-like body whose vertices move by morph targets (Emperor's compressed vertex animation), a
 * `#` helper box the game never draws unless a clip shows it, and a magenta-keyed texture.
 */
function model() {
  const projection = {
    info: {
      scenes: 1,
      nodes: 2,
      meshes: 2,
      primitives: 2,
      materials: 1,
      textures: 1,
      animations: 2,
      geometryAccess: 'decoded',
    },
    nodes: [
      { id: 'body', childIds: ['helper'], meshIds: ['body-mesh'], transform: identity },
      { id: 'helper', childIds: [], meshIds: ['helper-mesh'], transform: identity },
    ],
    meshes: [
      { id: 'body-mesh', primitiveIds: ['body'] },
      { id: 'helper-mesh', primitiveIds: ['helper'] },
    ],
    primitives: [
      triangle('body', {
        morphTargets: [
          { name: 'Frame 0', positions: Float32Array.from([2, 0, 0, 0, 0, 0, 0, 0, 0]) },
          { name: 'Frame 1', positions: Float32Array.from([0, 4, 0, 0, 0, 0, 0, 0, 0]) },
        ],
      }),
      triangle('helper', { hidden: true }),
    ],
    materials: [
      {
        id: 'surface',
        alphaMode: 'mask',
        alphaCutoff: 0.5,
        layers: [{ slot: 'diffuse', resourceId: '!%shel' }],
      },
    ],
    animations: [
      {
        id: 'move',
        name: 'Move',
        kind: 'animation',
        provenance: 'direct',
        frames: 2,
        channels: [
          {
            target: 'body',
            kind: 'weights',
            firstFrame: 0,
            lastFrame: 1,
            interpolation: 'linear',
            samples: [
              { frame: 0, timeSeconds: 0, value: [1, 0] },
              { frame: 1, timeSeconds: 1, value: [0, 1] },
            ],
          },
        ],
      },
      {
        id: 'show',
        name: 'Show helper',
        kind: 'animation',
        provenance: 'direct',
        frames: 1,
        channels: [
          {
            target: 'helper',
            kind: 'visibility',
            firstFrame: 0,
            lastFrame: 0,
            interpolation: 'step',
            samples: [{ frame: 0, timeSeconds: 0, value: [1] }],
          },
        ],
      },
    ],
    resourceClosure: {
      mode: 'logical',
      entries: [{ role: 'texture', logicalId: '!%shel', colorKey: { color: [255, 0, 255] } }],
    },
  }
  const { bytes } = materializeUvmCore(projection, {
    scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
    profile: 'UVM/core@1.0',
    subjectRevision: 'provider-token:morph-visibility-color-key',
    options: { assetId: 'fixture/morph-visibility-color-key', sourceFormat: 'json' },
  })
  return bytes
}

const decoded = () => {
  const { document, binary } = readUvmContainer(model())
  return readUvmModel(document, binary, { maxScalarBytes: 16_000_000 })
}

const sampled = (clipName, time) => {
  const { scene, rig } = decoded()
  const clip = rig.clips.find(candidate => candidate.name === clipName)
  const sample = createModelSceneSampler(
    { ...scene, skeleton: rig.bindings, nodePoses: rig.nodePoses },
    clip === undefined ? {} : { clip },
  ).sample(time)
  return {
    primitives: sample.primitives,
    diagnostics: sample.diagnostics.map(item => item.code),
  }
}

it('reads UVM morph targets, mesh weights, weights channels and stored invisibility', () => {
  const { scene, rig } = decoded()
  const body = scene.primitives.find(primitive => primitive.id === 'mesh-0-primitive-0')
  assert.equal(body?.morphTargets?.length, 2)
  assert.deepEqual(
    body?.morphTargets?.map(target => target.name),
    ['Frame 0', 'Frame 1'],
  )
  assert.deepEqual([...(body?.morphTargets?.[1]?.positions ?? [])].slice(0, 3), [0, 4, 0])
  assert.deepEqual(scene.meshes[0]?.morphWeights, [0, 0])
  assert.equal(
    scene.primitives.find(primitive => primitive.id === 'mesh-1-primitive-0')?.hidden,
    true,
  )
  const move = rig.clips.find(clip => clip.name === 'Move')
  assert.deepEqual(
    move?.channels.map(channel => [channel.kind, channel.target, channel.samples?.[1]?.value]),
    [['weights', 'node-0', [0, 1]]],
  )
})

it('moves vertices by the sampled morph weights and draws no hidden primitive without a clip', () => {
  const rest = sampled(undefined, 0)
  assert.equal(rest.primitives.length, 1, 'the hidden helper is not drawn')
  assert.deepEqual([...rest.primitives[0].positions.slice(0, 3)], [0, 0, 0])
  assert.equal(rest.primitives[0].morphTargets, undefined, 'targets are not handed to a renderer')

  const start = sampled('Move', 0)
  assert.deepEqual([...start.primitives[0].positions.slice(0, 3)], [2, 0, 0])
  const middle = sampled('Move', 0.5)
  assert.deepEqual([...middle.primitives[0].positions.slice(0, 3)], [1, 2, 0])
  assert.ok(!middle.diagnostics.includes('common.model/animation-channels-unrendered'))
})

it('draws a hidden primitive while a clip shows it', () => {
  const shown = sampled('Show helper', 0)
  assert.equal(shown.primitives.length, 2)
})

it('keys the magenta texels of a keyed texture to transparent black before rendering', async () => {
  const magenta = new Uint8Array(4 * 4 * 4)
  for (let offset = 0; offset < magenta.length; offset += 4) magenta.set([255, 0, 255, 255], offset)
  magenta.set([10, 200, 30, 255], 0)
  let captured
  const contracts = {
    async resolve() {
      return {
        value: {
          async render(input) {
            captured = input
            return renderHeadless(input)
          },
        },
        async release() {},
      }
    },
  }
  await renderUvm(
    model(),
    {
      schemaVersion: 1,
      time: 0,
      viewport: { width: 4, height: 4 },
      camera: { viewProjection: identity },
    },
    {
      budget: {
        maxInputBytes: 64_000_000n,
        maxScalarBytes: 64_000_000,
        maxNodes: 100_000,
        maxDepth: 96,
        maxDiagnostics: 100,
      },
      contracts,
      textures: new Map([[0, { width: 4, height: 4, rgba: magenta }]]),
    },
  )
  const texture = (captured.scene.textures ?? captured.textures ?? []).find(
    item => item.id === 'uvm-texture-0',
  )
  assert.ok(texture, 'the keyed texture reaches the renderer')
  assert.deepEqual([...texture.rgba.slice(0, 8)], [10, 200, 30, 255, 0, 0, 0, 0])
  assert.equal(
    texture.rgba.filter((value, index) => index % 4 === 3 && value !== 0).length,
    1,
    'every magenta texel is transparent',
  )
})
