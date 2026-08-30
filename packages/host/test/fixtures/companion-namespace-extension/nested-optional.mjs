import { nestedCompanionCodec } from './nested.mjs'

export const abiVersion = 1

export const createCodec = () =>
  nestedCompanionCodec({
    id: 'org.example/nested-optional',
    requirement: {
      id: 'skin',
      role: 'texture',
      ownership: 'companion',
      patterns: ['cube.texture'],
      scopes: ['current-mount', 'enclosing-container'],
      cardinality: 'zero-or-one',
      required: false,
    },
  })
