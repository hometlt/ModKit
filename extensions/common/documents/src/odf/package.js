/**
 * The private OpenDocument package reader.
 *
 * One reader, four codec contributions (ODT, ODS, ODP, ODG) — and deliberately *not* a platform
 * package: nothing outside `extensions/common/documents` imports this module, and the extension's
 * `exports` map publishes only `formats/<name>/codec.js`, so the reader cannot become a second
 * archive platform by accident (plan block 11, slice 11B item 4).
 *
 * What it is allowed to believe about a file is narrow on purpose. A `.odt` suffix is worth almost
 * nothing: ODF's own rule — the `mimetype` entry is first, stored uncompressed, and holds the exact
 * media type — is checkable in the first few dozen bytes, so detection reads that rather than the
 * name, and `inspect` re-checks it against the central directory plus `META-INF/manifest.xml` and
 * the required parts before a single element is parsed (item 5).
 *
 * Everything the reader refuses, it refuses by name: traversal and absolute entry paths, duplicate
 * entry names, encryption, compression methods it cannot honestly decode, a declared expansion
 * ratio outside the budget, decoded bytes past `maxScalarBytes`, and any DTD or entity declaration
 * at all. External resources are never fetched and macros are never executed — there is no
 * evaluator and no network here; the counts are reported so a reader can see what was skipped.
 */

const utf8 = new TextDecoder('utf-8', { fatal: true })

const ZIP_LOCAL = 0x04034b50
const ZIP_CENTRAL = 0x02014b50
const ZIP_EOCD = 0x06054b50
const FLAG_ENCRYPTED = 0x0001
const FLAG_STRONG_ENCRYPTION = 0x0040
const STORED = 0
const DEFLATE = 8
/**
 * Highest declared expansion a single entry may claim. ODF's XML parts compress extremely well —
 * a real `content.xml` sits near 10:1 — so 100:1 leaves honest documents alone while a zip bomb,
 * whose whole point is a ratio in the thousands, is refused before a byte is inflated.
 */
const MAX_ENTRY_RATIO = 100

/** The media type each format's `mimetype` entry must contain, exactly. */
export const ODF_FORMATS = Object.freeze({
  odt: Object.freeze({
    id: 'org.modkitx/odt',
    formatId: 'odt',
    label: 'OpenDocument text',
    mediaType: 'application/vnd.oasis.opendocument.text',
    body: 'text',
  }),
  ods: Object.freeze({
    id: 'org.modkitx/ods',
    formatId: 'ods',
    label: 'OpenDocument spreadsheet',
    mediaType: 'application/vnd.oasis.opendocument.spreadsheet',
    body: 'spreadsheet',
  }),
  odp: Object.freeze({
    id: 'org.modkitx/odp',
    formatId: 'odp',
    label: 'OpenDocument presentation',
    mediaType: 'application/vnd.oasis.opendocument.presentation',
    body: 'presentation',
  }),
  odg: Object.freeze({
    id: 'org.modkitx/odg',
    formatId: 'odg',
    label: 'OpenDocument drawing',
    mediaType: 'application/vnd.oasis.opendocument.graphics',
    body: 'drawing',
  }),
})

/** Every ODF media type this reader knows, so a package can be told apart from a foreign one. */
const KNOWN_MEDIA_TYPES = new Map(
  Object.values(ODF_FORMATS).map(details => [details.mediaType, details.formatId]),
)

const REQUIRED_PARTS = Object.freeze(['mimetype', 'META-INF/manifest.xml', 'content.xml'])

/** Package entries whose presence means the document carries code. It is counted, never run. */
const MACRO_PREFIXES = Object.freeze(['Basic/', 'Scripts/'])

function u16(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw new TypeError('truncated ODF package')
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function u32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new TypeError('truncated ODF package')
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.byteLength; index += 1) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ bytes[index]) & 0xff] ?? 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function throwIfCancelled(signal) {
  if (signal?.aborted === true) throw new DOMException('operation cancelled', 'AbortError')
}

