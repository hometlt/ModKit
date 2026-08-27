import { parseXml } from '@rgrove/parse-xml'
import {
  MAP_SEMANTIC_ANALYSIS_CONTRACT,
  RESOLVED_MAP_WORKSPACE_CONTRACT,
} from '@modkitx-x3/sdk/maps'

const ANALYZER_ID = 'org.modkitx.blizzard.starcraft2.maps'
const GAME_ID = 'org.modkitx/starcraft-2'
export const SC2_WORLD_SCENE_SOURCE_CONTRACT = 'org.modkitx.blizzard.starcraft2/world-scene-source'
const MAXIMUM_DOCUMENTS = 16
const MAXIMUM_DOCUMENT_BYTES = 16_777_216
const MAXIMUM_TOTAL_BYTES = 33_554_432
const MAXIMUM_OBJECTS = 100_000
const MAXIMUM_REGIONS = 10_000
const MAXIMUM_TERRAIN_CELLS = 4_194_304
// Full native-grid publication remains caller-bounded by maxTerrainCells and ResourceBudget.maxNodes.
const MAXIMUM_TERRAIN_SAMPLES = MAXIMUM_TERRAIN_CELLS
const MAXIMUM_DEPTH = 128
const MAXIMUM_DIAGNOSTICS = 10_000
const textDecoder = new TextDecoder()

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
    throw new TypeError(`StarCraft II map analysis cannot inspect ${String(value.gameId)}`)
  }
  const maxDocuments = positiveLimit(value.maxDocuments, 'maxDocuments', MAXIMUM_DOCUMENTS)
  const maxDocumentBytes = positiveLimit(
    value.maxDocumentBytes,
    'maxDocumentBytes',
    MAXIMUM_DOCUMENT_BYTES,
  )
  const maxTotalBytes = positiveLimit(value.maxTotalBytes, 'maxTotalBytes', MAXIMUM_TOTAL_BYTES)
  positiveLimit(value.maxObjects, 'maxObjects', MAXIMUM_OBJECTS)
  positiveLimit(value.maxRegions, 'maxRegions', MAXIMUM_REGIONS)
  positiveLimit(value.maxTerrainCells, 'maxTerrainCells', MAXIMUM_TERRAIN_CELLS)
  positiveLimit(value.maxTerrainSamples, 'maxTerrainSamples', MAXIMUM_TERRAIN_SAMPLES)
  positiveLimit(value.maxDepth, 'maxDepth', MAXIMUM_DEPTH)
  if (!Array.isArray(value.documents) || value.documents.length > maxDocuments) {
    throw new TypeError(
      `documents must be an array with at most maxDocuments (${maxDocuments}) entries`,
    )
  }
  let totalBytes = 0
  const paths = new Set()
  value.documents.forEach((document, index) => {
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
  })
  if (totalBytes > maxTotalBytes) {
    throw new TypeError(`document bytes exceeds maxTotalBytes (${totalBytes} > ${maxTotalBytes})`)
  }
  const catalog = value.catalog
  if (catalog !== undefined) {
    const snapshot = recordOf(catalog)
    if (
      snapshot?.schemaVersion !== 1 ||
      snapshot.workspaceId !== value.workspaceId ||
      snapshot.gameId !== value.gameId ||
      !Array.isArray(snapshot.entities)
    ) {
      throw new TypeError('catalog must be a matching semantic data snapshot')
    }
  }
  return value
}

function basename(path) {
  return path.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() ?? ''
}

function immutablePlanDiagnostic(severity, code, message, path) {
  return Object.freeze({ severity, code, message, ...(path === undefined ? {} : { path }) })
}

