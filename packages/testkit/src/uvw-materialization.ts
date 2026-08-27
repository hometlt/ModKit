/** Testkit-only admission probe for the candidate UVW base-heightfield path. */

import { createHash } from 'node:crypto'
import { canonicalJsonStringify } from '@modkitx-x3/core'
import type {
  CandidateWorldSceneInfo,
  CandidateWorldSceneSource,
  MapWorldCanonicalTransform,
  WorldSceneFacetState,
  WorldScenePage,
  WorldSceneTerrainItem,
} from '@modkitx-x3/sdk/maps'

export const CANDIDATE_WORLD_UVW_PROFILE = 'uvw.candidate.v1/base-heightfield-admission' as const

export type CandidateWorldUvwRefusalCode =
  | 'invalid-budget'
  | 'cancelled'
  | 'source-stale'
  | 'source-info-failed'
  | 'source-identity-mismatch'
  | 'terrain-facet-missing'
  | 'terrain-not-exact'
  | 'exact-lod-missing'
  | 'terrain-bounds-unproven'
  | 'coordinate-space-missing'
  | 'coordinate-transform-unproven'
  | 'source-unit-unproven'
  | 'canonical-origin-unproven'
  | 'canonical-transform-invalid'
  | 'cell-size-unproven'
  | 'vertical-quantization-unproven'
  | 'source-page-failed'
  | 'cursor-rejected'
  | 'cursor-cycle'
  | 'page-snapshot-mismatch'
  | 'page-facet-mismatch'
  | 'exact-page-unavailable'
  | 'page-limit-exceeded'
  | 'terrain-budget-exceeded'
  | 'exact-page-item-invalid'
  | 'terrain-grid-incomplete'
  | 'canonical-position-invalid'
  | 'canonical-grid-mismatch'
  | 'materialization-failed'

export interface CandidateWorldUvwRefusal {
  readonly code: CandidateWorldUvwRefusalCode
  readonly message: string
  readonly path?: string
}

export interface CandidateWorldUvwAdmissionOptions {
  /** Maximum number of items requested from the source in one page. */
  readonly maxPageItems: number
  /** Cumulative exact terrain-cell ceiling for the admission probe. */
  readonly maxTerrainItems: number
  readonly signal?: AbortSignal
}

/**
 * A refusal-only Block 15F report. It is deliberately not a MaterializationReceipt: no artifact
 * exists, no semantic hash was computed, and the reserved world scope has not been admitted.
 */
interface CandidateWorldUvwReportBase {
  readonly profile: typeof CANDIDATE_WORLD_UVW_PROFILE
  readonly target: Readonly<{
    readonly format: 'UVW'
    readonly version: '1.0'
    readonly status: 'candidate'
    readonly facets: readonly ['basis', 'bounds', 'heightfield-base']
  }>
  readonly source: Readonly<{
    readonly contract: string
    readonly major: 1
    readonly snapshotId: string
    readonly infoSnapshotId?: string
  }>
  readonly terrainLayerId?: string
  readonly requestedLod: 'exact'
  readonly pageRequests: number
  readonly observedTerrainItems: number
  readonly lostFacetIds: readonly []
  readonly excludedFacetIds: readonly string[]
}

export interface CandidateWorldUvwRefusalReport extends CandidateWorldUvwReportBase {
  readonly state: 'refused'
  readonly materialized: false
  readonly serialized: false
  readonly serializedBytes: 0
  readonly refusalCodes: readonly CandidateWorldUvwRefusalCode[]
  readonly refusals: readonly CandidateWorldUvwRefusal[]
}

