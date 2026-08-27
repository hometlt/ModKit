import { parseXml } from '@rgrove/parse-xml'
import {
  DATA_CATALOG_ANALYSIS_CONTRACT,
  RESOLVED_DATA_WORKSPACE_CONTRACT,
  resolveDataCatalog,
} from '@modkitx-x3/sdk/data'
import { openStarcraft2DataSource } from './data-sources.js'

const ANALYZER_ID = 'org.modkitx.blizzard.starcraft2.data'
const GAME_ID = 'org.modkitx/starcraft-2'
const MAXIMUM_DOCUMENTS = 256
const MAXIMUM_TEXT_BYTES = 16_777_216
const MAXIMUM_DOCUMENT_BYTES = 4_194_304
const MAXIMUM_ENTITIES = 100_000
const MAXIMUM_DEPTH = 256
const MAXIMUM_QUERIES = 256
const MAXIMUM_LOCALIZATION_DOCUMENTS = 256
const MAXIMUM_LOCALES = 8
const MAXIMUM_LOCALIZATION_KEYS = 10_000
const MAXIMUM_REQUIREMENTS = 512
const MAXIMUM_PAGE_SIZE = 1_000
const MAXIMUM_SNAPSHOTS = 4

const CATALOG_FILES = Object.freeze([
  'abildata.xml',
  'actordata.xml',
  'behaviordata.xml',
  'buttondata.xml',
  'effectdata.xml',
  'unitdata.xml',
  'upgradedata.xml',
  'weapondata.xml',
])

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
    typeId: 'CEffectSet',
    parentTypeId: 'CEffect',
    fields: Object.freeze([append('EffectArray', 'Effect')]),
  }),
  Object.freeze({
    typeId: 'CEffectApplyBehavior',
    parentTypeId: 'CEffect',
    fields: Object.freeze([scalar('Behavior', 'Behavior')]),
  }),
  Object.freeze({
    typeId: 'CEffectCreatePersistent',
    parentTypeId: 'CEffect',
    fields: Object.freeze([append('PeriodicEffectArray', 'Effect')]),
  }),
  Object.freeze({
    typeId: 'CEffectEnumArea',
    parentTypeId: 'CEffect',
    fields: Object.freeze([indexed('AreaArray', [scalar('Effect', 'Effect')])]),
  }),
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
  CEffectSet: 'Effect',
  CEffectApplyBehavior: 'Effect',
  CEffectCreatePersistent: 'Effect',
  CEffectEnumArea: 'Effect',
  CEffectDamage: 'Effect',
  CBehavior: 'Behavior',
  CAbil: 'Abil',
  CActor: 'Actor',
  CButton: 'Button',
  CUpgrade: 'Upgrade',
})
const SCHEMA_BY_TYPE = new Map(STARCRAFT2_DATA_SCHEMAS.map(schema => [schema.typeId, schema]))
const encoder = new TextEncoder()

const projectionFacet = contract => Object.freeze({ contract, major: 1 })
const LIVE_DEFINITION_FACETS = Object.freeze([
  projectionFacet('common.view/tree-data-source'),
  projectionFacet('common.view/table-data-source'),
  projectionFacet('common.view/relation-graph-source'),
])

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

