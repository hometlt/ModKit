import { ModkitError, throwIfAborted, uint64, type SourceSpan } from '@modkit/core'
import type {
  ByteRangeSource,
  CellCoord,
  CellFacts,
  Page,
  Row,
  TableDataSource,
  TablePageRequest,
  TableQuery,
  TextDataSource,
  TextQuery,
  TextSlice,
  TextSliceRequest,
} from '@modkit/sdk'

const DEFAULT_CHUNK_BYTES = 64 * 1024

export function createByteRangeSource(bytes: Uint8Array): ByteRangeSource {
  const owned = bytes.slice()
  return Object.freeze({
    async size() {
      return BigInt(owned.byteLength)
    },
    async read(offset: bigint, length: number, signal?: AbortSignal) {
      throwIfAborted(signal)
      if (offset < 0n || !Number.isSafeInteger(length) || length < 0) {
        throw new ModkitError({
          code: 'x3.host/invalid-byte-range',
          message: `invalid byte range ${offset}+${length}`,
        })
      }
      if (offset > BigInt(owned.byteLength)) {
        throw new ModkitError({
          code: 'x3.host/byte-range-out-of-bounds',
          message: `byte offset ${offset} exceeds source size ${owned.byteLength}`,
        })
      }
      const start = Number(offset)
      const end = Math.min(owned.byteLength, start + length)
      throwIfAborted(signal)
      return owned.slice(start, end)
    },
  })
}

interface TextIndex {
  readonly size: bigint
  readonly bom: boolean
  readonly lineStarts: readonly bigint[]
  readonly newline: 'lf' | 'crlf' | 'cr' | 'mixed'
  readonly longestLineBytes: number | 'unknown'
}

function safeLength(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ModkitError({
      code: 'x3.host/text-source-too-large',
      message: 'text source exceeds the exact JavaScript indexing range',
    })
  }
  return Number(value)
}

async function readBounded(
  source: ByteRangeSource,
  offset: bigint,
  length: bigint,
  chunkBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const total = safeLength(length)
  const result = new Uint8Array(total)
  let written = 0
  while (written < total) {
    throwIfAborted(signal)
    const next = await source.read(
      offset + BigInt(written),
      Math.min(chunkBytes, total - written),
      signal,
    )
    if (next.byteLength === 0) break
    result.set(next, written)
    written += next.byteLength
  }
  return written === total ? result : result.slice(0, written)
}

function cursor(offset: bigint, line: number): string {
  return `v1:${offset}:${line}`
}

