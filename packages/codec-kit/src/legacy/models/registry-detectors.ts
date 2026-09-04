const asciiDecoder = new TextDecoder('ascii', { fatal: false })
const utf8Decoder = new TextDecoder('utf-8', { fatal: false })

const BLEND_MAGIC = 'BLENDER'
const COLLADA_HEADER_BYTES = 4096
const DIABLO3_APP_MAGIC = 0xdeadbeef
const DIABLO3_APP_VERSION = 260
const DIABLO3_APP_HEADER_SIZE = 0x228
const DIABLO3_APP_MAX_RECORDS = 1_000_000
const EARTH2160_HEADER = [0x9f, 0x99, 0x66, 0xf6, 0x02] as const
const EMPEROR_XBF_VERSION = 1
const EMPEROR_XBF_SCENE_HEADER_SIZE = 8
const GLB_MAGIC = 0x46546c67
const GREY_GOO_ROOT_PARTICLE_SYSTEM = 0x00001500
const GREY_GOO_ROOT_SKELETON = 0x00000200
const GREY_GOO_ROOT_MESH = 0x00000400
const GREY_GOO_ROOT_CONNECTIONS = 0x00000600
const RELIC_CHUNKY_MAGIC = 'Relic Chunky'
const RELIC_CHUNKY_HEADER_SIZE = 24
const SUPREME_COMMANDER_SCM_MAGIC = 'MODL'
const UNITY_MESH_MAGIC = [
  0x4d, 0x4b, 0x58, 0x55, 0x4e, 0x49, 0x54, 0x59, 0x4d, 0x45, 0x53, 0x48, 0x00,
] as const
const UNREAL_PACKAGE_FILE_TAG = 0x9e2a83c1
const VXL_MAGIC = 'Voxel Animation'
const W3D_CHUNK_SIZE_MASK = 0x7fffffff
const W3D_TOP_LEVEL_CHUNKS = new Set([
  0x0, 0x100, 0x200, 0x280, 0x2c0, 0x300, 0x400, 0x420, 0x440, 0x460, 0x500, 0x600, 0x700, 0x740,
  0x750, 0x800, 0x900, 0xa00,
])

export function magicString(bytes: Uint8Array): string {
  return decodeAscii(bytes.subarray(0, 4))
}

export function isMdxMagic(bytes: Uint8Array): boolean {
  return magicString(bytes) === 'MDLX'
}

