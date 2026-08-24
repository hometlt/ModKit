import { createWestwoodCodec, parseDune } from './westwood-image.js'

export const abiVersion = 1
export const createCodec = createWestwoodCodec({
  id: 'r8',
  label: 'Dune 2000 R8 sprite/image',
  extension: 'r8',
  confidence: 0.94,
  parse: (bytes, budget) => parseDune(bytes, 8, budget),
  unsupported: ['embedded-and-companion-palette-application', 'multi-frame-editing', 'r8-writing'],
})
