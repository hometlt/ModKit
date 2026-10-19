import assert from 'node:assert/strict'
import { it } from 'node:test'
import {
  createRenderMaterialSampler,
  createStandardMaterialPrograms,
} from '../src/materials/index.js'
import {
  createSceneMaterialProgramSampler,
  prepareSceneMaterialPrograms,
} from '../src/render/materials.js'

const budget = { maxDepth: 64, maxNodes: 10000, maxBytes: 1048576 }
const layer = (slot = 'diffuse', options = {}) => ({
  slot,
  texturePath: null,
  constantColor: { value: [0.2, 0.4, 0.6, 0.5] },
  uvSource: 0,
  channels: 1,
  op: 6,
  teamColorMode: 0,
  invert: false,
  clampResult: true,
  wrapX: true,
  wrapY: true,
  ...options,
})
const material = (options = {}) => ({
  layers: { diffuse: layer() },
  blendMode: 0,
  priority: 0,
  specularity: 10,
  specMult: 1,
  emisMult: 1,
  specMode: 0,
  alphaTestThreshold: 0,
  twoSided: false,
  unshaded: true,
  doubleLambert: false,
  clampOutput: false,
  usesVertexColor: false,
  usesVertexAlpha: false,
  ...options,
})
const parameters = (standard = material()) => ({ renderModel: { version: 1, standard } })

it('keeps a surface when its alpha-zero add/lerp environment has unused animated cube UVs', () => {
  for (const op of [2, 3]) {
    const envi = layer('envi', { texturePath: 'environment.dds', uvSource: 2, op,
      alphaFactor: { value: 0 }, uvAngle: { value: [0, 0, 0.7] } })
    const sampled = createStandardMaterialPrograms(parameters(material({ layers: {
      diffuse: layer(), envi,
    } })), { budget }).sample({ time: 1 }, {
      textureDimensions: new Map([['environment.dds', 'cube']]), sceneLighting: true,
    })[0]
    assert.equal(sampled.textures.find(binding => binding.slot === 'envi').dimension, 'cube')
    const a = sampled.shade({ texels: { envi: [0, 0, 0, 0] } })
    const b = sampled.shade({ texels: { envi: [100, 100, 100, 1] } })
    assert.deepEqual(a.rgba, b.rgba)
    assert.ok(a.rgba.some((value, channel) => channel < 3 && value > 0))
  }
})

it('still refuses transformed cube coordinates when the environment may contribute', () => {
  for (const options of [{ alphaFactor: { value: 1 } }, { op: 6 }, { invert: true },
    { colorAdd: { value: 1 } }, { teamColorMode: 1 }]) {
    const envi = layer('envi', { texturePath: 'environment.dds', uvSource: 2, op: 2,
      alphaFactor: { value: 0 }, uvAngle: { value: [0, 0, 0.7] }, ...options })
    const sampler = createStandardMaterialPrograms(parameters(material({ layers: { diffuse: layer(), envi } })), { budget })
    assert.throws(() => sampler.sample({ time: 1 }, { textureDimensions: new Map([['environment.dds', 'cube']]) }), /transformed UV/u)
  }
})
const track = (from, to, lineType = 1) => ({
  lineType,
  globalSeqId: null,
  keys: [
    { frame: 0, vector: from },
    { frame: 2, vector: to },
  ],
})
const program = (standard, time = { time: 0 }) =>
  createStandardMaterialPrograms(parameters(standard), { budget }).sample(time, {
    ambient: [0, 0, 0, 0],
  })[0]
const close = (actual, expected) => {
  assert.equal(actual.length, expected.length)
  actual.forEach((value, index) =>
    assert.ok(Math.abs(value - expected[index]) < 1e-6, `${actual} != ${expected}`),
  )
}

it('applies material AO to ambient and opted-in direct lights without darkening local light or emission', () => {
  const p = createStandardMaterialPrograms(parameters(material({ unshaded: false, layers: {
    diffuse: layer('diffuse', { constantColor: { value: [1, 1, 1, 1] }, op: 2 }),
    ao: layer('ao', { constantColor: { value: [.8, .8, .8, .25] }, op: 2 }),
    emissive1: layer('emissive1', { constantColor: { value: [.3, .3, .3, 1] }, op: 2 }),
  } })), { budget }).sample({ time: 0 }, { sceneLighting: true })[0]
  const local = { direction: [0, 0, 1], halfVector: [0, 0, -1], diffuseColor: [.4, .4, .4], specularColor: [0, 0, 0] }
  const lighting = { ambientColor: [.2, .2, .2], lightColor: [0, 0, 0], lights: [
    local, { ...local, diffuseColor: [.8, .8, .8], useAmbientOcclusion: true },
  ] }
  // Alpha .25 is AO, not RGB .8: .2*.25 + .4 + .8*.25 + .3 = .95.
  close(p.shade({ sceneLighting: lighting }).rgba, [.95, .95, .95, 1])
  close(p.shade({ sceneLighting: { ...lighting, ambientColor: [0, 0, 0], lights: [local] } }).rgba, [.7, .7, .7, 1])
  const spatial = p.fragmentSourceForSceneLights()
  assert.ok(spatial.includes('sceneDirectOcclusion(lightIndex, materialAo)'))
  assert.ok(spatial.includes('float materialAo = computeLayer_ao().a;'))
  assert.ok(!spatial.includes('color *= computeLayer_ao().rgb;'))
})

