/**
 * The common UVT/core materializer (block 12, slice 12-1; ADR-UV-001's named successor).
 *
 * ADR-UV-001 chose one shape for UV materialization — a typed service produces the content, the
 * one `common.edit/writer@1` seam commits it — and named UVT as the next member of the family.
 * This is that member: it turns a **decoded raster region** into a KTX 2.0 container plus the
 * `.uvt.json` sidecar the pinned UVT/core 1.0 profile requires, and a `MaterializationReceipt`.
 *
 * **Why a decoded region and not a DDS block passthrough.** Both were considered. The raster path
 * is the one this repository can execute today: PNG (with an sRGB chunk), BMP and TGA all publish
 * `common.view/raster-image-source@1` with `decodedAccess: true` and answer `readRegion` in rgba8.
 * A BC-block passthrough would need the DDS codec to expose its block data as blocks — it exposes
 * decoded rgba8 — so it would mean writing a new surface first, and a materializer written against
 * a surface nothing publishes is the exact mistake §2.7 exists to prevent.
 *
 * **What it refuses rather than guesses.** The profile admits `linear|srgb` transfer,
 * `bt709|unspecified` primaries, `opaque|straight|premultiplied` alpha and `rd|ru` orientation. A
 * source whose colour space, alpha mode or orientation is `unknown` is refused: each of those three
 * changes the meaning of every pixel, and defaulting one silently produces a different picture.
 *
 * **What it records rather than drops.** Mip levels, array layers, cube faces and frames beyond the
 * base image are not carried by a single-region materialization, and each becomes a named loss and
 * a diff entry. So does the sampler, which no live raster contract publishes: the projection has to
 * carry one, so the materializer supplies it and the receipt says it did.
 *
 * **Determinism.** Fixed KTX2 section order, fixed key/value ordering, fixed padding. Materializing
 * the same region twice produces the same bytes, which is checkable rather than asserted.
 *
 * Dependency-free by design: no crypto, no Node built-ins, browser-safe. The digest of the produced
 * bytes is optional evidence supplied by the caller.
 */

const MATERIALIZER_ID = 'org.modkitx/uvt-materializer'
const MATERIALIZER_VERSION = '1.0.0'
const PROFILE = 'UVT/core@1.0'

/** `«KTX 20»\r\n\x1A\n` — the KTX 2.0 file identifier. */
const IDENTIFIER = Object.freeze([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
])

/*
 * The two Vulkan formats a decoded rgba8 region can honestly become.
 *
 * Which one is chosen follows from the transfer function and nothing else, which is why this is a
 * pair rather than a table: the materializer asks `readRegion` for rgba8, so the source's own pixel
 * layout never reaches this decision. The candidate scope descriptor states explicitly that the
 * wider source-format → vkFormat table is a converter's business and not part of the profile.
 */
const VK_FORMAT_R8G8B8A8_UNORM = 37
const VK_FORMAT_R8G8B8A8_SRGB = 43

/** Khronos Data Format transfer functions and colour primaries, as the DFD spells them. */
const KHR_DF_MODEL_RGBSDA = 1
const KHR_DF_PRIMARIES_UNSPECIFIED = 0
const KHR_DF_PRIMARIES_BT709 = 1
const KHR_DF_TRANSFER_LINEAR = 1
const KHR_DF_TRANSFER_SRGB = 2
const KHR_DF_FLAG_ALPHA_PREMULTIPLIED = 1
/** Channel ids of the RGBSDA model, plus the LINEAR qualifier that always applies to alpha. */
const CHANNEL_R = 0
const CHANNEL_G = 1
const CHANNEL_B = 2
const CHANNEL_A = 15
const QUALIFIER_LINEAR = 0x10

const encoder = new TextEncoder()

function fail(message) {
  throw new TypeError(`UVT materialization refused: ${message}`)
}

const align = (value, to) => value + ((to - (value % to)) % to)

// ---------------------------------------------------------------------------------------------
// KTX 2.0 emission

/**
 * The Basic Data Format Descriptor of an uncompressed 8-bit RGBA format.
 *
 * 92 bytes: a 4-byte total size and one 88-byte basic block (six words plus four 16-byte samples).
 * The alpha sample always carries the LINEAR qualifier under an sRGB transfer function, because
 * alpha is never gamma-encoded — that is the one place a hand-written DFD usually goes wrong.
 */
