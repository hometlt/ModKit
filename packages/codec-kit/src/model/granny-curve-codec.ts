/** Granny encoded controls/knots, without native carrier, rig or sampling policy.
 * Adapted from Norbyte/lslib 6f5f6987d10d8485876b8368431c948e4dea4f83, MIT.
 * Full notice: ../../LICENSE.lslib. This expands control points, not evaluated keyframes.
 */
import { boundedCount } from '../binary.js'
import type { GrannyCurve, GrannyLimits, GrannyReadonlyValue } from './granny.js'

export interface GrannyCurveDomain {
  readonly kind: 'vector' | 'quaternion' | 'matrix3'
  /** Required for vectors (1..16); quaternion/matrix dimensions are fixed by the domain. */
  readonly dimension?: number
}
export interface GrannyExpandedCurve extends GrannyCurve {
  readonly format: number
  readonly knotDomain: 'native-knots' | 'sample-index'
}

const NAMES = [
  'DaKeyframes32f',
  'DaK32fC32f',
  'DaIdentity',
  'DaConstant32f',
  'D3Constant32f',
  'D4Constant32f',
  'DaK16uC16u',
  'DaK8uC8u',
  'D4nK16uC15u',
  'D4nK8uC7u',
  'D3K16uC16u',
  'D3K8uC8u',
  'D9I1K16uC16u',
  'D9I3K16uC16u',
  'D9I1K8uC8u',
  'D9I3K8uC8u',
  'D3I1K32fC32f',
  'D3I1K16uC16u',
  'D3I1K8uC8u',
] as const
const QUAT_SCALES = [
  1.4142135, 0.70710677, 0.35355338, 0.35355338, 0.35355338, 0.17677669, 0.17677669, 0.17677669,
  -1.4142135, -0.70710677, -0.35355338, -0.35355338, -0.35355338, -0.17677669, -0.17677669,
  -0.17677669,
].map(Math.fround)
const QUAT_OFFSETS = [
  -0.70710677, -0.35355338, -0.53033006, -0.17677669, 0.17677669, -0.17677669, -0.088388346, 0,
  0.70710677, 0.35355338, 0.53033006, 0.17677669, -0.17677669, 0.17677669, 0.088388346, -0,
].map(Math.fround)

/** Decode native representation only. Degree 2/3 evaluation needs a separately qualified sampler.
 * D9I1 (12/14) is outside this profile; the source marks format 14 reconstruction uncertain.
 * Sample-index knots require native time mapping before a time-based sampler is used.
 */
