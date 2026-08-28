import { describe, expect, it } from 'vitest'
import { analyzeWarzoneMapObjectResourceBindings } from '../src/data-resource-bindings.js'

const GAME_ID = 'org.modkitx/warzone-2100'

const document = (rootId: string, path: string, value: unknown) => ({
  rootId,
  path,
  text: JSON.stringify(value),
})

const documents = [
  document('base', 'base/stats/templates.json', {
    ConstructorDroid: {
      id: 'ConstructorDroid',
      body: 'Body1REC',
      construct: 'Spade1Mk1',
      propulsion: 'wheeled01',
      type: 'CONSTRUCT',
    },
  }),
  document('base', 'base/stats/structure.json', {
    A0PowerGenerator: {
      id: 'A0PowerGenerator',
      baseModel: 'blbpower.pie',
      structureModel: ['blpower0.pie'],
    },
  }),
  document('base', 'base/stats/features.json', {
    TreeSnow1: { id: 'TreeSnow1', model: 'mistree1.pie' },
  }),
  document('base', 'base/stats/body.json', {
    Body1REC: { id: 'Body1REC', model: 'drlbod01.pie' },
  }),
  document('base', 'base/stats/construction.json', {
    Spade1Mk1: { id: 'Spade1Mk1', sensorModel: 'trlcon.pie' },
  }),
  document('base', 'base/stats/propulsion.json', {
    wheeled01: { id: 'wheeled01', model: 'prlwhl1.pie' },
  }),
]

const objectDocuments = [
  document('map', 'multiplay/maps/fixture/droid.json', {
    droid_1: { template: 'ConstructorDroid' },
  }),
  document('map', 'multiplay/maps/fixture/struct.json', {
    structure_1: { name: 'A0PowerGenerator' },
  }),
  document('map', 'multiplay/maps/fixture/feature.json', {
    feature_1: { name: 'TreeSnow1' },
  }),
]

const modelPaths = [
  'components/bodies/drlbod01.pie',
  'components/prop/prlwhl1.pie',
  'components/weapons/trlcon.pie',
  'structs/blbpower.pie',
  'structs/blpower0.pie',
  'features/mistree1.pie',
]

const request = {
  workspaceId: 'warzone-resource-binding-test',
  gameId: GAME_ID,
  documents,
  objectDocuments,
  resourceEntries: [
    ...modelPaths.map(path => ({ rootId: 'base', path })),
    { rootId: 'base', path: 'texpages/page-14-player.png' },
  ],
  modelDocuments: modelPaths.map(path => ({
    rootId: 'base',
    path,
    text: 'PIE 3\nTYPE 200\nTEXTURE 0 page-14-player.png 0 0\n',
  })),
  maxObjects: 100,
  maxModelReferences: 1_000,
  maxDiagnostics: 100,
  maxTextBytes: 1_000_000,
  maxEntities: 1_000,
  maxDepth: 32,
}

describe('Warzone 2100 extension-owned map resource bindings', () => {
  it('binds typed map definitions through components to observed PIE paths and textures', async () => {
    const analysis = await analyzeWarzoneMapObjectResourceBindings(request)

    expect(analysis.counts).toMatchObject({
      objects: 3,
      boundObjects: 3,
      definitions: 3,
      modelBindings: 6,
      resolvedModelBindings: 6,
      missingModelBindings: 0,
      ambiguousModelBindings: 0,
      textureBindings: 6,
      resolvedTextureBindings: 6,
    })
    expect(analysis.pathComplete).toBe(true)
    expect(analysis.textureDirectiveComplete).toBe(true)
    expect(analysis.materialComplete).toBe(false)
    expect(analysis.objectBindings[0]).toMatchObject({
      objectId: 'droid_1',
      kind: 'droid',
      state: 'bound',
      definition: { namespace: 'warzone.templates', entityId: 'ConstructorDroid' },
    })
    expect(analysis.objectBindings[0].models.map(model => model.resource?.path)).toEqual([
      'components/bodies/drlbod01.pie',
      'components/weapons/trlcon.pie',
      'components/prop/prlwhl1.pie',
    ])
    expect(analysis.namedRemainder).toContain('common-abi-dynamic-resource-index')
    expect(JSON.parse(JSON.stringify(analysis))).toEqual(analysis)
  })

  it('keeps duplicate basenames ambiguous instead of guessing an archive path', async () => {
    const analysis = await analyzeWarzoneMapObjectResourceBindings({
      ...request,
      objectDocuments: [objectDocuments[2]],
      resourceEntries: [
        { rootId: 'base', path: 'features/mistree1.pie' },
        { rootId: 'mod', path: 'alternate/mistree1.pie' },
      ],
      modelDocuments: [],
    })

    expect(analysis.objectBindings[0].models[0]).toMatchObject({
      logicalId: 'mistree1.pie',
      state: 'ambiguous',
    })
    expect(analysis.pathComplete).toBe(false)
    expect(analysis.diagnostics.some(item => item.code.endsWith('/model-ambiguous'))).toBe(true)
  })

  it('publishes a partial binding and a named diagnostic for a missing PIE path', async () => {
    const analysis = await analyzeWarzoneMapObjectResourceBindings({
      ...request,
      objectDocuments: [objectDocuments[2]],
      resourceEntries: [],
      modelDocuments: [],
    })

    expect(analysis.objectBindings[0]).toMatchObject({
      state: 'partial',
      models: [{ logicalId: 'mistree1.pie', state: 'missing' }],
    })
    expect(analysis.diagnostics.some(item => item.code.endsWith('/model-missing'))).toBe(true)
  })

  it('enforces caller-provided bounds inside the extension hard limits', async () => {
    await expect(
      analyzeWarzoneMapObjectResourceBindings({ ...request, maxObjects: 0 }),
    ).rejects.toThrow('maxObjects must be a positive safe integer')
  })
})
