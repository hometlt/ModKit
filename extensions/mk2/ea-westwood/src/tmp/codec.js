import { createWestwoodCodec, parseTmp } from '../r8/westwood-image.js'

export const abiVersion = 1
export const createCodec = createWestwoodCodec({
  id: 'tmp',
  label: 'Westwood TS/RA2 TMP terrain tile',
  extension: 'tmp',
  extensions: ['tmp', 'tem', 'sno', 'urb', 'des', 'ubn', 'lun'],
  confidence: 0.93,
  sniff(bytes) {
    if (bytes.byteLength < 20) return false
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const templateWidth = view.getUint32(0, true)
    const templateHeight = view.getUint32(4, true)
    const width = view.getInt32(8, true)
    const height = view.getInt32(12, true)
    const slots = templateWidth * templateHeight
    return slots > 0 && width > 0 && height > 0 && 16 + slots * 4 <= bytes.byteLength
  },
  parse: parseTmp,
  unsupported: [
    'tmp-depth-and-extra-image-decoding',
    'palette-sidecar-resolution',
    'full-template-composition',
    'tmp-writing',
  ],
})
