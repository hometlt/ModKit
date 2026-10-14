import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  blendSimpleEffectPixel,
  applySimpleEffectState,
  readSimpleEffect,
} from '../src/render/simple-effect.js'
import { projectorMaterial } from '../src/uvm/projector-material.js'
import { renderHeadless } from '../src/render/headless.js'
import { uvmMaterialResources } from '../src/uvm/materials.js'
const state = {
  blend: 'blend',
  depthTest: true,
  depthWrite: false,
  doubleSided: true,
  alphaCutoff: 0,
  wrapU: 'clamp',
  wrapV: 'clamp',
}
test('all simple-effect blend equations preserve their distinct source factors', () => {
  const expected = {
    opaque: [64, 32, 96, 128],
    'alpha-test': [64, 32, 96, 128],
    blend: [128, 96, 160, 255],
    premultiplied: [192, 128, 255, 255],
    additive: [192, 144, 255, 255],
    'additive-one-one': [255, 192, 255, 255],
    'add-alpha': [192, 160, 224, 255],
    modulate: [64, 32, 96, 255],
    modulate2x: [128, 64, 192, 255],
  }
  for (const [blend, rgba] of Object.entries(expected)) {
    const output = Uint8Array.of(128, 128, 128, 255)
    blendSimpleEffectPixel(output, 0, [0.5, 0.25, 0.75, 0.5], { ...state, blend })
    assert.deepEqual([...output], rgba, blend)
  }
})
test('simple effect WebGL distinguishes legacy SRC_COLOR and ONE additive with independent depth flags', () => {
  const calls = [],
    gl = {
      DEPTH_TEST: 1,
      CULL_FACE: 2,
      BLEND: 3,
      FUNC_ADD: 4,
      SRC_COLOR: 5,
      ONE: 6,
      ZERO: 7,
      enable: v => calls.push(['enable', v]),
      disable: v => calls.push(['disable', v]),
      depthMask: v => calls.push(['depth', v]),
      blendEquation: v => calls.push(['equation', v]),
      blendFuncSeparate: (...v) => calls.push(['blend', ...v]),
    }
  for (const [blend, sourceFactor] of [
    ['additive', gl.SRC_COLOR],
    ['additive-one-one', gl.ONE],
  ]) {
    calls.length = 0
    applySimpleEffectState(gl, { ...state, blend, depthTest: false, depthWrite: true })
    assert.deepEqual(calls, [
      ['disable', 1],
      ['depth', true],
      ['disable', 2],
      ['equation', 4],
      ['enable', 3],
      ['blend', sourceFactor, gl.ONE, gl.ZERO, gl.ONE],
    ])
  }
})