/**
 * The media type an ODF package declares in its first entry, read from a probe prefix.
 *
 * ODF requires `mimetype` to be the first entry, stored, with no extra field — so the whole claim
 * lives inside the first ~90 bytes and detection never needs the central directory, the file name
 * or a full read. A package that does not follow the rule is simply not detected as ODF here; the
 * generic ZIP route may still answer for it, which is the correct outcome.
 */
export function declaredMediaType(prefix) {
  if (prefix.byteLength < 38 || u32(prefix, 0) !== ZIP_LOCAL) return undefined
  if (u16(prefix, 8) !== STORED) return undefined
  const nameLength = u16(prefix, 26)
  const extraLength = u16(prefix, 28)
  if (nameLength !== 8) return undefined
  let name
  try {
    name = utf8.decode(prefix.subarray(30, 38))
  } catch {
    return undefined
  }
  if (name !== 'mimetype') return undefined
  const start = 30 + nameLength + extraLength
  const size = u32(prefix, 18)
  if (size === 0 || size > 128 || start + size > prefix.byteLength) return undefined
  try {
    return utf8.decode(prefix.subarray(start, start + size))
  } catch {
    return undefined
  }
}

/**
 * Detection evidence for one ODF format.
 *
 * Two states matter and they are kept apart: bytes that declare *this* format, and bytes that
 * declare a different ODF format. The second is not a weak match, it is a refusal — an `.odp`
 * renamed to `.odt` must not open as text — so it scores zero rather than a hedged number.
 */
export function detectOdf(prefix, formatId) {
  const declared = declaredMediaType(prefix)
  const expected = ODF_FORMATS[formatId].mediaType
  if (declared === expected) {
    return { confidence: 0.99, kind: 'magic', note: 'odf-mimetype-entry' }
  }
  if (declared !== undefined && KNOWN_MEDIA_TYPES.has(declared)) {
    return {
      confidence: 0,
      kind: 'magic',
      note: `odf-mimetype-is-${KNOWN_MEDIA_TYPES.get(declared)}`,
    }
  }
  return {
    confidence: 0,
    kind: 'magic',
    note: declared === undefined ? 'odf-mimetype-entry-missing' : 'odf-mimetype-foreign',
  }
}

function safeEntryPath(value) {
  if (value === '' || value.includes('\0') || value.includes('\\') || value.startsWith('/')) {
    throw new TypeError(`ODF package entry path is unsafe: ${value}`)
  }
  if (/^[a-z]:/iu.test(value)) throw new TypeError(`ODF package entry path is absolute: ${value}`)
  if (value.split('/').some(part => part === '.' || part === '..')) {
    throw new TypeError(`ODF package entry path traverses: ${value}`)
  }
  return value
}

/**
 * Central-directory walk with every bound stated.
 *
 * ZIP64 and multi-disk are refused rather than half-read: an ODF package that needs either is
 * outside what this reader can honestly describe, and answering with the readable prefix would be
 * a partial document presented as a whole one.
 */
