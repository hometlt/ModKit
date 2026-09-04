/**
 * Data-only image texture profile shared by codecs, renderers, model previews, workers, and hosts.
 *
 * This subpath deliberately contains no decoder, GPU API, DOM type, or format registry. Consumers
 * that only transport a texture descriptor therefore do not pull `@modkitx/image-processing` or a
 * concrete image extension into their dependency closure.
 */

export type CompressedTextureFormat =
  | 'astc-rgba-unorm'
  | 'bc1-rgb-unorm'
  | 'bc1-rgba-unorm'
  | 'bc2-rgba-unorm'
  | 'bc3-rgba-unorm'
  | 'bc4-r-unorm'
  | 'bc4-r-snorm'
  | 'bc5-rg-unorm'
  | 'bc5-rg-snorm'
  | 'bc6h-rgb-ufloat'
  | 'bc6h-rgb-sfloat'
  | 'bc7-rgba-unorm'
  | 'etc1-rgb8-unorm'
  | 'etc2-rgb8-unorm'
  | 'etc2-rgb8a1-unorm'
  | 'etc2-rgba8-unorm'
  | 'eac-r11-unorm'
  | 'eac-r11-snorm'
  | 'eac-rg11-unorm'
  | 'eac-rg11-snorm'
  | 'pvrtc1-rgb-2bpp-unorm'
  | 'pvrtc1-rgba-2bpp-unorm'
  | 'pvrtc1-rgb-4bpp-unorm'
  | 'pvrtc1-rgba-4bpp-unorm'
  | (string & Record<never, never>)

export interface CompressedTextureBlockLayout {
  width: number
  height: number
  depth: number
  bytes: number
  minimumBlocksWide?: number
  minimumBlocksHigh?: number
  minimumBlocksDeep?: number
}

/** One payload in canonical mip -> layer -> face -> depth-slice order. */
export interface CompressedTextureSubresource<TData = Uint8Array> {
  mipLevel: number
  layer: number
  face: number
  depthSlice: number
  width: number
  height: number
  /** Always 1 in v1: volume textures are split into explicitly indexed depth slices. */
  depth: 1
  /** Exact compressed payload for this subresource; never a whole unbounded source file. */
  data: TData
  /** Optional provenance range in the original container. */
  sourceByteRange?: { offset: number; length: number }
}

/** Renderer-neutral data returned by `image.compressed.read`. */
export interface CompressedTextureDescriptorV1<TData = Uint8Array> {
  schemaVersion: 1
  format: CompressedTextureFormat
  dimensions: { width: number; height: number; depth: number }
  mipLevelCount: number
  layerCount: number
  faceCount: number
  colorSpace: 'linear' | 'srgb' | 'unknown'
  alphaMode: 'none' | 'straight' | 'premultiplied' | 'unknown'
  block: CompressedTextureBlockLayout
  subresources: readonly CompressedTextureSubresource<TData>[]
  source: {
    codecId: string
    containerFormat: string
    preservation: 'source-bytes' | 'transcoded'
  }
  notes?: readonly string[]
}

export type CompressedTextureDescriptorIssueCode =
  | 'descriptor-shape'
  | 'schema-version'
  | 'format'
  | 'dimensions'
  | 'mip-level-count'
  | 'layer-count'
  | 'face-count'
  | 'color-space'
  | 'alpha-mode'
  | 'block-layout'
  | 'subresource-count'
  | 'subresource-index'
  | 'subresource-dimensions'
  | 'subresource-order'
  | 'subresource-byte-length'
  | 'source-byte-range'
  | 'source'

/** Stable, executor-independent diagnostic returned by the v1 contract checker. */
export interface CompressedTextureDescriptorIssue {
  code: CompressedTextureDescriptorIssueCode
  path: string
  message: string
}

/** Defensive ceiling for validating a provider-controlled JS array, independent of byte limits. */
const MAX_VALIDATED_SUBRESOURCES_V1 = 1_048_576

/**
 * Exact encoded size implied by a block layout, or `undefined` for invalid/unsafe input.
 *
 * This is deliberately non-throwing so a conformance runner can inspect untrusted provider output
 * without importing a codec runtime or depending on one test framework's assertion behavior.
 */
export function compressedTextureBlockByteLengthV1(
  width: number,
  height: number,
  depth: number,
  block: CompressedTextureBlockLayout,
): number | undefined {
  if (
    !isPositiveSafeInteger(width) ||
    !isPositiveSafeInteger(height) ||
    !isPositiveSafeInteger(depth) ||
    !validBlockLayout(block)
  ) {
    return undefined
  }
  const wide = Math.max(block.minimumBlocksWide ?? 1, Math.ceil(width / block.width))
  const high = Math.max(block.minimumBlocksHigh ?? 1, Math.ceil(height / block.height))
  const deep = Math.max(block.minimumBlocksDeep ?? 1, Math.ceil(depth / block.depth))
  const length = wide * high * deep * block.bytes
  return Number.isSafeInteger(length) && length >= 0 ? length : undefined
}