it('adopts scene lighting per typed lit standard pass while preserving PBR and unshaded passes', () => {
  const lit = material({ unshaded: false })
  const pbr = material({ unshaded: false, lightingModel: 'pbr-metallic-roughness' })
  const unshaded = material()
  const sampler = createStandardMaterialPrograms({ renderModel: { version: 1, composite: {
    priority: 0, passes: [lit, pbr, unshaded].map(material => ({ material, alphaFactor: { value: 1 } })),
  } } }, { budget })
  const flags = lighting => sampler.sample({ time: 0 }, lighting).map(p => p.defines.sceneLighting === true)
  assert.deepEqual(flags({}), [false, false, false])
  const mutable = { autoSceneLighting: true }
  assert.deepEqual(flags(mutable), [true, false, false])
  mutable.sceneLighting = false
  assert.deepEqual(flags(mutable), [false, false, false])
  delete mutable.sceneLighting
  assert.deepEqual(flags(mutable), [true, false, false])
  delete mutable.autoSceneLighting
  assert.deepEqual(flags(mutable), [false, false, false])
  assert.deepEqual(flags({ autoSceneLighting: true, sceneLighting: true }), [true, true, true])
})

it('forwards automatic standard lighting through the existing instance owner and respects opt-outs', () => {
  const definition = (id, standard, context) => ({ id, baseColor: [1, 1, 1, 1],
    shader: { id: 'modkit.render-material.v1', parameters: parameters(standard) },
    ...(context === undefined ? {} : { context }),
  })
  const lit = material({ unshaded: false })
  const pbr = material({ unshaded: false, lightingModel: 'pbr-metallic-roughness' })
  const definitions = [definition('lit', lit), definition('pbr', pbr), definition('unshaded', material()),
    definition('instance-default', lit, { time: 0 }),
    definition('instance-false', lit, { sceneLighting: false }),
    definition('instance-pbr', pbr, { time: 0 })]
  const sampler = createSceneMaterialProgramSampler(definitions, new Map())
  const flags = context => [...sampler.sample(context, []).values()].map(m => m.passes[0].defines.sceneLighting === true)
  assert.deepEqual(flags({ autoSceneLighting: true }), [true, false, false, true, false, false])
  assert.deepEqual(flags({ autoSceneLighting: true, sceneLighting: false }), [false, false, false, false, false, false])
  assert.deepEqual(flags({ autoSceneLighting: true, sceneLighting: true }), [true, true, true, true, false, true])
  assert.deepEqual(flags({}), [false, false, false, false, false, false])
  assert.throws(() => sampler.sample({ autoSceneLighting: 1 }, []), /automatic material scene lighting/u)
})

it('keeps cube and legacy atlas programs separate in the same material sampler cache', () => {
  const sampler = createStandardMaterialPrograms(
    parameters(
      material({
        layers: { diffuse: layer('diffuse', { texturePath: 'environment.dds', uvSource: 7 }) },
      }),
    ),
    { budget },
  )
  const atlas = sampler.sample({ time: 0 })[0]
  const cube = sampler.sample(
    { time: 0 },
    {
      textureDimensions: new Map([['environment.dds', 'cube']]),
    },
  )[0]
  assert.notEqual(cube.key, atlas.key)
  assert.match(cube.fragmentSource, /uniform highp samplerCube u_diffuseMap/)
  assert.match(atlas.fragmentSource, /uniform sampler2D u_diffuseMap/)
  assert.equal(sampler.sample({ time: 1 })[0].fragmentSource, atlas.fragmentSource)
  assert.equal(atlas.textures[0].dimension, undefined)
  assert.equal(cube.textures[0].dimension, 'cube')
})

it('reports unsupported cube coordinates and animated UV changes instead of sampling face zero', () => {
  const textures = new Map([
    [
      'cube',
      {
        id: 'cube',
        dimension: 'cube',
        width: 1,
        height: 1,
        rgba: new Uint8Array(24),
      },
    ],
  ])
  for (const [layerChanges, materialChanges] of [
    [{ uvSource: 0 }, {}],
    [{ uvOffset: { value: [0.25, 0] } }, {}],
    [{ uvTiling: { value: [2, 1] } }, {}],
    [{ uvAngle: { value: [0, 0, 0.5] } }, {}],
    [{ flipbook: { rows: 2, cols: 2, frame: { value: 1 } } }, {}],
    [{}, { parallaxHeight: { value: 0.1 } }],
  ]) {
    const diagnostics = []
    const programs = prepareSceneMaterialPrograms(
      [
        {
          id: 'environment',
          baseColor: [1, 0, 1, 1],
          shader: {
            id: 'modkit.render-material.v1',
            parameters: parameters(
              material({
                ...materialChanges,
                layers: {
                  diffuse: layer('diffuse', {
                    texturePath: 'environment.dds',
                    uvSource: 2,
                    ...layerChanges,
                  }),
                },
              }),
            ),
          },
          textureBindings: [{ resourceId: 'environment.dds', textureId: 'cube' }],
        },
      ],
      textures,
      undefined,
      diagnostics,
    )
    assert.equal(programs.size, 0)
    assert.deepEqual(
      diagnostics.map(item => item.code),
      ['common.scene/material-feature-unrendered'],
    )
    assert.match(diagnostics[0].message, /base-color fallback/)
  }
})

