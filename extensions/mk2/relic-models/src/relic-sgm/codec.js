import { createRelicModelCodec } from '../relic-whm/codec.js'
const codec = createRelicModelCodec({
  id: 'org.modkitx/relic-sgm',
  formatId: 'relic-sgm',
  label: 'Relic SGM model',
})
export const abiVersion = codec.abiVersion
export const createCodec = codec.createCodec