function readCentralDirectory(bytes, budget, signal) {
  if (bytes.byteLength < 22) throw new TypeError('ODF package is smaller than a ZIP end record')
  let eocd = -1
  const floor = Math.max(0, bytes.byteLength - 65_557)
  for (let offset = bytes.byteLength - 22; offset >= floor; offset -= 1) {
    if (u32(bytes, offset) === ZIP_EOCD) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) throw new TypeError('ODF package end-of-central-directory record is missing')
  if (u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0) {
    throw new TypeError('multi-disk ODF packages are unsupported')
  }
  const diskEntries = u16(bytes, eocd + 8)
  const count = u16(bytes, eocd + 10)
  const centralSize = u32(bytes, eocd + 12)
  const centralOffset = u32(bytes, eocd + 16)
  const commentLength = u16(bytes, eocd + 20)
  if (diskEntries !== count || eocd + 22 + commentLength !== bytes.byteLength) {
    throw new TypeError('ODF package end record disagrees with the file')
  }
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new TypeError('ZIP64 ODF packages are unsupported')
  }
  if (count === 0) throw new TypeError('ODF package declares no entries')
  if (count > budget.maxNodes) throw new RangeError('ODF package entries exceed maxNodes budget')
  if (centralOffset + centralSize !== eocd) {
    throw new TypeError('ODF package central-directory bounds are invalid')
  }
  const entries = []
  const names = new Set()
  let declaredBytes = 0
  let offset = centralOffset
  for (let index = 0; index < count; index += 1) {
    throwIfCancelled(signal)
    if (offset + 46 > eocd || u32(bytes, offset) !== ZIP_CENTRAL) {
      throw new TypeError(`ODF package central entry ${index} is invalid`)
    }
    const flags = u16(bytes, offset + 8)
    const method = u16(bytes, offset + 10)
    const checksum = u32(bytes, offset + 16)
    const compressedSize = u32(bytes, offset + 20)
    const uncompressedSize = u32(bytes, offset + 24)
    const nameLength = u16(bytes, offset + 28)
    const extraLength = u16(bytes, offset + 30)
    const entryCommentLength = u16(bytes, offset + 32)
    const localOffset = u32(bytes, offset + 42)
    const next = offset + 46 + nameLength + extraLength + entryCommentLength
    if (next > eocd) throw new TypeError('ODF package central entry is truncated')
    let name
    try {
      name = utf8.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    } catch {
      throw new TypeError('ODF package entry name is not well-formed UTF-8')
    }
    safeEntryPath(name)
    if (names.has(name)) throw new TypeError(`ODF package entry path is duplicated: ${name}`)
    if ((flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) !== 0) {
      throw new TypeError(`ODF package entry is encrypted: ${name}`)
    }
    if (method !== STORED && method !== DEFLATE) {
      throw new TypeError(
        `ODF package entry uses unsupported compression method ${method}: ${name}`,
      )
    }
    if (compressedSize === 0 && uncompressedSize > 0) {
      throw new TypeError(`ODF package entry declares an impossible size: ${name}`)
    }
    if (compressedSize > 0 && uncompressedSize / compressedSize > MAX_ENTRY_RATIO) {
      throw new RangeError(`ODF package entry exceeds the compression-ratio budget: ${name}`)
    }
    declaredBytes += uncompressedSize
    if (declaredBytes > budget.maxScalarBytes) {
      throw new RangeError('ODF package decoded content exceeds maxScalarBytes budget')
    }
    names.add(name)
    entries.push(
      Object.freeze({
        index,
        name,
        kind: name.endsWith('/') ? 'directory' : 'file',
        method,
        checksum,
        compressedSize,
        uncompressedSize,
        localOffset,
      }),
    )
    offset = next
  }
  if (offset !== eocd) throw new TypeError('ODF package central-directory size is inconsistent')
  return { entries: Object.freeze(entries), declaredBytes }
}

async function inflateRaw(compressed, expectedBytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new TypeError('deflate extraction is unavailable in this runtime')
  }
  const stream = new Blob([compressed.slice().buffer])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks = []
  let length = 0
  for (;;) {
    const result = await reader.read()
    if (result.done === true) break
    length += result.value.byteLength
    // the declared size is the contract; a stream that outgrows it is a bomb, not a document
    if (length > expectedBytes) {
      await reader.cancel('ODF package entry expanded past its declared size')
      throw new RangeError('ODF package entry expanded past its declared size')
    }
    chunks.push(result.value)
  }
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

