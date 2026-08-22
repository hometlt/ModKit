// Shared by the PDF and PDF-compatible Illustrator entrypoints.
import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const latin1 = new TextDecoder('latin1')

const FORMATS = Object.freeze({
  pdf: Object.freeze({
    id: 'org.modkitx/pdf',
    label: 'Portable Document Format',
    mediaType: 'application/pdf',
  }),
  ai: Object.freeze({
    id: 'org.modkitx/ai',
    label: 'Adobe Illustrator document',
    mediaType: 'application/pdf',
  }),
})

const integer = value => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError('PDF integer is invalid')
  return parsed
}

function pdfHeader(bytes) {
  const match = /^%PDF-(1\.[0-7]|2\.0)(?:\r\n|\r|\n)/u.exec(latin1.decode(bytes.subarray(0, 16)))
  return match?.[1]
}

function validateBalancedSyntax(source, budget) {
  if (budget.maxDepth < 1) throw new RangeError('PDF structure exceeds maxDepth budget')
  let depth = 0
  let maximum = 0
  let literal = false
  let literalDepth = 0
  let escaped = false
  let comment = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (comment) {
      if (character === '\r' || character === '\n') comment = false
      continue
    }
    if (literal) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '(') {
        depth += 1
        literalDepth += 1
      } else if (character === ')') {
        depth -= 1
        literalDepth -= 1
        if (literalDepth === 0) literal = false
      }
      maximum = Math.max(maximum, depth)
      if (maximum > budget.maxDepth) throw new RangeError('PDF nesting exceeds maxDepth budget')
      continue
    }
    if (character === '%') {
      comment = true
      continue
    }
    if (character === '(') {
      literal = true
      depth += 1
      literalDepth = 1
    } else if (character === '[' || (character === '<' && source[index + 1] === '<')) {
      depth += 1
      if (character === '<') index += 1
    } else if (character === ']' || (character === '>' && source[index + 1] === '>')) {
      depth -= 1
      if (character === '>') index += 1
      if (depth < 0) throw new TypeError('PDF delimiters are unbalanced')
    }
    maximum = Math.max(maximum, depth)
    if (maximum > budget.maxDepth) throw new RangeError('PDF nesting exceeds maxDepth budget')
  }
  if (literal || depth !== 0) throw new TypeError('PDF delimiters are unbalanced')
}

function parseXref(source, offset, budget) {
  if (source.slice(offset, offset + 4) !== 'xref') {
    throw new TypeError('PDF startxref does not point to a classic cross-reference table')
  }
  let cursor = offset + 4
  const skipSpace = () => {
    while (/\s/u.test(source[cursor] ?? '')) cursor += 1
  }
  const entries = []
  skipSpace()
  while (source.slice(cursor, cursor + 7) !== 'trailer') {
    const header = /^(\d+)\s+(\d+)\s*(?:\r\n|\r|\n)/u.exec(source.slice(cursor))
    if (header === null) throw new TypeError('PDF xref subsection header is malformed')
    const first = integer(header[1])
    const count = integer(header[2])
    if (count === 0 || entries.length + count > budget.maxNodes) {
      throw new RangeError('PDF xref entries exceed maxNodes budget')
    }
    cursor += header[0].length
    for (let index = 0; index < count; index += 1) {
      const row = /^(\d{10}) (\d{5}) ([fn])[ \t]*(?:\r\n|\r|\n)/u.exec(source.slice(cursor))
      if (row === null) throw new TypeError('PDF xref row is malformed')
      entries.push({
        number: first + index,
        offset: integer(row[1]),
        generation: integer(row[2]),
        inUse: row[3] === 'n',
      })
      cursor += row[0].length
    }
    skipSpace()
  }
  cursor += 7
  skipSpace()
  if (source.slice(cursor, cursor + 2) !== '<<')
    throw new TypeError('PDF trailer dictionary is missing')
  const end = source.indexOf('>>', cursor + 2)
  if (end < 0) throw new TypeError('PDF trailer dictionary is truncated')
  const trailer = source.slice(cursor, end + 2)
  const size = /\/Size\s+(\d+)\b/u.exec(trailer)
  const root = /\/Root\s+(\d+)\s+(\d+)\s+R\b/u.exec(trailer)
  if (size === null || root === null) throw new TypeError('PDF trailer lacks Size or Root')
  if (integer(size[1]) <= Math.max(...entries.map(entry => entry.number))) {
    throw new TypeError('PDF trailer Size does not cover the cross-reference table')
  }
  if (/\/Encrypt\b/u.test(trailer)) throw new TypeError('encrypted PDF documents are unsupported')
  return { entries, trailer, root: { number: integer(root[1]), generation: integer(root[2]) } }
}

function objectAt(source, entry) {
  if (!entry.inUse) return undefined
  if (entry.offset >= source.length)
    throw new TypeError(`PDF object ${entry.number} offset is outside the file`)
  const header = new RegExp(`^${entry.number}\\s+${entry.generation}\\s+obj\\b`, 'u').exec(
    source.slice(entry.offset),
  )
  if (header === null) throw new TypeError(`PDF xref does not point to object ${entry.number}`)
  const end = source.indexOf('endobj', entry.offset + header[0].length)
  if (end < 0) throw new TypeError(`PDF object ${entry.number} is truncated`)
  return source.slice(entry.offset + header[0].length, end)
}

