import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

import { CASC_LIMITS, cascError, throwIfCancelled } from './limits.js'
import { CascReader } from './reader.js'
import { cascSourceFromNamespace } from './source.js'

const ID = 'org.modkitx/casc'
const REQUIRED_MARKERS = Object.freeze(
  new Map([
    ['.build.info', 'file'],
    ['SC2Data/config', 'directory'],
    ['SC2Data/data', 'directory'],
    ['SC2Data/indices', 'directory'],
  ]),
)

function normalizedPath(path) {
  return String(path).replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase()
}

function lowerBound(entries, path) {
  let low = 0
  let high = entries.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (entries[middle].path < path) low = middle + 1
    else high = middle
  }
  return low
}

function validPage(page) {
  if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
    throw cascError(
      'x3.casc/page-limit-invalid',
      'CASC namespace page limit must be a positive safe integer',
      {
        limit: page.limit,
      },
    )
  }
  if (page.limit > CASC_LIMITS.maxPageItems) {
    throw cascError('x3.casc/page-limit-exceeded', 'CASC namespace page exceeds its budget', {
      limit: page.limit,
      maxPageItems: CASC_LIMITS.maxPageItems,
    })
  }
}

function namespaceEntry(entry, revision) {
  return Object.freeze({
    id: entry.path,
    path: entry.path,
    name: entry.path.split('/').at(-1) ?? entry.path,
    kind: 'file',
    size: BigInt(entry.contentSize),
    revision,
  })
}

function validateBasenameSearch(query) {
  if (
    query === null ||
    typeof query !== 'object' ||
    Array.isArray(query) ||
    !Object.keys(query).every(
      key => key === 'kind' || key === 'basenames' || key === 'caseSensitive',
    ) ||
    query.kind !== 'basename-any' ||
    !Array.isArray(query.basenames) ||
    query.basenames.length === 0 ||
    query.basenames.length > CASC_LIMITS.maxSearchBasenames ||
    typeof query.caseSensitive !== 'boolean' ||
    query.basenames.some(
      item =>
        typeof item !== 'string' ||
        item.length === 0 ||
        item.length > CASC_LIMITS.maxPathBytes ||
        item.includes('/') ||
        item.includes('\\') ||
        item.includes('\0') ||
        item === '.' ||
        item === '..',
    )
  ) {
    throw cascError(
      'x3.casc/search-query-invalid',
      'CASC namespace search requires bounded basename-any terms',
    )
  }
  const identities = query.caseSensitive
    ? query.basenames
    : query.basenames.map(item => item.toLowerCase())
  if (new Set(identities).size !== identities.length) {
    throw cascError(
      'x3.casc/search-query-invalid',
      'CASC namespace search basenames must be unique under the requested case rule',
    )
  }
}

export async function detectCascMarkers(markers) {
  const observed = new Map(markers.map(marker => [marker.path, marker.kind]))
  const matches = [...REQUIRED_MARKERS].every(
    ([path, expectedKind]) => observed.get(path) === expectedKind,
  )
  return matches
    ? { confidence: 0.99, kind: 'structure', note: 'SC2 CASC installation structure' }
    : { confidence: 0, kind: 'structure', note: 'required SC2 CASC markers are absent' }
}

