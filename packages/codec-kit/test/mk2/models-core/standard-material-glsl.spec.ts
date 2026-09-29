import { describe, expect, it } from 'vitest'
import {
  buildMaterialDefines,
  buildStandardFragmentSource,
  buildStandardVertexSource,
  calculateLayerFresnelCpu,
  canonicalDefineKey,
  chooseChannelCpu,
  combineLayerColorCpu,
  composeStandardPixelCpu,
  computeLayerColorCpu,
  computeTriPlanarWeightsCpu,
  decodeNormalCpu,
  planarLocalUvCpu,
  sphericalEnvironmentUvCpu,
  standardBlendModeName,
  type CpuLayerSample,
  type StandardMaterialLayer,
  type StandardMaterialModel,
  type Vec4,
} from '../../../src/legacy-model-support.js'

function sample(overrides: Partial<CpuLayerSample> = {}): CpuLayerSample {
  return {
    texel: [0.5, 0.25, 1, 0.5],
    channels: 1,
    op: 2,
    teamColorMode: 0,
    invert: false,
    clampResult: false,
    ...overrides,
  }
}

function layer(
  slot: StandardMaterialLayer['slot'],
  overrides: Partial<StandardMaterialLayer> = {},
): StandardMaterialLayer {
  return {
    slot,
    texturePath: `Assets\\Textures\\${slot}.dds`,
    uvSource: 0,
    channels: 1,
    op: 2,
    teamColorMode: 0,
    invert: false,
    clampResult: false,
    wrapX: true,
    wrapY: true,
    ...overrides,
  }
}

function material(overrides: Partial<StandardMaterialModel> = {}): StandardMaterialModel {
  return {
    layers: { diffuse: layer('diffuse', { teamColorMode: 1 }) },
    blendMode: 0,
    priority: 0,
    specularity: 20,
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
    ...overrides,
  }
}

describe('chooseChannelCpu (1.5)', () => {
  const texel: Vec4 = [0.1, 0.2, 0.3, 0.4]
  it.each([
    [0, [0.1, 0.2, 0.3, 1]],
    [1, [0.1, 0.2, 0.3, 0.4]],
    [2, [0.4, 0.4, 0.4, 0.4]],
    [3, [0.1, 0.1, 0.1, 0.1]],
    [4, [0.2, 0.2, 0.2, 0.2]],
    [5, [0.3, 0.3, 0.3, 0.3]],
  ] as const)('channel %d', (channels, expected) => {
    expect(chooseChannelCpu(channels as 0, texel)).toEqual(expected)
  })
})

describe('combineLayerColorCpu (1.6)', () => {
  const base: readonly [number, number, number] = [0.5, 0.5, 0.5]
  const color: Vec4 = [0.2, 0.4, 0.6, 0.5]
  const team: readonly [number, number, number] = [1, 0, 0]
  it('MOD multiplies', () => {
    expect(combineLayerColorCpu(0, color, base, team)).toEqual([0.1, 0.2, 0.3])
  })
  it('MOD2X multiplies twice', () => {
    expect(combineLayerColorCpu(1, color, base, team).map(v => Math.round(v * 100) / 100)).toEqual([
      0.2, 0.4, 0.6,
    ])
  })
  it('ADD adds rgb*a', () => {
    expect(combineLayerColorCpu(2, color, base, team)).toEqual([0.6, 0.7, 0.8])
  })
  it('LERP mixes by alpha', () => {
    expect(combineLayerColorCpu(3, color, base, team)).toEqual([0.35, 0.45, 0.55])
  })
  it('TEAMCOLOR ops add a*teamColor', () => {
    expect(combineLayerColorCpu(4, color, base, team)).toEqual([1, 0.5, 0.5])
    expect(combineLayerColorCpu(5, color, base, team)).toEqual([1, 0.5, 0.5])
  })
  it('ADD_NO_ALPHA adds rgb', () => {
    expect(combineLayerColorCpu(6, color, base, team)).toEqual([0.7, 0.9, 1.1])
  })
})

