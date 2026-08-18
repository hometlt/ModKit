// Hand-ported from the MK2 codec org.modkitx/mix (OPUS-MK2-01 task C pilot).
//
// Westwood MIX in its two classic layouts: the original header (entry count, body size, then
// 12-byte records) and the Tiberian Sun / Red Alert 2 header, which prefixes a 32-bit flag word.
// Entries are hash-named — there is no name table in the container — so the namespace exposes
// the 32-bit id, which is exactly what the format carries.
//
// The v1 runtime imported node:crypto for Renegade MIX2/AES and for the Blowfish-encrypted RA2
// header; this port carries neither. An encrypted header is reported as an unsupported feature
// instead of being half-parsed, and the codec stays dependency-free (so, unlike v1, both the
// trusted-node and the portable variant of the converted manifest are honest).

import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/mix'
const ENTRY_BYTES = 12
const FLAG_CHECKSUM = 0x00010000
const FLAG_ENCRYPTED = 0x00020000

function u16le(bytes, offset) {
  if (offset + 2 > bytes.byteLength) throw new RangeError('truncated MIX u16')
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)
}

function u32le(bytes, offset) {
  if (offset + 4 > bytes.byteLength) throw new RangeError('truncated MIX u32')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

/**
 * Reads the layout without touching the body. `available` is how many bytes the caller has;
 * inside a probe that is the probe window, so body-relative checks are skipped there.
 */
function readLayout(bytes, available) {
  if (bytes.byteLength < 6) return undefined
  const modern = u16le(bytes, 0) === 0
  const flags = modern ? u32le(bytes, 0) : 0
  if (modern && (flags & ~(FLAG_CHECKSUM | FLAG_ENCRYPTED)) !== 0) return undefined
  const encrypted = (flags & FLAG_ENCRYPTED) !== 0
  const headerOffset = modern ? 4 : 0
  if (encrypted) {
    return Object.freeze({ modern, encrypted, flags, headerOffset, count: 0, bodyBytes: 0 })
  }
  if (headerOffset + 6 > bytes.byteLength) return undefined
  const count = u16le(bytes, headerOffset)
  const bodyBytes = u32le(bytes, headerOffset + 2)
  if (count === 0 || count > 65535) return undefined
  const indexBytes = headerOffset + 6 + count * ENTRY_BYTES
  // The container is exactly index + body (+ a 20-byte SHA-1 when the checksum flag is set).
  const expected = indexBytes + bodyBytes + ((flags & FLAG_CHECKSUM) === 0 ? 0 : 20)
  if (available !== undefined && expected !== available) return undefined
  return Object.freeze({ modern, encrypted, flags, headerOffset, count, bodyBytes, indexBytes })
}

function readEntries(bytes, layout, maxEntries) {
  const entries = []
  const base = layout.headerOffset + 6
  const limit = Math.min(layout.count, maxEntries)
  for (let index = 0; index < limit; index += 1) {
    const record = base + index * ENTRY_BYTES
    const id = u32le(bytes, record)
    const offset = u32le(bytes, record + 4)
    const size = u32le(bytes, record + 8)
    if (layout.indexBytes + offset + size > bytes.byteLength) {
      throw new TypeError(`MIX entry ${index} points outside the container`)
    }
    entries.push(
      Object.freeze({
        id: id.toString(16).padStart(8, '0'),
        numericId: id,
        offset: layout.indexBytes + offset,
        size,
      }),
    )
  }
  return Object.freeze(entries)
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError('MIX namespace page limit must be a positive safe integer')
      }
      const matching = entries.filter(entry => entry.id.startsWith(prefix))
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0) throw new TypeError('invalid MIX page cursor')
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.id,
          name: entry.id,
          kind: 'file',
          size: BigInt(entry.size),
          revision: source.revision,
        }),
      )
      return Object.freeze({
        items: Object.freeze(items),
        ...(start + items.length < matching.length
          ? { nextCursor: String(start + items.length) }
          : {}),
      })
    },
    async openEntry(entryId, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const entry = byId.get(entryId)
      if (entry === undefined) throw new TypeError(`unknown MIX entry ${entryId}`)
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.id}`,
          uri: `mix-entry:${encodeURIComponent(source.ref.uri)}!/${entry.id}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({ id: 'mix', label: 'Westwood and Renegade MIX archive' }),
  async detect(prefix) {
    // The probe window rarely holds the whole archive, so the size cross-check is skipped and
    // the confidence stays below what inspect() can prove.
    const layout = readLayout(prefix, undefined)
    if (layout === undefined) return { confidence: 0, kind: 'structure', note: 'no-mix-header' }
    if (layout.encrypted) {
      return { confidence: 0.7, kind: 'structure', note: 'mix-encrypted-header' }
    }
    return {
      confidence: 0.8,
      kind: 'structure',
      note: layout.modern ? 'mix-ts-header' : 'mix-classic-header',
    }
  },
  async inspect(bytes, context) {
    const layout = readLayout(bytes, bytes.byteLength)
    if (layout === undefined) throw new TypeError('MIX header is invalid or inconsistent')
    if (layout.encrypted) {
      const tree = createTreeDataSource({
        kind: 'archive',
        label: 'MIX (encrypted header)',
        preview: 'Blowfish-encrypted index; no entries are readable',
      })
      return {
        summary: { format: 'mix', encrypted: true, entries: 0 },
        metadata: [
          {
            id: 'mix-container',
            label: 'MIX container',
            entries: [
              { key: 'layout', value: 'tiberian-sun' },
              { key: 'encrypted', value: true },
              { key: 'bytes', value: bytes.byteLength },
            ],
          },
        ],
        traits: [{ id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } }],
        dataSources: { 'common.view/tree-data-source': tree },
        unsupportedFeatures: ['encrypted-index', 'blowfish', 'mix2-aes'],
      }
    }
    const entries = readEntries(bytes, layout, context.budget.maxNodes)
    const totalBytes = entries.reduce((sum, entry) => sum + BigInt(entry.size), 0n)
    const tree = createTreeDataSource({
      kind: 'archive',
      label: 'MIX',
      preview: `${entries.length} entr(y/ies), ${layout.bodyBytes} body bytes`,
      children: entries.map(entry => ({
        kind: 'entry',
        label: entry.id,
        preview: `${entry.size} bytes at ${entry.offset}`,
      })),
    })
    return {
      summary: {
        format: 'mix',
        layout: layout.modern ? 'tiberian-sun' : 'classic',
        checksummed: (layout.flags & FLAG_CHECKSUM) !== 0,
        encrypted: false,
        entries: entries.length,
        bodyBytes: layout.bodyBytes,
      },
      metadata: [
        {
          id: 'mix-container',
          label: 'MIX container',
          entries: [
            { key: 'layout', value: layout.modern ? 'tiberian-sun' : 'classic' },
            { key: 'entries', value: entries.length },
            { key: 'declaredEntries', value: layout.count },
            { key: 'bodyBytes', value: layout.bodyBytes },
            { key: 'indexBytes', value: layout.indexBytes },
            { key: 'checksummed', value: (layout.flags & FLAG_CHECKSUM) !== 0 },
            { key: 'entryBytes', value: String(totalBytes) },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: entries.length } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/namespace-entry-source': namespaceSource(entries, context.source),
      },
      unsupportedFeatures: ['entry-names', 'encrypted-index', 'mix2-aes'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
