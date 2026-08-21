import { parseXml } from '@rgrove/parse-xml'
import { DATA_CATALOG_ANALYSIS_CONTRACT, resolveDataCatalog } from '@modkitx-x3/sdk/data'

const ANALYZER_ID = 'org.modkitx.blizzard.starcraft2.data'
const GAME_ID = 'org.modkitx/starcraft-2'
const MAXIMUM_DOCUMENTS = 256
const MAXIMUM_TEXT_BYTES = 16_777_216
const MAXIMUM_DOCUMENT_BYTES = 4_194_304
const MAXIMUM_ENTITIES = 100_000
const MAXIMUM_DEPTH = 256
const MAXIMUM_QUERIES = 256

const scalar = (fieldId, linkNamespace) =>
  Object.freeze({
    fieldId,
    cardinality: 'scalar',
    ...(linkNamespace === undefined ? {} : { linkNamespace }),
  })
const append = (fieldId, linkNamespace) =>
  Object.freeze({
    fieldId,
    cardinality: 'append',
    ...(linkNamespace === undefined ? {} : { linkNamespace }),
  })
const indexed = (fieldId, fields, linkNamespace) =>
  Object.freeze({
    fieldId,
    cardinality: 'indexed',
    indexKey: 'index',
    ...(linkNamespace === undefined ? {} : { linkNamespace }),
    ...(fields === undefined ? {} : { fields: Object.freeze(fields) }),
  })
const structured = (fieldId, fields) =>
  Object.freeze({ fieldId, cardinality: 'scalar', fields: Object.freeze(fields) })

/** Hand-authored bootstrap slice. The generated full game schema remains a later parity pass. */
export const STARCRAFT2_DATA_SCHEMAS = Object.freeze([
  Object.freeze({ typeId: 'CBase', fields: Object.freeze([]) }),
  Object.freeze({
    typeId: 'CUnit',
    parentTypeId: 'CBase',
    fields: Object.freeze([
      scalar('Name', ''),
      scalar('Description', ''),
      indexed('WeaponArray', [scalar('Link', 'Weapon')]),
      indexed('BehaviorArray', [scalar('Link', 'Behavior')]),
      indexed('AbilArray', [scalar('Link', 'Abil')]),
      append('ActorInfoArray'),
      scalar('Race', 'Race'),
      scalar('DeathType', ''),
      scalar('KillXP'),
      scalar('LifeMax'),
      scalar('ShieldsMax'),
      scalar('EnergyMax'),
      scalar('Speed'),
      indexed('Attributes'),
      append('GlossaryStrongArray', 'Unit'),
    ]),
  }),
  Object.freeze({
    typeId: 'CWeapon',
    parentTypeId: 'CBase',
    fields: Object.freeze([
      scalar('TargetFilters'),
      scalar('Period'),
      scalar('Range'),
      scalar('DamagePoint'),
      structured('Effect', [scalar('Link', 'Effect')]),
      structured('DisplayEffect', [scalar('Link', 'Effect')]),
    ]),
  }),
  Object.freeze({ typeId: 'CEffect', parentTypeId: 'CBase', fields: Object.freeze([]) }),
  Object.freeze({
    typeId: 'CEffectDamage',
    parentTypeId: 'CEffect',
    fields: Object.freeze([scalar('Amount'), scalar('Kind'), scalar('Death', '')]),
  }),
  Object.freeze({
    typeId: 'CBehavior',
    parentTypeId: 'CBase',
    fields: Object.freeze([scalar('DurationMin'), scalar('DurationMax')]),
  }),
  Object.freeze({
    typeId: 'CAbil',
    parentTypeId: 'CBase',
    fields: Object.freeze([
      scalar('Name', ''),
      scalar('InfoTooltip', ''),
      structured('Cost', [scalar('Mineral'), scalar('Vespene'), scalar('Time')]),
    ]),
  }),
  Object.freeze({
    typeId: 'CActor',
    parentTypeId: 'CBase',
    fields: Object.freeze([
      append('Aliases'),
      scalar('AttachMethodBottom'),
      scalar('AttachMethodTop'),
    ]),
  }),
  Object.freeze({
    typeId: 'CButton',
    parentTypeId: 'CBase',
    fields: Object.freeze([scalar('Icon'), scalar('Tooltip', ''), scalar('Name', '')]),
  }),
  Object.freeze({
    typeId: 'CUpgrade',
    parentTypeId: 'CBase',
    fields: Object.freeze([
      scalar('Name', ''),
      scalar('Icon'),
      indexed('EffectArray', [scalar('Value')]),
    ]),
  }),
])

