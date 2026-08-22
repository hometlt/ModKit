// Hand-ported authored-text surface of org.modkitx/galaxy. Language-provider behavior is
// intentionally owned by the X3 language contract, not duplicated inside this codec.

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/galaxy'
const ascii = new TextDecoder('ascii', { fatal: false })
const utf8 = new TextDecoder('utf-8', { fatal: true })

export function decodeStructuredText(bytes, budget, label) {
  if (bytes.byteLength > budget.maxScalarBytes) {
    throw new RangeError(`${label} text exceeds maxScalarBytes budget`)
  }
  if (bytes.includes(0)) throw new TypeError(`${label} contains a NUL byte`)
  try {
    return utf8.decode(bytes)
  } catch {
    throw new TypeError(`${label} is not valid UTF-8`)
  }
}

export function lineCount(text) {
  return text === '' ? 0 : text.split(/\r\n|\r|\n/u).length
}

export function createTableDataSource(header, values) {
  const rows = Object.freeze(
    values.map((cells, index) =>
      Object.freeze({ index, cells: Object.freeze(cells.map(value => String(value))) }),
    ),
  )
  const pageFrom = request => {
    if (!Number.isSafeInteger(request.count) || request.count <= 0) {
      throw new TypeError('table page count must be a positive safe integer')
    }
    if (request.kind === 'range') {
      if (!Number.isSafeInteger(request.from) || request.from < 0) {
        throw new TypeError('table range start must be a non-negative safe integer')
      }
      return request.from
    }
    const value = Number(request.cursor)
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('table cursor is invalid')
    return value
  }
  return Object.freeze({
    async shape() {
      return Object.freeze({
        rows: rows.length,
        columns: header.length,
        header: Object.freeze([...header]),
      })
    },
    async rows(request, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const start = pageFrom(request)
      const items = rows.slice(start, start + request.count)
      return Object.freeze({
        items: Object.freeze(items),
        ...(start + items.length < rows.length ? { nextCursor: String(start + items.length) } : {}),
      })
    },
    async cell(coord) {
      if (!Number.isSafeInteger(coord.row) || !Number.isSafeInteger(coord.column)) {
        throw new TypeError('table cell coordinate is invalid')
      }
      const value = rows[coord.row]?.cells[coord.column]
      if (value === undefined) throw new RangeError('table cell is outside the data')
      return Object.freeze({ value })
    },
    async *search(query, signal) {
      const needle = query.pattern.toLocaleLowerCase()
      for (const row of rows) {
        for (let column = 0; column < row.cells.length; column += 1) {
          if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
          if (row.cells[column].toLocaleLowerCase().includes(needle)) {
            yield Object.freeze({ row: row.index, column })
          }
        }
      }
    },
  })
}

function attributesOf(source) {
  const attributes = {}
  for (const match of source.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)) {
    attributes[match[1]] = match[2] ?? match[3] ?? ''
  }
  return Object.freeze(attributes)
}

export function parseXmlElements(text, budget, expectedRoot, label) {
  const source = text.replace(/<!--[\s\S]*?-->/gu, '')
  const elements = []
  const stack = []
  for (const match of source.matchAll(/<\/?([A-Za-z_][\w:.-]*)([^<>]*?)>/gu)) {
    const closing = source[match.index + 1] === '/'
    const name = match[1]
    if (closing) {
      if (stack.pop() !== name) throw new TypeError(`${label} XML element nesting is invalid`)
      continue
    }
    if (elements.length >= budget.maxNodes) {
      throw new RangeError(`${label} elements exceed maxNodes budget`)
    }
    const tail = match[2] ?? ''
    const selfClosing = /\/\s*$/u.test(tail)
    elements.push(
      Object.freeze({
        index: elements.length,
        name,
        depth: stack.length,
        attributes: attributesOf(tail),
      }),
    )
    if (!selfClosing) {
      stack.push(name)
      if (stack.length > budget.maxDepth) {
        throw new RangeError(`${label} nesting exceeds maxDepth budget`)
      }
    }
  }
  if (stack.length !== 0) throw new TypeError(`${label} XML document is not closed`)
  if (elements[0]?.name !== expectedRoot)
    throw new TypeError(`${label} root must be ${expectedRoot}`)
  return Object.freeze(elements)
}

