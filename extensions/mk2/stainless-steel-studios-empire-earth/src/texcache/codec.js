import { createEmpireTextureCodec } from '../sst/codec.js'
const codec = createEmpireTextureCodec({
  id: 'org.modkitx/texcache',
  formatId: 'texcache',
  label: 'Empire Earth II TEXCACHE',
})
export const abiVersion = codec.abiVersion
export const createCodec = codec.createCodec
