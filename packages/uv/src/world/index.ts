/** Production reader and canonical writer for the UVW 1.0 heightfield profile. */

import { canonicalJsonStringify, compareUtf8, ModkitError } from '@modkit/core'
import type { MapModelComponentPlacement } from '@modkit/sdk'
import type { WorldToneMapping, WorldTerrainLighting } from '@modkit/sdk/maps'

export const UVW_PROFILE_FORMAT = 'UVW' as const
export const UVW_PROFILE_VERSION = '1.0' as const

export const DEFAULT_UVW_PARSE_LIMITS = Object.freeze({
  maxBytes: 64 * 1024 * 1024,
  maxDepth: 64,
  maxNodes: 1_000_000,
  maxSamples: 16_777_216,
})

export interface UvwParseLimits {
  readonly maxBytes?: number
  readonly maxDepth?: number
  readonly maxNodes?: number
  readonly maxSamples?: number
  readonly signal?: AbortSignal
}

export interface UvwBasis {
  readonly handedness: 'right'
  readonly upAxis: 'y'
  readonly forwardAxis: '+z'
  readonly unit: 'meter' | 'source-unit'
  readonly metersPerUnit?: number
  readonly sourceUnit?: string
  readonly unitsPerCell?: number
}

export interface UvwBounds {
  readonly min: readonly [number, number, number]
  readonly max: readonly [number, number, number]
}

export interface UvwHeightfieldLayer {
  readonly id: string
  readonly kind: 'heightfield'
  readonly label?: string
  readonly columns: number
  readonly rows: number
  readonly cellSize: number
  readonly origin: readonly [number, number, number]
  readonly noDataValue?: number
  readonly samples: readonly (readonly number[])[]
}

export interface UvwUvTransform {
  readonly offset: readonly [number, number]
  readonly scale: readonly [number, number]
  readonly rotation: number
}

export interface UvwTerrainMaterial {
  readonly id: string
  readonly label?: string
  readonly classification?: string
  readonly sourceIndex?: number
  /** glTF `baseColorFactor`: linear RGBA 0..1 multiplying the base colour, or the colour itself. */
  readonly baseColorFactor?: readonly [number, number, number, number]
  readonly baseColorResourceId?: string
  readonly normalResourceId?: string
  readonly specularResourceId?: string
  readonly uvTransform?: UvwUvTransform
}

export interface UvwTerrainMaterialWeight {
  readonly materialId: string
  readonly weight: number
}

export interface UvwTerrainMaterialSample {
  readonly weights: readonly UvwTerrainMaterialWeight[]
  readonly uvTransform?: UvwUvTransform
}

/** Package-owned exact RGBA weight raster; channels follow materialIds order. */
export interface UvwTerrainWeightRaster {
  readonly resourceId: string
  readonly width: number
  readonly height: number
  readonly materialIds: readonly string[]
  readonly encoding: 'rgba8-unorm'
  readonly normalization: 'sum'
}

/** Exact material weights, represented as sample cells, compact rasters, or both. */
export interface UvwTerrainMaterialsLayer {
  readonly schemaVersion: 1
  readonly id: string
  readonly kind: 'terrain-materials'
  readonly label?: string
  readonly columns: number
  readonly rows: number
  readonly cellSize: number
  readonly origin: readonly [number, number, number]
  readonly materials: readonly UvwTerrainMaterial[]
  readonly samples?: readonly (readonly UvwTerrainMaterialSample[])[]
  readonly weightRasters?: readonly UvwTerrainWeightRaster[]
}

export interface UvwCliffsLayer {
  readonly schemaVersion: 1
  readonly id: string
  readonly kind: 'cliffs'
  readonly label?: string
  readonly columns: number
  readonly rows: number
  readonly cellSize: number
  readonly origin: readonly [number, number, number]
  readonly levels: readonly (readonly number[])[]
  readonly authored: readonly (readonly boolean[])[]
}

export interface UvwWaterZone {
  readonly id: string
  readonly minimum: readonly [number, number]
  readonly maximum: readonly [number, number]
  readonly elevation: number
  readonly materialId?: string
}

export interface UvwWaterMaterial {
  readonly id: string
  readonly label?: string
  readonly classification?: 'water' | 'lava'
  readonly shorelineMode?: 'terrain-clipped' | 'zone'
  readonly color: readonly [number, number, number, number]
  readonly baseColorResourceId?: string
  readonly secondaryColorResourceId?: string
  readonly uvScale?: readonly [number, number, number, number]
  readonly scroll?: readonly [number, number, number, number]
  readonly colorFalloff?: number
  readonly specularity?: number
  readonly specularScale?: number
  readonly reflectivityPower?: number
  readonly causticsResourceId?: string
  readonly causticsScale?: readonly [number, number]
  readonly causticsFramesPerSecond?: number
  readonly receiveShadows?: boolean
}

export interface UvwWaterLayer {
  readonly schemaVersion: 1
  readonly id: string
  readonly kind: 'water'
  readonly label?: string
  readonly materials?: readonly UvwWaterMaterial[]
  readonly zones: readonly UvwWaterZone[]
}

export type UvwObjectKind = 'unit' | 'structure' | 'feature' | 'doodad' | 'point' | 'camera'

/** The clip an object starts with (SPEC_UVW_PROFILE, initial object presentation). */
export interface UvwPresentationAnimation {
  readonly name: string
  readonly groups: readonly string[]
  readonly loop: boolean
  /** Signed presentation-time multiplier; zero pauses. */
  readonly speed: number
  readonly randomStart?: boolean
}

export interface UvwObjectInstance {
  readonly id: string
  readonly objectKind: UvwObjectKind
  readonly position: readonly [number, number, number]
  readonly rotation: readonly [number, number, number, number]
  readonly scale: readonly [number, number, number]
  readonly resourceIds: readonly string[]
  readonly modelComponents?: readonly MapModelComponentPlacement[]
  readonly typeId?: string
  readonly player?: number
  readonly variation?: number
  readonly name?: string
  /** RGB multiplication factors 0..1 of the object's model, not player colour or opacity. */
  readonly presentationTint?: readonly [number, number, number]
  readonly presentationAnimation?: UvwPresentationAnimation
}

export interface UvwObjectsLayer {
  readonly schemaVersion: 1
  readonly id: string
  readonly kind: 'objects'
  readonly label?: string
  readonly instances: readonly UvwObjectInstance[]
}

export interface UvwResource {
  readonly id: string
  readonly kind: 'uvm' | 'media'
  readonly uri: string
  readonly digest?: `sha256:${string}`
}

export interface UvwResourcesLayer {
  readonly schemaVersion: 1
  readonly id: string
  readonly kind: 'resources'
  readonly label?: string
  readonly resources: readonly UvwResource[]
}

export type UvwRegionShape =
  | Readonly<{
      readonly kind: 'circle'
      readonly center: readonly [number, number]
      readonly radius: number
    }>
  | Readonly<{
      readonly kind: 'rectangle'
      readonly minimum: readonly [number, number]
      readonly maximum: readonly [number, number]
    }>
  | Readonly<{
      readonly kind: 'polygon'
      readonly points: readonly (readonly [number, number])[]
    }>

export interface UvwRegion {
  readonly id: string
  readonly name: string
  readonly color?: string
  readonly shapes: readonly UvwRegionShape[]
}

export interface UvwRegionsLayer {
  readonly schemaVersion: 1
  readonly id: string
  readonly kind: 'regions'
  readonly label?: string
  readonly regions: readonly UvwRegion[]
}

export interface UvwNavigationLayer {
  readonly schemaVersion: 1
  readonly id: string
  readonly kind: 'navigation'
  readonly label?: string
  readonly columns: number
  readonly rows: number
  readonly cellSize: number
  readonly origin: readonly [number, number, number]
  readonly samples: readonly (readonly number[])[]
}

export interface UvwGatewaySegment {
  readonly id: string
  /** Segment endpoints in the canonical horizontal x/z plane. */
  readonly start: readonly [number, number]
  readonly end: readonly [number, number]
}

export interface UvwGatewaysLayer {
  readonly schemaVersion: 1
  readonly id: string
  readonly kind: 'gateways'
  readonly label?: string
  readonly segments: readonly UvwGatewaySegment[]
}

export interface UvwDirectionalLight {
  readonly id: string
  readonly direction: readonly [number, number, number]
  readonly color: readonly [number, number, number]
  readonly intensity: number
  readonly specularColor?: readonly [number, number, number]
  readonly specularIntensity?: number
  readonly useAmbientOcclusion?: boolean
}

export interface UvwLightingLayer {
  readonly schemaVersion: 1
  readonly id: string
  readonly kind: 'lighting'
  readonly label?: string
  readonly ambientColor: readonly [number, number, number]
  readonly ambientIntensity: number
  readonly directional: readonly UvwDirectionalLight[]
  readonly toneMapping?: WorldToneMapping
  readonly terrain?: WorldTerrainLighting
}

export type UvwHeightfieldSpaceLayer =
  | UvwHeightfieldLayer
  | UvwTerrainMaterialsLayer
  | UvwCliffsLayer
  | UvwWaterLayer
  | UvwObjectsLayer
  | UvwResourcesLayer
  | UvwRegionsLayer
  | UvwNavigationLayer
  | UvwGatewaysLayer
  | UvwLightingLayer

export interface UvwHeightfieldSpace {
  readonly id: string
  readonly topology: 'heightfield'
  readonly label?: string
  readonly basis: UvwBasis
  readonly bounds: UvwBounds
  readonly layers: readonly UvwHeightfieldSpaceLayer[]
}

export interface UvwProfileDocument {
  readonly $comment?: string
  readonly uv: Readonly<{
    readonly format: typeof UVW_PROFILE_FORMAT
    readonly version: typeof UVW_PROFILE_VERSION
    readonly status: 'profile'
  }>
  readonly spaces: readonly UvwHeightfieldSpace[]
  readonly connections: readonly []
}

interface ValidationBudget {
  readonly maxDepth: number
  readonly maxNodes: number
  readonly maxSamples: number
  readonly signal?: AbortSignal
  nodes: number
  samples: number
}

const ID_PATTERN = /^[a-z][a-z0-9-]*$/u

