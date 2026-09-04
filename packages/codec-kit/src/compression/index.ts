export {
  deflate,
  inflate,
  isZlibCompressed,
  isBzip2Compressed,
  isAdpcmCompressed,
  detectCompressionType,
  type CompressionType,
} from './legacy-original.js'
export { bzip2Decompress, adpcmDecompress } from './bzip2.js'
