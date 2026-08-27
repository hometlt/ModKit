const MAXIMUM_PAGE_SIZE = 1_000
const MAXIMUM_CELL_CHARACTERS = 65_536

function boundedText(value) {
  const text = String(value)
  if (text.length <= MAXIMUM_CELL_CHARACTERS) return text
  return `${text.slice(0, MAXIMUM_CELL_CHARACTERS)}…[truncated ${text.length - MAXIMUM_CELL_CHARACTERS} characters]`
}

function abort(signal) {
  signal?.throwIfAborted()
}

function pageLimit(request, maximum) {
  if (!Number.isSafeInteger(request?.limit) || request.limit <= 0 || request.limit > maximum) {
    throw new RangeError(`page limit must be a positive integer no greater than ${maximum}`)
  }
  return request.limit
}

function cursorPrefix(kind, snapshotId) {
  return `sc2-data-v1:${kind}:${encodeURIComponent(snapshotId)}:`
}

function offsetOf(request, kind, snapshotId, length) {
  const prefix = cursorPrefix(kind, snapshotId)
  if (request.cursor === undefined) return 0
  if (!request.cursor.startsWith(prefix)) {
    throw new RangeError('page cursor belongs to another source snapshot or page kind')
  }
  const offset = Number(request.cursor.slice(prefix.length))
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > length) {
    throw new RangeError('page cursor is outside the source snapshot')
  }
  return offset
}

function page(items, request, kind, snapshotId, maximum, signal) {
  abort(signal)
  const limit = pageLimit(request, maximum)
  const offset = offsetOf(request, kind, snapshotId, items.length)
  const end = Math.min(items.length, offset + limit)
  abort(signal)
  return Object.freeze({
    items: Object.freeze(items.slice(offset, end)),
    ...(end < items.length
      ? { nextCursor: `${cursorPrefix(kind, snapshotId)}${String(end)}` }
      : {}),
  })
}

