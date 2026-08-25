// Shared by the hand-ported text document entrypoints still staged here. Plain text left this
// package in block 11 slice 11A; its final home is extensions/common/plain-text. RTF left in
// slice 12-2 for extensions/common/documents, and its reader went with it — what stays here is a
// generated port-pending stub, because a retired route that still carries a full implementation is
// not retired, it is duplicated.
import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const utf8 = new TextDecoder('utf-8', { fatal: true })

const FORMATS = Object.freeze({
  csv: Object.freeze({
    id: 'org.modkitx/csv',
    label: 'Delimited Text Table',
    mediaType: 'text/csv',
  }),
  markdown: Object.freeze({
    id: 'org.modkitx/markdown',
    label: 'Markdown Document',
    mediaType: 'text/markdown',
  }),
})

function decodedText(bytes, budget) {
  if (bytes.byteLength * 2 > budget.maxScalarBytes) {
    throw new RangeError('decoded document exceeds maxScalarBytes budget')
  }
  try {
    return utf8.decode(bytes)
  } catch {
    throw new TypeError('document is not well-formed UTF-8')
  }
}

function chargeScalar(text, nodes, budget) {
  const decodedBytes = text.length * 2 + nodes * 64
  if (decodedBytes > budget.maxScalarBytes) {
    throw new RangeError('decoded document exceeds maxScalarBytes budget')
  }
  return decodedBytes
}

function requireDepth(budget, depth) {
  if (budget.maxDepth < depth) {
    throw new RangeError('document structure exceeds maxDepth budget')
  }
}

function preview(value) {
  const compact = value.replace(/\s+/gu, ' ').trim()
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact
}

function textLooksSafe(bytes) {
  let text
  try {
    text = utf8.decode(bytes)
  } catch {
    return false
  }
  const controls = [...text].filter(character => {
    const code = character.codePointAt(0)
    return code < 0x20 && character !== '\r' && character !== '\n' && character !== '\t'
  }).length
  return !text.includes('\0') && controls < Math.max(2, text.length / 100)
}

function parseCsv(text, budget) {
  requireDepth(budget, 2)
  if (text.includes('\0')) throw new TypeError('CSV cannot contain NUL characters')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  let afterQuote = false
  let nodes = 0

  const finishCell = () => {
    row.push(cell)
    cell = ''
    afterQuote = false
    nodes += 1
    if (nodes > budget.maxNodes) throw new RangeError('CSV cells exceed maxNodes budget')
  }
  const finishRow = () => {
    finishCell()
    rows.push(row)
    row = []
    nodes += 1
    if (nodes > budget.maxNodes) throw new RangeError('CSV rows exceed maxNodes budget')
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
          afterQuote = true
        }
      } else {
        cell += character
      }
      continue
    }
    if (afterQuote && character !== ',' && character !== '\r' && character !== '\n') {
      throw new TypeError('CSV has data after a closing quote')
    }
    if (character === '"') {
      if (cell.length > 0) throw new TypeError('CSV quote must begin a field')
      quoted = true
    } else if (character === ',') {
      finishCell()
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      finishRow()
    } else {
      cell += character
    }
  }
  if (quoted) throw new TypeError('CSV quoted field is not terminated')
  if (cell.length > 0 || row.length > 0 || afterQuote || text.endsWith(',')) finishRow()

  const columns = rows.reduce((maximum, value) => Math.max(maximum, value.length), 0)
  const raggedRows = rows.filter(value => value.length !== columns).length
  return {
    summary: {
      format: 'csv',
      rows: rows.length,
      columns,
      cells: rows.reduce((total, value) => total + value.length, 0),
      raggedRows,
    },
    root: {
      kind: 'table',
      label: 'CSV',
      preview: `${rows.length} row(s), ${columns} column(s)`,
      children: rows.map((cells, rowIndex) => ({
        kind: 'row',
        label: `Row ${rowIndex + 1}`,
        preview: cells.map(preview).join(' | '),
        children: cells.map((value, columnIndex) => ({
          kind: 'cell',
          label: `R${rowIndex + 1}C${columnIndex + 1}`,
          preview: preview(value),
        })),
      })),
    },
    nodes,
    traits: [
      { id: 'table.cells', parameters: { rows: rows.length, columns } },
      { id: 'content.text', parameters: { encoding: 'utf-8' } },
    ],
    unsupportedFeatures: ['locale-specific-delimiters', 'structured-cell-editing'],
  }
}