it('owns immutable source values and separate samples; bounds and cancellation are enforced', () => {
  const source = parameters(),
    sampler = createRenderMaterialSampler(source, budget)
  source.renderModel.standard.layers.diffuse.constantColor.value[0] = 1
  const a = sampler.sample({ time: 0 }),
    b = sampler.sample({ time: 1 })
  assert.equal(a[0].material.layers.diffuse.constantColor.value[0], 0.2)
  assert.notEqual(a[0].material, b[0].material)
  assert.throws(() => {
    a[0].material.layers.diffuse.constantColor.value[0] = 5
  }, TypeError)
  assert.throws(() => createRenderMaterialSampler(source, { ...budget, maxBytes: 10 }), /maxBytes/)
  const cyclic = parameters()
  cyclic.self = cyclic
  assert.throws(() => createRenderMaterialSampler(cyclic, budget), /cyclic/)
  assert.throws(() => sampler.sample({ time: -1 }), /time/)
  assert.throws(() => sampler.sample({ time: 0, sequenceTime: NaN }), /sequenceTime/)
  assert.throws(() => sampler.sample({ time: 0, sequenceIndex: 0.5 }), /sequenceIndex/)
  const signal = AbortSignal.abort()
  assert.throws(() => createRenderMaterialSampler(source, budget, signal), { name: 'AbortError' })
  assert.throws(() => sampler.sample({ time: 0 }, signal), { name: 'AbortError' })
})

it('separates elapsed concurrent time from local clip time and sparse sequence fallback', () => {
  const diffuse = layer('diffuse', {
    colorMultiply: { value: 7, sequenceTracks: [{ sequenceIndex: 0, track: track([1], [3]) }] },
    colorAdd: {
      value: 9,
      sequenceTracks: [
        { sequenceIndex: 0, track: track([0], [2]), concurrent: true, wrapSeconds: 2 },
      ],
    },
    alphaFactor: { value: 8, track: track([1], [2]) },
    uvAngle: {
      value: [0, 0, 0],
      sequenceTracks: [{ sequenceIndex: 0, track: track([0, 0, 0], [2, 4, 6]) }],
    },
  })
  const sampler = createRenderMaterialSampler(parameters(material({ layers: { diffuse } })), budget)
  const active = sampler.sample({ time: 2.5, sequenceTime: 1, sequenceIndex: 0 })[0].material.layers
    .diffuse
  assert.equal(active.colorMultiply.value, 2)
  assert.equal(active.colorAdd.value, 0.5)
  assert.equal(active.alphaFactor.value, 1.5)
  assert.deepEqual(active.uvAngle.value, [1, 2, 3])
  const absent = sampler.sample({ time: 1, sequenceIndex: 1 })[0].material.layers.diffuse
  assert.equal(absent.colorMultiply.value, 7)
  assert.equal(absent.colorAdd.value, 9)
  assert.equal(absent.alphaFactor.value, 1.5)
})

it('keeps concurrent property time independent of selected layer time, priority and seek', () => {
  const diffuse = layer('diffuse', {
    colorMultiply: { value: 7, sequenceTracks: [{ sequenceIndex: 0, track: track([1], [3]) }] },
    colorAdd: { value: 9, sequenceTracks: [
      { sequenceIndex: 0, track: track([0], [2]), concurrent: true, wrapSeconds: 2 },
    ] },
  })
  const sampler = createRenderMaterialSampler(parameters(material({ layers: { diffuse } })), budget)
  const at = (time, local) => sampler.sample({ time, sequenceLayers: [
    { sequenceIndex: 0, time: local, duration: 1, priority: 3 },
  ] })[0].material.layers.diffuse
  assert.equal(at(2.5, 0.25).colorAdd.value, 0.5)
  assert.equal(at(2.5, 0.75).colorAdd.value, 0.5)
  assert.equal(at(2.5, 0.25).colorMultiply.value, 1.25)
  assert.equal(at(2.5, 0.75).colorMultiply.value, 1.75)
  assert.equal(at(0.5, 0.25).colorAdd.value, 0.5)
  assert.equal(at(1.5, 0.25).colorAdd.value, 1.5)
})

