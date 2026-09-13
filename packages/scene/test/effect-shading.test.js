import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderHeadless } from '../src/render/headless.js'
import { readSimpleEffectColors } from '../src/render/effect-colors.js'
import { createUvmEffectFrame } from '../src/uvm/effects.js'
import { projectorMaterial } from '../src/uvm/projector-material.js'
const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const state = {
  blend: 'blend',
  depthTest: true,
  depthWrite: false,
  doubleSided: true,
  alphaCutoff: 0,
  wrapU: 'clamp',
  wrapV: 'clamp',
  textureResource: 'effect.dds',
}
const quad = {
  id: 'quad',
  materialId: 'effect',
  topology: 'triangles',
  positions: Float32Array.from([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
  indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
  textureCoordinates: Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1),
  colors: Float32Array.from(Array.from({ length: 4 }, () => [0.5, 1, 0.25, 0.5]).flat()),
}
const material = {
  id: 'effect',
  baseColor: [1, 1, 1, 1],
  simpleEffect: state,
  shader: { id: 'preserved.shader', parameters: {} },
  textureBindings: [{ resourceId: 'effect.dds', textureId: 'texel' }],
}
const request = {
  outputKind: 'rgba8',
  viewport: { width: 4, height: 4 },
  camera: { viewProjection: identity },
  clearColor: [0, 0, 0, 1],
  scene: {
    materials: [material],
    textures: [
      {
        id: 'texel',
        width: 1,
        height: 1,
        rgba: Uint8Array.of(128, 64, 255, 128),
      },
    ],
    primitives: [quad],
  },
}

test('pinned live shader texel times vertex RGBA reaches every pixel without alpha squared', async () => {
  // Oracle shader: color=(texture2D(...) or vec4(1))*v_color; SRC_ALPHA blending.
  const frame = await renderHeadless(request)
  assert.deepEqual(
    frame.rgba,
    Uint8Array.from(Array.from({ length: 16 }, () => [16, 16, 16, 255]).flat()),
  )
  assert(!frame.diagnostics.some(item => item.code.includes('shader-unsupported')))
})

test('alpha-test uses texture times vertex alpha before cutoff and preserves depth mode', async () => {
  const frame = await renderHeadless({
    ...request,
    scene: {
      ...request.scene,
      materials: [
        {
          ...material,
          simpleEffect: {
            ...state,
            blend: 'alpha-test',
            depthWrite: true,
            alphaCutoff: 0.3,
          },
        },
      ],
    },
  })
  assert.deepEqual(
    frame.rgba,
    Uint8Array.from(Array.from({ length: 16 }, () => [0, 0, 0, 255]).flat()),
  )
})

test('varying effect vertex RGBA is perspective-correct, not flat color or screen-linear interpolation', async () => {
  const projection = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1])
  const frame = await renderHeadless({
    ...request,
    camera: { viewProjection: projection },
    scene: {
      materials: [
        {
          ...material,
          simpleEffect: {
            ...state,
            blend: 'opaque',
            depthWrite: true,
            textureResource: undefined,
          },
          textureBindings: [],
        },
      ],
      primitives: [
        {
          id: 'triangle',
          materialId: 'effect',
          topology: 'triangles',
          positions: Float32Array.from([-2, -2, 1, 1, -1, 0, -1, 1, 0]),
          colors: Float32Array.from([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1]),
        },
      ],
    },
  })
  assert.deepEqual([...frame.rgba.slice((2 * 4 + 1) * 4, (2 * 4 + 1) * 4 + 4)], [36, 109, 109, 255])
  assert.deepEqual([...frame.rgba.slice(3 * 4 * 4, 3 * 4 * 4 + 4)], [153, 51, 51, 255])
})