export function isMdlText(bytes: Uint8Array): boolean {
  const prefix = decodeAscii(bytes.subarray(0, Math.min(bytes.length, 32)))
  return /^\s*Version\s*\{/.test(prefix)
}

export function isBlendFile(header: Uint8Array): boolean {
  return header.length >= BLEND_MAGIC.length && ascii(header, 0, BLEND_MAGIC.length) === BLEND_MAGIC
}

export function isColladaDaeXml(header: Uint8Array): boolean {
  const text = decodeUtf8(
    header.subarray(0, Math.min(header.length, COLLADA_HEADER_BYTES)),
  ).trimStart()
  // `/` belongs in the class: a self-closing root (`<COLLADA/>`) is still COLLADA, and this
  // version rejected it. Found by the owning codec's own detection test once detection moved there.
  return /<\s*(?:[A-Za-z_][\w.-]*:)?COLLADA[\s/>]/i.test(text)
}

export function isDiablo3Appearance(bytes: Uint8Array): boolean {
  if (bytes.length < DIABLO3_APP_HEADER_SIZE) return false
  const view = dataView(bytes)
  return (
    view.getUint32(0, true) === DIABLO3_APP_MAGIC &&
    view.getUint32(4, true) === DIABLO3_APP_VERSION &&
    view.getUint32(0x0a8, true) <= DIABLO3_APP_MAX_RECORDS &&
    view.getUint32(0x1b4, true) <= DIABLO3_APP_MAX_RECORDS
  )
}

export function isEarth2160ModelFamilyHeader(header: Uint8Array): boolean {
  if (header.length < EARTH2160_HEADER.length) return false
  return EARTH2160_HEADER.every((value, index) => header[index] === value)
}

export function isEmperorXbf(header: Uint8Array): boolean {
  if (header.length < 12) return false
  const view = dataView(header)
  if (view.getInt32(0, true) !== EMPEROR_XBF_VERSION) return false
  const fxDataSize = view.getInt32(4, true)
  if (fxDataSize < 0 || fxDataSize > header.length - EMPEROR_XBF_SCENE_HEADER_SIZE) return false
  const textureSizeOffset = EMPEROR_XBF_SCENE_HEADER_SIZE + fxDataSize
  if (textureSizeOffset + 4 > header.length) return false
  const textureDataSize = view.getUint32(textureSizeOffset, true)
  return textureDataSize <= header.length - textureSizeOffset - 4
}

export function isGlbBinary(header: Uint8Array): boolean {
  return header.length >= 12 && dataView(header).getUint32(0, true) === GLB_MAGIC
}

export function isGltfJson(header: Uint8Array): boolean {
  const text = decodeUtf8(header.subarray(0, Math.min(header.length, 4096))).trimStart()
  return text.startsWith('{') && /"asset"\s*:\s*\{[^}]*"version"\s*:/s.test(text)
}

export function isGreyGooAloBinary(header: Uint8Array): boolean {
  return isGreyGooCompressedChunkFile(header) || looksLikeLegacyAloChunk(header)
}

export function isObjText(bytes: Uint8Array): boolean {
  const text = decodeUtf8(bytes.subarray(0, Math.min(bytes.length, 4096)))
  return /(^|\n)\s*(v|vn|vt|f|o|g|mtllib|usemtl)\s+/i.test(text)
}

export function isPlyModel(header: Uint8Array): boolean {
  const text = decodeAscii(header.subarray(0, Math.min(header.length, 2048)))
  return (
    /^ply(?:\r?\n|\r)/.test(text) &&
    /\bformat\s+(ascii|binary_little_endian|binary_big_endian)\s+1\.0\b/i.test(text)
  )
}

export function isRedAlert2Vxl(header: Uint8Array): boolean {
  return ascii(header, 0, Math.min(16, header.length)).startsWith(VXL_MAGIC)
}

export function isRelicWhmChunky(header: Uint8Array): boolean {
  if (ascii(header, 0, Math.min(8, header.length)) === 'FOLDRSGM') return true
  if (ascii(header, 0, Math.min(RELIC_CHUNKY_MAGIC.length, header.length)) !== RELIC_CHUNKY_MAGIC) {
    return false
  }
  return containsRelicModelRoot(header, RELIC_CHUNKY_HEADER_SIZE)
}

export function isRelicSgmChunky(bytes: Uint8Array): boolean {
  if (!isRelicWhmChunky(bytes)) return false
  try {
    return relicRangeContainsSgm(bytes, relicDataOffset(bytes), bytes.length)
  } catch {
    const offset = relicDataOffset(bytes)
    return (
      offset + 12 <= bytes.length &&
      ascii(bytes, offset, 8) === 'FOLDRSGM' &&
      dataView(bytes).getInt32(offset + 8, true) === 1
    )
  }
}

export function isSageW3xXml(header: Uint8Array): boolean {
  const text = decodeUtf8(header.subarray(0, Math.min(header.length, 2048))).trimStart()
  return (
    text.includes('<AssetDeclaration') ||
    text.includes('<W3DMesh') ||
    text.includes('<W3DContainer')
  )
}

export function isStlModel(header: Uint8Array): boolean {
  return isBinaryStl(header) || isAsciiStl(header)
}

export function isSupremeCommanderScm(header: Uint8Array): boolean {
  return magicString(header) === SUPREME_COMMANDER_SCM_MAGIC
}

export function isUnityMeshPayload(header: Uint8Array): boolean {
  if (header.length < UNITY_MESH_MAGIC.length + 4) return false
  return UNITY_MESH_MAGIC.every((value, index) => header[index] === value)
}

export function isUnrealActorX(header: Uint8Array): boolean {
  const name = actorXChunkName(header)
  return name === 'ACTRHEAD' || name === 'ANIMHEAD'
}

export function isUnrealActorXPsk(header: Uint8Array): boolean {
  return actorXChunkName(header) === 'ACTRHEAD'
}

export function isUnrealActorXPsa(header: Uint8Array): boolean {
  return actorXChunkName(header) === 'ANIMHEAD'
}

export function isUnrealPackage(header: Uint8Array): boolean {
  if (header.length < 4) return false
  const view = dataView(header)
  return (
    view.getUint32(0, true) === UNREAL_PACKAGE_FILE_TAG ||
    view.getUint32(0, false) === UNREAL_PACKAGE_FILE_TAG
  )
}

// A `.pie` text detector used to live here. It was a second copy of one the owning codec already
// had, and a package has no business knowing how to recognise a particular game's model format.
// Detection now comes from the codec's own `detect` entrypoint via the generated catalog.

export function isWestwoodW3dBinary(header: Uint8Array): boolean {
  if (header.length < 8 || header[0] === 0x3c) return false
  const view = dataView(header)
  const type = view.getUint32(0, true)
  const size = view.getUint32(4, true) & W3D_CHUNK_SIZE_MASK
  if (W3D_TOP_LEVEL_CHUNKS.has(type) && size > 0) return true
  if (header.length < 24 || !isZeroFilled(header, 0, 16)) return false
  const recoveredType = view.getUint32(16, true)
  const recoveredSize = view.getUint32(20, true) & W3D_CHUNK_SIZE_MASK
  return W3D_TOP_LEVEL_CHUNKS.has(recoveredType) && recoveredSize > 0
}

function isGreyGooCompressedChunkFile(bytes: Uint8Array): boolean {
  return bytes.length >= 40 && bytes[0] === 0x43 && bytes[1] === 0x48 && bytes[36] === 0x78
}

function looksLikeLegacyAloChunk(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false
  const type = dataView(bytes).getUint32(0, true)
  return (
    type === GREY_GOO_ROOT_SKELETON ||
    type === GREY_GOO_ROOT_MESH ||
    type === GREY_GOO_ROOT_CONNECTIONS ||
    type === GREY_GOO_ROOT_PARTICLE_SYSTEM
  )
}

function containsRelicModelRoot(bytes: Uint8Array, start: number): boolean {
  const view = dataView(bytes)
  let offset = start
  while (offset + 20 <= bytes.length) {
    const typeId = ascii(bytes, offset, 8)
    if (typeId === 'FOLDRSGM') return true
    if (!typeId.startsWith('FOLD') && !typeId.startsWith('DATA')) return false
    const size = view.getInt32(offset + 12, true)
    const nameLength = view.getInt32(offset + 16, true)
    if (size < 0 || nameLength < 0) return false
    const next = offset + 20 + nameLength + size
    if (!Number.isSafeInteger(next) || next <= offset || next > bytes.length) return false
    offset = next
  }
  return false
}

function relicRangeContainsSgm(bytes: Uint8Array, start: number, end: number): boolean {
  const view = dataView(bytes)
  let offset = start
  while (offset + 20 <= end) {
    const typeId = ascii(bytes, offset, 8)
    if (!typeId.startsWith('FOLD') && !typeId.startsWith('DATA')) break
    const version = view.getInt32(offset + 8, true)
    const size = view.getInt32(offset + 12, true)
    const nameLength = view.getInt32(offset + 16, true)
    if (size < 0 || nameLength < 0) throw new Error('Invalid Relic chunk size')
    const dataOffset = offset + 20 + nameLength
    const chunkEnd = dataOffset + size
    if (
      !Number.isSafeInteger(dataOffset) ||
      !Number.isSafeInteger(chunkEnd) ||
      dataOffset > end ||
      chunkEnd > end
    ) {
      throw new Error('Relic chunk exceeds its container')
    }
    if (typeId === 'FOLDRSGM' && version === 1) return true
    if (typeId.startsWith('FOLD') && relicRangeContainsSgm(bytes, dataOffset, chunkEnd)) return true
    offset = chunkEnd
  }
  if (offset !== end && end - offset >= 20) throw new Error('Unparsed Relic chunk stream')
  return false
}

function relicDataOffset(bytes: Uint8Array): number {
  return ascii(bytes, 0, Math.min(RELIC_CHUNKY_MAGIC.length, bytes.length)) === RELIC_CHUNKY_MAGIC
    ? RELIC_CHUNKY_HEADER_SIZE
    : 0
}

function isBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.length < 84) return false
  const declaredTriangles = dataView(bytes).getUint32(80, true)
  return 84 + declaredTriangles * 50 === bytes.length
}

function isAsciiStl(bytes: Uint8Array): boolean {
  const text = decodeAscii(bytes.subarray(0, Math.min(bytes.length, 8192))).trimStart()
  return /^solid\b/i.test(text) && /\bfacet\s+normal\b/i.test(text) && /\bvertex\s+/i.test(text)
}

function actorXChunkName(bytes: Uint8Array): string {
  if (bytes.length < 20) return ''
  const chunk = bytes.subarray(0, 20)
  const nullIndex = chunk.indexOf(0)
  return decodeUtf8(chunk.subarray(0, nullIndex < 0 ? chunk.length : nullIndex)).trimEnd()
}

function isZeroFilled(bytes: Uint8Array, start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    if (bytes[index] !== 0) return false
  }
  return true
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return decodeAscii(bytes.subarray(offset, Math.min(bytes.length, offset + length)))
}

function decodeAscii(bytes: Uint8Array): string {
  return asciiDecoder.decode(bytes)
}

function decodeUtf8(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes)
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}