function decodeLiteral(value) {
  return value
    .replace(/\\([()\\])/gu, '$1')
    .replace(/\\n/gu, '\n')
    .replace(/\\r/gu, '\r')
    .replace(/\\t/gu, '\t')
    .replace(/\\[0-7]{1,3}/gu, '')
}

function parsePdf(format, bytes, budget) {
  const version = pdfHeader(bytes)
  if (version === undefined) throw new TypeError('PDF header is missing or unsupported')
  if (bytes.byteLength * 2 > budget.maxScalarBytes) {
    throw new RangeError('PDF decoded structure exceeds maxScalarBytes budget')
  }
  const source = latin1.decode(bytes)
  const ending = /startxref\s+(\d+)\s+%%EOF\s*$/u.exec(source)
  if (ending === null || source.length - ending.index > 2048) {
    throw new TypeError('PDF final startxref or EOF marker is missing')
  }
  validateBalancedSyntax(source, budget)
  const xrefOffset = integer(ending[1])
  const xref = parseXref(source, xrefOffset, budget)
  const objects = []
  for (const entry of xref.entries) {
    const body = objectAt(source, entry)
    if (body !== undefined) objects.push({ ...entry, body })
  }
  const catalog = objects.find(object => object.number === xref.root.number)
  if (catalog === undefined || !/\/Type\s*\/Catalog\b/u.test(catalog.body)) {
    throw new TypeError('PDF Root does not reference a Catalog object')
  }
  const pages = objects.filter(object => /\/Type\s*\/Page\b/u.test(object.body))
  const pageTrees = objects.filter(object => /\/Type\s*\/Pages\b/u.test(object.body))
  if (pageTrees.length === 0) throw new TypeError('PDF page tree is missing')
  const declaredPages = pageTrees.reduce((total, object) => {
    const match = /\/Count\s+(\d+)\b/u.exec(object.body)
    return total + (match === null ? 0 : integer(match[1]))
  }, 0)
  if (declaredPages !== pages.length) throw new TypeError('PDF page tree Count is inconsistent')

  const textRuns = []
  for (const object of objects) {
    for (const match of object.body.matchAll(/\(((?:\\.|[^()\\])*)\)\s*Tj\b/gu)) {
      textRuns.push(decodeLiteral(match[1]))
      if (textRuns.length > budget.maxNodes)
        throw new RangeError('PDF text runs exceed maxNodes budget')
    }
  }
  const illustrator = /Adobe\s+Illustrator|%AI(?:3|5|8|9|10|11)_/iu.test(source)
  if (format === 'ai' && !illustrator) {
    throw new TypeError('Illustrator PDF compatibility marker is missing')
  }
  const summary = {
    format,
    pdfVersion: version,
    objects: objects.length,
    pages: pages.length,
    textRuns: textRuns.length,
    xrefOffset,
    illustratorCompatible: illustrator,
  }
  return {
    summary,
    traits: [
      { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      { id: 'content.metadata', parameters: { objects: objects.length, pdfVersion: version } },
      { id: 'document.pages', parameters: { count: pages.length } },
      ...(textRuns.length === 0
        ? []
        : [{ id: 'content.text', parameters: { runs: textRuns.length } }]),
    ],
    root: {
      kind: 'document',
      label: format === 'ai' ? 'Illustrator PDF document' : 'PDF document',
      preview: `${pages.length} page(s), ${objects.length} object(s)`,
      children: objects.map(object => ({
        kind: /\/Type\s*\/Page\b/u.test(object.body) ? 'page' : 'object',
        label: `Object ${object.number} ${object.generation}`,
        preview:
          /\/Type\s*\/([A-Za-z0-9]+)/u.exec(object.body)?.[1] ?? `${object.body.length} bytes`,
      })),
    },
    decodedBytes: source.length * 2 + objects.length * 96 + textRuns.join('').length * 2,
  }
}

function detect(format, prefix) {
  const version = pdfHeader(prefix)
  if (version === undefined) return { confidence: 0, kind: 'magic', note: 'pdf-header-missing' }
  const marker = /Adobe\s+Illustrator|%AI(?:3|5|8|9|10|11)_/iu.test(latin1.decode(prefix))
  return {
    confidence: format === 'ai' ? (marker ? 0.995 : 0.9) : 0.99,
    kind: marker && format === 'ai' ? 'structure' : 'magic',
    note: marker && format === 'ai' ? 'illustrator-pdf-marker' : `pdf-${version}`,
  }
}

export function createPdfDocumentCodec(format, context) {
  const details = FORMATS[format]
  if (details === undefined) throw new TypeError(`unknown PDF document format ${format}`)
  return createInspectionCodec(
    Object.freeze({
      id: details.id,
      format: Object.freeze({ id: format, label: details.label, mediaType: details.mediaType }),
      async detect(prefix) {
        return detect(format, prefix)
      },
      async inspect(bytes, inspectionContext) {
        const parsed = parsePdf(format, bytes, inspectionContext.budget)
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
          maxDecodedBytes: parsed.decodedBytes,
          unsupportedFeatures: [
            'layout-rendering',
            'xref-streams-and-object-streams',
            'encryption',
            'script-and-action-execution',
            'external-resource-fetch',
            'source-editing',
          ],
        }
      },
    }),
    context,
  )
}
