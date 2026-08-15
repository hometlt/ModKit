import { parseTree, printParseErrorCode } from 'jsonc-parser'
import { parseXml } from '@rgrove/parse-xml'
import { parseDocument as parseYamlDocument, stringify as stringifyYaml } from 'yaml'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { diagnostic, throwIfAborted } from '@modkitx-x3/core'
import { decodeInput, encodeText, failure, lease, preflight, span } from '../shared/text.js'

const CONTRACT_FORMAT = Object.freeze({
  'common.text-data/json-syntax': 'json',
  'common.text-data/jsonc-syntax': 'jsonc',
  'common.text-data/xml-syntax': 'xml',
  'common.text-data/yaml-syntax': 'yaml',
  'common.text-data/toml-syntax': 'toml',
  'common.text-data/ini-syntax': 'ini',
  'common.text-data/csv-syntax': 'csv',
  'common.text-data/tsv-syntax': 'tsv',
})

function scalar(value, raw = JSON.stringify(value)) {
  if (value === null) return { kind: 'null', raw: 'null' }
  if (typeof value === 'boolean') return { kind: 'boolean', value, raw: String(value) }
  if (typeof value === 'string') return { kind: 'string', value, raw: raw ?? JSON.stringify(value) }
  if (typeof value === 'bigint')
    return { kind: 'integer', decimal: String(value), raw: String(value) }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return { kind: 'integer', decimal: String(value), raw: raw ?? String(value) }
  }
  if (typeof value === 'number')
    return { kind: 'number', raw: raw ?? String(value), finiteValue: value }
  if (value instanceof Date)
    return { kind: 'date-time', iso: value.toISOString(), raw: raw ?? value.toISOString() }
  return { kind: 'string', value: String(value), raw: raw ?? String(value) }
}

function jsonNode(node, text, counters, depth = 0) {
  counters.nodes += 1
  counters.depth = Math.max(counters.depth, depth)
  const range = span(text, node.offset, node.length)
  if (node.type === 'object') {
    return {
      kind: 'object',
      members: (node.children ?? []).map(property => ({
        key: String(property.children?.[0]?.value ?? ''),
        keyRange: span(
          text,
          property.children?.[0]?.offset ?? property.offset,
          property.children?.[0]?.length ?? 0,
        ),
        value: jsonNode(property.children?.[1], text, counters, depth + 1),
      })),
      range,
    }
  }
  if (node.type === 'array') {
    return {
      kind: 'array',
      items: (node.children ?? []).map(item => jsonNode(item, text, counters, depth + 1)),
      range,
    }
  }
  return {
    kind: 'scalar',
    value: scalar(node.value, text.slice(node.offset, node.offset + node.length)),
    range,
  }
}

function parseJson(decoded, dialect, budget) {
  const errors = []
  const root = parseTree(decoded.text, errors, {
    allowTrailingComma: dialect === 'jsonc',
    disallowComments: dialect === 'json',
  })
  if (!root || errors.length > 0) {
    const first = errors[0] ?? { error: 0, offset: 0, length: 0 }
    return failure(
      'org.modkitx/text-data-json-parse',
      printParseErrorCode(first.error),
      decoded.text,
      first.offset,
      first.length,
    )
  }
  const counters = { nodes: 0, depth: 0 }
  const converted = jsonNode(root, decoded.text, counters)
  if (counters.nodes > budget.maxNodes || counters.depth > budget.maxDepth) {
    return {
      state: 'truncated',
      document: { dialect, root: converted, trivia: [], source: decoded.source },
      truncated: { limit: counters.nodes > budget.maxNodes ? 'maxNodes' : 'maxDepth' },
      diagnostics: [],
    }
  }
  return {
    state: 'ok',
    document: { dialect, root: converted, trivia: [], source: decoded.source },
    diagnostics: [],
  }
}

function plainNode(value, text, counters, depth = 0) {
  counters.nodes += 1
  counters.depth = Math.max(counters.depth, depth)
  const range = span(text)
  if (Array.isArray(value))
    return {
      kind: 'sequence',
      items: value.map(item => plainNode(item, text, counters, depth + 1)),
      range,
    }
  if (value && typeof value === 'object') {
    return {
      kind: 'mapping',
      pairs: Object.entries(value).map(([key, item]) => ({
        key: { kind: 'scalar', value: scalar(key), range },
        value: plainNode(item, text, counters, depth + 1),
      })),
      range,
    }
  }
  return { kind: 'scalar', value: scalar(value), range }
}

