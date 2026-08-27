/** Generic structural adapter from authoritative map semantics to a paged publisher candidate. */

import type {
  CandidateWorldSceneInfo,
  CandidateWorldSceneSource,
  Lease,
  ResolvedMapWorkspaceSnapshot,
  ResourceProvenanceRecord,
  WorldSceneFacetState,
  WorldSceneItem,
  WorldSceneLayerKind,
  WorldScenePage,
  WorldScenePageRequest,
  WorldSceneRegionShape,
} from '@modkitx-x3/sdk'

function positiveLimit(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`world page limit must be between 1 and ${maximum}`)
  }
  return value
}

function resourceId(namespace: string, entityId: string): string {
  return `resource:${encodeURIComponent(namespace)}/${encodeURIComponent(entityId)}`
}

function layerId(snapshotId: string, kind: WorldSceneLayerKind): string {
  return `${snapshotId}:layer:${kind}`
}

function canonicalQuery(request: WorldScenePageRequest): string {
  const bounds = request.bounds
  if (
    bounds !== undefined &&
    (!Number.isFinite(bounds.minimumX) ||
      !Number.isFinite(bounds.minimumY) ||
      !Number.isFinite(bounds.maximumX) ||
      !Number.isFinite(bounds.maximumY) ||
      bounds.minimumX > bounds.maximumX ||
      bounds.minimumY > bounds.maximumY)
  ) {
    throw new TypeError('world bounds must be finite ordered minimum/maximum coordinates')
  }
  return JSON.stringify([
    request.facet,
    request.layerId ?? null,
    request.lod ?? null,
    bounds === undefined
      ? null
      : [bounds.minimumX, bounds.minimumY, bounds.maximumX, bounds.maximumY],
  ])
}

function cursor(snapshotId: string, query: string, offset: number): string {
  return `${encodeURIComponent(snapshotId)}|${encodeURIComponent(query)}|${String(offset)}`
}

function cursorOffset(value: string | undefined, snapshotId: string, query: string): number {
  if (value === undefined) return 0
  const parts = value.split('|')
  if (parts.length !== 3) throw new TypeError('world cursor is malformed')
  let cursorSnapshot: string
  let cursorQuery: string
  try {
    cursorSnapshot = decodeURIComponent(parts[0] ?? '')
    cursorQuery = decodeURIComponent(parts[1] ?? '')
  } catch {
    throw new TypeError('world cursor is malformed')
  }
  const offset = Number(parts[2])
  if (cursorSnapshot !== snapshotId) {
    throw new TypeError('world cursor belongs to another or stale source snapshot')
  }
  if (cursorQuery !== query || !Number.isSafeInteger(offset) || offset < 0) {
    throw new TypeError('world cursor does not match the requested layer, LOD or spatial query')
  }
  return offset
}

function numericPair(value: string | undefined): Readonly<{ x: number; y: number }> | undefined {
  if (value === undefined) return undefined
  const parts = value.split(',').map(item => Number(item.trim()))
  return parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])
    ? Object.freeze({ x: parts[0] as number, y: parts[1] as number })
    : undefined
}

function regionShape(shape: {
  readonly type: string
  readonly parameters: Readonly<Record<string, string>>
}): WorldSceneRegionShape {
  const center = numericPair(shape.parameters['center'])
  const radiusValue = shape.parameters['radius']
  const radius = radiusValue === undefined ? undefined : Number(radiusValue)
  return Object.freeze({
    kind: shape.type,
    ...(center === undefined ? {} : { center }),
    ...(radius !== undefined && Number.isFinite(radius) ? { radius } : {}),
    rawParameters: shape.parameters,
  })
}

