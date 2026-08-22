import { createRelicChunkCodec } from '../relic/codec.js'
const codec = createRelicChunkCodec({
  id: 'org.modkitx/rtx',
  formatId: 'rtx',
  label: 'Relic texture',
  roots: ['FOLDTXTR'],
  unsupported: ['pixel-decoding', 'texture-writing'],
})
export const abiVersion = codec.abiVersion
export const createCodec = codec.createCodec
