import { LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT } from '@modkitx-x3/sdk/language'

const KEYWORDS = new Set([
  'break',
  'const',
  'continue',
  'else',
  'for',
  'if',
  'native',
  'return',
  'static',
  'struct',
  'typedef',
  'while',
])
const TYPES = new Set([
  'bool',
  'fixed',
  'int',
  'playergroup',
  'string',
  'text',
  'trigger',
  'unit',
  'void',
])
const OPERATORS = new Set('{}[]();,.=+-*/%!<>?:&|')
const CANCELLATION_CHECKPOINT_CHARS = 64 * 1024
const CANCELLATION_CHECKPOINT_LINES = 1024

/** Yield a worker turn so an inbound cancel frame can abort a long synchronous scan. */
async function cancellationCheckpoint(signal) {
  signal?.throwIfAborted()
  await new Promise(resolve => setTimeout(resolve, 0))
  signal?.throwIfAborted()
}

async function lineStarts(text, signal) {
  const starts = [0]
  for (let offset = 0; offset < text.length; offset += 1) {
    if (text[offset] === '\n') starts.push(offset + 1)
    if ((offset + 1) % CANCELLATION_CHECKPOINT_CHARS === 0) {
      await cancellationCheckpoint(signal)
    }
  }
  return starts
}

function positionAt(starts, offset) {
  let low = 0
  let high = starts.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (starts[middle] <= offset) low = middle + 1
    else high = middle - 1
  }
  const line = Math.max(0, high)
  return { line, character: offset - starts[line] }
}

const rangeAt = (starts, start, end) => ({
  start: positionAt(starts, start),
  end: positionAt(starts, end),
})

async function lexicalAnalysis(text, starts, signal) {
  const tokens = []
  const diagnostics = []
  const braces = []
  const token = (kind, start, end) => tokens.push({ kind, range: rangeAt(starts, start, end) })
  const issue = (code, message, start, end) =>
    diagnostics.push({
      code,
      message,
      severity: 'error',
      source: 'galaxy',
      range: rangeAt(starts, start, end),
    })

  let offset = 0
  let nextCheckpoint = CANCELLATION_CHECKPOINT_CHARS
  while (offset < text.length) {
    if (offset >= nextCheckpoint) {
      await cancellationCheckpoint(signal)
      nextCheckpoint = offset + CANCELLATION_CHECKPOINT_CHARS
    }
    const current = text[offset]
    const next = text[offset + 1]
    if (/\s/u.test(current)) {
      offset += 1
      continue
    }
    if (current === '/' && next === '/') {
      const end = text.indexOf('\n', offset)
      const lineEnd = end === -1 ? text.length : end
      const limit = lineEnd > offset && text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd
      token('comment', offset, limit)
      offset = limit
      continue
    }
    if (current === '/' && next === '*') {
      const close = text.indexOf('*/', offset + 2)
      const limit = close === -1 ? text.length : close + 2
      token('comment', offset, limit)
      if (close === -1) issue('galaxy/unclosed-comment', 'Unclosed block comment.', offset, limit)
      offset = limit
      continue
    }
    if (current === '"' || current === "'") {
      const quote = current
      const start = offset
      offset += 1
      let closed = false
      while (offset < text.length) {
        if (offset >= nextCheckpoint) {
          await cancellationCheckpoint(signal)
          nextCheckpoint = offset + CANCELLATION_CHECKPOINT_CHARS
        }
        if (text[offset] === '\\') {
          offset += 2
          continue
        }
        if (text[offset] === quote) {
          offset += 1
          closed = true
          break
        }
        if (text[offset] === '\n' || text[offset] === '\r') break
        offset += 1
      }
      token('string', start, Math.min(offset, text.length))
      if (!closed) issue('galaxy/unclosed-string', 'Unclosed string literal.', start, offset)
      continue
    }
    const number = text.slice(offset).match(/^(?:0x[\da-f]+|\d+(?:\.\d+)?)/iu)?.[0]
    if (number !== undefined) {
      token('number', offset, offset + number.length)
      offset += number.length
      continue
    }
    const identifier = text.slice(offset).match(/^[A-Za-z_]\w*/u)?.[0]
    if (identifier !== undefined) {
      if (KEYWORDS.has(identifier)) token('keyword', offset, offset + identifier.length)
      else if (TYPES.has(identifier)) token('type', offset, offset + identifier.length)
      offset += identifier.length
      continue
    }
    if (OPERATORS.has(current)) {
      token('operator', offset, offset + 1)
      if (current === '{') braces.push(offset)
      if (current === '}') {
        const opening = braces.pop()
        if (opening === undefined) {
          issue('galaxy/unexpected-brace', 'Unexpected closing brace.', offset, offset + 1)
        }
      }
    }
    offset += 1
  }
  for (const [index, opening] of braces.entries()) {
    if (index > 0 && index % CANCELLATION_CHECKPOINT_LINES === 0) {
      await cancellationCheckpoint(signal)
    }
    issue(
      'galaxy/unclosed-brace',
      'Opening brace has no matching closing brace.',
      opening,
      opening + 1,
    )
  }
  return { tokens, diagnostics }
}