function parseMarkdown(text, budget) {
  requireDepth(budget, 1)
  if (text.includes('\0')) throw new TypeError('Markdown cannot contain NUL characters')
  const root = { kind: 'document', label: 'Markdown', children: [] }
  const stack = [{ level: 0, node: root }]
  let headings = 0
  let links = 0
  let listItems = 0
  let quotes = 0
  let codeBlocks = 0
  let nodes = 0
  let inFence = false
  let fenceMarker
  const lines = text.split(/\r\n|\n|\r/u)

  const chargeNode = () => {
    nodes += 1
    if (nodes > budget.maxNodes) throw new RangeError('Markdown structure exceeds maxNodes budget')
  }
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const fence = /^ {0,3}(`{3,}|~{3,})/u.exec(line)
    if (fence !== null) {
      const marker = fence[1][0]
      if (!inFence) {
        inFence = true
        fenceMarker = marker
        codeBlocks += 1
        chargeNode()
      } else if (marker === fenceMarker) {
        inFence = false
        fenceMarker = undefined
      }
      continue
    }
    if (inFence) continue
    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line)
    if (heading !== null) {
      const level = heading[1].length
      requireDepth(budget, level)
      chargeNode()
      while (stack.at(-1).level >= level) stack.pop()
      const node = {
        kind: 'heading',
        label: heading[2],
        preview: `level ${level}, line ${lineIndex + 1}`,
        children: [],
      }
      stack.at(-1).node.children.push(node)
      stack.push({ level, node })
      headings += 1
    }
    if (/^ {0,3}(?:[-*+] |\d+[.)] )/u.test(line)) {
      listItems += 1
      chargeNode()
    }
    if (/^ {0,3}>/u.test(line)) {
      quotes += 1
      chargeNode()
    }
    for (const link of line.matchAll(/\[[^\]]+\]\([^)\s]+(?:\s+"[^"]*")?\)/gu)) {
      void link
      links += 1
      chargeNode()
    }
  }
  return {
    summary: {
      format: 'markdown',
      lines: lines.length,
      headings,
      links,
      listItems,
      quotes,
      codeBlocks,
    },
    root,
    nodes,
    traits: [
      { id: 'document.flow', parameters: { lines: lines.length, codeBlocks } },
      { id: 'document.outline', parameters: { headings } },
      { id: 'structure.hierarchy', parameters: { nodes: headings, lazy: true } },
      { id: 'content.text', parameters: { encoding: 'utf-8' } },
    ],
    unsupportedFeatures: ['inline-markdown-rendering', 'raw-html-execution'],
  }
}

function detect(format, bytes) {
  if (!textLooksSafe(bytes)) {
    return { confidence: 0, kind: 'structure', note: 'utf8-text-mismatch' }
  }
  const text = utf8.decode(bytes)
  if (format === 'markdown') {
    const structured =
      /^(?: {0,3}#{1,6}\s+| {0,3}(?:[-*+] |\d+[.)] )|```|~~~|> )/mu.test(text) ||
      /\[[^\]]+\]\([^)]+\)/u.test(text)
    return {
      confidence: structured ? 0.93 : 0.55,
      kind: 'structure',
      note: structured ? 'markdown-structure' : 'utf8-markdown-extension',
    }
  }
  if (format === 'csv') {
    const comma = text.includes(',')
    const rows = /\r\n|\n|\r/u.test(text)
    return {
      confidence: comma && rows ? 0.9 : 0.55,
      kind: 'structure',
      note: comma && rows ? 'delimited-text-rows' : 'utf8-csv-extension',
    }
  }
  throw new TypeError(`unknown text document format ${format}`)
}

function parse(format, bytes, budget) {
  const text = decodedText(bytes, budget)
  if (format === 'csv') return { ...parseCsv(text, budget), scalarText: text }
  return { ...parseMarkdown(text, budget), scalarText: text }
}

export function createTextDocumentCodec(format, context) {
  const details = FORMATS[format]
  if (details === undefined) throw new TypeError(`unknown text document format ${format}`)
  return createInspectionCodec(
    Object.freeze({
      id: details.id,
      format: Object.freeze({ id: format, label: details.label, mediaType: details.mediaType }),
      async detect(prefix) {
        return detect(format, prefix)
      },
      async inspect(bytes, inspectionContext) {
        const parsed = parse(format, bytes, inspectionContext.budget)
        const decodedBytes = chargeScalar(parsed.scalarText, parsed.nodes, inspectionContext.budget)
        return {
          summary: parsed.summary,
          metadata: [
            {
              id: `${format}-document`,
              label: details.label,
              entries: Object.entries(parsed.summary).map(([key, value]) => ({ key, value })),
            },
          ],
          traits: parsed.traits,
          dataSources: { 'common.view/tree-data-source': createTreeDataSource(parsed.root) },
          maxDecodedBytes: decodedBytes,
          unsupportedFeatures: parsed.unsupportedFeatures,
        }
      },
    }),
    context,
  )
}