export interface CandidateWorldUvwDocument {
  readonly uv: Readonly<{
    readonly format: 'UVW'
    readonly version: '1.0'
    readonly status: 'candidate'
  }>
  readonly basis: MapWorldCanonicalTransform['basis']
  readonly bounds: Readonly<{
    readonly min: readonly [number, number, number]
    readonly max: readonly [number, number, number]
  }>
  readonly layers: readonly Readonly<{
    readonly id: 'terrain'
    readonly kind: 'heightfield'
    readonly label: 'Ground'
    readonly columns: number
    readonly rows: number
    readonly cellSize: number
    readonly origin: readonly [number, number, number]
    readonly samples: readonly (readonly number[])[]
  }>[]
}

export interface CandidateWorldUvwMaterializationReceipt {
  readonly schemaVersion: 1
  readonly materializer: 'x3.testkit/candidate-world-to-uvw'
  readonly profile: typeof CANDIDATE_WORLD_UVW_PROFILE
  readonly sourceSnapshotId: string
  readonly sourceContract: string
  readonly transform: MapWorldCanonicalTransform
  readonly planes: readonly Readonly<{
    readonly planeId: 'heightfield-base'
    readonly state: 'inferred'
    readonly note: string
  }>[]
  readonly artifactDigest: `sha256:${string}`
  readonly canonicalTupleDigest: `sha256:${string}`
  readonly admissionGate: 'second-family-required'
  readonly lostFacetIds: readonly []
  readonly excludedFacetIds: readonly string[]
}

export interface CandidateWorldUvwMaterializedReport extends CandidateWorldUvwReportBase {
  readonly state: 'materialized-candidate'
  readonly materialized: true
  readonly serialized: true
  readonly serializedBytes: number
  readonly artifactBytes: Uint8Array
  readonly document: CandidateWorldUvwDocument
  readonly receipt: CandidateWorldUvwMaterializationReceipt
  readonly refusalCodes: readonly []
  readonly refusals: readonly []
}

export type CandidateWorldUvwAdmissionReport =
  CandidateWorldUvwRefusalReport | CandidateWorldUvwMaterializedReport

const BASE_EXCLUSIONS = Object.freeze([
  'world.catalogs-definitions',
  'world.lighting',
  'world.map-native-binding',
  'world.navigation',
  'world.objects',
  'world.physics',
  'world.regions',
  'world.resources',
  'world.scenario-runtime',
  'world.terrain.authored-cliffs-ramps',
  'world.terrain.heightAdjustment',
  'world.terrain.hmap-padding-trailing-bytes',
  'world.terrain.mask',
  'world.terrain.material-layers',
  'world.terrain.pathing',
  'world.terrain.sampled-summary-metadata',
  'world.terrain.water',
  'world.trigger-volumes',
] as const)

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted === true) return true
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { readonly name?: unknown }).name === 'AbortError'
  )
}

function isStale(error: unknown): boolean {
  return /\b(?:released|stale)\b/iu.test(String(error))
}

const finite = (value: number): boolean => Number.isFinite(value)
const positive = (value: number): boolean => finite(value) && value > 0

function hasProvenNativeTerrainTransform(info: CandidateWorldSceneInfo): boolean {
  const transform = info.terrainTransform
  if (transform === undefined || transform.snapshotId !== info.snapshotId) return false
  const bounds = info.bounds.find(
    item => item.facet === 'terrain' && item.coordinateSpaceId === 'map-native',
  )
  const verticalMappingValid =
    'vertData' in transform
      ? finite(transform.vertData.quantizeBias) &&
        positive(transform.vertData.quantizeScale) &&
        finite(transform.vertData.standardHeight) &&
        transform.mapping.vertical ===
          'dequantized-base-times-scale-plus-offset-plus-dequantized-adjustment'
      : transform.mapping.vertical === 'direct-base-times-scale-plus-offset' &&
        transform.source.format === 'warzone-game-map' &&
        (transform.source.heightEncoding === 'uint8-times-2' ||
          transform.source.heightEncoding === 'uint16-le')
  return (
    transform.schemaVersion === 1 &&
    Number.isSafeInteger(transform.descriptorVersion) &&
    transform.descriptorVersion > 0 &&
    transform.heightMap.dim.length === 2 &&
    transform.heightMap.dim.every(value => Number.isSafeInteger(value) && value > 0) &&
    Object.values(transform.heightMap.offset).every(finite) &&
    Object.values(transform.heightMap.scale).every(positive) &&
    transform.mapping.horizontal === 'offset-plus-grid-index-times-scale' &&
    verticalMappingValid &&
    transform.bounds.coordinateSpaceId === 'map-native' &&
    bounds !== undefined &&
    bounds.x.state === 'known' &&
    bounds.y.state === 'known' &&
    bounds.z.state === 'known' &&
    bounds.x.minimum === transform.bounds.minimum.x &&
    bounds.x.maximum === transform.bounds.maximum.x &&
    bounds.y.minimum === transform.bounds.minimum.y &&
    bounds.y.maximum === transform.bounds.maximum.y &&
    bounds.z.minimum === transform.bounds.minimum.z &&
    bounds.z.maximum === transform.bounds.maximum.z
  )
}