function lifecycle(source) {
  let released = false
  const guard = () => {
    if (released) throw new Error('StarCraft II data-source lease is released')
  }
  const guarded = Object.fromEntries(
    Object.entries(source).map(([name, method]) => [
      name,
      (...args) => {
        guard()
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

function validateOpen(snapshot, maxPageSize) {
  if (typeof snapshot?.snapshotId !== 'string' || snapshot.snapshotId.length === 0) {
    throw new TypeError('data-source snapshot must carry a non-empty snapshotId')
  }
  if (!Number.isSafeInteger(maxPageSize) || maxPageSize <= 0 || maxPageSize > MAXIMUM_PAGE_SIZE) {
    throw new RangeError(
      `maxPageSize must be a positive integer no greater than ${MAXIMUM_PAGE_SIZE}`,
    )
  }
}

function schemaTree(snapshot, maxPageSize) {
  const namespaces = snapshot.namespaces.map(item =>
    Object.freeze({ id: `namespace:${encodeURIComponent(item.namespace)}`, hasChildren: true }),
  )
  const schemas = snapshot.schemas.map(item =>
    Object.freeze({ id: `schema:${encodeURIComponent(item.typeId)}`, hasChildren: false }),
  )
  const localizations = snapshot.localizedStrings.map(item =>
    Object.freeze({ id: `localization:${encodeURIComponent(item.key)}`, hasChildren: false }),
  )
  const definitionsByNamespace = new Map()
  for (const item of snapshot.definitions) {
    const values = definitionsByNamespace.get(item.namespace) ?? []
    values.push(
      Object.freeze({
        id: `definition:${encodeURIComponent(item.namespace)}:${encodeURIComponent(item.entityId)}`,
        hasChildren: false,
      }),
    )
    definitionsByNamespace.set(item.namespace, values)
  }
  const root = Object.freeze({ id: 'root', hasChildren: true })
  const groups = Object.freeze([
    Object.freeze({ id: 'schemas', hasChildren: schemas.length > 0 }),
    Object.freeze({ id: 'definitions', hasChildren: namespaces.length > 0 }),
    Object.freeze({ id: 'localization', hasChildren: localizations.length > 0 }),
  ])

  const childrenOf = node => {
    if (node.id === 'root') return groups
    if (node.id === 'schemas') return schemas
    if (node.id === 'definitions') return namespaces
    if (node.id === 'localization') return localizations
    if (node.id.startsWith('namespace:')) {
      return Object.freeze(
        definitionsByNamespace.get(decodeURIComponent(node.id.slice('namespace:'.length))) ?? [],
      )
    }
    return Object.freeze([])
  }
  const facts = node => {
    if (node.id === 'root') {
      return Object.freeze({
        kind: 'resolved-definition-workspace',
        label: snapshot.workspaceId,
        preview: `${snapshot.definitions.length} definitions; ${snapshot.localizedStrings.length} localized strings`,
      })
    }
    if (node.id === 'schemas') {
      return Object.freeze({ kind: 'schema-group', label: 'Schemas' })
    }
    if (node.id === 'definitions') {
      return Object.freeze({ kind: 'definition-group', label: 'Effective definitions' })
    }
    if (node.id === 'localization') {
      return Object.freeze({ kind: 'localization-group', label: 'Localization' })
    }
    if (node.id.startsWith('schema:')) {
      const typeId = decodeURIComponent(node.id.slice('schema:'.length))
      const schema = snapshot.schemas.find(item => item.typeId === typeId)
      return Object.freeze({
        kind: 'definition-schema',
        label: typeId,
        preview: `${schema?.fields.length ?? 0} bounded field(s)`,
      })
    }
    if (node.id.startsWith('namespace:')) {
      const namespace = decodeURIComponent(node.id.slice('namespace:'.length))
      return Object.freeze({
        kind: 'definition-namespace',
        label: namespace,
        preview: `${definitionsByNamespace.get(namespace)?.length ?? 0} definition(s)`,
      })
    }
    if (node.id.startsWith('definition:')) {
      const [namespace, entityId] = node.id
        .slice('definition:'.length)
        .split(':')
        .map(decodeURIComponent)
      const entity = snapshot.definitions.find(
        item => item.namespace === namespace && item.entityId === entityId,
      )
      return Object.freeze({
        kind: 'effective-definition',
        label: entityId ?? '',
        preview: entity === undefined ? 'unavailable' : boundedText(JSON.stringify(entity.fields)),
        semanticPath: Object.freeze([namespace ?? '', entityId ?? '']),
      })
    }
    if (node.id.startsWith('localization:')) {
      const key = decodeURIComponent(node.id.slice('localization:'.length))
      const item = snapshot.localizedStrings.find(value => value.key === key)
      return Object.freeze({
        kind: 'localized-string',
        label: key,
        preview: boundedText(item?.value ?? ''),
        semanticPath: Object.freeze(['localization', key]),
      })
    }
    throw new RangeError(`unknown tree node ${node.id}`)
  }

  return lifecycle({
    root: async () => root,
    children: async (node, request, signal) =>
      page(childrenOf(node), request, `tree:${node.id}`, snapshot.snapshotId, maxPageSize, signal),
    facts: async node => facts(node),
    async *search(query, signal) {
      const pattern = String(query?.pattern ?? '').toLocaleLowerCase()
      const candidates = [root, ...groups, ...schemas, ...namespaces, ...localizations]
      for (const values of definitionsByNamespace.values()) candidates.push(...values)
      for (const node of candidates) {
        abort(signal)
        const item = facts(node)
        if (`${item.label}\n${item.preview ?? ''}`.toLocaleLowerCase().includes(pattern)) yield node
      }
    },
  })
}

function tableSource(snapshot, rows, header, kind, maxPageSize) {
  const frozenRows = Object.freeze(
    rows.map((cells, index) =>
      Object.freeze({ index, cells: Object.freeze(cells.map(boundedText)) }),
    ),
  )
  const prefix = cursorPrefix(kind, snapshot.snapshotId)
  const parseFrom = request => {
    if (request?.kind === 'range') return request.from
    if (request?.kind !== 'cursor' || !request.cursor.startsWith(prefix)) {
      throw new RangeError('table cursor belongs to another source snapshot or table')
    }
    return Number(request.cursor.slice(prefix.length))
  }
  const checked = request => {
    if (
      !Number.isSafeInteger(request?.count) ||
      request.count <= 0 ||
      request.count > maxPageSize
    ) {
      throw new RangeError(`table page count must be at most ${maxPageSize}`)
    }
    const from = parseFrom(request)
    if (!Number.isSafeInteger(from) || from < 0 || from > frozenRows.length) {
      throw new RangeError('table page starts outside this source snapshot')
    }
    return from
  }
  return lifecycle({
    shape: async () => Object.freeze({ rows: frozenRows.length, columns: header.length, header }),
    rows: async (request, signal) => {
      abort(signal)
      const from = checked(request)
      const end = Math.min(frozenRows.length, from + request.count)
      return Object.freeze({
        items: Object.freeze(frozenRows.slice(from, end)),
        ...(end < frozenRows.length ? { nextCursor: `${prefix}${String(end)}` } : {}),
      })
    },
    cell: async coord => {
      if (
        !Number.isSafeInteger(coord?.row) ||
        !Number.isSafeInteger(coord?.column) ||
        coord.row < 0 ||
        coord.column < 0 ||
        coord.row >= frozenRows.length ||
        coord.column >= header.length
      ) {
        throw new RangeError('table cell is outside this source snapshot')
      }
      return Object.freeze({ value: frozenRows[coord.row].cells[coord.column] ?? '' })
    },
    async *search(query, signal) {
      const pattern = String(query?.pattern ?? '').toLocaleLowerCase()
      for (const row of frozenRows) {
        abort(signal)
        for (let column = 0; column < row.cells.length; column += 1) {
          if (row.cells[column].toLocaleLowerCase().includes(pattern)) {
            yield Object.freeze({ row: row.index, column })
          }
        }
      }
    },
  })
}

function definitionTable(snapshot, maxPageSize) {
  const header = Object.freeze([
    'namespace',
    'type',
    'id',
    'parent',
    'fields',
    'complete',
    'roots',
    'paths',
  ])
  const rows = snapshot.definitions.map(item =>
    Object.freeze([
      item.namespace,
      item.typeId,
      item.entityId,
      item.parentEntityId ?? '',
      JSON.stringify(item.fields),
      String(item.complete),
      item.sources.map(source => source.rootId).join('\n'),
      item.sources.map(source => source.path).join('\n'),
    ]),
  )
  return tableSource(snapshot, rows, header, 'definitions', maxPageSize)
}

function localizationTable(snapshot, maxPageSize) {
  const header = Object.freeze([
    'key',
    'value',
    'requestedLocale',
    'resolvedLocale',
    'fallback',
    'root',
    'path',
  ])
  const rows = snapshot.localizedStrings.map(item =>
    Object.freeze([
      item.key,
      item.value,
      item.requestedLocale,
      item.resolvedLocale,
      String(item.fallback),
      item.source.rootId,
      item.source.path,
    ]),
  )
  return tableSource(snapshot, rows, header, 'localization', maxPageSize)
}

function relationSource(snapshot, maxPageSize) {
  const nodes = []
  const nodeIds = new Set()
  const counts = new Map()
  const addNode = (id, label, type) => {
    if (nodeIds.has(id)) return
    nodeIds.add(id)
    nodes.push(Object.freeze({ id, label, type }))
    counts.set(type, (counts.get(type) ?? 0) + 1)
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
  const summary = Object.freeze({
    snapshotId: snapshot.snapshotId,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    types: Object.freeze(
      [...counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, count], tone) => Object.freeze({ id, label: id, count, tone })),
    ),
    completeness: 'partial',
    reason:
      'the graph is complete only for the named bootstrap schema slice; omitted catalog kinds and fields remain outside this live source',
  })
  return lifecycle({
    summary: async signal => {
      abort(signal)
      return summary
    },
    nodes: async (request, signal) =>
      page(nodes, request, 'relation-nodes', snapshot.snapshotId, maxPageSize, signal),
    edges: async (request, signal) =>
      page(edges, request, 'relation-edges', snapshot.snapshotId, maxPageSize, signal),
  })
}

export function openStarcraft2DataSource(snapshot, kind, maxPageSize) {
  validateOpen(snapshot, maxPageSize)
  if (kind === 'schema-tree') return schemaTree(snapshot, maxPageSize)
  if (kind === 'definition-table') return definitionTable(snapshot, maxPageSize)
  if (kind === 'localization-table') return localizationTable(snapshot, maxPageSize)
  if (kind === 'relations') return relationSource(snapshot, maxPageSize)
  throw new TypeError(`unknown StarCraft II data-source kind ${String(kind)}`)
}
