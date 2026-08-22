// Hand-ported SAGE localization reader for compiled CSF tables and authored STR label blocks.

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/cnc3-localization'
const HEADER = ' FSC'
const LABEL = ' LBL'
const STRING = ' RTS'
const STRING_NOTE = 'WRTS'
const utf8 = new TextDecoder('utf-8', { fatal: true })

function latin1(bytes, offset, length, label) {
  if (offset < 0 || length < 0 || offset > bytes.byteLength || length > bytes.byteLength - offset)
    throw new RangeError(`CSF ${label} is outside the table`)
  let result = ''
  for (let index = 0; index < length; index += 1)
    result += String.fromCharCode(bytes[offset + index] ?? 0)
  return result
}

function tag(bytes, offset) {
  return latin1(bytes, offset, 4, 'tag')
}

function isCsf(bytes) {
  return bytes.byteLength >= 4 && tag(bytes, 0) === HEADER
}

function decodeText(bytes, budget) {
  if (bytes.byteLength > budget.maxScalarBytes)
    throw new RangeError('STR text exceeds maxScalarBytes')
  if (bytes.includes(0)) throw new TypeError('STR contains a NUL byte')
  try {
    return utf8.decode(bytes)
  } catch {
    throw new TypeError('STR is not valid UTF-8')
  }
}

function isStr(text) {
  return /^[ \t]*"[^\n]*$/mu.test(text) && /^[ \t]*END[ \t]*$/imu.test(text)
}

function fromCodeUnits(units) {
  let result = ''
  for (let index = 0; index < units.length; index += 4096)
    result += String.fromCharCode(...units.slice(index, index + 4096))
  return result
}

function parseCsf(bytes, budget) {
  if (!isCsf(bytes)) throw new TypeError('CSF magic is missing')
  if (bytes.byteLength < 24) throw new TypeError('CSF header is truncated')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint32(4, true)
  const declaredLabels = view.getUint32(8, true)
  const declaredStrings = view.getUint32(12, true)
  const language = view.getUint32(20, true)
  if (declaredLabels > budget.maxNodes) throw new RangeError('CSF labels exceed maxNodes')
  const entries = []
  let decodedBytes = 0
  let strings = 0
  let cursor = 24
  const u32 = label => {
    if (cursor + 4 > bytes.byteLength) throw new TypeError(`CSF ${label} is truncated`)
    const value = view.getUint32(cursor, true)
    cursor += 4
    return value
  }
  for (let index = 0; index < declaredLabels; index += 1) {
    if (tag(bytes, cursor) !== LABEL) throw new TypeError(`CSF label ${index} tag is invalid`)
    cursor += 4
    const pairs = u32('pair count')
    const nameLength = u32('label length')
    const name = latin1(bytes, cursor, nameLength, 'label')
    cursor += nameLength
    const values = []
    let note
    for (let pair = 0; pair < pairs; pair += 1) {
      const valueTag = tag(bytes, cursor)
      if (valueTag !== STRING && valueTag !== STRING_NOTE)
        throw new TypeError(`CSF value ${strings} tag is invalid`)
      cursor += 4
      const units = u32('value length')
      const encodedBytes = units * 2
      if (!Number.isSafeInteger(encodedBytes) || cursor + encodedBytes > bytes.byteLength)
        throw new TypeError('CSF value is truncated')
      decodedBytes += encodedBytes
      if (decodedBytes > budget.maxScalarBytes)
        throw new RangeError('CSF decoded strings exceed maxScalarBytes')
      const chars = new Array(units)
      for (let unit = 0; unit < units; unit += 1)
        chars[unit] = ~view.getUint16(cursor + unit * 2, true) & 0xffff
      cursor += encodedBytes
      values.push(fromCodeUnits(chars))
      strings += 1
      if (valueTag === STRING_NOTE) {
        const noteLength = u32('note length')
        note ??= latin1(bytes, cursor, noteLength, 'note')
        cursor += noteLength
      }
    }
    entries.push(
      Object.freeze({
        label: name,
        value: values[0] ?? '',
        extraValues: Object.freeze(values.slice(1)),
        ...(note === undefined ? {} : { note }),
      }),
    )
  }
  if (cursor !== bytes.byteLength)
    throw new TypeError(`CSF trailing data: consumed ${cursor} of ${bytes.byteLength}`)
  if (strings !== declaredStrings)
    throw new TypeError(
      `CSF string count mismatch: declared ${declaredStrings}, decoded ${strings}`,
    )
  return Object.freeze({
    kind: 'csf',
    version,
    language,
    declaredLabels,
    declaredStrings,
    entries: Object.freeze(entries),
    decodedBytes,
  })
}

function unquote(value) {
  const trimmed = value.trim()
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed
}