function provenCanonicalTransform(
  info: CandidateWorldSceneInfo,
): MapWorldCanonicalTransform | undefined {
  const transform = info.uvwTransform
  const native = info.terrainTransform
  if (
    transform === undefined ||
    native === undefined ||
    transform.schemaVersion !== 1 ||
    transform.snapshotId !== info.snapshotId ||
    transform.sourceCoordinateSpaceId !== 'map-native' ||
    transform.targetCoordinateSpaceId !== 'uvw-canonical' ||
    !info.coordinateSpaces.some(item => item.id === 'map-native') ||
    !info.coordinateSpaces.some(item => item.id === 'uvw-canonical') ||
    !info.crossSpaceTransforms.some(
      item => item.from === 'map-native' && item.to === 'uvw-canonical' && item.state === 'known',
    ) ||
    transform.basis.handedness !== 'right' ||
    transform.basis.upAxis !== 'y' ||
    transform.basis.forwardAxis !== '+z' ||
    transform.heightfield.columns !== native.heightMap.dim[0] ||
    transform.heightfield.rows !== native.heightMap.dim[1] ||
    !positive(transform.heightfield.cellSize) ||
    transform.heightfield.origin.length !== 3 ||
    !transform.heightfield.origin.every(finite) ||
    transform.heightfield.sourceRowOrder !== 'reverse'
  ) {
    return undefined
  }
  if (
    transform.basis.unit === 'source-unit' &&
    (transform.basis.sourceUnit === undefined ||
      transform.basis.sourceUnit.length === 0 ||
      transform.basis.metersPerUnit !== undefined)
  ) {
    return undefined
  }
  const axes = Object.values(transform.axes)
  if (
    new Set(axes.map(item => item.sourceAxis)).size !== 3 ||
    axes.some(item => !finite(item.scale) || item.scale === 0 || !finite(item.offset)) ||
    !Object.values(transform.bounds.minimum).every(finite) ||
    !Object.values(transform.bounds.maximum).every(finite) ||
    !Number.isSafeInteger(transform.proof.tupleCount) ||
    transform.proof.tupleCount <= 0 ||
    transform.proof.kind !== 'adapter-qualification' ||
    transform.proof.comparison !== 'ieee-754-binary64-exact' ||
    !/^sha256:[0-9a-f]{64}$/u.test(transform.proof.nativeTupleDigest) ||
    !/^sha256:[0-9a-f]{64}$/u.test(transform.proof.canonicalTupleDigest)
  ) {
    return undefined
  }
  return transform
}

function canonicalPosition(
  position: Readonly<{ readonly x: number; readonly y: number; readonly z: number }>,
  transform: MapWorldCanonicalTransform,
): Readonly<{ readonly x: number; readonly y: number; readonly z: number }> {
  const axis = (output: 'x' | 'y' | 'z'): number => {
    const mapping = transform.axes[output]
    const value = position[mapping.sourceAxis] * mapping.scale + mapping.offset
    return value === 0 ? 0 : value
  }
  return Object.freeze({ x: axis('x'), y: axis('y'), z: axis('z') })
}