function dataFormatDescriptor({ transferFunction, primaries, premultipliedAlpha }) {
  const bytes = new Uint8Array(92)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 92, true)
  view.setUint32(4, 0, true) // vendorId 0 | descriptorType 0
  view.setUint32(8, 2 | (88 << 16), true) // versionNumber 2 | descriptorBlockSize 88
  view.setUint32(
    12,
    KHR_DF_MODEL_RGBSDA |
      (primaries << 8) |
      (transferFunction << 16) |
      ((premultipliedAlpha ? KHR_DF_FLAG_ALPHA_PREMULTIPLIED : 0) << 24),
    true,
  )
  view.setUint32(16, 0, true) // texelBlockDimension0..3, each stored as size - 1
  view.setUint32(20, 4, true) // bytesPlane0 = 4, planes 1..3 unused
  view.setUint32(24, 0, true) // bytesPlane4..7 unused
  const srgb = transferFunction === KHR_DF_TRANSFER_SRGB
  const samples = [
    { bitOffset: 0, channel: CHANNEL_R },
    { bitOffset: 8, channel: CHANNEL_G },
    { bitOffset: 16, channel: CHANNEL_B },
    { bitOffset: 24, channel: CHANNEL_A | (srgb ? QUALIFIER_LINEAR : 0) },
  ]
  samples.forEach((sample, index) => {
    const offset = 28 + index * 16
    view.setUint32(offset, sample.bitOffset | (7 << 16) | (sample.channel << 24), true)
    view.setUint32(offset + 4, 0, true) // samplePosition0..3
    view.setUint32(offset + 8, 0, true) // sampleLower
    view.setUint32(offset + 12, 255, true) // sampleUpper
  })
  return bytes
}

/** One key/value entry: length-prefixed, NUL-terminated key, NUL-terminated value, 4-byte padded. */
function keyValueEntry(key, value) {
  const keyBytes = encoder.encode(`${key}\u0000`)
  const valueBytes = encoder.encode(`${value}\u0000`)
  const length = keyBytes.byteLength + valueBytes.byteLength
  const bytes = new Uint8Array(align(4 + length, 4))
  new DataView(bytes.buffer).setUint32(0, length, true)
  bytes.set(keyBytes, 4)
  bytes.set(valueBytes, 4 + keyBytes.byteLength)
  return bytes
}

/**
 * Pack one level of rgba8 pixels into a KTX 2.0 container.
 *
 * Section order and every offset are fixed here rather than derived from iteration order, so two
 * runs over the same input produce the same bytes. Key/value entries are emitted in UTF-8 key
 * order, which the container format requires.
 */
export function packUvtKtx2(header, dfd, keyValues, level) {
  const levelIndexBytes = 24
  const dfdOffset = 12 + 36 + 32 + levelIndexBytes
  const kvd = keyValues.slice().sort((left, right) => (left.key < right.key ? -1 : 1))
  const kvdBytes = kvd.map(entry => keyValueEntry(entry.key, entry.value))
  const kvdLength = kvdBytes.reduce((sum, entry) => sum + entry.byteLength, 0)
  const kvdOffset = dfdOffset + dfd.byteLength
  // texel block size is 4 for an 8-bit RGBA format, so the level alignment is lcm(4, 4) = 4
  const levelOffset = align(kvdOffset + kvdLength, 4)
  const total = levelOffset + level.byteLength

  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer)
  bytes.set(IDENTIFIER, 0)
  view.setUint32(12, header.vkFormat, true)
  view.setUint32(16, header.typeSize, true)
  view.setUint32(20, header.pixelWidth, true)
  view.setUint32(24, header.pixelHeight, true)
  view.setUint32(28, header.pixelDepth, true)
  view.setUint32(32, header.layerCount, true)
  view.setUint32(36, header.faceCount, true)
  view.setUint32(40, header.levelCount, true)
  view.setUint32(44, header.supercompressionScheme, true)
  view.setUint32(48, dfdOffset, true)
  view.setUint32(52, dfd.byteLength, true)
  view.setUint32(56, kvdLength === 0 ? 0 : kvdOffset, true)
  view.setUint32(60, kvdLength, true)
  // no supercompression global data: offset 0 is how the container spells "there is none"
  view.setBigUint64(64, 0n, true)
  view.setBigUint64(72, 0n, true)
  view.setBigUint64(80, BigInt(levelOffset), true)
  view.setBigUint64(88, BigInt(level.byteLength), true)
  view.setBigUint64(96, BigInt(level.byteLength), true)
  bytes.set(dfd, dfdOffset)
  let cursor = kvdOffset
  for (const entry of kvdBytes) {
    bytes.set(entry, cursor)
    cursor += entry.byteLength
  }
  bytes.set(level, levelOffset)
  return bytes
}

// ---------------------------------------------------------------------------------------------
// the materializer