it('samples every animatable layer field, normal weights and parallax; step and hold remain exact', () => {
  const diffuse = layer()
  for (const [key, size] of [
    ['constantColor', 4],
    ['colorMultiply', 1],
    ['colorAdd', 1],
    ['alphaFactor', 1],
    ['uvOffset', 2],
    ['uvAngle', 3],
    ['uvTiling', 2],
    ['uvTriplanarOffset', 3],
    ['uvTriplanarScale', 3],
  ]) {
    diffuse[key] = {
      value: size === 1 ? 3 : Array(size).fill(3),
      track: track(Array(size).fill(2), Array(size).fill(4), 0),
    }
  }
  const sampler = createRenderMaterialSampler(
    parameters(
      material({
        layers: { diffuse },
        parallaxHeight: { value: 0, track: track([0], [1]) },
        normalBlendFactors: Array.from({ length: 8 }, (_, i) => ({
          value: i,
          track: track([i], [i + 2]),
        })),
      }),
    ),
    budget,
  )
  const mid = sampler.sample({ time: 1 })[0].material
  assert.equal(mid.layers.diffuse.colorMultiply.value, 2)
  assert.deepEqual(mid.layers.diffuse.constantColor.value, [2, 2, 2, 2])
  assert.equal(mid.parallaxHeight.value, 0.5)
  assert.deepEqual(
    mid.normalBlendFactors.map(x => x.value),
    [1, 2, 3, 4, 5, 6, 7, 8],
  )
  assert.equal(sampler.sample({ time: 100 })[0].material.layers.diffuse.colorMultiply.value, 4)
})

it('preserves composite pass order, base-pass opacity and composite priority; deduplicates resources', () => {
  const m = material({
    layers: {
      diffuse: layer('diffuse', { texturePath: 'image.dds' }),
      normal: layer('normal', { texturePath: 'normal.dds' }),
    },
  })
  const sampler = createRenderMaterialSampler(
    {
      renderModel: {
        version: 1,
        composite: {
          priority: 7,
          passes: [
            { material: m, alphaFactor: { value: 0.01 } },
            { material: m, alphaFactor: { value: 0.1, track: track([0.2], [0.6]) } },
          ],
        },
      },
    },
    budget,
  )
  assert.deepEqual(sampler.resources, ['image.dds', 'normal.dds'])
  const passes = sampler.sample({ time: 1 })
  assert.equal(passes.length, 2)
  assert.equal(passes[0].alpha, 1)
  assert.equal(passes[1].alpha, 0.4)
  assert.equal(passes[1].priority, 7)
})

it('rejects malformed and unsupported executable fields rather than running a guessed material', () => {
  const cases = [
    [
      m => {
        m.layers.diffuse.slot = 'normal'
      },
      /slot/,
    ],
    [
      m => {
        m.layers.foo = layer('foo')
      },
      /unknown layer/,
    ],
    [
      m => {
        m.layers.diffuse.channels = 2.5
      },
      /channels/,
    ],
    [
      m => {
        m.layers.diffuse.uvSource = 19
      },
      /uvSource/,
    ],
    [
      m => {
        m.layers.diffuse.texturePath = ''
      },
      /texturePath/,
    ],
    [
      m => {
        delete m.layers.diffuse.constantColor
      },
      /no texture/,
    ],
    [
      m => {
        m.layers.diffuse.wrapX = 1
      },
      /wrapX/,
    ],
    [
      m => {
        m.layers.diffuse.constantColor.value = [1, 2, 3]
      },
      /components/,
    ],
    [
      m => {
        m.layers.diffuse.constantColor.value[0] = 1e300
      },
      /float32/,
    ],
    [
      m => {
        m.layers.diffuse.colorAdd = { value: 0, track: track([0], [1], 2) }
      },
      /lineType/,
    ],
    [
      m => {
        m.layers.diffuse.colorAdd = { value: 0, track: { ...track([0], [1]), globalSeqId: 0 } }
      },
      /globalSeqId/,
    ],
    [
      m => {
        m.layers.diffuse.colorAdd = { value: 0, track: track([0], [1, 2]) }
      },
      /components/,
    ],
    [
      m => {
        m.layers.diffuse.colorAdd = { value: 0, track: { ...track([0], [1]), keys: [] } }
      },
      /nonempty/,
    ],
    [
      m => {
        m.layers.diffuse.colorAdd = {
          value: 0,
          sequenceTracks: [{ sequenceIndex: 0, track: track([0], [1]), concurrent: true }],
        }
      },
      /wrapSeconds/,
    ],
    [
      m => {
        m.layers.diffuse.colorAdd = {
          value: 0,
          sequenceTracks: [0, 0].map(sequenceIndex => ({ sequenceIndex, track: track([0], [1]) })),
        }
      },
      /duplicate/,
    ],
    [
      m => {
        m.layers.diffuse.flipbook = { rows: 0, cols: 2, frame: { value: 0 } }
      },
      /rows/,
    ],
    [
      m => {
        m.normalBlendFactors = [{ value: 1 }]
      },
      /8 entries/,
    ],
    [
      m => {
        m.normalMapFormat = 'unknown'
      },
      /normalMapFormat/,
    ],
    [
      m => {
        m.normalMapFormat = ['dxt5nm']
      },
      /normalMapFormat/,
    ],
    [
      m => {
        m.alphaTestThreshold = 2
      },
      /alphaTestThreshold/,
    ],
    [
      m => {
        m.blendMode = 7
      },
      /blendMode/,
    ],
  ]
  for (const [change, message] of cases) {
    const m = material()
    change(m)
    assert.throws(() => createRenderMaterialSampler(parameters(m), budget), message)
  }
})

