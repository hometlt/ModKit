import { companionCodec } from './companion.mjs'

export const abiVersion = 1

export const createCodec = () =>
  companionCodec({
    id: 'org.example/companion-optional',
    magic: 'X3VXLOPT',
    requirement: {
      id: 'motion',
      role: 'animation',
      ownership: 'companion',
      patterns: ['*.hva'],
      scopes: ['sibling-directory'],
      cardinality: 'zero-or-one',
      required: false,
    },
  })
