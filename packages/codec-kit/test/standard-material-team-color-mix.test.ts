import { expect, it } from 'vitest'
import {
  buildMaterialDefines,
  buildStandardFragmentSource,
  canonicalDefineKey,
  composeStandardPixelCpu,
  teamColorMaskMixCpu,
} from '../src/model-math/standard-material-glsl.js'

/**
 * Warcraft III Reforged HD paints the player's colour by the alpha of its ORM map, mixed into the
 * base colour before light (`teamColorMaskMix`), not StarCraft II's grain merge after light.
 */
const layer = (slot: string, texel: readonly number[], channels = 1) => ({
  slot,
  texturePath: `${slot}.png`,
  uvSource: 0,
  channels,
  op: slot === 'diffuse' ? 6 : 2,
  teamColorMode: 0,
  invert: false,
  clampResult: false,
  wrapX: true,
  wrapY: true,
  texel,
})
const material = (teamColorMaskMix: boolean) => ({
  // the ORM texel: occlusion, roughness, metallic, team mask in alpha (channels 2 selects alpha)
  layers: { diffuse: layer('diffuse', [0.8, 0.8, 0.8, 1]), teamColorMask: layer('teamColorMask', [1, 0.5, 0, 1], 2) },
  blendMode: 0,
  priority: 0,
  specularity: 0,
  specMult: 1,
  emisMult: 1,
  specMode: 0 as const,
  alphaTestThreshold: 0,
  twoSided: false,
  unshaded: true,
  doubleLambert: false,
  clampOutput: false,
  usesVertexColor: false,
  usesVertexAlpha: false,
  ...(teamColorMaskMix ? { teamColorMaskMix: true } : {}),
})
const pixel = (teamColorMaskMix: boolean) =>
  composeStandardPixelCpu({
    ...material(teamColorMaskMix),
    ambient: [0, 0, 0, 1],
    teamColor: [1, 0, 0],
    vertexNormal: [0, 0, 1],
    lightDir: [0, 0, 1],
  } as never).rgba

it('mixes hue by sqrt(mask) and brightness toward the team colour by 0.95·mask²', () => {
  expect(teamColorMaskMixCpu([0.8, 0.8, 0.8], [1, 0, 0], 0)).toEqual([0.8, 0.8, 0.8])
  // a full mask paints the player colour at the base's brightness
  const full = teamColorMaskMixCpu([0.8, 0.8, 0.8], [1, 0, 0], 1)
  expect(full[0]).toBeCloseTo(0.8, 6)
  expect(full[1]).toBeCloseTo(0, 6)
  const half = teamColorMaskMixCpu([0.8, 0.8, 0.8], [1, 0, 0], 0.25)
  // hue (0.9, 0.4, 0.4) by sqrt(0.25), scaled to the base's brightness 0.8
  expect(half[0]).toBeCloseTo(0.8, 6)
  expect(half[1]).toBeCloseTo((0.4 * 0.8) / 0.9, 6)
  // a dark team colour darkens the surface toward it
  expect(Math.max(...teamColorMaskMixCpu([0.8, 0.8, 0.8], [0.2, 0.2, 0.5], 1))).toBeCloseTo(0.8 + (0.5 - 0.8) * 0.95, 6)
})

it('replaces the grain merge in the CPU mirror and the shader, and keys the program', () => {
  expect(pixel(true).slice(0, 3).map(value => Number(value.toFixed(6)))).toEqual([0.8, 0, 0])
  expect(pixel(false).slice(0, 3).map(value => Number(value.toFixed(6)))).toEqual([1.3, 0.3, 0.3])
  const mixed = buildMaterialDefines(material(true) as never)
  const merged = buildMaterialDefines(material(false) as never)
  expect(buildStandardFragmentSource(mixed)).toMatch(/color = teamColorMaskMix\(color, u_teamColor, computeLayer_teamColorMask\(\)\.r\);/u)
  expect(buildStandardFragmentSource(mixed)).not.toMatch(/\(u_teamColor - vec3\(0\.5\)\)/u)
  expect(buildStandardFragmentSource(merged)).toMatch(/\(u_teamColor - vec3\(0\.5\)\) \* teamColorMask/u)
  expect(canonicalDefineKey(mixed)).not.toBe(canonicalDefineKey(merged))
})