const TRANSFER_BY_COLOR_SPACE = Object.freeze({
  srgb: { transferFunction: 'srgb', primaries: 'bt709' },
  linear: { transferFunction: 'linear', primaries: 'unspecified' },
})

const ALPHA_BY_SOURCE = Object.freeze({
  none: 'opaque',
  straight: 'straight',
  premultiplied: 'premultiplied',
})

const ORIENTATION_BY_SOURCE = Object.freeze({ 'top-left': 'rd', 'bottom-left': 'ru' })

/** The sampler a projection carries when nothing published one. Stated, never silent. */
const DEFAULT_SAMPLER = Object.freeze({
  minFilter: 'linear',
  magFilter: 'linear',
  // a single-level container cannot filter across levels, and the profile refuses a projection
  // that asks it to
  mipFilter: 'none',
  wrapS: 'repeat',
  wrapT: 'repeat',
})

/**
 * Materialise a decoded raster region into UVT/core bytes, its sidecar and a receipt.
 *
 * `source`: `{ info, region, sampler?, atlas? }` — `info` is `RasterImageInfo` as
 * `common.view/raster-image-source@1` publishes it, `region` is one `RasterRegion` covering the
 * whole base image in `rgba8`. `sampler` and `atlas` are optional projector-supplied blocks; when
 * absent the sampler defaults and the atlas facet stays absent.
 *
 * `request`: `MaterializationRequest` — `scope`, `profile`, `subjectRevision`, `options?`.
 *
 * `digest`: optional `(bytes) => string` returning an algorithm-qualified digest, supplied by the
 * caller so this module stays free of crypto.
 */