export function createCascNamespaceSource(reader, sourceRef, revision) {
  const entries = reader.entries
  return Object.freeze({
    async list(prefix, page, signal) {
      throwIfCancelled(signal)
      validPage(page)
      const normalizedPrefix = normalizedPath(prefix)
      const first = lowerBound(entries, normalizedPrefix)
      const start = page.cursor === undefined ? first : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < first || start > entries.length) {
        throw cascError('x3.casc/page-cursor-invalid', 'CASC namespace cursor is invalid', {
          cursor: page.cursor,
        })
      }
      const items = []
      let index = start
      while (
        index < entries.length &&
        entries[index].path.startsWith(normalizedPrefix) &&
        items.length < page.limit
      ) {
        const entry = entries[index]
        items.push(namespaceEntry(entry, revision))
        index += 1
      }
      return Object.freeze({
        items: Object.freeze(items),
        ...(index < entries.length && entries[index].path.startsWith(normalizedPrefix)
          ? { nextCursor: String(index) }
          : {}),
      })
    },
    async search(query, page, signal) {
      throwIfCancelled(signal)
      validPage(page)
      validateBasenameSearch(query)
      const terms = [...new Set(query.basenames)].map(item =>
        query.caseSensitive ? item : item.toLowerCase(),
      )
      const wanted = new Set(terms)
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (!Number.isSafeInteger(start) || start < 0 || start > entries.length) {
        throw cascError(
          'x3.casc/search-cursor-invalid',
          'CASC namespace search cursor is invalid',
          {
            cursor: page.cursor,
          },
        )
      }
      const items = []
      let index = start
      const matches = entry => {
        const basename = entry.path.slice(entry.path.lastIndexOf('/') + 1)
        return wanted.has(query.caseSensitive ? basename : basename.toLowerCase())
      }
      while (index < entries.length && items.length < page.limit) {
        const entry = entries[index]
        index += 1
        if (matches(entry)) items.push(namespaceEntry(entry, revision))
      }
      while (index < entries.length && !matches(entries[index])) index += 1
      return Object.freeze({
        items: Object.freeze(items),
        ...(index < entries.length ? { nextCursor: String(index) } : {}),
      })
    },
    async openEntry(entryId, signal) {
      throwIfCancelled(signal)
      const path = normalizedPath(entryId)
      if (reader.resolveFile(path) === undefined) {
        throw cascError('x3.casc/entry-not-found', 'CASC entry does not exist', { path })
      }
      return simpleLease(
        Object.freeze({
          id: `${sourceRef.id}!/${path}`,
          uri: `casc-entry:${encodeURIComponent(sourceRef.uri)}!/${encodeURIComponent(path)}`,
          parentIds: Object.freeze([sourceRef.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'casc', label: 'Blizzard CASC installed storage' }),
  operations: Object.freeze([
    Object.freeze({
      id: 'container.extract',
      handlerId: 'extract-entry',
      mutatesSource: false,
      requiredPermissions: Object.freeze(['read-source']),
      outputKinds: Object.freeze(['bytes']),
    }),
  ]),
  namespace: Object.freeze({
    detect: detectCascMarkers,
    async inspect(namespace, context) {
      throwIfCancelled(context.signal)
      const reader = await CascReader.open(
        cascSourceFromNamespace(namespace, context.signal),
        context.signal,
      )
      const tree = createTreeDataSource({
        kind: 'archive',
        label: 'CASC installation',
        preview: `${reader.entries.length} named files (MNDX root)`,
        children: [
          {
            kind: 'directory',
            label: 'SC2Data',
            preview: 'Local read-only data containers',
          },
        ],
      })
      return {
        detection: await detectCascMarkers([
          { path: '.build.info', kind: 'file' },
          { path: 'SC2Data/config', kind: 'directory' },
          { path: 'SC2Data/data', kind: 'directory' },
          { path: 'SC2Data/indices', kind: 'directory' },
        ]),
        summary: {
          format: 'casc',
          rootFormat: 'mndx',
          entries: reader.entries.length,
          rootContentKey: reader.rootContentKey,
        },
        metadata: [
          {
            id: 'casc-installation',
            label: 'CASC installation',
            entries: [
              { key: 'rootFormat', value: 'mndx' },
              { key: 'entries', value: reader.entries.length },
              { key: 'rootContentKey', value: reader.rootContentKey },
            ],
          },
        ],
        traits: [
          { id: 'container.entries', parameters: { count: reader.entries.length } },
          { id: 'structure.hierarchy', parameters: { root: 'mndx' } },
        ],
        dataSources: {
          'common.view/tree-data-source': tree,
          'common.view/namespace-entry-source': createCascNamespaceSource(
            reader,
            context.input.root,
            context.input.revisions.namespaceRevision,
          ),
        },
        handlers: {
          'extract-entry': async input => {
            if (input === null || typeof input !== 'object' || Array.isArray(input)) {
              throw new TypeError('container.extract requires {entryId}')
            }
            const entryId = String(input.entryId ?? '')
            return { kind: 'bytes', value: await reader.readPath(entryId) }
          },
        },
        maxDecodedBytes: CASC_LIMITS.maxDecodedBytes,
        unsupportedFeatures: ['cdn-fallback', 'non-mndx-roots', 'encrypted-blte-chunks', 'writes'],
      }
    },
  }),
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