function sameNumber(left: number, right: number): boolean {
  return Object.is(left === 0 ? 0 : left, right === 0 ? 0 : right)
}

function gridNumberMatches(left: number, right: number): boolean {
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 8
  return Math.abs(left - right) <= tolerance
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

type CandidateUvwBuildResult =
  | Readonly<{
      readonly state: 'built'
      readonly document: CandidateWorldUvwDocument
      readonly artifactBytes: Uint8Array
      readonly canonicalTupleDigest: `sha256:${string}`
    }>
  | Readonly<{
      readonly state: 'invalid'
      readonly code:
        | 'terrain-grid-incomplete'
        | 'canonical-position-invalid'
        | 'canonical-grid-mismatch'
        | 'materialization-failed'
      readonly message: string
      readonly path?: string
    }>

function buildCandidateUvw(
  items: readonly WorldSceneTerrainItem[],
  transform: MapWorldCanonicalTransform,
): CandidateUvwBuildResult {
  const { columns, rows, cellSize, origin, sourceRowOrder } = transform.heightfield
  const count = columns * rows
  if (!Number.isSafeInteger(count) || count <= 0 || items.length !== count) {
    return Object.freeze({
      state: 'invalid',
      code: 'terrain-grid-incomplete',
      message: `exact terrain grid carries ${String(items.length)} items; expected ${String(count)}`,
      path: 'page.items',
    })
  }

  const nativeOrder = new Array<WorldSceneTerrainItem | undefined>(count)
  for (const item of items) {
    if (
      !Number.isSafeInteger(item.x) ||
      !Number.isSafeInteger(item.y) ||
      item.x < 0 ||
      item.x >= columns ||
      item.y < 0 ||
      item.y >= rows
    ) {
      return Object.freeze({
        state: 'invalid',
        code: 'terrain-grid-incomplete',
        message: 'exact terrain item has an out-of-range grid coordinate',
        path: 'page.items',
      })
    }
    const index = item.y * columns + item.x
    if (nativeOrder[index] !== undefined) {
      return Object.freeze({
        state: 'invalid',
        code: 'terrain-grid-incomplete',
        message: 'exact terrain grid contains a duplicate coordinate',
        path: 'page.items',
      })
    }
    const native = item.mapNativePosition
    const canonical = item.uvwPosition
    if (
      native === undefined ||
      canonical === undefined ||
      !Object.values(native).every(finite) ||
      !Object.values(canonical).every(finite)
    ) {
      return Object.freeze({
        state: 'invalid',
        code: 'canonical-position-invalid',
        message: 'exact terrain item lacks finite native and canonical positions',
        path: 'page.items',
      })
    }
    const expected = canonicalPosition(native, transform)
    if (
      !sameNumber(canonical.x, expected.x) ||
      !sameNumber(canonical.y, expected.y) ||
      !sameNumber(canonical.z, expected.z)
    ) {
      return Object.freeze({
        state: 'invalid',
        code: 'canonical-position-invalid',
        message: 'terrain item canonical position does not match the measured numeric transform',
        path: 'page.items',
      })
    }
    nativeOrder[index] = item
  }

  if (nativeOrder.some(item => item === undefined)) {
    return Object.freeze({
      state: 'invalid',
      code: 'terrain-grid-incomplete',
      message: 'exact terrain grid has missing coordinates',
      path: 'page.items',
    })
  }

  const samples: number[][] = []
  const tupleBytes = new Uint8Array(count * 3 * 8)
  const tupleView = new DataView(tupleBytes.buffer)
  let minimum = { x: Infinity, y: Infinity, z: Infinity }
  let maximum = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (let outputRow = 0; outputRow < rows; outputRow += 1) {
    const sourceRow = sourceRowOrder === 'reverse' ? rows - 1 - outputRow : outputRow
    const row: number[] = []
    for (let column = 0; column < columns; column += 1) {
      const item = nativeOrder[sourceRow * columns + column]
      if (item?.uvwPosition === undefined) {
        return Object.freeze({
          state: 'invalid',
          code: 'terrain-grid-incomplete',
          message: 'exact terrain grid lost a canonical position while ordering rows',
          path: 'page.items',
        })
      }
      const position = item.uvwPosition
      const expectedX = origin[0] + column * cellSize
      const expectedZ = origin[2] + outputRow * cellSize
      if (!gridNumberMatches(position.x, expectedX) || !gridNumberMatches(position.z, expectedZ)) {
        return Object.freeze({
          state: 'invalid',
          code: 'canonical-grid-mismatch',
          message: 'canonical terrain positions do not form the declared scalar heightfield grid',
          path: 'uvwTransform.heightfield',
        })
      }
      row.push(position.y)
      const tupleIndex = outputRow * columns + column
      for (const [axis, value] of [position.x, position.y, position.z].entries()) {
        tupleView.setFloat64((tupleIndex * 3 + axis) * 8, value === 0 ? 0 : value, true)
      }
      minimum = {
        x: Math.min(minimum.x, position.x),
        y: Math.min(minimum.y, position.y),
        z: Math.min(minimum.z, position.z),
      }
      maximum = {
        x: Math.max(maximum.x, position.x),
        y: Math.max(maximum.y, position.y),
        z: Math.max(maximum.z, position.z),
      }
    }
    samples.push(row)
  }

  if (
    !(['x', 'y', 'z'] as const).every(
      axis =>
        sameNumber(minimum[axis], transform.bounds.minimum[axis]) &&
        sameNumber(maximum[axis], transform.bounds.maximum[axis]),
    )
  ) {
    return Object.freeze({
      state: 'invalid',
      code: 'canonical-grid-mismatch',
      message: 'materialized canonical bounds do not match the measured transform bounds',
      path: 'uvwTransform.bounds',
    })
  }

  const document: CandidateWorldUvwDocument = Object.freeze({
    uv: Object.freeze({ format: 'UVW', version: '1.0', status: 'candidate' }),
    basis: transform.basis,
    bounds: Object.freeze({
      min: Object.freeze([minimum.x, minimum.y, minimum.z] as const),
      max: Object.freeze([maximum.x, maximum.y, maximum.z] as const),
    }),
    layers: Object.freeze([
      Object.freeze({
        id: 'terrain',
        kind: 'heightfield',
        label: 'Ground',
        columns,
        rows,
        cellSize,
        origin,
        samples: Object.freeze(samples.map(row => Object.freeze(row))),
      }),
    ]),
  })
  try {
    const canonical = canonicalJsonStringify(document)
    const artifactBytes = new TextEncoder().encode(canonical)
    const reopened = JSON.parse(
      new TextDecoder().decode(artifactBytes),
    ) as CandidateWorldUvwDocument
    if (canonicalJsonStringify(reopened) !== canonical) {
      return Object.freeze({
        state: 'invalid',
        code: 'materialization-failed',
        message: 'canonical UVW bytes did not reopen to the same document',
      })
    }
    return Object.freeze({
      state: 'built',
      document,
      artifactBytes,
      canonicalTupleDigest: sha256(tupleBytes),
    })
  } catch {
    return Object.freeze({
      state: 'invalid',
      code: 'materialization-failed',
      message: 'candidate UVW canonical serialization or reopen failed',
    })
  }
}

/**
 * Assess whether one publisher-qualified world candidate can honestly become the UVW 1.0 base
 * heightfield. This Block 15F seam has no success/artifact branch: the current world ABI cannot
 * prove a canonical origin, uniform UVW source unit or map-native-to-UVW transform. A validated
 * native terrain transform can close the narrower bounds/cell-size/dequantization observations
 * without making any UVW artifact admissible.
 *
 * The exact-page drain still runs for synthetic future-looking sources which advertise it. That
 * makes snapshot, cursor, cancellation and budget refusals executable without pretending those
 * transport checks close the missing semantic proof.
 */
export async function assessCandidateWorldUvwAdmission(
  source: CandidateWorldSceneSource,
  options: CandidateWorldUvwAdmissionOptions,
): Promise<CandidateWorldUvwAdmissionReport> {
  const refusals = new Map<CandidateWorldUvwRefusalCode, CandidateWorldUvwRefusal>()
  let info: CandidateWorldSceneInfo | undefined
  let terrain: WorldSceneFacetState | undefined = undefined
  let pageRequests = 0
  let observedTerrainItems = 0
  const exactTerrainItems: WorldSceneTerrainItem[] = []
  const cancelled = (): boolean => options.signal?.aborted === true

  const refuse = (code: CandidateWorldUvwRefusalCode, message: string, path?: string): void => {
    if (refusals.has(code)) return
    refusals.set(code, Object.freeze({ code, message, ...(path === undefined ? {} : { path }) }))
  }
  const finish = (): CandidateWorldUvwRefusalReport => {
    const excluded = new Set<string>(BASE_EXCLUSIONS)
    for (const facet of info?.unknownFacets ?? []) excluded.add(`world.unknown.${facet}`)
    const refusalList = Object.freeze([...refusals.values()])
    return Object.freeze({
      state: 'refused',
      profile: CANDIDATE_WORLD_UVW_PROFILE,
      target: Object.freeze({
        format: 'UVW',
        version: '1.0',
        status: 'candidate',
        facets: Object.freeze(['basis', 'bounds', 'heightfield-base'] as const),
      }),
      source: Object.freeze({
        contract: source.contract,
        major: source.major,
        snapshotId: source.snapshotId,
        ...(info === undefined ? {} : { infoSnapshotId: info.snapshotId }),
      }),
      ...(terrain === undefined ? {} : { terrainLayerId: terrain.layerId }),
      requestedLod: 'exact',
      pageRequests,
      observedTerrainItems,
      materialized: false,
      serialized: false,
      serializedBytes: 0,
      lostFacetIds: Object.freeze([] as const),
      excludedFacetIds: Object.freeze([...excluded].sort()),
      refusalCodes: Object.freeze(refusalList.map(item => item.code)),
      refusals: refusalList,
    })
  }

  if (
    !isPositiveSafeInteger(options.maxPageItems) ||
    !isPositiveSafeInteger(options.maxTerrainItems)
  ) {
    refuse(
      'invalid-budget',
      'maxPageItems and maxTerrainItems must be positive safe integers',
      'options',
    )
    return finish()
  }
  if (cancelled()) {
    refuse('cancelled', 'UVW candidate admission was cancelled before source inspection')
    return finish()
  }

  try {
    info = await source.info(options.signal)
  } catch (error) {
    if (isAbort(error, options.signal)) {
      refuse('cancelled', 'UVW candidate admission was cancelled while reading source info')
    } else if (isStale(error)) {
      refuse('source-stale', 'world candidate source was released or stale while reading info')
    } else {
      refuse('source-info-failed', 'world candidate info failed closed')
    }
    return finish()
  }

  if (
    source.contract !== info.contract ||
    source.major !== info.major ||
    source.snapshotId !== info.snapshotId ||
    info.maturity !== 'publisher-candidate'
  ) {
    refuse(
      'source-identity-mismatch',
      'world candidate identity or maturity changed between source and info',
      'source',
    )
    return finish()
  }

  terrain = info.facets.find(item => item.facet === 'terrain')
  if (terrain === undefined) {
    refuse('terrain-facet-missing', 'world candidate does not advertise a terrain facet')
    return finish()
  }
  if (terrain.state !== 'available') {
    refuse(
      'terrain-not-exact',
      `terrain facet state is ${terrain.state}; exact materialization requires available`,
      'info.facets.terrain.state',
    )
  }
  const hasExactLod = terrain.lods.includes('exact')
  if (!hasExactLod) {
    refuse(
      'exact-lod-missing',
      'terrain facet does not advertise an exact LOD',
      'info.facets.terrain.lods',
    )
  }

  const terrainBounds = info.bounds.find(item => item.facet === 'terrain')
  const nativeTerrainTransformProven = hasProvenNativeTerrainTransform(info)
  if (
    terrainBounds === undefined ||
    terrainBounds.x.state !== 'known' ||
    terrainBounds.y.state !== 'known' ||
    terrainBounds.z.state !== 'known'
  ) {
    refuse(
      'terrain-bounds-unproven',
      'terrain bounds are not fully known in one proven coordinate space',
      'info.bounds.terrain',
    )
  }
  const coordinateSpace =
    terrainBounds === undefined
      ? undefined
      : info.coordinateSpaces.find(item => item.id === terrainBounds.coordinateSpaceId)
  if (coordinateSpace === undefined) {
    refuse(
      'coordinate-space-missing',
      'terrain bounds do not identify a declared coordinate space',
      'info.coordinateSpaces',
    )
  }
  const canonicalTransform = provenCanonicalTransform(info)
  if (canonicalTransform === undefined) {
    if (info.uvwTransform !== undefined) {
      refuse(
        'canonical-transform-invalid',
        'world candidate canonical transform failed numeric, basis or qualification validation',
        'info.uvwTransform',
      )
    } else {
      refuse(
        'coordinate-transform-unproven',
        'publisher metadata stops at map-native and does not prove the UVW canonical frame transform',
        'info.crossSpaceTransforms',
      )
      refuse(
        'source-unit-unproven',
        'world candidate metadata does not prove one scalar source unit across all UVW axes',
        'info.coordinateSpaces',
      )
      refuse(
        'canonical-origin-unproven',
        'world candidate metadata has no numeric origin in the UVW canonical frame',
        'info.coordinateSpaces',
      )
    }
  }
  if (!nativeTerrainTransformProven) {
    refuse(
      'cell-size-unproven',
      'world candidate metadata has no validated horizontal native cell scale',
      'info.terrainTransform',
    )
    refuse(
      'vertical-quantization-unproven',
      'world candidate metadata does not validate how the HMAP height pair becomes a map-native elevation',
      'info.terrainTransform',
    )
  }

  if (terrain.state !== 'available' || !hasExactLod) return finish()

  let cursor: string | undefined
  const seenCursors = new Set<string>()
  do {
    if (cancelled()) {
      refuse('cancelled', 'UVW candidate admission was cancelled before an exact terrain page')
      break
    }
    let page: WorldScenePage
    try {
      pageRequests += 1
      page = await source.page(
        {
          facet: 'terrain',
          layerId: terrain.layerId,
          lod: 'exact',
          ...(cursor === undefined ? {} : { cursor }),
          limit: options.maxPageItems,
        },
        options.signal,
      )
    } catch (error) {
      if (isAbort(error, options.signal)) {
        refuse('cancelled', 'UVW candidate admission was cancelled while reading terrain')
      } else if (cursor !== undefined) {
        refuse('cursor-rejected', 'world candidate rejected its exact-page cursor')
      } else if (isStale(error)) {
        refuse('source-stale', 'world candidate source was released or stale while reading terrain')
      } else {
        refuse('source-page-failed', 'exact terrain page failed closed')
      }
      break
    }

    if (page.snapshotId !== info.snapshotId) {
      refuse(
        'page-snapshot-mismatch',
        'exact terrain page belongs to a different snapshot',
        'page.snapshotId',
      )
      break
    }
    if (page.facet !== 'terrain') {
      refuse('page-facet-mismatch', 'exact terrain page returned a different facet', 'page.facet')
      break
    }
    if (page.state !== 'available') {
      refuse('exact-page-unavailable', `exact terrain page state is ${page.state}`, 'page.state')
      break
    }
    if (page.items.length > options.maxPageItems) {
      refuse(
        'page-limit-exceeded',
        'world candidate returned more terrain items than the requested page limit',
        'page.items',
      )
      break
    }
    observedTerrainItems += page.items.length
    if (observedTerrainItems > options.maxTerrainItems) {
      refuse(
        'terrain-budget-exceeded',
        'exact terrain drain exceeded maxTerrainItems',
        'page.items',
      )
      break
    }
    const invalidItem = page.items.find(item => {
      const runtimeItem = item as unknown as Readonly<Record<string, unknown>>
      return (
        runtimeItem['facet'] !== 'terrain' ||
        runtimeItem['layerId'] !== terrain?.layerId ||
        runtimeItem['lod'] !== 'exact'
      )
    })
    if (invalidItem !== undefined) {
      refuse(
        'exact-page-item-invalid',
        'exact terrain page contains an item with the wrong facet, layer or LOD',
        'page.items',
      )
      break
    }
    exactTerrainItems.push(...(page.items as readonly WorldSceneTerrainItem[]))

    const nextCursor = page.nextCursor
    if (nextCursor !== undefined && (nextCursor === cursor || seenCursors.has(nextCursor))) {
      refuse('cursor-cycle', 'exact terrain paging repeated a cursor', 'page.nextCursor')
      break
    }
    if (nextCursor !== undefined) seenCursors.add(nextCursor)
    cursor = nextCursor
  } while (cursor !== undefined)

  if (refusals.size > 0 || canonicalTransform === undefined) return finish()
  const built = buildCandidateUvw(exactTerrainItems, canonicalTransform)
  if (built.state === 'invalid') {
    refuse(built.code, built.message, built.path)
    return finish()
  }

  const excluded = new Set<string>(BASE_EXCLUSIONS)
  for (const facet of info.unknownFacets) excluded.add(`world.unknown.${facet}`)
  const excludedFacetIds = Object.freeze([...excluded].sort())
  const lostFacetIds = Object.freeze([] as const)
  const receipt: CandidateWorldUvwMaterializationReceipt = Object.freeze({
    schemaVersion: 1,
    materializer: 'x3.testkit/candidate-world-to-uvw',
    profile: CANDIDATE_WORLD_UVW_PROFILE,
    sourceSnapshotId: info.snapshotId,
    sourceContract: info.contract,
    transform: canonicalTransform,
    planes: Object.freeze([
      Object.freeze({
        planeId: 'heightfield-base',
        state: 'inferred',
        note: 'grid relationship and canonical frame are measured; physical metres remain intentionally unknown',
      }),
    ]),
    artifactDigest: sha256(built.artifactBytes),
    canonicalTupleDigest: built.canonicalTupleDigest,
    admissionGate: 'second-family-required',
    lostFacetIds,
    excludedFacetIds,
  })
  return Object.freeze({
    state: 'materialized-candidate',
    profile: CANDIDATE_WORLD_UVW_PROFILE,
    target: Object.freeze({
      format: 'UVW',
      version: '1.0',
      status: 'candidate',
      facets: Object.freeze(['basis', 'bounds', 'heightfield-base'] as const),
    }),
    source: Object.freeze({
      contract: source.contract,
      major: source.major,
      snapshotId: source.snapshotId,
      infoSnapshotId: info.snapshotId,
    }),
    terrainLayerId: terrain.layerId,
    requestedLod: 'exact',
    pageRequests,
    observedTerrainItems,
    materialized: true,
    serialized: true,
    serializedBytes: built.artifactBytes.byteLength,
    artifactBytes: built.artifactBytes,
    document: built.document,
    receipt,
    lostFacetIds,
    excludedFacetIds,
    refusalCodes: Object.freeze([] as const),
    refusals: Object.freeze([] as const),
  })
}