export function unpackGrannyCurve(
  input: GrannyReadonlyValue,
  domain: GrannyCurveDomain,
  limits: Pick<GrannyLimits, 'maxBytes' | 'maxNodes'>,
  signal?: AbortSignal,
): GrannyExpandedCurve {
  signal?.throwIfAborted()
  boundedCount(limits.maxBytes, Number.MAX_SAFE_INTEGER, 'Granny curve byte budget')
  boundedCount(limits.maxNodes, Number.MAX_SAFE_INTEGER, 'Granny curve node budget')
  let usedBytes = 0,
    usedNodes = 0
  /** Charge every decoded list/output before allocating; cancellation shares this admission point. */
  const consume = (nodes: number, bytes = 0) => {
    signal?.throwIfAborted()
    usedNodes += nodes
    usedBytes += bytes
    if (usedNodes > limits.maxNodes || usedBytes > limits.maxBytes)
      throw new RangeError('Granny expanded curve budget')
  }
  /** Admit one record without inferring a missing native field. */
  const object = (value: GrannyReadonlyValue | undefined, label: string) => {
    consume(1)
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new TypeError(`Granny ${label} object required`)
    return value as Readonly<Record<string, GrannyReadonlyValue>>
  }
  /** Preserve finite native scalars; each visit consumes the caller's node ceiling. */
  const number = (value: GrannyReadonlyValue | undefined, label: string) => {
    consume(1)
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new TypeError(`Granny ${label} finite number required`)
    return value
  }
  /** Integer fields reuse the common bounded numeric admission. */
  const word = (value: GrannyReadonlyValue | undefined, max: number, label: string) =>
    boundedCount(number(value, label), max, label)
  const root = object(input, 'curve')
  const headers = NAMES.filter(name => Object.hasOwn(root, `CurveDataHeader_${name}`))
  if (headers.length !== 1) throw new TypeError('Granny curve requires one known header')
  const header = object(root[`CurveDataHeader_${headers[0]}`], 'curve header')
  const format = word(header['Format'], 18, 'curve format')
  const degree = word(header['Degree'], 3, 'curve degree')
  if (headers[0] !== NAMES[format]) throw new TypeError('Granny curve format/header mismatch')
  if (!['vector', 'quaternion', 'matrix3'].includes(domain.kind))
    throw new TypeError('Granny curve domain')
  const dimension =
    domain.kind === 'vector'
      ? boundedCount(domain.dimension ?? 0, 16, 'curve dimension')
      : domain.kind === 'quaternion'
        ? 4
        : 9
  if (
    dimension < 1 ||
    (domain.kind !== 'vector' && domain.dimension !== undefined && domain.dimension !== dimension)
  )
    throw new TypeError('Granny curve dimension/domain mismatch')
  /** A native dimension must agree with the explicit caller domain, never select that domain. */
  const requireDimension = (value: number) => {
    if (value !== dimension) throw new TypeError('Granny native curve dimension mismatch')
  }
  /** Unwrap only the schema reader's scalar wrapper; visit holes and bound Real32 storage. */
  const list = (key: string, integerMax?: number) => {
    const raw = root[key]
    if (!Array.isArray(raw)) throw new TypeError(`Granny ${key} array required`)
    boundedCount(raw.length, limits.maxNodes, `Granny ${key} count`)
    consume(raw.length, raw.length * 8)
    return Array.from({ length: raw.length }, (_, index) => {
      let value = raw[index]
      signal?.throwIfAborted()
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const wrapper = integerMax === 255 ? 'UInt8' : integerMax === 65535 ? 'UInt16' : 'Real32'
        if (Object.keys(value).length !== 1 || !Object.hasOwn(value, wrapper))
          throw new TypeError('Granny scalar array wrapper')
        value = value[wrapper]!
      }
      const result = number(value, key)
      if (integerMax !== undefined) return boundedCount(result, integerMax, key)
      const real = Math.fround(result)
      if (!Number.isFinite(real)) throw new TypeError('Granny Real32 overflow')
      return real
    })
  }
  /** Fixed scale/offset tuples refuse missing or extra components. */
  const fixed = (key: string, size: number) => {
    const result = list(key)
    if (result.length !== size) throw new TypeError(`Granny ${key} width`)
    return result
  }
  /** This field holds the high word of binary32, not an IEEE binary16 number. */
  const truncatedScale = () => {
    const bits = word(root['OneOverKnotScaleTrunc'], 65535, 'knot scale word')
    const view = new DataView(new ArrayBuffer(4))
    view.setUint32(0, bits * 65536, true)
    return view.getFloat32(0, true)
  }
  /** Bound both arrays and their product before constructing the decoded output. */
  const output = (count: number) => {
    boundedCount(count, limits.maxNodes, 'Granny knot count')
    boundedCount(count * dimension, limits.maxNodes, 'Granny control count')
    consume(count * (dimension + 1), count * (dimension + 1) * 8)
    return {
      knots: new Array<number>(count),
      controls: new Array<number>(count * dimension).fill(0),
    }
  }
  let result: { knots: number[]; controls: number[] }
  let knotDomain: GrannyExpandedCurve['knotDomain'] = 'native-knots'
  if (format <= 5) {
    if (format === 2) {
      const nativeDimension = word(root['Dimension'], 64, 'identity dimension')
      // LSLib UpgradeToGr7 emits DaIdentity with Dimension=0; its domain supplies the identity.
      if (nativeDimension !== 0) requireDimension(nativeDimension)
      result = output(1)
      result.knots[0] = 0
      if (domain.kind === 'quaternion') result.controls[3] = 1
      else if (domain.kind === 'matrix3') for (const i of [0, 4, 8]) result.controls[i] = 1
    } else {
      const controls = list('Controls')
      if (format === 0) {
        requireDimension(word(root['Dimension'], 64, 'keyframe dimension'))
        if (controls.length % dimension) throw new TypeError('Granny keyframe extent')
        result = output(controls.length / dimension)
        for (let i = 0; i < result.knots.length; i++) result.knots[i] = i
        knotDomain = 'sample-index'
      } else if (format === 1) {
        const knots = list('Knots')
        result = output(knots.length)
        result.knots = knots
      } else {
        if (format === 4) requireDimension(3)
        if (format === 5) requireDimension(4)
        result = output(1)
        result.knots[0] = 0
      }
      if (controls.length !== result.controls.length) throw new TypeError('Granny controls extent')
      result.controls = controls
    }
  } else {
    if (format === 12 || format === 14)
      throw new TypeError('Granny D9I1 reconstruction is not qualified')
    const quat = format === 8 || format === 9
    const diagonal = format === 13 || format === 15
    const shared = format >= 16
    if (quat) {
      requireDimension(4)
      if (domain.kind !== 'quaternion')
        throw new TypeError('Granny normalized quaternion domain required')
    } else if (diagonal) {
      requireDimension(9)
      if (domain.kind !== 'matrix3') throw new TypeError('Granny diagonal matrix domain required')
    } else if (format >= 10) requireDimension(3)
    const quantMax = [7, 9, 11, 15, 18].includes(format) ? 255 : 65535
    const data = list('KnotsControls', format === 16 ? undefined : quantMax)
    const encodedDimension = quat || diagonal ? 3 : shared ? 1 : dimension
    if (data.length % (encodedDimension + 1)) throw new TypeError('Granny encoded curve extent')
    const count = data.length / (encodedDimension + 1)
    result = output(count)
    const knotScale =
      format === 16
        ? 1
        : quat
          ? Math.fround(number(root['OneOverKnotScale'], 'knot scale'))
          : truncatedScale()
    if (!(knotScale > 0) || !Number.isFinite(knotScale))
      throw new TypeError('Granny positive finite knot scale required')
    for (let i = 0; i < count; i++) {
      signal?.throwIfAborted()
      result.knots[i] = Math.fround(data[i]! / knotScale)
    }
    let scales: number[], offsets: number[]
    if (quat) {
      const selector = word(root['ScaleOffsetTableEntries'], 65535, 'quaternion table selector')
      consume(8, 64)
      scales = Array.from({ length: 4 }, (_, i) =>
        Math.fround(QUAT_SCALES[(selector >>> (i * 4)) & 15]! * Math.fround(1 / (quantMax >>> 1))),
      )
      offsets = Array.from({ length: 4 }, (_, i) => QUAT_OFFSETS[(selector >>> (i * 4)) & 15]!)
    } else if (format === 6 || format === 7) {
      const pairs = fixed('ControlScaleOffsets', dimension * 2)
      scales = pairs.slice(0, dimension)
      offsets = pairs.slice(dimension)
    } else {
      scales = fixed('ControlScales', 3)
      offsets = fixed('ControlOffsets', 3)
    }
    /** Native scalar arithmetic rounds each multiply/add to binary32. */
    const decoded = (raw: number, component: number) =>
      Math.fround(Math.fround(raw * scales[component]!) + offsets[component]!)
    for (let i = 0; i < count; i++) {
      signal?.throwIfAborted()
      const at = count + i * encodedDimension,
        target = i * dimension
      if (quat) {
        const bits = quantMax === 255 ? 8 : 16,
          high = 1 << (bits - 1),
          mask = high - 1
        const a = data[at]!,
          b = data[at + 1]!,
          c = data[at + 2]!
        const missing = ((b & high) >>> (bits - 2)) | ((c & high) >>> (bits - 1))
        const s1 = (missing + 1) & 3,
          s2 = (missing + 2) & 3,
          s3 = (missing + 3) & 3
        const x = decoded(a & mask, s1),
          y = decoded(b & mask, s2),
          z = decoded(c & mask, s3)
        const squareSum = Math.fround(
          Math.fround(Math.fround(x * x) + Math.fround(y * y)) + Math.fround(z * z),
        )
        const remaining = Math.fround(1 - squareSum)
        if (remaining < 0) throw new TypeError('Granny quantized quaternion outside unit sphere')
        result.controls[target + s1] = x
        result.controls[target + s2] = y
        result.controls[target + s3] = z
        result.controls[target + missing] = Math.fround(Math.sqrt(remaining)) * (a & high ? -1 : 1)
      } else {
        for (let component = 0; component < (diagonal ? 3 : dimension); component++) {
          const value = decoded(data[at + (shared ? 0 : component)]!, component)
          result.controls[target + (diagonal ? component * 4 : component)] = value
        }
      }
    }
  }
  if (
    result.knots.length === 0 ||
    result.knots.some((v, i) => !Number.isFinite(v) || (i > 0 && v < result.knots[i - 1]!)) ||
    result.controls.some(v => !Number.isFinite(v))
  )
    throw new TypeError('Granny invalid expanded curve values')
  return { format, degree, dimension, knotDomain, ...result }
}