function fail(message: string, path = '$', code = 'x3.uv/uvw-invalid'): never {
  throw new ModkitError({ code, message, context: Object.freeze({ path }) })
}

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${name} must be a positive safe integer`, `options.${name}`, 'x3.uv/uvw-budget-invalid')
  }
  return value
}

function budget(options: UvwParseLimits): ValidationBudget {
  return {
    maxDepth: positiveLimit(options.maxDepth ?? DEFAULT_UVW_PARSE_LIMITS.maxDepth, 'maxDepth'),
    maxNodes: positiveLimit(options.maxNodes ?? DEFAULT_UVW_PARSE_LIMITS.maxNodes, 'maxNodes'),
    maxSamples: positiveLimit(
      options.maxSamples ?? DEFAULT_UVW_PARSE_LIMITS.maxSamples,
      'maxSamples',
    ),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    nodes: 0,
    samples: 0,
  }
}

function enter(state: ValidationBudget, path: string, depth: number): void {
  state.signal?.throwIfAborted()
  if (depth > state.maxDepth) {
    fail(
      `UVW nesting exceeds maxDepth ${String(state.maxDepth)}`,
      path,
      'x3.uv/uvw-budget-exceeded',
    )
  }
  state.nodes += 1
  if (state.nodes > state.maxNodes) {
    fail(
      `UVW value count exceeds maxNodes ${String(state.maxNodes)}`,
      path,
      'x3.uv/uvw-budget-exceeded',
    )
  }
}

function record(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): Record<string, unknown> {
  enter(state, path, depth)
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail('expected an object', path)
  return value as Record<string, unknown>
}

function array(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): readonly unknown[] {
  enter(state, path, depth)
  if (!Array.isArray(value)) fail('expected an array', path)
  return value
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail(`unknown property ${JSON.stringify(key)}`, `${path}.${key}`)
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(`missing required property ${JSON.stringify(key)}`, path)
  }
}

function string(value: unknown, path: string, state: ValidationBudget, depth: number): string {
  enter(state, path, depth)
  if (typeof value !== 'string') fail('expected a string', path)
  return value
}

function finite(value: unknown, path: string, state: ValidationBudget, depth: number): number {
  enter(state, path, depth)
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('expected a finite number', path)
  return value === 0 ? 0 : value
}

function positive(value: unknown, path: string, state: ValidationBudget, depth: number): number {
  const result = finite(value, path, state, depth)
  if (result <= 0) fail('expected a number greater than zero', path)
  return result
}

function integerAtLeast(
  value: unknown,
  minimum: number,
  path: string,
  state: ValidationBudget,
  depth: number,
): number {
  const result = finite(value, path, state, depth)
  if (!Number.isSafeInteger(result) || result < minimum) {
    fail(`expected a safe integer greater than or equal to ${String(minimum)}`, path)
  }
  return result
}

function safeInteger(value: unknown, path: string, state: ValidationBudget, depth: number): number {
  const result = finite(value, path, state, depth)
  if (!Number.isSafeInteger(result)) fail('expected a safe integer', path)
  return result
}

function literal<T extends string>(
  value: unknown,
  expected: T,
  path: string,
  state: ValidationBudget,
  depth: number,
): T {
  const actual = string(value, path, state, depth)
  if (actual !== expected) fail(`expected ${JSON.stringify(expected)}`, path)
  return expected
}

function vec3(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): readonly [number, number, number] {
  const values = array(value, path, state, depth)
  if (values.length !== 3) fail('expected exactly three coordinates', path)
  return Object.freeze([
    finite(values[0], `${path}[0]`, state, depth + 1),
    finite(values[1], `${path}[1]`, state, depth + 1),
    finite(values[2], `${path}[2]`, state, depth + 1),
  ])
}

function vec2(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): readonly [number, number] {
  const values = array(value, path, state, depth)
  if (values.length !== 2) fail('expected exactly two coordinates', path)
  return Object.freeze([
    finite(values[0], `${path}[0]`, state, depth + 1),
    finite(values[1], `${path}[1]`, state, depth + 1),
  ])
}

function vec4(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): readonly [number, number, number, number] {
  const values = array(value, path, state, depth)
  if (values.length !== 4) fail('expected exactly four coordinates', path)
  return Object.freeze([
    finite(values[0], `${path}[0]`, state, depth + 1),
    finite(values[1], `${path}[1]`, state, depth + 1),
    finite(values[2], `${path}[2]`, state, depth + 1),
    finite(values[3], `${path}[3]`, state, depth + 1),
  ])
}

function booleanValue(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): boolean {
  enter(state, path, depth)
  if (typeof value !== 'boolean') fail('expected a boolean', path)
  return value
}

function presentationAnimationOf(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): UvwPresentationAnimation {
  const animation = record(value, path, state, depth)
  exactKeys(
    animation,
    ['name', 'groups', 'loop', 'speed', 'randomStart'],
    ['name', 'groups', 'loop', 'speed'],
    path,
  )
  const name = string(animation['name'], `${path}.name`, state, depth + 1)
  if (name === '') fail('the clip name must not be empty', `${path}.name`)
  const groups = array(animation['groups'], `${path}.groups`, state, depth + 1).map(
    (group, index) => {
      const value = string(group, `${path}.groups[${String(index)}]`, state, depth + 2)
      if (value === '') fail('a clip group must not be empty', `${path}.groups[${String(index)}]`)
      return value
    },
  )
  return Object.freeze({
    name,
    groups: Object.freeze(groups),
    loop: booleanValue(animation['loop'], `${path}.loop`, state, depth + 1),
    speed: finite(animation['speed'], `${path}.speed`, state, depth + 1),
    ...(animation['randomStart'] === undefined
      ? {}
      : {
          randomStart: booleanValue(
            animation['randomStart'],
            `${path}.randomStart`,
            state,
            depth + 1,
          ),
        }),
  })
}

function layerId(value: unknown, path: string, state: ValidationBudget, depth: number): string {
  const id = string(value, path, state, depth)
  if (!ID_PATTERN.test(id)) fail('id must match ^[a-z][a-z0-9-]*$', path)
  return id
}

function labelOf(
  item: Record<string, unknown>,
  path: string,
  state: ValidationBudget,
  depth: number,
): string | undefined {
  return item['label'] === undefined
    ? undefined
    : string(item['label'], `${path}.label`, state, depth)
}

function schemaVersionOne(
  item: Record<string, unknown>,
  path: string,
  state: ValidationBudget,
  depth: number,
): 1 {
  const version = integerAtLeast(item['schemaVersion'], 1, `${path}.schemaVersion`, state, depth)
  if (version !== 1) fail('expected schemaVersion 1', `${path}.schemaVersion`)
  return 1
}

function basis(value: unknown, path: string, state: ValidationBudget, depth: number): UvwBasis {
  const item = record(value, path, state, depth)
  exactKeys(
    item,
    ['handedness', 'upAxis', 'forwardAxis', 'unit', 'metersPerUnit', 'sourceUnit', 'unitsPerCell'],
    ['handedness', 'upAxis', 'forwardAxis', 'unit'],
    path,
  )
  literal(item['handedness'], 'right', `${path}.handedness`, state, depth + 1)
  literal(item['upAxis'], 'y', `${path}.upAxis`, state, depth + 1)
  literal(item['forwardAxis'], '+z', `${path}.forwardAxis`, state, depth + 1)
  const unit = string(item['unit'], `${path}.unit`, state, depth + 1)
  if (unit !== 'meter' && unit !== 'source-unit')
    fail('expected "meter" or "source-unit"', `${path}.unit`)
  const metersPerUnit =
    item['metersPerUnit'] === undefined
      ? undefined
      : positive(item['metersPerUnit'], `${path}.metersPerUnit`, state, depth + 1)
  const sourceUnit =
    item['sourceUnit'] === undefined
      ? undefined
      : string(item['sourceUnit'], `${path}.sourceUnit`, state, depth + 1)
  const unitsPerCell =
    item['unitsPerCell'] === undefined
      ? undefined
      : positive(item['unitsPerCell'], `${path}.unitsPerCell`, state, depth + 1)
  if (unit === 'source-unit') {
    if (sourceUnit === undefined || sourceUnit.length === 0)
      fail('source-unit basis requires non-empty sourceUnit', `${path}.sourceUnit`)
    if (metersPerUnit !== undefined)
      fail('source-unit basis forbids metersPerUnit', `${path}.metersPerUnit`)
  } else if (sourceUnit !== undefined) {
    fail('meter basis forbids sourceUnit', `${path}.sourceUnit`)
  }
  return Object.freeze({
    handedness: 'right',
    upAxis: 'y',
    forwardAxis: '+z',
    unit,
    ...(metersPerUnit === undefined ? {} : { metersPerUnit }),
    ...(sourceUnit === undefined ? {} : { sourceUnit }),
    ...(unitsPerCell === undefined ? {} : { unitsPerCell }),
  })
}

function bounds(value: unknown, path: string, state: ValidationBudget, depth: number): UvwBounds {
  const item = record(value, path, state, depth)
  exactKeys(item, ['min', 'max'], ['min', 'max'], path)
  const min = vec3(item['min'], `${path}.min`, state, depth + 1)
  const max = vec3(item['max'], `${path}.max`, state, depth + 1)
  for (let axis = 0; axis < 3; axis += 1) {
    if (min[axis]! > max[axis]!)
      fail('bounds minimum exceeds maximum', `${path}.${['x', 'y', 'z'][axis]}`)
  }
  return Object.freeze({ min, max })
}

function heightfieldLayer(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): UvwHeightfieldLayer {
  const item = record(value, path, state, depth)
  exactKeys(
    item,
    ['id', 'kind', 'label', 'columns', 'rows', 'cellSize', 'origin', 'noDataValue', 'samples'],
    ['id', 'kind', 'columns', 'rows', 'cellSize', 'origin', 'samples'],
    path,
  )
  literal(item['kind'], 'heightfield', `${path}.kind`, state, depth + 1)
  const id = layerId(item['id'], `${path}.id`, state, depth + 1)
  const label =
    item['label'] === undefined
      ? undefined
      : string(item['label'], `${path}.label`, state, depth + 1)
  const columns = integerAtLeast(item['columns'], 2, `${path}.columns`, state, depth + 1)
  const rows = integerAtLeast(item['rows'], 2, `${path}.rows`, state, depth + 1)
  const count = columns * rows
  if (!Number.isSafeInteger(count) || count > state.maxSamples - state.samples) {
    fail(
      `heightfield samples exceed maxSamples ${String(state.maxSamples)}`,
      `${path}.samples`,
      'x3.uv/uvw-budget-exceeded',
    )
  }
  state.samples += count
  const samplesValue = array(item['samples'], `${path}.samples`, state, depth + 1)
  if (samplesValue.length !== rows) fail(`expected ${String(rows)} sample rows`, `${path}.samples`)
  const samples = samplesValue.map((rowValue, rowIndex) => {
    if ((rowIndex & 0xff) === 0) state.signal?.throwIfAborted()
    const rowPath = `${path}.samples[${String(rowIndex)}]`
    const row = array(rowValue, rowPath, state, depth + 2)
    if (row.length !== columns) fail(`expected ${String(columns)} samples`, rowPath)
    return Object.freeze(
      row.map((sample, columnIndex) =>
        finite(sample, `${rowPath}[${String(columnIndex)}]`, state, depth + 3),
      ),
    )
  })
  const noDataValue =
    item['noDataValue'] === undefined
      ? undefined
      : finite(item['noDataValue'], `${path}.noDataValue`, state, depth + 1)
  return Object.freeze({
    id,
    kind: 'heightfield',
    ...(label === undefined ? {} : { label }),
    columns,
    rows,
    cellSize: positive(item['cellSize'], `${path}.cellSize`, state, depth + 1),
    origin: vec3(item['origin'], `${path}.origin`, state, depth + 1),
    ...(noDataValue === undefined ? {} : { noDataValue }),
    samples: Object.freeze(samples),
  })
}

function uvTransform(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): UvwUvTransform {
  const item = record(value, path, state, depth)
  exactKeys(item, ['offset', 'scale', 'rotation'], ['offset', 'scale', 'rotation'], path)
  const scale = vec2(item['scale'], `${path}.scale`, state, depth + 1)
  if (scale.some(component => component === 0))
    fail('UV scale components must be non-zero', `${path}.scale`)
  return Object.freeze({
    offset: vec2(item['offset'], `${path}.offset`, state, depth + 1),
    scale,
    rotation: finite(item['rotation'], `${path}.rotation`, state, depth + 1),
  })
}

function terrainMaterialsLayer(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): UvwTerrainMaterialsLayer {
  const item = record(value, path, state, depth)
  exactKeys(
    item,
    [
      'schemaVersion',
      'id',
      'kind',
      'label',
      'columns',
      'rows',
      'cellSize',
      'origin',
      'materials',
      'samples',
      'weightRasters',
    ],
    ['schemaVersion', 'id', 'kind', 'columns', 'rows', 'cellSize', 'origin', 'materials'],
    path,
  )
  schemaVersionOne(item, path, state, depth + 1)
  literal(item['kind'], 'terrain-materials', `${path}.kind`, state, depth + 1)
  const id = layerId(item['id'], `${path}.id`, state, depth + 1)
  const label = labelOf(item, path, state, depth + 1)
  const columns = integerAtLeast(item['columns'], 2, `${path}.columns`, state, depth + 1)
  const rows = integerAtLeast(item['rows'], 2, `${path}.rows`, state, depth + 1)
  const materialValues = array(item['materials'], `${path}.materials`, state, depth + 1)
  if (materialValues.length === 0)
    fail('terrain materials layer must declare at least one material', `${path}.materials`)
  const materials = materialValues.map((entry, index): UvwTerrainMaterial => {
    const materialPath = `${path}.materials[${String(index)}]`
    const material = record(entry, materialPath, state, depth + 2)
    exactKeys(
      material,
      [
        'id',
        'label',
        'classification',
        'sourceIndex',
        'baseColorFactor',
        'baseColorResourceId',
        'normalResourceId',
        'specularResourceId',
        'uvTransform',
      ],
      ['id'],
      materialPath,
    )
    const baseColorFactor =
      material['baseColorFactor'] === undefined
        ? undefined
        : vec4(material['baseColorFactor'], `${materialPath}.baseColorFactor`, state, depth + 3)
    if (baseColorFactor?.some(component => component < 0 || component > 1))
      fail(
        'terrain material baseColorFactor components must lie in [0, 1]',
        `${materialPath}.baseColorFactor`,
      )
    const materialId = layerId(material['id'], `${materialPath}.id`, state, depth + 3)
    const sourceIndex =
      material['sourceIndex'] === undefined
        ? undefined
        : integerAtLeast(
            material['sourceIndex'],
            0,
            `${materialPath}.sourceIndex`,
            state,
            depth + 3,
          )
    const optionalId = (key: string): string | undefined =>
      material[key] === undefined
        ? undefined
        : layerId(material[key], `${materialPath}.${key}`, state, depth + 3)
    return Object.freeze({
      id: materialId,
      ...(material['label'] === undefined
        ? {}
        : { label: string(material['label'], `${materialPath}.label`, state, depth + 3) }),
      ...(material['classification'] === undefined
        ? {}
        : {
            classification: string(
              material['classification'],
              `${materialPath}.classification`,
              state,
              depth + 3,
            ),
          }),
      ...(sourceIndex === undefined ? {} : { sourceIndex }),
      ...(baseColorFactor === undefined ? {} : { baseColorFactor }),
      ...(optionalId('baseColorResourceId') === undefined
        ? {}
        : { baseColorResourceId: optionalId('baseColorResourceId')! }),
      ...(optionalId('normalResourceId') === undefined
        ? {}
        : { normalResourceId: optionalId('normalResourceId')! }),
      ...(optionalId('specularResourceId') === undefined
        ? {}
        : { specularResourceId: optionalId('specularResourceId')! }),
      ...(material['uvTransform'] === undefined
        ? {}
        : {
            uvTransform: uvTransform(
              material['uvTransform'],
              `${materialPath}.uvTransform`,
              state,
              depth + 3,
            ),
          }),
    })
  })
  const materialIds = new Set<string>()
  for (const material of materials) {
    if (materialIds.has(material.id))
      fail(`duplicate material id ${JSON.stringify(material.id)}`, `${path}.materials`)
    materialIds.add(material.id)
  }
  const samples =
    item['samples'] === undefined
      ? undefined
      : array(item['samples'], `${path}.samples`, state, depth + 1).map((rowValue, rowIndex) => {
          const rowPath = `${path}.samples[${String(rowIndex)}]`
          const cells = array(rowValue, rowPath, state, depth + 2)
          if (cells.length !== columns)
            fail(`expected ${String(columns)} material samples`, rowPath)
          return Object.freeze(
            cells.map((cellValue, columnIndex) => {
              const cellPath = `${rowPath}[${String(columnIndex)}]`
              const cell = record(cellValue, cellPath, state, depth + 3)
              exactKeys(cell, ['weights', 'uvTransform'], ['weights'], cellPath)
              const weights = array(cell['weights'], `${cellPath}.weights`, state, depth + 4)
              if (weights.length === 0)
                fail('material sample must contain at least one weight', cellPath)
              let total = 0
              const seen = new Set<string>()
              const parsed = weights.map((weightValue, weightIndex): UvwTerrainMaterialWeight => {
                const weightPath = `${cellPath}.weights[${String(weightIndex)}]`
                const weight = record(weightValue, weightPath, state, depth + 5)
                exactKeys(weight, ['materialId', 'weight'], ['materialId', 'weight'], weightPath)
                const materialId = layerId(
                  weight['materialId'],
                  `${weightPath}.materialId`,
                  state,
                  depth + 6,
                )
                if (!materialIds.has(materialId))
                  fail(
                    `unknown materialId ${JSON.stringify(materialId)}`,
                    `${weightPath}.materialId`,
                  )
                if (seen.has(materialId))
                  fail(`duplicate materialId ${JSON.stringify(materialId)} in sample`, cellPath)
                seen.add(materialId)
                const amount = finite(weight['weight'], `${weightPath}.weight`, state, depth + 6)
                if (amount <= 0 || amount > 1)
                  fail(
                    'material weight must be greater than zero and at most one',
                    `${weightPath}.weight`,
                  )
                total += amount
                return Object.freeze({ materialId, weight: amount })
              })
              if (Math.abs(total - 1) > 1e-6) fail('material weights must sum to one', cellPath)
              return Object.freeze({
                weights: Object.freeze(parsed),
                ...(cell['uvTransform'] === undefined
                  ? {}
                  : {
                      uvTransform: uvTransform(
                        cell['uvTransform'],
                        `${cellPath}.uvTransform`,
                        state,
                        depth + 4,
                      ),
                    }),
              })
            }),
          )
        })
  if (samples !== undefined) {
    if (samples.length !== rows)
      fail(`expected ${String(rows)} material sample rows`, `${path}.samples`)
    const count = columns * rows
    if (!Number.isSafeInteger(count) || count > state.maxSamples - state.samples)
      fail(
        `terrain material samples exceed maxSamples ${String(state.maxSamples)}`,
        `${path}.samples`,
        'x3.uv/uvw-budget-exceeded',
      )
    state.samples += count
  }
  const rasterValues =
    item['weightRasters'] === undefined
      ? undefined
      : array(item['weightRasters'], `${path}.weightRasters`, state, depth + 1)
  if (samples === undefined && (rasterValues === undefined || rasterValues.length === 0))
    fail('terrain materials layer must contain samples or weightRasters', path)
  if (rasterValues !== undefined && (rasterValues.length === 0 || rasterValues.length > 2))
    fail('terrain materials layer must contain one or two weight rasters', `${path}.weightRasters`)
  const rasterResourceIds = new Set<string>()
  const rasterMaterialIds = new Set<string>()
  const weightRasters = rasterValues?.map((rasterValue, rasterIndex): UvwTerrainWeightRaster => {
    const rasterPath = `${path}.weightRasters[${String(rasterIndex)}]`
    const raster = record(rasterValue, rasterPath, state, depth + 2)
    exactKeys(
      raster,
      ['resourceId', 'width', 'height', 'materialIds', 'encoding', 'normalization'],
      ['resourceId', 'width', 'height', 'materialIds', 'encoding', 'normalization'],
      rasterPath,
    )
    const resourceId = layerId(raster['resourceId'], `${rasterPath}.resourceId`, state, depth + 3)
    if (rasterResourceIds.has(resourceId))
      fail(
        `duplicate weight raster resource ${JSON.stringify(resourceId)}`,
        `${path}.weightRasters`,
      )
    rasterResourceIds.add(resourceId)
    const width = integerAtLeast(raster['width'], 1, `${rasterPath}.width`, state, depth + 3)
    const height = integerAtLeast(raster['height'], 1, `${rasterPath}.height`, state, depth + 3)
    const count = width * height
    if (!Number.isSafeInteger(count) || count > state.maxSamples - state.samples)
      fail(
        `terrain weight raster samples exceed maxSamples ${String(state.maxSamples)}`,
        rasterPath,
        'x3.uv/uvw-budget-exceeded',
      )
    state.samples += count
    const rasterMaterials = array(
      raster['materialIds'],
      `${rasterPath}.materialIds`,
      state,
      depth + 3,
    ).map((value, index) =>
      layerId(value, `${rasterPath}.materialIds[${String(index)}]`, state, depth + 4),
    )
    if (rasterMaterials.length === 0 || rasterMaterials.length > 4)
      fail('weight raster must declare one to four material channels', `${rasterPath}.materialIds`)
    for (const materialId of rasterMaterials) {
      if (!materialIds.has(materialId))
        fail(`unknown materialId ${JSON.stringify(materialId)}`, `${rasterPath}.materialIds`)
      if (rasterMaterialIds.has(materialId))
        fail(
          `duplicate materialId ${JSON.stringify(materialId)} across weight rasters`,
          `${path}.weightRasters`,
        )
      rasterMaterialIds.add(materialId)
    }
    literal(raster['encoding'], 'rgba8-unorm', `${rasterPath}.encoding`, state, depth + 3)
    literal(raster['normalization'], 'sum', `${rasterPath}.normalization`, state, depth + 3)
    return Object.freeze({
      resourceId,
      width,
      height,
      materialIds: Object.freeze(rasterMaterials),
      encoding: 'rgba8-unorm',
      normalization: 'sum',
    })
  })
  return Object.freeze({
    schemaVersion: 1,
    id,
    kind: 'terrain-materials',
    ...(label === undefined ? {} : { label }),
    columns,
    rows,
    cellSize: positive(item['cellSize'], `${path}.cellSize`, state, depth + 1),
    origin: vec3(item['origin'], `${path}.origin`, state, depth + 1),
    materials: Object.freeze(materials),
    ...(samples === undefined ? {} : { samples: Object.freeze(samples) }),
    ...(weightRasters === undefined ? {} : { weightRasters: Object.freeze(weightRasters) }),
  })
}

function numericGrid(
  value: unknown,
  columns: number,
  rows: number,
  path: string,
  state: ValidationBudget,
  depth: number,
  integer = false,
): readonly (readonly number[])[] {
  const rowValues = array(value, path, state, depth)
  if (rowValues.length !== rows) fail(`expected ${String(rows)} rows`, path)
  return Object.freeze(
    rowValues.map((rowValue, rowIndex) => {
      const rowPath = `${path}[${String(rowIndex)}]`
      const cells = array(rowValue, rowPath, state, depth + 1)
      if (cells.length !== columns) fail(`expected ${String(columns)} samples`, rowPath)
      return Object.freeze(
        cells.map((cell, columnIndex) =>
          integer
            ? integerAtLeast(cell, 0, `${rowPath}[${String(columnIndex)}]`, state, depth + 2)
            : finite(cell, `${rowPath}[${String(columnIndex)}]`, state, depth + 2),
        ),
      )
    }),
  )
}

function booleanGrid(
  value: unknown,
  columns: number,
  rows: number,
  path: string,
  state: ValidationBudget,
  depth: number,
): readonly (readonly boolean[])[] {
  const rowValues = array(value, path, state, depth)
  if (rowValues.length !== rows) fail(`expected ${String(rows)} rows`, path)
  return Object.freeze(
    rowValues.map((rowValue, rowIndex) => {
      const rowPath = `${path}[${String(rowIndex)}]`
      const cells = array(rowValue, rowPath, state, depth + 1)
      if (cells.length !== columns) fail(`expected ${String(columns)} samples`, rowPath)
      return Object.freeze(
        cells.map((cell, columnIndex) =>
          booleanValue(cell, `${rowPath}[${String(columnIndex)}]`, state, depth + 2),
        ),
      )
    }),
  )
}

function gridBudget(columns: number, rows: number, path: string, state: ValidationBudget): void {
  const count = columns * rows
  if (!Number.isSafeInteger(count) || count > state.maxSamples - state.samples) {
    fail(
      `grid samples exceed maxSamples ${String(state.maxSamples)}`,
      path,
      'x3.uv/uvw-budget-exceeded',
    )
  }
  state.samples += count
}

function cliffsLayer(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): UvwCliffsLayer {
  const item = record(value, path, state, depth)
  exactKeys(
    item,
    [
      'schemaVersion',
      'id',
      'kind',
      'label',
      'columns',
      'rows',
      'cellSize',
      'origin',
      'levels',
      'authored',
    ],
    ['schemaVersion', 'id', 'kind', 'columns', 'rows', 'cellSize', 'origin', 'levels', 'authored'],
    path,
  )
  schemaVersionOne(item, path, state, depth + 1)
  literal(item['kind'], 'cliffs', `${path}.kind`, state, depth + 1)
  const columns = integerAtLeast(item['columns'], 2, `${path}.columns`, state, depth + 1)
  const rows = integerAtLeast(item['rows'], 2, `${path}.rows`, state, depth + 1)
  gridBudget(columns, rows, `${path}.levels`, state)
  const label = labelOf(item, path, state, depth + 1)
  return Object.freeze({
    schemaVersion: 1,
    id: layerId(item['id'], `${path}.id`, state, depth + 1),
    kind: 'cliffs',
    ...(label === undefined ? {} : { label }),
    columns,
    rows,
    cellSize: positive(item['cellSize'], `${path}.cellSize`, state, depth + 1),
    origin: vec3(item['origin'], `${path}.origin`, state, depth + 1),
    levels: numericGrid(item['levels'], columns, rows, `${path}.levels`, state, depth + 1, true),
    authored: booleanGrid(item['authored'], columns, rows, `${path}.authored`, state, depth + 1),
  })
}

function waterLayer(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): UvwWaterLayer {
  const item = record(value, path, state, depth)
  exactKeys(
    item,
    ['schemaVersion', 'id', 'kind', 'label', 'materials', 'zones'],
    ['schemaVersion', 'id', 'kind', 'zones'],
    path,
  )
  schemaVersionOne(item, path, state, depth + 1)
  literal(item['kind'], 'water', `${path}.kind`, state, depth + 1)
  const materials =
    item['materials'] === undefined
      ? undefined
      : array(item['materials'], `${path}.materials`, state, depth + 1).map(
          (entry, index): UvwWaterMaterial => {
            const materialPath = `${path}.materials[${String(index)}]`
            const material = record(entry, materialPath, state, depth + 2)
            exactKeys(
              material,
              [
                'id',
                'label',
                'classification',
                'shorelineMode',
                'color',
                'baseColorResourceId',
                'secondaryColorResourceId',
                'uvScale',
                'scroll',
                'colorFalloff',
                'specularity',
                'specularScale',
                'reflectivityPower',
                'causticsResourceId',
                'causticsScale',
                'causticsFramesPerSecond',
                'receiveShadows',
              ],
              ['id', 'color'],
              materialPath,
            )
            const color = vec4(material['color'], `${materialPath}.color`, state, depth + 3)
            if (color.some(component => component < 0 || component > 1))
              fail('water material color components must be in 0..1', `${materialPath}.color`)
            const classification = material['classification']
            if (
              classification !== undefined &&
              classification !== 'water' &&
              classification !== 'lava'
            )
              fail(
                'water material classification must be water or lava',
                `${materialPath}.classification`,
              )
            const shorelineMode = material['shorelineMode']
            if (
              shorelineMode !== undefined &&
              shorelineMode !== 'terrain-clipped' &&
              shorelineMode !== 'zone'
            )
              fail(
                'water material shorelineMode must be terrain-clipped or zone',
                `${materialPath}.shorelineMode`,
              )
            const nonnegative = (key: string) => {
              if (material[key] === undefined) return undefined
              const result = finite(material[key], `${materialPath}.${key}`, state, depth + 3)
              if (result < 0)
                fail(`water material ${key} must be nonnegative`, `${materialPath}.${key}`)
              return result
            }
            const positiveValue = (key: string) => {
              const result = nonnegative(key)
              if (result !== undefined && result === 0)
                fail(`water material ${key} must be positive`, `${materialPath}.${key}`)
              return result
            }
            const uvScale =
              material['uvScale'] === undefined
                ? undefined
                : vec4(material['uvScale'], `${materialPath}.uvScale`, state, depth + 3)
            if (uvScale?.some(component => component === 0))
              fail('water material uvScale components must be non-zero', `${materialPath}.uvScale`)
            const causticsScale =
              material['causticsScale'] === undefined
                ? undefined
                : vec2(material['causticsScale'], `${materialPath}.causticsScale`, state, depth + 3)
            if (causticsScale?.some(component => component === 0))
              fail(
                'water material causticsScale components must be non-zero',
                `${materialPath}.causticsScale`,
              )
            const label = labelOf(material, materialPath, state, depth + 3)
            const colorFalloff = nonnegative('colorFalloff')
            const specularity = nonnegative('specularity')
            const specularScale = nonnegative('specularScale')
            const reflectivityPower = positiveValue('reflectivityPower')
            const causticsFramesPerSecond = nonnegative('causticsFramesPerSecond')
            return Object.freeze({
              id: layerId(material['id'], `${materialPath}.id`, state, depth + 3),
              ...(label === undefined ? {} : { label }),
              ...(classification === undefined ? {} : { classification }),
              ...(shorelineMode === undefined ? {} : { shorelineMode }),
              color,
              ...(material['baseColorResourceId'] === undefined
                ? {}
                : {
                    baseColorResourceId: layerId(
                      material['baseColorResourceId'],
                      `${materialPath}.baseColorResourceId`,
                      state,
                      depth + 3,
                    ),
                  }),
              ...(material['secondaryColorResourceId'] === undefined
                ? {}
                : {
                    secondaryColorResourceId: layerId(
                      material['secondaryColorResourceId'],
                      `${materialPath}.secondaryColorResourceId`,
                      state,
                      depth + 3,
                    ),
                  }),
              ...(uvScale === undefined ? {} : { uvScale }),
              ...(material['scroll'] === undefined
                ? {}
                : { scroll: vec4(material['scroll'], `${materialPath}.scroll`, state, depth + 3) }),
              ...(colorFalloff === undefined ? {} : { colorFalloff }),
              ...(specularity === undefined ? {} : { specularity }),
              ...(specularScale === undefined ? {} : { specularScale }),
              ...(reflectivityPower === undefined ? {} : { reflectivityPower }),
              ...(material['causticsResourceId'] === undefined
                ? {}
                : {
                    causticsResourceId: layerId(
                      material['causticsResourceId'],
                      `${materialPath}.causticsResourceId`,
                      state,
                      depth + 3,
                    ),
                  }),
              ...(causticsScale === undefined ? {} : { causticsScale }),
              ...(causticsFramesPerSecond === undefined ? {} : { causticsFramesPerSecond }),
              ...(material['receiveShadows'] === undefined
                ? {}
                : {
                    receiveShadows: booleanValue(
                      material['receiveShadows'],
                      `${materialPath}.receiveShadows`,
                      state,
                      depth + 3,
                    ),
                  }),
            })
          },
        )
  const zones = array(item['zones'], `${path}.zones`, state, depth + 1).map(
    (entry, index): UvwWaterZone => {
      const zonePath = `${path}.zones[${String(index)}]`
      const zone = record(entry, zonePath, state, depth + 2)
      exactKeys(
        zone,
        ['id', 'minimum', 'maximum', 'elevation', 'materialId'],
        ['id', 'minimum', 'maximum', 'elevation'],
        zonePath,
      )
      const minimum = vec2(zone['minimum'], `${zonePath}.minimum`, state, depth + 3)
      const maximum = vec2(zone['maximum'], `${zonePath}.maximum`, state, depth + 3)
      if (minimum[0] > maximum[0] || minimum[1] > maximum[1])
        fail('water bounds minimum exceeds maximum', zonePath)
      return Object.freeze({
        id: layerId(zone['id'], `${zonePath}.id`, state, depth + 3),
        minimum,
        maximum,
        elevation: finite(zone['elevation'], `${zonePath}.elevation`, state, depth + 3),
        ...(zone['materialId'] === undefined
          ? {}
          : {
              materialId: layerId(zone['materialId'], `${zonePath}.materialId`, state, depth + 3),
            }),
      })
    },
  )
  const zoneIds = new Set<string>()
  for (const zone of zones) {
    if (zoneIds.has(zone.id))
      fail(`duplicate water zone id ${JSON.stringify(zone.id)}`, `${path}.zones`)
    zoneIds.add(zone.id)
  }
  if (materials !== undefined) {
    const materialIds = new Set<string>()
    for (const material of materials) {
      if (materialIds.has(material.id))
        fail(`duplicate water material id ${JSON.stringify(material.id)}`, `${path}.materials`)
      materialIds.add(material.id)
    }
  }
  const label = labelOf(item, path, state, depth + 1)
  return Object.freeze({
    schemaVersion: 1,
    id: layerId(item['id'], `${path}.id`, state, depth + 1),
    kind: 'water',
    ...(label === undefined ? {} : { label }),
    ...(materials === undefined ? {} : { materials: Object.freeze(materials) }),
    zones: Object.freeze(zones),
  })
}

const OBJECT_KINDS = new Set<UvwObjectKind>([
  'unit',
  'structure',
  'feature',
  'doodad',
  'point',
  'camera',
])

function objectsLayer(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): UvwObjectsLayer {
  const item = record(value, path, state, depth)
  exactKeys(
    item,
    ['schemaVersion', 'id', 'kind', 'label', 'instances'],
    ['schemaVersion', 'id', 'kind', 'instances'],
    path,
  )
  schemaVersionOne(item, path, state, depth + 1)
  literal(item['kind'], 'objects', `${path}.kind`, state, depth + 1)
  const instances = array(item['instances'], `${path}.instances`, state, depth + 1).map(
    (entry, index): UvwObjectInstance => {
      const instancePath = `${path}.instances[${String(index)}]`
      const instance = record(entry, instancePath, state, depth + 2)
      exactKeys(
        instance,
        [
          'id',
          'objectKind',
          'position',
          'rotation',
          'scale',
          'resourceIds',
          'modelComponents',
          'typeId',
          'player',
          'variation',
          'name',
          'presentationTint',
          'presentationAnimation',
        ],
        ['id', 'objectKind', 'position', 'rotation', 'scale', 'resourceIds'],
        instancePath,
      )
      const objectKind = string(
        instance['objectKind'],
        `${instancePath}.objectKind`,
        state,
        depth + 3,
      ) as UvwObjectKind
      if (!OBJECT_KINDS.has(objectKind))
        fail(`unsupported object kind ${JSON.stringify(objectKind)}`, `${instancePath}.objectKind`)
      const rotation = vec4(instance['rotation'], `${instancePath}.rotation`, state, depth + 3)
      const magnitude = Math.hypot(...rotation)
      if (Math.abs(magnitude - 1) > 1e-6)
        fail('object rotation quaternion must have unit length', `${instancePath}.rotation`)
      const scale = vec3(instance['scale'], `${instancePath}.scale`, state, depth + 3)
      if (scale.some(component => component === 0))
        fail('object scale components must be non-zero', `${instancePath}.scale`)
      const resourceIds = array(
        instance['resourceIds'],
        `${instancePath}.resourceIds`,
        state,
        depth + 3,
      ).map((resourceId, resourceIndex) =>
        layerId(
          resourceId,
          `${instancePath}.resourceIds[${String(resourceIndex)}]`,
          state,
          depth + 4,
        ),
      )
      if (new Set(resourceIds).size !== resourceIds.length)
        fail('object resourceIds must be unique', `${instancePath}.resourceIds`)
      const modelComponents =
        instance['modelComponents'] === undefined
          ? undefined
          : array(
              instance['modelComponents'],
              `${instancePath}.modelComponents`,
              state,
              depth + 3,
            ).map((entry, componentIndex): MapModelComponentPlacement => {
              const componentPath = `${instancePath}.modelComponents[${String(componentIndex)}]`
              const component = record(entry, componentPath, state, depth + 4)
              exactKeys(
                component,
                ['id', 'resourceId', 'parentId', 'parentSocketId', 'rotation'],
                ['id', 'resourceId'],
                componentPath,
              )
              const parentId =
                component['parentId'] === undefined
                  ? undefined
                  : layerId(component['parentId'], `${componentPath}.parentId`, state, depth + 5)
              const parentSocketId =
                component['parentSocketId'] === undefined
                  ? undefined
                  : layerId(
                      component['parentSocketId'],
                      `${componentPath}.parentSocketId`,
                      state,
                      depth + 5,
                    )
              if ((parentId === undefined) !== (parentSocketId === undefined))
                fail(
                  'model component parentId and parentSocketId must be present together',
                  componentPath,
                )
              const componentRotation =
                component['rotation'] === undefined
                  ? undefined
                  : vec4(component['rotation'], `${componentPath}.rotation`, state, depth + 5)
              if (
                componentRotation !== undefined &&
                Math.abs(Math.hypot(...componentRotation) - 1) > 1e-6
              ) {
                fail(
                  'model component rotation quaternion must have unit length',
                  `${componentPath}.rotation`,
                )
              }
              return Object.freeze({
                id: layerId(component['id'], `${componentPath}.id`, state, depth + 5),
                resourceId: layerId(
                  component['resourceId'],
                  `${componentPath}.resourceId`,
                  state,
                  depth + 5,
                ),
                ...(parentId === undefined ? {} : { parentId, parentSocketId: parentSocketId! }),
                ...(componentRotation === undefined ? {} : { rotation: componentRotation }),
              })
            })
      if (modelComponents !== undefined) {
        const byId = new Map<string, MapModelComponentPlacement>()
        for (const component of modelComponents) {
          if (byId.has(component.id))
            fail(
              `duplicate model component id ${JSON.stringify(component.id)}`,
              `${instancePath}.modelComponents`,
            )
          if (!resourceIds.includes(component.resourceId))
            fail(
              `model component references absent resource ${JSON.stringify(component.resourceId)}`,
              `${instancePath}.modelComponents`,
            )
          byId.set(component.id, component)
        }
        for (const component of modelComponents) {
          if (component.parentId !== undefined && !byId.has(component.parentId))
            fail(
              `model component references absent parent ${JSON.stringify(component.parentId)}`,
              `${instancePath}.modelComponents`,
            )
          const seen = new Set<string>()
          let current: MapModelComponentPlacement | undefined = component
          while (current?.parentId !== undefined) {
            if (seen.has(current.id))
              fail(
                'model component attachment graph must be acyclic',
                `${instancePath}.modelComponents`,
              )
            seen.add(current.id)
            current = byId.get(current.parentId)
          }
        }
      }
      const optionalString = (key: string): string | undefined =>
        instance[key] === undefined
          ? undefined
          : string(instance[key], `${instancePath}.${key}`, state, depth + 3)
      const optionalInteger = (key: string): number | undefined =>
        instance[key] === undefined
          ? undefined
          : key === 'player'
            ? safeInteger(instance[key], `${instancePath}.${key}`, state, depth + 3)
            : integerAtLeast(instance[key], 0, `${instancePath}.${key}`, state, depth + 3)
      const tintPath = `${instancePath}.presentationTint`
      const presentationTint =
        instance['presentationTint'] === undefined
          ? undefined
          : vec3(instance['presentationTint'], tintPath, state, depth + 3)
      if (presentationTint?.some(factor => factor < 0 || factor > 1))
        fail('presentation tint factors must lie in 0..1', tintPath)
      const presentationAnimation =
        instance['presentationAnimation'] === undefined
          ? undefined
          : presentationAnimationOf(
              instance['presentationAnimation'],
              `${instancePath}.presentationAnimation`,
              state,
              depth + 3,
            )
      return Object.freeze({
        id: layerId(instance['id'], `${instancePath}.id`, state, depth + 3),
        objectKind,
        position: vec3(instance['position'], `${instancePath}.position`, state, depth + 3),
        rotation,
        scale,
        resourceIds: Object.freeze(resourceIds),
        ...(modelComponents === undefined
          ? {}
          : { modelComponents: Object.freeze(modelComponents) }),
        ...(optionalString('typeId') === undefined ? {} : { typeId: optionalString('typeId')! }),
        ...(optionalInteger('player') === undefined ? {} : { player: optionalInteger('player')! }),
        ...(optionalInteger('variation') === undefined
          ? {}
          : { variation: optionalInteger('variation')! }),
        ...(optionalString('name') === undefined ? {} : { name: optionalString('name')! }),
        ...(presentationTint === undefined ? {} : { presentationTint }),
        ...(presentationAnimation === undefined ? {} : { presentationAnimation }),
      })
    },
  )
  const ids = new Set<string>()
  for (const instance of instances) {
    if (ids.has(instance.id))
      fail(`duplicate object instance id ${JSON.stringify(instance.id)}`, `${path}.instances`)
    ids.add(instance.id)
  }
  const label = labelOf(item, path, state, depth + 1)
  return Object.freeze({
    schemaVersion: 1,
    id: layerId(item['id'], `${path}.id`, state, depth + 1),
    kind: 'objects',
    ...(label === undefined ? {} : { label }),
    instances: Object.freeze(instances),
  })
}

function resourcesLayer(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): UvwResourcesLayer {
  const item = record(value, path, state, depth)
  exactKeys(
    item,
    ['schemaVersion', 'id', 'kind', 'label', 'resources'],
    ['schemaVersion', 'id', 'kind', 'resources'],
    path,
  )
  schemaVersionOne(item, path, state, depth + 1)
  literal(item['kind'], 'resources', `${path}.kind`, state, depth + 1)
  const resources = array(item['resources'], `${path}.resources`, state, depth + 1).map(
    (entry, index): UvwResource => {
      const resourcePath = `${path}.resources[${String(index)}]`
      const resource = record(entry, resourcePath, state, depth + 2)
      exactKeys(resource, ['id', 'kind', 'uri', 'digest'], ['id', 'kind', 'uri'], resourcePath)
      const kind = string(resource['kind'], `${resourcePath}.kind`, state, depth + 3)
      if (kind !== 'uvm' && kind !== 'media')
        fail('resource kind must be "uvm" or "media"', `${resourcePath}.kind`)
      const uri = string(resource['uri'], `${resourcePath}.uri`, state, depth + 3)
      if (
        uri.length === 0 ||
        uri.includes('\\') ||
        uri.startsWith('/') ||
        /^[a-z]+:/iu.test(uri) ||
        uri.split('/').includes('..')
      ) {
        fail('resource uri must be a non-empty confined relative path', `${resourcePath}.uri`)
      }
      const digest =
        resource['digest'] === undefined
          ? undefined
          : string(resource['digest'], `${resourcePath}.digest`, state, depth + 3)
      if (digest !== undefined && !/^sha256:[0-9a-f]{64}$/u.test(digest))
        fail('resource digest must be lowercase sha256', `${resourcePath}.digest`)
      return Object.freeze({
        id: layerId(resource['id'], `${resourcePath}.id`, state, depth + 3),
        kind,
        uri,
        ...(digest === undefined ? {} : { digest: digest as `sha256:${string}` }),
      })
    },
  )
  const ids = new Set<string>()
  for (const resource of resources) {
    if (ids.has(resource.id))
      fail(`duplicate resource id ${JSON.stringify(resource.id)}`, `${path}.resources`)
    ids.add(resource.id)
  }
  const label = labelOf(item, path, state, depth + 1)
  return Object.freeze({
    schemaVersion: 1,
    id: layerId(item['id'], `${path}.id`, state, depth + 1),
    kind: 'resources',
    ...(label === undefined ? {} : { label }),
    resources: Object.freeze(resources),
  })
}

function regionShape(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): UvwRegionShape {
  const item = record(value, path, state, depth)
  const kind = string(item['kind'], `${path}.kind`, state, depth + 1)
  if (kind === 'circle') {
    exactKeys(item, ['kind', 'center', 'radius'], ['kind', 'center', 'radius'], path)
    return Object.freeze({
      kind,
      center: vec2(item['center'], `${path}.center`, state, depth + 1),
      radius: positive(item['radius'], `${path}.radius`, state, depth + 1),
    })
  }
  if (kind === 'rectangle') {
    exactKeys(item, ['kind', 'minimum', 'maximum'], ['kind', 'minimum', 'maximum'], path)
    const minimum = vec2(item['minimum'], `${path}.minimum`, state, depth + 1)
    const maximum = vec2(item['maximum'], `${path}.maximum`, state, depth + 1)
    if (minimum[0] > maximum[0] || minimum[1] > maximum[1])
      fail('region rectangle minimum exceeds maximum', path)
    return Object.freeze({ kind, minimum, maximum })
  }
  if (kind === 'polygon') {
    exactKeys(item, ['kind', 'points'], ['kind', 'points'], path)
    const points = array(item['points'], `${path}.points`, state, depth + 1).map((point, index) =>
      vec2(point, `${path}.points[${String(index)}]`, state, depth + 2),
    )
    if (points.length < 3) fail('region polygon requires at least three points', `${path}.points`)
    return Object.freeze({ kind, points: Object.freeze(points) })
  }
  fail(`unsupported region shape ${JSON.stringify(kind)}`, `${path}.kind`)
}

function regionsLayer(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): UvwRegionsLayer {
  const item = record(value, path, state, depth)
  exactKeys(
    item,
    ['schemaVersion', 'id', 'kind', 'label', 'regions'],
    ['schemaVersion', 'id', 'kind', 'regions'],
    path,
  )
  schemaVersionOne(item, path, state, depth + 1)
  literal(item['kind'], 'regions', `${path}.kind`, state, depth + 1)
  const regions = array(item['regions'], `${path}.regions`, state, depth + 1).map(
    (entry, index): UvwRegion => {
      const regionPath = `${path}.regions[${String(index)}]`
      const region = record(entry, regionPath, state, depth + 2)
      exactKeys(region, ['id', 'name', 'color', 'shapes'], ['id', 'name', 'shapes'], regionPath)
      const shapes = array(region['shapes'], `${regionPath}.shapes`, state, depth + 3).map(
        (shape, shapeIndex) =>
          regionShape(shape, `${regionPath}.shapes[${String(shapeIndex)}]`, state, depth + 4),
      )
      return Object.freeze({
        id: layerId(region['id'], `${regionPath}.id`, state, depth + 3),
        name: string(region['name'], `${regionPath}.name`, state, depth + 3),
        ...(region['color'] === undefined
          ? {}
          : { color: string(region['color'], `${regionPath}.color`, state, depth + 3) }),
        shapes: Object.freeze(shapes),
      })
    },
  )
  const ids = new Set<string>()
  for (const region of regions) {
    if (ids.has(region.id))
      fail(`duplicate region id ${JSON.stringify(region.id)}`, `${path}.regions`)
    ids.add(region.id)
  }
  const label = labelOf(item, path, state, depth + 1)
  return Object.freeze({
    schemaVersion: 1,
    id: layerId(item['id'], `${path}.id`, state, depth + 1),
    kind: 'regions',
    ...(label === undefined ? {} : { label }),
    regions: Object.freeze(regions),
  })
}

function navigationLayer(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): UvwNavigationLayer {
  const item = record(value, path, state, depth)
  exactKeys(
    item,
    ['schemaVersion', 'id', 'kind', 'label', 'columns', 'rows', 'cellSize', 'origin', 'samples'],
    ['schemaVersion', 'id', 'kind', 'columns', 'rows', 'cellSize', 'origin', 'samples'],
    path,
  )
  schemaVersionOne(item, path, state, depth + 1)
  literal(item['kind'], 'navigation', `${path}.kind`, state, depth + 1)
  const columns = integerAtLeast(item['columns'], 1, `${path}.columns`, state, depth + 1)
  const rows = integerAtLeast(item['rows'], 1, `${path}.rows`, state, depth + 1)
  gridBudget(columns, rows, `${path}.samples`, state)
  const label = labelOf(item, path, state, depth + 1)
  return Object.freeze({
    schemaVersion: 1,
    id: layerId(item['id'], `${path}.id`, state, depth + 1),
    kind: 'navigation',
    ...(label === undefined ? {} : { label }),
    columns,
    rows,
    cellSize: positive(item['cellSize'], `${path}.cellSize`, state, depth + 1),
    origin: vec3(item['origin'], `${path}.origin`, state, depth + 1),
    samples: numericGrid(item['samples'], columns, rows, `${path}.samples`, state, depth + 1, true),
  })
}

function gatewaysLayer(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): UvwGatewaysLayer {
  const item = record(value, path, state, depth)
  exactKeys(
    item,
    ['schemaVersion', 'id', 'kind', 'label', 'segments'],
    ['schemaVersion', 'id', 'kind', 'segments'],
    path,
  )
  schemaVersionOne(item, path, state, depth + 1)
  literal(item['kind'], 'gateways', `${path}.kind`, state, depth + 1)
  const segments = array(item['segments'], `${path}.segments`, state, depth + 1).map(
    (entry, index): UvwGatewaySegment => {
      const segmentPath = `${path}.segments[${String(index)}]`
      const segment = record(entry, segmentPath, state, depth + 2)
      exactKeys(segment, ['id', 'start', 'end'], ['id', 'start', 'end'], segmentPath)
      return Object.freeze({
        id: layerId(segment['id'], `${segmentPath}.id`, state, depth + 3),
        start: vec2(segment['start'], `${segmentPath}.start`, state, depth + 3),
        end: vec2(segment['end'], `${segmentPath}.end`, state, depth + 3),
      })
    },
  )
  const ids = new Set<string>()
  for (const segment of segments) {
    if (ids.has(segment.id))
      fail(`duplicate gateway segment id ${JSON.stringify(segment.id)}`, `${path}.segments`)
    ids.add(segment.id)
  }
  const label = labelOf(item, path, state, depth + 1)
  return Object.freeze({
    schemaVersion: 1,
    id: layerId(item['id'], `${path}.id`, state, depth + 1),
    kind: 'gateways',
    ...(label === undefined ? {} : { label }),
    segments: Object.freeze(segments),
  })
}

function lightingLayer(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): UvwLightingLayer {
  const item = record(value, path, state, depth)
  exactKeys(
    item,
    ['schemaVersion', 'id', 'kind', 'label', 'ambientColor', 'ambientIntensity', 'directional', 'toneMapping', 'terrain'],
    ['schemaVersion', 'id', 'kind', 'ambientColor', 'ambientIntensity', 'directional'],
    path,
  )
  schemaVersionOne(item, path, state, depth + 1)
  literal(item['kind'], 'lighting', `${path}.kind`, state, depth + 1)
  const ambientColor = vec3(item['ambientColor'], `${path}.ambientColor`, state, depth + 1)
  if (ambientColor.some(component => component < 0 || component > 1))
    fail('ambientColor components must be between zero and one', `${path}.ambientColor`)
  const directional = array(item['directional'], `${path}.directional`, state, depth + 1).map(
    (entry, index): UvwDirectionalLight => {
      const lightPath = `${path}.directional[${String(index)}]`
      const light = record(entry, lightPath, state, depth + 2)
      exactKeys(
        light,
        ['id', 'direction', 'color', 'intensity', 'specularColor', 'specularIntensity', 'useAmbientOcclusion'],
        ['id', 'direction', 'color', 'intensity'],
        lightPath,
      )
      const direction = vec3(light['direction'], `${lightPath}.direction`, state, depth + 3)
      if (Math.hypot(...direction) === 0)
        fail('directional light direction must be non-zero', `${lightPath}.direction`)
      const color = vec3(light['color'], `${lightPath}.color`, state, depth + 3)
      if (color.some(component => component < 0 || component > 1))
        fail('light color components must be between zero and one', `${lightPath}.color`)
      return Object.freeze({
        id: layerId(light['id'], `${lightPath}.id`, state, depth + 3),
        direction,
        color,
        intensity: positive(light['intensity'], `${lightPath}.intensity`, state, depth + 3),
        ...(light['specularColor'] === undefined ? {} : { specularColor: vec3(light['specularColor'], `${lightPath}.specularColor`, state, depth + 3) }),
        ...(light['specularIntensity'] === undefined ? {} : { specularIntensity: finite(light['specularIntensity'], `${lightPath}.specularIntensity`, state, depth + 3) }),
        ...(light['useAmbientOcclusion'] === undefined ? {} : { useAmbientOcclusion: booleanValue(light['useAmbientOcclusion'], `${lightPath}.useAmbientOcclusion`, state, depth + 3) }),
      })
    },
  )
  const lightIds = new Set<string>()
  for (const light of directional) {
    if (lightIds.has(light.id))
      fail(`duplicate directional light id ${JSON.stringify(light.id)}`, `${path}.directional`)
    lightIds.add(light.id)
  }
  const ambientIntensity = finite(
    item['ambientIntensity'],
    `${path}.ambientIntensity`,
    state,
    depth + 1,
  )
  if (ambientIntensity < 0)
    fail('ambientIntensity must be non-negative', `${path}.ambientIntensity`)
  const label = labelOf(item, path, state, depth + 1)
  return Object.freeze({
    schemaVersion: 1,
    id: layerId(item['id'], `${path}.id`, state, depth + 1),
    kind: 'lighting',
    ...(label === undefined ? {} : { label }),
    ambientColor,
    ambientIntensity,
    directional: Object.freeze(directional),
    ...(item['toneMapping'] === undefined ? {} : { toneMapping: toneMappingSettings(item['toneMapping'], `${path}.toneMapping`, state, depth + 1) }),
    ...(item['terrain'] === undefined ? {} : { terrain: numericSettings(item['terrain'], ['specularExponent', 'diffuseMultiplier', 'specularMultiplier'] as const, `${path}.terrain`, state, depth + 1) }),
  })
}

function numericSettings<const K extends readonly string[]>(value: unknown, keys: K, path: string, state: ValidationBudget, depth: number): { readonly [P in K[number]]: number } {
  const fields = record(value, path, state, depth)
  exactKeys(fields, [...keys], [...keys], path)
  return Object.freeze(Object.fromEntries(keys.map(key => [key, finite(fields[key], `${path}.${key}`, state, depth + 1)]))) as { readonly [P in K[number]]: number }
}

function toneMappingSettings(value: unknown, path: string, state: ValidationBudget, depth: number): WorldToneMapping {
  const fields = record(value, path, state, depth)
  exactKeys(fields, ['operator', 'exposure', 'whitePoint', 'contrast', 'colorization', 'correctGamma', 'ambientOcclusion'], ['operator', 'exposure', 'whitePoint', 'contrast'], path)
  const operator = string(fields['operator'], `${path}.operator`, state, depth + 1)
  if (!['reinhard', 'exponential', 'logarithmic', 'linear', 'filmic'].includes(operator)) fail('unsupported tone map operator', `${path}.operator`)
  return Object.freeze({
    operator: operator as WorldToneMapping['operator'],
    exposure: positive(fields['exposure'], `${path}.exposure`, state, depth + 1),
    whitePoint: positive(fields['whitePoint'], `${path}.whitePoint`, state, depth + 1),
    contrast: positive(fields['contrast'], `${path}.contrast`, state, depth + 1),
    ...(fields['correctGamma'] === undefined ? {} : { correctGamma: booleanValue(fields['correctGamma'], `${path}.correctGamma`, state, depth + 1) }),
    ...(fields['colorization'] === undefined ? {} : { colorization: numericSettings(fields['colorization'], ['inputLow', 'inputHigh', 'inputGamma', 'outputLow', 'outputHigh', 'brightness', 'contrast', 'hue', 'saturation', 'lightness', 'blend'] as const, `${path}.colorization`, state, depth + 1) }),
    ...(fields['ambientOcclusion'] === undefined ? {} : { ambientOcclusion: numericSettings(fields['ambientOcclusion'], ['radius', 'noOcclusion', 'fullOcclusion', 'power'] as const, `${path}.ambientOcclusion`, state, depth + 1) }),
  })
}

function layer(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): UvwHeightfieldSpaceLayer {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail('expected an object', path)
  const kind = (value as Record<string, unknown>)['kind']
  if (typeof kind !== 'string') fail('expected a string', `${path}.kind`)
  switch (kind) {
    case 'heightfield':
      return heightfieldLayer(value, path, state, depth)
    case 'terrain-materials':
      return terrainMaterialsLayer(value, path, state, depth)
    case 'cliffs':
      return cliffsLayer(value, path, state, depth)
    case 'water':
      return waterLayer(value, path, state, depth)
    case 'objects':
      return objectsLayer(value, path, state, depth)
    case 'resources':
      return resourcesLayer(value, path, state, depth)
    case 'regions':
      return regionsLayer(value, path, state, depth)
    case 'navigation':
      return navigationLayer(value, path, state, depth)
    case 'gateways':
      return gatewaysLayer(value, path, state, depth)
    case 'lighting':
      return lightingLayer(value, path, state, depth)
    default:
      fail(
        `layer kind ${JSON.stringify(kind)} is reserved but unsupported by UVW 1.0`,
        `${path}.kind`,
        'x3.uv/uvw-feature-unsupported',
      )
  }
}

function space(
  value: unknown,
  path: string,
  state: ValidationBudget,
  depth: number,
): UvwHeightfieldSpace {
  const item = record(value, path, state, depth)
  const topology = string(item['topology'], `${path}.topology`, state, depth + 1)
  if (topology !== 'heightfield')
    fail(
      `space topology ${JSON.stringify(topology)} is reserved but unsupported by UVW 1.0`,
      `${path}.topology`,
      'x3.uv/uvw-feature-unsupported',
    )
  exactKeys(
    item,
    ['id', 'topology', 'label', 'basis', 'bounds', 'layers'],
    ['id', 'topology', 'basis', 'bounds', 'layers'],
    path,
  )
  const id = string(item['id'], `${path}.id`, state, depth + 1)
  if (!ID_PATTERN.test(id)) fail('space id must match ^[a-z][a-z0-9-]*$', `${path}.id`)
  const label =
    item['label'] === undefined
      ? undefined
      : string(item['label'], `${path}.label`, state, depth + 1)
  const layerValues = array(item['layers'], `${path}.layers`, state, depth + 1)
  if (layerValues.length === 0) fail('space must contain at least one layer', `${path}.layers`)
  const layers = layerValues.map((entry, index) =>
    layer(entry, `${path}.layers[${String(index)}]`, state, depth + 2),
  )
  const ids = new Set<string>()
  for (const entry of layers) {
    if (ids.has(entry.id)) fail(`duplicate layer id ${JSON.stringify(entry.id)}`, `${path}.layers`)
    ids.add(entry.id)
  }
  if (!layers.some(entry => entry.kind === 'heightfield')) {
    fail('heightfield space must contain at least one heightfield layer', `${path}.layers`)
  }
  const resourceIds = new Set(
    layers.flatMap(entry =>
      entry.kind === 'resources' ? entry.resources.map(resource => resource.id) : [],
    ),
  )
  const materialIds = new Set(
    layers.flatMap(entry =>
      entry.kind === 'terrain-materials' ? entry.materials.map(material => material.id) : [],
    ),
  )
  for (const entry of layers) {
    if (entry.kind === 'objects') {
      for (const instance of entry.instances) {
        for (const resourceId of instance.resourceIds) {
          if (!resourceIds.has(resourceId))
            fail(
              `object references unknown resource ${JSON.stringify(resourceId)}`,
              `${path}.layers.${entry.id}.instances.${instance.id}.resourceIds`,
            )
        }
      }
    } else if (entry.kind === 'terrain-materials') {
      for (const material of entry.materials) {
        for (const resourceId of [
          material.baseColorResourceId,
          material.normalResourceId,
          material.specularResourceId,
        ]) {
          if (resourceId !== undefined && !resourceIds.has(resourceId)) {
            fail(
              `material references unknown resource ${JSON.stringify(resourceId)}`,
              `${path}.layers.${entry.id}.materials.${material.id}`,
            )
          }
        }
      }
      for (const raster of entry.weightRasters ?? []) {
        if (!resourceIds.has(raster.resourceId))
          fail(
            `weight raster references unknown resource ${JSON.stringify(raster.resourceId)}`,
            `${path}.layers.${entry.id}.weightRasters`,
          )
      }
    } else if (entry.kind === 'water') {
      const waterMaterialIds = new Set(entry.materials?.map(material => material.id) ?? [])
      for (const material of entry.materials ?? []) {
        for (const resourceId of [
          material.baseColorResourceId,
          material.secondaryColorResourceId,
          material.causticsResourceId,
        ]) {
          if (resourceId !== undefined && !resourceIds.has(resourceId))
            fail(
              `water material references unknown resource ${JSON.stringify(resourceId)}`,
              `${path}.layers.${entry.id}.materials.${material.id}`,
            )
        }
      }
      for (const zone of entry.zones) {
        if (
          zone.materialId !== undefined &&
          !waterMaterialIds.has(zone.materialId) &&
          !materialIds.has(zone.materialId) &&
          !resourceIds.has(zone.materialId)
        ) {
          fail(
            `water zone references unknown material ${JSON.stringify(zone.materialId)}`,
            `${path}.layers.${entry.id}.zones.${zone.id}.materialId`,
          )
        }
      }
    }
  }
  return Object.freeze({
    id,
    topology: 'heightfield',
    ...(label === undefined ? {} : { label }),
    basis: basis(item['basis'], `${path}.basis`, state, depth + 1),
    bounds: bounds(item['bounds'], `${path}.bounds`, state, depth + 1),
    layers: Object.freeze(layers),
  })
}

/** Validate and take an immutable, owned copy of an already-decoded UVW value. */
export function validateUvwProfile(
  value: unknown,
  options: UvwParseLimits = {},
): UvwProfileDocument {
  const state = budget(options)
  const root = record(value, '$', state, 0)
  exactKeys(root, ['$comment', 'uv', 'spaces', 'connections'], ['uv', 'spaces', 'connections'], '$')
  const comment =
    root['$comment'] === undefined ? undefined : string(root['$comment'], '$.$comment', state, 1)
  const uv = record(root['uv'], '$.uv', state, 1)
  exactKeys(uv, ['format', 'version', 'status'], ['format', 'version', 'status'], '$.uv')
  literal(uv['format'], UVW_PROFILE_FORMAT, '$.uv.format', state, 2)
  literal(uv['version'], UVW_PROFILE_VERSION, '$.uv.version', state, 2)
  literal(uv['status'], 'profile', '$.uv.status', state, 2)
  const spaceValues = array(root['spaces'], '$.spaces', state, 1)
  if (spaceValues.length === 0) fail('UVW profile must contain at least one space', '$.spaces')
  const spaces = spaceValues.map((entry, index) =>
    space(entry, `$.spaces[${String(index)}]`, state, 2),
  )
  const spaceIds = new Set<string>()
  for (const entry of spaces) {
    if (spaceIds.has(entry.id)) fail(`duplicate space id ${JSON.stringify(entry.id)}`, '$.spaces')
    spaceIds.add(entry.id)
  }
  const connections = array(root['connections'], '$.connections', state, 1)
  if (connections.length !== 0)
    fail(
      'connections are reserved and must be empty in UVW 1.0',
      '$.connections',
      'x3.uv/uvw-feature-unsupported',
    )
  return Object.freeze({
    ...(comment === undefined ? {} : { $comment: comment }),
    uv: Object.freeze({
      format: UVW_PROFILE_FORMAT,
      version: UVW_PROFILE_VERSION,
      status: 'profile' as const,
    }),
    spaces: Object.freeze(spaces),
    connections: Object.freeze([]) as readonly [],
  })
}

/** Parse UTF-8 JSON and validate it against the implemented UVW 1.0 profile. */
export function parseUvwProfile(
  bytes: Uint8Array,
  options: UvwParseLimits = {},
): UvwProfileDocument {
  options.signal?.throwIfAborted()
  const maxBytes = positiveLimit(options.maxBytes ?? DEFAULT_UVW_PARSE_LIMITS.maxBytes, 'maxBytes')
  if (bytes.byteLength > maxBytes)
    fail(`UVW input exceeds maxBytes ${String(maxBytes)}`, '$', 'x3.uv/uvw-budget-exceeded')
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (cause) {
    throw new ModkitError({
      code: 'x3.uv/uvw-utf8-invalid',
      message: 'UVW input is not valid UTF-8',
      cause,
    })
  }
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch (cause) {
    throw new ModkitError({
      code: 'x3.uv/uvw-json-invalid',
      message: 'UVW input is not valid JSON',
      cause,
    })
  }
  options.signal?.throwIfAborted()
  return validateUvwProfile(value, options)
}

/** Return the profile in deterministic semantic order. */
export function canonicalizeUvwProfile(
  document: UvwProfileDocument,
  options: UvwParseLimits = {},
): UvwProfileDocument {
  const validated = validateUvwProfile(document, options)
  return Object.freeze({
    ...(validated.$comment === undefined ? {} : { $comment: validated.$comment }),
    uv: validated.uv,
    spaces: Object.freeze(
      [...validated.spaces]
        .sort((left, right) => compareUtf8(left.id, right.id))
        .map(entry =>
          Object.freeze({
            ...entry,
            layers: Object.freeze(
              [...entry.layers]
                .sort((left, right) => compareUtf8(left.id, right.id))
                .map(layer => {
                  switch (layer.kind) {
                    case 'terrain-materials':
                      return Object.freeze({
                        ...layer,
                        materials: Object.freeze(
                          [...layer.materials].sort((left, right) =>
                            compareUtf8(left.id, right.id),
                          ),
                        ),
                        ...(layer.samples === undefined
                          ? {}
                          : {
                              samples: Object.freeze(
                                layer.samples.map(row =>
                                  Object.freeze(
                                    row.map(cell =>
                                      Object.freeze({
                                        ...cell,
                                        weights: Object.freeze(
                                          [...cell.weights].sort((left, right) =>
                                            compareUtf8(left.materialId, right.materialId),
                                          ),
                                        ),
                                      }),
                                    ),
                                  ),
                                ),
                              ),
                            }),
                        ...(layer.weightRasters === undefined
                          ? {}
                          : {
                              weightRasters: Object.freeze(
                                [...layer.weightRasters].sort((left, right) =>
                                  compareUtf8(left.resourceId, right.resourceId),
                                ),
                              ),
                            }),
                      })
                    case 'water':
                      return Object.freeze({
                        ...layer,
                        ...(layer.materials === undefined
                          ? {}
                          : {
                              materials: Object.freeze(
                                [...layer.materials].sort((left, right) =>
                                  compareUtf8(left.id, right.id),
                                ),
                              ),
                            }),
                        zones: Object.freeze(
                          [...layer.zones].sort((left, right) => compareUtf8(left.id, right.id)),
                        ),
                      })
                    case 'objects':
                      return Object.freeze({
                        ...layer,
                        instances: Object.freeze(
                          [...layer.instances]
                            .sort((left, right) => compareUtf8(left.id, right.id))
                            .map(instance =>
                              Object.freeze({
                                ...instance,
                                resourceIds: Object.freeze(
                                  [...instance.resourceIds].sort(compareUtf8),
                                ),
                                ...(instance.modelComponents === undefined
                                  ? {}
                                  : {
                                      modelComponents: Object.freeze(
                                        [...instance.modelComponents].sort((left, right) =>
                                          compareUtf8(left.id, right.id),
                                        ),
                                      ),
                                    }),
                              }),
                            ),
                        ),
                      })
                    case 'resources':
                      return Object.freeze({
                        ...layer,
                        resources: Object.freeze(
                          [...layer.resources].sort((left, right) =>
                            compareUtf8(left.id, right.id),
                          ),
                        ),
                      })
                    case 'regions':
                      return Object.freeze({
                        ...layer,
                        regions: Object.freeze(
                          [...layer.regions].sort((left, right) => compareUtf8(left.id, right.id)),
                        ),
                      })
                    case 'lighting':
                      return Object.freeze({
                        ...layer,
                        directional: Object.freeze(
                          [...layer.directional].sort((left, right) =>
                            compareUtf8(left.id, right.id),
                          ),
                        ),
                      })
                    default:
                      return layer
                  }
                }),
            ),
          }),
        ),
    ),
    connections: validated.connections,
  })
}

/** Serialize a validated UVW profile as canonical UTF-8 JSON with a trailing LF. */
export function serializeUvwProfile(
  document: UvwProfileDocument,
  options: UvwParseLimits = {},
): Uint8Array {
  options.signal?.throwIfAborted()
  const canonical = canonicalizeUvwProfile(document, options)
  const bytes = new TextEncoder().encode(canonicalJsonStringify(canonical))
  const maxBytes = positiveLimit(options.maxBytes ?? DEFAULT_UVW_PARSE_LIMITS.maxBytes, 'maxBytes')
  if (bytes.byteLength > maxBytes)
    fail(
      `canonical UVW output exceeds maxBytes ${String(maxBytes)}`,
      '$',
      'x3.uv/uvw-budget-exceeded',
    )
  options.signal?.throwIfAborted()
  return bytes
}

export {
  createUvwWorldSceneSource,
  type UvwEmbeddedModelDecoder,
  type UvwEmbeddedModelInput,
  type UvwWorldSceneSourceOptions,
} from './source.js'
export {
  materializeWorldToUvw,
  type WorldUvwMaterializationOptions,
  type WorldUvwMaterializationResult,
  type WorldUvwRefusal,
  type WorldUvwRefusalCode,
} from './materializer.js'
export {
  materializeWorldToUvpMap,
  openUvpMapBundle,
  type OpenedUvpMapBundle,
  type OpenUvpMapBundleOptions,
  type UvpMapManifest,
  type UvpMapManifestContent,
  type WorldUvpMaterializationOptions,
  type WorldUvpMaterializationResult,
  type WorldUvpRefusal,
} from './package.js'
export {
  createUvwConversionReceipt,
  preflightUvwConversionProfile,
  UVW_CONVERSION_PROFILE_IDS,
  type UvwConversionLoss,
  type UvwConversionLossMeasurement,
  type UvwConversionProfileId,
  type UvwConversionProfilePreflight,
  type UvwConversionReceipt,
  type UvwConversionRefusal,
} from './conversion.js'
export {
  planUvwExactObjectMappings,
  type UvwExactObjectMappingInput,
  type UvwExactObjectMappingPlan,
  type UvwExactObjectMappingRule,
  type UvwObjectDefinitionBinding,
  type UvwObjectMappingContext,
} from './object-mapping.js'
