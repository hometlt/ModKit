/** Pure raw voxel-backend boundary; no kernel, WASM, loader, SDK operation or native encoder.
 * Accepts float32 triangle RGB or one already-baked REPEAT atlas. Strict own-data descriptors,
 * fixed nonshared buffers and synchronous owned snapshots prevent getter/species/shared races.
 * Source limits are representation limits in caller units, not a native/metre/block guarantee.
 * Trusted limits are separate from jobs; cumulative explicit buffer accounting has no GC refunds.
 * JS objects/engine scratch, future WASM allocations and total RSS are outside that allowance.
 * No arbitrary materials, per-vertex colours, clamp, baking, paths, URLs or executable callbacks.
 * Canonical cells and grid recipe live at ./voxel.js; voxelSurface policy remains unchanged.
 */
import { boundedCount, checkedProduct } from '../binary.js'
import { voxelArrayView, voxelBufferAccount, voxelGridTransform } from './voxel.js'

export interface VoxelBackendLimits {
  readonly maxTriangles: number
  readonly maxPixels: number
  readonly maxTextureAxis: number
  readonly maxInputBytes: number
  readonly maxRawCells: number
  readonly maxAccountedBytes: number
  readonly maxSortComparisons: number
}

export const DEFAULT_VOXEL_BACKEND_LIMITS: VoxelBackendLimits = Object.freeze({
  maxTriangles: 100_000, maxPixels: 1_048_576, maxTextureAxis: 2048,
  maxInputBytes: 16 * 1024 ** 2, maxRawCells: 262_144,
  maxAccountedBytes: 64 * 1024 ** 2, maxSortComparisons: 100_000_000,
})
const CEILINGS: VoxelBackendLimits = Object.freeze({
  ...DEFAULT_VOXEL_BACKEND_LIMITS, maxRawCells: 128 ** 3, maxAccountedBytes: 256 * 1024 ** 2,
})

export type VoxelBackendGeometry = {
  readonly kind: 'triangle-rgb'
  readonly positions: Float32Array
  /** Exactly three RGB values per triangle, never one colour per vertex. */
  readonly triangleRgb: Float32Array
} | {
  readonly kind: 'baked-atlas'
  readonly positions: Float32Array
  readonly uvs: Float32Array
  readonly atlas: { readonly width: number; readonly height: number; readonly rgba: Uint8Array }
  readonly sampler: 'repeat'
  readonly alphaPolicy?: 'refuse' | 'discard-explicitly'
}

export interface VoxelBackendRequest {
  readonly geometry: VoxelBackendGeometry
  readonly resolution: number
}

/** Copy a bounded plain record's own descriptor values without evaluating accessors. */
function dataRecord(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new TypeError(`${label} must be a plain data object`)
  const keys = Reflect.ownKeys(value)
  if (keys.length > allowed.length) throw new TypeError(`${label} has unsupported fields`)
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (typeof key !== 'string' || !allowed.includes(key) || !('value' in descriptor))
      throw new TypeError(`${label} has unsupported field/accessor`)
    result[key] = descriptor.value as unknown
  }
  return result
}

/** Validate trusted composition allowances independently of the untrusted job payload. */
export function voxelBackendLimits(input: Readonly<Partial<VoxelBackendLimits>> = {}): VoxelBackendLimits {
  const fields = dataRecord(input, Object.keys(DEFAULT_VOXEL_BACKEND_LIMITS), 'voxel limits')
  const resolved = { ...DEFAULT_VOXEL_BACKEND_LIMITS }
  for (const key of Object.keys(DEFAULT_VOXEL_BACKEND_LIMITS) as (keyof VoxelBackendLimits)[]) {
    const value = fields[key] === undefined ? DEFAULT_VOXEL_BACKEND_LIMITS[key] : fields[key]
    if (typeof value !== 'number') throw new TypeError(`invalid ${key}`)
    boundedCount(value, CEILINGS[key], key)
    if (key !== 'maxSortComparisons' && value === 0) throw new RangeError(`invalid ${key}`)
    resolved[key] = value
  }
  return Object.freeze(resolved)
}