function plausibleGalaxy(text) {
  const source = text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '')
  return /\b(?:include\s+"[^"]+"|(?:void|bool|byte|char|fixed|int|string|text|unit|[A-Za-z_]\w*)\s+[A-Za-z_]\w*\s*\([^;{}]*\)\s*\{)/u.test(
    source,
  )
}

function scanGalaxy(text, budget) {
  const source = text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/.*$/gmu, '')
  const functions = []
  for (const match of source.matchAll(
    /\b(?:void|bool|byte|char|fixed|int|string|text|unit|[A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\(([^;{}]*)\)\s*\{/gu,
  )) {
    if (functions.length >= budget.maxNodes)
      throw new RangeError('Galaxy declarations exceed maxNodes budget')
    const parameters = match[2].trim() === '' ? 0 : match[2].split(',').length
    functions.push(Object.freeze({ name: match[1], parameters }))
  }
  const includes = [...source.matchAll(/\binclude\s+"([^"]+)"/gu)].map(match => match[1])
  let depth = 0
  let maximumDepth = 0
  for (const character of source) {
    if (character === '{') {
      depth += 1
      maximumDepth = Math.max(maximumDepth, depth)
      if (depth > budget.maxDepth) throw new RangeError('Galaxy blocks exceed maxDepth budget')
    } else if (character === '}') {
      depth -= 1
      if (depth < 0) throw new TypeError('Galaxy braces are unbalanced')
    }
  }
  if (depth !== 0) throw new TypeError('Galaxy braces are unbalanced')
  return Object.freeze({
    functions: Object.freeze(functions),
    includes: Object.freeze(includes),
    maximumDepth,
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'galaxy',
    label: 'StarCraft II Galaxy Script',
    mediaType: 'text/x-galaxy',
  }),
  async detect(prefix, uri) {
    const text = ascii.decode(prefix)
    const extension = /\.galaxy$/iu.test(uri)
    return plausibleGalaxy(text)
      ? { confidence: extension ? 0.98 : 0.9, kind: 'structure', note: 'galaxy-declaration' }
      : { confidence: 0, kind: 'structure', note: 'galaxy-declaration-missing' }
  },
  async inspect(bytes, context) {
    const text = decodeStructuredText(bytes, context.budget, 'Galaxy')
    if (!plausibleGalaxy(text)) throw new TypeError('Galaxy source has no declaration')
    const script = scanGalaxy(text, context.budget)
    return {
      summary: {
        format: 'galaxy',
        lines: lineCount(text),
        functions: script.functions.length,
        functionNames: script.functions.map(value => value.name),
        includes: script.includes,
        maximumBlockDepth: script.maximumDepth,
      },
      metadata: [
        {
          id: 'galaxy-source',
          label: 'Galaxy source',
          entries: [
            { key: 'lines', value: lineCount(text) },
            { key: 'functions', value: script.functions.length },
            { key: 'includes', value: script.includes },
            { key: 'maximumBlockDepth', value: script.maximumDepth },
          ],
        },
      ],
      traits: [
        { id: 'content.text', parameters: { language: 'galaxy', lines: lineCount(text) } },
        { id: 'structure.hierarchy', parameters: { functions: script.functions.length } },
      ],
      text: true,
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'script',
          label: 'Galaxy script',
          preview: `${script.functions.length} function(s)`,
          children: [
            ...script.includes.map(value => ({ kind: 'include', label: value })),
            ...script.functions.map(value => ({
              kind: 'function',
              label: value.name,
              preview: `${value.parameters} parameter(s)`,
            })),
          ],
        }),
      },
      unsupportedFeatures: [
        'language-provider-tokens-diagnostics-symbols-navigation',
        'formatting-and-refactoring',
        'compilation-and-execution',
        'source-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
