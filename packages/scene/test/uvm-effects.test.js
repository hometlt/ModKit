import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createUvmEffectFrame } from '../src/uvm/effects.js'
import { readUvmEffectMeshes } from '../src/uvm/effect-mesh.js'
import { renderUvm } from '../src/uvm/render.js'
import { renderHeadless } from '../src/render/headless.js'
import { writeUvmContainer } from '@modkit/uv/model/container'
import { validateUvmDocument } from '@modkit/uv/model/validation'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
// These pixel fixtures view the pinned live-quad winding from its back face.
// Visibility therefore requires authored two-sided state, as in the actual effect pass.
const material = {
  id: 'material-0',
  baseColor: [1, 1, 1, 1],
  shading: 'unlit',
  doubleSided: true,
}
const emitter = {
  name: 'smoke',
  node: 0,
  material: 0,
  emitShape: 'point',
  orientationMode: 'billboard',
  emissionRate: 10,
  lifeSpan: 1,
  speed: 0,
  gravity: 0,
  maxParticles: 16,
  lifecycleSize: {
    start: [0.3, 0.3, 0.3],
    middle: [0.3, 0.3, 0.3],
    end: [0.3, 0.3, 0.3],
    timeMiddle: 0.5,
  },
  segmentColors: [
    [1, 0, 0],
    [1, 0, 0],
    [1, 0, 0],
  ],
  segmentAlphas: [1, 1, 1],
}
const document = (effects = {}) => ({
  asset: { version: '2.0', extras: { uv: { format: 'UVM', version: '1.0', profile: 'core' } } },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{}],
  materials: [
    {
      doubleSided: true,
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] },
      extensions: { KHR_materials_unlit: {} },
    },
  ],
  extensionsUsed: ['UV_asset', 'UV_provenance', 'UV_game_effects', 'KHR_materials_unlit'],
  extensions: {
    UV_asset: { id: 'scene-effects-fixture', class: 'model' },
    UV_provenance: { source: { format: 'uvm' }, importer: { id: 'scene-test', version: '1' } },
    UV_game_effects: {
      profile: 'common',
      trackTimeUnit: 'seconds',
      particles: [emitter],
      ribbons: [],
      ...effects,
    },
  },
})
const options = (extra = {}) => ({
  time: 0.25,
  viewMatrix: identity,
  materials: [material],
  activeNodes: new Set(['node-0']),
  nodeTransformsAt: () => new Map([['node-0', identity]]),
  maxBytes: 8 * 1024 * 1024,
  maxNodes: 10000,
  ...extra,
})

it('selects per-clip particle burst mode before the shared simulator runs', () => {
  const modeTracks = [0, 1, 0].map((value, sequenceIndex) => ({
    sequenceIndex,
    track: { lineType: 0, globalSeqId: null, keys: [{ frame: 0, vector: [value] }] },
  }))
  const emitCount = [
    {
      sequenceIndex: 1,
      track: { lineType: 0, globalSeqId: null, keys: [{ frame: 0, vector: [5] }] },
    },
  ]
  const counts = []
  for (const sequenceIndex of [0, 1, 2]) {
    const particle = {
      ...emitter,
      emitCount: 0,
      squirt: true,
      sequenceAnimation: { emitCount, squirt: modeTracks },
    }
    const actual = createUvmEffectFrame(
      document({ particles: [particle] }),
      options({ sequenceIndex }),
    )
    const expected = createUvmEffectFrame(
      document({
        particles: [{ ...particle, squirt: sequenceIndex === 1, sequenceAnimation: { emitCount } }],
      }),
      options({ sequenceIndex }),
    )
    assert.deepEqual(actual, expected)
    counts.push(actual.primitives.length)
  }
  assert.ok(counts[0] > 0)
  assert.equal(counts[0], counts[2])
  assert.ok(
    counts[1] > counts[0],
    'the burst clip emits its count instead of integrating the continuous rate',
  )
})
const center = primitive =>
  [0, 1, 2].map(
    component =>
      [0, 1, 2, 3].reduce((sum, vertex) => sum + primitive.positions[vertex * 3 + component], 0) /
      4,
  )