export function materializeUvtCore(source, request, { digest } = {}) {
  const info = source?.info
  const region = source?.region
  if (info === undefined) fail('the projection carries no raster info')
  if (region === undefined) fail('the projection carries no decoded region')
  if (request?.scope === undefined) fail('a materialization request must name its semantic scope')

  if (region.pixelFormat !== 'rgba8') {
    fail(
      `this materializer writes an 8-bit RGBA container and was handed a «${String(region.pixelFormat)}» region; ask readRegion for rgba8 rather than reinterpreting the bytes here`,
    )
  }
  const width = info.width
  const height = info.height
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    fail('the image must have a positive integral width and height')
  }
  if (region.width !== width || region.height !== height) {
    fail(
      `the region covers ${region.width}x${region.height} of a ${width}x${height} image; a UVT projection describes the whole base level, and a crop would be a different texture`,
    )
  }
  const rowStride = region.rowStride
  if (!Number.isSafeInteger(rowStride) || rowStride < width * 4) {
    fail('the region row stride is shorter than four bytes per pixel')
  }
  if (region.pixels.byteLength < rowStride * (height - 1) + width * 4) {
    fail('the region carries fewer bytes than its own width, height and stride declare')
  }

  const color = TRANSFER_BY_COLOR_SPACE[info.colorSpace]
  if (color === undefined) {
    fail(
      `the source declares colorSpace «${String(info.colorSpace)}»; UVT/core admits linear and srgb only, and guessing a transfer function changes every pixel’s meaning`,
    )
  }
  const alphaMode = ALPHA_BY_SOURCE[info.alphaMode]
  if (alphaMode === undefined) {
    fail(
      `the source declares alphaMode «${String(info.alphaMode)}»; UVT/core admits opaque, straight and premultiplied, and a guessed alpha mode changes every blended pixel`,
    )
  }
  const orientation = ORIENTATION_BY_SOURCE[info.orientation]
  if (orientation === undefined) {
    fail(
      `the source declares orientation «${String(info.orientation)}»; a runtime cannot recover row order from the pixels, so the profile requires the projection to state rd or ru`,
    )
  }

  const diff = []
  const losses = []
  const lostFacetIds = []
  const excludedFacetIds = []
  const note = (facetId, change, path, message) => {
    diff.push({ facetId, change, ...(path === undefined ? {} : { path }), note: message })
  }

  // --- the planes a single decoded region cannot carry ----------------------------------------
  if (Number(info.mipLevels ?? 1) > 1) {
    losses.push(`${Number(info.mipLevels) - 1} mip level(s) were not carried`)
    note(
      'uv.texture/container@1',
      'value-differs',
      '/levelCount',
      'the projection was built from one decoded base-level region; the source’s remaining mip levels were neither copied nor regenerated, and regenerating them would be inventing pixels',
    )
  }
  if (Number(info.layers ?? 1) > 1) {
    losses.push(`${Number(info.layers) - 1} array layer(s) were not carried`)
    note(
      'uv.texture/container@1',
      'value-differs',
      '/layerCount',
      'a decoded region names one layer; the remaining layers of the source array were not written',
    )
  }
  if (Number(info.faces ?? 1) > 1) {
    losses.push(`${Number(info.faces) - 1} cube face(s) were not carried`)
    note(
      'uv.texture/container@1',
      'value-differs',
      '/faceCount',
      'a decoded region names one face; a cubemap projection needs six and this materialization wrote one',
    )
  }
  if (Number(info.frames ?? 1) > 1) {
    losses.push(`${Number(info.frames) - 1} additional frame(s) were not carried`)
    note(
      'uv.texture/container@1',
      'absent-in-artifact',
      '/frames',
      'UVT/core carries no frame sequence: animated frame timelines are named in the profile’s open questions, and a container cannot hold what the profile does not define',
    )
  }
  if (Number(info.bitDepth ?? 8) !== 8) {
    losses.push(`source channel depth ${info.bitDepth} was requantised to 8 bits per channel`)
    note(
      'uv.texture/container@1',
      'value-differs',
      '/vkFormat',
      'the decoded region contract delivers 8-bit RGBA, so a deeper source arrives already requantised; the loss belongs to the decode, and this records that it happened',
    )
  }
  if (source.sampler === undefined) {
    note(
      'uv.texture/sampler@1',
      'absent-in-live',
      undefined,
      'no live raster contract publishes sampler state, so the profile’s required sampler is supplied by this materializer at its documented defaults rather than read from the source',
    )
  }
  if (source.atlas === undefined) excludedFacetIds.push('uv.texture/atlas@1')

  // --- the container --------------------------------------------------------------------------
  const srgb = color.transferFunction === 'srgb'
  const premultipliedAlpha = alphaMode === 'premultiplied'
  const header = {
    vkFormat: srgb ? VK_FORMAT_R8G8B8A8_SRGB : VK_FORMAT_R8G8B8A8_UNORM,
    typeSize: 1,
    pixelWidth: width,
    pixelHeight: height,
    pixelDepth: 0,
    // copied verbatim rather than normalised: the container spells "not an array" as 0
    layerCount: 0,
    faceCount: 1,
    levelCount: 1,
    supercompressionScheme: 0,
  }
  const level = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row += 1) {
    level.set(region.pixels.subarray(row * rowStride, row * rowStride + width * 4), row * width * 4)
  }
  const dfd = dataFormatDescriptor({
    transferFunction: srgb ? KHR_DF_TRANSFER_SRGB : KHR_DF_TRANSFER_LINEAR,
    primaries: srgb ? KHR_DF_PRIMARIES_BT709 : KHR_DF_PRIMARIES_UNSPECIFIED,
    premultipliedAlpha,
  })
  const keyValues = [
    { key: 'KTXorientation', value: orientation },
    { key: 'KTXwriter', value: `${MATERIALIZER_ID} ${MATERIALIZER_VERSION}` },
  ]
  const bytes = packUvtKtx2(header, dfd, keyValues, level)

  // --- the sidecar ----------------------------------------------------------------------------
  const sampler = source.sampler === undefined ? { ...DEFAULT_SAMPLER } : { ...source.sampler }
  const sidecar = {
    uv: { format: 'UVT', version: '1.0', profile: 'core' },
    ktx2: { ...header },
    color: {
      transferFunction: color.transferFunction,
      primaries: color.primaries,
      premultipliedAlpha,
    },
    alphaMode,
    orientation,
    sampler,
    ...(source.atlas === undefined ? {} : { atlas: source.atlas }),
  }
  // `typeSize` is a container field the sidecar's mapping table does not carry; it exists in the
  // header and nowhere else, so it is dropped here rather than invented into the sidecar
  delete sidecar.ktx2.typeSize

  const projection = {
    container: { ...sidecar.ktx2 },
    color: { ...sidecar.color, alphaMode, orientation, swizzle: null },
    sampler: { ...sampler },
    ...(source.atlas === undefined ? {} : { atlas: source.atlas }),
  }

  const receipt = {
    materializer: {
      id: MATERIALIZER_ID,
      version: MATERIALIZER_VERSION,
      ...(request.options === undefined ? {} : { options: request.options }),
    },
    scope: request.scope,
    profile: request.profile ?? PROFILE,
    subjectRevision: request.subjectRevision,
    lostFacetIds,
    excludedFacetIds,
    diff,
    ...(digest === undefined ? {} : { artifactDigest: digest(bytes) }),
  }
  return { bytes, sidecar, projection, receipt, losses }
}

export const TEXTURE_MATERIALIZER_COORDINATE = Object.freeze({
  id: MATERIALIZER_ID,
  version: MATERIALIZER_VERSION,
  profile: PROFILE,
})