async function documentSymbols(text, starts, signal) {
  const symbols = []
  const lines = text.split('\n')
  for (const [line, rawSource] of lines.entries()) {
    if (line > 0 && line % CANCELLATION_CHECKPOINT_LINES === 0) {
      await cancellationCheckpoint(signal)
    }
    const source = rawSource.endsWith('\r') ? rawSource.slice(0, -1) : rawSource
    const lineOffset = starts[line]
    const structure = source.match(/^\s*struct\s+([A-Za-z_]\w*)/u)
    const callable = source.match(/^\s*(?:native\s+)?([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\(/u)
    const match = structure ?? callable
    if (match === null || lineOffset === undefined) continue
    const name = structure === null ? match[2] : match[1]
    if (name === undefined) continue
    const nameColumn = source.indexOf(name)
    const firstColumn = source.search(/\S/u)
    const start = lineOffset + Math.max(0, firstColumn)
    const end = lineOffset + source.length
    const selectionStart = lineOffset + nameColumn
    symbols.push({
      name,
      kind: structure === null ? 'function' : 'struct',
      ...(structure === null && match[1] !== undefined ? { detail: match[1] } : {}),
      range: rangeAt(starts, start, end),
      selectionRange: rangeAt(starts, selectionStart, selectionStart + name.length),
    })
  }
  return symbols
}

export async function analyzeGalaxy(request) {
  request.signal?.throwIfAborted()
  if (request.document.languageId !== 'galaxy') {
    throw new TypeError(`Galaxy provider cannot analyze ${request.document.languageId}`)
  }
  const starts = await lineStarts(request.document.text, request.signal)
  const lexical = await lexicalAnalysis(request.document.text, starts, request.signal)
  const include = request.include
  const selected = name => include === undefined || include[name] === true
  request.signal?.throwIfAborted()
  const symbols = selected('symbols')
    ? await documentSymbols(request.document.text, starts, request.signal)
    : []
  request.signal?.throwIfAborted()
  return Object.freeze({
    documentUri: request.document.uri,
    documentVersion: request.document.version,
    tokens: Object.freeze(selected('tokens') ? lexical.tokens : []),
    diagnostics: Object.freeze(selected('diagnostics') ? lexical.diagnostics : []),
    symbols: Object.freeze(symbols),
  })
}

export const abiVersion = 1
export const provides = Object.freeze([LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT])

export function createProvider(selection) {
  if (selection.contract !== LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT || selection.major !== 1) {
    throw new TypeError(`Unsupported language selection ${selection.contract}@${selection.major}`)
  }
  return Object.freeze({
    value: Object.freeze({
      contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
      languageIds: Object.freeze(['galaxy']),
      analyze: analyzeGalaxy,
    }),
    release: async () => undefined,
  })
}