function pageItems(
  items: readonly WorldSceneItem[],
  request: WorldScenePageRequest,
  snapshotId: string,
  maximum: number,
): WorldScenePage {
  const limit = positiveLimit(request.limit, maximum)
  const query = canonicalQuery(request)
  const offset = cursorOffset(request.cursor, snapshotId, query)
  if (offset > items.length) throw new TypeError('world cursor offset is outside this facet')
  const selected = Object.freeze(items.slice(offset, offset + limit))
  const nextOffset = offset + selected.length
  return Object.freeze({
    snapshotId,
    facet: request.facet,
    state: 'available',
    items: selected,
    ...(nextOffset < items.length ? { nextCursor: cursor(snapshotId, query, nextOffset) } : {}),
  })
}

/** Creates a lease whose release makes every page/cursor stale immediately. */
export function createCandidateWorldSceneLease(
  snapshot: ResolvedMapWorkspaceSnapshot,
  provenance: readonly ResourceProvenanceRecord[],
  maxPageSize: number,
): Lease<CandidateWorldSceneSource> {
  positiveLimit(maxPageSize, Number.MAX_SAFE_INTEGER)
  const semantic = snapshot.semantic
  const terrainLayerId = layerId(snapshot.snapshotId, 'terrain')
  const objectLayerId = layerId(snapshot.snapshotId, 'objects')
  const regionLayerId = layerId(snapshot.snapshotId, 'regions')
  const resourceLayerId = layerId(snapshot.snapshotId, 'resources')
  const navigationLayerId = layerId(snapshot.snapshotId, 'navigation')
  const objectIdentities = new Set<number>()
  const semanticObjects = semantic.objects.filter(item => {
    if (objectIdentities.has(item.objectId)) return false
    objectIdentities.add(item.objectId)
    return true
  })
  const regionIdentities = new Set<number>()
  const semanticRegions = semantic.regions.filter(item => {
    if (regionIdentities.has(item.regionId)) return false
    regionIdentities.add(item.regionId)
    return true
  })
  const duplicateObjectCount = semantic.objects.length - semanticObjects.length
  const duplicateRegionCount = semantic.regions.length - semanticRegions.length

  const terrain: readonly WorldSceneItem[] = Object.freeze(
    (semantic.terrain?.samples ?? []).map(item =>
      Object.freeze({
        facet: 'terrain' as const,
        id: `${terrainLayerId}:sample:${String(item.x)}:${String(item.y)}`,
        layerId: terrainLayerId,
        coordinateSpaceId: 'height-grid',
        lod: 'sampled' as const,
        ...item,
      }),
    ),
  )
  const objects: readonly WorldSceneItem[] = Object.freeze(
    semanticObjects.map(item => {
      const id = `${objectLayerId}:object:${String(item.objectId)}`
      const ref = item.catalog?.ref
      return Object.freeze({
        facet: 'objects' as const,
        id,
        layerId: objectLayerId,
        coordinateSpaceId: 'map-native',
        ...item,
        ...(ref === undefined ? {} : { resourceId: resourceId(ref.namespace, ref.entityId) }),
      })
    }),
  )
  const regions: readonly WorldSceneItem[] = Object.freeze(
    semanticRegions.map(item =>
      Object.freeze({
        facet: 'regions' as const,
        id: `${regionLayerId}:region:${String(item.regionId)}`,
        layerId: regionLayerId,
        coordinateSpaceId: 'map-native',
        regionId: item.regionId,
        name: item.name,
        ...(item.color === undefined ? {} : { color: item.color }),
        shapes: Object.freeze(item.shapes.map(regionShape)),
      }),
    ),
  )
  const resourceJoins = new Map<
    string,
    { namespace: string; entityId: string; resolved: boolean; objectIds: string[] }
  >()
  for (const item of objects) {
    if (item.facet !== 'objects' || item.catalog === undefined) continue
    const key = resourceId(item.catalog.ref.namespace, item.catalog.ref.entityId)
    const current = resourceJoins.get(key) ?? {
      namespace: item.catalog.ref.namespace,
      entityId: item.catalog.ref.entityId,
      resolved: item.catalog.entity !== undefined,
      objectIds: [],
    }
    current.resolved ||= item.catalog.entity !== undefined
    current.objectIds.push(item.id)
    resourceJoins.set(key, current)
  }
  const resources: readonly WorldSceneItem[] = Object.freeze(
    [...resourceJoins.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, item]) =>
        Object.freeze({
          facet: 'resources' as const,
          id,
          layerId: resourceLayerId,
          namespace: item.namespace,
          entityId: item.entityId,
          resolved: item.resolved,
          objectIds: Object.freeze([...item.objectIds]),
        }),
      ),
  )
  const navigation: readonly WorldSceneItem[] = Object.freeze(
    (snapshot.navigation?.samples ?? []).map(item =>
      Object.freeze({
        facet: 'navigation' as const,
        id: `${navigationLayerId}:sample:${String(item.x)}:${String(item.y)}`,
        layerId: navigationLayerId,
        coordinateSpaceId: 'navigation-grid',
        lod: 'sampled' as const,
        ...item,
      }),
    ),
  )

  const facets: readonly WorldSceneFacetState[] = Object.freeze([
    Object.freeze({
      facet: 'terrain' as const,
      layerId: terrainLayerId,
      state: semantic.terrain === undefined ? ('unavailable' as const) : ('partial' as const),
      itemCount: semantic.terrain?.cellCount ?? 0,
      lods: Object.freeze(semantic.terrain === undefined ? [] : ['summary', 'sampled']),
      ...(semantic.terrain === undefined
        ? { reason: 'authoritative semantic snapshot contains no terrain height grid' }
        : { reason: 'candidate exposes bounded deterministic samples, not an eager full grid' }),
    }),
    Object.freeze({
      facet: 'objects' as const,
      layerId: objectLayerId,
      state:
        semanticObjects.length === 0
          ? ('unavailable' as const)
          : duplicateObjectCount > 0
            ? ('partial' as const)
            : ('available' as const),
      itemCount: semanticObjects.length,
      lods: Object.freeze(['exact']),
      ...(semanticObjects.length === 0
        ? { reason: 'semantic snapshot contains no objects' }
        : duplicateObjectCount > 0
          ? { reason: `${duplicateObjectCount} duplicate object identities were omitted` }
          : {}),
    }),
    Object.freeze({
      facet: 'regions' as const,
      layerId: regionLayerId,
      state:
        semanticRegions.length === 0
          ? ('unavailable' as const)
          : duplicateRegionCount > 0
            ? ('partial' as const)
            : ('available' as const),
      itemCount: semanticRegions.length,
      lods: Object.freeze(['exact']),
      ...(semanticRegions.length === 0
        ? { reason: 'semantic snapshot contains no regions' }
        : duplicateRegionCount > 0
          ? { reason: `${duplicateRegionCount} duplicate region identities were omitted` }
          : {}),
    }),
    Object.freeze({
      facet: 'resources' as const,
      layerId: resourceLayerId,
      state: resources.length === 0 ? ('unavailable' as const) : ('available' as const),
      itemCount: resources.length,
      lods: Object.freeze(['exact']),
      ...(resources.length === 0
        ? { reason: 'no placed object publishes a catalog resource reference' }
        : {}),
    }),
    Object.freeze({
      facet: 'navigation' as const,
      layerId: navigationLayerId,
      state: snapshot.navigation === undefined ? ('unavailable' as const) : ('partial' as const),
      itemCount: snapshot.navigation?.cellCount ?? 0,
      lods: Object.freeze(snapshot.navigation === undefined ? [] : ['summary', 'sampled']),
      ...(snapshot.navigation === undefined
        ? { reason: 'publisher reported navigation unavailable' }
        : { reason: 'native flags are sampled and their bit semantics remain publisher-defined' }),
    }),
  ])
  const layers: readonly WorldSceneItem[] = Object.freeze(
    facets.map(item =>
      Object.freeze({
        facet: 'layers' as const,
        id: item.layerId,
        layerId: item.layerId,
        kind: item.facet,
        state: item.state,
        itemCount: item.itemCount,
        lods: item.lods,
      }),
    ),
  )
  const byFacet = new Map<string, readonly WorldSceneItem[]>([
    ['layers', layers],
    ['terrain', terrain],
    ['objects', objects],
    ['regions', regions],
    ['resources', resources],
    ['navigation', navigation],
  ])
  const terrainSummary = semantic.terrain
  const info: CandidateWorldSceneInfo = Object.freeze({
    contract: snapshot.worldCandidate.contract,
    major: snapshot.worldCandidate.major,
    maturity: snapshot.worldCandidate.maturity,
    snapshotId: snapshot.snapshotId,
    mapId: snapshot.mapId,
    coordinateSpaces: snapshot.worldCandidate.coordinateSpaces,
    crossSpaceTransforms: snapshot.worldCandidate.crossSpaceTransforms,
    bounds: Object.freeze([
      Object.freeze({
        facet: 'terrain' as const,
        coordinateSpaceId: 'height-grid',
        x:
          terrainSummary === undefined
            ? Object.freeze({ state: 'unknown' as const, reason: 'terrain bounds unavailable' })
            : Object.freeze({
                state: 'known' as const,
                minimum: 0,
                maximum: terrainSummary.width - 1,
              }),
        y:
          terrainSummary === undefined
            ? Object.freeze({ state: 'unknown' as const, reason: 'terrain bounds unavailable' })
            : Object.freeze({
                state: 'known' as const,
                minimum: 0,
                maximum: terrainSummary.height - 1,
              }),
        z: Object.freeze({
          state: 'unknown' as const,
          reason: 'publisher-native height quantization has no normalized world-unit conversion',
        }),
      }),
      Object.freeze({
        facet: 'objects' as const,
        coordinateSpaceId: 'map-native',
        x:
          semanticObjects.length === 0
            ? Object.freeze({ state: 'unknown' as const, reason: 'object bounds unavailable' })
            : Object.freeze({
                state: 'known' as const,
                minimum: Math.min(...semanticObjects.map(item => item.position.x)),
                maximum: Math.max(...semanticObjects.map(item => item.position.x)),
              }),
        y:
          semanticObjects.length === 0
            ? Object.freeze({ state: 'unknown' as const, reason: 'object bounds unavailable' })
            : Object.freeze({
                state: 'known' as const,
                minimum: Math.min(...semanticObjects.map(item => item.position.y)),
                maximum: Math.max(...semanticObjects.map(item => item.position.y)),
              }),
        z:
          semanticObjects.length === 0
            ? Object.freeze({ state: 'unknown' as const, reason: 'object bounds unavailable' })
            : Object.freeze({
                state: 'known' as const,
                minimum: Math.min(...semanticObjects.map(item => item.position.z)),
                maximum: Math.max(...semanticObjects.map(item => item.position.z)),
              }),
      }),
      Object.freeze({
        facet: 'regions' as const,
        coordinateSpaceId: 'map-native',
        x: Object.freeze({
          state: 'unknown' as const,
          reason: 'region geometry is not normalized',
        }),
        y: Object.freeze({
          state: 'unknown' as const,
          reason: 'region geometry is not normalized',
        }),
        z: Object.freeze({
          state: 'unknown' as const,
          reason: 'region geometry is not normalized',
        }),
      }),
      Object.freeze({
        facet: 'navigation' as const,
        coordinateSpaceId: 'navigation-grid',
        x:
          snapshot.navigation === undefined
            ? Object.freeze({ state: 'unknown' as const, reason: 'navigation bounds unavailable' })
            : Object.freeze({
                state: 'known' as const,
                minimum: 0,
                maximum: snapshot.navigation.width - 1,
              }),
        y:
          snapshot.navigation === undefined
            ? Object.freeze({ state: 'unknown' as const, reason: 'navigation bounds unavailable' })
            : Object.freeze({
                state: 'known' as const,
                minimum: 0,
                maximum: snapshot.navigation.height - 1,
              }),
        z: Object.freeze({
          state: 'unknown' as const,
          reason: 'navigation grid has no vertical axis',
        }),
      }),
    ]),
    facets,
    provenance: Object.freeze(provenance.map(item => Object.freeze({ ...item }))),
    unknownFacets: snapshot.worldCandidate.unknownFacets,
    lossPolicy: 'explicit-partial',
    complete: snapshot.complete && duplicateObjectCount === 0 && duplicateRegionCount === 0,
  })
  let live = true
  const assertLive = (signal?: AbortSignal): void => {
    signal?.throwIfAborted()
    if (!live) throw new TypeError('world scene source lease is released or stale')
  }
  const source: CandidateWorldSceneSource = Object.freeze({
    contract: snapshot.worldCandidate.contract,
    major: snapshot.worldCandidate.major,
    snapshotId: snapshot.snapshotId,
    async info(signal?: AbortSignal) {
      assertLive(signal)
      return Promise.resolve(info)
    },
    async page(request: WorldScenePageRequest, signal?: AbortSignal) {
      assertLive(signal)
      positiveLimit(request.limit, maxPageSize)
      cursorOffset(request.cursor, snapshot.snapshotId, canonicalQuery(request))
      const items = byFacet.get(request.facet)
      if (items === undefined) {
        return Promise.resolve(
          Object.freeze({
            snapshotId: snapshot.snapshotId,
            facet: request.facet,
            state: 'unsupported' as const,
            items: Object.freeze([]),
            reason: `publisher candidate does not expose facet ${request.facet}`,
          }),
        )
      }
      const facetState = facets.find(item => item.facet === request.facet)
      if (request.facet !== 'layers') {
        if (request.layerId !== facetState?.layerId) {
          throw new TypeError(`world facet ${request.facet} requires its exact layerId`)
        }
        if (
          (request.facet === 'terrain' || request.facet === 'navigation') &&
          request.lod !== 'sampled'
        ) {
          return Promise.resolve(
            Object.freeze({
              snapshotId: snapshot.snapshotId,
              facet: request.facet,
              state: 'unsupported' as const,
              items: Object.freeze([]),
              reason: `facet ${request.facet} only pages sampled LOD items`,
            }),
          )
        }
      }
      if (
        request.bounds !== undefined &&
        (request.facet === 'layers' || request.facet === 'regions' || request.facet === 'resources')
      ) {
        return Promise.resolve(
          Object.freeze({
            snapshotId: snapshot.snapshotId,
            facet: request.facet,
            state: 'unsupported' as const,
            items: Object.freeze([]),
            reason: `facet ${request.facet} does not support spatial bounds`,
          }),
        )
      }
      if (request.facet !== 'layers' && facetState?.state === 'unavailable') {
        return Promise.resolve(
          Object.freeze({
            snapshotId: snapshot.snapshotId,
            facet: request.facet,
            state: 'unavailable' as const,
            items: Object.freeze([]),
            reason: facetState.reason ?? 'facet unavailable',
          }),
        )
      }
      const bounds = request.bounds
      const bounded =
        bounds === undefined
          ? items
          : items.filter(item => {
              if (item.facet === 'objects') {
                return (
                  item.position.x >= bounds.minimumX &&
                  item.position.x <= bounds.maximumX &&
                  item.position.y >= bounds.minimumY &&
                  item.position.y <= bounds.maximumY
                )
              }
              if (item.facet !== 'terrain' && item.facet !== 'navigation') return false
              return (
                item.x >= bounds.minimumX &&
                item.x <= bounds.maximumX &&
                item.y >= bounds.minimumY &&
                item.y <= bounds.maximumY
              )
            })
      return Promise.resolve(pageItems(bounded, request, snapshot.snapshotId, maxPageSize))
    },
  })
  return Object.freeze({
    value: source,
    release() {
      live = false
      return Promise.resolve()
    },
  })
}
