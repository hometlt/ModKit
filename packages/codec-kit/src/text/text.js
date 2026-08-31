import { diagnostic, throwIfAborted, uint64 } from '@modkit/core'

export function decodeInput(input) {
  if (typeof input.text === 'string') {
    return {
      text: input.text,
      bytes: new TextEncoder().encode(input.text),
      source: { encoding: 'utf-8', bom: false, newline: newlineOf(input.text) },
    }
  }
  const bytes = input.bytes
  let encoding = input.encoding
  let bom = false
  let offset = 0
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    encoding = encoding ?? 'utf-8'
    bom = true
    offset = 3
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = encoding ?? 'utf-16le'
    bom = true
    offset = 2
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = encoding ?? 'utf-16be'
    bom = true
    offset = 2
  }
  encoding ??= 'utf-8'
  const content = bytes.subarray(offset)
  let text
  if (encoding === 'utf-16be') {
    const swapped = new Uint8Array(content.length)
    for (let index = 0; index + 1 < content.length; index += 2) {
      swapped[index] = content[index + 1]
      swapped[index + 1] = content[index]
    }
    text = new TextDecoder('utf-16le', { fatal: true }).decode(swapped)
  } else {
    text = new TextDecoder(encoding, { fatal: true }).decode(content)
  }
  return { text, bytes, source: { encoding, bom, newline: newlineOf(text) } }
}

export function newlineOf(text) {
  const crlf = (text.match(/\r\n/gu) ?? []).length
  const withoutCrLf = text.replace(/\r\n/gu, '')
  const lf = (withoutCrLf.match(/\n/gu) ?? []).length
  const cr = (withoutCrLf.match(/\r/gu) ?? []).length
  const kinds = [crlf, lf, cr].filter(count => count > 0).length
  if (kinds > 1) return 'mixed'
  if (crlf > 0) return 'crlf'
  if (lf > 0) return 'lf'
  if (cr > 0) return 'cr'
  return 'none'
}

export function span(text, offset = 0, length = text.length) {
  const prefix = text.slice(0, offset)
  const lastLf = prefix.lastIndexOf('\n')
  return Object.freeze({
    byteOffset: uint64(BigInt(new TextEncoder().encode(prefix).byteLength)),
    byteLength: uint64(
      BigInt(new TextEncoder().encode(text.slice(offset, offset + length)).byteLength),
    ),
    utf16Offset: offset,
    utf16Length: length,
    line: (prefix.match(/\n/gu) ?? []).length,
    column: offset - (lastLf === -1 ? 0 : lastLf + 1),
  })
}

export function failure(code, message, text = '', offset = 0, length = 0) {
  return {
    state: 'failed',
    diagnostics: [
      diagnostic('error', code, message, undefined, undefined, span(text, offset, length)),
    ],
  }
}

export function preflight(decoded, budget, signal) {
  throwIfAborted(signal)
  if (BigInt(decoded.bytes.byteLength) > budget.maxInputBytes) {
    return failure('modkit/text-data-input-budget', 'input exceeds maxInputBytes', decoded.text)
  }
  if (decoded.text.includes('\0')) {
    return failure('modkit/text-data-nul', 'NUL is forbidden in text input', decoded.text)
  }
  return undefined
}

export function encodeText(text, source, target = {}) {
  const facts = { ...source, ...target }
  const newline = facts.newline === 'none' ? source.newline : facts.newline
  const separator = newline === 'crlf' ? '\r\n' : newline === 'cr' ? '\r' : '\n'
  const normalized =
    newline === 'mixed' || newline === 'none' ? text : text.replace(/\r\n|\r|\n/gu, separator)
  let bytes
  if (facts.encoding === 'utf-8') bytes = new TextEncoder().encode(normalized)
  else {
    const little = new Uint8Array(normalized.length * 2)
    const view = new DataView(little.buffer)
    for (let index = 0; index < normalized.length; index += 1) {
      view.setUint16(index * 2, normalized.charCodeAt(index), facts.encoding === 'utf-16le')
    }
    bytes = little
  }
  if (facts.bom) {
    const marker =
      facts.encoding === 'utf-8'
        ? new Uint8Array([0xef, 0xbb, 0xbf])
        : facts.encoding === 'utf-16le'
          ? new Uint8Array([0xff, 0xfe])
          : new Uint8Array([0xfe, 0xff])
    const joined = new Uint8Array(marker.length + bytes.length)
    joined.set(marker)
    joined.set(bytes, marker.length)
    bytes = joined
  }
  return {
    bytes,
    encoding: facts.encoding,
    bom: facts.bom,
    newline: facts.newline,
    diagnostics: [],
  }
}

export function lease(value) {
  let released = false
  return Object.freeze({
    value,
    async release() {
      released = true
    },
    isReleased: () => released,
  })
}