function parseCursor(value: string): { readonly offset: bigint; readonly line: number } {
  const match = /^v1:(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/.exec(value)
  if (match === null) {
    throw new ModkitError({
      code: 'x3.host/invalid-text-cursor',
      message: 'text cursor is malformed or belongs to another implementation version',
    })
  }
  const line = Number(match[2])
  if (!Number.isSafeInteger(line)) {
    throw new ModkitError({
      code: 'x3.host/invalid-text-cursor',
      message: 'text cursor line is outside the exact JavaScript range',
    })
  }
  return { offset: BigInt(match[1] as string), line }
}

/** UTF-8 text source that scans and pages bounded byte windows; it never builds the full text. */
export function createUtf8TextDataSource(
  source: ByteRangeSource,
  options: { readonly chunkBytes?: number } = {},
): TextDataSource {
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
    throw new TypeError('text source chunkBytes must be a positive safe integer')
  }
  let indexPromise: Promise<TextIndex> | undefined

  const buildIndex = async (signal?: AbortSignal): Promise<TextIndex> => {
    const size = await source.size()
    const first = await source.read(0n, 3, signal)
    const bom = first[0] === 0xef && first[1] === 0xbb && first[2] === 0xbf
    const lineStarts: bigint[] = [bom ? 3n : 0n]
    const newlineKinds = new Set<'lf' | 'crlf' | 'cr'>()
    let lineStart = lineStarts[0] as bigint
    let longest = 0n
    let offset = 0n
    let pendingCr: bigint | undefined
    while (offset < size) {
      throwIfAborted(signal)
      const bytes = await source.read(
        offset,
        Math.min(chunkBytes, safeLength(size - offset)),
        signal,
      )
      if (bytes.byteLength === 0) break
      for (let index = 0; index < bytes.byteLength; index += 1) {
        const absolute = offset + BigInt(index)
        const byte = bytes[index]
        if (pendingCr !== undefined) {
          if (byte === 0x0a) {
            newlineKinds.add('crlf')
            longest = longest > pendingCr - lineStart ? longest : pendingCr - lineStart
            lineStart = absolute + 1n
            lineStarts.push(lineStart)
            pendingCr = undefined
            continue
          }
          newlineKinds.add('cr')
          longest = longest > pendingCr - lineStart ? longest : pendingCr - lineStart
          lineStart = pendingCr + 1n
          lineStarts.push(lineStart)
          pendingCr = undefined
        }
        if (byte === 0x0d) pendingCr = absolute
        else if (byte === 0x0a) {
          newlineKinds.add('lf')
          longest = longest > absolute - lineStart ? longest : absolute - lineStart
          lineStart = absolute + 1n
          lineStarts.push(lineStart)
        }
      }
      offset += BigInt(bytes.byteLength)
    }
    if (pendingCr !== undefined) {
      newlineKinds.add('cr')
      longest = longest > pendingCr - lineStart ? longest : pendingCr - lineStart
      lineStart = pendingCr + 1n
      lineStarts.push(lineStart)
    }
    longest = longest > size - lineStart ? longest : size - lineStart
    const kinds = [...newlineKinds]
    return Object.freeze({
      size,
      bom,
      lineStarts: Object.freeze(lineStarts),
      newline: kinds.length > 1 ? 'mixed' : (kinds[0] ?? 'lf'),
      longestLineBytes: longest > BigInt(Number.MAX_SAFE_INTEGER) ? 'unknown' : Number(longest),
    })
  }

  const index = (signal?: AbortSignal) => {
    indexPromise ??= buildIndex(signal)
    return indexPromise
  }

  const slice = async (request: TextSliceRequest, signal?: AbortSignal): Promise<TextSlice> => {
    throwIfAborted(signal)
    if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes <= 0) {
      throw new ModkitError({
        code: 'x3.host/invalid-text-page',
        message: 'text page maxBytes must be a positive safe integer',
      })
    }
    const facts = await index(signal)
    let fromLine: number
    let start: bigint
    let requestedEnd: bigint
    if (request.kind === 'from-line') {
      if (
        !Number.isSafeInteger(request.line) ||
        request.line < 0 ||
        !Number.isSafeInteger(request.lineCount) ||
        request.lineCount <= 0
      ) {
        throw new ModkitError({
          code: 'x3.host/invalid-text-page',
          message: 'text line and lineCount must be safe non-negative page coordinates',
        })
      }
      fromLine = request.line
      start = facts.lineStarts[fromLine] ?? facts.size
      requestedEnd = facts.lineStarts[fromLine + request.lineCount] ?? facts.size
    } else {
      const parsed = parseCursor(request.cursor)
      fromLine = parsed.line
      start = parsed.offset
      requestedEnd = facts.size
    }
    if (start > facts.size) {
      throw new ModkitError({
        code: 'x3.host/invalid-text-cursor',
        message: 'text cursor points beyond the current source revision',
      })
    }
    const pageEnd = start + BigInt(request.maxBytes)
    const end = [facts.size, requestedEnd, pageEnd].reduce((left, right) =>
      left < right ? left : right,
    )
    const bytes = await readBounded(source, start, end - start, chunkBytes, signal)
    throwIfAborted(signal)
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    const actualEnd = start + BigInt(bytes.byteLength)
    let nextLine = fromLine
    while (
      nextLine + 1 < facts.lineStarts.length &&
      (facts.lineStarts[nextLine + 1] as bigint) <= actualEnd
    ) {
      nextLine += 1
    }
    const complete = actualEnd >= facts.size
    return complete
      ? { complete: true, text, fromLine, lineCount: nextLine - fromLine + (text === '' ? 0 : 1) }
      : {
          complete: false,
          text,
          fromLine,
          lineCount: nextLine - fromLine + (text === '' ? 0 : 1),
          nextCursor: cursor(actualEnd, nextLine),
        }
  }

  return Object.freeze({
    async info() {
      const facts = await index()
      return {
        bytes: facts.size,
        encoding: 'utf-8',
        bom: facts.bom,
        newline: facts.newline,
        lines: facts.lineStarts.length,
        longestLineBytes: facts.longestLineBytes,
      }
    },
    slice,
    async *search(query: TextQuery, signal?: AbortSignal): AsyncIterable<SourceSpan> {
      const facts = await index(signal)
      const flags = query.caseSensitive ? 'gu' : 'giu'
      const expression = query.regex
        ? new RegExp(query.pattern, flags)
        : new RegExp(query.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
      for (let line = 0; line < facts.lineStarts.length; line += 1) {
        throwIfAborted(signal)
        const start = facts.lineStarts[line] as bigint
        const end = facts.lineStarts[line + 1] ?? facts.size
        const bytes = await readBounded(source, start, end - start, chunkBytes, signal)
        const text = new TextDecoder().decode(bytes)
        for (const match of text.matchAll(expression)) {
          const prefixBytes = new TextEncoder().encode(text.slice(0, match.index)).byteLength
          const matchBytes = new TextEncoder().encode(match[0]).byteLength
          yield Object.freeze({
            byteOffset: uint64(start + BigInt(prefixBytes)),
            byteLength: uint64(BigInt(matchBytes)),
          })
          if (match[0] === '') expression.lastIndex += 1
        }
      }
    },
  })
}

