import type { CompressedTextureDescriptorV1 } from '../../legacy-model-assets-support.js'
import type { NormalMapFormat } from './material.js'

export type ModelPreviewCompressedTexture = CompressedTextureDescriptorV1<number[] | Uint8Array>

export interface ModelPreviewTexture {
  path: string
  status: 'decoded' | 'missing' | 'unsupported' | 'error'
  width?: number
  height?: number
  rgba?: number[] | Uint8Array
  compressed?: {
    format: 'dxt1' | 'dxt3' | 'dxt5' | 'bc5'
    mipmaps: Array<{ width: number; height: number; data: number[] | Uint8Array }>
  }
  /** Source-native GPU blocks; preserved independently of the optional RGBA fallback. */
  compressedTexture?: ModelPreviewCompressedTexture
  normalMapFormat?: NormalMapFormat
  sourcePath?: string
  message?: string
}

export interface PreviewTextureAsset {
  path: string
  bytes: Uint8Array
  source: { path: string }
}

export interface PreviewTextureAssetResolver {
  read(request: {
    path: string
    lookupMode?: 'fast' | 'broad'
  }): Promise<PreviewTextureAsset | null> | PreviewTextureAsset | null
}

export interface DecodedPreviewTexture {
  width: number
  height: number
  /** Optional software-decoded fallback used by renderers without native block support. */
  rgba?: Uint8Array
  normalMapFormat: NormalMapFormat
  compressed?: {
    format: 'dxt1' | 'dxt3' | 'dxt5' | 'bc5'
    mipmaps: Array<{ width: number; height: number; data: Uint8Array }>
  }
  compressedTexture?: CompressedTextureDescriptorV1
}

export type PreviewTextureDecoder = (
  bytes: Uint8Array,
  hint: string,
  resolveSibling?: (path: string) => Promise<Uint8Array | undefined>,
) => Promise<DecodedPreviewTexture | null>

export interface PreviewTextureResolveOptions {
  binaryPixels?: boolean
  concurrency?: number
  readTimeoutMs?: number
  lookupMode?: 'fast' | 'broad'
  maxDecodedBytes?: number
  maxTextures?: number
  maxPixels?: number
  onTexture?: (texture: ModelPreviewTexture, index: number) => void
}

export async function resolveModelPreviewTextures(
  assetResolver: PreviewTextureAssetResolver,
  texturePaths: readonly string[],
  decode: PreviewTextureDecoder,
  options: PreviewTextureResolveOptions = {},
): Promise<ModelPreviewTexture[]> {
  const unique = [...new Set(texturePaths)].slice(0, options.maxTextures ?? 32)
  const results = new Array<ModelPreviewTexture>(unique.length)
  const concurrency = Math.max(1, Math.min(unique.length || 1, options.concurrency ?? 6))
  let nextIndex = 0
  let decodedBytes = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex++
      if (index >= unique.length) return
      const texture = await resolveOne(assetResolver, unique[index]!, decode, options)
      const byteLength =
        (texture.rgba?.length ?? 0) +
        (texture.compressed?.mipmaps.reduce((sum, mip) => sum + mip.data.length, 0) ?? 0) +
        (texture.compressedTexture?.subresources.reduce(
          (sum, subresource) => sum + subresource.data.length,
          0,
        ) ?? 0)
      if (
        byteLength > 0 &&
        options.maxDecodedBytes !== undefined &&
        decodedBytes + byteLength > options.maxDecodedBytes
      ) {
        results[index] = {
          path: texture.path,
          status: 'unsupported',
          ...(texture.sourcePath ? { sourcePath: texture.sourcePath } : {}),
          message: `Decoded texture budget of ${options.maxDecodedBytes} bytes was reached.`,
        }
      } else {
        decodedBytes += byteLength
        results[index] = texture
      }
      options.onTexture?.(results[index]!, index)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return results
}

async function resolveOne(
  resolver: PreviewTextureAssetResolver,
  texturePath: string,
  decode: PreviewTextureDecoder,
  options: PreviewTextureResolveOptions,
): Promise<ModelPreviewTexture> {
  const embedded = decodeDataUri(texturePath)
  let asset: PreviewTextureAsset | null
  let sourcePath: string
  try {
    asset = embedded
      ? { path: embedded.hint, bytes: embedded.bytes, source: { path: 'embedded glTF data URI' } }
      : await readWithTimeout(
          resolver,
          { path: texturePath, ...(options.lookupMode ? { lookupMode: options.lookupMode } : {}) },
          options.readTimeoutMs,
        )
    if (!asset)
      return {
        path: texturePath,
        status: 'missing',
        message: 'Texture file was not found by the configured asset resolvers.',
      }
    sourcePath = asset.source.path
    const decoded = await decode(asset.bytes, asset.path, async siblingPath => {
      try {
        return (await readWithTimeout(resolver, { path: siblingPath }, options.readTimeoutMs))
          ?.bytes
      } catch {
        return undefined
      }
    })
    if (!decoded)
      return {
        path: texturePath,
        status: 'unsupported',
        sourcePath,
        message: 'Texture format is not decoded by the model preview.',
      }
    if (decoded.width * decoded.height > (options.maxPixels ?? 2048 * 2048)) {
      return {
        path: texturePath,
        status: 'unsupported',
        sourcePath,
        message: 'Texture is too large for inline preview upload.',
      }
    }
    return {
      path: texturePath,
      status: 'decoded',
      width: decoded.width,
      height: decoded.height,
      ...(decoded.rgba
        ? { rgba: options.binaryPixels ? decoded.rgba : Array.from(decoded.rgba) }
        : {}),
      ...(decoded.compressed
        ? {
            compressed: {
              format: decoded.compressed.format,
              mipmaps: decoded.compressed.mipmaps.map(mip => ({
                width: mip.width,
                height: mip.height,
                data: options.binaryPixels ? mip.data : Array.from(mip.data),
              })),
            },
          }
        : {}),
      ...(decoded.compressedTexture
        ? {
            compressedTexture: {
              ...decoded.compressedTexture,
              subresources: decoded.compressedTexture.subresources.map(subresource => ({
                ...subresource,
                data: options.binaryPixels ? subresource.data : Array.from(subresource.data),
              })),
            },
          }
        : {}),
      normalMapFormat: decoded.normalMapFormat,
      sourcePath,
    }
  } catch (error) {
    return {
      path: texturePath,
      status: 'error',
      ...(embedded ? { sourcePath: 'embedded glTF data URI' } : {}),
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

async function readWithTimeout(
  resolver: PreviewTextureAssetResolver,
  request: { path: string; lookupMode?: 'fast' | 'broad' },
  timeoutMs: number | undefined,
): Promise<PreviewTextureAsset | null> {
  const pending = Promise.resolve().then(() => resolver.read(request))
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return pending
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Texture lookup timed out after ${Math.round(timeoutMs)} ms.`)),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function decodeDataUri(value: string): { bytes: Uint8Array; hint: string } | null {
  const match = /^data:([^,]*),(.*)$/is.exec(value)
  if (!match) return null
  const metadata = match[1] ?? ''
  const payload = match[2] ?? ''
  const bytes = /;base64/i.test(metadata)
    ? Uint8Array.from(globalThis.atob(payload), character => character.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(payload))
  const mime = metadata.split(';', 1)[0]?.toLowerCase() ?? ''
  const extension = mime === 'image/png' ? 'png' : mime === 'image/vnd-ms.dds' ? 'dds' : 'bin'
  return { bytes, hint: `embedded.${extension}` }
}