it('applies team color from raw texture alpha before channel alpha replacement', () => {
  const p = program(
    material({
      layers: {
        diffuse: layer('diffuse', {
          texturePath: 'team.dds',
          channels: 0,
          teamColorMode: 1,
        }),
      },
    }),
  )
  close(p.shade({ texels: { diffuse: [0, 1, 0, 0.25] } }).rgba, [0.75, 0.25, 0, 1])
  assert.throws(() => p.shade(), /requires sampled texture/)
  assert.throws(() => p.shade({ texels: { diffuse: [NaN, 0, 0, 1] } }), /finite/)
})

it('renders texture-backed team color masks with the common grain-merge shader path', () => {
  const p = program(
    material({
      layers: {
        diffuse: layer('diffuse', { texturePath: 'diffuse.png' }),
        teamColorMask: layer('teamColorMask', {
          texturePath: 'team.png',
          channels: 3,
        }),
      },
    }),
  )
  close(
    p.shade({
      teamColor: [1, 0.5, 0],
      texels: {
        diffuse: [0.25, 0.5, 0.75, 1],
        teamColorMask: [0.5, 1, 1, 1],
      },
    }).rgba,
    [0.5, 0.5, 0.5, 1],
  )
  assert.match(p.fragmentSource, /\(u_teamColor - vec3\(0\.5\)\) \* teamColorMask/u)
})

it('maps object-space normal RGB through authored axes and the model normal matrix', () => {
  const p = program(
    material({
      layers: { normal: layer('normal', { texturePath: 'object-normal.png' }) },
      normalMapFormat: 'rgb8',
      normalMapSpace: 'object',
      normalMapTransform: [-1, 0, 0, 0, 0, -1, 0, 1, 0],
    }),
  )
  close(
    p.sampleNormal(
      { texels: { normal: [1, 0.5, 0.5, 1] } },
      { tangent: [2, 0, 0], bitangent: [0, 1, 0], normal: [0, 0, 0.5] },
    ),
    [-1, 0, 0],
  )
  assert.equal(p.normalMapSpace, 'object')
  assert.match(p.fragmentSource, /u_sceneWorldNormalMatrix \* \(u_normalMapTransform \* normal\)/u)
})

it('executes all six channel selections and seven color operations', () => {
  const selections = [
    [0.2, 0.4, 0.6, 1],
    [0.2, 0.4, 0.6, 0.5],
    [0.5, 0.5, 0.5, 0.5],
    [0.2, 0.2, 0.2, 0.2],
    [0.4, 0.4, 0.4, 0.4],
    [0.6, 0.6, 0.6, 0.6],
  ]
  selections.forEach((expected, channels) =>
    close(
      program(material({ layers: { diffuse: layer('diffuse', { channels }) } })).shade().rgba,
      expected,
    ),
  )
  const operations = [
    [0.16, 0.08, 0.24],
    [0.32, 0.16, 0.48],
    [0.4, 0.45, 0.7],
    [0.35, 0.35, 0.55],
    [0.45, 0.4, 0.6],
    [0.45, 0.4, 0.6],
    [1, 0.6, 1],
  ]
  operations.forEach((expected, op) =>
    close(
      program(
        material({
          layers: {
            diffuse: layer(),
            decal: layer('decal', { op, constantColor: { value: [0.8, 0.2, 0.4, 0.25] } }),
          },
        }),
      ).shade().rgba,
      [...expected, 0.5],
    ),
  )
})

it('retains environment mask channel semantics and evaluates Fresnel with actual view vectors', () => {
  const fresnel = {
    mode: 1,
    exponent: 1,
    min: 0,
    maxOffset: 1,
    transformMode: 0,
    localTransform: false,
    doNotMirror: false,
    translation: [0, 0, 0],
    invertMask: [0, 0, 0],
    rotation: [0, 0],
  }
  const p = program(
    material({
      layers: {
        diffuse: layer('diffuse', { constantColor: { value: [0, 0, 0, 1] } }),
        envi: layer('envi', { op: 2, constantColor: { value: [0.4, 0.6, 0.8, 0.75] } }),
        enviMask: layer('enviMask', {
          channels: 2,
          constantColor: { value: [0.1, 0.2, 0.3, 0.5] },
        }),
      },
    }),
  )
  close(p.shade().rgba, [0.15, 0.225, 0.3, 1])
  const f = program(material({ layers: { diffuse: layer('diffuse', { fresnel }) } }))
  close(f.shade({ eyeToVertex: [1, 0, 0] }).rgba, [0.2, 0.4, 0.6, 0.5])
  close(f.shade({ eyeToVertex: [0, 0, -1] }).rgba, [0.00002, 0.00004, 0.00006, 0.00005])
})

