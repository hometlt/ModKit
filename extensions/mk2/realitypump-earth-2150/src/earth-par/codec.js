import { createInspectionCodec, createTreeDataSource, simpleLease } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/earth-par'
const matches = bytes =>
  bytes.byteLength >= 20 && new TextDecoder('latin1').decode(bytes.subarray(0, 4)) === 'PAR\0'
const parse = bytes => {
  if (!matches(bytes)) throw new TypeError('Earth 2150 PAR header is missing')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const value = {
    version: view.getUint32(4, true),
    entityGroups: view.getUint32(8, true),
    reserved: view.getUint32(12, true),
    research: view.getUint32(16, true),
  }
  if (value.entityGroups !== 0 || value.research !== 0)
    throw new TypeError('portable PAR port currently accepts the empty database envelope only')
  return Object.freeze(value)
}
const VIRTUAL = Object.freeze(['_summary.json', 'entities.json', 'research.json'])
const namespaceSource = source =>
  Object.freeze({
    async list(prefix, page) {
      const start = page.cursor === undefined ? 0 : Number(page.cursor)
      const matching = VIRTUAL.filter(path => path.startsWith(prefix))
      const items = matching.slice(start, start + page.limit).map((path, index) =>
        Object.freeze({
          id: String(start + index),
          path,
          name: path,
          kind: 'file',
          revision: source.revision,
        }),
      )
      return Object.freeze({ items: Object.freeze(items) })
    },
    async openEntry(entryId) {
      if (!VIRTUAL[Number(entryId)]) throw new TypeError('unknown PAR virtual entry')
      return simpleLease(
        Object.freeze({
          id: `${source.ref.id}!/${entryId}`,
          uri: `earth-par:${encodeURIComponent(source.ref.uri)}!/${entryId}`,
          parentIds: Object.freeze([source.ref.id]),
        }),
      )
    },
  })
const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'earth-par', label: 'Earth 2150 PAR database' }),
  async detect(prefix) {
    return matches(prefix)
      ? { confidence: 0.99, kind: 'magic', note: 'PAR database header' }
      : { confidence: 0, kind: 'magic', note: 'signature-mismatch' }
  },
  async inspect(bytes, context) {
    const value = parse(bytes)
    return {
      summary: { format: 'earth-par', ...value },
      metadata: [
        {
          id: 'earth-par',
          label: 'Earth 2150 PAR database',
          entries: Object.entries(value).map(([key, item]) => ({ key, value: item })),
        },
      ],
      traits: [{ id: 'container.entries', parameters: { count: VIRTUAL.length, virtual: true } }],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'database',
          label: 'Earth 2150 PAR',
          preview: `version ${value.version}`,
          children: VIRTUAL.map(path => ({ kind: 'virtual-file', label: path })),
        }),
        'common.view/namespace-entry-source': namespaceSource(context.source),
      },
      maxDecodedBytes: bytes.byteLength,
      unsupportedFeatures: [
        'non-empty-entity-groups',
        'research-records',
        'virtual-entry-export',
        'database-writing',
      ],
    }
  },
})
export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
