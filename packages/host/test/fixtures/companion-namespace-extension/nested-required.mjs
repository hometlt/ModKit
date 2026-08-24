import { nestedCompanionCodec } from './nested.mjs'

export const abiVersion = 1

export const createCodec = () =>
  nestedCompanionCodec({
    id: 'org.example/nested-required',
    requirement: {
      id: 'skin',
      role: 'texture',
      ownership: 'companion',
      patterns: ['bowl.tga'],
      scopes: ['current-mount', 'enclosing-container'],
      cardinality: 'one',
      required: true,
    },
  })