function parseYaml(decoded, budget) {
  try {
    const document = parseYamlDocument(decoded.text, {
      maxAliasCount: 0,
      strict: true,
      uniqueKeys: true,
    })
    if (document.errors.length > 0)
      return failure('org.modkitx/text-data-yaml-parse', document.errors[0].message, decoded.text)
    const counters = { nodes: 0, depth: 0 }
    const model = {
      documents: [plainNode(document.toJS({ maxAliasCount: 0 }), decoded.text, counters)],
      trivia: [],
      source: decoded.source,
    }
    if (counters.nodes > budget.maxNodes || counters.depth > budget.maxDepth)
      return {
        state: 'truncated',
        document: model,
        truncated: { limit: counters.nodes > budget.maxNodes ? 'maxNodes' : 'maxDepth' },
        diagnostics: [],
      }
    return { state: 'ok', document: model, diagnostics: [] }
  } catch (error) {
    return failure(
      'org.modkitx/text-data-yaml-alias',
      error instanceof Error ? error.message : String(error),
      decoded.text,
    )
  }
}

function tomlValue(value, text) {
  const range = span(text)
  if (Array.isArray(value))
    return { kind: 'array', items: value.map(item => tomlValue(item, text)), range }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return {
      kind: 'inline-table',
      entries: Object.entries(value).map(([key, item]) => ({
        path: [key],
        value: tomlValue(item, text),
        range,
      })),
      range,
    }
  }
  return { kind: 'scalar', value: scalar(value), range }
}

function parseTomlDocument(decoded) {
  try {
    const value = parseToml(decoded.text)
    return {
      state: 'ok',
      document: {
        entries: Object.entries(value).map(([key, item]) => ({
          path: [key],
          value: tomlValue(item, decoded.text),
          range: span(decoded.text),
        })),
        source: decoded.source,
      },
      diagnostics: [],
    }
  } catch (error) {
    return failure(
      'org.modkitx/text-data-toml-parse',
      error instanceof Error ? error.message : String(error),
      decoded.text,
    )
  }
}

function parseIni(decoded, dialect) {
  const sections = []
  let current = { name: '', entries: [], range: span(decoded.text, 0, 0) }
  sections.push(current)
  const seen = new Set()
  let offset = 0
  for (const line of decoded.text.split(/\r\n|\r|\n/u)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      offset += line.length + 1
      continue
    }
    const section = /^\[([^\]]+)\]$/u.exec(trimmed)
    if (section) {
      current = { name: section[1], entries: [], range: span(decoded.text, offset, line.length) }
      sections.push(current)
    } else {
      const equals = line.indexOf('=')
      if (equals <= 0)
        return failure(
          'org.modkitx/text-data-ini-parse',
          'INI entry requires a non-empty key',
          decoded.text,
          offset,
          line.length,
        )
      const key = line.slice(0, equals).trim()
      const identity = `${current.name}\0${key}`
      if (dialect === 'ini-basic' && seen.has(identity))
        return failure(
          'org.modkitx/text-data-ini-duplicate',
          `duplicate key ${key}`,
          decoded.text,
          offset,
          line.length,
        )
      seen.add(identity)
      current.entries.push({
        key,
        value: line.slice(equals + 1).trim(),
        range: span(decoded.text, offset, line.length),
      })
    }
    offset += line.length + 1
  }
  return { state: 'ok', document: { sections, source: decoded.source }, diagnostics: [] }
}

function* delimitedRows(text, delimiter, signal, includeRanges = true) {
  let cells = []
  let value = ''
  let quoted = false
  let cellStart = 0
  let rowIndex = 0
  for (let index = 0; index <= text.length; index += 1) {
    if ((index & 4095) === 0) throwIfAborted(signal)
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else if (character === '"') quoted = false
      else if (character === undefined) throw new SyntaxError('unterminated quote')
      else value += character
      continue
    }
    if (character === '"' && value === '') quoted = true
    else if (
      character === delimiter ||
      character === '\n' ||
      character === '\r' ||
      character === undefined
    ) {
      cells.push({
        value,
        ...(includeRanges ? { range: span(text, cellStart, index - cellStart) } : {}),
      })
      value = ''
      cellStart = index + 1
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1
        cellStart += 1
      }
      if (character === '\n' || character === '\r' || character === undefined) {
        if (
          character === undefined &&
          cells.length === 1 &&
          cells[0]?.value === '' &&
          /(?:\r\n|\r|\n)$/u.test(text)
        ) {
          cells = []
          break
        }
        yield { index: rowIndex, cells }
        rowIndex += 1
        cells = []
      }
    } else value += character
  }
}

export function parseDelimitedRows(text, delimiter, budget, signal) {
  const rows = []
  for (const row of delimitedRows(text, delimiter, signal)) {
    rows.push(row)
    if (rows.length >= budget.maxNodes) return { rows, complete: false }
  }
  return { rows, complete: true }
}