it('builds shader uniforms from UV animation and flipbooks, the cell after tiling', () => {
  const p = program(
    material({
      layers: {
        diffuse: layer('diffuse', {
          uvOffset: { value: [0.2, 0.4] },
          uvTiling: { value: [2, 2] },
          flipbook: { rows: 2, cols: 2, frame: { value: -1 } },
        }),
      },
    }),
  )
  // Frame 3 of 2x2: (((uv - 0.5 - 0.2) * 2 + 0.5) + 1) / 2 = (uv - 0.5 + 0.05) * 1 + 0.5.
  close(p.uniforms.u_diffuseUvOffset, [-0.05, 0.15])
  close(p.uniforms.u_diffuseUvTiling, [1, 1])
  assert.match(p.fragmentSource, /#version 300 es/)
  assert.match(p.fragmentSource, /out vec4 materialColor/)
  assert.doesNotMatch(p.fragmentSource, /gl_FragColor|texture2D|varying /)
  assert.doesNotMatch(p.vertexSource, /attribute |varying /)
  assert.equal(p.blend, 'opaque')
  assert.ok(Object.isFrozen(p.uniforms.u_diffuseUvOffset))
})

it('preserves authored UV scale for stride-based atlas animation', () => {
  const p = program(
    material({
      layers: {
        diffuse: layer('diffuse', {
          uvOffset: { value: [0.1, 0.2] },
          uvTiling: { value: [2, 3] },
          flipbook: { rows: 4, cols: 2, frameSize: [0.4, 0.125], frame: { value: 5 } },
        }),
      },
    }),
  )
  // Frame 5 (column 1, row 2): (uv - 0.5 - 0.1) * 2 + 0.5 + 0.4 = (uv - 0.5 + 0.1) * 2 + 0.5,
  // likewise 0.2 - 0.25 / 3.
  close(p.uniforms.u_diffuseUvTiling, [2, 3])
  close(p.uniforms.u_diffuseUvOffset, [-0.1, 0.2 - 0.25 / 3])
})

it('uses bound normal channels for lighting and keeps a prepared frame independent of later bindings', () => {
  const m = material({
    unshaded: false,
    layers: {
      diffuse: layer(),
      normal: layer('normal', { texturePath: 'n' }),
    },
  })
  const sampler = createStandardMaterialPrograms(parameters(m), { budget })
  const bindings = new Map([['n', 'bc5']])
  const p = sampler.sample({ time: 0 }, { normalMapFormats: bindings, ambient: [0, 0, 0, 0] })[0]
  bindings.set('n', 'rgb8')
  // x=.6, y=0 gives z=.8; the blue/alpha storage values must not become normal components.
  close(p.shade({ texels: { normal: [0.8, 0.5, 0, 1] } }).rgba, [0.16, 0.32, 0.48, 0.5])
  const next = sampler.sample({ time: 0 }, { normalMapFormats: bindings, ambient: [0, 0, 0, 0] })[0]
  close(next.shade({ texels: { normal: [0.8, 0.5, 0.7, 1] } }).rgba, [0.08, 0.16, 0.24, 0.5])
  // RGB8 stores its full vector; it must not be normalized or have z reconstructed.
  assert.notEqual(p.key, next.key)
  for (const mapping of [new Map([['n', 'unknown']]), new Map([['', 'bc5']])])
    assert.throws(() => sampler.sample({ time: 0 }, { normalMapFormats: mapping }), /normal format/)
})

it('rejects singular, projective and overflowing world projection frames before rendering', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  for (const worldToMaterial of [
    [],
    identity.map((value, i) => (i === 0 ? 0 : value)),
    identity.map((value, i) => (i === 3 ? 1 : value)),
    identity.map((value, i) => (i === 0 ? 1e-40 : value)),
    identity.map((value, i) => (i === 0 ? 1e40 : value)),
  ])
    assert.throws(
      () =>
        createRenderMaterialSampler(
          {
            renderModel: {
              version: 1,
              standard: material(),
              worldToMaterial,
            },
          },
          budget,
        ),
      /matrix|frame|float32/,
    )
})

it('samples prepared materials per moment with the programs a fresh preparation gives', () => {
  const glowing = [
    {
      id: 'glow',
      baseColor: [1, 1, 1, 1],
      shader: {
        id: 'modkit.render-material.v1',
        parameters: parameters(
          material({
            layers: {
              diffuse: layer('diffuse', { alphaFactor: { value: 1, track: track([0.25], [0.75]) } }),
            },
          }),
        ),
      },
    },
  ]
  const sampler = createSceneMaterialProgramSampler(glowing, new Map())
  const [early, late] = [0, 1].map(time => sampler.sample({ time }, []).get('glow').passes[0])
  // One compiled shader for every moment; only the uniform values follow the clock.
  assert.equal(late.defines, early.defines)
  assert.notEqual(late.uniforms.u_diffuseAlphaFactor, early.uniforms.u_diffuseAlphaFactor)
  for (const [time, sampled] of [
    [0, early],
    [1, late],
  ]) {
    const fresh = prepareSceneMaterialPrograms(glowing, new Map(), { time }, []).get('glow')
    assert.deepEqual(sampled.uniforms, fresh.passes[0].uniforms)
    assert.equal(sampled.fragmentSource, fresh.passes[0].fragmentSource)
  }
  assert.throws(() => sampler.sample({ time: -1 }, []), /finite and nonnegative/)
})

