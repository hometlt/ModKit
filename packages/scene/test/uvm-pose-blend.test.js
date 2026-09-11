// Destination scene/test. Actual renderUvm -> shared renderer contract, existing node:test runner.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendUvmAccessors } from '@modkit/uv/model/accessor-write'
import { writeUvmContainer } from '@modkit/uv/model/container'
import { renderUvm } from '../src/uvm/render.js'
import { renderHeadless } from '../src/render/headless.js'
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
function fixture() {
  const document = {
    asset: { version: '2.0', extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } } },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { mesh: 0, children: [1] },
      {
        translation: [0, 1, 0],
        extensions: { UV_game_socket: { role: 'attachment', sourceName: 'tip' } },
      },
    ],
    materials: [{ extensions: { KHR_materials_unlit: {} } }],
    extensionsUsed: [
      'UV_asset',
      'UV_provenance',
      'UV_game_variants',
      'UV_game_effects',
      'UV_game_socket',
      'KHR_animation_pointer',
      'KHR_materials_unlit',
    ],
    extensions: {
      UV_asset: { id: 'pose-blend', class: 'model' },
      UV_provenance: { source: { format: 'uvm' }, importer: { id: 'test', version: '1' } },
      UV_game_variants: { visibility: [{ mesh: 0, primitive: 0, value: 1 }] },
    },
  }
  // Build accessors before attaching their references; the append result is deeply immutable.
  delete document.nodes[0].mesh
  delete document.extensions.UV_game_variants
  document.extensionsUsed = document.extensionsUsed.filter(
    x => !['UV_game_variants', 'UV_game_effects', 'KHR_animation_pointer'].includes(x),
  )
  const written = appendUvmAccessors(
    { format: 'glb', document, binary: new Uint8Array(), extraChunks: [] },
    [
      { type: 'VEC3', values: Float32Array.of(-0.2, -0.2, 0, 0.2, -0.2, 0, 0, 0.2, 0) },
      { type: 'SCALAR', values: Float32Array.of(0, 1) },
      { type: 'VEC3', values: Float32Array.of(0, 0, 0, 0, 0, 0) },
      { type: 'VEC3', values: Float32Array.of(0, 0, 0, 2, 0, 0) },
      { type: 'SCALAR', values: Float32Array.of(1, 1) },
      { type: 'SCALAR', values: Float32Array.of(0, 0) },
    ],
  )
  const result = structuredClone(written.container),
    d = result.document
  d.nodes[0].mesh = 0
  d.meshes = [
    { primitives: [{ attributes: { POSITION: written.accessors[0] }, material: 0, mode: 4 }] },
  ]
  d.extensionsUsed.push('UV_game_variants', 'UV_game_effects', 'KHR_animation_pointer')
  d.extensions.UV_game_variants = { visibility: [{ mesh: 0, primitive: 0, value: 1 }] }
  d.animations = [7, 12].map((sequence, index) => ({
    name: index === 0 ? 'primary' : 'pose',
    extras: { uv: { sourceSequenceIndex: sequence } },
    samplers: [
      {
        input: written.accessors[1],
        output: written.accessors[index === 0 ? 2 : 3],
        interpolation: 'LINEAR',
      },
      {
        input: written.accessors[1],
        output: written.accessors[index === 0 ? 4 : 5],
        interpolation: 'STEP',
      },
    ],
    channels: [
      { sampler: 0, target: { node: 0, path: 'translation' } },
      {
        sampler: 1,
        target: {
          path: 'pointer',
          extensions: {
            KHR_animation_pointer: { pointer: '/extensions/UV_game_variants/visibility/0/value' },
          },
        },
      },
    ],
  }))
  d.extensions.UV_game_effects = {
    profile: 'common',
    trackTimeUnit: 'seconds',
    particles: [
      {
        name: 'primary-emission',
        node: 0,
        material: 0,
        emissionRate: 0,
        lifeSpan: 3,
        speed: 0,
        gravity: 0,
        emitShape: 'point',
        orientationMode: 'billboard',
        sequenceAnimation: {
          emissionRate: [7, 12].map(sequenceIndex => ({
            sequenceIndex,
            track: {
              lineType: 0,
              globalSeqId: null,
              keys: [{ frame: 0, vector: [sequenceIndex === 7 ? 10 : 0] }],
            },
          })),
        },
      },
    ],
    ribbons: [],
  }
  return writeUvmContainer(result)
}
test('explicit pose samples change geometry and historical anchors while primary clip owns material/effect/visibility', async () => {
  const bytes = fixture(),
    before = bytes.slice(),
    requests = []
  const contracts = {
    async resolve(request) {
      assert.equal(request.contract, 'common.render/scene-3d')
      return {
        value: {
          async render(input) {
            requests.push(input)
            return renderHeadless(input)
          },
        },
        async release() {},
      }
    },
  }
  const request = {
    schemaVersion: 1,
    clipId: 'animation-0',
    time: 0.5,
    poseSamples: [{ clipId: 'animation-1', time: 1, weight: 1 }],
    viewport: { width: 32, height: 32 },
    camera: {
      viewProjection: [0.25, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, 1],
      viewMatrix: identity,
    },
  }
  const options = {
    contracts,
    budget: {
      maxInputBytes: 16777216n,
      maxScalarBytes: 16777216,
      maxNodes: 100000,
      maxDepth: 96,
      maxDiagnostics: 100,
    },
  }
  await renderUvm(bytes, request, options)
  const rendered = requests[0],
    mesh = rendered.scene.primitives.find(x => x.id.startsWith('mesh-'))
  assert.ok(mesh, 'primary visibility remains on despite the pose clip visibility being off')
  const expected = [...identity]
  expected[12] = 2
  assert.deepEqual([...mesh.transform], expected)
  assert.equal(rendered.scene.materialContext.sequenceIndex, 7)
  assert.equal(rendered.scene.materialContext.sequenceTime, 0.5)
  const particles = rendered.scene.primitives.filter(x => x.id.includes('effect-particle'))
  assert.equal(particles.length, 5, 'primary 10 Hz effect curve remains selected')
  const centers = particles.map(primitive =>
    [0, 1, 2].map(
      axis =>
        [0, 1, 2, 3].reduce((sum, vertex) => sum + primitive.positions[vertex * 3 + axis], 0) / 4,
    ),
  )
  centers.forEach((center, index) => {
    assert.ok(Math.abs(center[0] - (1 + (index + 1) * 0.2)) < 2e-5)
    assert.ok(Math.abs(center[1]) < 2e-5)
    assert.ok(Math.abs(center[2]) < 2e-5)
  })
  assert.deepEqual(bytes, before)
  await assert.rejects(
    () =>
      renderUvm(
        bytes,
        { ...request, poseSamples: [{ clipId: 'absent', time: 0, weight: 1 }] },
        options,
      ),
    /unknown pose sample/,
  )
})
