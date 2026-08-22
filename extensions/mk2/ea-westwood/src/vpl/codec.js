import { createWestwoodCodec, parseVpl } from '../r8/westwood-image.js'

export const abiVersion = 1
export const createCodec = createWestwoodCodec({
  id: 'vpl',
  label: 'Westwood TS/RA2 voxel palette and lighting lookup',
  extension: 'vpl',
  confidence: 0.95,
  parse: parseVpl,
  unsupported: ['voxel-shader-lighting-application', 'vpl-writing'],
})