describe('computeLayerColorCpu (1.7 order)', () => {
  const team: readonly [number, number, number] = [0, 1, 0]

  it('team color mixes using the RAW texel alpha before invert', () => {
    const out = computeLayerColorCpu(sample({ teamColorMode: 1, texel: [1, 0, 0, 0] }), team)
    // texel.a = 0 → fully team color
    expect(out).toEqual([0, 1, 0, 1])
  })

  it('invert applies after channel select', () => {
    const out = computeLayerColorCpu(
      sample({ invert: true, channels: 0, texel: [0.25, 0.5, 1, 0.3] }),
      team,
    )
    expect(out.map(v => Math.round(v * 100) / 100)).toEqual([0.75, 0.5, 0, 0])
  })

  it('multiply and add affect RGBA before the map-alpha factor scales only alpha', () => {
    const out = computeLayerColorCpu(
      sample({
        texel: [0.5, 0.5, 0.5, 0.5],
        channels: 1,
        colorMultiply: 2,
        colorAdd: 0.5,
        alphaFactor: 0.25,
      }),
      team,
    )
    expect(out).toEqual([1.5, 1.5, 1.5, 0.375])
  })
})

describe('decodeNormalCpu (1.9)', () => {
  it('dxt5nm reads x from alpha, bc5 from red, rgb8 raw — all agree on the same normal', () => {
    // normal (0.6, 0.8, 0) encoded per-format
    const dxt5nm = decodeNormalCpu([0, 0.9, 0, 0.8], 'dxt5nm')
    const bc5 = decodeNormalCpu([0.8, 0.9, 0, 1], 'bc5')
    const luminanceAlpha = decodeNormalCpu([0.8, 0, 0, 0.9], 'luminance-alpha')
    const rgb8 = decodeNormalCpu([0.8, 0.9, 0.5, 1], 'rgb8')
    expect(dxt5nm[0]).toBeCloseTo(0.6, 5)
    expect(dxt5nm[1]).toBeCloseTo(0.8, 5)
    expect(bc5[0]).toBeCloseTo(0.6, 5)
    expect(bc5[1]).toBeCloseTo(0.8, 5)
    expect(luminanceAlpha[0]).toBeCloseTo(0.6, 5)
    expect(luminanceAlpha[1]).toBeCloseTo(0.8, 5)
    expect(rgb8[0]).toBeCloseTo(0.6, 5)
    expect(rgb8[1]).toBeCloseTo(0.8, 5)
    // z reconstructed for the compressed formats, stored for rgb8
    expect(dxt5nm[2]).toBeCloseTo(0, 5)
    expect(bc5[2]).toBeCloseTo(0, 5)
    expect(luminanceAlpha[2]).toBeCloseTo(0, 5)
    expect(rgb8[2]).toBeCloseTo(0, 5)
  })
})

describe('LAYR Fresnel modulation', () => {
  const standard = {
    mode: 1 as const,
    exponent: 2,
    min: 0.2,
    maxOffset: 0.6,
    transformMode: 0 as const,
    localTransform: false,
    doNotMirror: false,
    translation: [0, 0, 0] as const,
    invertMask: [0, 0, 0] as const,
    rotation: [0, 0] as const,
  }

  it('matches the game exponent/bias/scale formula at center and grazing angles', () => {
    expect(calculateLayerFresnelCpu(standard, [0, 0, 1], [0, 0, -1])).toBeCloseTo(0.2, 5)
    expect(calculateLayerFresnelCpu(standard, [0, 0, 1], [1, 0, 0])).toBeCloseTo(0.8, 5)
    expect(calculateLayerFresnelCpu({ ...standard, mode: 2 }, [0, 0, 1], [0, 0, -1])).toBeCloseTo(
      0.8,
      5,
    )
  })

  it('honors the do-not-mirror flag and modulates RGBA after clamping', () => {
    const doNotMirror = { ...standard, doNotMirror: true }
    expect(calculateLayerFresnelCpu(doNotMirror, [0, 0, 1], [0, 0, 1])).toBeCloseTo(0.8, 5)
    const color = computeLayerColorCpu(
      sample({ texel: [1, 0.5, 0.25, 1], channels: 1, fresnel: standard }),
      [1, 0, 0],
    )
    expect(color[0]).toBeCloseTo(0.2, 5)
    expect(color[1]).toBeCloseTo(0.1, 5)
    expect(color[2]).toBeCloseTo(0.05, 5)
    expect(color[3]).toBeCloseTo(0.2, 5)
  })
})

