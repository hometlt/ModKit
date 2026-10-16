import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createWorldWebGlPlan } from '../src/world/webgl.js'
import { linearToSrgb } from '@modkit/codec-kit/raster'

const ramp = (length, color) => Array.from({ length }, () => [...color])
const red = [0.18, 0.01, 0.02], blue = [0.02, 0.04, 0.4]
const unit = (id, player) => ({
  facet: 'objects', id: `unit:${id}`, layerId: 'objects', coordinateSpaceId: 'uvw',
  kind: 'unit', objectId: id, player, resourceId: 'unit',
  position: { x: id, y: 0, z: 0 }, uvwPosition: { x: id, y: 0, z: 0 },
})
const model = (length, fallback = false) => ({
  state: 'converted', sourceKey: `ramp:${length}:${fallback}`, complete: true, diagnostics: [],
  meshes: [], nodes: [],
  primitives: [{ id: 'triangle', topology: 'triangles', materialId: 'body',
    positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 0, -1),
    normals: Float32Array.of(0, 1, 0, 0, 1, 0, 0, 1, 0),
    textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1), indices: Uint32Array.of(0, 1, 2) }],
  materials: [{ id: 'body', ...(fallback ? { unlit: true } : {}), layers: [
    { slot: 'diffuse', resourceId: 'base' },
    { slot: 'teamColor', resourceId: 'index', blend: 'replace',
      teamColor: { maskSource: 'paletteRange', range: [1, length], ramp: ramp(length, [0, 1, 0]) } },
  ] }],
  textures: [
    { id: 'base', width: 1, height: 1, rgba: Uint8Array.of(255, 255, 255, 255) },
    { id: 'index', width: 1, height: 1, rgba: Uint8Array.of(1, 0, 0, 255) },
  ],
})
const passes = plan => plan.modelMaterialScenes.flatMap(scene =>
  [...scene.programs.values()].flatMap(programs => programs.passes))
const encoded = color => color.map(linearToSrgb)
const close = (actual, expected) => {
  assert.equal(actual.length, expected.length)
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-6,
    `channel ${index}: ${value} != ${expected[index]}`))
}

for (const length of [8, 16]) {
  it(`samples ${length}-shade player ramps separately for two objects sharing one material program`, () => {
    const input = { items: [unit(1, 1), unit(2, 2)], models: new Map([['unit', model(length)]]),
      teamColors: new Map([[1, [1, 1, 1]], [2, [1, 1, 1]]]),
      teamRamps: new Map([[1, ramp(length, red)], [2, ramp(length, blue)]]) }
    const drawn = passes(createWorldWebGlPlan(input))
    assert.equal(drawn.length, 2)
    close(drawn[0].uniforms.u_teamRamp.slice(0, 3), encoded(red))
    close(drawn[1].uniforms.u_teamRamp.slice(0, 3), encoded(blue))
    assert.notEqual(drawn[0], drawn[1])
  })

  for (const fallback of [false, true]) {
    it(`updates a retained ${fallback ? 'fallback' : 'program'} object when only its ${length}-shade ramp changes`, () => {
      const firstRamp = ramp(length, red), nextRamp = ramp(length, blue)
      const input = { items: [unit(3, 1)], models: new Map([['unit', model(length, fallback)]]),
        teamRamps: new Map([[1, firstRamp]]) }
      const first = createWorldWebGlPlan(input)
      const next = createWorldWebGlPlan({ ...input, teamRamps: new Map([[1, nextRamp]]), timeSeconds: 1 }, first)
      if (fallback) {
        assert.deepEqual(first.texturedTriangles[0].team.rule.shades, firstRamp)
        assert.deepEqual(next.texturedTriangles[0].team.rule.shades, nextRamp)
      } else {
        close(passes(first)[0].uniforms.u_teamRamp.slice(0, 3), encoded(red))
        close(passes(next)[0].uniforms.u_teamRamp.slice(0, 3), encoded(blue))
      }
      assert.deepEqual(firstRamp, ramp(length, red))
      assert.deepEqual(nextRamp, ramp(length, blue))
    })
  }
}

it('keeps the authored ramp when the player override length differs, on both world draw routes', () => {
  for (const fallback of [false, true]) {
    const input = { items: [unit(4, 1)], models: new Map([['unit', model(8, fallback)]]),
      teamRamps: new Map([[1, ramp(16, red)]]) }
    const plan = createWorldWebGlPlan(input)
    if (fallback) assert.deepEqual(plan.texturedTriangles[0].team.rule.shades, ramp(8, [0, 1, 0]))
    else close(passes(plan)[0].uniforms.u_teamRamp.slice(0, 3), [0, 1, 0])
  }
})
