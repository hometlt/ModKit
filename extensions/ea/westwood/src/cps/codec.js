import { createWestwoodCodec, parseOpaque } from '../r8/westwood-image.js'

export const abiVersion = 1
export const createCodec = createWestwoodCodec({
  id: 'cps',
  label: 'Westwood CPS image',
  extension: 'cps',
  parse: (bytes, budget) => parseOpaque(bytes, budget, 'CPS'),
  unsupported: ['cps-compression-decoding', 'embedded-palette-decoding', 'cps-writing'],
})
