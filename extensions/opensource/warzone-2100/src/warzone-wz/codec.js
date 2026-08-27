import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'
import {
  extractZipArchiveEntry,
  parseZipArchive,
} from 'modkit-extension-x3-archives/formats/zip/codec'

const ID = 'org.modkitx/warzone-wz'
const decoder = new TextDecoder('utf-8', { fatal: true })

const signature = bytes =>
  bytes.byteLength >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6))

function pageStart(page) {
  const start = page.cursor === undefined ? 0 : Number(page.cursor)
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(page.limit) ||
    page.limit <= 0
  ) {
    throw new TypeError('invalid Warzone package page')
  }
  return start
}

/** A single WZ namespace exposes the last central-directory record for an exact repeated path. */
export function applyWarzoneLastWins(entries) {
  const effectiveByPath = new Map()
  const shadowed = []
  for (const entry of entries) {
    const previous = effectiveByPath.get(entry.name)
    if (previous !== undefined) shadowed.push(previous)
    effectiveByPath.set(entry.name, entry)
  }
  const effective = [...effectiveByPath.values()].sort(
    (left, right) => Number(left.id.slice(6)) - Number(right.id.slice(6)),
  )
  return Object.freeze({ effective: Object.freeze(effective), shadowed: Object.freeze(shadowed) })
}

function compressionName(method) {
  if (method === 0) return 'stored'
  if (method === 8) return 'deflate'
  return `zip-${method}`
}