/** Snapshot a job before any future await or worker allocation. No computation backend is loaded. */
export function snapshotVoxelBackendRequest(
  input: unknown,
  trustedLimits: Readonly<Partial<VoxelBackendLimits>> = {},
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const limits = voxelBackendLimits(trustedLimits)
  const job = dataRecord(input, ['geometry', 'resolution'], 'voxel job')
  const resolution = job['resolution']
  if (typeof resolution !== 'number' || !Number.isSafeInteger(resolution) || resolution < 2 || resolution > 128)
    throw new RangeError('voxel resolution must be 2..128')
  const geometry = dataRecord(job['geometry'], ['kind', 'positions', 'triangleRgb', 'uvs', 'atlas', 'sampler', 'alphaPolicy'], 'voxel geometry')
  const kind = geometry['kind']
  if (kind !== 'triangle-rgb' && kind !== 'baked-atlas') throw new TypeError('unsupported voxel raw profile')
  const allowed = kind === 'triangle-rgb' ? ['kind', 'positions', 'triangleRgb'] : ['kind', 'positions', 'uvs', 'atlas', 'sampler', 'alphaPolicy']
  if (Object.keys(geometry).some(key => !allowed.includes(key))) throw new TypeError('mixed or unsupported voxel profile fields')
  const positionInfo = voxelArrayView(geometry['positions'], 'float32')
  if (!positionInfo.length || positionInfo.length % 9) throw new TypeError('voxel positions require complete triangles')
  const triangles = boundedCount(positionInfo.length / 9, limits.maxTriangles, 'voxel triangle budget')
  const account = voxelBufferAccount(limits.maxAccountedBytes)
  let inputBytes = positionInfo.byteLength
  let rgbInfo: ReturnType<typeof voxelArrayView> | undefined
  let uvInfo: ReturnType<typeof voxelArrayView> | undefined
  let pixelInfo: ReturnType<typeof voxelArrayView> | undefined
  let width = 0, height = 0
  const alphaPolicy = geometry['alphaPolicy'] === undefined ? 'refuse' : geometry['alphaPolicy']
  if (kind === 'triangle-rgb') {
    rgbInfo = voxelArrayView(geometry['triangleRgb'], 'float32')
    if (rgbInfo.length !== checkedProduct(triangles, 3, 'triangle RGB')) throw new TypeError('triangle RGB count mismatch')
    inputBytes += rgbInfo.byteLength
  } else {
    if (geometry['sampler'] !== 'repeat' || !['refuse', 'discard-explicitly'].includes(alphaPolicy as string))
      throw new TypeError('only REPEAT atlas and explicit alpha policies are supported')
    const atlas = dataRecord(geometry['atlas'], ['width', 'height', 'rgba'], 'voxel atlas')
    if (typeof atlas['width'] !== 'number' || typeof atlas['height'] !== 'number') throw new TypeError('invalid atlas size')
    width = boundedCount(atlas['width'], limits.maxTextureAxis, 'atlas width')
    height = boundedCount(atlas['height'], limits.maxTextureAxis, 'atlas height')
    if (!width || !height) throw new RangeError('empty voxel atlas')
    const pixels = boundedCount(checkedProduct(width, height, 'atlas pixels'), limits.maxPixels, 'atlas pixel budget')
    pixelInfo = voxelArrayView(atlas['rgba'], 'uint8')
    if (pixelInfo.length !== checkedProduct(pixels, 4, 'atlas bytes')) throw new TypeError('atlas pixel count mismatch')
    uvInfo = voxelArrayView(geometry['uvs'], 'float32')
    if (uvInfo.length !== checkedProduct(triangles, 6, 'atlas UV')) throw new TypeError('atlas UV count mismatch')
    inputBytes += pixelInfo.byteLength + uvInfo.byteLength
  }
  boundedCount(inputBytes, limits.maxInputBytes, 'voxel input byte budget')
  account.reserve(inputBytes, false) // Borrowed caller inputs coexist with each owned copy.
  /** Charge exactly the typed buffer about to be allocated; no species/caller slice is invoked. */
  function floats(info: ReturnType<typeof voxelArrayView>): Float32Array {
    signal?.throwIfAborted(); account.reserve(info.byteLength)
    const copy = new Float32Array(info.length)
    copy.set(new Float32Array(info.buffer, info.byteOffset, info.length))
    return copy
  }
  const positions = floats(positionInfo)
  const transform = voxelGridTransform(positions, resolution, signal)
  for (let i = 0; i < positions.length; i += 9) {
    if ((i % 9216) === 0) signal?.throwIfAborted()
    const ax = positions[i + 3]! - positions[i]!, ay = positions[i + 4]! - positions[i + 1]!, az = positions[i + 5]! - positions[i + 2]!
    const bx = positions[i + 6]! - positions[i]!, by = positions[i + 7]! - positions[i + 1]!, bz = positions[i + 8]! - positions[i + 2]!
    if (!(Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) > 0))
      throw new RangeError('collinear or collapsed voxel triangle')
  }
  let ownedGeometry: VoxelBackendGeometry
  const losses: 'texture-alpha-discarded'[] = []
  if (kind === 'triangle-rgb') {
    const triangleRgb = floats(rgbInfo!)
    for (let i = 0; i < triangleRgb.length; i++) {
      if ((i & 1023) === 0) signal?.throwIfAborted()
      if (!Number.isFinite(triangleRgb[i]) || triangleRgb[i]! < 0 || triangleRgb[i]! > 1) throw new RangeError('invalid triangle RGB')
    }
    ownedGeometry = Object.freeze({ kind, positions, triangleRgb })
  } else {
    const uvs = floats(uvInfo!)
    for (let i = 0; i < uvs.length; i++) {
      if ((i & 1023) === 0) signal?.throwIfAborted()
      if (!Number.isFinite(uvs[i])) throw new RangeError('nonfinite voxel UV')
    }
    signal?.throwIfAborted(); account.reserve(pixelInfo!.byteLength)
    const rgba = new Uint8Array(pixelInfo!.length)
    rgba.set(new Uint8Array(pixelInfo!.buffer, pixelInfo!.byteOffset, pixelInfo!.length))
    let discarded = false
    for (let i = 3; i < rgba.length; i += 4) {
      if ((i & 4095) === 3) signal?.throwIfAborted()
      if (rgba[i] !== 255) {
        if (alphaPolicy !== 'discard-explicitly') throw new TypeError('nonopaque atlas alpha refused')
        discarded = true
      }
    }
    if (discarded) losses.push('texture-alpha-discarded')
    ownedGeometry = Object.freeze({ kind, positions, uvs, atlas: Object.freeze({ width, height, rgba }), sampler: 'repeat', alphaPolicy: alphaPolicy as 'refuse' | 'discard-explicitly' })
  }
  signal?.throwIfAborted()
  return Object.freeze({ request: Object.freeze({ geometry: ownedGeometry, resolution }), transform,
    losses: Object.freeze(losses), inputBytes, triangles, allocation: account.snapshot() })
}