const TYPE_NAMESPACES = Object.freeze({
  CUnit: 'Unit',
  CWeapon: 'Weapon',
  CEffect: 'Effect',
  CEffectDamage: 'Effect',
  CBehavior: 'Behavior',
  CAbil: 'Abil',
  CActor: 'Actor',
  CButton: 'Button',
  CUpgrade: 'Upgrade',
})
const SCHEMA_BY_TYPE = new Map(STARCRAFT2_DATA_SCHEMAS.map(schema => [schema.typeId, schema]))
const encoder = new TextEncoder()

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
  if (value === undefined) throw new TypeError('catalog analysis request must be an object')
  nonEmptyString(value.workspaceId, 'workspaceId')
  if (value.gameId !== GAME_ID) {
    throw new TypeError(`StarCraft II catalog analysis cannot inspect ${String(value.gameId)}`)
  }
  const maxDocuments = positiveLimit(value.maxDocuments, 'maxDocuments', MAXIMUM_DOCUMENTS)
  const maxTextBytes = positiveLimit(value.maxTextBytes, 'maxTextBytes', MAXIMUM_TEXT_BYTES)
  positiveLimit(value.maxEntities, 'maxEntities', MAXIMUM_ENTITIES)
  positiveLimit(value.maxDepth, 'maxDepth', MAXIMUM_DEPTH)
  if (!Array.isArray(value.documents) || value.documents.length > maxDocuments) {
    throw new TypeError(
      `documents must be an array with at most maxDocuments (${maxDocuments}) entries`,
    )
  }
  if (!Array.isArray(value.queries) || value.queries.length > MAXIMUM_QUERIES) {
    throw new TypeError(`queries must be an array with at most ${MAXIMUM_QUERIES} entries`)
  }
  let totalBytes = 0
  value.documents.forEach((document, index) => {
    const item = recordOf(document)
    if (item === undefined) throw new TypeError(`documents[${index}] must be an object`)
    nonEmptyString(item.rootId, `documents[${index}].rootId`)
    nonEmptyString(item.path, `documents[${index}].path`)
    if (typeof item.text !== 'string')
      throw new TypeError(`documents[${index}].text must be a string`)
    const size = encoder.encode(item.text).byteLength
    if (size > MAXIMUM_DOCUMENT_BYTES) {
      throw new TypeError(`documents[${index}] exceeds ${MAXIMUM_DOCUMENT_BYTES} bytes`)
    }
    totalBytes += size
  })
  if (totalBytes > maxTextBytes) {
    throw new TypeError(`document text exceeds maxTextBytes (${totalBytes} > ${maxTextBytes})`)
  }
  value.queries.forEach((query, index) => {
    const item = recordOf(query)
    if (item === undefined) throw new TypeError(`queries[${index}] must be an object`)
    nonEmptyString(item.namespace, `queries[${index}].namespace`)
    nonEmptyString(item.entityId, `queries[${index}].entityId`)
  })
  return value
}

function elementChildren(node) {
  return (node.children ?? []).filter(child => child.type === 'element')
}

function attributeValue(value) {
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) {
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }
  return value
}

function structuredValue(element, field) {
  const ignored = new Set([field.indexKey ?? 'index', 'removed'])
  const attributes = Object.fromEntries(
    Object.entries(element.attributes ?? {})
      .filter(([key]) => !ignored.has(key))
      .map(([key, value]) => [key, attributeValue(String(value))]),
  )
  const nestedSchemas = new Map((field.fields ?? []).map(item => [item.fieldId, item]))
  const nested = {}
  const occurrences = new Map()
  for (const child of elementChildren(element)) {
    const childSchema = nestedSchemas.get(child.name)
    if (childSchema === undefined) continue
    const occurrence = occurrences.get(child.name) ?? 0
    occurrences.set(child.name, occurrence + 1)
    const value = fieldValue(child, childSchema, occurrence)
    if (childSchema.cardinality === 'append' || childSchema.cardinality === 'indexed') {
      const current = Array.isArray(nested[child.name]) ? nested[child.name] : []
      nested[child.name] = [...current, value]
    } else {
      nested[child.name] = value
    }
  }
  const combined = { ...attributes, ...nested }
  const keys = Object.keys(combined)
  if (keys.length === 1 && keys[0] === 'value') return combined.value
  if (keys.length > 0) return combined
  const text = typeof element.text === 'string' ? element.text.trim() : ''
  return text.length > 0 ? text : ''
}

function fieldValue(element, field, occurrence) {
  const value = structuredValue(element, field)
  if (field.cardinality !== 'indexed') return value
  const indexKey = field.indexKey ?? 'index'
  const explicit = element.attributes?.[indexKey]
  const removed = element.attributes?.removed
  return {
    [indexKey]: explicit === undefined ? String(occurrence) : String(explicit),
    value,
    ...(removed === '1' || removed === 'true' ? { removed: true } : {}),
  }
}

