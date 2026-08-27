import {
  MAP_SEMANTIC_ANALYSIS_CONTRACT,
  RESOLVED_MAP_WORKSPACE_CONTRACT,
} from '@modkitx-x3/sdk/maps'

const ANALYZER_ID = 'org.modkitx.opensource.warzone2100.maps'
const GAME_ID = 'org.modkitx/warzone-2100'
export const WARZONE_WORLD_SCENE_SOURCE_CONTRACT =
  'org.modkitx.opensource.warzone2100/world-scene-source'
const TILE_UNITS = 128
const ELEVATION_SCALE = 2
const MAXIMUM_DOCUMENTS = 8
const MAXIMUM_DOCUMENT_BYTES = 16_777_216
const MAXIMUM_TOTAL_BYTES = 33_554_432
const MAXIMUM_TERRAIN_CELLS = 65_536
const MAXIMUM_TERRAIN_SAMPLES = MAXIMUM_TERRAIN_CELLS
const MAXIMUM_DIAGNOSTICS = 10_000
const decoder = new TextDecoder()

const WARZONE_WORLD_ORACLE = Object.freeze({
  kind: 'adapter-qualification',
  method: 'official-reference-differential',
  oracle: 'Warzone2100/warzone2100@cbb1eb1515da60893595eef2868f4dcef8c37f1c',
  corpus: 'Warzone 2100 4.7.0/mp.wz/multiplay/maps/2c-highground/game.map',
  sourceDigests: Object.freeze({
    'mp.wz': 'sha256:d698475eaa7b3386c2465e5850e5609b0d524157280c7d659dc5f79cde6e5688',
    'game.map': 'sha256:c03e17c13a837339a1b8066047385758539cdc14ef903d806fcf871d30409111',
  }),
  tupleCount: 4_608,
  comparison: 'ieee-754-binary64-exact',
  nativeTupleDigest: 'sha256:bc29f38775548ebf04d37fddf1d2750c4532721afdc9ccae32aebcc2f943c6a2',
  canonicalTupleDigest: 'sha256:01a7ccb598ea62a8e6dd5f2d88cdfbdd5d19ee1e1fe77ba995c7374bd4d0a2f0',
})

function recordOf(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value
}

function positiveLimit(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`${label} must be a positive safe integer no greater than ${maximum}`)
  }
  return value
}

function validateRequest(request) {
  const value = recordOf(request)
  if (value === undefined) throw new TypeError('semantic map request must be an object')
  nonEmptyString(value.workspaceId, 'workspaceId')
  nonEmptyString(value.mapId, 'mapId')
  if (value.gameId !== GAME_ID) {
    throw new TypeError(`Warzone 2100 map analysis cannot inspect ${String(value.gameId)}`)
  }
  const maxDocuments = positiveLimit(value.maxDocuments, 'maxDocuments', MAXIMUM_DOCUMENTS)
  const maxDocumentBytes = positiveLimit(
    value.maxDocumentBytes,
    'maxDocumentBytes',
    MAXIMUM_DOCUMENT_BYTES,
  )
  const maxTotalBytes = positiveLimit(value.maxTotalBytes, 'maxTotalBytes', MAXIMUM_TOTAL_BYTES)
  positiveLimit(value.maxObjects, 'maxObjects', 1_000_000)
  positiveLimit(value.maxRegions, 'maxRegions', 1_000_000)
  positiveLimit(value.maxTerrainCells, 'maxTerrainCells', MAXIMUM_TERRAIN_CELLS)
  positiveLimit(value.maxTerrainSamples, 'maxTerrainSamples', MAXIMUM_TERRAIN_SAMPLES)
  positiveLimit(value.maxDepth, 'maxDepth', 128)
  if (!Array.isArray(value.documents) || value.documents.length > maxDocuments) {
    throw new TypeError(`documents must contain at most maxDocuments (${maxDocuments}) entries`)
  }
  let totalBytes = 0
  const paths = new Set()
  for (const [index, document] of value.documents.entries()) {
    const item = recordOf(document)
    if (item === undefined) throw new TypeError(`documents[${index}] must be an object`)
    const path = nonEmptyString(item.path, `documents[${index}].path`)
    if (!(item.bytes instanceof Uint8Array)) {
      throw new TypeError(`documents[${index}].bytes must be a Uint8Array`)
    }
    if (item.bytes.byteLength > maxDocumentBytes) {
      throw new TypeError(`documents[${index}] exceeds maxDocumentBytes (${maxDocumentBytes})`)
    }
    const normalized = path.replaceAll('\\', '/').toLowerCase()
    if (paths.has(normalized)) throw new TypeError(`documents contains duplicate path ${path}`)
    paths.add(normalized)
    totalBytes += item.bytes.byteLength
  }
  if (totalBytes > maxTotalBytes) {
    throw new TypeError(`document bytes exceeds maxTotalBytes (${totalBytes} > ${maxTotalBytes})`)
  }
  return value
}

