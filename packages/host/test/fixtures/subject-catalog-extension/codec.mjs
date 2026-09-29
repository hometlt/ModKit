import { createInspectionCodec } from '../../../../../packages/codec-kit/dist/index.js'

// A card codec that keeps the subject catalog it was handed, as an SC2 data card asks it.
const definition = Object.freeze({
  id: 'org.example/catalog-card',
  format: Object.freeze({ id: 'catalog-card', label: 'Catalog card' }),
  operations: Object.freeze([]),
  async detect() {
    return { confidence: 0.9, kind: 'magic', note: 'catalog card' }
  },
  async inspect(bytes) {
    return { summary: { bytes: bytes.byteLength }, metadata: [], traits: [], diagnostics: [] }
  },
})

export const abiVersion = 1
export const createCodec = context => {
  globalThis.__x3SubjectCatalog = context.catalog
  return createInspectionCodec(definition, context)
}
