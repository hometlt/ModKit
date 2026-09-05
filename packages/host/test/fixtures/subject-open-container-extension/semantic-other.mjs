import { createInspectionCodec } from '../../../../../packages/codec-kit/dist/index.js'

const definition = Object.freeze({
  id: 'org.example/test-semantic-other',
  format: Object.freeze({ id: 'test-semantic-other', label: 'Other semantic' }),
  namespace: {
    async detect(markers) {
      return {
        confidence: markers.some(marker => marker.path === 'Base.SC2Data/world.bin') ? 1 : 0,
        kind: 'structure',
        note: 'higher-confidence alias for a different path selector',
      }
    },
    async inspect() {
      return {
        detection: { confidence: 1, kind: 'structure' },
        summary: { format: 'test-semantic-other' },
        metadata: [],
        traits: [],
      }
    },
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