it('gives a material without tracks its passes again at another time, and new ones for another frame', () => {
  const sampler = createStandardMaterialPrograms(parameters(), { budget })
  const formats = new Map()
  const options = { ambient: [0, 0, 0, 0], normalMapFormats: formats }
  const first = sampler.sample({ time: 0 }, options)
  // the same frame (equal values) at another time: the same passes, nothing compiled again
  assert.equal(sampler.sample({ time: 3 }, { ...options, ambient: [0, 0, 0, 0] }), first)
  // the caller's map changed since, or another team colour: compiled again
  formats.set('n', 'bc5')
  const remapped = sampler.sample({ time: 3 }, options)
  assert.notEqual(remapped, first)
  assert.notEqual(sampler.sample({ time: 3 }, { ...options, teamColor: [0, 1, 0] }), remapped)
  // a material with a track samples its value at each time
  const animated = createStandardMaterialPrograms(
    parameters(
      material({
        layers: { diffuse: layer('diffuse', { colorAdd: { value: 0, track: track([0], [1]) } }) },
      }),
    ),
    { budget },
  )
  const [early] = animated.sample({ time: 0 }, options)
  const [late] = animated.sample({ time: 1 }, options)
  assert.notEqual(early, late)
  assert.notDeepEqual(early.uniforms, late.uniforms)
})

it('samples a playing material at another clock without making again what no clock reaches', () => {
  // A textured layer whose colour add the clock moves, beside a constant layer it does not reach.
  const sampler = createStandardMaterialPrograms(
    parameters(
      material({
        layers: {
          diffuse: layer('diffuse', {
            texturePath: 'diffuse.dds',
            colorAdd: { value: 0, track: track([0], [1]) },
          }),
          emissive1: layer('emissive1'),
        },
      }),
    ),
    { budget },
  )
  const options = { ambient: [0, 0, 0, 0], normalMapFormats: new Map() }
  const [early] = sampler.sample({ time: 0.5 }, options)
  const [late] = sampler.sample({ time: 1.5 }, options)
  // the clock moves what it reaches
  assert.notEqual(early.uniforms.u_diffuseAdd, late.uniforms.u_diffuseAdd)
  // the rest is made once: the texture bindings, the diagnostics and the default values
  assert.equal(late.textures, early.textures)
  assert.equal(late.diagnostics, early.diagnostics)
  assert.equal(late.uniforms.u_diffuseUvAngle, early.uniforms.u_diffuseUvAngle)
  assert.equal(late.uniforms.u_emissive1Color, early.uniforms.u_emissive1Color)
  // another frame makes them again, alike
  const [lit] = sampler.sample({ time: 1.5 }, { ...options, sceneLighting: true })
  assert.notEqual(lit.textures, early.textures)
  assert.deepEqual(lit.textures, early.textures)
})

it('keeps the programs object of a material without tracks across the clocks of a scene', () => {
  const surface = {
    id: 'surface',
    baseColor: [1, 1, 1, 1],
    shader: { id: 'modkit.render-material.v1', parameters: parameters() },
  }
  const pulsing = {
    id: 'pulsing',
    baseColor: [1, 1, 1, 1],
    shader: {
      id: 'modkit.render-material.v1',
      parameters: parameters(
        material({
          layers: { diffuse: layer('diffuse', { colorAdd: { value: 0, track: track([0], [1]) } }) },
        }),
      ),
    },
  }
  const sampler = createSceneMaterialProgramSampler([surface, pulsing], new Map())
  const early = sampler.sample({ time: 0, teamColor: [1, 0, 0] }, [])
  const late = sampler.sample({ time: 1, teamColor: [1, 0, 0] }, [])
  // draws of the still material at other clocks share its programs (they group and keep a lease)
  assert.equal(late.get('surface'), early.get('surface'))
  assert.notEqual(late.get('pulsing'), early.get('pulsing'))
  const blue = sampler.sample({ time: 1, teamColor: [0, 0, 1] }, [])
  assert.notEqual(blue.get('surface'), early.get('surface'))
})


it('samples material-level emissive gain even with static layers and preserves its resource closure', () => {
  const authored = parameters(material({
    emisMult: { value: 7, sequenceTracks: [{ sequenceIndex: 3, track: track([0], [2]) }] },
    layers: { emissive1: layer('emissive1', { texturePath: 'glow.dds' }) },
  }))
  const before = structuredClone(authored)
  const sampler = createRenderMaterialSampler(authored, budget)
  assert.equal(sampler.timeless, false)
  assert.deepEqual(sampler.resources, ['glow.dds'])
  const programs = createStandardMaterialPrograms(authored, { budget })
  for (const [time, gain] of [[0, 0], [0.5, 0.5], [2, 2], [0, 0]]) {
    const moment = { time, sequenceTime: time, sequenceIndex: 3 }
    assert.equal(sampler.sample(moment)[0].material.emisMult, gain)
    const pass = programs.sample(moment)[0]
    assert.equal(typeof pass.uniforms.u_emisMult, 'number')
    assert.equal(pass.uniforms.u_emisMult, gain)
    assert.equal(pass.textures.some(binding => binding.resourceId === 'glow.dds'), true)
  }
  assert.equal(sampler.sample({ time: 1 })[0].material.emisMult, 7)
  assert.equal(sampler.sample({ time: 1, sequenceIndex: 99 })[0].material.emisMult, 7)
  assert.deepEqual(authored, before)
  authored.renderModel.standard.emisMult.sequenceTracks[0].track.keys[1].vector[0] = 99
  assert.equal(sampler.sample({ time: 2, sequenceIndex: 3 })[0].material.emisMult, 2)
})