function basename(path) {
  return path.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() ?? ''
}

function diagnostic(severity, code, message, path) {
  return Object.freeze({ severity, code, message, ...(path === undefined ? {} : { path }) })
}

/** Provider-owned single-document plan; the host still owns the ResourceSession/VFS read. */
export async function planWarzoneMap(request) {
  request?.signal?.throwIfAborted()
  const value = recordOf(request)
  if (value === undefined) throw new TypeError('semantic map plan request must be an object')
  const workspace = recordOf(value.workspace)
  if (
    workspace?.schemaVersion !== 1 ||
    workspace.gameId !== GAME_ID ||
    !Array.isArray(workspace.loadOrder)
  ) {
    throw new TypeError('workspace must be a Warzone 2100 ModWorkspaceLock')
  }
  const maxRequirements = positiveLimit(value.maxRequirements, 'maxRequirements', 64)
  const active = workspace.loadOrder.find(root => root?.rootId === workspace.activeRootId)
  if (active === undefined || typeof active.sourcePath !== 'string') {
    return Object.freeze({
      schemaVersion: 1,
      workspaceId: String(workspace.workspaceId ?? ''),
      gameId: GAME_ID,
      mapId: '',
      analyzerId: ANALYZER_ID,
      requirements: Object.freeze([]),
      diagnostics: Object.freeze([
        diagnostic(
          'error',
          'org.modkitx.opensource.warzone2100/map-active-root-unavailable',
          'workspace activeRootId does not name one loadOrder root',
        ),
      ]),
      complete: false,
    })
  }
  const root = nonEmptyString(active.sourcePath, 'workspace active root sourcePath').replaceAll(
    '\\',
    '/',
  )
  const requirement = Object.freeze({
    requirementId: 'warzone-game-map',
    path: `${root}/game.map`,
    kind: 'terrain-height',
    required: true,
  })
  const complete = maxRequirements >= 1
  return Object.freeze({
    schemaVersion: 1,
    workspaceId: String(workspace.workspaceId),
    gameId: GAME_ID,
    mapId: root,
    analyzerId: ANALYZER_ID,
    requirements: Object.freeze(complete ? [requirement] : []),
    diagnostics: Object.freeze(
      complete
        ? []
        : [
            diagnostic(
              'error',
              'org.modkitx.opensource.warzone2100/map-plan-budget-exceeded',
              'Warzone map plan needs one requirement but maxRequirements is zero',
            ),
          ],
    ),
    complete,
  })
}

