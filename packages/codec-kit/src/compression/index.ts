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
export {
  COMPRESSION_OUTPUT_LIMIT,
  decompressBounded,
  type BoundedDecompressionOptions,
  type PortableDecompressionFormat,
} from './bounded.js'
export { adler32, createAdler32, type Adler32Accumulator } from './adler32.js'
export {
  bcj2Decode,
  bcjX86Decode,
  bcjX86DecodeStream,
  lzma2Decode,
  lzma2DecodeStream,
  lzma2DictionarySize,
  lzmaDecode,
  lzmaDecodeStream,
  lzmaPropertiesFromByte,
  parseLzmaProperties,
  type LzmaDecodeOptions,
  type LzmaProperties,
  type LzmaStreamOptions,
} from './lzma.js'
