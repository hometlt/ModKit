import { sha256Hex } from '@modkit/codec-kit/crypto/digest'
import type {
  CandidateWorldSceneSource,
  MapWorldCanonicalTransform,
  WorldSceneTerrainItem,
} from '@modkit/sdk/maps'

import {
  DEFAULT_UVW_PARSE_LIMITS,
  canonicalizeUvwProfile,
  serializeUvwProfile,
  type UvwBasis,
  type UvwProfileDocument,
} from './index.js'
import { reconstructAdditionalExactLayers, reconstructCanonicalUvw } from './reconstruct.js'

export type WorldUvwRefusalCode =
  | 'invalid-budget'
  | 'cancelled'
  | 'source-info-failed'
  | 'source-identity-mismatch'
  | 'exact-terrain-missing'
  | 'canonical-transform-missing'
  | 'canonical-transform-invalid'
  | 'source-page-failed'
  | 'page-invalid'
  | 'cursor-cycle'
  | 'terrain-budget-exceeded'
  | 'facet-budget-exceeded'
  | 'terrain-grid-invalid'
  | 'canonical-grid-mismatch'
  | 'materialization-failed'

export interface WorldUvwRefusal {
  readonly code: WorldUvwRefusalCode
  readonly message: string
  readonly path?: string
}

export interface WorldUvwMaterializationOptions {
  readonly maxPageItems: number
  readonly maxTerrainItems: number
  readonly maxOutputBytes: number
  /** Cumulative item ceiling for non-terrain facets and canonical UVW reopen. */
  readonly maxFacetItems?: number
  readonly signal?: AbortSignal
}

export type WorldUvwMaterializationResult =
  | Readonly<{
      readonly state: 'refused'
      readonly sourceSnapshotId: string
      readonly pageRequests: number
      readonly observedTerrainItems: number
      readonly refusals: readonly WorldUvwRefusal[]
      readonly refusalCodes: readonly WorldUvwRefusalCode[]
    }>
  | Readonly<{
      readonly state: 'materialized'
      readonly sourceSnapshotId: string
      readonly pageRequests: number
      readonly observedTerrainItems: number
      readonly document: UvwProfileDocument
      readonly bytes: Uint8Array
      readonly artifactDigest: `sha256:${string}`
      readonly excludedFacetIds: readonly string[]
      /** Objects of a partial object facet left out alone (no canonical place, a repeated id). */
      readonly omittedObjects: number
      /**
       * Fields of the facets kept that the UVW leaves out, as `world.<facet>.<field>` with how many
       * items had them (a tint, a clip, a team colour, a model the package does not hold).
       */
      readonly lostFields: readonly { readonly path: string; readonly count: number }[]
      readonly refusalCodes: readonly []
      readonly refusals: readonly []
    }>

