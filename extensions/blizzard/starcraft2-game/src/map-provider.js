import { parseXml } from '@rgrove/parse-xml'
import { MAP_SEMANTIC_ANALYSIS_CONTRACT } from '@modkitx-x3/sdk/maps'

const ANALYZER_ID = 'org.modkitx.blizzard.starcraft2.maps'
const GAME_ID = 'org.modkitx/starcraft-2'
const MAXIMUM_DOCUMENTS = 16
const MAXIMUM_DOCUMENT_BYTES = 16_777_216
const MAXIMUM_TOTAL_BYTES = 33_554_432
const MAXIMUM_OBJECTS = 100_000
const MAXIMUM_REGIONS = 10_000
const MAXIMUM_TERRAIN_CELLS = 4_194_304
const MAXIMUM_TERRAIN_SAMPLES = 4_096
const MAXIMUM_DEPTH = 128
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
  const sampleIndices = new Set()
  for (let index = 0; index < sampleCount; index += 1) {
    sampleIndices.add(
      sampleCount === 1 ? 0 : Math.floor((index * (cellCount - 1)) / (sampleCount - 1)),
    )
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
    if (sampleIndices.has(index)) {
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

export const abiVersion = 1
export const provides = Object.freeze([MAP_SEMANTIC_ANALYSIS_CONTRACT])

export function createProvider(selection) {
  if (selection.contract !== MAP_SEMANTIC_ANALYSIS_CONTRACT || selection.major !== 1) {
    throw new TypeError(
      `unsupported semantic-map selection ${selection.contract}@${selection.major}`,
    )
  }
  return Object.freeze({
    value: Object.freeze({
      contract: MAP_SEMANTIC_ANALYSIS_CONTRACT,
      analyzerId: ANALYZER_ID,
      gameIds: Object.freeze([GAME_ID]),
      open: openStarcraft2Map,
    }),
    release: async () => undefined,
  })
}
