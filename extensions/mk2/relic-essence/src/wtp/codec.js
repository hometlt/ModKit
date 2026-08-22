import { createRelicChunkCodec } from '../relic/codec.js'
const codec = createRelicChunkCodec({
  id: 'org.modkitx/wtp',
  formatId: 'wtp',
  label: 'Relic team-pattern texture',
  roots: ['FOLDTPAT'],
  unsupported: ['team-pattern-composition', 'pixel-decoding', 'texture-writing'],
})
export const abiVersion = codec.abiVersion
export const createCodec = codec.createCodec
