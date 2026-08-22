import { createWestwoodCodec, parseDune } from '../r8/westwood-image.js'

export const abiVersion = 1
export const createCodec = createWestwoodCodec({
  id: 'r16',
  label: 'Dune 2000 R16 sprite/image',
  extension: 'r16',
  confidence: 0.94,
  parse: (bytes, budget) => parseDune(bytes, 16, budget),
  unsupported: ['multi-frame-editing', 'r16-writing'],
})
