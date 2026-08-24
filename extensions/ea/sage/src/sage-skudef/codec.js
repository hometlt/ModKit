// Hand-ported SAGE SkuDef tokenizer and load-order inventory. Resolution and mounting require
// host directory/config services and remain outside this portable single-source contribution.

import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/sage-skudef'
const ANCHORS = new Set(['add-big', 'add-config', 'set-exe', 'mod-game', 'add-bigs-from'])
const KNOWN = new Set([
  'set-exe',
  'set-config',
  'add-config',
  'add-big',
  'add-bigs-from',
  'add-search-path',
  'mod-game',
  'mod-name',
  'mod-title',
])
const COMMENT = /(^|\s)(;|\/\/).*$/u

function parse(text, budget) {
  if (text.length > budget.maxScalarBytes)
    throw new RangeError('SkuDef text exceeds maxScalarBytes')
  const directives = []
  const lines = text.split(/\r\n|\r|\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const stripped = (lines[index] ?? '').replace(COMMENT, '').trim()
    if (stripped.length === 0) continue
    if (directives.length >= budget.maxNodes)
      throw new RangeError('SkuDef directives exceed maxNodes')
    const space = stripped.search(/\s/u)
    const keyword = (space === -1 ? stripped : stripped.slice(0, space)).toLowerCase()
    const argument = space === -1 ? '' : stripped.slice(space + 1).trim()
    if (!/^[a-z][a-z0-9-]*$/u.test(keyword)) {
      throw new TypeError(`invalid SkuDef keyword on line ${index + 1}`)
    }
    directives.push(
      Object.freeze({
        id: String(directives.length),
        keyword,
        argument,
        line: index + 1,
        known: KNOWN.has(keyword),
      }),
    )
  }
  return Object.freeze(directives)
}

function signature(bytes) {
  const text = new TextDecoder().decode(bytes)
  try {
    const directives = parse(text, {
      maxNodes: 10_000,
      maxScalarBytes: Number.MAX_SAFE_INTEGER,
    })
    return directives.length > 0 && directives.some(directive => ANCHORS.has(directive.keyword))
  } catch {
    return false
  }
}

function namespaceSource(directives, source) {
  const entries = directives.filter(directive => directive.argument.length > 0)
  return Object.freeze({
    async list(prefix, page, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      if (
        !Number.isSafeInteger(start) ||
        start < 0 ||
        !Number.isSafeInteger(page.limit) ||
        page.limit <= 0
      ) {
        throw new TypeError('invalid SkuDef namespace page')
      }
      const matching = entries.filter(entry => entry.argument.startsWith(prefix))
      const items = matching.slice(start, start + page.limit).map(entry =>
        Object.freeze({
          id: entry.id,
          path: entry.argument.replaceAll('\\', '/'),
          name: entry.argument.split(/[\\/]/u).at(-1) ?? entry.argument,
          kind: 'reference',
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
      if (!entries.some(entry => entry.id === entryId))
        throw new TypeError('unknown SkuDef reference')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entryId}`,
          uri: `skudef-reference:${encodeURIComponent(source.ref.uri)}!/${entryId}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'sage-skudef', label: 'SAGE SkuDef load order' }),
  async detect(prefix) {
    return signature(prefix)
      ? { confidence: 0.96, kind: 'structure', note: 'SkuDef directive grammar' }
      : { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const directives = parse(new TextDecoder().decode(bytes), context.budget)
    if (!directives.some(directive => ANCHORS.has(directive.keyword))) {
      throw new TypeError('SkuDef contains no load-order directive')
    }
    const unknown = directives.filter(directive => !directive.known)
    const counts = Object.entries(
      directives.reduce((result, directive) => {
        result[directive.keyword] = (result[directive.keyword] ?? 0) + 1
        return result
      }, {}),
    ).map(([keyword, count]) => ({ keyword, count }))
    return {
      summary: {
        format: 'sage-skudef',
        directives: directives.length,
        directiveCounts: counts,
        unknownDirectives: unknown.map(directive => directive.keyword),
        resolution: 'not-performed',
      },
      metadata: [
        {
          id: 'sage-skudef',
          label: 'SAGE SkuDef load order',
          entries: [
            { key: 'directives', value: directives.length },
            { key: 'unknownDirectives', value: unknown.length },
            { key: 'resolution', value: 'not-performed' },
          ],
        },
      ],
      traits: [
        { id: 'container.entries', parameters: { count: directives.length, virtual: true } },
        { id: 'structure.hierarchy', parameters: { directives: directives.length } },
        { id: 'content.text', parameters: { encoding: 'utf-8' } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'document',
          label: 'SAGE SkuDef',
          preview: `${directives.length} directives`,
          children: directives.map(directive => ({
            kind: 'directive',
            label: directive.keyword,
            preview: directive.argument || `line ${directive.line}`,
          })),
        }),
        'common.view/namespace-entry-source': namespaceSource(directives, context.source),
      },
      maxDecodedBytes: bytes.byteLength,
      unsupportedFeatures: [
        'config-chain-resolution',
        'directory-listing-for-add-bigs-from',
        'search-path-resolution',
        'archive-mounting',
        'skudef-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