/** Provider-owned logical document plan; the generic host owns every VFS/ResourceSession read. */
export async function planStarcraft2Map(request) {
  request?.signal?.throwIfAborted()
  const value = recordOf(request)
  if (value === undefined) throw new TypeError('semantic map plan request must be an object')
  const workspace = recordOf(value.workspace)
  if (
    workspace?.schemaVersion !== 1 ||
    workspace.gameId !== GAME_ID ||
    !Array.isArray(workspace.loadOrder)
  ) {
    throw new TypeError('workspace must be a StarCraft II ModWorkspaceLock')
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
        immutablePlanDiagnostic(
          'error',
          'org.modkitx.blizzard.starcraft2/map-active-root-unavailable',
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
  const required = root.toLowerCase().endsWith('.sc2map') || active.kind === 'map'
  const requested = [
    ['map-objects', 'objects', 'objects', required],
    ['map-regions', 'regions', 'regions', required],
    ['map-terrain-height', 't3heightmap', 'terrain-height', required],
    ['map-terrain-native-parameters', 't3terrain.xml', 'terrain-native-parameters', false],
    ['map-navigation', 't3syncpathinginfo', 'navigation', false],
  ].map(([requirementId, name, kind, itemRequired]) =>
    Object.freeze({
      requirementId,
      path: `${root}/${name}`,
      kind,
      required: itemRequired,
    }),
  )
  const complete = requested.length <= maxRequirements
  const requirements = Object.freeze(requested.slice(0, maxRequirements))
  return Object.freeze({
    schemaVersion: 1,
    workspaceId: String(workspace.workspaceId),
    gameId: GAME_ID,
    mapId: root,
    analyzerId: ANALYZER_ID,
    requirements,
    diagnostics: Object.freeze(
      complete
        ? []
        : [
            immutablePlanDiagnostic(
              'error',
              'org.modkitx.blizzard.starcraft2/map-plan-budget-exceeded',
              `map plan needs ${requested.length} requirements but maxRequirements is ${maxRequirements}`,
            ),
          ],
    ),
    complete,
  })
}

function elementChildren(node) {
  return (node.children ?? []).filter(child => child.type === 'element')
}

function xmlRoot(document, expectedName, maxDepth) {
  const text = textDecoder.decode(document.bytes)
  if (/<!DOCTYPE|<!ENTITY/iu.test(text)) {
    throw new TypeError(`${document.path}: DTD and custom entities are forbidden`)
  }
  const parsed = parseXml(text)
  const root = parsed.children?.find(child => child.type === 'element')
  if (root === undefined || root.name.toLowerCase() !== expectedName.toLowerCase()) {
    throw new TypeError(`${document.path}: expected ${expectedName} XML root`)
  }
  const stack = [{ node: root, depth: 1 }]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current.depth > maxDepth) {
      throw new TypeError(`${document.path}: XML depth exceeds maxDepth (${maxDepth})`)
    }
    for (const child of elementChildren(current.node)) {
      stack.push({ node: child, depth: current.depth + 1 })
    }
  }
  return root
}