/** Bytes of one entry, with the local header re-checked against the central directory. */
async function extractEntry(bytes, entry, signal) {
  throwIfCancelled(signal)
  if (entry.kind !== 'file') throw new TypeError('ODF package directories have no payload')
  const at = entry.localOffset
  if (at + 30 > bytes.byteLength || u32(bytes, at) !== ZIP_LOCAL) {
    throw new TypeError(`ODF package local header is invalid: ${entry.name}`)
  }
  const nameLength = u16(bytes, at + 26)
  const extraLength = u16(bytes, at + 28)
  const start = at + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (end > bytes.byteLength) throw new TypeError(`ODF package entry is truncated: ${entry.name}`)
  if (u16(bytes, at + 8) !== entry.method) {
    throw new TypeError(`ODF package local entry disagrees with the directory: ${entry.name}`)
  }
  let localName
  try {
    localName = utf8.decode(bytes.subarray(at + 30, at + 30 + nameLength))
  } catch {
    throw new TypeError(`ODF package local entry name is not well-formed UTF-8: ${entry.name}`)
  }
  if (localName !== entry.name) {
    throw new TypeError(`ODF package local entry name differs: ${entry.name}`)
  }
  const compressed = bytes.subarray(start, end)
  const output =
    entry.method === STORED
      ? compressed.slice()
      : await inflateRaw(compressed, entry.uncompressedSize)
  if (output.byteLength !== entry.uncompressedSize || crc32(output) !== entry.checksum) {
    throw new TypeError(`ODF package entry size or CRC is invalid: ${entry.name}`)
  }
  return output
}

// -----------------------------------------------------------------------------------------------
// XML
//
// A bounded, non-validating reader for the ODF subset. It never resolves an entity and never reads
// a DTD — a document declaring either is refused outright, which is what makes billion-laughs and
// external-entity expansion impossible rather than merely limited.

const NAMED_ENTITIES = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
})

function decodeXmlText(value, label) {
  if (!value.includes('&')) return value
  return value.replace(/&(#x?[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/gu, (whole, body) => {
    if (body.startsWith('#')) {
      const code = body.startsWith('#x')
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10)
      if (!Number.isSafeInteger(code) || code <= 0 || code > 0x10ffff) {
        throw new TypeError(`${label} contains an out-of-range character reference`)
      }
      return String.fromCodePoint(code)
    }
    const resolved = NAMED_ENTITIES[body]
    // the five predefined entities are the whole vocabulary; anything else would need a DTD
    if (resolved === undefined) {
      throw new TypeError(`${label} references the undeclared entity ${whole}`)
    }
    return resolved
  })
}

