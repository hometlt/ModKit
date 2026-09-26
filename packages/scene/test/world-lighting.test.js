import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createWorldWebGlPlan,
  worldMaterialLight,
  worldModelAnimation,
} from '../src/world/webgl.ts'
import { toneMapWorldColor } from '../src/world/tone-mapping.ts'
import { colorizeWorldColor, createWorldColorLut } from '../src/world/colorization.ts'

const terrain = Array.from({ length: 4 }, (_, index) => ({
  facet: 'terrain',
  id: `t:${index}`,
  layerId: 'terrain',
  coordinateSpaceId: 'height-grid',
  lod: 'exact',
  x: index % 2,
  y: Math.floor(index / 2),
  heightBase: 0,
  heightAdjustment: 0,
  mask: 0,
  uvwPosition: { x: index % 2, y: 0, z: -Math.floor(index / 2) },
}))

const lighting = directional => ({
  facet: 'lighting',
  id: 'lighting',
  layerId: 'lighting',
  coordinateSpaceId: 'uvw-canonical',
  ambientColor: [0.6, 0.5, 0.35],
  ambientIntensity: 1,
  directional,
})

describe('world lighting rig', () => {
  it('bakes a neutral 3D LUT with RGB axes and validates all native tone-map operators', () => {
    const neutral = { inputLow: 0, inputHigh: 1, inputGamma: 1, outputLow: 0, outputHigh: 1, brightness: 1, contrast: 1, hue: 0, saturation: 0, lightness: 0, blend: 0 }
    // Levels act on HSL lightness: a neutral grade returns the colour (to float rounding).
    colorizeWorldColor([0.2, 0.4, 0.8], neutral).forEach((value, channel) =>
      assert.ok(Math.abs(value - [0.2, 0.4, 0.8][channel]) < 1e-12),
    )
    const lut = createWorldColorLut(neutral)
    assert.equal(lut.byteLength, 16384)
    // Texel k holds the colour k/16: SC2 samples at saturate(C + 0.5/16), so 15/16 is the last texel.
    assert.deepEqual([...lut.slice(15 * 4, 15 * 4 + 4)], [239, 0, 0, 255])
    assert.deepEqual([...lut.slice(15 * 16 * 4, 15 * 16 * 4 + 4)], [0, 239, 0, 255])
    assert.deepEqual([...lut.slice(8 * 4, 8 * 4 + 4)], [128, 0, 0, 255])
    assert.deepEqual([...lut.slice(-4)], [239, 239, 239, 255])
    for (const operator of ['reinhard', 'exponential', 'logarithmic', 'linear', 'filmic']) {
      const settings = { operator, exposure: 1.55, contrast: 1, whitePoint: 1.85 }
      assert.deepEqual(toneMapWorldColor([0, 0, 0], settings), [0, 0, 0])
      assert.ok(toneMapWorldColor([2, 1, 0.5], settings).every(Number.isFinite))
    }
    assert.equal(toneMapWorldColor([0.4, 0.8, 0.2], { operator: 'linear', exposure: 1, contrast: 1, whitePoint: 1 })[1], 0.8)
  })
  it('grades lightness like the SC2 editor colour map and blends the colorize tint', () => {
    // Amphion's SnowRefinery grade.
    const amphion = { inputLow: 0, inputHigh: 1, inputGamma: 1, outputLow: 0, outputHigh: 1, brightness: 1, contrast: 1.17, hue: 0.132, saturation: 0.1, lightness: 0.16, blend: 0.2 }
    // Contrast is a power on lightness; hue and saturation of the colour survive it.
    const graded = colorizeWorldColor([0.5, 0.5, 0.5], { ...amphion, blend: 0 })
    for (const value of graded) assert.ok(Math.abs(value - Math.pow(0.5, 1.17)) < 1e-12)
    // The tint is the authored hue and saturation at the graded lightness plus the offset.
    const lightness = Math.pow(0.5, 1.17) + 0.16
    const q = lightness + 0.1 - lightness * 0.1, p = 2 * lightness - q
    const channel = t => { const h = t - Math.floor(t); return h < 1 / 6 ? p + (q - p) * 6 * h : h < 0.5 ? q : h < 2 / 3 ? p + (q - p) * (2 / 3 - h) * 6 : p }
    const tint = [channel(0.132 + 1 / 3), channel(0.132), channel(0.132 - 1 / 3)]
    colorizeWorldColor([0.5, 0.5, 0.5], amphion).forEach((value, index) =>
      assert.ok(Math.abs(value - (0.8 * graded[index] + 0.2 * tint[index])) < 1e-12),
    )
    // Input gamma is the editor's slider: 0.5 lifts to the power 5.5, 2 to 8/9.
    const gammaOf = inputGamma => colorizeWorldColor([0.5, 0.5, 0.5], { ...amphion, contrast: 1, blend: 0, inputGamma })[0]
    assert.ok(Math.abs(gammaOf(0.5) - Math.pow(0.5, 5.5)) < 1e-12)
    assert.ok(Math.abs(gammaOf(2) - Math.pow(0.5, 8 / 9)) < 1e-12)
  })
  it('tone maps HDR luminance once without changing RGB ratios or making black NaN', () => {
    const settings = { operator: 'reinhard', exposure: 1.55, contrast: 1, whitePoint: 1.85 }
    assert.deepEqual(toneMapWorldColor([0, 0, 0], settings), [0, 0, 0])
    const mapped = toneMapWorldColor([2, 1, 0.5], settings)
    assert.ok(mapped.every(Number.isFinite))
    assert.equal(mapped[0] / mapped[1], 2)
    assert.equal(mapped[1] / mapped[2], 2)
    assert.ok(mapped[0] < 2)
    const plan = createWorldWebGlPlan({
      items: [...terrain, { ...lighting([]), toneMapping: settings }],
    })
    assert.deepEqual(plan.light.toneMapping, settings)
  })
  it('selects actor animation properties even when Stand has no keyed channels', () => {
    const result = {
      state: 'converted',
      animations: [
        { id: 'large', kind: 'sequence', name: 'Stand', channels: [] },
        { id: 'small', kind: 'animation', name: 'Stand A', channels: [{}] },
      ],
    }
    assert.equal(worldModelAnimation(result, {}).id, 'large')
    assert.equal(
      worldModelAnimation(result, { presentationAnimation: { name: 'Stand', groups: ['A'] } }).id,
      'small',
    )
  })
  it('keeps every directional past the key light as a fill', () => {
    // SC2 rigs ship Key, Fill and Back; only the key light owns the shadow map.
    const plan = createWorldWebGlPlan({
      items: [
        ...terrain,
        lighting([
          { id: 'Key', direction: [0.37, -0.72, 0.59], color: [1, 1, 1], intensity: 1 },
          { id: 'Fill', direction: [-0.7, -0.19, 0.69], color: [0.8, 0.68, 0.55], intensity: 1 },
          {
            id: 'Back',
            direction: [-0.18, -0.71, -0.68],
            color: [0.34, 0.44, 0.61],
            intensity: 0.4,
            useAmbientOcclusion: false,
          },
        ]),
      ],
    })

    assert.deepEqual(plan.light.direction, [0.37, -0.72, 0.59])
    assert.deepEqual(worldMaterialLight(plan).direction, [-0.37, 0.72, -0.59])
    assert.equal(plan.light.fills.length, 2)
    assert.deepEqual(plan.light.fills[0].color, [0.8, 0.68, 0.55])
    assert.equal(plan.light.fills[1].intensity, 0.4)
    assert.equal(plan.light.fills[0].useAmbientOcclusion, true)
    assert.equal(plan.light.fills[1].useAmbientOcclusion, false)
    assert.deepEqual(worldMaterialLight(plan).fills[0], {
      direction: [0.7, 0.19, -0.69],
      color: [0.8, 0.68, 0.55],
    })
  })

  it('winds terrain so its face normal points up in scene space', () => {
    // A world payload mirrors the map's Y into -Z. With the map-order winding the face normal came
    // out pointing down, N·L was zero for every light, and terrain rendered ambient-only.
    const quad = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].map(([x, y], index) => ({
      facet: 'terrain',
      id: `lit-terrain:${index}`,
      layerId: 'terrain',
      coordinateSpaceId: 'height-grid',
      lod: 'exact',
      x,
      y,
      heightBase: 0,
      heightAdjustment: 0,
      mask: 0,
      uvwPosition: { x, y: 0, z: -y },
    }))
    const plan = createWorldWebGlPlan({ items: quad })

    assert.equal(plan.stats.terrainTriangles, 2)
    for (let vertex = 0; vertex < plan.opaqueTriangles.normals.length; vertex += 3)
      assert.ok(
        plan.opaqueTriangles.normals[vertex + 1] > 0.99,
        `terrain normal ${String(vertex / 3)} points up`,
      )
  })

  it('has no fills for a single-light rig', () => {
    const plan = createWorldWebGlPlan({
      items: [
        ...terrain,
        lighting([{ id: 'Key', direction: [0, -1, 0], color: [1, 1, 1], intensity: 1 }]),
      ],
    })

    assert.equal(plan.light.fills.length, 0)
  })
})
