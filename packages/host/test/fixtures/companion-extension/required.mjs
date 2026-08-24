import { companionCodec } from './companion.mjs'

export const abiVersion = 1

export const createCodec = () =>
  companionCodec({
    id: 'org.example/companion-required',
    magic: 'X3VXLREQ',
    requirement: {
      id: 'motion',
      role: 'animation',
      ownership: 'companion',
      patterns: ['*.hva'],
      scopes: ['sibling-directory'],
      cardinality: 'one',
      required: true,
    },
  })