test('missing vertex RGBA preserves projector white and malformed buffers refuse before use', async () => {
  const { colors, ...without } = quad
  const frame = await renderHeadless({
    ...request,
    scene: { ...request.scene, primitives: [without] },
  })
  assert.deepEqual(
    frame.rgba,
    Uint8Array.from(Array.from({ length: 16 }, () => [64, 32, 128, 255]).flat()),
  )
  assert.equal(readSimpleEffectColors(quad), colors)
  assert.throws(
    () => readSimpleEffectColors({ ...quad, colors: Float32Array.of(1, 1, 1, 1) }),
    /RGBA/,
  )
  const invalid = colors.slice()
  invalid[0] = NaN
  assert.throws(() => readSimpleEffectColors({ ...quad, colors: invalid }), /RGBA/)
})

test('particles and ribbons select common simple-effect state independently of native shader vertex flags', () => {
  const standard = {
    layers: {},
    blendMode: 1,
    priority: 0,
    specularity: 0,
    specMult: 1,
    emisMult: 1,
    specMode: 0,
    alphaTestThreshold: 0,
    twoSided: true,
    unshaded: false,
    doubleLambert: false,
    clampOutput: false,
    usesVertexColor: false,
    usesVertexAlpha: false,
  }
  const base = {
    id: 'material-0',
    baseColor: [0.2, 0.3, 0.4, 0.2],
    shader: {
      id: 'modkit.render-material.v1',
      parameters: { renderModel: { version: 1, standard, layers: [] } },
    },
  }
  const emitter = {
    node: 0,
    material: 0,
    emissionRate: 10,
    lifeSpan: 3,
    speed: 1,
    alpha: 1,
    segmentColors: [
      [0.5, 0.25, 1],
      [0.5, 0.25, 1],
      [0.5, 0.25, 1],
    ],
    segmentAlphas: [0.5, 0.5, 0.5],
  }
  const document = {
    asset: { version: '2.0' },
    nodes: [{}],
    materials: [{}],
    extensions: {
      UV_game_effects: {
        particles: [
          {
            ...emitter,
            texturePath: 'particle.dds',
            orientationMode: 'billboard',
            emitShape: 'point',
            maxParticles: 16,
          },
        ],
        ribbons: [
          {
            ...emitter,
            texturePath: 'ribbon.dds',
            ribbonType: 'planar',
            heightAbove: 0.2,
            heightBelow: 0.2,
          },
        ],
        projectors: [],
        trackTimeUnit: 'seconds',
      },
    },
  }
  const frame = createUvmEffectFrame(document, {
    time: 0.5,
    viewMatrix: identity,
    materials: [base],
    activeNodes: new Set(['node-0']),
    nodeTransformsAt: () => new Map([['node-0', identity]]),
    maxBytes: 8 * 1024 * 1024,
    maxNodes: 10000,
  })
  // Authored 10 Hz for half a second yields five particles and five ribbon rings.
  const emitted = Math.floor(emitter.emissionRate * 0.5)
  assert.equal(emitted, 5)
  assert.equal(
    frame.primitives.filter(primitive => primitive.id.includes('particle')).length,
    emitted,
  )
  assert.equal(frame.primitives.filter(primitive => primitive.id.includes('ribbon')).length, 1)
  for (const primitive of frame.primitives) {
    const vertices = primitive.id.includes('ribbon') ? emitted * 2 : 4
    assert.equal(primitive.positions.length, vertices * 3)
    assert.equal(primitive.indices.length, primitive.id.includes('ribbon') ? (emitted - 1) * 6 : 6)
    const selected = frame.materials.find(value => value.id === primitive.materialId)
    assert.deepEqual(selected.baseColor, [1, 1, 1, 1])
    assert.equal(selected.simpleEffect.blend, 'blend')
    assert.equal(
      selected.simpleEffect.textureResource,
      primitive.id.includes('ribbon') ? 'ribbon.dds' : 'particle.dds',
    )
    assert.equal(selected.shader, base.shader)
    assert.deepEqual(
      primitive.colors,
      Float32Array.from(Array.from({ length: vertices }, () => [0.5, 0.25, 1, 0.5]).flat()),
    )
  }
  assert.deepEqual(
    projectorMaterial(base, 'unchanged-projector', 0.5, 10000, 1048576).baseColor,
    [1, 1, 1, 0.5],
  )
})