function validLimit(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function finite(value: number): boolean {
  return Number.isFinite(value)
}

function cancelled(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

function same(left: number, right: number): boolean {
  const normalizedLeft = left === 0 ? 0 : left
  const normalizedRight = right === 0 ? 0 : right
  return Object.is(normalizedLeft, normalizedRight)
}

function close(left: number, right: number): boolean {
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 8
  return Math.abs(left - right) <= tolerance
}

function validTransform(transform: MapWorldCanonicalTransform, snapshotId: string): boolean {
  const count = transform.heightfield.columns * transform.heightfield.rows
  return (
    transform.schemaVersion === 1 &&
    transform.snapshotId === snapshotId &&
    transform.targetCoordinateSpaceId === 'uvw-canonical' &&
    transform.basis.handedness === 'right' &&
    transform.basis.upAxis === 'y' &&
    transform.basis.forwardAxis === '+z' &&
    (transform.basis.unit === 'meter' ||
      (transform.basis.unit === 'source-unit' &&
        typeof transform.basis.sourceUnit === 'string' &&
        transform.basis.sourceUnit.length > 0 &&
        transform.basis.metersPerUnit === undefined)) &&
    Number.isSafeInteger(transform.heightfield.columns) &&
    transform.heightfield.columns >= 2 &&
    Number.isSafeInteger(transform.heightfield.rows) &&
    transform.heightfield.rows >= 2 &&
    Number.isSafeInteger(count) &&
    finite(transform.heightfield.cellSize) &&
    transform.heightfield.cellSize > 0 &&
    transform.heightfield.origin.every(finite) &&
    Object.values(transform.bounds.minimum).every(finite) &&
    Object.values(transform.bounds.maximum).every(finite)
  )
}

/**
 * Materialize one publisher-qualified, fully measured exact heightfield into the current UVW
 * spaces envelope. The function is browser-safe and refuses every missing proof explicitly.
 */
export async function materializeWorldToUvw(
  source: CandidateWorldSceneSource,
  options: WorldUvwMaterializationOptions,
): Promise<WorldUvwMaterializationResult> {
  const refusals: WorldUvwRefusal[] = []
  let pageRequests = 0
  let observedTerrainItems = 0
  const refuse = (code: WorldUvwRefusalCode, message: string, path?: string): void => {
    if (refusals.some(item => item.code === code)) return
    refusals.push(Object.freeze({ code, message, ...(path === undefined ? {} : { path }) }))
  }
  const finish = (): Extract<WorldUvwMaterializationResult, { state: 'refused' }> =>
    Object.freeze({
      state: 'refused',
      sourceSnapshotId: source.snapshotId,
      pageRequests,
      observedTerrainItems,
      refusals: Object.freeze(refusals),
      refusalCodes: Object.freeze(refusals.map(item => item.code)),
    })

  if (
    !validLimit(options.maxPageItems) ||
    !validLimit(options.maxTerrainItems) ||
    !validLimit(options.maxOutputBytes) ||
    (options.maxFacetItems !== undefined && !validLimit(options.maxFacetItems))
  ) {
    refuse(
      'invalid-budget',
      'all UVW materialization budgets must be positive safe integers',
      'options',
    )
    return finish()
  }
  const maxFacetItems = options.maxFacetItems ?? options.maxTerrainItems
  const maxNativeOutputSamples = options.maxTerrainItems + maxFacetItems
  // Every JSON value takes at least a byte, so the output budget already bounds the value count; a
  // fixed node ceiling would refuse a terrain whose material weights fit the bytes (BAR 513²).
  const maxNodes = Math.max(DEFAULT_UVW_PARSE_LIMITS.maxNodes, options.maxOutputBytes)
  if (!Number.isSafeInteger(maxNativeOutputSamples)) {
    refuse(
      'invalid-budget',
      'combined terrain and facet budgets exceed the safe integer range',
      'options',
    )
    return finish()
  }
  if (cancelled(options.signal)) {
    refuse('cancelled', 'UVW materialization was cancelled before source inspection')
    return finish()
  }

  let info: Awaited<ReturnType<CandidateWorldSceneSource['info']>>
  try {
    info = await source.info(options.signal)
  } catch (error) {
    if (cancelled(options.signal))
      refuse('cancelled', 'UVW materialization was cancelled while reading source info')
    else refuse('source-info-failed', `world source info failed: ${String(error)}`)
    return finish()
  }
  if (
    info.contract !== source.contract ||
    info.major !== source.major ||
    info.snapshotId !== source.snapshotId ||
    info.maturity !== 'publisher-candidate'
  ) {
    refuse(
      'source-identity-mismatch',
      'world source identity changed between source and info',
      'source',
    )
    return finish()
  }
  if (info.canonicalArtifact?.format === 'UVW' && info.canonicalArtifact.version === '1.0') {
    try {
      const rebuilt = await reconstructCanonicalUvw(source, info, {
        maxPageItems: options.maxPageItems,
        maxFacetItems,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      pageRequests += rebuilt.pageRequests
      const document = canonicalizeUvwProfile(rebuilt.document, {
        maxNodes,
        maxSamples: maxFacetItems,
      })
      const bytes = serializeUvwProfile(document, {
        maxBytes: options.maxOutputBytes,
        maxNodes,
        maxSamples: maxFacetItems,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      const digest = await sha256Hex(bytes)
      options.signal?.throwIfAborted()
      return Object.freeze({
        state: 'materialized' as const,
        sourceSnapshotId: info.snapshotId,
        pageRequests,
        observedTerrainItems,
        document,
        bytes,
        artifactDigest: `sha256:${digest}` as const,
        excludedFacetIds: Object.freeze(
          info.unknownFacets.map(facet => `world.unknown.${facet}`).sort(),
        ),
        // a canonical UVW source places every object, and holds everything it says
        omittedObjects: 0,
        lostFields: Object.freeze([]),
        refusalCodes: Object.freeze([]) as readonly [],
        refusals: Object.freeze([]) as readonly [],
      })
    } catch (error) {
      if (cancelled(options.signal))
        refuse('cancelled', 'UVW canonical reconstruction was cancelled')
      else if (error instanceof RangeError)
        refuse('terrain-budget-exceeded', String(error), 'options.maxFacetItems')
      else refuse('materialization-failed', `UVW canonical reconstruction failed: ${String(error)}`)
      return finish()
    }
  }
  const exact = info.facets.filter(
    facet =>
      facet.facet === 'terrain' && facet.state === 'available' && facet.lods.includes('exact'),
  )
  if (exact.length !== 1) {
    refuse(
      'exact-terrain-missing',
      'UVW base profile requires exactly one available exact terrain layer',
      'info.facets',
    )
  }
  const transform = info.uvwTransform
  if (transform === undefined && info.uvwTransformRefusal !== undefined) {
    refuse(
      'canonical-transform-invalid',
      `world source refused the publisher's UVW transform: ${info.uvwTransformRefusal}`,
      'info.uvwTransformRefusal',
    )
  } else if (transform === undefined) {
    refuse(
      'canonical-transform-missing',
      'world source does not prove a map-native to UVW canonical transform',
      'info.uvwTransform',
    )
  } else if (!validTransform(transform, info.snapshotId)) {
    refuse(
      'canonical-transform-invalid',
      'world source UVW transform is incomplete or invalid',
      'info.uvwTransform',
    )
  }
  if (refusals.length > 0 || transform === undefined || exact[0] === undefined) return finish()

  // A terrain layer leaves out the samples where there is no ground (a Roblox air column, a cell
  // outside a Westwood map's diamond) and declares the sentinel its grid writes there instead.
  let noDataValue: number | undefined
  try {
    let layerCursor: string | undefined
    const layerCursors = new Set<string>()
    do {
      pageRequests += 1
      const page = await source.page(
        {
          facet: 'layers',
          ...(layerCursor === undefined ? {} : { cursor: layerCursor }),
          limit: options.maxPageItems,
        },
        options.signal,
      )
      const layer = page.items.find(
        item => item.facet === 'layers' && item.layerId === exact[0]?.layerId,
      )
      if (layer?.facet === 'layers') {
        noDataValue = layer.grid?.noDataValue
        break
      }
      layerCursor = page.nextCursor
      if (layerCursor !== undefined && layerCursors.has(layerCursor)) break
      if (layerCursor !== undefined) layerCursors.add(layerCursor)
    } while (layerCursor !== undefined)
  } catch (error) {
    if (cancelled(options.signal))
      refuse('cancelled', 'UVW materialization was cancelled while reading layers')
    else refuse('source-page-failed', `layer catalogue page failed: ${String(error)}`)
    return finish()
  }
  if (noDataValue !== undefined && !finite(noDataValue)) {
    refuse('terrain-grid-invalid', 'terrain noDataValue must be finite', 'layers.grid.noDataValue')
    return finish()
  }

  const items: WorldSceneTerrainItem[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  do {
    options.signal?.throwIfAborted()
    try {
      pageRequests += 1
      const page = await source.page(
        {
          facet: 'terrain',
          layerId: exact[0].layerId,
          lod: 'exact',
          ...(cursor === undefined ? {} : { cursor }),
          limit: options.maxPageItems,
        },
        options.signal,
      )
      if (
        page.snapshotId !== info.snapshotId ||
        page.facet !== 'terrain' ||
        page.state !== 'available' ||
        page.items.length > options.maxPageItems ||
        page.items.some(
          item =>
            item.facet !== 'terrain' || item.layerId !== exact[0]?.layerId || item.lod !== 'exact',
        )
      ) {
        refuse('page-invalid', 'exact terrain page identity, state or items are invalid', 'page')
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
      items.push(...(page.items as readonly WorldSceneTerrainItem[]))
      const next = page.nextCursor
      if (next !== undefined && (next === cursor || seenCursors.has(next))) {
        refuse('cursor-cycle', 'exact terrain paging repeated a cursor', 'page.nextCursor')
        break
      }
      if (next !== undefined) seenCursors.add(next)
      cursor = next
    } catch (error) {
      if (cancelled(options.signal))
        refuse('cancelled', 'UVW materialization was cancelled while reading terrain')
      else refuse('source-page-failed', `exact terrain page failed: ${String(error)}`)
      break
    }
  } while (cursor !== undefined)
  if (refusals.length > 0) return finish()

  const { columns, rows, cellSize, origin, sourceRowOrder } = transform.heightfield
  const expectedCount = columns * rows
  if (noDataValue === undefined ? items.length !== expectedCount : items.length > expectedCount) {
    refuse(
      'terrain-grid-invalid',
      `exact terrain layer has ${String(items.length)} items; expected ${String(expectedCount)}`,
      'page.items',
    )
    return finish()
  }
  const grid = new Array<WorldSceneTerrainItem | undefined>(expectedCount)
  for (const item of items) {
    if (
      !Number.isSafeInteger(item.x) ||
      !Number.isSafeInteger(item.y) ||
      item.x < 0 ||
      item.x >= columns ||
      item.y < 0 ||
      item.y >= rows ||
      item.uvwPosition === undefined ||
      !Object.values(item.uvwPosition).every(finite)
    ) {
      refuse(
        'terrain-grid-invalid',
        'terrain item has invalid grid or canonical coordinates',
        'page.items',
      )
      return finish()
    }
    const index = item.y * columns + item.x
    if (grid[index] !== undefined) {
      refuse('terrain-grid-invalid', 'terrain grid contains a duplicate coordinate', 'page.items')
      return finish()
    }
    grid[index] = item
  }

  const samples: number[][] = []
  let minimumY = Infinity
  let maximumY = -Infinity
  for (let outputRow = 0; outputRow < rows; outputRow += 1) {
    const sourceRow = sourceRowOrder === 'reverse' ? rows - 1 - outputRow : outputRow
    const row: number[] = []
    for (let x = 0; x < columns; x += 1) {
      const item = grid[sourceRow * columns + x]
      if (item === undefined && noDataValue !== undefined) {
        row.push(noDataValue)
        continue
      }
      const position = item?.uvwPosition
      if (
        position === undefined ||
        !close(position.x, origin[0] + x * cellSize) ||
        !close(position.z, origin[2] + outputRow * cellSize)
      ) {
        refuse(
          'canonical-grid-mismatch',
          'canonical positions do not form the declared scalar heightfield',
          'info.uvwTransform.heightfield',
        )
        return finish()
      }
      if (position.y === noDataValue) {
        refuse('terrain-grid-invalid', 'a ground height equals the noDataValue', 'page.items')
        return finish()
      }
      row.push(position.y)
      minimumY = Math.min(minimumY, position.y)
      maximumY = Math.max(maximumY, position.y)
    }
    samples.push(row)
  }
  const expectedMinimum = transform.bounds.minimum
  const expectedMaximum = transform.bounds.maximum
  if (
    !same(origin[0], expectedMinimum.x) ||
    !same(origin[2], expectedMinimum.z) ||
    !same(origin[0] + (columns - 1) * cellSize, expectedMaximum.x) ||
    !same(origin[2] + (rows - 1) * cellSize, expectedMaximum.z) ||
    !same(minimumY, expectedMinimum.y) ||
    !same(maximumY, expectedMaximum.y)
  ) {
    refuse(
      'canonical-grid-mismatch',
      'materialized terrain bounds do not match the proved transform',
      'info.uvwTransform.bounds',
    )
    return finish()
  }

  const outputBasis: UvwBasis = Object.freeze({
    handedness: 'right',
    upAxis: 'y',
    forwardAxis: '+z',
    unit: transform.basis.unit,
    ...(transform.basis.metersPerUnit === undefined
      ? {}
      : { metersPerUnit: transform.basis.metersPerUnit }),
    ...(transform.basis.sourceUnit === undefined ? {} : { sourceUnit: transform.basis.sourceUnit }),
    ...(transform.basis.unitsPerCell === undefined
      ? {}
      : { unitsPerCell: transform.basis.unitsPerCell }),
  })
  let additional: Awaited<ReturnType<typeof reconstructAdditionalExactLayers>>
  try {
    additional = await reconstructAdditionalExactLayers(source, info, {
      maxPageItems: options.maxPageItems,
      maxFacetItems,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    pageRequests += additional.pageRequests
  } catch (error) {
    if (cancelled(options.signal)) refuse('cancelled', 'UVW facet materialization was cancelled')
    else if (error instanceof RangeError)
      refuse('facet-budget-exceeded', String(error), 'options.maxFacetItems')
    else
      refuse('materialization-failed', `exact UVW facet materialization failed: ${String(error)}`)
    return finish()
  }
  const builtDocument: UvwProfileDocument = Object.freeze({
    uv: Object.freeze({ format: 'UVW', version: '1.0', status: 'profile' }),
    spaces: Object.freeze([
      Object.freeze({
        id: 'main',
        topology: 'heightfield',
        basis: outputBasis,
        bounds: Object.freeze({
          min: Object.freeze([expectedMinimum.x, expectedMinimum.y, expectedMinimum.z] as const),
          max: Object.freeze([expectedMaximum.x, expectedMaximum.y, expectedMaximum.z] as const),
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
            ...(noDataValue === undefined ? {} : { noDataValue }),
            samples: Object.freeze(samples.map(row => Object.freeze(row))),
          }),
          ...additional.layers,
        ]),
      }),
    ]),
    connections: Object.freeze([]) as readonly [],
  })
  try {
    const maxSamples = Math.max(maxNativeOutputSamples, DEFAULT_UVW_PARSE_LIMITS.maxSamples)
    const document = canonicalizeUvwProfile(builtDocument, { maxNodes, maxSamples })
    const bytes = serializeUvwProfile(document, {
      maxBytes: options.maxOutputBytes,
      maxNodes,
      maxSamples,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    const digest = await sha256Hex(bytes)
    options.signal?.throwIfAborted()
    const retained = new Set(['terrain', ...additional.retainedFacets])
    const excludedFacetIds = Object.freeze(
      info.facets
        .filter(facet => !retained.has(facet.facet))
        .map(facet => `world.${facet.facet}`)
        .concat(info.unknownFacets.map(facet => `world.unknown.${facet}`))
        .sort(),
    )
    return Object.freeze({
      state: 'materialized',
      sourceSnapshotId: info.snapshotId,
      pageRequests,
      observedTerrainItems,
      document,
      bytes,
      artifactDigest: `sha256:${digest}`,
      excludedFacetIds,
      omittedObjects: additional.omittedObjects,
      lostFields: additional.lostFields,
      refusalCodes: Object.freeze([]) as readonly [],
      refusals: Object.freeze([]) as readonly [],
    })
  } catch (error) {
    if (cancelled(options.signal)) refuse('cancelled', 'UVW serialization was cancelled')
    else refuse('materialization-failed', `UVW serialization failed: ${String(error)}`)
    return finish()
  }
}
