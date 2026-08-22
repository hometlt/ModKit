import { createWestwoodCodec, parseShp } from '../r8/westwood-image.js'

export const abiVersion = 1
export const createCodec = createWestwoodCodec({
  id: 'shp',
  label: 'Westwood TS/RA2 SHP sprite',
  extension: 'shp',
  extensions: ['shp', 'tem', 'sno', 'urb', 'des', 'ubn', 'lun'],
  confidence: 0.93,
  sniff(bytes) {
    if (bytes.byteLength < 8) return false
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const width = view.getUint16(2, true)
    const height = view.getUint16(4, true)
    const frames = view.getUint16(6, true)
    return width > 0 && height > 0 && frames > 0 && 8 + frames * 24 <= bytes.byteLength
  },
  parse: parseShp,
  unsupported: ['compressed-shp-frame-pixel-decoding', 'palette-sidecar-resolution', 'shp-writing'],
})
