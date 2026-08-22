import { createRelicChunkCodec } from '../relic/codec.js'
const codec = createRelicChunkCodec({
  id: 'org.modkitx/rgt',
  formatId: 'rgt',
  label: 'Relic game texture',
  roots: ['FOLDDXTC', 'FOLDTXTR'],
  confidence: 0.98,
  unsupported: ['pixel-decoding', 'mipmap-export', 'texture-writing'],
})
export const abiVersion = codec.abiVersion
export const createCodec = codec.createCodec
