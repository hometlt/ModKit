import { createTreeDataSource } from '@modkitx-x3/codec-kit'
import {
  DATA_CATALOG_ANALYSIS_CONTRACT,
  RESOLVED_DATA_WORKSPACE_CONTRACT,
  resolveDataCatalog,
} from '@modkitx-x3/sdk'

const ANALYZER_ID = 'org.modkitx.opensource.warzone2100.data'
const GAME_ID = 'org.modkitx/warzone-2100'
const MAXIMUM_DOCUMENTS = 192
const MAXIMUM_TEXT_BYTES = 67_108_864
const MAXIMUM_DOCUMENT_BYTES = 16_777_216
const MAXIMUM_ENTITIES = 100_000
const MAXIMUM_DEPTH = 128
const MAXIMUM_QUERIES = 4_096
const MAXIMUM_REQUIREMENTS = 192
const MAXIMUM_PAGE_SIZE = 1_000
const MAXIMUM_SNAPSHOTS = 4

const scalar = (fieldId, linkNamespace) =>
  Object.freeze({
    fieldId,
    cardinality: 'scalar',
    ...(linkNamespace === undefined ? {} : { linkNamespace }),
  })

const schema = (typeId, fields) =>
  Object.freeze({ typeId, fields: Object.freeze(fields.map(field => scalar(...field))) })

/** Complete field coverage for the three WZ 4.7 JSON tables used by map objects. */
export const WARZONE_DATA_SCHEMAS = Object.freeze([
  schema('WarzoneTemplate', [
    ['available'],
    ['body', 'warzone.bodies'],
    ['brain', 'warzone.brains'],
    ['construct', 'warzone.constructors'],
    ['id'],
    ['name'],
    ['propulsion', 'warzone.propulsions'],
    ['repair', 'warzone.repairs'],
    ['sensor', 'warzone.sensors'],
    ['type'],
    ['weapons', 'warzone.weapons'],
  ]),
  schema('WarzoneStructure', [
    ['armour'],
    ['baseModel', 'warzone.models'],
    ['breadth'],
    ['buildPoints'],
    ['buildPower'],
    ['combinesWithWall'],
    ['ecmID', 'warzone.ecm'],
    ['height'],
    ['hitpoints'],
    ['id'],
    ['modulePowerPoints'],
    ['moduleProductionPoints'],
    ['moduleResearchPoints'],
    ['name'],
    ['powerPoints'],
    ['productionPoints'],
    ['rearmPoints'],
    ['repairPoints'],
    ['researchPoints'],
    ['resistance'],
    ['sensorID', 'warzone.sensors'],
    ['strength'],
    ['structureModel', 'warzone.models'],
    ['thermal'],
    ['type'],
    ['userLimits'],
    ['weapons', 'warzone.weapons'],
    ['width'],
  ]),
  schema('WarzoneFeature', [
    ['armour'],
    ['breadth'],
    ['damageable'],
    ['hitpoints'],
    ['id'],
    ['lineOfSight'],
    ['model', 'warzone.models'],
    ['name'],
    ['startVisible'],
    ['tileDraw'],
    ['type'],
    ['width'],
  ]),
])

const TABLES = Object.freeze([
  Object.freeze({
    file: 'templates.json',
    namespace: 'warzone.templates',
    typeId: 'WarzoneTemplate',
  }),
  Object.freeze({
    file: 'structure.json',
    namespace: 'warzone.structures',
    typeId: 'WarzoneStructure',
  }),
  Object.freeze({
    file: 'features.json',
    namespace: 'warzone.features',
    typeId: 'WarzoneFeature',
  }),
])