describe('composeStandardPixelCpu (1.8)', () => {
  const straightOn = {
    lightDir: [0, 0, 1] as const,
    vertexNormal: [0, 0, 1] as const,
    ambient: [0, 0, 0, 0] as const,
  }

  function base(diffuseTexel: Vec4) {
    return {
      layers: { diffuse: sample({ texel: diffuseTexel, op: 2 as const }) },
      specularity: 20,
      specMult: 1,
      emisMult: 1,
      specMode: 0 as const,
      unshaded: false,
      doubleLambert: false,
      clampOutput: false,
      alphaTestThreshold: 0,
      ...straightOn,
    }
  }

  it('diffuse-only under straight light returns the diffuse color', () => {
    const { rgba } = composeStandardPixelCpu(base([0.5, 0.25, 0.75, 1]))
    expect(rgba[0]).toBeCloseTo(0.5, 5)
    expect(rgba[1]).toBeCloseTo(0.25, 5)
    expect(rgba[2]).toBeCloseTo(0.75, 5)
    expect(rgba[3]).toBe(1)
  })

  it('blends detail normals through the authored mask-channel factors', () => {
    const { rgba } = composeStandardPixelCpu({
      ...base([1, 1, 1, 1]),
      normalMapFormat: 'rgb8',
      normalBlendFactors: [1, 0, 0, 0, 1, 0, 0, 0],
      layers: {
        diffuse: sample({ texel: [1, 1, 1, 1] }),
        normal: sample({ texel: [0.5, 0.5, 1, 1] }),
        normalBlend1Mask: sample({ texel: [0.5, 0, 0, 1] }),
        normalBlend1: sample({ texel: [1, 0.5, 0.5, 1] }),
      },
    })

    expect(rgba[0]).toBeCloseTo(Math.SQRT1_2, 5)
    expect(rgba[1]).toBeCloseTo(Math.SQRT1_2, 5)
    expect(rgba[2]).toBeCloseTo(Math.SQRT1_2, 5)
  })

  it('backlit pixels show only ambient (lambert guard)', () => {
    const input = {
      ...base([1, 1, 1, 1]),
      lightDir: [0, 0, -1] as const,
      ambient: [0.02, 0.02, 0.02, 0] as const,
    }
    const { rgba } = composeStandardPixelCpu(input)
    expect(rgba.slice(0, 3)).toEqual([0.02, 0.02, 0.02])
  })

  it('emissive ADD accumulates and scales by emisMult even where diffuse is dark', () => {
    const input = {
      ...base([0.1, 0.1, 0.1, 1]),
      emisMult: 2,
      layers: {
        diffuse: sample({ texel: [0.1, 0.1, 0.1, 1] }),
        emissive1: sample({ texel: [0.25, 0, 0, 1], op: 2 as const }),
      },
    }
    const { rgba } = composeStandardPixelCpu(input)
    expect(rgba[0]).toBeCloseTo(0.1 + 0.25 * 2, 5)
  })

  it('masks and tints accumulated emissive light', () => {
    const input = {
      ...base([0.1, 0.1, 0.1, 1]),
      emisMult: 0.5,
      emissiveTint: [0.8, 0.2, 0.1] as const,
      layers: {
        diffuse: sample({ texel: [0.1, 0.1, 0.1, 1] }),
        emissive1: sample({ texel: [1, 1, 1, 1], op: 2 as const }),
        emissiveMask: sample({ texel: [0, 0, 0, 0.25], channels: 2 as const }),
      },
    }
    const { rgba } = composeStandardPixelCpu(input)
    expect(rgba[0]).toBeCloseTo(0.2, 5)
    expect(rgba[1]).toBeCloseTo(0.125, 5)
    expect(rgba[2]).toBeCloseTo(0.1125, 5)
  })

  it('emissive MOD folds into the shaded color instead of accumulating', () => {
    const input = {
      ...base([0.8, 0.8, 0.8, 1]),
      layers: {
        diffuse: sample({ texel: [0.8, 0.8, 0.8, 1] }),
        emissive1: sample({ texel: [0.5, 0.5, 0.5, 1], op: 0 as const }),
      },
    }
    const { rgba } = composeStandardPixelCpu(input)
    expect(rgba[0]).toBeCloseTo(0.4, 5)
  })

  it('unshaded skips lighting entirely', () => {
    const input = { ...base([0.3, 0.3, 0.3, 1]), unshaded: true, lightDir: [0, 0, -1] as const }
    const { rgba } = composeStandardPixelCpu(input)
    expect(rgba[0]).toBeCloseTo(0.3, 5)
  })

  it('doubleLambert remaps the diffuse term', () => {
    // 45° light: dot = ~0.7071 → double-lambert = 2*0.7071 - 1 ≈ 0.4142
    const dir = Math.SQRT1_2
    const input = { ...base([1, 1, 1, 1]), doubleLambert: true, lightDir: [dir, 0, dir] as const }
    const { rgba } = composeStandardPixelCpu(input)
    expect(rgba[0]).toBeCloseTo(2 * dir - 1, 4)
  })

  it('alpha masks multiply into diffuse alpha and drive the alpha test', () => {
    const input = {
      ...base([1, 1, 1, 0.8]),
      alphaTestThreshold: 0.5,
      layers: {
        diffuse: sample({ texel: [1, 1, 1, 0.8] }),
        alpha1: sample({ texel: [0, 0, 0, 0.5], channels: 2 as const }),
      },
    }
    const result = composeStandardPixelCpu(input)
    expect(result.rgba[3]).toBeCloseTo(0.4, 5)
    expect(result.alphaTestPassed).toBe(false)
  })

  it('does not square an alpha mask when the diffuse layer is RGB-only', () => {
    const input = {
      ...base([1, 1, 1, 0.5]),
      layers: {
        diffuse: sample({ texel: [1, 1, 1, 0.5], channels: 0 as const }),
        alpha1: sample({ texel: [1, 1, 1, 0.5], channels: 2 as const }),
      },
    }
    expect(composeStandardPixelCpu(input).rgba[3]).toBeCloseTo(0.5, 5)
  })

  it('team color replaces the diffuse where the mask alpha is low', () => {
    const input = {
      ...base([0.2, 0.2, 0.2, 0]),
      teamColor: [0, 0, 1] as const,
      layers: { diffuse: sample({ texel: [0.2, 0.2, 0.2, 0], teamColorMode: 1 as const }) },
    }
    const { rgba } = composeStandardPixelCpu(input)
    expect(rgba[2]).toBeCloseTo(1, 5) // fully team blue
  })

  it('applies a red-channel team-color mask as post-light grain merge', () => {
    const input = {
      ...base([0.25, 0.5, 0.75, 1]),
      ambient: [0, 0, 0, 1] as const,
      teamColor: [1, 0.5, 0] as const,
      layers: {
        diffuse: sample({ texel: [0.25, 0.5, 0.75, 1], op: 6 as const }),
        teamColorMask: sample({ texel: [0.5, 1, 1, 1], channels: 3 as const }),
      },
    }
    const { rgba } = composeStandardPixelCpu(input)
    expect(rgba).toEqual([0.5, 0.5, 0.5, 1])
    const source = buildStandardFragmentSource(buildMaterialDefines(material({
      layers: {
        diffuse: layer('diffuse'),
        teamColorMask: layer('teamColorMask', { channels: 3 }),
      },
    })))
    expect(source).toContain('(u_teamColor - vec3(0.5)) * teamColorMask')
  })

  it('spec_mode 1 uses the specular alpha channel only', () => {
    const withSpec = (specMode: 0 | 1) =>
      composeStandardPixelCpu({
        ...base([0, 0, 0, 1]),
        specMode,
        specularity: 1,
        halfVec: [0, 0, -1] as const, // -dot(halfVec, normal) = 1
        layers: {
          diffuse: sample({ texel: [0, 0, 0, 1] }),
          specular: sample({ texel: [1, 0, 0, 0.5], channels: 1 as const }),
        },
      }).rgba
    expect(withSpec(0)[0]).toBeCloseTo(1, 5)
    expect(withSpec(0)[1]).toBeCloseTo(0, 5)
    expect(withSpec(1)[0]).toBeCloseTo(0.5, 5)
    expect(withSpec(1)[1]).toBeCloseTo(0.5, 5)
  })

  it('lightMap multiplies the diffuse term by 2x its color', () => {
    const input = {
      ...base([0.5, 0.5, 0.5, 1]),
      layers: {
        diffuse: sample({ texel: [0.5, 0.5, 0.5, 1] }),
        lightMap: sample({ texel: [0.5, 0.5, 0.5, 1] }),
      },
    }
    const { rgba } = composeStandardPixelCpu(input)
    expect(rgba[0]).toBeCloseTo(0.5, 5) // 0.5 * (0.5*2) = 0.5
  })

  it('adds the environment layer through its mask', () => {
    const input = {
      ...base([0.2, 0.2, 0.2, 1]),
      layers: {
        diffuse: sample({ texel: [0.2, 0.2, 0.2, 1] }),
        envi: sample({ texel: [0.4, 0.6, 0.8, 1], op: 2 as const }),
        enviMask: sample({ texel: [0.5, 0.25, 0, 1] }),
      },
    }
    const { rgba } = composeStandardPixelCpu(input)
    expect(rgba.slice(0, 3)).toEqual([0.4, 0.35, 0.2])
  })

  it('uses ApplyEnv mask alpha once and honors MAT_ v20 environment multipliers', () => {
    const { rgba } = composeStandardPixelCpu({
      ...base([0, 0, 0, 1]),
      environmentMultipliers: [2, 0, 0],
      layers: {
        diffuse: sample({ texel: [0, 0, 0, 1] }),
        envi: sample({ texel: [1, 1, 1, 0.5], channels: 1, op: 2 }),
        enviMask: sample({ texel: [0.5, 0.5, 0.5, 0.5], channels: 1 }),
      },
    })

    expect(rgba[0]).toBeCloseTo(0.25, 5)
    expect(rgba[1]).toBeCloseTo(0.25, 5)
    expect(rgba[2]).toBeCloseTo(0.25, 5)
  })

  it('uses the gloss layer to modulate the specular exponent', () => {
    const render = (gloss: number | null) =>
      composeStandardPixelCpu({
        ...base([0, 0, 0, 1]),
        halfVec: [Math.sqrt(0.75), 0, -0.5] as const,
        layers: {
          diffuse: sample({ texel: [0, 0, 0, 1] }),
          specular: sample({ texel: [1, 1, 1, 1] }),
          ...(gloss === null ? {} : { gloss: sample({ texel: [gloss, gloss, gloss, 1] }) }),
        },
      }).rgba[0]

    expect(render(0.5)).toBeGreaterThan(render(null))
  })

  it('applies composite opacity and gates vertex RGB/alpha independently', () => {
    const colorOnly = composeStandardPixelCpu({
      ...base([1, 1, 1, 0.8]),
      materialAlpha: 0.5,
      vertexColor: [0.25, 0.5, 0.75, 0.1],
      usesVertexColor: true,
      usesVertexAlpha: false,
    }).rgba
    expect(colorOnly[0]).toBeCloseTo(0.2)
    expect(colorOnly[1]).toBeCloseTo(0.4)
    expect(colorOnly[2]).toBeCloseTo(0.6)
    expect(colorOnly[3]).toBeCloseTo(0.4)

    const alphaOnly = composeStandardPixelCpu({
      ...base([1, 1, 1, 0.8]),
      vertexColor: [0.25, 0.5, 0.75, 0.1],
      usesVertexColor: false,
      usesVertexAlpha: true,
    }).rgba
    expect(alphaOnly[0]).toBeCloseTo(0.8)
    expect(alphaOnly[1]).toBeCloseTo(0.8)
    expect(alphaOnly[2]).toBeCloseTo(0.8)
    expect(alphaOnly[3]).toBeCloseTo(0.08)
  })
})