function parseStr(text, budget) {
  const lines = text.split(/\r\n|\r|\n/u)
  const entries = []
  let index = 0
  while (index < lines.length) {
    const labelLine = lines[index] ?? ''
    const label = labelLine.trim()
    const line = index + 1
    index += 1
    if (!label || label.startsWith('//') || label.startsWith(';') || label.toUpperCase() === 'END')
      continue
    const valueLines = []
    let closed = false
    while (index < lines.length) {
      const body = lines[index] ?? ''
      index += 1
      if (body.trim().toUpperCase() === 'END') {
        closed = true
        break
      }
      valueLines.push(body)
    }
    if (!closed) throw new TypeError(`STR label ${label} is missing END`)
    if (entries.length >= budget.maxNodes) throw new RangeError('STR labels exceed maxNodes')
    entries.push(Object.freeze({ label, value: unquote(valueLines.join('\n')), line }))
  }
  if (entries.length === 0) throw new TypeError('STR contains no label blocks')
  return Object.freeze({
    kind: 'str',
    version: null,
    language: null,
    declaredLabels: entries.length,
    declaredStrings: entries.length,
    entries: Object.freeze(entries),
    decodedBytes: text.length,
  })
}

function tableSource(entries) {
  const rows = Object.freeze(
    entries.map((entry, index) =>
      Object.freeze({ index, cells: Object.freeze([entry.label, entry.value, entry.note ?? '']) }),
    ),
  )
  return Object.freeze({
    async shape() {
      return Object.freeze({
        rows: rows.length,
        columns: 3,
        header: Object.freeze(['Label', 'Value', 'Note']),
      })
    },
    async rows(request, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(request.count) || request.count <= 0)
        throw new TypeError('localization table count must be positive')
      const start = request.kind === 'range' ? request.from : Number(request.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid table cursor')
      const items = rows.slice(start, start + request.count)
      return Object.freeze({
        items,
        ...(start + items.length < rows.length ? { nextCursor: String(start + items.length) } : {}),
      })
    },
    async cell(coord) {
      const value = rows[coord.row]?.cells[coord.column]
      if (value === undefined) throw new RangeError('localization table cell is outside the data')
      return Object.freeze({ value })
    },
    async *search(query, signal) {
      const needle = query.pattern.toLocaleLowerCase()
      for (const row of rows) {
        for (let column = 0; column < row.cells.length; column += 1) {
          if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
          if (row.cells[column].toLocaleLowerCase().includes(needle))
            yield Object.freeze({ row: row.index, column })
        }
      }
    },
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'cnc3-localization', label: 'Command & Conquer 3 string tables' }),
  async detect(prefix, uri) {
    if (isCsf(prefix)) return { confidence: 1, kind: 'magic', note: 'CSF header' }
    const text = new TextDecoder().decode(prefix)
    const matches = isStr(text)
    return matches
      ? {
          confidence: /\.str(?:$|[?#])/iu.test(uri) ? 0.9 : 0.7,
          kind: 'structure',
          note: 'STR label block',
        }
      : { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const document = isCsf(bytes)
      ? parseCsf(bytes, context.budget)
      : parseStr(decodeText(bytes, context.budget), context.budget)
    const notes = document.entries.filter(entry => entry.note !== undefined).length
    const extraValues = document.entries.reduce(
      (sum, entry) => sum + (entry.extraValues?.length ?? 0),
      0,
    )
    return {
      summary: {
        format: 'cnc3-localization',
        encoding: document.kind,
        version: document.version,
        language: document.language,
        labels: document.entries.length,
        strings: document.declaredStrings,
        notes,
        extraValues,
      },
      metadata: [
        {
          id: 'cnc3-localization',
          label:
            document.kind === 'csf' ? 'Compiled CSF string table' : 'Authored STR string table',
          entries: [
            { key: 'encoding', value: document.kind },
            { key: 'labels', value: document.entries.length },
            { key: 'strings', value: document.declaredStrings },
            { key: 'notes', value: notes },
          ],
        },
      ],
      traits: [
        {
          id: 'content.text',
          parameters: { encoding: document.kind === 'csf' ? 'inverted-utf16le' : 'utf-8' },
        },
        { id: 'game.localization', parameters: { entries: document.entries.length } },
      ],
      text: document.kind === 'str',
      dataSources: {
        'common.view/table-data-source': tableSource(document.entries),
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'catalog',
          label: document.kind === 'csf' ? 'CSF localization' : 'STR localization',
          preview: `${document.entries.length} labels`,
          children: document.entries.map(entry => ({
            kind: 'string',
            label: entry.label,
            preview: entry.value.slice(0, 120),
          })),
        }),
      },
      maxDecodedBytes: Math.max(bytes.byteLength, document.decodedBytes),
      unsupportedFeatures: [
        'csf-writing',
        'str-writing',
        'refpack-expansion-before-csf-open',
        'localization-fallback-and-merge',
        'designer-note-editing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