function finiteNumber(value, label, fallback) {
  if (value === undefined && fallback !== undefined) return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`)
  return number
}

function safeInteger(value, label, fallback) {
  const number = finiteNumber(value, label, fallback)
  if (!Number.isSafeInteger(number)) throw new TypeError(`${label} must be a safe integer`)
  return number
}

function vector(value, label, fallback) {
  const source = value ?? fallback
  const parts = String(source)
    .split(',')
    .map(item => Number(item.trim()))
  if ((parts.length !== 2 && parts.length !== 3) || parts.some(item => !Number.isFinite(item))) {
    throw new TypeError(`${label} must contain two or three finite comma-separated numbers`)
  }
  return Object.freeze({ x: parts[0], y: parts[1], z: parts[2] ?? 0 })
}

function optionalFinite(value, label) {
  return value === undefined ? undefined : finiteNumber(value, label)
}

function parseObjects(document, request) {
  const root = xmlRoot(document, 'PlacedObjects', request.maxDepth)
  const objects = []
  for (const element of elementChildren(root)) {
    const attributes = element.attributes ?? {}
    const objectId = safeInteger(attributes.Id, `${document.path}:${element.name}.Id`, 0)
    const common = {
      objectId,
      position: vector(attributes.Position, `${document.path}:${objectId}.Position`, '0,0,0'),
    }
    let object
    if (element.name === 'ObjectUnit') {
      object = {
        ...common,
        kind: 'unit',
        typeId: String(attributes.UnitType ?? ''),
        player: safeInteger(attributes.Player, `${document.path}:${objectId}.Player`, 0),
        variation: safeInteger(attributes.Variation, `${document.path}:${objectId}.Variation`, 0),
        scale: vector(attributes.Scale, `${document.path}:${objectId}.Scale`, '1,1,1'),
        rotation: optionalFinite(attributes.Rotation, `${document.path}:${objectId}.Rotation`),
      }
    } else if (element.name === 'ObjectDoodad') {
      object = {
        ...common,
        kind: 'doodad',
        typeId: String(attributes.Type ?? ''),
        variation: safeInteger(attributes.Variation, `${document.path}:${objectId}.Variation`, 0),
        scale: vector(attributes.Scale, `${document.path}:${objectId}.Scale`, '1,1,1'),
        rotation: optionalFinite(attributes.Rotation, `${document.path}:${objectId}.Rotation`),
      }
    } else if (element.name === 'ObjectPoint') {
      object = {
        ...common,
        kind: 'point',
        typeId: String(attributes.Type ?? ''),
        name: attributes.Name,
        scale: vector(attributes.Scale, `${document.path}:${objectId}.Scale`, '1,1,1'),
        rotation: optionalFinite(attributes.Rotation, `${document.path}:${objectId}.Rotation`),
      }
    } else if (element.name === 'ObjectCamera') {
      object = {
        ...common,
        kind: 'camera',
        name: attributes.Name,
        scale:
          attributes.Scale === undefined
            ? undefined
            : vector(attributes.Scale, `${document.path}:${objectId}.Scale`, '1,1,1'),
        rotation: optionalFinite(attributes.Rotation, `${document.path}:${objectId}.Rotation`),
      }
    }
    if (object === undefined) continue
    if (objects.length >= request.maxObjects) {
      throw new TypeError(
        `${document.path}: placed objects exceeds maxObjects (${request.maxObjects})`,
      )
    }
    objects.push(
      Object.freeze(
        Object.fromEntries(Object.entries(object).filter(([, item]) => item !== undefined)),
      ),
    )
  }
  return objects
}

function childValue(node, name) {
  const child = elementChildren(node).find(item => item.name.toLowerCase() === name.toLowerCase())
  const value = child?.attributes?.value
  return value === undefined ? undefined : String(value)
}

function parseRegions(document, request) {
  const root = xmlRoot(document, 'Regions', request.maxDepth)
  const regions = []
  for (const element of elementChildren(root)) {
    if (element.name.toLowerCase() !== 'region') continue
    if (regions.length >= request.maxRegions) {
      throw new TypeError(`${document.path}: regions exceeds maxRegions (${request.maxRegions})`)
    }
    const regionId = safeInteger(element.attributes?.id, `${document.path}:region.id`, 0)
    const shapes = elementChildren(element)
      .filter(child => child.name.toLowerCase() === 'shape')
      .map(shape =>
        Object.freeze({
          type: String(shape.attributes?.type ?? 'unknown'),
          parameters: Object.freeze(
            Object.fromEntries(
              elementChildren(shape).flatMap(child => {
                const value = child.attributes?.value
                return value === undefined ? [] : [[child.name, String(value)]]
              }),
            ),
          ),
        }),
      )
    const color = childValue(element, 'color')
    regions.push(
      Object.freeze({
        regionId,
        name: childValue(element, 'name') ?? '',
        ...(color === undefined ? {} : { color }),
        shapes: Object.freeze(shapes),
      }),
    )
  }
  return regions
}

function parseTerrain(document, request) {
  const bytes = document.bytes
  if (bytes.byteLength < 32) throw new TypeError(`${document.path}: HMAP header is truncated`)
  if (textDecoder.decode(bytes.subarray(0, 4)) !== 'HMAP') {
    throw new TypeError(`${document.path}: HMAP magic is missing`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint32(4, true)
  if (version !== 101) throw new TypeError(`${document.path}: unsupported HMAP version ${version}`)
  const width = view.getUint32(8, true)
  const height = view.getUint32(12, true)
  const cellCount = width * height
  if (!Number.isSafeInteger(cellCount) || cellCount <= 0 || cellCount > request.maxTerrainCells) {
    throw new TypeError(
      `${document.path}: terrain cells exceeds maxTerrainCells (${cellCount} > ${request.maxTerrainCells})`,
    )
  }
  const required = 32 + cellCount * 6
  if (!Number.isSafeInteger(required) || required > bytes.byteLength) {
    throw new TypeError(`${document.path}: HMAP cell array is truncated`)
  }
  const sampleCount = Math.min(cellCount, request.maxTerrainSamples)
  const retainsFullGrid = sampleCount === cellCount
  const sampleIndices = new Set()
  if (!retainsFullGrid) {
    for (let index = 0; index < sampleCount; index += 1) {
      sampleIndices.add(
        sampleCount === 1 ? 0 : Math.floor((index * (cellCount - 1)) / (sampleCount - 1)),
      )
    }
  }
  let minimumHeightBase = 0xffff
  let maximumHeightBase = 0
  let minimumHeightAdjustment = 0xffff
  let maximumHeightAdjustment = 0
  let cliffCellCount = 0
  const samples = []
  for (let index = 0; index < cellCount; index += 1) {
    const offset = 32 + index * 6
    const heightBase = view.getUint16(offset, true)
    const heightAdjustment = view.getUint16(offset + 2, true)
    const mask = view.getUint16(offset + 4, true)
    minimumHeightBase = Math.min(minimumHeightBase, heightBase)
    maximumHeightBase = Math.max(maximumHeightBase, heightBase)
    minimumHeightAdjustment = Math.min(minimumHeightAdjustment, heightAdjustment)
    maximumHeightAdjustment = Math.max(maximumHeightAdjustment, heightAdjustment)
    if ((mask & 0x9000) !== 0) cliffCellCount += 1
    if (retainsFullGrid || sampleIndices.has(index)) {
      samples.push(
        Object.freeze({
          x: index % width,
          y: Math.floor(index / width),
          heightBase,
          heightAdjustment,
          mask,
        }),
      )
    }
  }
  return Object.freeze({
    version,
    width,
    height,
    cellCount,
    minimumHeightBase,
    maximumHeightBase,
    minimumHeightAdjustment,
    maximumHeightAdjustment,
    cliffCellCount,
    trailingBytes: bytes.byteLength - required,
    samples: Object.freeze(samples),
  })
}

const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u

function requiredAttribute(node, name, label) {
  const value = node.attributes?.[name]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label}.${name} must be present`)
  }
  return value.trim()
}