function parseAttributes(source, label) {
  const attributes = {}
  const expression = /([A-Za-z_:][-A-Za-z0-9_.:]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu
  for (const match of source.matchAll(expression)) {
    attributes[match[1]] = decodeXmlText(match[2] ?? match[3] ?? '', label)
  }
  return attributes
}

/**
 * ODF's own namespace URIs, mapped to the prefix this reader uses to talk about them.
 *
 * Documents in the wild bind these URIs to the conventional prefixes, but the prefix is not the
 * contract — the URI is. The parser therefore resolves the prefix a document actually uses for
 * each URI, and falls back to the conventional name when a document (or a fixture) declares no
 * binding at all, so neither a renamed prefix nor an abbreviated namespace changes what is found.
 */
const ODF_NAMESPACES = Object.freeze({
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  presentation: 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  manifest: 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
})

/** Prefix each conventional ODF namespace is bound to in this document. */
function resolvePrefixes(rootAttributes) {
  const byUri = new Map()
  for (const [name, value] of Object.entries(rootAttributes)) {
    if (name.startsWith('xmlns:')) byUri.set(value, name.slice(6))
  }
  const resolved = {}
  for (const [conventional, uri] of Object.entries(ODF_NAMESPACES)) {
    resolved[conventional] = byUri.get(uri) ?? conventional
  }
  return Object.freeze(resolved)
}

/**
 * Parse one XML part into a bounded element tree.
 *
 * `state` carries the budget spend across every part of one package, so a document cannot slip past
 * `maxNodes` by splitting itself into many small parts.
 */
export function parseOdfXml(bytes, label, budget, state, signal) {
  let xml
  try {
    xml = utf8.decode(bytes)
  } catch {
    throw new TypeError(`${label} is not well-formed UTF-8`)
  }
  if (/<!DOCTYPE|<!ENTITY|<!NOTATION/iu.test(xml)) {
    throw new TypeError(`${label} declares a DTD, which this reader never reads`)
  }
  state.scalarBytes += xml.length * 2
  if (state.scalarBytes > budget.maxScalarBytes) {
    throw new RangeError('ODF XML exceeds maxScalarBytes budget')
  }
  const root = { name: '#document', attributes: {}, children: [], text: '' }
  const stack = [root]
  let cursor = 0
  while (cursor < xml.length) {
    throwIfCancelled(signal)
    const open = xml.indexOf('<', cursor)
    if (open < 0) break
    if (open > cursor) {
      const parent = stack.at(-1)
      parent.text += decodeXmlText(xml.slice(cursor, open), label)
    }
    if (xml.startsWith('<!--', open)) {
      const end = xml.indexOf('-->', open)
      if (end < 0) throw new TypeError(`${label} has an unterminated comment`)
      cursor = end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', open)) {
      const end = xml.indexOf(']]>', open)
      if (end < 0) throw new TypeError(`${label} has an unterminated CDATA section`)
      stack.at(-1).text += xml.slice(open + 9, end)
      cursor = end + 3
      continue
    }
    if (xml.startsWith('<?', open)) {
      const end = xml.indexOf('?>', open)
      if (end < 0) throw new TypeError(`${label} has an unterminated processing instruction`)
      cursor = end + 2
      continue
    }
    const close = xml.indexOf('>', open)
    if (close < 0) throw new TypeError(`${label} has an unterminated element`)
    const token = xml.slice(open + 1, close)
    cursor = close + 1
    if (token.startsWith('/')) {
      const name = token.slice(1).trim()
      if (stack.length <= 1 || stack.at(-1).name !== name) {
        throw new TypeError(`${label} has mismatched XML elements`)
      }
      stack.pop()
      continue
    }
    const selfClosing = token.endsWith('/')
    const body = selfClosing ? token.slice(0, -1) : token
    const nameMatch = /^([A-Za-z_:][-A-Za-z0-9_.:]*)/u.exec(body)
    if (nameMatch === null) throw new TypeError(`${label} has malformed XML markup`)
    state.nodes += 1
    if (state.nodes > budget.maxNodes) throw new RangeError('ODF XML exceeds maxNodes budget')
    const element = {
      name: nameMatch[1],
      attributes: parseAttributes(body.slice(nameMatch[1].length), label),
      children: [],
      text: '',
    }
    stack.at(-1).children.push(element)
    if (!selfClosing) {
      stack.push(element)
      if (stack.length - 1 > budget.maxDepth) {
        throw new RangeError('ODF XML exceeds maxDepth budget')
      }
    }
  }
  if (stack.length !== 1) throw new TypeError(`${label} has unclosed XML elements`)
  const documentElement = root.children.find(child => child.name !== undefined)
  if (documentElement === undefined) throw new TypeError(`${label} has no root element`)
  return Object.freeze({
    root: documentElement,
    prefixes: resolvePrefixes(documentElement.attributes),
  })
}

/** Depth-first walk; the tree is already bounded by the parse budgets. */
export function* descendants(element) {
  for (const child of element.children) {
    yield child
    yield* descendants(child)
  }
}

/** Concatenated text of an element and everything under it, whitespace-collapsed. */
export function textOf(element) {
  let value = element.text
  for (const child of element.children) value += textOf(child)
  return value.replaceAll(/\s+/gu, ' ').trim()
}

export const childrenNamed = (element, name) =>
  element.children.filter(child => child.name === name)

export function firstNamed(element, name) {
  for (const child of descendants(element)) if (child.name === name) return child
  return undefined
}

// -----------------------------------------------------------------------------------------------
// the package

/**
 * Read, validate and open one ODF package.
 *
 * The order is the point: container, then the declared media type, then the manifest, then the
 * required parts, and only then content. Each step can refuse, and every refusal names the rule it
 * enforces, so a malformed package produces a sentence rather than a stack trace.
 */
export async function openOdfPackage(bytes, formatId, budget, signal) {
  const details = ODF_FORMATS[formatId]
  if (details === undefined) throw new TypeError(`unknown ODF format ${formatId}`)
  if (BigInt(bytes.byteLength) > budget.maxInputBytes) {
    throw new RangeError('ODF package exceeds maxInputBytes budget')
  }
  const directory = readCentralDirectory(bytes, budget, signal)
  const byName = new Map(directory.entries.map(entry => [entry.name, entry]))
  for (const part of REQUIRED_PARTS) {
    if (!byName.has(part)) {
      throw new TypeError(`ODF package is missing the required part ${part}`)
    }
  }
  const mimetype = byName.get('mimetype')
  if (mimetype.index !== 0 || mimetype.localOffset !== 0 || mimetype.method !== STORED) {
    throw new TypeError('the ODF mimetype entry must be the first, uncompressed ZIP entry')
  }
  const declared = utf8.decode(await extractEntry(bytes, mimetype, signal))
  if (declared !== details.mediaType) {
    throw new TypeError(`the ODF mimetype entry declares ${declared}, not ${details.mediaType}`)
  }
  const state = { nodes: directory.entries.length, scalarBytes: 0 }
  const parts = new Map()
  const part = async name => {
    const cached = parts.get(name)
    if (cached !== undefined) return cached
    const entry = byName.get(name)
    if (entry === undefined) return undefined
    const parsed = parseOdfXml(
      await extractEntry(bytes, entry, signal),
      name,
      budget,
      state,
      signal,
    )
    parts.set(name, parsed)
    return parsed
  }
  const manifest = await part('META-INF/manifest.xml')
  const manifestRoot = `${manifest.prefixes.manifest}:manifest`
  if (manifest.root.name !== manifestRoot) {
    throw new TypeError(`META-INF/manifest.xml has root ${manifest.root.name}, not ${manifestRoot}`)
  }
  const manifestEntries = childrenNamed(manifest.root, `${manifest.prefixes.manifest}:file-entry`)
  const fullPath = `${manifest.prefixes.manifest}:full-path`
  const manifestPaths = manifestEntries.map(entry => entry.attributes[fullPath] ?? '')
  for (const declaredPath of manifestPaths) {
    if (declaredPath !== '/') safeEntryPath(declaredPath)
  }
  const content = await part('content.xml')
  const contentRoot = `${content.prefixes.office}:document-content`
  if (content.root.name !== contentRoot) {
    throw new TypeError(`content.xml has root ${content.root.name}, not ${contentRoot}`)
  }
  const body = firstNamed(content.root, `${content.prefixes.office}:body`)
  if (body === undefined) throw new TypeError('content.xml carries no office:body')
  const typed = childrenNamed(body, `${content.prefixes.office}:${details.body}`)
  if (typed.length !== 1) {
    throw new TypeError(
      `content.xml must carry exactly one office:${details.body} body for ${formatId}`,
    )
  }
  return Object.freeze({
    details,
    entries: directory.entries,
    declaredMediaType: declared,
    /** Entries the manifest lists that the package does not contain, and the reverse. */
    manifest: Object.freeze({
      entries: manifestEntries.length,
      undeclared: Object.freeze(
        directory.entries
          .filter(entry => entry.name !== 'mimetype' && !manifestPaths.includes(entry.name))
          .map(entry => entry.name),
      ),
      missing: Object.freeze(manifestPaths.filter(value => value !== '/' && !byName.has(value))),
    }),
    macroEntries: Object.freeze(
      directory.entries
        .filter(entry => MACRO_PREFIXES.some(prefix => entry.name.startsWith(prefix)))
        .map(entry => entry.name),
    ),
    content,
    body: typed[0],
    prefixes: content.prefixes,
    part,
    decodedBytes: directory.declaredBytes,
    state,
  })
}

/** Every entry name, for the package tree a reader sees. */
export function packageTreeNode(pkg) {
  return {
    kind: 'package',
    label: pkg.details.label,
    preview: `${pkg.entries.length} ZIP part(s), ${pkg.declaredMediaType}`,
    children: pkg.entries.map(entry => ({
      kind: entry.kind === 'directory' ? 'directory' : 'part',
      label: entry.name,
      preview: `${entry.uncompressedSize} byte(s), ${entry.method === STORED ? 'stored' : 'deflate'}`,
      children: [],
    })),
  }
}