describe('standardBlendModeName (1.10)', () => {
  it('maps blend modes and alpha test', () => {
    expect(standardBlendModeName(0, 0)).toBe('opaque')
    expect(standardBlendModeName(0, 0.5)).toBe('alpha-test')
    expect(standardBlendModeName(1, 0)).toBe('blend')
    expect(standardBlendModeName(2, 0)).toBe('additive')
    expect(standardBlendModeName(3, 0)).toBe('add-alpha')
    expect(standardBlendModeName(4, 0)).toBe('modulate')
    expect(standardBlendModeName(5, 0)).toBe('modulate2x')
    expect(standardBlendModeName(6, 0)).toBe('premultiplied')
  })
})

describe('define building + GLSL sources', () => {
  it('strips disabled layers and keys deterministically (D5)', () => {
    const defines = buildMaterialDefines(material())
    expect(defines.layers.map(l => l.slot)).toEqual(['diffuse'])
    expect(canonicalDefineKey(defines)).toBe(canonicalDefineKey(buildMaterialDefines(material())))
    const withNormal = buildMaterialDefines(
      material({ layers: { diffuse: layer('diffuse'), normal: layer('normal') } }),
    )
    expect(canonicalDefineKey(withNormal)).not.toBe(canonicalDefineKey(defines))
  })

  it('emits one sampler per enabled textured layer and none for constant-color layers', () => {
    const defines = buildMaterialDefines(
      material({
        layers: {
          diffuse: layer('diffuse'),
          emissive1: layer('emissive1', {
            texturePath: null,
            constantColor: { value: [1, 0, 0, 1] },
          }),
        },
      }),
    )
    const frag = buildStandardFragmentSource(defines)
    expect(frag).toContain('uniform sampler2D u_diffuseMap;')
    expect(frag).not.toContain('u_emissive1Map')
    expect(frag).toContain('uniform vec4 u_emissive1Color;')
    expect(frag.match(/uniform sampler2D/g)).toHaveLength(1)
  })

  it('specializes textured layers to a device sampler budget', () => {
    const defines = buildMaterialDefines(
      material({
        layers: {
          diffuse: layer('diffuse'),
          normal: layer('normal'),
          emissive1: layer('emissive1'),
          ao: layer('ao'),
        },
      }),
      { maxTextureSamplers: 2 },
    )
    expect(defines.layers.filter(entry => entry.hasTexture).map(entry => entry.slot)).toEqual([
      'diffuse',
      'normal',
    ])
    expect(buildStandardFragmentSource(defines).match(/uniform sampler2D/g)).toHaveLength(2)
  })

  it('emits vertex-texture GPU skinning only for the capability variant', () => {
    const cpu = buildStandardVertexSource(buildMaterialDefines(material()))
    const gpu = buildStandardVertexSource(buildMaterialDefines(material(), { gpuSkinning: true }))
    expect(cpu).not.toContain('u_boneTexture')
    expect(gpu).toContain('attribute vec4 a_boneIndices;')
    expect(gpu).toContain('readBoneMatrix(a_boneIndices.x, 0.0)')
  })

  it('bakes the per-format normal decode (no green negation anywhere)', () => {
    const model = material({ layers: { diffuse: layer('diffuse'), normal: layer('normal') } })
    const dxt5nm = buildStandardFragmentSource(
      buildMaterialDefines(model, { normalMapFormat: 'dxt5nm' }),
    )
    const bc5 = buildStandardFragmentSource(buildMaterialDefines(model, { normalMapFormat: 'bc5' }))
    expect(dxt5nm).toContain('2.0 * texel.wy - 1.0')
    expect(bc5).toContain('2.0 * texel.xy - 1.0')
    expect(dxt5nm).not.toMatch(/-\s*n\.y|1\.0\s*-\s*texel\.y/) // the old green-negation patch must not resurface
  })

  it('bakes exact per-layer Fresnel mode, exponent, bias, scale, and mirror behavior', () => {
    const fresnel = {
      mode: 2 as const,
      exponent: 3,
      min: 0.2,
      maxOffset: 0.6,
      transformMode: 2 as const,
      localTransform: true,
      doNotMirror: true,
      translation: [1, 2, 3] as const,
      invertMask: [1, 0, 1] as const,
      rotation: [0.25, -0.5] as const,
    }
    const defines = buildMaterialDefines(
      material({ layers: { diffuse: layer('diffuse', { fresnel }) } }),
    )
    const fragment = buildStandardFragmentSource(defines)

    expect(fragment).toContain('float calculateLayerFresnel(')
    expect(fragment).toContain(
      'calculateLayerFresnel(v_viewNormal, v_viewPosition, 3.0, 0.2, 0.6, 2.0, 1.0)',
    )
    expect(canonicalDefineKey(defines)).toContain('fr=2,3,0.2,0.6,2,1,1,1,2,3,1,0,1,0.25,-0.5')
  })

  it('emits both normal-blend masks, detail maps, and factor uniforms', () => {
    const fragment = buildStandardFragmentSource(
      buildMaterialDefines(
        material({
          layers: {
            diffuse: layer('diffuse'),
            normalBlend1Mask: layer('normalBlend1Mask'),
            normalBlend1: layer('normalBlend1'),
            normalBlend2Mask: layer('normalBlend2Mask'),
            normalBlend2: layer('normalBlend2'),
          },
        }),
      ),
    )

    expect(fragment).toContain('uniform vec4 u_normalBlend1Factors;')
    expect(fragment).toContain('uniform vec4 u_normalBlend2Factors;')
    expect(fragment).toContain('computeLayer_normalBlend1Mask()')
    expect(fragment).toContain('decodeNormal(sampleLayerTexel_normalBlend1())')
    expect(fragment).toContain('decodeNormal(sampleLayerTexel_normalBlend2())')
    expect(fragment).toContain('normal = blendNormal(normal,')
  })

  it('routes explicit uv sets and extends attributes accordingly', () => {
    const model = material({
      layers: {
        diffuse: layer('diffuse', { uvSource: 0 }),
        emissive1: layer('emissive1', { uvSource: 9 }), // uv2
      },
    })
    const defines = buildMaterialDefines(model)
    expect(defines.uvSetCount).toBe(3)
    const vert = buildStandardVertexSource(defines)
    const frag = buildStandardFragmentSource(defines)
    expect(vert).toContain('attribute vec2 a_uv2;')
    expect(frag).toContain('v_uv2')
  })

  it('emits UV transform uniforms for flipbook-only layers', () => {
    const defines = buildMaterialDefines(
      material({
        layers: {
          diffuse: layer('diffuse', {
            flipbook: { rows: 2, cols: 2, frame: { value: 0 } },
          }),
        },
      }),
    )
    const fragment = buildStandardFragmentSource(defines)

    expect(defines.layers[0]?.hasUvTransform).toBe(true)
    expect(fragment).toContain('uniform vec2 u_diffuseUvOffset;')
    expect(fragment).toContain('uniform vec2 u_diffuseUvTiling;')
    // SC2: the offset moves the image in mesh UV units, the tiling scales about the UV centre.
    expect(fragment).toContain('((rotateUv(v_uv0, u_diffuseUvAngle.z) - vec2(0.5) - u_diffuseUvOffset) * u_diffuseUvTiling + vec2(0.5))')
  })

  it('applies animated Euler UV rotation and axis-specific triplanar projection', () => {
    const defines = buildMaterialDefines(
      material({
        layers: {
          diffuse: layer('diffuse', {
            uvSource: 16,
            uvAngle: { value: [0.1, 0.2, 0.3] },
            uvTriplanarOffset: { value: [1, 2, 3] },
            uvTriplanarScale: { value: [4, 5, 6] },
          }),
        },
      }),
    )
    const fragment = buildStandardFragmentSource(defines)

    expect(fragment).toContain('uniform vec3 u_diffuseUvAngle;')
    expect(fragment).toContain('uniform vec3 u_diffuseUvTriplanarOffset;')
    expect(fragment).toContain('rotateUv(')
    expect(fragment).toContain('(v_modelPosition + u_diffuseUvTriplanarOffset)')
    expect(fragment).toContain('* u_diffuseUvTriplanarScale')
    expect(fragment).toContain('computeTriPlanarWeights(v_modelNormal)')
    expect(fragment.match(/texture2D\(u_diffuseMap/g)).toHaveLength(3)
  })

  it('emits cube/sphere, planar, screen, and world triplanar UV modes', () => {
    const sourceFor = (uvSource: number) =>
      buildStandardFragmentSource(
        buildMaterialDefines(material({ layers: { diffuse: layer('diffuse', { uvSource }) } })),
      )

    expect(sourceFor(2)).toContain('cubeUv(reflectionDirection())')
    expect(sourceFor(3)).toContain('sphereUvDirection(reflectionDirection())')
    expect(sourceFor(7)).toContain('cubeUv(normalize(v_viewNormal))')
    expect(sourceFor(8)).toContain('sphereUvDirection(normalize(v_viewNormal))')
    expect(sourceFor(11)).toContain('planarLocalUv(v_modelPosition, 0.0)')
    expect(sourceFor(14)).toContain('planarWorldUv(v_worldPosition, 1.0)')
    expect(sourceFor(15)).toContain('vec2(0.5, -0.5)')
    expect(sourceFor(17)).toContain('computeTriPlanarWeights(v_worldNormal)')
    expect(sourceFor(18)).toContain('vec3(v_worldNormal.xy, v_modelNormal.z)')
  })

  it('matches Blizzard spherical, local-planar, and triplanar projection math', () => {
    expect(sphericalEnvironmentUvCpu([0, 0, -1], [0, 0, 1], true)).toEqual([0.5, 0])
    expect(sphericalEnvironmentUvCpu([0, 0, -1], [1, 0, 0], false)).toEqual([1, 0.5])
    expect(planarLocalUvCpu([16, 32, 48], 0)).toEqual([3, -3.5])
    expect(planarLocalUvCpu([16, 32, 48], 2)).toEqual([1.5, -2])

    expect(computeTriPlanarWeightsCpu([1, 0, 0])).toEqual([1, 0, 0])
    const diagonal = computeTriPlanarWeightsCpu([1, 1, 1])
    expect(diagonal[0]).toBeCloseTo(1 / 3)
    expect(diagonal[1]).toBeCloseTo(1 / 3)
    expect(diagonal[2]).toBeCloseTo(1 / 3)

    const fragment = buildStandardFragmentSource(
      buildMaterialDefines(material({ layers: { diffuse: layer('diffuse', { uvSource: 11 }) } })),
    )
    expect(fragment).toContain('planarComponents(position, axis) * 0.09375')
    expect(fragment).toContain('uv.y = 1.0 - uv.y;')
    expect(fragment).toContain('r.xz * vec2(0.5, -0.5) + 0.5')
    expect(fragment).toContain('clamp((abs(normalize(normalValue)) - vec3(0.2)) * 7.0, 0.0, 1.0)')
  })

  it('composes gloss, environment, mask, and height/parallax layers', () => {
    const standard = material({
      parallaxHeight: { value: 0.05 },
      layers: {
        diffuse: layer('diffuse'),
        specular: layer('specular'),
        gloss: layer('gloss'),
        emissive1: layer('emissive1'),
        emissiveMask: layer('emissiveMask', { channels: 2 }),
        envi: layer('envi', { uvSource: 2 }),
        enviMask: layer('enviMask'),
        height: layer('height'),
      },
    })
    const fragment = buildStandardFragmentSource(buildMaterialDefines(standard))

    expect(fragment).toContain('computeLayer_gloss().r')
    expect(fragment).toContain('uniform vec3 u_emissiveTint;')
    expect(fragment).toContain('computeLayer_emissiveMask().r')
    expect(fragment).toContain('computeLayer_enviMask()')
    expect(fragment).toContain('uniform vec3 u_environmentMultipliers;')
    expect(fragment).toContain('environmentMask.rgb *= environmentMask.a;')
    expect(fragment).toContain('environmentMask *= environmentColor.a;')
    expect(fragment).toContain('environmentValue * environmentMask.rgb')
    expect(fragment).toContain('uniform float u_parallaxHeight;')
    expect(fragment).toContain('computeLayer_height().r - 0.5')
    expect(fragment).toContain('g_parallaxOffset =')
  })

  it('emits alpha-test discard only when the threshold is set', () => {
    const noTest = buildStandardFragmentSource(buildMaterialDefines(material()))
    const withTest = buildStandardFragmentSource(
      buildMaterialDefines(material({ alphaTestThreshold: 0.5 })),
    )
    expect(noTest).not.toContain('discard')
    expect(withTest).toContain('if (final.a < u_alphaTestThreshold) discard;')
  })

  it('vertex source carries the handedness-based binormal (1.9)', () => {
    const vert = buildStandardVertexSource(buildMaterialDefines(material()))
    expect(vert).toContain('cross(sourceNormal, sourceTangent) * a_tangent.w')
  })

  it('uses authored vertex colors and a separate composite-alpha uniform', () => {
    const defines = buildMaterialDefines(material({ usesVertexColor: true, usesVertexAlpha: true }))
    const vert = buildStandardVertexSource(defines)
    const frag = buildStandardFragmentSource(defines)
    expect(vert).toContain('attribute vec4 a_color;')
    expect(vert).toContain('v_vertexColor = a_color;')
    expect(frag).toContain('uniform float u_materialAlpha;')
    expect(frag).toContain('final.a = alpha * u_materialAlpha;')
    expect(frag).toContain('final.rgb *= v_vertexColor.rgb;')
    expect(frag).toContain('final.a *= v_vertexColor.a;')
  })
})