test('normative additive adds RGB once while legacy additive and destination alpha remain unchanged', () => {
  for (const [blend, red] of [
    ['additive', 104],
    ['additive-one-one', 168],
  ]) {
    const effect = readSimpleEffect({ ...state, blend })
    const frame = Uint8Array.of(40, 50, 60, 91)
    blendSimpleEffectPixel(frame, 0, [0.5, 0, 0, 0.25], effect)
    assert.deepEqual([...frame], [red, 50, 60, 91])
  }
})
test('ordinary projectors select the pinned preview texture and preserve the authored shader', () => {
  const standard = {
    layers: {},
    blendMode: 2,
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
    id: 'source',
    baseColor: [0.2, 0.3, 0.4, 0.2],
    shader: {
      id: 'modkit.render-material.v1',
      parameters: {
        renderModel: {
          version: 1,
          standard,
          layers: [
            { label: 'normal', path: 'normal.dds' },
            { label: 'diffuse', path: 'splat.dds', metadata: { wrapS: 'repeat', wrapT: 'clamp' } },
            { label: 'diffuse', path: 'second.dds' },
          ],
        },
      },
    },
  }
  const before = structuredClone(base),
    material = projectorMaterial(base, 'projector', 0.5, 10000, 1048576)
  assert.equal(material.simpleEffect.textureResource, 'splat.dds')
  assert.equal(material.shader.id, 'modkit.render-material.v1')
  assert.deepEqual([...uvmMaterialResources([material], 1048576)], [['projector', ['splat.dds']]])
  assert.deepEqual(base, before)
})
test('headless simple effect samples the bound texture and applies alpha once even with an authored shader', async () => {
  const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const frame = await renderHeadless({
    outputKind: 'rgba8',
    viewport: { width: 16, height: 16 },
    camera: { viewProjection: identity },
    clearColor: [0, 0, 0, 1],
    scene: {
      materials: [
        {
          id: 'splat',
          baseColor: [1, 1, 1, 0.5],
          simpleEffect: { ...state, textureResource: 'splat.dds' },
          shader: { id: 'preserved.vocabulary', parameters: {} },
          textureBindings: [{ resourceId: 'splat.dds', textureId: 'texel' }],
        },
      ],
      textures: [{ id: 'texel', width: 1, height: 1, rgba: Uint8Array.of(0, 255, 0, 128) }],
      primitives: [
        {
          id: 'triangle',
          materialId: 'splat',
          topology: 'triangles',
          positions: Float32Array.from([-0.75, -0.75, 0.5, 0, 0.75, 0.5, 0.75, -0.75, 0.5]),
          textureCoordinates: Float32Array.from([0, 0, 0.5, 1, 1, 0]),
        },
      ],
    },
  })
  assert.deepEqual([...frame.rgba.slice((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4)], [0, 64, 0, 255])
  assert(!frame.diagnostics.some(item => item.code.includes('shader-unsupported')))
})
test('an emitter over a material with no program of its own draws through the simple pass', async () => {
  const { effectSurfaceMaterial } = await import('../src/uvm/projector-material.js')
  // The renderer's own layer list — what a UVM material without UV_game_material becomes — used to
  // throw and take the whole frame with it.
  const listed = {
    id: 'material-0',
    baseColor: [1, 1, 1, 1],
    alphaMode: 'blend',
    shading: 'unlit',
    shader: {
      id: 'modkit.material-layers.v1',
      parameters: { renderModel: { layers: [{ label: 'diffuse', path: 'Textures\Dust.blp' }] } },
    },
  }
  const sprite = effectSurfaceMaterial(listed, 'sprite', 10000, 1048576)
  assert.equal(sprite.shader, undefined)
  assert.equal(sprite.simpleEffect.blend, 'blend')
  assert.equal(sprite.simpleEffect.doubleSided, true)
  assert.equal(sprite.simpleEffect.textureResource, 'Textures\Dust.blp')
  // The emitter's own texture still wins over the material's.
  assert.equal(
    effectSurfaceMaterial(listed, 'sprite-2', 10000, 1048576, 'Textures\Star.blp').simpleEffect
      .textureResource,
    'Textures\Star.blp',
  )
  // A vocabulary no renderer executes falls back the same way.
  const foreign = effectSurfaceMaterial(
    { ...listed, shader: { id: 'mdx.layer', parameters: {} } },
    'sprite-3',
    10000,
    1048576,
  )
  assert.equal(foreign.simpleEffect.blend, 'blend')
  assert.equal(foreign.simpleEffect.textureResource, undefined)
})
test('an emitter over a plain additive material keeps its blend pass', async () => {
  const { effectSurfaceMaterial } = await import('../src/uvm/projector-material.js')
  // a material whose UV_game_material.blendMode is additive: render.ts gives it its simple pass
  const glow = {
    id: 'material-1',
    baseColor: [1, 1, 1, 1],
    alphaMode: 'blend',
    shading: 'unlit',
    shader: { id: 'sage/particle-system', parameters: {} },
    simpleEffect: {
      blend: 'additive',
      depthTest: true,
      depthWrite: false,
      doubleSided: true,
      alphaCutoff: 0,
      wrapU: 'repeat',
      wrapV: 'repeat',
    },
  }
  const sprite = effectSurfaceMaterial(glow, 'sprite', 10000, 1048576, 'Texture/FXCloud.dds')
  assert.equal(sprite.simpleEffect.blend, 'additive')
  assert.equal(sprite.simpleEffect.depthWrite, false)
  assert.equal(sprite.simpleEffect.textureResource, 'Texture/FXCloud.dds')
})