function parseDelimited(decoded, dialect, budget, signal) {
  try {
    const delimiter = dialect.includes('tsv') ? '\t' : ','
    const parsed = parseDelimitedRows(decoded.text, delimiter, budget, signal)
    const document = { rows: parsed.rows, complete: parsed.complete, source: decoded.source }
    return parsed.complete
      ? { state: 'ok', document, diagnostics: [] }
      : { state: 'truncated', document, truncated: { limit: 'maxNodes' }, diagnostics: [] }
  } catch (error) {
    return failure(
      'org.modkitx/text-data-delimited-parse',
      error instanceof Error ? error.message : String(error),
      decoded.text,
    )
  }
}

function xmlNode(node, text) {
  const range = span(text)
  const name = node.name ?? node.target ?? ''
  if (node.type === 'element' || node.children) {
    return {
      kind: 'element',
      qualifiedName: name,
      localName: name.includes(':') ? name.split(':').at(-1) : name,
      attributes: Object.entries(node.attributes ?? {}).map(([key, value]) => ({
        qualifiedName: key,
        localName: key.includes(':') ? key.split(':').at(-1) : key,
        value: String(value),
        range,
      })),
      children: (node.children ?? []).map(child => xmlNode(child, text)).filter(Boolean),
      range,
    }
  }
  if (node.type === 'comment')
    return { kind: 'comment', value: node.text ?? node.value ?? '', range }
  if (node.type === 'cdata') return { kind: 'cdata', value: node.text ?? node.value ?? '', range }
  if (node.type === 'processing-instruction')
    return {
      kind: 'processing-instruction',
      target: name,
      value: node.text ?? node.value ?? '',
      range,
    }
  return { kind: 'text', value: node.text ?? node.value ?? String(node), range }
}

function parseXmlDocument(decoded) {
  if (/<!DOCTYPE|<!ENTITY/iu.test(decoded.text))
    return failure(
      'org.modkitx/text-data-xml-doctype',
      'DTD and custom entities are forbidden',
      decoded.text,
    )
  try {
    const parsed = parseXml(decoded.text)
    const element = parsed.children?.find(child => child.type === 'element' || child.name)
    if (!element)
      return failure('org.modkitx/text-data-xml-root', 'XML root element is missing', decoded.text)
    return {
      state: 'ok',
      document: { root: xmlNode(element, decoded.text), source: decoded.source },
      diagnostics: [],
    }
  } catch (error) {
    return failure(
      'org.modkitx/text-data-xml-parse',
      error instanceof Error ? error.message : String(error),
      decoded.text,
    )
  }
}

function valueFromJsonNode(node) {
  if (node.kind === 'scalar') {
    if (node.value.kind === 'null') return null
    if ('value' in node.value) return node.value.value
    if (node.value.kind === 'integer') return Number(node.value.decimal)
    return Number(node.value.raw)
  }
  if (node.kind === 'array') return node.items.map(valueFromJsonNode)
  return Object.fromEntries(
    node.members.map(member => [member.key, valueFromJsonNode(member.value)]),
  )
}

