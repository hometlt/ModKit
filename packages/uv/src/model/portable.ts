/**
 * Portable UVM image closure. This pure UV owner embeds exact PNG/JPEG companion bytes in an
 * existing glTF/GLB model; resource discovery, native decoding and writes remain with the Host
 * and codec. See multiverse/specs/model/SPEC_UVM.md §11.5. Missing or unsupported images refuse
 * the portable claim. KTX2 is copied only when its authored BasisU bindings are already valid.
 */
import type { JsonObject } from '@modkit/sdk'
import {
  DEFAULT_UVM_CONTAINER_BUDGET,
  readUvmContainer,
  uvmImageLogicalId,
  writeUvmContainer,
  type UvmContainerBudget,
} from './container.js'

export interface PortableUvmImage {
  /** Exact logical id decoded from the source UVM image URI. */
  readonly logicalId: string
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/ktx2'
  /** Complete encoded image, not a selected preview mip or decoded approximation. */
  readonly bytes: Uint8Array
}

export type PortableUvmImageResult =
  | { readonly state: 'portable'; readonly bytes: Uint8Array; readonly embeddedImages: number }
  | {
      readonly state: 'incomplete'
      readonly missing: readonly string[]
      readonly unsupported: readonly string[]
    }

/** Recognize the claimed image container before copying its encoded bytes unchanged. */
function matchesImageSignature(image: PortableUvmImage): boolean {
  const bytes = image.bytes
  if (image.mimeType === 'image/png')
    return (
      bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    )
  if (image.mimeType === 'image/jpeg')
    return (
      bytes.length >= 4 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff &&
      bytes[bytes.length - 2] === 0xff &&
      bytes[bytes.length - 1] === 0xd9
    )
  return (
    bytes.length >= 12 &&
    [171, 75, 84, 88, 32, 50, 48, 187, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value,
    )
  )
}

/** A KTX2 image is portable only when the model already declares its required glTF binding. */
function hasBasisuBinding(document: Record<string, unknown>, imageIndex: number): boolean {
  const used = document['extensionsUsed']
  const required = document['extensionsRequired']
  const textures = document['textures']
  if (!Array.isArray(used) || !used.includes('KHR_texture_basisu') || !Array.isArray(textures))
    return false
  return textures.some(value => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const texture = value as Record<string, unknown>
    const extensions = texture['extensions']
    if (extensions === null || typeof extensions !== 'object' || Array.isArray(extensions))
      return false
    const basisu = (extensions as Record<string, unknown>)['KHR_texture_basisu']
    return (
      basisu !== null &&
      typeof basisu === 'object' &&
      !Array.isArray(basisu) &&
      (basisu as Record<string, unknown>)['source'] === imageIndex &&
      (texture['source'] !== undefined ||
        (Array.isArray(required) && required.includes('KHR_texture_basisu')))
    )
  })
}

