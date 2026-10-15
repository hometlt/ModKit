import { describe, expect, it } from 'vitest'
import {
  MAP_PREVIEW_PREPARATION_CONTRACT,
  MAP_PREVIEW_PREPARATION_MATCHER_PROFILE,
  MAP_SEMANTIC_ANALYSIS_CONTRACT,
  MAP_SEMANTIC_MATCHER_PROFILE,
  RESOLVED_MAP_WORKSPACE_CONTRACT,
  WORLD_SCENE_SOURCE_CONTRACT,
  MAP_LAYERS_INPUT_SCHEMA,
  MAP_LAYERS_REPRESENTATION,
  MAP_LAYER_READ_INPUT_SCHEMA,
  MAP_LAYER_WRITE_INPUT_SCHEMA,
  mapLayerWindow,
  admitWorldSceneLighting,
  type MapLayerDescriptor,
  type MapLayerGrid,
  type MapLayerReadRequest,
  type MapSemanticSnapshot,
} from '@modkit/sdk/maps'
// The host's validator for operation schemas: the one that would check these inputs.
import { createServiceOperationSchemaValidator } from '../../host/src/service-operation-schema.js'

describe('sampled world lighting admission', () => {
  const context = { declaredCoordinateSpaceIds: new Set(['uvw']), maximumDirectionalLights: 3 }
  const light = () => ({ facet: 'lighting', id: 'sample', layerId: 'lighting', coordinateSpaceId: 'uvw',
    ambientColor: [0.2, 0.3, 2], ambientIntensity: 2, directional: [
      { id: 'key', direction: [0, -2, 0], color: [3, 0.5, 1], intensity: 4,
        specularColor: [2, 1, 0], specularIntensity: 0, useAmbientOcclusion: false },
    ] })

  it('owns nested data, preserving authored HDR values, order and inert metadata', () => {
    const producer = { ...light(), metadata: { kind: 'spot', tags: ['native'] },
      objects: { ambientColor: [0, 0, 0], ambientIntensity: 0, directional: [] } }
    const admitted = admitWorldSceneLighting(producer, context)
    producer.ambientColor[0] = 99
    producer.directional[0]!.direction[1] = 99
    producer.metadata.tags.push('changed')
    expect(admitted.ambientColor).toEqual([0.2, 0.3, 2])
    expect(admitted.directional[0]).toMatchObject({ direction: [0, -2, 0], intensity: 4, specularIntensity: 0 })
    expect(admitted).toMatchObject({ metadata: { kind: 'spot', tags: ['native'] }, objects: { directional: [] } })
    expect(Object.isFrozen(admitted.directional[0]!.direction)).toBe(true)
    expect(admitted).not.toBe(producer)
  })

  it('keeps existing disabled ranges, AO epsilon, zero gamma/contrast and signed settings', () => {
    const toneMapping = { operator: 'linear', exposure: 0, whitePoint: 0, contrast: 0,
      correctGamma: false, ambientOcclusion: { radius: 0, noOcclusion: 0, fullOcclusion: 1, power: -1 },
      colorization: { inputLow: 1, inputHigh: 1, inputGamma: 0, outputLow: 1, outputHigh: 0,
        brightness: 1, contrast: 0, hue: -2, saturation: 1, lightness: -1, blend: 0 } }
    const producer = { ...light(), toneMapping, shadowRange: { distance: 0, fieldOfViewDegrees: -1 },
      fog: { color: [0, 0, 1], density: 0, falloff: -2, startingHeight: -3 } }
    expect(admitWorldSceneLighting(producer, context)).toEqual(producer)
    expect(admitWorldSceneLighting({ ...producer, shadowRange: { distance: 2, fieldOfViewDegrees: 220 } }, context).shadowRange?.fieldOfViewDegrees).toBe(220)
  })

  it.each([
    ['null', () => null],
    ['wrong facet', () => ({ ...light(), facet: 'objects' })],
    ['undeclared axes', () => ({ ...light(), coordinateSpaceId: 'other' })],
    ['empty identity', () => ({ ...light(), id: '' })],
    ['negative intensity', () => ({ ...light(), ambientIntensity: -1 })],
    ['bad RGB tuple', () => ({ ...light(), ambientColor: [1, 0] })],
    ['zero direction', () => ({ ...light(), directional: [{ ...light().directional[0], direction: [0, 0, 0] }] })],
    ['nonfinite', () => ({ ...light(), ambientIntensity: Infinity })],
    ['shader overflow', () => ({ ...light(), ambientIntensity: 1e40 })],
    ['radiance overflow', () => ({ ...light(), ambientColor: [3e38, 0, 0], ambientIntensity: 2 })],
    ['specular boolean', () => ({ ...light(), directional: [{ ...light().directional[0], useAmbientOcclusion: 1 }] })],
    ['bad object rig', () => ({ ...light(), objects: { ambientColor: [1, 0, 0] } })],
    ['local root', () => ({ ...light(), type: 'point' })],
    ['local directional', () => ({ ...light(), directional: [{ ...light().directional[0], kind: 'spot' }] })],
    ['unsupported count', () => ({ ...light(), directional: Array(4).fill(light().directional[0]) })],
    ['unsupported object count', () => ({ ...light(), objects: { ...light(), directional: Array(4).fill(light().directional[0]) } })],
    ['bad tone', () => ({ ...light(), toneMapping: { operator: 'unknown', exposure: 1, whitePoint: 1, contrast: 1 } })],
    ['coerced linear array', () => ({ ...light(), toneMapping: { operator: ['linear'], exposure: 1, whitePoint: 1, contrast: 1 } })],
    ['coerced Reinhard array with zero white point', () => ({ ...light(), toneMapping: { operator: ['reinhard'], exposure: 1, whitePoint: 0, contrast: 1 } })],
    ['non-string tone', () => ({ ...light(), toneMapping: { operator: false, exposure: 1, whitePoint: 1, contrast: 1 } })],
    ['zero log denominator', () => ({ ...light(), toneMapping: { operator: 'logarithmic', exposure: 0, whitePoint: 1, contrast: 1 } })],
    ['float32 zero log denominator', () => ({ ...light(), toneMapping: { operator: 'logarithmic', exposure: 1e-8, whitePoint: 1, contrast: 1 } })],
    ['zero Reinhard white', () => ({ ...light(), toneMapping: { operator: 'reinhard', exposure: 1, whitePoint: 0, contrast: 1 } })],
    ['bad terrain', () => ({ ...light(), terrain: { specularExponent: -1, diffuseMultiplier: 1, specularMultiplier: 1 } })],
    ['bad fog', () => ({ ...light(), fog: { color: [2, 0, 0], density: 1, falloff: 0, startingHeight: 0 } })],
    ['JSON bytes', () => ({ ...light(), metadata: 'x'.repeat(128 * 1024) })],
    ['JSON nodes', () => ({ ...light(), metadata: Array(4096).fill(0) })],
    ['JSON depth', () => ({ ...light(), metadata: Array.from({ length: 20 }).reduce<object>(nested => ({ nested }), {}) })],
    ['JSON cycle', () => { const value = light() as ReturnType<typeof light> & { cycle?: unknown }; value.cycle = value; return value }],
  ])('refuses %s without a lossy fallback', (_label, make) => {
    expect(() => admitWorldSceneLighting(make(), context)).toThrow()
  })

  it('admits logarithmic exposure above the float32 addition threshold without changing it', () => {
    const toneMapping = { operator: 'logarithmic', exposure: 2 ** -22, whitePoint: 1, contrast: 1 }
    expect(admitWorldSceneLighting({ ...light(), toneMapping }, context).toneMapping).toEqual(toneMapping)
  })

  it('rejects getters without execution, supports cancellation and checks the trusted profile', () => {
    let calls = 0
    const value = { ...light(), get metadata() { calls++; return {} } }
    expect(() => admitWorldSceneLighting(value, context)).toThrow(/accessor/)
    expect(calls).toBe(0)
    expect(() => admitWorldSceneLighting(light(), context, AbortSignal.abort())).toThrow(/cancel/)
    for (const maximumDirectionalLights of [-1, 0.5, 4097, NaN])
      expect(() => admitWorldSceneLighting(light(), { ...context, maximumDirectionalLights })).toThrow(/profile/)
    expect(admitWorldSceneLighting({ ...light(), directional: [] }, { ...context, maximumDirectionalLights: 0 }).directional).toEqual([])
  })
})