function parseGameMap(document, request) {
  const bytes = document.bytes
  if (bytes.byteLength < 24 || decoder.decode(bytes.subarray(0, 4)) !== 'map ') {
    throw new TypeError(`${document.path}: Warzone game.map header is missing or truncated`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint32(4, true)
  const width = view.getUint32(8, true)
  const height = view.getUint32(12, true)
  const cellCount = width * height
  if (
    version < 10 ||
    version > 40 ||
    width <= 1 ||
    height <= 1 ||
    width > 256 ||
    height > 256 ||
    !Number.isSafeInteger(cellCount) ||
    cellCount > request.maxTerrainCells
  ) {
    throw new TypeError(`${document.path}: Warzone game.map version or dimensions are invalid`)
  }
  const tileBytes = version >= 40 ? 4 : 3
  const tileEnd = 16 + cellCount * tileBytes
  if (!Number.isSafeInteger(tileEnd) || tileEnd + 8 > bytes.byteLength) {
    throw new TypeError(`${document.path}: Warzone game.map tile array is truncated`)
  }
  const sampleCount = Math.min(cellCount, request.maxTerrainSamples)
  const retained = new Set()
  for (let index = 0; index < sampleCount; index += 1) {
    retained.add(sampleCount === 1 ? 0 : Math.floor((index * (cellCount - 1)) / (sampleCount - 1)))
  }
  const samples = []
  let minimumHeightBase = Infinity
  let maximumHeightBase = -Infinity
  let offset = 16
  for (let index = 0; index < cellCount; index += 1) {
    const mask = view.getUint16(offset, true)
    offset += 2
    const heightBase =
      version >= 40 ? view.getUint16(offset, true) : view.getUint8(offset) * ELEVATION_SCALE
    offset += version >= 40 ? 2 : 1
    minimumHeightBase = Math.min(minimumHeightBase, heightBase)
    maximumHeightBase = Math.max(maximumHeightBase, heightBase)
    if (retained.has(index)) {
      samples.push(
        Object.freeze({
          x: index % width,
          y: Math.floor(index / width),
          heightBase,
          heightAdjustment: 0,
          mask,
        }),
      )
    }
  }
  const gatewayVersion = view.getUint32(offset, true)
  const gatewayCount = view.getUint32(offset + 4, true)
  const gatewayEnd = offset + 8 + gatewayCount * 4
  if (gatewayVersion !== 1 || !Number.isSafeInteger(gatewayEnd) || gatewayEnd > bytes.byteLength) {
    throw new TypeError(`${document.path}: Warzone game.map gateway table is invalid`)
  }
  for (let gatewayOffset = offset + 8; gatewayOffset < gatewayEnd; gatewayOffset += 4) {
    const x1 = view.getUint8(gatewayOffset)
    const y1 = view.getUint8(gatewayOffset + 1)
    const x2 = view.getUint8(gatewayOffset + 2)
    const y2 = view.getUint8(gatewayOffset + 3)
    if (x1 >= width || x2 >= width || y1 >= height || y2 >= height) {
      throw new TypeError(`${document.path}: Warzone game.map gateway leaves the terrain grid`)
    }
  }
  return Object.freeze({
    version,
    width,
    height,
    cellCount,
    minimumHeightBase,
    maximumHeightBase,
    minimumHeightAdjustment: 0,
    maximumHeightAdjustment: 0,
    trailingBytes: bytes.byteLength - gatewayEnd,
    samples: Object.freeze(samples),
  })
}

function exactTerrainGrid(terrain) {
  return (
    terrain.samples.length === terrain.cellCount &&
    terrain.samples.every(
      (sample, index) =>
        sample.x === index % terrain.width && sample.y === Math.floor(index / terrain.width),
    )
  )
}

function nativeTransform(terrain, path, snapshotId) {
  if (!exactTerrainGrid(terrain)) return undefined
  return Object.freeze({
    schemaVersion: 1,
    snapshotId,
    descriptorVersion: terrain.version,
    source: Object.freeze({
      terrainDocumentPath: path,
      format: 'warzone-game-map',
      heightEncoding: terrain.version >= 40 ? 'uint16-le' : 'uint8-times-2',
    }),
    heightMap: Object.freeze({
      dim: Object.freeze([terrain.width, terrain.height]),
      offset: Object.freeze({ x: 0, y: 0, z: 0 }),
      scale: Object.freeze({ x: TILE_UNITS, y: TILE_UNITS, z: 1 }),
    }),
    mapping: Object.freeze({
      horizontal: 'offset-plus-grid-index-times-scale',
      vertical: 'direct-base-times-scale-plus-offset',
    }),
    bounds: Object.freeze({
      coordinateSpaceId: 'map-native',
      minimum: Object.freeze({ x: 0, y: 0, z: terrain.minimumHeightBase }),
      maximum: Object.freeze({
        x: (terrain.width - 1) * TILE_UNITS,
        y: (terrain.height - 1) * TILE_UNITS,
        z: terrain.maximumHeightBase,
      }),
    }),
  })
}

function uvwTransform(transform) {
  const columns = transform.heightMap.dim[0]
  const rows = transform.heightMap.dim[1]
  const canonicalNumber = value => (value === 0 ? 0 : value)
  return Object.freeze({
    schemaVersion: 1,
    snapshotId: transform.snapshotId,
    sourceCoordinateSpaceId: 'map-native',
    targetCoordinateSpaceId: 'uvw-canonical',
    basis: Object.freeze({
      handedness: 'right',
      upAxis: 'y',
      forwardAxis: '+z',
      unit: 'source-unit',
      sourceUnit: 'warzone-world-unit',
      unitsPerCell: TILE_UNITS,
    }),
    axes: Object.freeze({
      x: Object.freeze({ sourceAxis: 'x', scale: 1, offset: 0 }),
      y: Object.freeze({ sourceAxis: 'z', scale: 1, offset: 0 }),
      z: Object.freeze({ sourceAxis: 'y', scale: -1, offset: 0 }),
    }),
    heightfield: Object.freeze({
      columns,
      rows,
      cellSize: TILE_UNITS,
      origin: Object.freeze([0, 0, -((rows - 1) * TILE_UNITS)]),
      sourceRowOrder: 'reverse',
    }),
    bounds: Object.freeze({
      coordinateSpaceId: 'uvw-canonical',
      minimum: Object.freeze({
        x: canonicalNumber(transform.bounds.minimum.x),
        y: canonicalNumber(transform.bounds.minimum.z),
        z: canonicalNumber(-transform.bounds.maximum.y),
      }),
      maximum: Object.freeze({
        x: canonicalNumber(transform.bounds.maximum.x),
        y: canonicalNumber(transform.bounds.maximum.z),
        z: canonicalNumber(-transform.bounds.minimum.y),
      }),
    }),
    proof: WARZONE_WORLD_ORACLE,
  })
}

export async function openWarzoneMap(request) {
  request?.signal?.throwIfAborted()
  const value = validateRequest(request)
  const document = value.documents.find(item => basename(item.path) === 'game.map')
  const diagnostics = []
  let terrain
  if (document === undefined) {
    diagnostics.push(
      diagnostic(
        'error',
        'org.modkitx.opensource.warzone2100/map-document-missing',
        'required map document game.map is missing',
      ),
    )
  } else {
    try {
      terrain = parseGameMap(document, value)
    } catch (error) {
      diagnostics.push(
        diagnostic(
          'error',
          'org.modkitx.opensource.warzone2100/map-document-invalid',
          error instanceof Error ? error.message : String(error),
          document.path,
        ),
      )
    }
  }
  return Object.freeze({
    schemaVersion: 1,
    workspaceId: value.workspaceId,
    gameId: value.gameId,
    mapId: value.mapId,
    analyzerId: ANALYZER_ID,
    documentPaths: Object.freeze(value.documents.map(item => item.path)),
    ...(terrain === undefined ? {} : { terrain }),
    regions: Object.freeze([]),
    objects: Object.freeze([]),
    catalogQueries: Object.freeze([]),
    resolvedCatalogObjects: 0,
    diagnostics: Object.freeze(diagnostics),
    complete: terrain !== undefined && diagnostics.every(item => item.severity !== 'error'),
  })
}

function stringArray(value, label) {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new TypeError(`${label} must be an array of strings`)
  }
  return value
}

export async function analyzeWarzoneMapWorkspace(request) {
  request?.signal?.throwIfAborted()
  const value = validateRequest(request)
  const snapshotId = nonEmptyString(value.snapshotId, 'snapshotId')
  const unresolvedRequirementIds = stringArray(
    value.unresolvedRequirementIds,
    'unresolvedRequirementIds',
  )
  const requiredRequirementIds = new Set(
    stringArray(value.requiredRequirementIds, 'requiredRequirementIds'),
  )
  positiveLimit(value.maxDiagnostics, 'maxDiagnostics', MAXIMUM_DIAGNOSTICS)
  const semantic = await openWarzoneMap(request)
  const terrainDocument = value.documents.find(item => basename(item.path) === 'game.map')
  const terrainTransform =
    semantic.terrain === undefined || terrainDocument === undefined
      ? undefined
      : nativeTransform(semantic.terrain, terrainDocument.path, snapshotId)
  const canonicalTransform =
    terrainTransform === undefined ? undefined : uvwTransform(terrainTransform)
  const diagnostics = unresolvedRequirementIds.map(requirementId =>
    diagnostic(
      requiredRequirementIds.has(requirementId) ? 'error' : 'information',
      'org.modkitx.opensource.warzone2100/map-planned-resource-unresolved',
      `planned map resource ${requirementId} did not resolve through the resource session`,
    ),
  )
  return Object.freeze({
    schemaVersion: 1,
    workspaceId: semantic.workspaceId,
    gameId: semantic.gameId,
    mapId: semantic.mapId,
    analyzerId: ANALYZER_ID,
    snapshotId,
    semantic,
    ...(terrainTransform === undefined ? {} : { terrainTransform }),
    ...(canonicalTransform === undefined ? {} : { uvwTransform: canonicalTransform }),
    worldCandidate: Object.freeze({
      contract: WARZONE_WORLD_SCENE_SOURCE_CONTRACT,
      major: 1,
      maturity: 'publisher-candidate',
      coordinateSpaces: Object.freeze([
        Object.freeze({
          id: 'height-grid',
          horizontalAxes: Object.freeze(['column', 'row']),
          verticalAxis: 'direct-height',
          handedness: 'array-row-major',
          linearUnit: 'grid-index',
          rotationUnit: 'not-applicable',
          origin: 'grid-zero',
        }),
        Object.freeze({
          id: 'map-native',
          horizontalAxes: Object.freeze(['x', 'y']),
          verticalAxis: 'z',
          handedness: 'right',
          linearUnit: 'warzone-world-unit',
          rotationUnit: 'degree',
          origin: 'game-map-north-west-tile',
        }),
        Object.freeze({
          id: 'uvw-canonical',
          horizontalAxes: Object.freeze(['x', 'z']),
          verticalAxis: 'y',
          handedness: 'right',
          linearUnit: 'warzone-world-unit',
          rotationUnit: 'radian',
          origin: 'warzone-south-west-heightfield-corner',
        }),
      ]),
      crossSpaceTransforms: Object.freeze([
        Object.freeze({
          from: 'height-grid',
          to: 'map-native',
          state: terrainTransform === undefined ? 'unknown' : 'known',
          ...(terrainTransform === undefined
            ? { reason: 'an exact complete game.map height grid is unavailable' }
            : {}),
        }),
        Object.freeze({
          from: 'map-native',
          to: 'uvw-canonical',
          state: canonicalTransform === undefined ? 'unknown' : 'known',
          ...(canonicalTransform === undefined
            ? { reason: 'a validated exact native terrain transform is unavailable' }
            : {}),
        }),
      ]),
      unknownFacets: Object.freeze([
        'objects-and-structures',
        'terrain-material-layers',
        'water',
        'navigation',
        'scenario-runtime',
        'lighting',
        'physics',
      ]),
    }),
    unresolvedRequirementIds: Object.freeze([...unresolvedRequirementIds]),
    diagnostics: Object.freeze(diagnostics),
    diagnosticsTruncated: false,
    complete:
      semantic.complete &&
      diagnostics.every(item => item.severity !== 'error') &&
      unresolvedRequirementIds.every(item => !requiredRequirementIds.has(item)),
  })
}

export const abiVersion = 1
export const provides = Object.freeze([
  MAP_SEMANTIC_ANALYSIS_CONTRACT,
  RESOLVED_MAP_WORKSPACE_CONTRACT,
])

export function createProvider(selection) {
  if (
    (selection.contract !== MAP_SEMANTIC_ANALYSIS_CONTRACT &&
      selection.contract !== RESOLVED_MAP_WORKSPACE_CONTRACT) ||
    selection.major !== 1
  ) {
    throw new TypeError(
      `unsupported semantic-map selection ${selection.contract}@${selection.major}`,
    )
  }
  const value =
    selection.contract === MAP_SEMANTIC_ANALYSIS_CONTRACT
      ? Object.freeze({
          contract: MAP_SEMANTIC_ANALYSIS_CONTRACT,
          analyzerId: ANALYZER_ID,
          gameIds: Object.freeze([GAME_ID]),
          open: openWarzoneMap,
        })
      : Object.freeze({
          contract: RESOLVED_MAP_WORKSPACE_CONTRACT,
          analyzerId: ANALYZER_ID,
          gameIds: Object.freeze([GAME_ID]),
          plan: planWarzoneMap,
          analyze: analyzeWarzoneMapWorkspace,
        })
  return Object.freeze({ value, release: async () => undefined })
}