function parseEntity(element, schema, namespace, source) {
  const entityId = element.attributes?.id
  if (typeof entityId !== 'string' || entityId.length === 0) return undefined
  const fieldSchemas = new Map(schema.fields.map(field => [field.fieldId, field]))
  const fields = {}
  const occurrences = new Map()
  for (const child of elementChildren(element)) {
    const field = fieldSchemas.get(child.name)
    if (field === undefined) continue
    const occurrence = occurrences.get(child.name) ?? 0
    occurrences.set(child.name, occurrence + 1)
    const value = fieldValue(child, field, occurrence)
    if (field.cardinality === 'append' || field.cardinality === 'indexed') {
      const current = Array.isArray(fields[child.name]) ? fields[child.name] : []
      fields[child.name] = [...current, value]
    } else {
      fields[child.name] = value
    }
  }
  const parent = element.attributes?.parent
  return Object.freeze({
    namespace,
    typeId: schema.typeId,
    entityId,
    ...(typeof parent === 'string' && parent.length > 0 ? { parentEntityId: parent } : {}),
    fields: Object.freeze(fields),
    source: Object.freeze(source),
  })
}

function parseDocument(document, documentIndex) {
  if (/<!DOCTYPE|<!ENTITY/iu.test(document.text)) {
    throw new TypeError(`${document.path}: DTD and custom entities are forbidden`)
  }
  const parsed = parseXml(document.text)
  const root = parsed.children?.find(child => child.type === 'element')
  if (root === undefined) throw new TypeError(`${document.path}: XML root element is missing`)
  const patches = []
  let unsupportedTypes = 0
  let anonymousEntities = 0
  for (const element of elementChildren(root)) {
    const schema = SCHEMA_BY_TYPE.get(element.name)
    const namespace = TYPE_NAMESPACES[element.name]
    if (schema === undefined || namespace === undefined) {
      unsupportedTypes += 1
      continue
    }
    const patch = parseEntity(element, schema, namespace, {
      rootId: document.rootId,
      path: document.path,
      documentIndex,
    })
    if (patch === undefined) anonymousEntities += 1
    else patches.push(patch)
  }
  return { patches, unsupportedTypes, anonymousEntities }
}

export async function analyzeStarcraft2Data(request) {
  request.signal?.throwIfAborted()
  const value = validateRequest(request)
  const patches = []
  let unsupportedTypes = 0
  let anonymousEntities = 0
  value.documents.forEach((document, documentIndex) => {
    const parsed = parseDocument(document, documentIndex)
    patches.push(...parsed.patches)
    unsupportedTypes += parsed.unsupportedTypes
    anonymousEntities += parsed.anonymousEntities
    if (patches.length > value.maxEntities) {
      throw new TypeError(
        `parsed entities exceeds maxEntities (${patches.length} > ${value.maxEntities})`,
      )
    }
  })
  request.signal?.throwIfAborted()
  const snapshot = resolveDataCatalog({
    workspaceId: value.workspaceId,
    gameId: value.gameId,
    analyzerId: ANALYZER_ID,
    schemas: STARCRAFT2_DATA_SCHEMAS,
    patches,
    queries: value.queries,
    maxEntities: value.maxEntities,
    maxDepth: value.maxDepth,
  })
  if (unsupportedTypes === 0 && anonymousEntities === 0) return snapshot
  return Object.freeze({
    ...snapshot,
    diagnostics: Object.freeze([
      ...snapshot.diagnostics,
      Object.freeze({
        severity: 'information',
        code: 'org.modkitx.blizzard.starcraft2/data-schema-slice-partial',
        message: `bootstrap schema skipped ${unsupportedTypes} unsupported and ${anonymousEntities} anonymous catalog entries`,
      }),
    ]),
  })
}

export const abiVersion = 1
export const provides = Object.freeze([DATA_CATALOG_ANALYSIS_CONTRACT])

export function createProvider(selection) {
  if (selection.contract !== DATA_CATALOG_ANALYSIS_CONTRACT || selection.major !== 1) {
    throw new TypeError(
      `unsupported data-catalog selection ${selection.contract}@${selection.major}`,
    )
  }
  return Object.freeze({
    value: Object.freeze({
      contract: DATA_CATALOG_ANALYSIS_CONTRACT,
      analyzerId: ANALYZER_ID,
      gameIds: Object.freeze([GAME_ID]),
      analyze: analyzeStarcraft2Data,
    }),
    release: async () => undefined,
  })
}
