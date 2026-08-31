/**
 * Built-in fallback sources — Text and Hex for any file at all.
 *
 * Every byte sequence is viewable as hex, and valid UTF-8 is viewable as text, so "no codec"
 * should never mean "nothing to look at". These sources implement the same bounded SDK contracts
 * as codec-published sources; they do not infer format structure or import a codec.
 */
import { uint64, type SourceSpan } from '@modkit/core'
import type {
  ByteRangeSource,
  TextDataSource,
  TextQuery,
  TextSlice,
  TextSliceRequest,
} from '@modkit/sdk'

const encoder = new TextEncoder()

/** A UTF-8 decode that reports failure instead of substituting replacement characters. */
export function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

/** Offer text only when the complete bounded input is valid UTF-8 and contains no NUL byte. */
export function looksTextual(bytes: Uint8Array): boolean {
  return !bytes.includes(0) && decodeUtf8(bytes) !== undefined
}

interface TextIndex {
  readonly lineStarts: readonly number[]
  readonly newline: 'lf' | 'crlf' | 'cr' | 'mixed'
  readonly longestLineBytes: number
}

function indexText(text: string): TextIndex {
  const lineStarts = [0]
  const kinds = new Set<'lf' | 'crlf' | 'cr'>()
  for (const match of text.matchAll(/\r\n|\r|\n/gu)) {
    const value = match[0]
    kinds.add(value === '\r\n' ? 'crlf' : value === '\r' ? 'cr' : 'lf')
    lineStarts.push((match.index ?? 0) + value.length)
  }

  let longestLineBytes = 0
  for (let line = 0; line < lineStarts.length; line += 1) {
    const start = lineStarts[line] ?? text.length
    const next = lineStarts[line + 1] ?? text.length
    const withoutNewline = text.slice(start, next).replace(/\r\n$|\r$|\n$/u, '')
    longestLineBytes = Math.max(longestLineBytes, encoder.encode(withoutNewline).byteLength)
  }

  const values = [...kinds]
  return Object.freeze({
    lineStarts: Object.freeze(lineStarts),
    newline: values.length > 1 ? 'mixed' : (values[0] ?? 'lf'),
    longestLineBytes,
  })
}

function ensurePositivePage(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`)
  }
}

function ensureLine(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('text line must be a non-negative safe integer')
  }
}

const cursor = (character: number, line: number): string => `c${character}-l${line}`

function parseCursor(value: string): { readonly character: number; readonly line: number } {
  const match = /^c(0|[1-9][0-9]*)-l(0|[1-9][0-9]*)$/u.exec(value)
  const character = Number(match?.[1])
  const line = Number(match?.[2])
  if (match === null || !Number.isSafeInteger(character) || !Number.isSafeInteger(line)) {
    throw new RangeError('invalid built-in text cursor')
  }
  return { character, line }
}

/** Return a code-point-safe prefix whose UTF-8 representation fits the byte budget. */
function truncateUtf8(value: string, maximumBytes: number): string {
  if (encoder.encode(value).byteLength <= maximumBytes) return value
  let result = ''
  let used = 0
  for (const character of value) {
    const size = encoder.encode(character).byteLength
    if (used + size > maximumBytes) {
      if (result === '') throw new RangeError('text page maxBytes cannot fit the next code point')
      break
    }
    result += character
    used += size
  }
  return result
}

/** Line containing this cursor; a cursor at a line start belongs to that next line. */
function cursorLine(index: TextIndex, character: number): number {
  let result = 0
  for (let line = 1; line < index.lineStarts.length; line += 1) {
    if ((index.lineStarts[line] ?? Number.MAX_SAFE_INTEGER) > character) break
    result = line
  }
  return result
}

/** Count logical lines represented by a non-empty half-open character range. */
function linesInRange(index: TextIndex, fromLine: number, endCharacter: number): number {
  let last = fromLine
  for (let line = fromLine + 1; line < index.lineStarts.length; line += 1) {
    if ((index.lineStarts[line] ?? Number.MAX_SAFE_INTEGER) >= endCharacter) break
    last = line
  }
  return last - fromLine + 1
}

export function builtinTextSource(bytes: Uint8Array): TextDataSource {
  const text = decodeUtf8(bytes)
  if (text === undefined || bytes.includes(0)) {
    throw new TypeError('built-in text source requires complete NUL-free UTF-8 input')
  }
  const index = indexText(text)

  const slice = async (request: TextSliceRequest, signal?: AbortSignal): Promise<TextSlice> => {
    signal?.throwIfAborted()
    ensurePositivePage(request.maxBytes, 'text page maxBytes')

    let fromLine: number
    let start: number
    let requestedEnd: number
    if (request.kind === 'from-line') {
      ensureLine(request.line)
      ensurePositivePage(request.lineCount, 'text page lineCount')
      fromLine = request.line
      start = index.lineStarts[fromLine] ?? text.length
      requestedEnd = index.lineStarts[fromLine + request.lineCount] ?? text.length
    } else {
      const parsed = parseCursor(request.cursor)
      if (parsed.character > text.length || parsed.line >= index.lineStarts.length) {
        throw new RangeError('built-in text cursor points beyond the source')
      }
      fromLine = parsed.line
      start = parsed.character
      requestedEnd = text.length
    }

    const page = truncateUtf8(text.slice(start, requestedEnd), request.maxBytes)
    const actualEnd = start + page.length
    const nextLine = cursorLine(index, actualEnd)
    const lineCount = page === '' ? 0 : linesInRange(index, fromLine, actualEnd)
    if (actualEnd >= text.length) {
      return { complete: true, text: page, fromLine, lineCount }
    }
    return {
      complete: false,
      text: page,
      fromLine,
      lineCount,
      nextCursor: cursor(actualEnd, nextLine),
    }
  }

  return Object.freeze({
    async info() {
      return {
        bytes: BigInt(bytes.byteLength),
        encoding: 'utf-8',
        bom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
        newline: index.newline,
        lines: index.lineStarts.length,
        longestLineBytes: index.longestLineBytes,
      }
    },
    slice,
    async *search(query: TextQuery, signal?: AbortSignal): AsyncIterable<SourceSpan> {
      signal?.throwIfAborted()
      const flags = query.caseSensitive === true ? 'gu' : 'giu'
      const pattern =
        query.regex === true ? query.pattern : query.pattern.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
      const expression = new RegExp(pattern, flags)
      for (const match of text.matchAll(expression)) {
        signal?.throwIfAborted()
        const character = match.index ?? 0
        const byteOffset = encoder.encode(text.slice(0, character)).byteLength
        const byteLength = encoder.encode(match[0]).byteLength
        yield Object.freeze({
          byteOffset: uint64(BigInt(byteOffset)),
          byteLength: uint64(BigInt(byteLength)),
        })
        if (match[0] === '') expression.lastIndex += 1
      }
    },
  })
}

export function builtinByteRangeSource(bytes: Uint8Array): ByteRangeSource {
  return Object.freeze({
    async size() {
      return BigInt(bytes.byteLength)
    },
    async read(offset: bigint, length: number, signal?: AbortSignal) {
      signal?.throwIfAborted()
      if (offset < 0n || !Number.isSafeInteger(length) || length < 0) {
        throw new RangeError('byte range must use a non-negative offset and safe length')
      }
      if (offset >= BigInt(bytes.byteLength)) return new Uint8Array()
      const start = Number(offset)
      return bytes.slice(start, Math.min(start + length, bytes.byteLength))
    },
  })
}
