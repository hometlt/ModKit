import { createInspectionCodec } from '../../../../../packages/codec-kit/dist/index.js'

const definition = Object.freeze({
  id: 'org.example/test-semantic-other-tie',
  format: Object.freeze({ id: 'test-semantic-other-tie', label: 'Other semantic tie' }),
  namespace: {
    async detect(markers) {
      return {
        confidence: markers.some(marker => marker.path === 'Base.SC2Data/world.bin') ? 1 : 0,
        kind: 'structure',
        note: 'equal-confidence semantic alias for ambiguity coverage',
      }
    },
    async inspect() {
      return {
        detection: { confidence: 1, kind: 'structure' },
        summary: { format: 'test-semantic-other-tie' },
        metadata: [],
        traits: [],
      }
    },
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
