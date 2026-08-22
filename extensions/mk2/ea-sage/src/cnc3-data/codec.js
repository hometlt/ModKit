// Hand-ported SAGE AssetDeclaration reader. It inventories the authored declaration shell while
// keeping include loading, schema validation, and compiled game-data formats explicit boundaries.

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/cnc3-data'
const NON_ASSETS = new Set(['Includes', 'Tags'])
const utf8 = new TextDecoder('utf-8', { fatal: true })

function decode(bytes, budget) {
  if (bytes.byteLength > budget.maxScalarBytes)
    throw new RangeError('AssetDeclaration text exceeds maxScalarBytes')
  if (bytes.includes(0)) throw new TypeError('AssetDeclaration contains a NUL byte')
  try {
    return utf8.decode(bytes)
  } catch {
    throw new TypeError('AssetDeclaration is not valid UTF-8')
  }
}

function attributes(source) {
  const result = {}
  for (const match of source.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)) {
    result[match[1]] = match[2] ?? match[3] ?? ''
  }
  return Object.freeze(result)
}

function signature(bytes) {
  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.byteLength, 4096)))
  return /<AssetDeclaration(?:\s|>)/u.test(text)
}

function includePath(source) {
  const colon = source.indexOf(':')
  if (colon > 0) {
    const scheme = source.slice(0, colon).toUpperCase()
    const rest = source.slice(colon + 1).replaceAll('\\', '/')
    if (scheme === 'DATA') return `data/${rest}`
    if (scheme === 'ART') return `art/${rest}`
  }
  return source.replaceAll('\\', '/')
}

function parse(text, budget) {
  const source = text.replace(/<!--[\s\S]*?-->/gu, '')
  const stack = []
  const includes = []
  const assets = []
  const counts = {}
  let namespace
  let nodes = 0
  let rootSeen = false
  for (const match of source.matchAll(/<\/?([A-Za-z_][\w:.-]*)([^<>]*?)>/gu)) {
    const closing = source[(match.index ?? 0) + 1] === '/'
    const name = match[1]
    if (closing) {
      if (stack.pop() !== name) throw new TypeError('AssetDeclaration XML nesting is invalid')
      continue
    }
    if (nodes >= budget.maxNodes) throw new RangeError('AssetDeclaration elements exceed maxNodes')
    nodes += 1
    const tail = match[2] ?? ''
    const attrs = attributes(tail)
    const selfClosing = /\/\s*$/u.test(tail)
    if (stack.length === 0) {
      if (rootSeen || name !== 'AssetDeclaration')
        throw new TypeError('AssetDeclaration root is missing or duplicated')
      rootSeen = true
      namespace = attrs.xmlns
    } else if (stack.length === 1) {
      if (!NON_ASSETS.has(name)) {
        assets.push(Object.freeze({ type: name, ...(attrs.id === undefined ? {} : { id: attrs.id }) }))
        counts[name] = (counts[name] ?? 0) + 1
      }
    } else if (stack.at(-1) === 'Includes' && name === 'Include') {
      const rawSource = attrs.source ?? ''
      includes.push(
        Object.freeze({ source: rawSource, path: includePath(rawSource), type: attrs.type ?? '' }),
      )
    }
    if (!selfClosing) {
      stack.push(name)
      if (stack.length > budget.maxDepth)
        throw new RangeError('AssetDeclaration nesting exceeds maxDepth')
    }
  }
  if (!rootSeen || stack.length !== 0) throw new TypeError('AssetDeclaration document is not closed')
  return Object.freeze({
    namespace,
    includes: Object.freeze(includes),
    assets: Object.freeze(assets),
    counts: Object.freeze(counts),
    nodes,
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'cnc3-data', label: 'Command & Conquer 3 AssetDeclaration data' }),
  async detect(prefix) {
    return signature(prefix)
      ? { confidence: 0.98, kind: 'structure', note: 'AssetDeclaration XML root' }
      : { confidence: 0, kind: 'structure', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const document = parse(decode(bytes, context.budget), context.budget)
    return {
      summary: {
        format: 'cnc3-data',
        namespace: document.namespace ?? null,
        includes: document.includes,
        assets: document.assets,
        assetCountsByType: document.counts,
        elements: document.nodes,
        includeResolution: 'paths-only',
      },
      metadata: [
        {
          id: 'cnc3-asset-declaration',
          label: 'SAGE AssetDeclaration',
          entries: [
            { key: 'namespace', value: document.namespace ?? '' },
            { key: 'includes', value: document.includes.length },
            { key: 'assets', value: document.assets.length },
            { key: 'assetTypes', value: Object.keys(document.counts).length },
          ],
        },
      ],
      traits: [
        { id: 'game.catalog', parameters: { assets: document.assets.length, compiled: false } },
        { id: 'structure.hierarchy', parameters: { nodes: document.nodes } },
        { id: 'content.text', parameters: { language: 'xml', encoding: 'utf-8' } },
      ],
      text: true,
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'catalog',
          label: 'SAGE AssetDeclaration',
          preview: `${document.assets.length} assets, ${document.includes.length} includes`,
          children: [
            {
              kind: 'section',
              label: 'Includes',
              children: document.includes.map(include => ({
                kind: 'reference',
                label: include.source,
                preview: `${include.type || 'unspecified'} → ${include.path}`,
              })),
            },
            {
              kind: 'section',
              label: 'Assets',
              children: document.assets.map(asset => ({
                kind: 'asset',
                label: asset.id ?? '(anonymous)',
                preview: asset.type,
              })),
            },
          ],
        }),
      },
      maxDecodedBytes: bytes.byteLength,
      unsupportedFeatures: [
        'include-graph-loading-and-merge',
        'schema-typed-asset-bodies',
        'compiled-bin-manifest-relo-imp-data',
        'cdata-decoding',
        'asset-declaration-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