function strictFinite(value, label) {
  if (!DECIMAL_NUMBER.test(value)) throw new TypeError(`${label} must be a decimal finite number`)
  const number = Number(value)
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`)
  return number
}

function whitespaceVector(value, count, label) {
  const parts = value.split(/\s+/u)
  if (parts.length !== count) {
    throw new TypeError(`${label} must contain exactly ${count} whitespace-separated numbers`)
  }
  return parts.map((item, index) => strictFinite(item, `${label}[${index}]`))
}

function oneChild(parent, name, label) {
  const matches = elementChildren(parent).filter(
    child => child.name.toLowerCase() === name.toLowerCase(),
  )
  if (matches.length !== 1) {
    throw new TypeError(`${label} must contain exactly one ${name} element`)
  }
  return matches[0]
}

function exactTerrainGrid(terrain) {
  if (terrain.samples.length !== terrain.cellCount) return false
  return terrain.samples.every(
    (sample, index) =>
      sample.x === index % terrain.width && sample.y === Math.floor(index / terrain.width),
  )
}

function mapNativePosition(sample, heightMap, vertData) {
  const base = sample.heightBase * vertData.quantizeScale - vertData.quantizeBias
  const adjustment = sample.heightAdjustment * vertData.quantizeScale - vertData.quantizeBias
  const position = Object.freeze({
    x: heightMap.offset.x + sample.x * heightMap.scale.x,
    y: heightMap.offset.y + sample.y * heightMap.scale.y,
    z: base * heightMap.scale.z + heightMap.offset.z + adjustment,
  })
  if (
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(position.z)
  ) {
    throw new TypeError('t3Terrain.xml native terrain mapping produced a non-finite position')
  }
  return position
}

function parseTerrainTransform(document, terrain, heightDocumentPath, snapshotId, request) {
  const root = xmlRoot(document, 'terrain', request.maxDepth)
  const descriptorVersion = strictFinite(
    requiredAttribute(root, 'version', `${document.path}:terrain`),
    `${document.path}:terrain.version`,
  )
  if (!Number.isSafeInteger(descriptorVersion) || descriptorVersion <= 0) {
    throw new TypeError(`${document.path}:terrain.version must be a positive safe integer`)
  }
  const heightMapElement = oneChild(root, 'heightMap', `${document.path}:terrain`)
  const vertDataElement = oneChild(
    heightMapElement,
    'vertData',
    `${document.path}:terrain.heightMap`,
  )
  const dimValues = whitespaceVector(
    requiredAttribute(heightMapElement, 'dim', `${document.path}:terrain.heightMap`),
    2,
    `${document.path}:terrain.heightMap.dim`,
  )
  if (!dimValues.every(item => Number.isSafeInteger(item) && item > 0)) {
    throw new TypeError(
      `${document.path}:terrain.heightMap.dim must contain positive safe integers`,
    )
  }
  const offsetValues = whitespaceVector(
    requiredAttribute(heightMapElement, 'offset', `${document.path}:terrain.heightMap`),
    3,
    `${document.path}:terrain.heightMap.offset`,
  )
  const scaleValues = whitespaceVector(
    requiredAttribute(heightMapElement, 'scale', `${document.path}:terrain.heightMap`),
    3,
    `${document.path}:terrain.heightMap.scale`,
  )
  if (!scaleValues.every(item => item > 0)) {
    throw new TypeError(`${document.path}:terrain.heightMap.scale must contain positive numbers`)
  }
  const vertData = Object.freeze({
    quantizeBias: strictFinite(
      requiredAttribute(
        vertDataElement,
        'quantizeBias',
        `${document.path}:terrain.heightMap.vertData`,
      ),
      `${document.path}:terrain.heightMap.vertData.quantizeBias`,
    ),
    quantizeScale: strictFinite(
      requiredAttribute(
        vertDataElement,
        'quantizeScale',
        `${document.path}:terrain.heightMap.vertData`,
      ),
      `${document.path}:terrain.heightMap.vertData.quantizeScale`,
    ),
    standardHeight: strictFinite(
      requiredAttribute(
        vertDataElement,
        'standardHeight',
        `${document.path}:terrain.heightMap.vertData`,
      ),
      `${document.path}:terrain.heightMap.vertData.standardHeight`,
    ),
  })
  if (vertData.quantizeScale <= 0) {
    throw new TypeError(
      `${document.path}:terrain.heightMap.vertData.quantizeScale must be positive`,
    )
  }
  const dim = Object.freeze([dimValues[0], dimValues[1]])
  if (dim[0] !== terrain.width || dim[1] !== terrain.height) {
    throw new TypeError(
      `${document.path}: terrain dim ${dim.join('x')} does not match HMAP ${terrain.width}x${terrain.height}`,
    )
  }
  const heightMap = Object.freeze({
    dim,
    offset: Object.freeze({ x: offsetValues[0], y: offsetValues[1], z: offsetValues[2] }),
    scale: Object.freeze({ x: scaleValues[0], y: scaleValues[1], z: scaleValues[2] }),
  })
  if (!exactTerrainGrid(terrain)) return undefined

  let minimum = Object.freeze({ x: Infinity, y: Infinity, z: Infinity })
  let maximum = Object.freeze({ x: -Infinity, y: -Infinity, z: -Infinity })
  for (const sample of terrain.samples) {
    const position = mapNativePosition(sample, heightMap, vertData)
    minimum = Object.freeze({
      x: Math.min(minimum.x, position.x),
      y: Math.min(minimum.y, position.y),
      z: Math.min(minimum.z, position.z),
    })
    maximum = Object.freeze({
      x: Math.max(maximum.x, position.x),
      y: Math.max(maximum.y, position.y),
      z: Math.max(maximum.z, position.z),
    })
  }
  return Object.freeze({
    schemaVersion: 1,
    snapshotId,
    descriptorVersion,
    source: Object.freeze({
      terrainDocumentPath: document.path,
      heightDocumentPath,
      rootElement: 'terrain',
      heightMapElement: 'heightMap',
      quantizationElement: 'vertData',
    }),
    heightMap,
    vertData,
    mapping: Object.freeze({
      horizontal: 'offset-plus-grid-index-times-scale',
      vertical: 'dequantized-base-times-scale-plus-offset-plus-dequantized-adjustment',
    }),
    bounds: Object.freeze({ coordinateSpaceId: 'map-native', minimum, maximum }),
  })
}

const SC2_WORLD_ORACLE = Object.freeze({
  kind: 'adapter-qualification',
  method: 'sealed-legacy-differential',
  oracle: 'modkitx@1a14ba4eddd0ae88de273348ebd44cfb98a0581d',
  corpus: 'StarCraft II 5.0.16.97563/TArcade.SC2Map',
  sourceDigests: Object.freeze({
    t3HeightMap: 'sha256:e4223f50d2350a350ac046395368470540f63b02cfa281ec4732d5c47738e83e',
    t3Terrain: 'sha256:994658707b6a56dd2b6261e9114b61ee10095a0801d57cbdc0dcec82181bcc6f',
  }),
  tupleCount: 66_049,
  comparison: 'ieee-754-binary64-exact',
  nativeTupleDigest: 'sha256:c3419baf0f7834682342035b3d1d485a21a0f30adc7712e6a7424dc3c075e8e7',
  presentationTupleDigest:
    'sha256:4befdf3b649b32c3e9f96c927df9a18b73f35a2c49db57148056ba5d6422794a',
  canonicalTupleDigest: 'sha256:dc1cb1b5d7a09b797721b79f158039141828cb567f2b8fd733d0a2dff108ba5b',
})

/** Candidate transform ratified by multiverse/specs world ADR-WORLD-001. */
function sc2WorldCanonicalTransform(transform) {
  const { dim, offset, scale } = transform.heightMap
  if (scale.x !== scale.y) return undefined
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
      sourceUnit: 'sc2-game-unit',
      unitsPerCell: scale.x,
    }),
    axes: Object.freeze({
      x: Object.freeze({ sourceAxis: 'x', scale: 1, offset: 0 }),
      y: Object.freeze({ sourceAxis: 'z', scale: 1, offset: 0 }),
      z: Object.freeze({ sourceAxis: 'y', scale: -1, offset: 0 }),
    }),
    heightfield: Object.freeze({
      columns: dim[0],
      rows: dim[1],
      cellSize: scale.x,
      origin: Object.freeze([
        canonicalNumber(offset.x),
        0,
        canonicalNumber(-(offset.y + (dim[1] - 1) * scale.y)),
      ]),
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
    proof: SC2_WORLD_ORACLE,
  })
}

function parseNavigation(document, request) {
  const bytes = document.bytes
  if (bytes.byteLength < 32) throw new TypeError(`${document.path}: PATH header is truncated`)
  if (textDecoder.decode(bytes.subarray(0, 4)) !== 'PATH') {
    throw new TypeError(`${document.path}: PATH magic is missing`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint32(4, true)
  const width = view.getUint32(8, true)
  const height = view.getUint32(12, true)
  const cellCount = width * height
  if (!Number.isSafeInteger(cellCount) || cellCount <= 0 || cellCount > request.maxTerrainCells) {
    throw new TypeError(
      `${document.path}: navigation cells exceeds maxTerrainCells (${cellCount} > ${request.maxTerrainCells})`,
    )
  }
  const required = 32 + cellCount * 2
  if (!Number.isSafeInteger(required) || required > bytes.byteLength) {
    throw new TypeError(`${document.path}: PATH cell array is truncated`)
  }
  const sampleCount = Math.min(cellCount, request.maxTerrainSamples)
  const sampleIndices = new Set()
  for (let index = 0; index < sampleCount; index += 1) {
    sampleIndices.add(
      sampleCount === 1 ? 0 : Math.floor((index * (cellCount - 1)) / (sampleCount - 1)),
    )
  }
  let minimumFlags = 0xffff
  let maximumFlags = 0
  const samples = []
  for (let index = 0; index < cellCount; index += 1) {
    const flags = view.getUint16(32 + index * 2, true)
    minimumFlags = Math.min(minimumFlags, flags)
    maximumFlags = Math.max(maximumFlags, flags)
    if (sampleIndices.has(index)) {
      samples.push(Object.freeze({ x: index % width, y: Math.floor(index / width), flags }))
    }
  }
  return Object.freeze({
    version,
    width,
    height,
    cellCount,
    minimumFlags,
    maximumFlags,
    trailingBytes: bytes.byteLength - required,
    samples: Object.freeze(samples),
  })
}

function duplicateIdentityDiagnostics(items, key, label, path) {
  const seen = new Set()
  const diagnostics = []
  for (const item of items) {
    const identity = item[key]
    if (seen.has(identity)) {
      diagnostics.push(
        Object.freeze({
          severity: 'error',
          code: `org.modkitx.blizzard.starcraft2/map-${label}-id-duplicate`,
          message: `${path}: duplicate ${label} identity ${String(identity)}`,
          path,
          [`${label}Id`]: identity,
        }),
      )
    }
    seen.add(identity)
  }
  return diagnostics
}

function catalogEntityKey(namespace, entityId) {
  return `${namespace}\u0000${entityId}`
}

function bindCatalog(objects, catalog, diagnostics) {
  const queries = []
  const queryKeys = new Set()
  for (const object of objects) {
    if (object.kind !== 'unit' || object.typeId.length === 0) continue
    const ref = Object.freeze({ namespace: 'Unit', entityId: object.typeId })
    const key = catalogEntityKey(ref.namespace, ref.entityId)
    if (!queryKeys.has(key)) {
      queryKeys.add(key)
      queries.push(ref)
    }
  }
  const entities = new Map(
    (catalog?.entities ?? []).map(entity => [
      catalogEntityKey(entity.namespace, entity.entityId),
      entity,
    ]),
  )
  const missing = new Map()
  let resolvedCatalogObjects = 0
  const bound = objects.map(object => {
    if (object.kind !== 'unit' || object.typeId.length === 0) return object
    const ref = Object.freeze({ namespace: 'Unit', entityId: object.typeId })
    const entity = entities.get(catalogEntityKey(ref.namespace, ref.entityId))
    if (entity === undefined) missing.set(catalogEntityKey(ref.namespace, ref.entityId), ref)
    else resolvedCatalogObjects += 1
    return Object.freeze({
      ...object,
      catalog: Object.freeze({ ref, ...(entity === undefined ? {} : { entity }) }),
    })
  })
  if (queries.length > 0 && catalog === undefined) {
    diagnostics.push({
      severity: 'information',
      code: 'org.modkitx.blizzard.starcraft2/map-catalog-required',
      message: `reopen with the ${queries.length} catalogQueries to bind placed units to schema entities`,
    })
  } else {
    for (const ref of missing.values()) {
      diagnostics.push({
        severity: 'error',
        code: 'org.modkitx.blizzard.starcraft2/map-catalog-entity-unresolved',
        message: `placed units reference unavailable catalog entity ${ref.namespace}/${ref.entityId}`,
        catalogRef: ref,
      })
    }
  }
  return {
    objects: Object.freeze(bound),
    catalogQueries: Object.freeze(queries),
    resolvedCatalogObjects,
  }
}

function diagnosticFor(error, path) {
  return Object.freeze({
    severity: 'error',
    code: 'org.modkitx.blizzard.starcraft2/map-document-invalid',
    message: error instanceof Error ? error.message : String(error),
    path,
  })
}

export async function openStarcraft2Map(request) {
  request.signal?.throwIfAborted()
  const value = validateRequest(request)
  const diagnostics = []
  const documents = new Map(value.documents.map(document => [basename(document.path), document]))
  const objectsDocument = documents.get('objects') ?? documents.get('mapobjects')
  const regionsDocument = documents.get('regions')
  const terrainDocument = documents.get('t3heightmap') ?? documents.get('mapheightmap')
  let objects = []
  let regions = []
  let terrain
  for (const [label, document, parse, assign] of [
    ['Objects', objectsDocument, parseObjects, result => (objects = result)],
    ['Regions', regionsDocument, parseRegions, result => (regions = result)],
    ['t3HeightMap', terrainDocument, parseTerrain, result => (terrain = result)],
  ]) {
    request.signal?.throwIfAborted()
    if (document === undefined) {
      diagnostics.push(
        Object.freeze({
          severity: 'error',
          code: 'org.modkitx.blizzard.starcraft2/map-document-missing',
          message: `required map document ${label} is missing`,
        }),
      )
      continue
    }
    try {
      assign(parse(document, value))
    } catch (error) {
      diagnostics.push(diagnosticFor(error, document.path))
    }
  }
  request.signal?.throwIfAborted()
  const bound = bindCatalog(objects, value.catalog, diagnostics)
  const unitCount = bound.objects.filter(object => object.kind === 'unit').length
  const immutableDiagnostics = Object.freeze(diagnostics.map(item => Object.freeze(item)))
  return Object.freeze({
    schemaVersion: 1,
    workspaceId: value.workspaceId,
    gameId: value.gameId,
    mapId: value.mapId,
    analyzerId: ANALYZER_ID,
    documentPaths: Object.freeze(value.documents.map(document => document.path)),
    ...(terrain === undefined ? {} : { terrain }),
    regions: Object.freeze(regions),
    objects: bound.objects,
    catalogQueries: bound.catalogQueries,
    resolvedCatalogObjects: bound.resolvedCatalogObjects,
    diagnostics: immutableDiagnostics,
    complete:
      immutableDiagnostics.every(item => item.severity !== 'error') &&
      terrain !== undefined &&
      bound.objects.length > 0 &&
      regions.length > 0 &&
      (unitCount === 0 || bound.resolvedCatalogObjects === unitCount),
  })
}

function stringArray(value, label) {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new TypeError(`${label} must be an array of strings`)
  }
  return value
}

/** Additive workspace result; the frozen semantic snapshot is produced by the authoritative v1. */
export async function analyzeStarcraft2MapWorkspace(request) {
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
  const maxDiagnostics = positiveLimit(value.maxDiagnostics, 'maxDiagnostics', MAXIMUM_DIAGNOSTICS)
  const semantic = await openStarcraft2Map(request)
  const documents = new Map(value.documents.map(document => [basename(document.path), document]))
  const navigationDocument = documents.get('t3syncpathinginfo') ?? documents.get('mappathinginfo')
  const terrainParameterDocument = documents.get('t3terrain.xml')
  let navigation
  let terrainTransform
  let uvwTransform
  const diagnostics = []
  if (navigationDocument === undefined) {
    diagnostics.push(
      Object.freeze({
        severity: 'information',
        code: 'org.modkitx.blizzard.starcraft2/map-navigation-unavailable',
        message: 'navigation facet is unavailable because no PATH document resolved',
      }),
    )
  } else {
    try {
      navigation = parseNavigation(navigationDocument, value)
    } catch (error) {
      diagnostics.push(diagnosticFor(error, navigationDocument.path))
    }
  }
  if (terrainParameterDocument !== undefined && semantic.terrain !== undefined) {
    try {
      terrainTransform = parseTerrainTransform(
        terrainParameterDocument,
        semantic.terrain,
        documents.get('t3heightmap')?.path ?? documents.get('mapheightmap')?.path ?? 't3HeightMap',
        snapshotId,
        value,
      )
      if (terrainTransform !== undefined) {
        uvwTransform = sc2WorldCanonicalTransform(terrainTransform)
        if (uvwTransform === undefined) {
          diagnostics.push(
            Object.freeze({
              severity: 'information',
              code: 'org.modkitx.blizzard.starcraft2/uvw-non-uniform-cell-size',
              message:
                'UVW candidate materialization requires equal t3Terrain horizontal scale.x and scale.y',
              path: terrainParameterDocument.path,
            }),
          )
        }
      }
    } catch (error) {
      diagnostics.push(diagnosticFor(error, terrainParameterDocument.path))
    }
  }
  diagnostics.push(
    ...duplicateIdentityDiagnostics(
      semantic.objects,
      'objectId',
      'object',
      documents.get('objects')?.path ?? 'Objects',
    ),
    ...duplicateIdentityDiagnostics(
      semantic.regions,
      'regionId',
      'region',
      documents.get('regions')?.path ?? 'Regions',
    ),
  )
  for (const requirementId of unresolvedRequirementIds) {
    diagnostics.push(
      Object.freeze({
        severity: requiredRequirementIds.has(requirementId) ? 'error' : 'information',
        code: 'org.modkitx.blizzard.starcraft2/map-planned-resource-unresolved',
        message: `planned map resource ${requirementId} did not resolve through the resource session`,
      }),
    )
  }
  const totalDiagnostics = semantic.diagnostics.length + diagnostics.length
  const diagnosticsTruncated = totalDiagnostics > maxDiagnostics
  const retained = diagnosticsTruncated ? Math.max(0, maxDiagnostics - 1) : maxDiagnostics
  const semanticCount = Math.min(semantic.diagnostics.length, retained)
  const additiveCount = Math.min(diagnostics.length, retained - semanticCount)
  const boundedSemantic =
    diagnosticsTruncated || semanticCount !== semantic.diagnostics.length
      ? Object.freeze({
          ...semantic,
          diagnostics: Object.freeze(semantic.diagnostics.slice(0, semanticCount)),
          complete: false,
        })
      : semantic
  const immutableDiagnostics = Object.freeze([
    ...diagnostics.slice(0, additiveCount).map(item => Object.freeze(item)),
    ...(diagnosticsTruncated
      ? [
          Object.freeze({
            severity: 'warning',
            code: 'org.modkitx.blizzard.starcraft2/map-diagnostics-truncated',
            message: `workspace map diagnostics were truncated to maxDiagnostics ${maxDiagnostics}`,
          }),
        ]
      : []),
  ])
  return Object.freeze({
    schemaVersion: 1,
    workspaceId: semantic.workspaceId,
    gameId: semantic.gameId,
    mapId: semantic.mapId,
    analyzerId: ANALYZER_ID,
    snapshotId,
    semantic: boundedSemantic,
    ...(navigation === undefined ? {} : { navigation }),
    ...(terrainTransform === undefined ? {} : { terrainTransform }),
    ...(uvwTransform === undefined ? {} : { uvwTransform }),
    worldCandidate: Object.freeze({
      contract: SC2_WORLD_SCENE_SOURCE_CONTRACT,
      major: 1,
      maturity: 'publisher-candidate',
      coordinateSpaces: Object.freeze([
        Object.freeze({
          id: 'map-native',
          horizontalAxes: Object.freeze(['x', 'y']),
          verticalAxis: 'z',
          handedness: 'right',
          linearUnit: 'sc2-game-unit',
          rotationUnit: 'native-scalar',
          origin: 't3terrain-heightmap-offset',
        }),
        Object.freeze({
          id: 'uvw-canonical',
          horizontalAxes: Object.freeze(['x', 'z']),
          verticalAxis: 'y',
          handedness: 'right',
          linearUnit: 'sc2-game-unit',
          rotationUnit: 'radian',
          origin: 'adr-world-001-heightfield-origin',
        }),
        Object.freeze({
          id: 'height-grid',
          horizontalAxes: Object.freeze(['column', 'row']),
          verticalAxis: 'height-pair',
          handedness: 'array-row-major',
          linearUnit: 'grid-index',
          rotationUnit: 'not-applicable',
          origin: 'grid-zero',
        }),
        Object.freeze({
          id: 'navigation-grid',
          horizontalAxes: Object.freeze(['column', 'row']),
          verticalAxis: 'not-applicable',
          handedness: 'array-row-major',
          linearUnit: 'grid-index',
          rotationUnit: 'not-applicable',
          origin: 'grid-zero',
        }),
      ]),
      crossSpaceTransforms: Object.freeze([
        Object.freeze({
          from: 'height-grid',
          to: 'map-native',
          state: terrainTransform === undefined ? 'unknown' : 'known',
          ...(terrainTransform === undefined
            ? {
                reason:
                  'an exact HMAP grid and matching t3Terrain.xml native parameters are unavailable',
              }
            : {}),
        }),
        Object.freeze({
          from: 'navigation-grid',
          to: 'map-native',
          state: 'unknown',
          reason: 'navigation cell size and origin are not normalized',
        }),
        Object.freeze({
          from: 'map-native',
          to: 'uvw-canonical',
          state: uvwTransform === undefined ? 'unknown' : 'known',
          ...(uvwTransform === undefined
            ? {
                reason:
                  'a validated exact native terrain transform with uniform horizontal cell size is unavailable',
              }
            : {}),
        }),
      ]),
      unknownFacets: Object.freeze([
        'terrain-material-layers',
        'water',
        'cliffs-normalized',
        'pathing-flag-semantics',
        'trigger-volumes',
        'lighting',
        'physics',
      ]),
    }),
    unresolvedRequirementIds: Object.freeze([...unresolvedRequirementIds]),
    diagnostics: immutableDiagnostics,
    diagnosticsTruncated,
    complete:
      boundedSemantic.complete &&
      !diagnosticsTruncated &&
      immutableDiagnostics.every(item => item.severity !== 'error') &&
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
          open: openStarcraft2Map,
        })
      : Object.freeze({
          contract: RESOLVED_MAP_WORKSPACE_CONTRACT,
          analyzerId: ANALYZER_ID,
          gameIds: Object.freeze([GAME_ID]),
          plan: planStarcraft2Map,
          analyze: analyzeStarcraft2MapWorkspace,
        })
  return Object.freeze({
    value,
    release: async () => undefined,
  })
}
