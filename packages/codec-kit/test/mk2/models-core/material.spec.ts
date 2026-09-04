import { describe, expect, it } from 'vitest'
import {
  animatedTrackForSequence,
  validateCompositeMaterial,
  validateStandardMaterial,
  validateRenderSequence,
  type AnimatedScalar,
  type RenderScalarAnimationTrack,
  type RenderSequence,
  type StandardMaterialLayer,
  type StandardMaterialModel,
} from '../../../src/legacy-model-support.js'

function makeLayer(overrides: Partial<StandardMaterialLayer> = {}): StandardMaterialLayer {
  return {
    slot: 'diffuse',
    texturePath: 'Assets\\Textures\\diffuse.dds',
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

function makeMaterial(overrides: Partial<StandardMaterialModel> = {}): StandardMaterialModel {
  return {
    layers: { diffuse: makeLayer() },
    blendMode: 0,
    priority: 0,
    specularity: 20,
    specMult: 1,
    emisMult: 1,
    specMode: 0,
    alphaTestThreshold: 0.5,
    twoSided: false,
    unshaded: false,
    doubleLambert: false,
    clampOutput: false,
    usesVertexColor: false,
    usesVertexAlpha: false,
    ...overrides,
  }
}

function makeTrack(
  vector: readonly number[],
  overrides: Partial<RenderScalarAnimationTrack> = {},
): RenderScalarAnimationTrack {
  return {
    lineType: 1,
    globalSeqId: null,
    keys: [{ frame: 0, vector }],
    ...overrides,
  }
}

describe('validateStandardMaterial', () => {
  it('accepts a well-formed material', () => {
    expect(validateStandardMaterial(makeMaterial())).toEqual([])
  })

  it('rejects out-of-range threshold, op, and channels', () => {
    const material = makeMaterial({
      alphaTestThreshold: 2,
      layers: {
        diffuse: makeLayer({ op: 9 as never, channels: 7 as never }),
      },
    })
    const codes = validateStandardMaterial(material).map(issue => issue.code)
    expect(codes).toContain('alpha-test-threshold-out-of-range')
    expect(codes).toContain('layer-op-out-of-range')
    expect(codes).toContain('layer-channels-out-of-range')
  })

  it('flags slot mismatches and sourceless layers', () => {
    const material = makeMaterial({
      layers: {
        diffuse: makeLayer({ slot: 'normal' }),
        normal: makeLayer({ slot: 'normal', texturePath: null }),
      },
    })
    const codes = validateStandardMaterial(material).map(issue => issue.code)
    expect(codes).toContain('layer-slot-mismatch')
    expect(codes).toContain('layer-missing-source')
  })

  it('accepts constant-color layers without a texture', () => {
    const material = makeMaterial({
      layers: {
        diffuse: makeLayer({ texturePath: null, constantColor: { value: [1, 0, 0, 1] } }),
      },
    })
    expect(validateStandardMaterial(material)).toEqual([])
  })

  it('accepts valid sparse tracks and retains legacy track compatibility', () => {
    const legacyTrack = makeTrack([1])
    const material = makeMaterial({
      layers: {
        diffuse: makeLayer({
          constantColor: {
            value: [1, 1, 1, 1],
            sequenceTracks: [{ sequenceIndex: 0, track: makeTrack([1, 0.5, 0.25, 1]) }],
          },
          colorMultiply: { value: 1, track: legacyTrack },
          colorAdd: {
            value: 0,
            sequenceTracks: [
              {
                sequenceIndex: 3,
                track: makeTrack([0.5]),
                concurrent: true,
                wrapSeconds: 0.75,
              },
            ],
          },
          alphaFactor: {
            value: 1,
            sequenceTracks: [{ sequenceIndex: 0, track: makeTrack([2]) }],
          },
          uvOffset: {
            value: [0, 0],
            sequenceTracks: [{ sequenceIndex: 0, track: makeTrack([0.25, 0.5]) }],
          },
          uvAngle: {
            value: [0, 0, 0],
            sequenceTracks: [{ sequenceIndex: 0, track: makeTrack([0, 0, Math.PI]) }],
          },
          uvTiling: {
            value: [1, 1],
            sequenceTracks: [{ sequenceIndex: 0, track: makeTrack([2, 2]) }],
          },
          flipbook: {
            rows: 2,
            cols: 2,
            frame: {
              value: 0,
              sequenceTracks: [{ sequenceIndex: 0, track: makeTrack([3]) }],
            },
          },
        }),
      },
    })

    expect(validateStandardMaterial(material)).toEqual([])
  })

  it('rejects malformed sparse tracks on every animated layer property', () => {
    const material = makeMaterial({
      layers: {
        diffuse: makeLayer({
          constantColor: {
            value: [1, 1, 1, 1],
            sequenceTracks: [{ sequenceIndex: -1, track: makeTrack([1, 1, 1, 1]) }],
          },
          colorMultiply: {
            value: 1,
            sequenceTracks: [
              { sequenceIndex: 0, track: makeTrack([1]) },
              { sequenceIndex: 0, track: makeTrack([2]) },
            ],
          },
          colorAdd: {
            value: 0,
            sequenceTracks: [
              {
                sequenceIndex: 0,
                track: makeTrack([0]),
                concurrent: true,
                wrapSeconds: Number.POSITIVE_INFINITY,
              },
            ],
          },
          alphaFactor: {
            value: 1,
            sequenceTracks: [{ sequenceIndex: 0, track: makeTrack([1], { keys: [] }) }],
          },
          uvOffset: {
            value: [0, 0],
            sequenceTracks: [
              {
                sequenceIndex: 0,
                track: makeTrack([0, 0], { keys: [{ frame: NaN, vector: [0, 0] }] }),
              },
            ],
          },
          uvAngle: {
            value: [0, 0, 0],
            sequenceTracks: [{ sequenceIndex: 0, track: makeTrack([0, 0]) }],
          },
          uvTiling: {
            value: [1, 1],
            sequenceTracks: [{ sequenceIndex: 0, track: makeTrack([1, NaN]) }],
          },
          flipbook: {
            rows: 2,
            cols: 2,
            frame: {
              value: 0,
              sequenceTracks: [{ sequenceIndex: 0, track: makeTrack([]) }],
            },
          },
        }),
      },
    })

    const issues = validateStandardMaterial(material)
    const codes = issues.map(issue => issue.code)
    expect(codes).toEqual(
      expect.arrayContaining([
        'material-track-sequence-index-invalid',
        'material-track-sequence-index-duplicate',
        'material-track-concurrent-wrap-invalid',
        'material-track-keys-empty',
        'material-track-key-frame-invalid',
        'material-track-key-vector-invalid',
      ]),
    )
    for (const property of [
      'constantColor',
      'colorMultiply',
      'colorAdd',
      'alphaFactor',
      'uvOffset',
      'uvAngle',
      'uvTiling',
      'flipbook.frame',
    ]) {
      expect(issues.some(issue => issue.message.includes(property))).toBe(true)
    }
  })

  it('rejects out-of-order sparse track keys', () => {
    const material = makeMaterial({
      layers: {
        diffuse: makeLayer({
          alphaFactor: {
            value: 1,
            sequenceTracks: [
              {
                sequenceIndex: 0,
                track: makeTrack([1], {
                  keys: [
                    { frame: 1, vector: [1] },
                    { frame: 0, vector: [2] },
                  ],
                }),
              },
            ],
          },
        }),
      },
    })

    expect(validateStandardMaterial(material).map(issue => issue.code)).toContain(
      'material-track-key-frame-order-invalid',
    )
  })
})

describe('validateCompositeMaterial', () => {
  it('rejects empty composites and propagates pass issues', () => {
    expect(validateCompositeMaterial({ passes: [], priority: 0 })[0]?.code).toBe('composite-empty')
    const issues = validateCompositeMaterial({
      passes: [{ material: makeMaterial({ alphaTestThreshold: -1 }), alphaFactor: { value: 1 } }],
      priority: 0,
    })
    expect(issues[0]?.message).toMatch(/^pass 0:/)
  })

  it('validates sparse alpha-factor tracks with pass context', () => {
    const issues = validateCompositeMaterial({
      passes: [
        {
          material: makeMaterial(),
          alphaFactor: {
            value: 1,
            sequenceTracks: [
              {
                sequenceIndex: 0.5,
                track: makeTrack([1]),
                concurrent: true,
                wrapSeconds: 0,
              },
            ],
          },
        },
      ],
      priority: 0,
    })

    expect(issues.map(issue => issue.code)).toEqual(
      expect.arrayContaining([
        'material-track-sequence-index-invalid',
        'material-track-concurrent-wrap-invalid',
      ]),
    )
    expect(issues.every(issue => issue.message.startsWith('pass 0: alphaFactor'))).toBe(true)
  })
})

describe('sequence-indexed material animation tracks', () => {
  it('selects only the track authored for the requested sequence', () => {
    const sequence0 = {
      lineType: 1,
      globalSeqId: null,
      keys: [{ frame: 0, vector: [0] }],
    }
    const sequence2 = {
      lineType: 0,
      globalSeqId: null,
      keys: [{ frame: 0, vector: [2] }],
    }
    const animated: AnimatedScalar = {
      value: 1,
      sequenceTracks: [
        { sequenceIndex: 0, track: sequence0 },
        { sequenceIndex: 2, track: sequence2, concurrent: true, wrapSeconds: 0.5 },
      ],
    }

    expect(animatedTrackForSequence(animated, 2)).toEqual({
      sequenceIndex: 2,
      track: sequence2,
      concurrent: true,
      wrapSeconds: 0.5,
    })
    expect(animatedTrackForSequence(animated, 1)).toBeUndefined()
    expect(animated.value).toBe(1)
  })

  it('indexes a track array once and preserves first-track lookup semantics', () => {
    const first = { sequenceIndex: 2, track: makeTrack([1]) }
    const duplicate = { sequenceIndex: 2, track: makeTrack([2]) }
    let indexedReads = 0
    const sequenceTracks = [first, duplicate]
    Object.defineProperty(sequenceTracks, 0, {
      configurable: true,
      enumerable: true,
      get() {
        indexedReads += 1
        return first
      },
    })
    Object.defineProperty(sequenceTracks, 1, {
      configurable: true,
      enumerable: true,
      get() {
        indexedReads += 1
        return duplicate
      },
    })
    const animated: AnimatedScalar = { value: 0, sequenceTracks }

    expect(animatedTrackForSequence(animated, 2)).toBe(first)
    const readsAfterIndexing = indexedReads
    expect(readsAfterIndexing).toBeGreaterThan(0)
    for (let lookup = 0; lookup < 10; lookup += 1) {
      expect(animatedTrackForSequence(animated, 2)).toBe(first)
      expect(animatedTrackForSequence(animated, 99)).toBeUndefined()
    }
    expect(indexedReads).toBe(readsAfterIndexing)
  })
})

describe('validateRenderSequence', () => {
  function makeSequence(overrides: Partial<RenderSequence> = {}): RenderSequence {
    return {
      name: 'Stand',
      durationSeconds: 1,
      looping: true,
      nodeTracks: [{ boneIndex: 0 }],
      ...overrides,
    }
  }

  it('accepts a well-formed sequence', () => {
    expect(validateRenderSequence(makeSequence(), 2)).toEqual([])
  })

  it('rejects out-of-range or duplicate bones and wrap-less concurrent tracks', () => {
    const sequence = makeSequence({
      nodeTracks: [
        { boneIndex: 0 },
        { boneIndex: 0 },
        { boneIndex: 5 },
        { boneIndex: 1, concurrent: true },
      ],
    })
    const codes = validateRenderSequence(sequence, 2).map(issue => issue.code)
    expect(codes).toContain('track-bone-duplicate')
    expect(codes).toContain('track-bone-out-of-range')
    expect(codes).toContain('concurrent-track-missing-wrap')
  })
})