const encoder = new TextEncoder()
const LIVE_DEFINITION_FACETS = Object.freeze([
  Object.freeze({ contract: 'common.view/tree-data-source', major: 1 }),
  Object.freeze({ contract: 'common.view/table-data-source', major: 1 }),
  Object.freeze({ contract: 'common.view/relation-graph-source', major: 1 }),
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

function validateWorkspacePlanRequest(request) {
  const value = recordOf(request)
  const workspace = recordOf(value?.workspace)
  if (workspace === undefined || workspace.schemaVersion !== 1) {
    throw new TypeError('workspace data plan requires a ModWorkspaceLock v1')
  }
  if (workspace.gameId !== GAME_ID) {
    throw new TypeError(`Warzone 2100 data planning cannot inspect ${String(workspace.gameId)}`)
  }
  nonEmptyString(workspace.workspaceId, 'workspace.workspaceId')
  if (!Array.isArray(workspace.loadOrder) || !Array.isArray(workspace.sources)) {
    throw new TypeError('workspace data plan requires immutable loadOrder and sources')
  }
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
  if (!Array.isArray(value.locales)) throw new TypeError('locales must be an array')
  return { workspace, maxRequirements }
}

export async function planWarzoneDataWorkspace(request) {
  request.signal?.throwIfAborted()
  const { workspace, maxRequirements } = validateWorkspacePlanRequest(request)
  const planned = []
  for (const root of workspace.loadOrder) {
    const rootPath = normalizeLogicalPath(root.sourcePath, `${root.rootId}.sourcePath`)
    for (const table of TABLES) {
      planned.push(
        Object.freeze({
          requirementId: `catalog:${root.rootId}:${table.file}`,
          rootId: root.rootId,
          path: `${rootPath}/stats/${table.file}`,
          kind: 'catalog',
        }),
      )
    }
  }
  const truncated = planned.length > maxRequirements
  return Object.freeze({
    schemaVersion: 1,
    workspaceId: workspace.workspaceId,
    gameId: workspace.gameId,
    analyzerId: ANALYZER_ID,
    requirements: Object.freeze(planned.slice(0, maxRequirements)),
    diagnostics: Object.freeze(
      truncated
        ? [
            Object.freeze({
              severity: 'error',
              code: 'org.modkitx.opensource.warzone2100/data-plan-truncated',
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
    throw new TypeError(`Warzone 2100 catalog analysis cannot inspect ${String(value.gameId)}`)
  }
  const maxDocuments = positiveLimit(value.maxDocuments, 'maxDocuments', MAXIMUM_DOCUMENTS)
  const maxTextBytes = positiveLimit(value.maxTextBytes, 'maxTextBytes', MAXIMUM_TEXT_BYTES)
  positiveLimit(value.maxEntities, 'maxEntities', MAXIMUM_ENTITIES)
  positiveLimit(value.maxDepth, 'maxDepth', MAXIMUM_DEPTH)
  if (!Array.isArray(value.documents) || value.documents.length > maxDocuments) {
    throw new TypeError(`documents must be an array with at most ${maxDocuments} entries`)
  }
  if (!Array.isArray(value.queries) || value.queries.length > MAXIMUM_QUERIES) {
    throw new TypeError(`queries must be an array with at most ${MAXIMUM_QUERIES} entries`)
  }
  const localizationDocuments = value.localizationDocuments ?? []
  if (!Array.isArray(localizationDocuments) || localizationDocuments.length !== 0) {
    throw new TypeError('Warzone 2100 JSON stats slice does not accept localization documents')
  }
  const locales = value.locales ?? []
  if (!Array.isArray(locales)) throw new TypeError('locales must be an array')
  const localizationKeys = value.localizationKeys ?? []
  if (!Array.isArray(localizationKeys)) throw new TypeError('localizationKeys must be an array')
  let totalBytes = 0
  for (const [index, document] of value.documents.entries()) {
    const item = recordOf(document)
    if (item === undefined) throw new TypeError(`documents[${index}] must be an object`)
    nonEmptyString(item.rootId, `documents[${index}].rootId`)
    nonEmptyString(item.path, `documents[${index}].path`)
    if (typeof item.text !== 'string')
      throw new TypeError(`documents[${index}].text must be a string`)
    const bytes = encoder.encode(item.text).byteLength
    if (bytes > MAXIMUM_DOCUMENT_BYTES) {
      throw new TypeError(`documents[${index}] exceeds ${MAXIMUM_DOCUMENT_BYTES} bytes`)
    }
    totalBytes += bytes
  }
  if (totalBytes > maxTextBytes) {
    throw new TypeError(`document text exceeds maxTextBytes (${totalBytes} > ${maxTextBytes})`)
  }
  for (const [index, query] of value.queries.entries()) {
    const item = recordOf(query)
    if (item === undefined) throw new TypeError(`queries[${index}] must be an object`)
    nonEmptyString(item.namespace, `queries[${index}].namespace`)
    nonEmptyString(item.entityId, `queries[${index}].entityId`)
  }
  if (value.snapshotId !== undefined) nonEmptyString(value.snapshotId, 'snapshotId')
  return { ...value, localizationDocuments, locales, localizationKeys }
}

function tableForPath(path) {
  const normalized = path.replace(/\\/gu, '/').toLowerCase()
  return TABLES.find(table => normalized.endsWith(`/stats/${table.file}`))
}

function assertJsonDepth(value, maximum, depth = 0) {
  if (depth > maximum) throw new TypeError(`JSON value exceeds maximum depth ${maximum}`)
  if (Array.isArray(value)) {
    for (const item of value) assertJsonDepth(item, maximum, depth + 1)
    return
  }
  const record = recordOf(value)
  if (record !== undefined) {
    for (const item of Object.values(record)) assertJsonDepth(item, maximum, depth + 1)
  }
}

function parseDocument(document, documentIndex, maxDepth) {
  const table = tableForPath(document.path)
  if (table === undefined) {
    throw new TypeError(`${document.path}: unsupported Warzone 2100 stats table`)
  }
  let parsed
  try {
    parsed = JSON.parse(document.text)
  } catch (error) {
    throw new TypeError(`${document.path}: malformed JSON: ${error.message}`)
  }
  assertJsonDepth(parsed, maxDepth)
  const root = recordOf(parsed)
  if (root === undefined) throw new TypeError(`${document.path}: stats root must be an object`)
  const source = Object.freeze({
    rootId: document.rootId,
    path: document.path,
    documentIndex,
    ...(document.revision === undefined ? {} : { revision: document.revision }),
  })
  const patches = []
  const diagnostics = []
  for (const [entityId, rawDefinition] of Object.entries(root)) {
    if (entityId.length === 0 || entityId.includes('\0')) {
      diagnostics.push(
        Object.freeze({
          severity: 'warning',
          code: 'org.modkitx.opensource.warzone2100/catalog-id-refused',
          message: `${document.path} contains an empty or invalid definition key`,
          namespace: table.namespace,
          typeId: table.typeId,
          source,
        }),
      )
      continue
    }
    const definition = recordOf(rawDefinition)
    if (definition === undefined) {
      diagnostics.push(
        Object.freeze({
          severity: 'warning',
          code: 'org.modkitx.opensource.warzone2100/catalog-definition-refused',
          message: `${document.path} definition ${entityId} is not an object`,
          namespace: table.namespace,
          typeId: table.typeId,
          entityId,
          source,
        }),
      )
      continue
    }
    if (typeof definition.id === 'string' && definition.id !== entityId) {
      diagnostics.push(
        Object.freeze({
          severity: 'warning',
          code: 'org.modkitx.opensource.warzone2100/catalog-id-mismatch',
          message: `${document.path} key ${entityId} disagrees with its id field ${definition.id}; the publisher key wins`,
          namespace: table.namespace,
          typeId: table.typeId,
          entityId,
          source,
        }),
      )
    }
    patches.push(
      Object.freeze({
        namespace: table.namespace,
        typeId: table.typeId,
        entityId,
        fields: Object.freeze({ ...definition, id: entityId }),
        source,
      }),
    )
  }
  return { patches, diagnostics }
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
    ...(value.unresolvedRequirementIds ?? []),
  ].join('\0')
  return `provider-token:wz-data-${hashText(source)}`
}

function projectionEvidence(snapshotId, documentCount, unresolvedCount) {
  const adapter = Object.freeze({ id: ANALYZER_ID, version: '1.0.0' })
  return Object.freeze({
    projectionPlan: Object.freeze({
      adapter,
      subjectRevision: snapshotId,
      facets: Object.freeze(
        LIVE_DEFINITION_FACETS.map(ref => Object.freeze({ ref, state: 'published' })),
      ),
    }),
    projectionReceipt: Object.freeze({
      form: 'local',
      adapter,
      subjectRevision: snapshotId,
      companions: Object.freeze([]),
      basis: Object.freeze({
        handedness: 'right',
        upAxis: 'z',
        forwardAxis: 'y',
        unit: 'source-unit',
        sourceUnit: 'warzone-stats-value',
      }),
      planes: Object.freeze([
        Object.freeze({
          planeId: 'schema',
          state: 'normalized',
          note: `${WARZONE_DATA_SCHEMAS.length} native JSON table schemas with all fields observed in WZ 4.7`,
        }),
        Object.freeze({
          planeId: 'effective-definitions',
          state: documentCount === 0 ? 'lost' : 'normalized',
          note: `${documentCount} ordered stats document(s); ${unresolvedCount} optional planned table(s) absent`,
        }),
        Object.freeze({
          planeId: 'localization',
          state: 'lost',
          note: 'localized strings are outside this JSON stats slice',
        }),
        Object.freeze({
          planeId: 'relations',
          state: 'normalized',
          note: 'typed component and model ids are normalized to relation edges with explicit dead targets',
        }),
      ]),
      evidence: Object.freeze([
        Object.freeze({
          kind: 'observed',
          statement: `${documentCount} revision-pinned Warzone 2100 JSON stats document(s) parsed`,
        }),
        Object.freeze({
          kind: 'diagnostic',
          code: 'org.modkitx.opensource.warzone2100/data-schema-slice-partial',
          message:
            'live facets cover templates, structures and features and do not claim all Warzone stats kinds',
        }),
      ]),
      confidence: 'partial',
    }),
  })
}

async function analyzeWarzoneDataInternal(request, includeWorkspaceFacets) {
  request.signal?.throwIfAborted()
  const value = validateRequest(request)
  const patches = []
  const diagnostics = []
  let unresolvedCount = 0
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
      value.documents.length + value.unresolvedRequirementIds.length !== plannedDocumentCount
    ) {
      throw new TypeError(
        'resolved workspace analysis requires exact bounded resource-plan accounting',
      )
    }
    unresolvedCount = value.unresolvedRequirementIds.length
    if (unresolvedCount > 0) {
      diagnostics.push(
        Object.freeze({
          severity: 'information',
          code: 'org.modkitx.opensource.warzone2100/data-optional-tables-unresolved',
          message: `${unresolvedCount} optional per-root stats table(s) were absent`,
        }),
      )
    }
  }
  for (const [documentIndex, document] of value.documents.entries()) {
    const parsed = parseDocument(document, documentIndex, value.maxDepth)
    patches.push(...parsed.patches)
    diagnostics.push(...parsed.diagnostics)
    if (patches.length > value.maxEntities) {
      throw new TypeError(
        `parsed entities exceeds maxEntities (${patches.length} > ${value.maxEntities})`,
      )
    }
  }
  request.signal?.throwIfAborted()
  if (includeWorkspaceFacets) {
    diagnostics.push(
      Object.freeze({
        severity: 'information',
        code: 'org.modkitx.opensource.warzone2100/data-schema-slice-partial',
        message:
          'live data covers templates, structures and features; remaining stats, localization, scripts and writers are named remainder',
      }),
    )
  }
  const snapshotId = snapshotIdentity(value)
  const projection = projectionEvidence(snapshotId, value.documents.length, unresolvedCount)
  return resolveDataCatalog({
    workspaceId: value.workspaceId,
    gameId: value.gameId,
    analyzerId: ANALYZER_ID,
    schemas: WARZONE_DATA_SCHEMAS,
    patches,
    queries: value.queries,
    ...(includeWorkspaceFacets
      ? {
          localizationPatches: [],
          localePreferences: [],
          localizationKeys: [],
          diagnostics,
          snapshotId,
          projectionPlan: projection.projectionPlan,
          projectionReceipt: projection.projectionReceipt,
          includeWorkspaceFacets: true,
        }
      : {}),
    maxEntities: value.maxEntities,
    maxDepth: value.maxDepth,
  })
}

export const analyzeWarzoneData = request => analyzeWarzoneDataInternal(request, false)
export const analyzeWarzoneResolvedData = request => analyzeWarzoneDataInternal(request, true)

function boundedText(value) {
  const text = String(value)
  return text.length <= 65_536 ? text : `${text.slice(0, 65_536)}…[truncated]`
}

function sourceLease(source) {
  let released = false
  const guarded = Object.fromEntries(
    Object.entries(source).map(([name, method]) => [
      name,
      (...args) => {
        if (released) throw new Error('Warzone 2100 data-source lease is released')
        return method(...args)
      },
    ]),
  )
  return Object.freeze({
    value: Object.freeze(guarded),
    async release() {
      released = true
    },
  })
}

function checkedPageSize(value, maximum, label = 'page limit') {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${label} must be a positive integer no greater than ${maximum}`)
  }
  return value
}

function page(items, request, maximum, signal) {
  signal?.throwIfAborted()
  const limit = checkedPageSize(request?.limit, maximum)
  const offset = request.cursor === undefined ? 0 : Number(request.cursor)
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length) {
    throw new RangeError('page cursor is outside the source snapshot')
  }
  const end = Math.min(items.length, offset + limit)
  return Object.freeze({
    items: Object.freeze(items.slice(offset, end)),
    ...(end < items.length ? { nextCursor: String(end) } : {}),
  })
}

function openSchemaTree(snapshot, maxPageSize) {
  const definitionsByNamespace = new Map()
  for (const item of snapshot.definitions) {
    const values = definitionsByNamespace.get(item.namespace) ?? []
    values.push(
      Object.freeze({
        kind: 'effective-definition',
        label: item.entityId,
        preview: boundedText(JSON.stringify(item.fields)),
        semanticPath: Object.freeze([item.namespace, item.entityId]),
      }),
    )
    definitionsByNamespace.set(item.namespace, values)
  }
  const tree = createTreeDataSource(
    Object.freeze({
      kind: 'resolved-definition-workspace',
      label: snapshot.workspaceId,
      preview: `${snapshot.definitions.length} effective definitions`,
      children: Object.freeze([
        Object.freeze({
          kind: 'schema-group',
          label: 'Schemas',
          children: Object.freeze(
            snapshot.schemas.map(item =>
              Object.freeze({
                kind: 'definition-schema',
                label: item.typeId,
                preview: `${item.fields.length} field(s)`,
              }),
            ),
          ),
        }),
        Object.freeze({
          kind: 'definition-group',
          label: 'Effective definitions',
          children: Object.freeze(
            [...definitionsByNamespace.entries()].map(([namespace, children]) =>
              Object.freeze({
                kind: 'definition-namespace',
                label: namespace,
                preview: `${children.length} definition(s)`,
                children: Object.freeze(children),
              }),
            ),
          ),
        }),
      ]),
    }),
  )
  return sourceLease({
    root: (...args) => tree.root(...args),
    children: (node, request, signal) => {
      checkedPageSize(request?.limit, maxPageSize)
      return tree.children(node, request, signal)
    },
    facts: (...args) => tree.facts(...args),
    search: (...args) => tree.search(...args),
  })
}

function openTable(snapshot, rows, header, maxPageSize) {
  const values = Object.freeze(
    rows.map((cells, index) =>
      Object.freeze({ index, cells: Object.freeze(cells.map(boundedText)) }),
    ),
  )
  return sourceLease({
    shape: async () => Object.freeze({ rows: values.length, columns: header.length, header }),
    rows: async (request, signal) => {
      signal?.throwIfAborted()
      checkedPageSize(request?.count, maxPageSize, 'table page count')
      const from = request.kind === 'range' ? request.from : Number(request.cursor)
      if (!Number.isSafeInteger(from) || from < 0 || from > values.length) {
        throw new RangeError('table page starts outside this source snapshot')
      }
      const end = Math.min(values.length, from + request.count)
      return Object.freeze({
        items: Object.freeze(values.slice(from, end)),
        ...(end < values.length ? { nextCursor: String(end) } : {}),
      })
    },
    cell: async coord => {
      if (
        !Number.isSafeInteger(coord?.row) ||
        !Number.isSafeInteger(coord?.column) ||
        coord.row < 0 ||
        coord.column < 0 ||
        coord.row >= values.length ||
        coord.column >= header.length
      ) {
        throw new RangeError('table cell is outside this source snapshot')
      }
      return Object.freeze({ value: values[coord.row].cells[coord.column] ?? '' })
    },
    async *search(query, signal) {
      const pattern = String(query?.pattern ?? '').toLocaleLowerCase()
      for (const row of values) {
        signal?.throwIfAborted()
        for (let column = 0; column < row.cells.length; column += 1) {
          if (row.cells[column].toLocaleLowerCase().includes(pattern)) {
            yield Object.freeze({ row: row.index, column })
          }
        }
      }
    },
  })
}

function openDefinitionTable(snapshot, maxPageSize) {
  const header = Object.freeze(['namespace', 'type', 'id', 'fields', 'roots', 'paths'])
  return openTable(
    snapshot,
    snapshot.definitions.map(item => [
      item.namespace,
      item.typeId,
      item.entityId,
      JSON.stringify(item.fields),
      item.sources.map(source => source.rootId).join('\n'),
      item.sources.map(source => source.path).join('\n'),
    ]),
    header,
    maxPageSize,
  )
}

function openLocalizationTable(snapshot, maxPageSize) {
  return openTable(
    snapshot,
    [],
    Object.freeze(['key', 'value', 'locale', 'root', 'path']),
    maxPageSize,
  )
}

function openRelations(snapshot, maxPageSize) {
  const nodes = []
  const nodeIds = new Set()
  const addNode = (id, label, type) => {
    if (nodeIds.has(id)) return
    nodeIds.add(id)
    nodes.push(Object.freeze({ id, label, type }))
  }
  for (const entity of snapshot.definitions) {
    addNode(`${entity.namespace}/${entity.entityId}`, entity.entityId, entity.namespace)
  }
  const edges = snapshot.relations.map(relation => {
    const from = `${relation.from.namespace}/${relation.from.entityId}`
    const to = `${relation.to.namespace}/${relation.to.entityId}`
    if (relation.dead) addNode(to, relation.to.entityId, `missing-${relation.to.namespace}`)
    return Object.freeze({
      from,
      to,
      role: relation.role,
      ...(relation.dead ? { dead: true } : {}),
    })
  })
  return sourceLease({
    summary: async signal => {
      signal?.throwIfAborted()
      return Object.freeze({
        snapshotId: snapshot.snapshotId,
        totalNodes: nodes.length,
        totalEdges: edges.length,
        types: Object.freeze([]),
        completeness: 'partial',
        reason:
          'relations cover the three admitted JSON stats tables; referenced component and model tables remain named remainder',
      })
    },
    nodes: async (request, signal) => page(nodes, request, maxPageSize, signal),
    edges: async (request, signal) => page(edges, request, maxPageSize, signal),
  })
}

function createResolvedWorkspaceProvider() {
  const snapshots = new Map()
  const remember = snapshot => {
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
      throw new RangeError(`snapshot ${request.snapshotId} is stale, unknown or evicted`)
    }
    if (kind === 'schema-tree') return openSchemaTree(snapshot, maxPageSize)
    if (kind === 'definition-table') return openDefinitionTable(snapshot, maxPageSize)
    if (kind === 'localization-table') return openLocalizationTable(snapshot, maxPageSize)
    return openRelations(snapshot, maxPageSize)
  }
  return Object.freeze({
    contract: RESOLVED_DATA_WORKSPACE_CONTRACT,
    providerId: ANALYZER_ID,
    gameIds: Object.freeze([GAME_ID]),
    plan: planWarzoneDataWorkspace,
    analyze: async request => remember(await analyzeWarzoneResolvedData(request)),
    openSchemaTree: request => open(request, 'schema-tree'),
    openDefinitionTable: request => open(request, 'definition-table'),
    openLocalizationTable: request => open(request, 'localization-table'),
    openRelations: request => open(request, 'relations'),
  })
}

export const abiVersion = 1
export const provides = Object.freeze([
  DATA_CATALOG_ANALYSIS_CONTRACT,
  RESOLVED_DATA_WORKSPACE_CONTRACT,
])

export function createProvider(selection) {
  if (
    selection.major !== 1 ||
    (selection.contract !== DATA_CATALOG_ANALYSIS_CONTRACT &&
      selection.contract !== RESOLVED_DATA_WORKSPACE_CONTRACT)
  ) {
    throw new TypeError(
      `unsupported Warzone 2100 data selection ${selection.contract}@${selection.major}`,
    )
  }
  const value =
    selection.contract === DATA_CATALOG_ANALYSIS_CONTRACT
      ? Object.freeze({
          contract: DATA_CATALOG_ANALYSIS_CONTRACT,
          analyzerId: ANALYZER_ID,
          gameIds: Object.freeze([GAME_ID]),
          analyze: analyzeWarzoneData,
        })
      : createResolvedWorkspaceProvider()
  return Object.freeze({ value, release: async () => undefined })
}