function normalizeLogicalPath(value, label) {
  nonEmptyString(value, label)
  if (value.includes('\0') || /^[a-z]:[\\/]/iu.test(value) || /^[\\/]/u.test(value)) {
    throw new TypeError(`${label} must be a confined logical path`)
  }
  const parts = []
  for (const part of value.replace(/\\/gu, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') throw new TypeError(`${label} must not escape its workspace root`)
    parts.push(part.toLowerCase())
  }
  if (parts.length === 0) throw new TypeError(`${label} must name a logical path`)
  return parts.join('/')
}

function localeId(value, label) {
  nonEmptyString(value, label)
  if (!/^[a-z]{2}(?:[-_]?[a-z]{2})?$/iu.test(value)) {
    throw new TypeError(`${label} must be a bounded language or language-region id`)
  }
  const normalized = value.replace(/[-_]/gu, '')
  return normalized.length === 2
    ? normalized.toLowerCase()
    : `${normalized.slice(0, 2).toLowerCase()}${normalized.slice(2).toUpperCase()}`
}

function validateWorkspacePlanRequest(request) {
  const value = recordOf(request)
  if (value === undefined) throw new TypeError('workspace data plan request must be an object')
  const workspace = recordOf(value.workspace)
  if (workspace === undefined || workspace.schemaVersion !== 1) {
    throw new TypeError('workspace data plan requires a ModWorkspaceLock v1')
  }
  if (workspace.gameId !== GAME_ID) {
    throw new TypeError(`StarCraft II data planning cannot inspect ${String(workspace.gameId)}`)
  }
  nonEmptyString(workspace.workspaceId, 'workspace.workspaceId')
  if (!Array.isArray(workspace.loadOrder) || !Array.isArray(workspace.sources)) {
    throw new TypeError('workspace data plan requires immutable loadOrder and sources')
  }
  const logicalRoots = Array.isArray(workspace.logicalRoots)
    ? workspace.logicalRoots
    : [...workspace.loadOrder].reverse()
  if (
    !Array.isArray(value.locales) ||
    value.locales.length === 0 ||
    value.locales.length > MAXIMUM_LOCALES
  ) {
    throw new TypeError(`locales must contain between one and ${MAXIMUM_LOCALES} entries`)
  }
  const locales = value.locales.map((locale, index) => localeId(locale, `locales[${index}]`))
  if (new Set(locales).size !== locales.length) throw new TypeError('locales must be unique')
  const maxRequirements = positiveLimit(
    value.maxRequirements,
    'maxRequirements',
    MAXIMUM_REQUIREMENTS,
  )
  const rootIds = new Set()
  for (const [index, root] of workspace.loadOrder.entries()) {
    const item = recordOf(root)
    if (item === undefined) throw new TypeError(`workspace.loadOrder[${index}] must be an object`)
    nonEmptyString(item.rootId, `workspace.loadOrder[${index}].rootId`)
    normalizeLogicalPath(item.sourcePath, `workspace.loadOrder[${index}].sourcePath`)
    if (rootIds.has(item.rootId)) throw new TypeError(`workspace root ${item.rootId} is duplicated`)
    rootIds.add(item.rootId)
  }
  const logicalRootIds = logicalRoots.map(root => root?.rootId)
  const logicalRootSet = new Set(logicalRootIds)
  if (
    logicalRoots.length !== workspace.loadOrder.length ||
    logicalRootSet.size !== logicalRoots.length ||
    logicalRootIds.some(rootId => !rootIds.has(rootId)) ||
    [...rootIds].some(rootId => !logicalRootSet.has(rootId))
  ) {
    throw new TypeError('workspace.logicalRoots must contain exactly the loadOrder roots')
  }
  return { workspace, logicalRoots, locales, maxRequirements }
}

export async function planStarcraft2DataWorkspace(request) {
  request.signal?.throwIfAborted()
  const { workspace, logicalRoots, locales, maxRequirements } =
    validateWorkspacePlanRequest(request)
  const planned = []
  for (const root of workspace.loadOrder) {
    const rootPath = normalizeLogicalPath(root.sourcePath, `${root.rootId}.sourcePath`)
    for (const file of CATALOG_FILES) {
      planned.push(
        Object.freeze({
          requirementId: `catalog:${root.rootId}:${file}`,
          rootId: root.rootId,
          path: `${rootPath}/base.sc2data/gamedata/${file}`,
          kind: 'catalog',
        }),
      )
    }
  }
  // Locale priority is stronger than root priority; within one locale lookup is winner-first.
  for (const locale of locales) {
    for (const root of logicalRoots) {
      const rootPath = normalizeLogicalPath(root.sourcePath, `${root.rootId}.sourcePath`)
      planned.push(
        Object.freeze({
          requirementId: `localization:${locale}:${root.rootId}`,
          rootId: root.rootId,
          path: `${rootPath}/${locale.toLowerCase()}.sc2data/localizeddata/gamestrings.txt`,
          kind: 'localization',
          locale,
        }),
      )
    }
  }
  const truncated = planned.length > maxRequirements
  const requirements = Object.freeze(planned.slice(0, maxRequirements))
  return Object.freeze({
    schemaVersion: 1,
    workspaceId: workspace.workspaceId,
    gameId: workspace.gameId,
    analyzerId: ANALYZER_ID,
    requirements,
    diagnostics: Object.freeze(
      truncated
        ? [
            Object.freeze({
              severity: 'error',
              code: 'org.modkitx.blizzard.starcraft2/data-plan-truncated',
              message: `workspace data plan requires ${planned.length} reads but maxRequirements is ${maxRequirements}`,
            }),
          ]
        : [],
    ),
    complete: !truncated,
  })
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
  const localizationDocuments = value.localizationDocuments ?? []
  if (
    !Array.isArray(localizationDocuments) ||
    localizationDocuments.length > MAXIMUM_LOCALIZATION_DOCUMENTS
  ) {
    throw new TypeError(
      `localizationDocuments must contain at most ${MAXIMUM_LOCALIZATION_DOCUMENTS} entries`,
    )
  }
  const locales = value.locales ?? []
  if (!Array.isArray(locales) || locales.length > MAXIMUM_LOCALES) {
    throw new TypeError(`locales must contain at most ${MAXIMUM_LOCALES} entries`)
  }
  const normalizedLocales = locales.map((locale, index) => localeId(locale, `locales[${index}]`))
  if (new Set(normalizedLocales).size !== normalizedLocales.length) {
    throw new TypeError('locales must be unique')
  }
  const localizationKeys = value.localizationKeys ?? []
  if (
    !Array.isArray(localizationKeys) ||
    localizationKeys.length > MAXIMUM_LOCALIZATION_KEYS ||
    !localizationKeys.every(key => typeof key === 'string' && key.length > 0)
  ) {
    throw new TypeError(
      `localizationKeys must contain at most ${MAXIMUM_LOCALIZATION_KEYS} non-empty strings`,
    )
  }
  let totalBytes = 0
  const validateDocument = (document, index, label) => {
    const item = recordOf(document)
    if (item === undefined) throw new TypeError(`${label}[${index}] must be an object`)
    nonEmptyString(item.rootId, `${label}[${index}].rootId`)
    nonEmptyString(item.path, `${label}[${index}].path`)
    if (typeof item.text !== 'string')
      throw new TypeError(`${label}[${index}].text must be a string`)
    const size = encoder.encode(item.text).byteLength
    if (size > MAXIMUM_DOCUMENT_BYTES) {
      throw new TypeError(`${label}[${index}] exceeds ${MAXIMUM_DOCUMENT_BYTES} bytes`)
    }
    totalBytes += size
    return item
  }
  value.documents.forEach((document, index) => validateDocument(document, index, 'documents'))
  localizationDocuments.forEach((document, index) => {
    const item = validateDocument(document, index, 'localizationDocuments')
    localeId(item.locale, `localizationDocuments[${index}].locale`)
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
  if (value.snapshotId !== undefined) nonEmptyString(value.snapshotId, 'snapshotId')
  return {
    ...value,
    localizationDocuments,
    locales: normalizedLocales,
    localizationKeys,
  }
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
  const diagnostics = []
  const seen = new Set()
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
      ...(document.revision === undefined ? {} : { revision: document.revision }),
    })
    if (patch === undefined) anonymousEntities += 1
    else {
      const key = `${patch.namespace}\0${patch.entityId}`
      if (seen.has(key)) {
        diagnostics.push(
          Object.freeze({
            severity: 'error',
            code: 'org.modkitx.blizzard.starcraft2/catalog-id-duplicate',
            message: `${document.path} declares ${patch.namespace}/${patch.entityId} more than once`,
            namespace: patch.namespace,
            typeId: patch.typeId,
            entityId: patch.entityId,
            source: patch.source,
          }),
        )
      }
      seen.add(key)
      patches.push(patch)
    }
  }
  return { patches, unsupportedTypes, anonymousEntities, diagnostics }
}