/**
 * Check the renderer-neutral v1 DTO without executing a codec, renderer, WASM module, or host.
 *
 * Issue codes and paths are stable conformance output; messages remain human-readable details.
 * The checker never iterates an untrusted count until all count/dimension fields are bounded by the
 * natural mip chain, preventing `NaN`, `Infinity`, or huge counts from becoming a test-host DoS.
 */
export function validateCompressedTextureDescriptorV1(
  input: unknown,
): readonly CompressedTextureDescriptorIssue[] {
  const issues: CompressedTextureDescriptorIssue[] = []
  const issue = (
    code: CompressedTextureDescriptorIssueCode,
    path: string,
    message: string,
  ): void => {
    issues.push({ code, path, message })
  }

  if (!isRecord(input)) {
    issue('descriptor-shape', '', 'descriptor must be an object')
    return issues
  }
  if (!isRecord(input['dimensions']))
    issue('descriptor-shape', 'dimensions', 'dimensions must be an object')
  if (!isRecord(input['block'])) issue('descriptor-shape', 'block', 'block must be an object')
  if (!Array.isArray(input['subresources']))
    issue('descriptor-shape', 'subresources', 'subresources must be an array')
  if (!isRecord(input['source'])) issue('descriptor-shape', 'source', 'source must be an object')
  if (issues.length > 0) return issues

  const descriptor = input as unknown as CompressedTextureDescriptorV1<unknown>

  if (descriptor.schemaVersion !== 1)
    issue('schema-version', 'schemaVersion', 'schemaVersion must equal 1')
  if (typeof descriptor.format !== 'string' || descriptor.format.length === 0)
    issue('format', 'format', 'format must be a non-empty string')

  const { width, height, depth } = descriptor.dimensions
  const dimensionsValid = [width, height, depth].every(isPositiveSafeInteger)
  if (!dimensionsValid)
    issue('dimensions', 'dimensions', 'dimensions must be positive safe integers')

  const mipCountValid = isPositiveSafeInteger(descriptor.mipLevelCount)
  if (!mipCountValid) {
    issue('mip-level-count', 'mipLevelCount', 'mipLevelCount must be a positive safe integer')
  } else if (dimensionsValid) {
    const naturalMipCount = Math.floor(Math.log2(Math.max(width, height, depth))) + 1
    if (descriptor.mipLevelCount > naturalMipCount) {
      issue(
        'mip-level-count',
        'mipLevelCount',
        `mipLevelCount ${descriptor.mipLevelCount} exceeds the natural chain length ${naturalMipCount}`,
      )
    }
  }
  if (!isPositiveSafeInteger(descriptor.layerCount))
    issue('layer-count', 'layerCount', 'layerCount must be a positive safe integer')
  if (!isPositiveSafeInteger(descriptor.faceCount))
    issue('face-count', 'faceCount', 'faceCount must be a positive safe integer')
  if (!['linear', 'srgb', 'unknown'].includes(descriptor.colorSpace))
    issue('color-space', 'colorSpace', 'colorSpace is not a v1 value')
  if (!['none', 'straight', 'premultiplied', 'unknown'].includes(descriptor.alphaMode))
    issue('alpha-mode', 'alphaMode', 'alphaMode is not a v1 value')

  const blockValid = validBlockLayout(descriptor.block)
  if (!blockValid)
    issue(
      'block-layout',
      'block',
      'block dimensions, byte size, and optional minimum footprints must be positive safe integers',
    )

  const countsValid =
    dimensionsValid &&
    mipCountValid &&
    descriptor.mipLevelCount <= Math.floor(Math.log2(Math.max(width, height, depth))) + 1 &&
    isPositiveSafeInteger(descriptor.layerCount) &&
    isPositiveSafeInteger(descriptor.faceCount)

  let expectedSubresources: number | undefined
  if (countsValid) {
    let depthSlices = 0
    for (let mipLevel = 0; mipLevel < descriptor.mipLevelCount; mipLevel += 1)
      depthSlices += Math.max(1, Math.floor(depth / 2 ** mipLevel))
    const count = depthSlices * descriptor.layerCount * descriptor.faceCount
    if (Number.isSafeInteger(count)) expectedSubresources = count
    else issue('subresource-count', 'subresources', 'expected subresource count is unsafe')
  }
  if (
    expectedSubresources !== undefined &&
    descriptor.subresources.length !== expectedSubresources
  ) {
    issue(
      'subresource-count',
      'subresources',
      `descriptor has ${descriptor.subresources.length} subresources; expected ${expectedSubresources}`,
    )
  }
  if (
    descriptor.subresources.length > MAX_VALIDATED_SUBRESOURCES_V1 ||
    (expectedSubresources ?? 0) > MAX_VALIDATED_SUBRESOURCES_V1
  ) {
    issue(
      'subresource-count',
      'subresources',
      `subresource count exceeds the v1 validation ceiling ${MAX_VALIDATED_SUBRESOURCES_V1}`,
    )
  }

  let previousTuple: readonly number[] | undefined
  const inspectedSubresourceCount =
    countsValid &&
    descriptor.subresources.length <= MAX_VALIDATED_SUBRESOURCES_V1 &&
    (expectedSubresources ?? 0) <= MAX_VALIDATED_SUBRESOURCES_V1
      ? descriptor.subresources.length
      : 0
  for (let index = 0; index < inspectedSubresourceCount; index += 1) {
    const path = `subresources[${index}]`
    const candidate = descriptor.subresources[index]
    if (!isRecord(candidate)) {
      issue('descriptor-shape', path, 'subresource must be an object')
      continue
    }
    const subresource = candidate as unknown as CompressedTextureSubresource<unknown>
    const indexesValid =
      countsValid &&
      isNonNegativeSafeInteger(subresource.mipLevel) &&
      subresource.mipLevel < descriptor.mipLevelCount &&
      isNonNegativeSafeInteger(subresource.layer) &&
      subresource.layer < descriptor.layerCount &&
      isNonNegativeSafeInteger(subresource.face) &&
      subresource.face < descriptor.faceCount
    const mipDepth =
      indexesValid && dimensionsValid
        ? Math.max(1, Math.floor(depth / 2 ** subresource.mipLevel))
        : undefined
    if (
      !indexesValid ||
      !isNonNegativeSafeInteger(subresource.depthSlice) ||
      mipDepth === undefined ||
      subresource.depthSlice >= mipDepth
    ) {
      issue('subresource-index', path, 'subresource index is outside the descriptor bounds')
      continue
    }

    const mipWidth = Math.max(1, Math.floor(width / 2 ** subresource.mipLevel))
    const mipHeight = Math.max(1, Math.floor(height / 2 ** subresource.mipLevel))
    if (
      subresource.width !== mipWidth ||
      subresource.height !== mipHeight ||
      subresource.depth !== 1
    ) {
      issue('subresource-dimensions', path, 'subresource dimensions do not match its mip level')
    }

    const tuple = [
      subresource.mipLevel,
      subresource.layer,
      subresource.face,
      subresource.depthSlice,
    ] as const
    if (previousTuple !== undefined && compareIndexTuples(previousTuple, tuple) >= 0)
      issue('subresource-order', path, 'subresources are not in canonical order')
    previousTuple = tuple

    if (blockValid) {
      const required = compressedTextureBlockByteLengthV1(
        subresource.width,
        subresource.height,
        subresource.depth,
        descriptor.block,
      )
      const actual = dataByteLength(subresource.data)
      if (required === undefined || actual !== required) {
        issue(
          'subresource-byte-length',
          `${path}.data`,
          `subresource has ${actual ?? 'unknown'} bytes; expected ${required ?? 'a safe size'}`,
        )
      }
      const range = subresource.sourceByteRange
      if (range !== undefined) {
        if (!isRecord(range)) {
          issue('descriptor-shape', `${path}.sourceByteRange`, 'sourceByteRange must be an object')
        } else if (
          !isNonNegativeSafeInteger(range.offset) ||
          !isNonNegativeSafeInteger(range.length) ||
          !Number.isSafeInteger(range.offset + range.length)
        ) {
          issue(
            'source-byte-range',
            `${path}.sourceByteRange`,
            'sourceByteRange must contain safe non-negative integers',
          )
        } else if (range.length !== actual) {
          issue(
            'source-byte-range',
            `${path}.sourceByteRange.length`,
            'sourceByteRange length does not match subresource data',
          )
        }
      }
    }
  }

  if (
    typeof descriptor.source.codecId !== 'string' ||
    descriptor.source.codecId.length === 0 ||
    typeof descriptor.source.containerFormat !== 'string' ||
    descriptor.source.containerFormat.length === 0 ||
    !['source-bytes', 'transcoded'].includes(descriptor.source.preservation)
  ) {
    issue('source', 'source', 'source identity and preservation must be valid v1 values')
  }
  return issues
}

function validBlockLayout(block: unknown): block is CompressedTextureBlockLayout {
  if (!isRecord(block)) return false
  return (
    [block['width'], block['height'], block['depth'], block['bytes']].every(
      isPositiveSafeInteger,
    ) &&
    optionalPositiveSafeInteger(block['minimumBlocksWide']) &&
    optionalPositiveSafeInteger(block['minimumBlocksHigh']) &&
    optionalPositiveSafeInteger(block['minimumBlocksDeep'])
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function optionalPositiveSafeInteger(value: unknown): boolean {
  return value === undefined || isPositiveSafeInteger(value)
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function dataByteLength(data: unknown): number | undefined {
  if (Array.isArray(data)) return data.length
  if (typeof data !== 'object' || data === null || !('byteLength' in data)) return undefined
  const byteLength = (data as { byteLength?: unknown }).byteLength
  return typeof byteLength === 'number' && isNonNegativeSafeInteger(byteLength)
    ? byteLength
    : undefined
}

function compareIndexTuples(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const delta = left[index]! - right[index]!
    if (delta !== 0) return delta
  }
  return 0
}