describe('game-neutral semantic map contract', () => {
  it('publishes stable service and matcher coordinates without game-specific ids', () => {
    expect(MAP_SEMANTIC_ANALYSIS_CONTRACT).toBe('common.map/semantic-analysis')
    expect(MAP_PREVIEW_PREPARATION_CONTRACT).toBe('common.map/preview-preparation')
    expect(RESOLVED_MAP_WORKSPACE_CONTRACT).toBe('common.map/resolved-workspace')
    expect(WORLD_SCENE_SOURCE_CONTRACT).toBe('common.view/world-scene-source')
    expect(MAP_SEMANTIC_MATCHER_PROFILE).toBe('modkit/map-semantic-matcher')
    expect(MAP_PREVIEW_PREPARATION_MATCHER_PROFILE).toBe('modkit/map-preview-preparation-matcher')
  })

  it('keeps catalog discovery explicit before a map can claim complete schema bindings', () => {
    const snapshot = {
      schemaVersion: 1,
      workspaceId: 'workspace',
      gameId: 'example/game',
      mapId: 'example/map',
      analyzerId: 'example/analyzer',
      documentPaths: ['Objects'],
      regions: [],
      objects: [],
      catalogQueries: [{ namespace: 'Unit', entityId: 'Infantry' }],
      resolvedCatalogObjects: 0,
      diagnostics: [],
      complete: false,
    } satisfies MapSemanticSnapshot

    expect(snapshot.catalogQueries).toEqual([{ namespace: 'Unit', entityId: 'Infantry' }])
    expect(snapshot.complete).toBe(false)
  })
})

