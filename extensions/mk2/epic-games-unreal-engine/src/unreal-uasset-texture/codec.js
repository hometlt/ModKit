import { createInspectionCodec, createRasterImageSource } from '@modkitx-x3/codec-kit'
import {
  exportBytes,
  exportOf,
  packageClassProbe,
  packageTree,
  parseUnrealPackage,
} from '../unreal-uasset/codec.js'

const ID = 'org.modkitx/unreal-uasset-texture'
const FORMATS = Object.freeze(['PF_B8G8R8A8', 'PF_R8G8B8A8'])

function cookedTexture(bytes, budget) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let offset = 0; offset + 48 <= bytes.byteLength; offset += 1) {
    const length = view.getInt32(offset, true)
    if (length < 2 || length > 64 || offset + 4 + length > bytes.byteLength) continue
    const raw = bytes.subarray(offset + 4, offset + 4 + length)
    if (raw[raw.length - 1] !== 0) continue
    const format = String.fromCharCode(...raw.subarray(0, -1))
    if (!FORMATS.includes(format)) continue
    let cursor = offset + 4 + length
    if (cursor + 36 > bytes.byteLength)
      throw new RangeError('Unreal Texture2D mip header is truncated')
    const unknownMipCount = view.getUint32(cursor, true)
    const mipCount = view.getUint32(cursor + 4, true)
    const cookedFlag = view.getUint32(cursor + 8, true)
    const bulkFlags = view.getUint16(cursor + 12, true)
    const unknownFlags = view.getUint16(cursor + 14, true)
    const dataSize = view.getUint32(cursor + 16, true)
    const duplicateDataSize = view.getUint32(cursor + 20, true)
    const bulkOffset = view.getBigUint64(cursor + 24, true)
    cursor += 32
    if (
      unknownMipCount !== 0 ||
      mipCount !== 1 ||
      cookedFlag !== 1 ||
      bulkFlags !== 0 ||
      unknownFlags !== 0 ||
      dataSize !== duplicateDataSize ||
      bulkOffset !== 0n
    )
      throw new TypeError('Unreal Texture2D cooked mip profile is unsupported')
    if (cursor + dataSize + 12 > bytes.byteLength)
      throw new RangeError('Unreal Texture2D inline mip is truncated')
    const encoded = bytes.slice(cursor, cursor + dataSize)
    cursor += dataSize
    const width = view.getUint32(cursor, true)
    const height = view.getUint32(cursor + 4, true)
    const depth = view.getUint32(cursor + 8, true)
    const decodedBytes = width * height * 4
    if (
      width < 1 ||
      height < 1 ||
      width > 131_072 ||
      height > 131_072 ||
      depth !== 1 ||
      !Number.isSafeInteger(decodedBytes) ||
      dataSize !== decodedBytes
    )
      throw new TypeError('Unreal Texture2D dimensions do not match its inline mip')
    if (decodedBytes > budget.maxScalarBytes)
      throw new RangeError('Unreal Texture2D decoded pixels exceed maxScalarBytes budget')
    if (budget.maxNodes < 8) throw new RangeError('Unreal Texture2D exceeds maxNodes budget')
    const pixels = new Uint8Array(decodedBytes)
    for (let index = 0; index < decodedBytes; index += 4) {
      if (format === 'PF_B8G8R8A8') {
        pixels[index] = encoded[index + 2]
        pixels[index + 1] = encoded[index + 1]
        pixels[index + 2] = encoded[index]
      } else {
        pixels[index] = encoded[index]
        pixels[index + 1] = encoded[index + 1]
        pixels[index + 2] = encoded[index + 2]
      }
      pixels[index + 3] = encoded[index + 3]
    }
    return Object.freeze({ format, width, height, encoded, pixels, decodedBytes })
  }
  throw new TypeError('Unreal Texture2D export has no supported cooked pixel payload')
}

