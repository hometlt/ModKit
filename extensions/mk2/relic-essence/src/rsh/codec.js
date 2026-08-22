import { createRelicChunkCodec } from '../relic/codec.js'
const codec = createRelicChunkCodec({
  id: 'org.modkitx/rsh',
  formatId: 'rsh',
  label: 'Relic shader texture',
  roots: ['FOLDSHRF'],
  unsupported: ['shader-decoding', 'pixel-decoding', 'texture-writing'],
})
export const abiVersion = codec.abiVersion
export const createCodec = codec.createCodec