export interface LazyTableOptions {
  readonly columns: number
  readonly rows?: number
  readonly header?: readonly string[]
  /** A fresh deterministic iterator for every query; rows need never be retained eagerly. */
  readonly iterate: (signal?: AbortSignal) => AsyncIterable<Row>
}

function tableCursor(index: number): string {
  return `v1:${index}`
}

function parseTableCursor(value: string): number {
  const match = /^v1:(0|[1-9][0-9]*)$/.exec(value)
  const parsed = match === null ? Number.NaN : Number(match[1])
  if (!Number.isSafeInteger(parsed)) {
    throw new ModkitError({
      code: 'x3.host/invalid-table-cursor',
      message: 'table cursor is malformed or outside the exact JavaScript range',
    })
  }
  return parsed
}

/** Cursor/range table adapter over a restartable async iterator; no eager row array is created. */
export function createLazyTableDataSource(options: LazyTableOptions): TableDataSource {
  if (!Number.isSafeInteger(options.columns) || options.columns < 0) {
    throw new TypeError('table columns must be a non-negative safe integer')
  }
  const header = options.header === undefined ? undefined : Object.freeze([...options.header])

  const page = async (request: TablePageRequest, signal?: AbortSignal): Promise<Page<Row>> => {
    throwIfAborted(signal)
    const from = request.kind === 'range' ? request.from : parseTableCursor(request.cursor)
    if (
      !Number.isSafeInteger(from) ||
      from < 0 ||
      !Number.isSafeInteger(request.count) ||
      request.count <= 0
    ) {
      throw new ModkitError({
        code: 'x3.host/invalid-table-page',
        message: 'table page coordinates must be safe non-negative integers',
      })
    }
    const items: Row[] = []
    let hasMore = false
    for await (const row of options.iterate(signal)) {
      throwIfAborted(signal)
      if (row.index < from) continue
      if (items.length === request.count) {
        hasMore = true
        break
      }
      items.push(Object.freeze({ ...row, cells: Object.freeze([...row.cells]) }))
    }
    return Object.freeze({
      items: Object.freeze(items),
      ...(hasMore ? { nextCursor: tableCursor(from + items.length) } : {}),
    })
  }

  return Object.freeze({
    async shape() {
      return {
        rows: options.rows ?? ('unknown' as const),
        columns: options.columns,
        ...(header === undefined ? {} : { header }),
      }
    },
    rows: page,
    async cell(coord: CellCoord, signal?: AbortSignal): Promise<CellFacts> {
      throwIfAborted(signal)
      if (coord.row < 0 || coord.column < 0 || coord.column >= options.columns) {
        throw new ModkitError({
          code: 'x3.host/table-cell-out-of-bounds',
          message: `table cell ${coord.row}:${coord.column} is outside the declared shape`,
        })
      }
      for await (const row of options.iterate(signal)) {
        throwIfAborted(signal)
        if (row.index === coord.row) return { value: row.cells[coord.column] ?? '' }
      }
      throw new ModkitError({
        code: 'x3.host/table-cell-out-of-bounds',
        message: `table row ${coord.row} does not exist`,
      })
    },
    async *search(query: TableQuery, signal?: AbortSignal): AsyncIterable<CellCoord> {
      const needle = query.pattern.toLocaleLowerCase()
      for await (const row of options.iterate(signal)) {
        throwIfAborted(signal)
        for (let column = 0; column < row.cells.length; column += 1) {
          if ((row.cells[column] ?? '').toLocaleLowerCase().includes(needle)) {
            yield Object.freeze({ row: row.index, column })
          }
        }
      }
    },
  })
}