describe('map layer windows', () => {
  const layer: MapLayerDescriptor = {
    id: 'height', label: 'Height', meaning: 'height', width: 4, height: 3, minimum: 0, maximum: 9, editable: true,
  }

  it('reads the whole layer or a window of all four fields', () => {
    expect(mapLayerWindow(layer, { layer: 'height' })).toEqual({ x: 0, y: 0, width: 4, height: 3 })
    expect(mapLayerWindow(layer, { layer: 'height', x: 1, y: 2, width: 3, height: 1 })).toEqual({ x: 1, y: 2, width: 3, height: 1 })
    expect(() => mapLayerWindow(layer, { layer: 'height', x: 1, y: 1 })).toThrow(/all of x, y, width and height/u)
    expect(() => mapLayerWindow(layer, { layer: 'height', x: 2, y: 0, width: 3, height: 1 })).toThrow(/leaves the 4x3 layer/u)
    expect(() => mapLayerWindow(layer, { layer: 'cliffs' })).toThrow(/names layer cliffs/u)
  })

  it('writes a whole grid or a placed window of in-range integers', () => {
    expect(mapLayerWindow(layer, { layer: 'height', width: 4, height: 3, values: Array(12).fill(0) })).toEqual({ x: 0, y: 0, width: 4, height: 3 })
    expect(mapLayerWindow(layer, { layer: 'height', x: 3, y: 1, width: 1, height: 2, values: [9, 0] })).toEqual({ x: 3, y: 1, width: 1, height: 2 })
    expect(() => mapLayerWindow(layer, { layer: 'height', x: 1, width: 1, height: 1, values: [0] })).toThrow(/x and y go together/u)
    expect(() => mapLayerWindow(layer, { layer: 'height', width: 1, height: 1, values: [0, 0] })).toThrow(/needs 1 values/u)
    expect(() => mapLayerWindow(layer, { layer: 'height', width: 1, height: 1, values: [10] })).toThrow(/from 0 to 9/u)
    expect(() => mapLayerWindow(layer, { layer: 'height', width: 1, height: 1, values: [0.5] })).toThrow(/from 0 to 9/u)
    expect(() => mapLayerWindow({ ...layer, editable: false }, { layer: 'height', width: 1, height: 1, values: [0] })).toThrow(/read-only/u)
  })

  it('publishes input schemas that accept and refuse what mapLayerWindow does', () => {
    const read = createServiceOperationSchemaValidator(MAP_LAYER_READ_INPUT_SCHEMA.document)
    const write = createServiceOperationSchemaValidator(MAP_LAYER_WRITE_INPUT_SCHEMA.document)
    const list = createServiceOperationSchemaValidator(MAP_LAYERS_INPUT_SCHEMA.document)
    if (!read.valid || !write.valid || !list.valid) throw new Error('a map layer input schema does not compile')
    const accepts = (input: MapLayerReadRequest | MapLayerGrid) => {
      try {
        mapLayerWindow(layer, input)
        return true
      } catch {
        return false
      }
    }
    const reads: readonly MapLayerReadRequest[] = [
      { layer: 'height' },
      { layer: 'height', x: 1, y: 2, width: 3, height: 1 },
      { layer: 'height', x: 1, y: 1 },
      { layer: 'height', width: 2 },
      { layer: 'height', x: -1, y: 0, width: 1, height: 1 },
      { layer: 'height', x: 0, y: 0, width: 0, height: 1 },
    ]
    for (const input of reads) expect(read.validate(input) === undefined, JSON.stringify(input)).toBe(accepts(input))
    const writes: readonly MapLayerGrid[] = [
      { layer: 'height', width: 4, height: 3, values: Array(12).fill(0) },
      { layer: 'height', x: 3, y: 1, width: 1, height: 2, values: [9, 0] },
      { layer: 'height', x: 1, width: 1, height: 1, values: [0] },
      { layer: 'height', y: 1, width: 1, height: 1, values: [0] },
      { layer: 'height', width: 1, height: 1, values: [0.5] },
      { layer: 'height', width: 1, height: 1, values: [-1] },
    ]
    for (const input of writes) expect(write.validate(input) === undefined, JSON.stringify(input)).toBe(accepts(input))
    expect(write.validate({ layer: 'height', width: 1, height: 1, values: [0], expectedSourceRevision: 'r1' })).toBeUndefined()
    expect(read.validate({ layer: 'height', scale: 2 })).toBeDefined()
    expect(list.validate(null)).toBeUndefined()
    expect(list.validate({})).toBeUndefined()
    expect(MAP_LAYERS_REPRESENTATION).toEqual({ id: 'map-layers', contract: 'common.map/layers', major: 1 })
  })
})
