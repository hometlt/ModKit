import { describe, expect, it } from 'vitest'
import type { StandardMaterialModel } from '../src/legacy/models/material.js'
import {
  angleLookupUvCpu,
  buildMaterialDefines,
  buildStandardFragmentSource,
  canonicalDefineKey,
  composeStandardPixelCpu,
} from '../src/model-math/standard-material-glsl.js'

const material = (angleLookup?: object): StandardMaterialModel =>
  ({
    layers: {
      diffuse: {
        slot: 'diffuse',
        texturePath: 'albedo',
        uvSource: 0,
        channels: 1,
        op: 2,
        teamColorMode: 0,
        invert: false,
        clampResult: false,
        wrapX: true,
        wrapY: true,
      },
      specular: {
        slot: 'specular',
        texturePath: 'table',
        uvSource: 1,
        channels: 1,
        op: 2,
        teamColorMode: 0,
        invert: false,
        clampResult: false,
        wrapX: false,
        wrapY: false,
        ...(angleLookup === undefined ? {} : { angleLookup }),
      },
    },
    blendMode: 0,
    priority: 0,
    specularity: 10,
    specMult: 1,
    emisMult: 1,
    specMode: 0,
    alphaTestThreshold: 0,
    twoSided: false,
    unshaded: false,
    doubleLambert: false,
    clampOutput: false,
    usesVertexColor: false,
    usesVertexAlpha: false,
  }) as StandardMaterialModel

describe('a layer read at angle coordinates', () => {
  it('ramps by how edge-on the surface is, to its exponent', () => {
    const edge = { u: 'edge', v: 'row', exponent: 0.6, row: 0.25 } as const
    expect(angleLookupUvCpu(edge, [0, 0, 1], [0, 0, 1])).toEqual([0, 0.25])
    expect(angleLookupUvCpu(edge, [0, 0, 1], [1, 0, 0])[0]).toBeCloseTo(1, 12)
    const half = angleLookupUvCpu(edge, [0, 0, 1], [Math.sqrt(0.75), 0, 0.5])[0]
    expect(half).toBeCloseTo(0.5 ** 0.6, 12)
  })

  it('reads a lighting table by R·V and N·L', () => {
    const table = { u: 'reflection', v: 'light' } as const
    // the eye on the mirrored light: R·V = 1; the light at 45°: N·L = cos 45°
    const light = [Math.SQRT1_2, 0, Math.SQRT1_2] as const
    const [u, v] = angleLookupUvCpu(table, light, [-Math.SQRT1_2, 0, Math.SQRT1_2])
    expect(u).toBeCloseTo(1, 12)
    expect(v).toBeCloseTo(Math.SQRT1_2, 12)
    // the eye on the light's side: the reflection points away, R·V clamps at 0
    expect(angleLookupUvCpu(table, light, light)[0]).toBeCloseTo(0, 12)
  })

  it('takes its coordinates in the shader from the tangent-space light and view', () => {
    const table = buildMaterialDefines(material({ u: 'reflection', v: 'light' }))
    const source = buildStandardFragmentSource(table)
    expect(source).toContain('reflect(-normalize(v_lightDir), vec3(0.0, 0.0, 1.0))')
    expect(source).toContain('clamp(normalize(v_lightDir).z, 0.0, 1.0)')
    // the specular layer no longer reads UV set 1
    expect(table.uvSetCount).toBe(1)
    const plain = buildMaterialDefines(material())
    expect(plain.uvSetCount).toBe(2)
    expect(canonicalDefineKey(table)).not.toBe(canonicalDefineKey(plain))
  })
})

describe("the fade at grazing angles (Kane's Wrath EdgeFadeOut)", () => {
  // smoothstep(0, 0.5, |N·V|): |N·V| = 0.25 is half way, so the fade is 0.5
  const shade = (z: number, modAlpha: boolean) =>
    composeStandardPixelCpu({
      layers: {},
      ambient: [0.5, 0.5, 0.5, 0],
      viewDir: [Math.sqrt(1 - z * z), 0, z],
      edgeFadeOut: 0.5,
      ...(modAlpha ? { modAlpha: true } : {}),
      specularity: 0,
      specMult: 0,
      emisMult: 0,
      specMode: 0,
      unshaded: true,
      doubleLambert: false,
      clampOutput: false,
      alphaTestThreshold: 0,
    }).rgba

  it("fades a material's alpha, an additive material's colour", () => {
    expect(shade(1, false)[3]).toBeCloseTo(1, 12)
    expect(shade(0.25, false)[3]).toBeCloseTo(0.5, 12)
    expect(shade(0.25, false)[0]).toBeCloseTo(0.5, 12)
    const additive = shade(0.25, true)
    expect(additive[0]).toBeCloseTo(0.25, 12)
    expect(additive[3]).toBeCloseTo(1, 12)
  })

  it('fades in the shader by the same step', () => {
    const faded = buildMaterialDefines({ ...material(), edgeFadeOut: 0.5 })
    const source = buildStandardFragmentSource(faded)
    expect(source).toContain('smoothstep(0.0, 0.5, abs(normalize(v_viewDir).z))')
    expect(source).toContain('final.a *= edgeFade;')
    const additive = buildMaterialDefines({ ...material(), edgeFadeOut: 0.5, blendMode: 2 })
    expect(buildStandardFragmentSource(additive)).toContain('fade *= edgeFade;')
    expect(canonicalDefineKey(faded)).not.toBe(canonicalDefineKey(buildMaterialDefines(material())))
  })
})
