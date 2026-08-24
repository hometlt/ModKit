import { createWestwoodCodec, parseOpaque } from '../r8/westwood-image.js'

export const abiVersion = 1
export const createCodec = createWestwoodCodec({
  id: 'wsa',
  label: 'Westwood WSA animation',
  extension: 'wsa',
  parse: (bytes, budget) => parseOpaque(bytes, budget, 'WSA'),
  unsupported: ['wsa-frame-decoding', 'wsa-palette-decoding', 'wsa-writing'],
})