function meshFixture() {
  const input = document({
    particles: [{ ...emitter, emitShape: 'mesh', emitShapeMeshes: [{ positions: 0, indices: 1 }] }],
  })
  // A nonzero view offset, interleaved vertex stride and uint16 indices exercise BIN decoding.
  const binary = new Uint8Array(60),
    view = new DataView(binary.buffer)
  const positions = [
    [0.2, 0.2, 0.5],
    [0.8, 0.2, 0.5],
    [0.2, 0.8, 0.5],
  ]
  positions.forEach((point, vertex) =>
    point.forEach((value, component) =>
      view.setFloat32(4 + vertex * 16 + component * 4, value, true),
    ),
  )
  for (let index = 0; index < 3; index++) view.setUint16(52 + index * 2, index, true)
  input.buffers = [{ byteLength: binary.byteLength }]
  input.bufferViews = [
    { buffer: 0, byteOffset: 4, byteLength: 48, byteStride: 16 },
    { buffer: 0, byteOffset: 52, byteLength: 6 },
  ]
  input.accessors = [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
    { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
  ]
  return { input, binary }
}

it('samples deterministic particles on accessor mesh surfaces with emitter transforms', () => {
  const { input, binary } = meshFixture()
  const translated = identity.slice()
  translated.set([3, -2, 5], 12)
  const settings = options({ binary, nodeTransformsAt: () => new Map([['node-0', translated]]) })
  const first = createUvmEffectFrame(input, settings)
  assert.ok(first.primitives.length >= 2)
  assert.deepEqual(first.diagnostics, [])
  assert.deepEqual(first.primitives, createUvmEffectFrame(input, settings).primitives)
  for (const primitive of first.primitives) {
    const [worldX, worldY, worldZ] = center(primitive)
    const x = worldX - 3,
      y = worldY + 2
    assert.ok(x >= 0.2 - 1e-6 && y >= 0.2 - 1e-6 && x + y <= 1 + 1e-6)
    assert.ok(Math.abs(worldZ - 5.5) < 1e-6)
  }
  assert.notDeepEqual(center(first.primitives[0]), center(first.primitives[1]))
  const expected = createUvmEffectFrame(input, options({ binary }))
  const captured = createUvmEffectFrame(
    input,
    options({
      binary,
      nodeTransformsAt() {
        binary.fill(0)
        return new Map([['node-0', identity]])
      },
    }),
  )
  assert.deepEqual(captured.primitives, expected.primitives)
})

it('renders mesh-emitted particles through the common UVM resolver', async () => {
  const { input, binary } = meshFixture()
  const bytes = writeUvmContainer({ format: 'glb', document: input, binary, extraChunks: [] })
  const frames = []
  const contracts = {
    async resolve() {
      return {
        value: {
          render(request, context) {
            frames.push(request)
            return renderHeadless(request, context)
          },
        },
        release: () => Promise.resolve(),
      }
    },
  }
  const request = {
    schemaVersion: 1,
    time: 0.25,
    viewport: { width: 32, height: 32 },
    camera: { viewProjection: [...identity], viewMatrix: [...identity] },
  }
  const settings = {
    contracts,
    budget: {
      maxInputBytes: 8_388_608n,
      maxScalarBytes: 8_388_608,
      maxNodes: 10000,
      maxDepth: 64,
      maxDiagnostics: 100,
    },
  }
  const first = await renderUvm(bytes, request, settings)
  const second = await renderUvm(bytes, request, settings)
  assert.ok(first.statistics.fragments > 0)
  assert.deepEqual(first.rgba, second.rgba)
  assert.deepEqual(first.diagnostics, [])
  assert.equal(frames.length, 2)
  assert.ok(frames[0].scene.materials.every(value => value.simpleEffect.doubleSided === true))
  const singleSided = structuredClone(input)
  singleSided.materials[0].doubleSided = false
  const culled = await renderUvm(
    writeUvmContainer({ format: 'glb', document: singleSided, binary, extraChunks: [] }),
    request,
    settings,
  )
  // Camera-facing sprites have no back side: a one-sided base material (SC2 geyser steam) still
  // draws its particles, as the game does.
  assert.equal(
    culled.statistics.fragments,
    first.statistics.fragments,
    'particles ignore the base material one-sided flag',
  )
})

it('rejects malformed emission mesh accessors, indices and unusable triangle surfaces', () => {
  const cases = [
    [
      ({ input }) => {
        input.extensions.UV_game_effects.particles[0].emitShapeMeshes = []
      },
      /nonempty/,
    ],
    [
      ({ input }) => {
        input.extensions.UV_game_effects.particles[0].emitShapeMeshes[0].positions = 99
      },
      /index/,
    ],
    [
      ({ input }) => {
        input.extensions.UV_game_effects.particles[0].emitShapeMeshes[0].indices = -1
      },
      /index/,
    ],
    [
      ({ input }) => {
        input.accessors[0].type = 'VEC2'
      },
      /float VEC3/,
    ],
    [
      ({ input }) => {
        input.accessors[0].normalized = true
      },
      /float VEC3/,
    ],
    [
      ({ input }) => {
        input.accessors[1].count = 2
      },
      /integer triangles/,
    ],
    [
      ({ input }) => {
        input.accessors[1].normalized = true
      },
      /integer triangles/,
    ],
    [
      ({ input }) => {
        input.bufferViews[0].buffer = 1
      },
      /external/,
    ],
    [
      ({ input }) => {
        input.bufferViews[0].byteLength = 8
      },
      /BIN/,
    ],
    [
      ({ binary }) => {
        new DataView(binary.buffer).setUint16(52, 3, true)
      },
      /index exceeds/,
    ],
    [
      ({ binary }) => {
        new DataView(binary.buffer).setFloat32(4, NaN, true)
      },
      /finite/,
    ],
    [
      ({ binary }) => {
        binary.fill(0, 4, 52)
      },
      /no usable triangle area/,
    ],
  ]
  for (const [corrupt, pattern] of cases) {
    const fixture = meshFixture()
    corrupt(fixture)
    assert.throws(
      () => createUvmEffectFrame(fixture.input, options({ binary: fixture.binary })),
      pattern,
    )
  }
  assert.throws(() => createUvmEffectFrame(meshFixture().input, options()), /BIN bytes/)
})

it('bounds owned emission arrays and simulator area tables across meshes and emitters', () => {
  const { input, binary } = meshFixture()
  const entries = input.extensions.UV_game_effects.particles[0].emitShapeMeshes
  const result = readUvmEffectMeshes(input, binary, entries, { maxBytes: 312, maxNodes: 5 })
  assert.equal(result.bytes, 312)
  assert.equal(result.nodes, 5)
  assert.deepEqual([...result.meshes[0].indices], [0, 1, 2])
  assert.throws(
    () => readUvmEffectMeshes(input, binary, entries, { maxBytes: 311, maxNodes: 5 }),
    /budget/,
  )
  assert.throws(
    () => readUvmEffectMeshes(input, binary, entries, { maxBytes: 312, maxNodes: 4 }),
    /budget/,
  )
  assert.throws(
    () =>
      readUvmEffectMeshes(input, binary, [...entries, ...entries], { maxBytes: 623, maxNodes: 10 }),
    /budget/,
  )
  assert.throws(
    () =>
      readUvmEffectMeshes(
        input,
        binary,
        entries,
        { maxBytes: 312, maxNodes: 5 },
        AbortSignal.abort(),
      ),
    { name: 'AbortError' },
  )
  input.extensions.UV_game_effects.particles.push({
    ...input.extensions.UV_game_effects.particles[0],
  })
  assert.throws(
    () => createUvmEffectFrame(input, options({ binary, maxBytes: 2 * 4096 + 623 })),
    /budget/,
  )
})

it('renders actual common particles through the UVM scene resolver with deterministic pixels and lifecycle colors', async () => {
  const input = document(),
    before = JSON.stringify(input)
  const bytes = writeUvmContainer({
    format: 'glb',
    document: input,
    binary: new Uint8Array(),
    extraChunks: [],
  })
  const requests = []
  let released = 0
  const contracts = {
    async resolve(request) {
      requests.push(request)
      return {
        value: { render: renderHeadless },
        release: async () => {
          released++
        },
      }
    },
  }
  const request = {
    schemaVersion: 1,
    time: 0.25,
    viewport: { width: 32, height: 32 },
    camera: { viewProjection: [...identity], viewMatrix: [...identity] },
  }
  const renderOptions = {
    contracts,
    budget: {
      maxInputBytes: 8_388_608n,
      maxScalarBytes: 8_388_608,
      maxNodes: 10000,
      maxDepth: 64,
      maxDiagnostics: 100,
    },
  }
  const first = await renderUvm(bytes, request, renderOptions)
  const second = await renderUvm(bytes, request, renderOptions)
  assert.deepEqual(first.rgba, second.rgba)
  assert.ok(first.statistics.fragments > 0)
  assert.ok(first.rgba.some((value, index) => index % 4 === 0 && value > 0))
  assert.ok(first.rgba.every((value, index) => index % 4 !== 1 || value === 0))
  assert.deepEqual(first.diagnostics, [])
  assert.equal(requests.length, 2)
  assert.equal(requests[0].contract, 'common.render/scene-3d')
  assert.equal(released, 2)
  assert.equal(JSON.stringify(input), before)
})

it('acquires and samples the texture selected by the particle emitter', async () => {
  const input = document({
    particles: [
      {
        ...emitter,
        texturePath: 'effect.dds',
        segmentColors: [
          [1, 1, 1],
          [1, 1, 1],
          [1, 1, 1],
        ],
      },
    ],
  })
  const bytes = writeUvmContainer({
    format: 'glb',
    document: input,
    binary: new Uint8Array(),
    extraChunks: [],
  })
  const resourceRequests = []
  let renderedRequest
  const frame = await renderUvm(
    bytes,
    {
      schemaVersion: 1,
      time: 0.25,
      viewport: { width: 32, height: 32 },
      camera: { viewProjection: [...identity], viewMatrix: [...identity] },
    },
    {
      contracts: {
        async resolve() {
          return {
            value: {
              render(request) {
                renderedRequest = request
                return renderHeadless(request)
              },
            },
            release: () => Promise.resolve(),
          }
        },
      },
      rasterResources: {
        async read(request) {
          resourceRequests.push(request)
          return {
            state: 'decoded',
            diagnostics: [],
            info: {
              width: 1,
              height: 1,
              faces: 1,
              orientation: 'top-left',
              alphaMode: 'straight',
            },
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
  assert.equal(resourceRequests.length, 1)
  assert.equal(resourceRequests[0].kind, 'logical')
  assert.equal(resourceRequests[0].requirement.logicalId, 'effect.dds')
  assert.deepEqual(
    renderedRequest.scene.materials.find(value => value.id.includes('effect-particle'))
      .textureBindings,
    [{ resourceId: 'effect.dds', textureId: 'uvm-material-resource-0' }],
  )
  assert.ok(frame.statistics.fragments > 0)
  assert.ok(
    frame.rgba.some(
      (green, index) =>
        index % 4 === 1 && green > frame.rgba[index - 1] * 2 && green > frame.rgba[index + 1] * 2,
    ),
  )
  assert.deepEqual(frame.diagnostics, [])
})

it('builds moving ribbon strips from historical emitter poses and uses the same headless renderer', async () => {
  const times = []
  const projected = createUvmEffectFrame(
    document({
      particles: [],
      ribbons: [
        {
          name: 'trail',
          node: 0,
          material: 0,
          ribbonType: 'billboard',
          emissionRate: 30,
          lifeSpan: 1,
          heightAbove: 0.1,
          heightBelow: 0.1,
        },
      ],
    }),
    options({
      nodeTransformsAt(time) {
        times.push(time)
        const matrix = identity.slice()
        matrix[12] = time
        // Avoid a collinear camera ray and ribbon tangent, which form an edge-on strip.
        matrix[14] = -0.5
        return new Map([['node-0', matrix]])
      },
    }),
  )
  assert.ok(times.some(time => time > 0 && time < 0.25))
  assert.ok(projected.primitives.length > 0)
  const rendered = await renderHeadless({
    outputKind: 'rgba8',
    viewport: { width: 64, height: 64 },
    camera: { viewProjection: identity },
    scene: projected,
  })
  assert.ok(rendered.statistics.fragments > 0)
  assert.deepEqual(projected.diagnostics, [])
})

it('simulates gravity in explicit spaceNode coordinates and rebases finished geometry exactly once', () => {
  assert.throws(() => validateUvmDocument(document({ spaceNode: 8 })), /spaceNode/)
  const effect = { ...emitter, gravity: 1 }
  const local = createUvmEffectFrame(document({ particles: [effect] }), options())
  const frame = Float32Array.of(2, 0, 0, 0, 0, 0, -2, 0, 0, 2, 0, 0, 0, 0, 0, 1)
  const input = document({ particles: [effect], spaceNode: 1 })
  input.nodes.push({ children: [0], matrix: [...frame] })
  input.scenes[0].nodes = [1]
  const projected = createUvmEffectFrame(
    input,
    options({
      activeNodes: new Set(['node-0', 'node-1']),
      nodeTransformsAt: () =>
        new Map([
          ['node-0', frame],
          ['node-1', frame],
        ]),
    }),
  )
  assert.equal(projected.primitives.length, local.primitives.length)
  for (let index = 0; index < local.primitives.length; index++) {
    const [x, y, z] = center(local.primitives[index]),
      raw = center(projected.primitives[index]),
      primitive = projected.primitives[index],
      actual = [0, 1, 2].map(
        row =>
          primitive.transform[row] * raw[0] +
          primitive.transform[row + 4] * raw[1] +
          primitive.transform[row + 8] * raw[2] +
          primitive.transform[row + 12],
      )
    assert.deepEqual(primitive.transform, frame)
    assert.deepEqual(local.primitives[index].transform, identity)
    raw.forEach((value, component) => assert.ok(Math.abs(value - [x, y, z][component]) < 1e-6))
    assert.ok(Math.abs(actual[0] - 2 * x) < 1e-6)
    assert.ok(Math.abs(actual[1] - 2 * z) < 1e-6)
    assert.ok(Math.abs(actual[2] + 2 * y) < 1e-6)
  }
})

it('respects selected nodes, diagnoses missing cameras and keeps unsupported emitters explicit', () => {
  assert.equal(
    createUvmEffectFrame(document(), options({ activeNodes: new Set() })).primitives.length,
    0,
  )
  const missing = createUvmEffectFrame(document(), options({ viewMatrix: undefined }))
  assert.equal(missing.primitives.length, 0)
  assert.equal(missing.diagnostics[0].code, 'common.uvm/effect-camera-required')
  const unsupported = createUvmEffectFrame(
    document({
      particles: [{ ...emitter, orientationMode: 'future-orientation' }],
      projectors: [{ name: 'decal' }],
    }),
    options(),
  )
  assert.equal(unsupported.primitives.length, 0)
  assert.ok(unsupported.diagnostics.some(item => item.message.includes('orientationMode')))
  assert.ok(unsupported.diagnostics.some(item => item.message.includes('projectors')))
  assert.ok(
    createUvmEffectFrame(
      document({ particles: [{ ...emitter, orientationMode: 'pinned' }] }),
      options(),
    ).primitives.length > 0,
  )
  assert.throws(
    () => createUvmEffectFrame(document({ projectors: [{ name: 'decal' }] }), options()),
    /projector node/,
  )
})

it('owns input state before callbacks and bounds simulator allocation and cancellation', () => {
  const input = document(),
    modified = structuredClone(input)
  const captured = createUvmEffectFrame(
    modified,
    options({
      nodeTransformsAt() {
        modified.extensions.UV_game_effects.particles[0].emissionRate = 0
        return new Map([['node-0', identity]])
      },
    }),
  )
  assert.deepEqual(captured.primitives, createUvmEffectFrame(input, options()).primitives)
  assert.throws(
    () => createUvmEffectFrame(document(), options({ maxBytes: 1 })),
    /budget|maximum|maxBytes/i,
  )
  assert.throws(
    () => createUvmEffectFrame(document(), options({ signal: AbortSignal.abort() })),
    /abort/i,
  )
  assert.throws(
    () =>
      createUvmEffectFrame(document({ particles: [{ ...emitter, speed: Infinity }] }), options()),
    /finite|JSON/i,
  )
})

it('selects sequence emission tracks, normalizes milliseconds and resets every independent frame', () => {
  const track = keys => ({ lineType: 0, globalSeqId: null, keys })
  const zero = track([{ frame: 0, vector: [0] }])
  const input = document({
    trackTimeUnit: 'milliseconds',
    particles: [
      {
        ...emitter,
        emissionRate: 0,
        sequenceAnimation: {
          emissionRate: [
            {
              sequenceIndex: 0,
              track: track([
                { frame: 0, vector: [0] },
                { frame: 100, vector: [30] },
              ]),
            },
            { sequenceIndex: 1, track: zero },
          ],
          ...Object.fromEntries(
            ['Start', 'Middle', 'End'].map(stage => [
              `segmentColor${stage}`,
              [{ sequenceIndex: 0, track: track([{ frame: 0, vector: [0, 1, 0] }]) }],
            ]),
          ),
        },
      },
    ],
  })
  const first = createUvmEffectFrame(input, options({ sequenceIndex: 0 }))
  assert.ok(first.primitives.length > 0)
  for (const primitive of first.primitives) {
    assert.deepEqual(
      primitive.colors,
      Float32Array.from(
        Array.from({ length: primitive.positions.length / 3 }, () => [0, 1, 0, 1]).flat(),
      ),
    )
  }
  for (const material of first.materials) assert.deepEqual(material.baseColor, [1, 1, 1, 1])
  assert.equal(createUvmEffectFrame(input, options({ sequenceIndex: 1 })).primitives.length, 0)
  assert.equal(createUvmEffectFrame(input, options()).primitives.length, 0)
  assert.deepEqual(
    createUvmEffectFrame(input, options({ sequenceIndex: 0 })).primitives,
    first.primitives,
  )
  const seconds = structuredClone(input)
  seconds.extensions.UV_game_effects.trackTimeUnit = 'seconds'
  seconds.extensions.UV_game_effects.particles[0].sequenceAnimation.emissionRate[0].track.keys[1].frame = 0.1
  assert.deepEqual(
    createUvmEffectFrame(seconds, options({ sequenceIndex: 0 })).primitives,
    first.primitives,
  )
  const duplicate = structuredClone(input)
  duplicate.extensions.UV_game_effects.particles[0].sequenceAnimation.emissionRate.push({
    sequenceIndex: 0,
    track: zero,
  })
  assert.throws(() => createUvmEffectFrame(duplicate, options()), /unique/)
  const malformed = structuredClone(input)
  malformed.extensions.UV_game_effects.particles[0].sequenceAnimation.emissionRate[0].track.keys[1].vector =
    [30, 40]
  assert.throws(() => createUvmEffectFrame(malformed, options()), /arity/)
})