function serializeDocument(format, request) {
  let text
  if (format === 'json' || format === 'jsonc')
    text = `${JSON.stringify(valueFromJsonNode(request.document.root), null, 2)}\n`
  else if (format === 'yaml')
    text = stringifyYaml(request.document.documents.map(node => node.kind))
  else if (format === 'toml')
    text = stringifyToml(
      Object.fromEntries(
        request.document.entries.map(entry => [
          entry.path.join('.'),
          entry.value.kind === 'scalar' && 'value' in entry.value.value
            ? entry.value.value.value
            : '',
        ]),
      ),
    )
  else if (format === 'ini')
    text = request.document.sections
      .map(
        section =>
          `${section.name ? `[${section.name}]\n` : ''}${section.entries.map(entry => `${entry.key}=${entry.value}`).join('\n')}`,
      )
      .join('\n')
  else if (format === 'csv' || format === 'tsv') {
    const delimiter = format === 'tsv' ? '\t' : ','
    text = request.document.rows
      .map(row =>
        row.cells
          .map(cell =>
            /["\r\n,\t]/u.test(cell.value) ? `"${cell.value.replace(/"/gu, '""')}"` : cell.value,
          )
          .join(delimiter),
      )
      .join('\n')
  } else
    text = request.document.root
      ? `<${request.document.root.qualifiedName}></${request.document.root.qualifiedName}>\n`
      : ''
  return encodeText(text, request.document.source, request.target)
}

function treeDataSource(document) {
  const nodes = new Map()
  const root = { id: 'root', hasChildren: true }
  nodes.set('root', { value: document, children: [] })
  const entries =
    document.root?.kind === 'object'
      ? document.root.members.map(member => [member.key, member.value])
      : Object.entries(document)
  nodes.get('root').children = entries.map(([key, value], index) => {
    const id = `root/${index}`
    nodes.set(id, { value, label: String(key), children: [] })
    return { id, hasChildren: false }
  })
  return {
    async root() {
      return root
    },
    async children(node, page) {
      const all = nodes.get(node.id)?.children ?? []
      const start = page.cursor ? Number(page.cursor) : 0
      const items = all.slice(start, start + page.limit)
      return {
        items,
        ...(start + items.length < all.length ? { nextCursor: String(start + items.length) } : {}),
      }
    },
    async facts(node) {
      const item = nodes.get(node.id)
      return {
        kind: item?.value?.kind ?? 'value',
        label: item?.label ?? 'root',
        preview: typeof item?.value === 'string' ? item.value : undefined,
      }
    },
    async *search(query) {
      for (const [id, item] of nodes)
        if ((item.label ?? '').includes(query.pattern))
          yield { id, hasChildren: (item.children?.length ?? 0) > 0 }
    },
  }
}

function lazyTableDataSource(decoded, delimiter) {
  const rowAt = (index, signal) => {
    for (const row of delimitedRows(decoded.text, delimiter, signal, false)) {
      if (row.index === index) return row
      if (row.index > index) break
    }
    return undefined
  }
  return {
    async shape() {
      const first = rowAt(0)
      return { rows: 'unknown', columns: first?.cells.length ?? 0 }
    },
    async rows(request, signal) {
      const start = request.kind === 'range' ? request.from : Number(request.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new RangeError('invalid row cursor')
      const wanted = Math.max(0, request.count)
      const items = []
      let hasMore = false
      for (const row of delimitedRows(decoded.text, delimiter, signal, false)) {
        if (row.index < start) continue
        if (items.length === wanted) {
          hasMore = true
          break
        }
        items.push({ index: row.index, cells: row.cells.map(cell => cell.value) })
      }
      return {
        items,
        ...(hasMore ? { nextCursor: String(start + items.length) } : {}),
      }
    },
    async cell(coord) {
      const cell = rowAt(coord.row)?.cells[coord.column]
      return { value: cell?.value ?? '', ...(cell?.range ? { range: cell.range } : {}) }
    },
    async *search(query, signal) {
      for (const row of delimitedRows(decoded.text, delimiter, signal, false)) {
        for (let column = 0; column < row.cells.length; column += 1) {
          if (row.cells[column].value.includes(query.pattern)) yield { row: row.index, column }
        }
      }
    },
  }
}

export function createTextSyntaxProvider(contract) {
  const format = CONTRACT_FORMAT[contract]
  if (!format) throw new TypeError(`unknown text-data contract: ${contract}`)
  return Object.freeze({
    contract,
    async parse(request) {
      throwIfAborted(request.signal)
      let decoded
      try {
        decoded = decodeInput(request.input)
      } catch (error) {
        return failure(
          'org.modkitx/text-data-decode',
          error instanceof Error ? error.message : String(error),
        )
      }
      const rejected = preflight(decoded, request.budget, request.signal)
      if (rejected) return rejected
      if (format === 'json' || format === 'jsonc') return parseJson(decoded, format, request.budget)
      if (format === 'xml') return parseXmlDocument(decoded)
      if (format === 'yaml') return parseYaml(decoded, request.budget)
      if (format === 'toml') return parseTomlDocument(decoded)
      if (format === 'ini') return parseIni(decoded, request.dialect)
      return parseDelimited(decoded, request.dialect, request.budget, request.signal)
    },
    async serialize(request) {
      throwIfAborted(request.signal)
      const result = serializeDocument(format, request)
      if (BigInt(result.bytes.byteLength) > request.budget.maxInputBytes)
        return {
          ...result,
          bytes: new Uint8Array(),
          diagnostics: [
            diagnostic(
              'error',
              'org.modkitx/text-data-output-budget',
              'serialized output exceeds maxInputBytes',
            ),
          ],
        }
      return result
    },
    async dataSource(request) {
      if (format === 'csv' || format === 'tsv') {
        throwIfAborted(request.signal)
        let decoded
        try {
          decoded = decodeInput(request.input)
        } catch (error) {
          throw new TypeError(error instanceof Error ? error.message : String(error))
        }
        const rejected = preflight(decoded, request.budget, request.signal)
        if (rejected) throw new TypeError(rejected.diagnostics[0]?.message ?? 'preflight failed')
        return lease(lazyTableDataSource(decoded, format === 'tsv' ? '\t' : ','))
      }
      const parsed = await this.parse(request)
      if (parsed.state === 'failed')
        throw new TypeError(parsed.diagnostics[0]?.message ?? 'parse failed')
      return lease(treeDataSource(parsed.document))
    },
  })
}

export const TEXT_DATA_CONTRACTS = Object.freeze(Object.keys(CONTRACT_FORMAT))

export function createProvider(selection) {
  return createTextSyntaxProvider(selection.contract)
}

export const abiVersion = 1