function parseLocalizationDocument(document, documentIndex) {
  const locale = localeId(document.locale, `localizationDocuments[${documentIndex}].locale`)
  const patches = []
  const diagnostics = []
  const seen = new Set()
  const source = Object.freeze({
    rootId: document.rootId,
    path: document.path,
    documentIndex,
    ...(document.revision === undefined ? {} : { revision: document.revision }),
  })
  for (const [lineIndex, line] of document.text.split(/\r\n|\n|\r/u).entries()) {
    if (line.trim() === '' || /^\s*(?:#|\/\/)/u.test(line)) continue
    const equals = line.indexOf('=')
    if (equals <= 0) {
      diagnostics.push(
        Object.freeze({
          severity: 'warning',
          code: 'org.modkitx.blizzard.starcraft2/localization-line-malformed',
          message: `${document.path}:${lineIndex + 1} has no non-empty key before '='`,
          source,
        }),
      )
      continue
    }
    const key = line.slice(0, equals).trim()
    if (key.length === 0 || key.includes('\0')) {
      diagnostics.push(
        Object.freeze({
          severity: 'warning',
          code: 'org.modkitx.blizzard.starcraft2/localization-key-refused',
          message: `${document.path}:${lineIndex + 1} has an invalid localization key`,
          source,
        }),
      )
      continue
    }
    if (seen.has(key)) {
      diagnostics.push(
        Object.freeze({
          severity: 'error',
          code: 'org.modkitx.blizzard.starcraft2/localization-key-duplicate',
          message: `${document.path} declares localization key ${key} more than once`,
          fieldId: key,
          source,
        }),
      )
      continue
    }
    seen.add(key)
    patches.push(Object.freeze({ locale, key, value: line.slice(equals + 1), source }))
  }
  return { patches, diagnostics }
}

function collectLocalizationValues(value, field, keys) {
  if (field.linkNamespace === '') {
    if (typeof value === 'string' && value.length > 0) keys.add(value)
    if (Array.isArray(value)) {
      for (const item of value) collectLocalizationValues(item, field, keys)
    }
  }
  if (field.fields === undefined) return
  const values = Array.isArray(value) ? value : [value]
  for (const item of values) {
    const record = recordOf(item)
    if (record === undefined) continue
    const nested = recordOf(record.value) ?? record
    for (const child of field.fields) {
      if (nested[child.fieldId] !== undefined) {
        collectLocalizationValues(nested[child.fieldId], child, keys)
      }
    }
  }
}

function localizationKeysFromPatches(patches) {
  const keys = new Set()
  for (const patch of patches) {
    const schema = SCHEMA_BY_TYPE.get(patch.typeId)
    if (schema === undefined) continue
    const fields = new Map(schema.fields.map(field => [field.fieldId, field]))
    for (const [fieldId, value] of Object.entries(patch.fields)) {
      const field = fields.get(fieldId)
      if (field !== undefined) collectLocalizationValues(value, field, keys)
    }
  }
  return keys
}

function hashText(value) {
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

function snapshotIdentity(value) {
  const source = [
    value.snapshotId ?? '',
    value.workspaceId,
    ...value.documents.flatMap(document => [
      document.rootId,
      document.path,
      document.revision ?? '',
      hashText(document.text),
    ]),
    ...value.localizationDocuments.flatMap(document => [
      document.locale,
      document.rootId,
      document.path,
      document.revision ?? '',
      hashText(document.text),
    ]),
  ].join('\0')
  return `provider-token:sc2-data-${hashText(source)}`
}

function projectionEvidence(
  value,
  snapshotId,
  catalogDocuments,
  localizationDocuments,
  unresolvedRequirements,
) {
  const adapter = Object.freeze({ id: ANALYZER_ID, version: '1.1.0' })
  const projectionPlan = Object.freeze({
    adapter,
    subjectRevision: snapshotId,
    facets: Object.freeze(
      LIVE_DEFINITION_FACETS.map(ref => Object.freeze({ ref, state: 'published' })),
    ),
  })
  const projectionReceipt = Object.freeze({
    form: 'local',
    adapter,
    subjectRevision: snapshotId,
    companions: Object.freeze([]),
    basis: Object.freeze({
      handedness: 'right',
      upAxis: 'z',
      forwardAxis: '-y',
      unit: 'source-unit',
      sourceUnit: 'sc2-game-unit',
    }),
    planes: Object.freeze([
      Object.freeze({
        planeId: 'schema',
        state: 'normalized',
        note: `${STARCRAFT2_DATA_SCHEMAS.length} hand-authored native catalog schema types; remaining native catalog kinds and fields are not projected`,
      }),
      Object.freeze({
        planeId: 'effective-definitions',
        state: catalogDocuments === 0 ? 'lost' : 'normalized',
        note: `${catalogDocuments} ordered native catalog document(s); ${unresolvedRequirements} planned resource(s) unresolved`,
      }),
      Object.freeze({
        planeId: 'localization',
        state: localizationDocuments === 0 ? 'lost' : 'normalized',
        note:
          localizationDocuments === 0
            ? 'no requested localization resource resolved'
            : `${localizationDocuments} winner-first localization document(s); values may use an explicitly recorded locale fallback`,
      }),
      Object.freeze({
        planeId: 'relations',
        state: 'normalized',
        note: 'typed links from the bounded schema slice normalized to relation edges, including explicit dead targets',
      }),
    ]),
    evidence: Object.freeze([
      Object.freeze({
        kind: 'observed',
        statement: `${catalogDocuments} catalog and ${localizationDocuments} localization document(s) parsed through a revision-pinned workspace snapshot`,
      }),
      Object.freeze({
        kind: 'diagnostic',
        code: 'org.modkitx.blizzard.starcraft2/data-schema-slice-partial',
        message: 'live facets cover the named bootstrap schema slice and do not claim portable UVD',
      }),
    ]),
    confidence: 'partial',
  })
  return { projectionPlan, projectionReceipt }
}

async function analyzeStarcraft2DataInternal(request, includeWorkspaceFacets) {
  request.signal?.throwIfAborted()
  const value = validateRequest(request)
  const patches = []
  const localizationPatches = []
  const providerDiagnostics = []
  let unresolvedRequirements = 0
  if (includeWorkspaceFacets) {
    const plannedDocumentCount = positiveLimit(
      value.plannedDocumentCount,
      'plannedDocumentCount',
      MAXIMUM_REQUIREMENTS,
    )
    if (
      !Array.isArray(value.unresolvedRequirementIds) ||
      !value.unresolvedRequirementIds.every(item => typeof item === 'string' && item.length > 0) ||
      new Set(value.unresolvedRequirementIds).size !== value.unresolvedRequirementIds.length ||
      value.documents.length +
        value.localizationDocuments.length +
        value.unresolvedRequirementIds.length !==
        plannedDocumentCount
    ) {
      throw new TypeError(
        'resolved workspace analysis requires exact bounded resource-plan accounting',
      )
    }
    unresolvedRequirements = value.unresolvedRequirementIds.length
    if (unresolvedRequirements > 0) {
      providerDiagnostics.push(
        Object.freeze({
          severity: 'error',
          code: 'org.modkitx.blizzard.starcraft2/data-plan-resources-unresolved',
          message: `${unresolvedRequirements} planned workspace data resource(s) did not resolve: ${value.unresolvedRequirementIds.join(', ')}`,
        }),
      )
    }
  }
  let unsupportedTypes = 0
  let anonymousEntities = 0
  value.documents.forEach((document, documentIndex) => {
    const parsed = parseDocument(document, documentIndex)
    patches.push(...parsed.patches)
    providerDiagnostics.push(...parsed.diagnostics)
    unsupportedTypes += parsed.unsupportedTypes
    anonymousEntities += parsed.anonymousEntities
    if (patches.length > value.maxEntities) {
      throw new TypeError(
        `parsed entities exceeds maxEntities (${patches.length} > ${value.maxEntities})`,
      )
    }
  })
  value.localizationDocuments.forEach((document, documentIndex) => {
    const parsed = parseLocalizationDocument(document, documentIndex)
    localizationPatches.push(...parsed.patches)
    providerDiagnostics.push(...parsed.diagnostics)
  })
  request.signal?.throwIfAborted()
  if (unsupportedTypes > 0 || anonymousEntities > 0) {
    providerDiagnostics.push(
      Object.freeze({
        severity: 'information',
        code: 'org.modkitx.blizzard.starcraft2/data-schema-slice-partial',
        message: `bootstrap schema skipped ${unsupportedTypes} unsupported and ${anonymousEntities} anonymous catalog entries`,
      }),
    )
  }
  if (includeWorkspaceFacets) {
    providerDiagnostics.push(
      Object.freeze({
        severity: 'information',
        code: 'org.modkitx.blizzard.starcraft2/data-schema-coverage-bounded',
        message:
          'live facets cover selected fields for CUnit/CWeapon/CEffect/CEffectDamage/CEffectSet/CEffectApplyBehavior/CBehavior/CAbil/CActor/CButton/CUpgrade (plus CBase), CEffectCreatePersistent.PeriodicEffectArray and CEffectEnumArea.AreaArray.Effect; adjacent Effect fields/types, tokens, validators and remaining catalogs are named remainder',
      }),
    )
  }
  const localizationKeys = localizationKeysFromPatches(patches)
  for (const key of value.localizationKeys) localizationKeys.add(key)
  const snapshotId = snapshotIdentity(value)
  const projection = projectionEvidence(
    value,
    snapshotId,
    value.documents.length,
    value.localizationDocuments.length,
    unresolvedRequirements,
  )
  const snapshot = resolveDataCatalog({
    workspaceId: value.workspaceId,
    gameId: value.gameId,
    analyzerId: ANALYZER_ID,
    schemas: STARCRAFT2_DATA_SCHEMAS,
    patches,
    queries: value.queries,
    ...(includeWorkspaceFacets
      ? {
          localizationPatches,
          localePreferences: value.locales,
          localizationKeys: [...localizationKeys],
          diagnostics: providerDiagnostics,
          snapshotId,
          projectionPlan: projection.projectionPlan,
          projectionReceipt: projection.projectionReceipt,
          includeWorkspaceFacets: true,
        }
      : {}),
    maxEntities: value.maxEntities,
    maxDepth: value.maxDepth,
  })
  if (includeWorkspaceFacets || (unsupportedTypes === 0 && anonymousEntities === 0)) return snapshot
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

/** Existing catalog-analysis@1 behavior: no workspace/live additions on the wire. */
export const analyzeStarcraft2Data = request => analyzeStarcraft2DataInternal(request, false)

export const analyzeStarcraft2ResolvedData = request => analyzeStarcraft2DataInternal(request, true)

export const abiVersion = 1
export const provides = Object.freeze([
  DATA_CATALOG_ANALYSIS_CONTRACT,
  RESOLVED_DATA_WORKSPACE_CONTRACT,
])

function createResolvedWorkspaceProvider() {
  const snapshots = new Map()
  const remember = snapshot => {
    if (typeof snapshot.snapshotId !== 'string') {
      throw new TypeError('resolved workspace analyzer returned no snapshot identity')
    }
    snapshots.delete(snapshot.snapshotId)
    snapshots.set(snapshot.snapshotId, snapshot)
    while (snapshots.size > MAXIMUM_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value)
    return snapshot
  }
  const open = async (request, kind) => {
    request?.signal?.throwIfAborted()
    nonEmptyString(request?.snapshotId, 'snapshotId')
    const maxPageSize = positiveLimit(request.maxPageSize, 'maxPageSize', MAXIMUM_PAGE_SIZE)
    const snapshot = snapshots.get(request.snapshotId)
    if (snapshot === undefined) {
      throw new RangeError(
        `snapshot ${request.snapshotId} is stale, unknown or evicted from this provider lease`,
      )
    }
    return openStarcraft2DataSource(snapshot, kind, maxPageSize)
  }
  return Object.freeze({
    contract: RESOLVED_DATA_WORKSPACE_CONTRACT,
    providerId: ANALYZER_ID,
    gameIds: Object.freeze([GAME_ID]),
    plan: planStarcraft2DataWorkspace,
    analyze: async request => remember(await analyzeStarcraft2ResolvedData(request)),
    openSchemaTree: request => open(request, 'schema-tree'),
    openDefinitionTable: request => open(request, 'definition-table'),
    openLocalizationTable: request => open(request, 'localization-table'),
    openRelations: request => open(request, 'relations'),
  })
}

export function createProvider(selection) {
  if (
    selection.major !== 1 ||
    (selection.contract !== DATA_CATALOG_ANALYSIS_CONTRACT &&
      selection.contract !== RESOLVED_DATA_WORKSPACE_CONTRACT)
  ) {
    throw new TypeError(
      `unsupported data-catalog selection ${selection.contract}@${selection.major}`,
    )
  }
  const value =
    selection.contract === DATA_CATALOG_ANALYSIS_CONTRACT
      ? Object.freeze({
          contract: DATA_CATALOG_ANALYSIS_CONTRACT,
          analyzerId: ANALYZER_ID,
          gameIds: Object.freeze([GAME_ID]),
          analyze: analyzeStarcraft2Data,
        })
      : createResolvedWorkspaceProvider()
  return Object.freeze({
    value,
    release: async () => undefined,
  })
}