function regionReader(texture) {
  return async request => {
    const integers = [request.x, request.y, request.width, request.height, request.maxBytes]
    if (!integers.every(value => Number.isSafeInteger(value) && value >= 0))
      throw new TypeError('Unreal Texture2D region coordinates must be non-negative safe integers')
    if (
      request.pixelFormat !== 'rgba8' ||
      (request.frame ?? 0) !== 0 ||
      (request.mipLevel ?? 0) !== 0 ||
      (request.layer ?? 0) !== 0 ||
      (request.face ?? 0) !== 0 ||
      (request.slice ?? 0) !== 0
    )
      throw new RangeError('Unreal Texture2D exposes only mip/layer/face/slice zero as rgba8')
    if (request.x + request.width > texture.width || request.y + request.height > texture.height)
      throw new RangeError('Unreal Texture2D region is outside the image')
    const outputBytes = request.width * request.height * 4
    if (!Number.isSafeInteger(outputBytes) || outputBytes > request.maxBytes)
      throw new RangeError('Unreal Texture2D region exceeds maxBytes budget')
    const pixels = new Uint8Array(outputBytes)
    for (let row = 0; row < request.height; row += 1) {
      const source = ((request.y + row) * texture.width + request.x) * 4
      pixels.set(
        texture.pixels.subarray(source, source + request.width * 4),
        row * request.width * 4,
      )
    }
    return Object.freeze({
      width: request.width,
      height: request.height,
      rowStride: request.width * 4,
      pixelFormat: 'rgba8',
      pixels,
    })
  }
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({
    id: 'unreal-uasset-texture',
    label: 'Unreal UTexture2D package',
    mediaType: 'application/x-unreal-package',
  }),
  async detect(prefix) {
    return packageClassProbe(prefix, ['Texture2D'])
  },
  async inspect(bytes, context) {
    const packageModel = parseUnrealPackage(bytes, context.budget)
    const exportEntry = exportOf(packageModel, ['Texture2D'])
    const texture = cookedTexture(exportBytes(bytes, exportEntry), context.budget)
    const raster = createRasterImageSource(
      bytes,
      'application/x-unreal-package',
      {
        width: texture.width,
        height: texture.height,
        depth: 1,
        layers: 1,
        faces: 1,
        mipLevels: 1,
        frames: 1,
        channels: 4,
        bitDepth: 8,
        colorSpace: 'srgb',
        alphaMode: 'straight',
        orientation: 'top-left',
        decodedAccess: true,
      },
      regionReader(texture),
    )
    const tree = packageTree(packageModel, exportEntry, [
      {
        kind: 'image',
        label: 'FTexture2DMipMap[0]',
        preview: `${texture.width} × ${texture.height}, ${texture.format}, inline`,
      },
    ])
    return {
      summary: {
        format: 'unreal-uasset-texture',
        engine: `UE4/${packageModel.summary.ue4FileVersion}`,
        exportClass: exportEntry.className,
        exportName: exportEntry.objectName,
        pixelFormat: texture.format,
        width: texture.width,
        height: texture.height,
        mipLevels: 1,
      },
      metadata: [
        {
          id: 'unreal-texture-2d',
          label: 'Unreal Texture2D',
          entries: [
            { key: 'folder', value: packageModel.summary.folderName },
            { key: 'export', value: exportEntry.objectName },
            { key: 'pixelFormat', value: texture.format },
            { key: 'width', value: texture.width },
            { key: 'height', value: texture.height },
            { key: 'storage', value: 'inline bulk data' },
          ],
        },
      ],
      traits: [
        {
          id: 'image.raster',
          parameters: { width: texture.width, height: texture.height, bitDepth: 8 },
        },
        { id: 'image.channels', parameters: { count: 4, alpha: true } },
        { id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } },
      ],
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/raster-image-source': raster,
      },
      maxDecodedBytes: texture.decodedBytes,
      unsupportedFeatures: [
        'compressed-pixel-formats',
        'virtual-textures-arrays-cubes-and-volumes',
        'uexp-and-ubulk-sidecars',
        'ue5-streamed-texture-resources',
        'package-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