/** Embed exact image bytes into a single GLB, or return every unresolved image without a partial artifact. */
export function embedPortableUvmImages(
  source: Uint8Array,
  payloads: readonly PortableUvmImage[],
  budget: UvmContainerBudget = DEFAULT_UVM_CONTAINER_BUDGET,
  signal?: AbortSignal,
): PortableUvmImageResult {
  signal?.throwIfAborted()
  const container = readUvmContainer(source, budget, signal)
  const document = container.document as Record<string, unknown>
  const images = document['images']
  if (images !== undefined && !Array.isArray(images))
    throw new TypeError('UVM images must be an array')
  const buffers = document['buffers']
  if (buffers !== undefined && !Array.isArray(buffers))
    throw new TypeError('UVM buffers must be an array')
  if (
    Array.isArray(buffers) &&
    (buffers.length > 1 ||
      buffers.some(
        value =>
          value === null ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          (value as Record<string, unknown>)['uri'] !== undefined,
      ))
  )
    return { state: 'incomplete', missing: [], unsupported: ['external or multiple buffers'] }
  const views = document['bufferViews']
  if (views !== undefined && !Array.isArray(views))
    throw new TypeError('UVM bufferViews must be an array')
  const byId = new Map<string, PortableUvmImage>()
  for (const payload of payloads) {
    signal?.throwIfAborted()
    if (typeof payload.logicalId !== 'string' || !payload.logicalId || byId.has(payload.logicalId))
      throw new TypeError('portable image ids must be non-empty and unique')
    if (
      !(payload.bytes instanceof Uint8Array) ||
      !['image/png', 'image/jpeg', 'image/ktx2'].includes(payload.mimeType)
    )
      throw new TypeError('portable images need encoded PNG, JPEG or KTX2 bytes')
    byId.set(payload.logicalId, payload)
  }
  const missing: string[] = []
  const unsupported: string[] = []
  const additions: PortableUvmImage[] = []
  const rewritten = (images ?? []).map((value, index) => {
    signal?.throwIfAborted()
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      throw new TypeError(`UVM image ${index} is not an object`)
    const image = value as Record<string, unknown>
    if (
      image['bufferView'] !== undefined ||
      (typeof image['uri'] === 'string' && image['uri'].startsWith('data:'))
    )
      return image
    if (typeof image['uri'] !== 'string')
      throw new TypeError(`UVM image ${index} has no payload or URI`)
    const logicalId = uvmImageLogicalId(image['uri'])
    const payload = byId.get(logicalId)
    if (payload === undefined) {
      missing.push(logicalId)
      return image
    }
    // A KTX2 image needs KHR_texture_basisu texture bindings. Do not forge or transcode them.
    if (
      (payload.mimeType === 'image/ktx2' && !hasBasisuBinding(document, index)) ||
      !matchesImageSignature(payload) ||
      (image['mimeType'] !== undefined && image['mimeType'] !== payload.mimeType)
    ) {
      unsupported.push(logicalId)
      return image
    }
    additions.push(payload)
    const { uri: _uri, ...rest } = image
    void _uri
    return {
      ...rest,
      bufferView: (views?.length ?? 0) + additions.length - 1,
      mimeType: payload.mimeType,
    }
  })
  if (missing.length > 0 || unsupported.length > 0)
    return {
      state: 'incomplete',
      missing: Object.freeze(missing),
      unsupported: Object.freeze(unsupported),
    }
  if (additions.length === 0)
    return {
      state: 'portable',
      bytes: writeUvmContainer({ ...container, format: 'glb' }, budget, signal),
      embeddedImages: 0,
    }
  const bytesNeeded = additions.reduce(
    (sum, image) => sum + image.bytes.byteLength + 3,
    container.binary.byteLength,
  )
  if (!Number.isSafeInteger(bytesNeeded) || bytesNeeded > budget.maxInputBytes)
    throw new RangeError('portable UVM images exceed maxInputBytes')
  const binary = new Uint8Array(bytesNeeded)
  binary.set(container.binary)
  let cursor = container.binary.byteLength
  const newViews = additions.map(image => {
    signal?.throwIfAborted()
    cursor = (cursor + 3) & ~3
    binary.set(image.bytes, cursor)
    const view = { buffer: 0, byteOffset: cursor, byteLength: image.bytes.byteLength }
    cursor += image.bytes.byteLength
    return view
  })
  const nextDocument = {
    ...document,
    images: rewritten,
    bufferViews: [...(views ?? []), ...newViews],
    buffers: [
      {
        ...(Array.isArray(buffers) && buffers[0] !== undefined ? (buffers[0] as object) : {}),
        byteLength: cursor,
      },
    ],
  } as JsonObject
  return {
    state: 'portable',
    bytes: writeUvmContainer(
      { ...container, format: 'glb', document: nextDocument, binary: binary.slice(0, cursor) },
      budget,
      signal,
    ),
    embeddedImages: additions.length,
  }
}