function namespaceSource(entries, source) {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  return Object.freeze({
    async list(prefix, page, signal) {
      signal?.throwIfAborted()
      const start = pageStart(page)
      const matching = entries.filter(entry => entry.name.startsWith(prefix))
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.name,
          name: entry.name.replace(/\/$/u, '').split('/').at(-1) ?? entry.name,
          kind: entry.kind,
          ...(entry.kind === 'file'
            ? {
                size: BigInt(entry.size),
                storedSize: BigInt(entry.compressedSize),
                compression: compressionName(entry.method),
                checksum: {
                  algorithm: 'crc-32',
                  value: entry.crc.toString(16).padStart(8, '0'),
                },
              }
            : {}),
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
      signal?.throwIfAborted()
      const entry = byId.get(entryId)
      if (entry === undefined || entry.kind !== 'file') {
        throw new TypeError('Warzone package entry is not an effective file')
      }
      const encoded = entry.name.split('/').map(encodeURIComponent).join('/')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entry.name}`,
          uri: `warzone-wz:${encodeURIComponent(source.ref.uri)}!/${encoded}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

function objectOf(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function packageKind(sourceUri, ruleset) {
  const declared = typeof ruleset?.type === 'string' ? ruleset.type.trim().toLowerCase() : ''
  if (declared === 'campaign') return 'campaign-ruleset'
  if (declared === 'skirmish') return 'skirmish-ruleset'
  if (declared !== '') return `${declared}-ruleset`
  let decodedUri = sourceUri
  try {
    decodedUri = decodeURIComponent(sourceUri)
  } catch {
    // A malformed escape in an opaque source URI must not prevent bounded archive inspection.
  }
  const path = decodedUri.replaceAll('\\', '/').toLowerCase()
  if (path.includes('/mods/')) return 'mod'
  const name = path.split('/').at(-1)
  if (name === 'base.wz') return 'campaign-ruleset'
  if (name === 'mp.wz') return 'skirmish-ruleset'
  return 'package'
}

async function rulesetOf(bytes, entries, budget, diagnostics) {
  const entry = entries.find(
    item => item.kind === 'file' && item.name.toLowerCase() === 'ruleset.json',
  )
  if (entry === undefined) return undefined
  if (entry.size > budget.maxScalarBytes) {
    diagnostics.push({
      id: 'warzone-ruleset-budget',
      category: 'limits',
      severity: 'warning',
      message: 'ruleset.json exceeds the scalar budget and was not classified',
    })
    return undefined
  }
  try {
    const value = objectOf(JSON.parse(decoder.decode(await extractZipArchiveEntry(bytes, entry))))
    if (value === undefined) throw new TypeError('ruleset root must be an object')
    return Object.freeze({
      ...(typeof value.tag === 'string' ? { tag: value.tag } : {}),
      ...(typeof value.type === 'string' ? { type: value.type } : {}),
      ...(typeof value.name === 'string' ? { name: value.name } : {}),
    })
  } catch (error) {
    diagnostics.push({
      id: 'warzone-ruleset-invalid',
      category: 'structure',
      severity: 'warning',
      message: `ruleset.json was not used: ${error instanceof Error ? error.message : String(error)}`,
    })
    return undefined
  }
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'warzone-wz', label: 'Warzone 2100 package' }),
  operations: Object.freeze([
    Object.freeze({
      id: 'container.extract',
      handlerId: 'extract-entry',
      mutatesSource: false,
      requiredPermissions: Object.freeze(['read-source']),
      outputKinds: Object.freeze(['bytes']),
    }),
  ]),
  async detect(prefix, uri) {
    return signature(prefix) && uri.toLowerCase().endsWith('.wz')
      ? { confidence: 0.99, kind: 'magic', note: 'ZIP-backed Warzone package' }
      : { confidence: 0, kind: 'magic', note: 'signature-or-extension-mismatch' }
  },
  async inspect(bytes, context) {
    if (!signature(bytes)) throw new TypeError('Warzone package is not ZIP')
    const physical = parseZipArchive(bytes, context.budget.maxNodes)
    const overlay = applyWarzoneLastWins(physical)
    const entries = overlay.effective
    const diagnostics = []
    const ruleset = await rulesetOf(bytes, entries, context.budget, diagnostics)
    const kind = packageKind(context.source.ref.uri, ruleset)
    const files = entries.filter(entry => entry.kind === 'file')
    const directories = entries.length - files.length
    const uncompressedBytes = files.reduce((sum, entry) => sum + BigInt(entry.size), 0n)
    const byId = new Map(entries.map(entry => [entry.id, entry]))
    return {
      summary: {
        format: 'warzone-wz',
        kind,
        physicalEntries: physical.length,
        entries: entries.length,
        files: files.length,
        directories,
        shadowedEntries: overlay.shadowed.length,
        uncompressedBytes: uncompressedBytes.toString(10),
        ...(ruleset === undefined ? {} : { ruleset }),
      },
      metadata: [
        {
          id: 'warzone-wz',
          label: 'Warzone 2100 package',
          entries: [
            { key: 'kind', value: kind },
            { key: 'entries', value: entries.length },
            { key: 'shadowedEntries', value: overlay.shadowed.length },
            ...(ruleset === undefined ? [] : [{ key: 'ruleset', value: ruleset }]),
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: entries.length } },
        { id: 'container.directories', parameters: { count: directories } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      diagnostics,
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'archive',
          label: 'Warzone 2100 package',
          preview: `${files.length} effective files, ${overlay.shadowed.length} shadowed`,
          children: entries.map(entry => ({
            kind: entry.kind,
            label: entry.name,
            preview:
              entry.kind === 'file'
                ? `${entry.size} bytes, ${compressionName(entry.method)}`
                : 'directory',
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(entries, context.source),
      },
      handlers: {
        'extract-entry': async input => {
          if (input === null || typeof input !== 'object' || Array.isArray(input)) {
            throw new TypeError('container.extract requires {entryId}')
          }
          const entry = byId.get(String(input.entryId ?? ''))
          if (entry === undefined || entry.kind !== 'file') {
            throw new TypeError('Warzone package file entry id was not found')
          }
          return { kind: 'bytes', value: await extractZipArchiveEntry(bytes, entry) }
        },
      },
      maxDecodedBytes: uncompressedBytes,
      unsupportedFeatures: [
        'multi-package-vfs-overlay',
        'package-writing',
        'ZIP64',
        'encrypted-entries',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