it('keeps emissive gain local and concurrent clocks distinct for standard and composite passes', () => {
  const local = material({ emisMult: { value: -0.5, sequenceTracks: [
    { sequenceIndex: 0, track: track([0], [2]) },
  ] } })
  const global = material({ emisMult: { value: 8, sequenceTracks: [
    { sequenceIndex: 0, concurrent: true, wrapSeconds: 2, track: track([0], [2]) },
  ] } })
  const sampler = createRenderMaterialSampler({ renderModel: { version: 1, composite: {
    priority: 0, passes: [{ material: local, alphaFactor: { value: 1 } },
      { material: global, alphaFactor: { value: 1 } }],
  } } }, budget)
  assert.deepEqual(sampler.sample({ time: 2.5, sequenceTime: 1, sequenceIndex: 0 })
    .map(pass => pass.material.emisMult), [1, 0.5])
  for (const sequenceIndex of [undefined, 9])
    assert.deepEqual(sampler.sample({ time: 2.5, sequenceIndex })
      .map(pass => pass.material.emisMult), [-0.5, 8])
  const legacy = createRenderMaterialSampler(parameters(material({
    emisMult: { value: 9, track: track([0], [2]) },
  })), budget)
  assert.equal(legacy.sample({ time: 1 })[0].material.emisMult, 1)
  assert.equal(legacy.sample({ time: 2.5, sequenceTime: 0.5 })[0].material.emisMult, 0.5)
})

it('keeps signed static emissive gain and finite float32 validation at the numeric sample boundary', () => {
  for (const gain of [0, 1, -0.5, 2, Math.fround(3e38)])
    for (const value of [gain, { value: gain }]) {
      const sampler = createRenderMaterialSampler(parameters(material({ emisMult: value })), budget)
      assert.equal(sampler.timeless, true)
      assert.equal(sampler.sample({ time: 0 })[0].material.emisMult, gain)
      assert.equal(program(material({ emisMult: value })).uniforms.u_emisMult, gain)
    }
  for (const value of [NaN, Infinity, -Infinity, 1e40, null, [], {}, { value: null },
    { value: [1] }, { value: 1e40 }, { value: 0, track: track([0, 1], [2, 3]) },
    { value: 0, track: track([0], [Infinity]) },
    { value: 0, sequenceTracks: [{ sequenceIndex: 0, track: track([0], [2]) },
      { sequenceIndex: 0, track: track([1], [3]) }] },
    { value: 0, sequenceTracks: [{ sequenceIndex: 0, concurrent: true, track: track([0], [2]) }] }])
    assert.throws(() => createRenderMaterialSampler(parameters(material({ emisMult: value })), budget))
})

it('applies sampled emissive gain after decode and leaves HDR and alpha in the existing CPU kernel', () => {
  const base = material({
    lightingModel: 'pbr-metallic-roughness', colorPipeline: 'linear-srgb',
    specMult: 0, clampOutput: false, unshaded: false,
    layers: {
      diffuse: layer('diffuse', { constantColor: { value: [0, 0, 0, 0.4] }, clampResult: false }),
      emissive1: layer('emissive1', { texturePath: 'glow.dds', clampResult: false }),
    },
  })
  delete base.layers.emissive1.constantColor
  const gainProgram = (standard, time) => createStandardMaterialPrograms(parameters(standard), { budget })
    .sample(time, { sceneLighting: true, ambient: [0, 0, 0, 0] })[0]
  const shade = (pass, texel = 0.5) => pass.shade({
    texels: { emissive1: [texel, texel, texel, 0.3] },
    sceneLighting: { ambientColor: [0, 0, 0], lightColor: [0, 0, 0] },
  }).rgba
  const gain = { value: 1, track: track([0], [2]) }
  for (const time of [0, 0.5, 2]) {
    const animated = gainProgram({ ...base, emisMult: gain }, { time })
    const staticPass = gainProgram({ ...base, emisMult: time }, { time })
    assert.equal(animated.uniforms.u_emisMult, time)
    close(shade(animated), shade(staticPass))
  }
  const post = shade(gainProgram({ ...base, emisMult: gain }, { time: 2 }))
  const pre = shade(gainProgram({ ...base, emisMult: 1, layers: { ...base.layers,
    emissive1: { ...base.layers.emissive1, colorMultiply: { value: 2 } },
  } }, { time: 2 }))
  // Lit linear-sRGB programs encode the post-decode result for display at their output.
  const encoded = 1.055 * Math.pow(0.4280822809644651, 1 / 2.4) - 0.055
  close(post, [encoded, encoded, encoded, 0.4])
  assert.ok(pre[0] - post[0] > 0.3)
  const hdr = { ...base, emisMult: gain, lightingModel: 'm3', colorPipeline: 'm3', unshaded: true }
  close(shade(gainProgram(hdr, { time: 2 }), 1), [2, 2, 2, 0.4])
  close(shade(gainProgram({ ...hdr, clampOutput: true }, { time: 2 }), 1), [1, 1, 1, 0.4])
})
