/**
 * Granny v6 LE32 container and shared self-describing object reader. Packed LE64 variants require
 * explicit root offsets/profile; native carriers and roots remain with their format owner.
 * CRC, declared file/section sizes, relocation destinations, type widths, arrays, graph depth and
 * expanded bytes are checked before publication. GR2 supports stored and Oodle1 sections; Oodle0,
 * mixed marshalling and other GR2 endianness/pointer widths refuse explicitly, as do unknown types.
 * Explicit ordered variant fields retain duplicate native names; legacy record views stay strict.
 * Facts: Granny file's own type library and header; references recorded in NOTICE.granny.md.
 */
import { boundedCount } from '../binary.js'
import { crc32 } from '../checksum/index.js'
import { decompressOodle1 } from '../compression/oodle1.js'
import { multiplyAffine, normalizeQuat } from '../model-math/transform.js'
import { composeTrsMatrix } from '../model-math/sequence-pose.js'
export { unpackGrannyCurve, type GrannyCurveDomain, type GrannyExpandedCurve } from './granny-curve-codec.js'

export type GrannyValue = number | string | null | GrannyValue[] | { [key: string]: GrannyValue }
export type GrannyReadonlyValue = number | string | null | readonly GrannyReadonlyValue[] | { readonly [key: string]: GrannyReadonlyValue }
/** Native order and duplicate names survive in the explicit field view, including nested structs.
 * Transform member kind9 keeps its existing semantic component record, rather than fake fields.
 */
export type GrannyOrderedValue = number | string | null | readonly GrannyOrderedValue[] | GrannyTransform | GrannyOrderedStruct
export interface GrannyOrderedStruct {
  readonly kind: 'struct'
  readonly members: readonly { readonly name: string; readonly value: GrannyOrderedValue }[]
}
export interface GrannyLimits { readonly maxBytes: number; readonly maxNodes: number; readonly maxDepth: number; /** Cumulative decoded UTF-8 bytes, at most maxBytes; omitted uses maxBytes. */ readonly maxTextBytes?: number }
export interface GrannyCurve { readonly degree: number; readonly knots: readonly number[]; readonly controls: readonly number[]; readonly dimension: number }
export type GrannyTransform = { readonly flags: number; readonly position: readonly number[]; readonly orientation: readonly number[]; readonly scaleShear: readonly number[] }
/** Dependency-neutral TRS projection; native presence bits select defaults before validation.
 * Shear tolerance is an explicit caller policy, never an implicit lossless conversion claim.
 */
export interface GrannyTransformProjection {
  readonly trs: {
    readonly translation: [number, number, number]
    readonly rotation: [number, number, number, number]
    readonly scale: [number, number, number]
  }
  /** Greatest absolute off-diagonal coefficient discarded by this projection. */
  readonly discardedShear: number
  readonly normalizedRotation: boolean
  /** The shared quaternion kernel preserves zero; a carrier must decide whether to refuse it. */
  readonly zeroRotation: boolean
}
export interface GrannyTransformMatrixProjection {
  /** Column-major T·R·transpose(native scaleShear); no off-diagonal coefficient is discarded. */
  readonly matrix: readonly number[]
  readonly normalizedRotation: boolean
  readonly zeroRotation: boolean
}

/** Project a native transform using the existing quaternion kernel and explicit shear admission.
 * Returns owned component arrays. Disabled fields are not inspected; enabled fields must be dense,
 * finite and exact-width. Negative/zero scales and quaternion sign are preserved.
 */
export function projectGrannyTransform(value: GrannyReadonlyValue | GrannyTransform | undefined,
  maxAbsShear: number): GrannyTransformProjection {
  if (!Number.isFinite(maxAbsShear) || maxAbsShear < 0) throw new RangeError('Granny shear tolerance')
  const components = grannyTransformComponents(value), s = components.scaleShear
  const discardedShear = Math.max(...[1, 2, 3, 5, 6, 7].map(i => Math.abs(s[i]!)))
  if (discardedShear > maxAbsShear) throw new TypeError('Granny rest shear cannot be projected to TRS')
  return {
    trs: { translation: components.translation as [number, number, number], rotation: components.rotation, scale: [s[0]!, s[4]!, s[8]!] },
    discardedShear, normalizedRotation: components.normalizedRotation, zeroRotation: components.zeroRotation,
  }
}

/** Preserve native full scale/shear through existing composition/product kernels.
 * Granny row-vector S·R·T becomes column-vector T·R·Sᵀ. Quaternion normalization follows the
 * existing TRS projector; zero quaternion remains reported for the native caller to refuse.
 * T·R uses the existing float32 composition; the affine product must remain finite.
 */
export function projectGrannyTransformMatrix(value: GrannyReadonlyValue | GrannyTransform | undefined): GrannyTransformMatrixProjection {
  const components = grannyTransformComponents(value), s = components.scaleShear
  const tr = new Float32Array(16)
  composeTrsMatrix(tr, 0, components.translation, components.rotation, [1, 1, 1])
  if (!tr.every(Number.isFinite)) throw new RangeError('Granny transform exceeds finite float range')
  const matrix = multiplyAffine(Array.from(tr), [
    s[0]!, s[1]!, s[2]!, 0,
    s[3]!, s[4]!, s[5]!, 0,
    s[6]!, s[7]!, s[8]!, 0,
    0, 0, 0, 1,
  ])
  if (!matrix.every(Number.isFinite)) throw new RangeError('Granny matrix projection is nonfinite')
  return { matrix, normalizedRotation: components.normalizedRotation, zeroRotation: components.zeroRotation }
}

/** One component/presence/normalization owner for both native TRS and full-matrix projections. */
function grannyTransformComponents(value: GrannyReadonlyValue | GrannyTransform | undefined) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Granny expected transform structure')
  const transform = value as { readonly [key: string]: unknown }, flags = transform['flags']
  if (typeof flags !== 'number' || !Number.isFinite(flags)) throw new TypeError('Granny expected finite transform flags')
  /** Validate each indexed component explicitly, including holes in otherwise valid arrays. */
  function vector(field: string, width: number): number[] {
    const values = transform[field]
    if (!Array.isArray(values) || values.length !== width) throw new TypeError('Granny transform vector width')
    return Array.from({ length: width }, (_, i) => {
      const component: unknown = values[i]
      if (typeof component !== 'number' || !Number.isFinite(component)) throw new TypeError('Granny expected finite transform component')
      return component
    })
  }
  const p = flags & 1 ? vector('position', 3) : [0, 0, 0]
  const q = flags & 2 ? vector('orientation', 4) : [0, 0, 0, 1]
  const s = flags & 4 ? vector('scaleShear', 9) : [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const rotation = normalizeQuat(q)
  return {
    translation: p, rotation, scaleShear: s,
    normalizedRotation: rotation.some((v, i) => v !== q[i]),
    zeroRotation: rotation.every(v => v === 0),
  }
}
/** Explicit packed-LE64 field access; native root offsets and admission stay with the carrier owner.
 * One owned input/limits snapshot, shared graph caches and cumulative node/materialized ceilings.
 * Input and materialized output each have the maxBytes ceiling, as with the standalone readers.
 * maxTextBytes counts actual UTF-8 decodes, including schema labels and nested values; cached
 * schema/object reads retain their strings without charging again. Repeated direct decodes charge.
 * Session views are frozen, retain identity and must not be edited. Any failed read closes the session.
 */
export interface GrannyPackedReader {
  /** Already charged materialization/node counters, excluding the separately bounded input.
   * A frozen snapshot; reading usage never spends budget or reopens a failed session. */
  usage(): Readonly<{ bytes: number; nodes: number }>
  pointer(offset: number): number | null
  string(pointerOffset: number): string | null
  array(countOffset: number, pointerOffset: number, stride: number): readonly number[]
  floats(offset: number, count: number): readonly number[]
  transform(offset: number): GrannyTransform
  variant(typeOffset: number, dataOffset: number): GrannyReadonlyValue
  /** Ordered nested structures permit duplicate names; strict variant() keeps its record contract. */
  variantFields(typeOffset: number, dataOffset: number): GrannyOrderedValue
}
type Pointer = readonly [number, number]
interface Section { bytes: Uint8Array; view: DataView; pointers: Map<number, Pointer> }
interface Member { kind: number; name: string; type: Pointer | null; width: number; offset: number; size: number }
const MAGIC = [0xb8, 0x67, 0xb0, 0xca, 0xf8, 0x6d, 0xb1, 0x0f, 0x84, 0x72, 0x8c, 0x7e, 0x5e, 0x19, 0, 0x1e]
const SIZES: Readonly<Record<number, number>> = { 2: 4, 3: 8, 4: 8, 5: 8, 7: 12, 8: 4, 9: 68,
  10: 4, 11: 1, 12: 1, 13: 1, 14: 1, 15: 2, 16: 2, 17: 2, 18: 2, 19: 4, 20: 4, 21: 2, 22: 4 }

/** Decode one bounded native file, resolving only its attested relocation graph. */
export function readGranny(input: Uint8Array, limits: GrannyLimits, signal?: AbortSignal): GrannyValue {
  signal?.throwIfAborted()
  if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 0 || !Number.isSafeInteger(limits.maxNodes) ||
    limits.maxNodes < 1 || !Number.isSafeInteger(limits.maxDepth) || limits.maxDepth < 1 ||
    input.length > limits.maxBytes || input.length < 88 || !MAGIC.every((v, i) => input[i] === v))
    throw new RangeError('Granny input/limits/magic')
  const file = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const u32 = (at: number) => file.getUint32(at, true)
  const range = (at: number, size: number) => {
    if (!Number.isSafeInteger(at) || !Number.isSafeInteger(size) || at < 0 || size < 0 || at + size > input.length)
      throw new RangeError('Granny file range')
  }
  const count = u32(48), table = 32 + u32(44)
  if (u32(32) !== 6 || u32(36) !== input.length || count > 64 || table !== 88 || u32(16) !== 88 + 44 * count)
    throw new TypeError('Unsupported Granny header')
  range(table, count * 44)
  if (crc32(input.subarray(88)) !== u32(40)) throw new TypeError('Granny CRC mismatch')
  const sections: Section[] = []
  let expanded = 0, nodes = 0, materialized = 0
  const charge = (bytes: number) => { materialized += bytes; if (materialized > limits.maxBytes) throw new RangeError('Granny materialized payload budget') }
  const consume = () => { signal?.throwIfAborted(); if (++nodes > limits.maxNodes) throw new RangeError('Granny node budget') }
  for (let i = 0; i < count; i++) {
    consume()
    const at = table + i * 44, compression = u32(at), offset = u32(at + 4), stored = u32(at + 8), size = u32(at + 12)
    const stop0 = u32(at + 20), stop1 = u32(at + 24), reloc = u32(at + 28), relocs = u32(at + 32)
    if (u32(at + 40) !== 0) throw new TypeError('Granny mixed marshalling unsupported')
    expanded += size
    if (expanded > limits.maxBytes || stop0 > stop1 || stop1 > size || relocs > limits.maxNodes - nodes)
      throw new RangeError('Granny expansion/relocation budget')
    range(offset, stored); range(reloc, relocs * 12)
    let bytes: Uint8Array
    if (size === 0 && stored === 0 && (compression === 0 || compression === 2)) bytes = new Uint8Array()
    else if (compression === 0) {
      if (stored !== size) throw new TypeError('Granny stored size mismatch')
      bytes = input.slice(offset, offset + stored)
    } else if (compression === 2) bytes = decompressOodle1(input.subarray(offset, offset + stored), size, stop0, stop1, limits.maxBytes, signal)
    else throw new TypeError(`Unsupported Granny compression ${compression}`)
    const pointers = new Map<number, Pointer>()
    for (let n = 0; n < relocs; n++) {
      consume()
      const r = reloc + n * 12, field = u32(r)
      if (field + 4 > size || pointers.has(field)) throw new TypeError('Granny invalid/duplicate relocation')
      pointers.set(field, [u32(r + 4), u32(r + 8)])
    }
    sections.push({ bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), pointers })
  }
  return createGrannyObjectReader(sections, limits, 'relocated-le32', consume, charge, () => limits.maxNodes - nodes).object([u32(52), u32(56)], [u32(60), u32(64)], 0)
}

/** Self-describing variant with packed 64-bit offsets; this is not a GR2 container reader.
 * Explicit profile: little endian, 44-byte type members, no alignment padding, zero null pointers.
 * The caller owns native carrier/root admission. Other layouts and null sentinels are refused.
 */
export function readGrannyVariant(input: Uint8Array, typeOffset: number, dataOffset: number,
  profile: 'packed-le64', limits: GrannyLimits, signal?: AbortSignal): GrannyValue {
  return createPackedReader(input, profile, limits, signal, false).variant(typeOffset, dataOffset)
}

/** Read untyped native roots and embedded variants through the same Granny primitive engine.
 * The snapshot prevents cached variants from mixing revisions after the factory returns.
 */
export function createGrannyPackedReader(input: Uint8Array, profile: 'packed-le64',
  limits: GrannyLimits, signal?: AbortSignal): GrannyPackedReader {
  return createPackedReader(input, profile, limits, signal, true)
}

/** Preserve mutable standalone results while protecting persistent public-session views. */
function createPackedReader(input: Uint8Array, profile: 'packed-le64', limits: GrannyLimits,
  signal: AbortSignal | undefined, immutable: boolean) {
  limits = { maxBytes: limits.maxBytes, maxNodes: limits.maxNodes, maxDepth: limits.maxDepth,
    maxTextBytes: limits.maxTextBytes === undefined ? limits.maxBytes : limits.maxTextBytes }
  signal?.throwIfAborted()
  if (profile !== 'packed-le64' || !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 0 ||
    !Number.isSafeInteger(limits.maxNodes) || limits.maxNodes < 1 ||
    !Number.isSafeInteger(limits.maxDepth) || limits.maxDepth < 1 || input.length > limits.maxBytes)
    throw new RangeError('Granny variant profile/input/limits')
  input = new Uint8Array(input)
  let nodes = 0, materialized = 0
  const consume = () => { signal?.throwIfAborted(); if (++nodes > limits.maxNodes) throw new RangeError('Granny node budget') }
  const charge = (bytes: number) => { materialized += bytes; if (materialized > limits.maxBytes) throw new RangeError('Granny materialized payload budget') }
  const section: Section = { bytes: input, view: new DataView(input.buffer, input.byteOffset, input.byteLength), pointers: new Map() }
  const graph = createGrannyObjectReader([section], limits, profile, consume, charge, () => limits.maxNodes - nodes, immutable)
  let closed = false
  /** Failed schema/object parsing cannot leave reusable partial caches in a persistent session. */
  function guarded<T>(operation: () => T): T {
    try {
      signal?.throwIfAborted()
      if (closed) throw new TypeError('Granny packed session closed after failed read')
      return operation()
    } catch (error) { closed = true; throw error }
  }
  /** Admit public byte offsets before passing them to the section-local engine. */
  const slot = (offset: number): Pointer => [0, boundedCount(offset, input.length, 'Granny packed field')]
  return {
    /** Downstream format stages share these counters instead of starting another full budget. */
    usage() { return guarded(() => Object.freeze({ bytes: materialized, nodes })) },
    /** Native zero remains null; every other encoded pointer is range checked. */
    pointer(offset: number) { return guarded(() => { consume(); charge(8); return graph.pointer(slot(offset))?.[1] ?? null }) },
    /** Preserve null versus empty UTF-8 strings while sharing native string admission. */
    string(offset: number) { return guarded(() => { consume(); charge(8); const p = graph.pointer(slot(offset)); return p ? graph.string(p) : null }) },
    /** Contiguous record slots; the carrier supplies its attested native stride. */
    array(countOffset: number, pointerOffset: number, stride: number) { return guarded(() => {
      consume(); charge(16)
      boundedCount(stride, limits.maxBytes, 'Granny packed stride')
      if (stride === 0) throw new RangeError('Granny packed zero stride')
      const length = graph.word(slot(countOffset)), dest = graph.pointer(slot(pointerOffset))
      if (length > limits.maxNodes - nodes) throw new RangeError('Granny array node budget')
      graph.arrayBounds(length, dest, stride)
      return Object.freeze(Array.from({ length }, (_, i) => { consume(); return dest![1] + i * stride }))
    }) },
    /** Charge direct finite-float output before allocating its array. */
    floats(offset: number, count: number) { return guarded(() => {
      boundedCount(count, limits.maxNodes - nodes - 1, 'Granny packed float count')
      consume(); charge(16 + count * 8)
      const result = graph.floats(slot(offset), count)
      for (let i = 0; i < count; i++) consume()
      return result
    }) },
    /** The same 68-byte flags/position/orientation/scale-shear decoder as typed members. */
    transform(offset: number) { return guarded(() => { consume(); charge(16 + 17 * 8 + 3 * 8); return graph.transform(slot(offset)) }) },
    /** All roots share caches, cycle checks and the remaining cumulative budget. */
    variant(typeOffset: number, dataOffset: number) { return guarded(() => graph.object(slot(typeOffset), slot(dataOffset), 0)) },
    /** Same schema/value engine and cumulative budgets, with an explicit duplicate-preserving view. */
    variantFields(typeOffset: number, dataOffset: number) {
      return guarded(() => graph.object(slot(typeOffset), slot(dataOffset), 0, 'fields') as unknown as GrannyOrderedValue)
    },
  }
}

/** One type/object engine for relocated LE32 containers and explicitly admitted packed variants.
 * Container node/materialized counters are passed through, retaining relocation charges.
 */
function createGrannyObjectReader(sections: Section[],
  limits: GrannyLimits, layout: 'relocated-le32' | 'packed-le64', consume: () => void,
  charge: (bytes: number) => void, remainingNodes: () => number, immutable = false) {
  /** Seal values at their existing construction points; standalone readers retain mutable outputs. */
  function seal<T extends object>(value: T): T { if (immutable) Object.freeze(value); return value }
  const maxTextBytes = boundedCount(limits.maxTextBytes === undefined ? limits.maxBytes : limits.maxTextBytes, limits.maxBytes, 'Granny text budget')
  let textBytes = 0
  const pointerBytes = layout === 'packed-le64' ? 8 : 4
  const memberStride = layout === 'packed-le64' ? 44 : 32
  /** Resolve a section-local pointer only after checking its entire requested extent. */
  function location(p: Pointer, size: number): Section {
    const section = sections[p[0]]
    if (!section || !Number.isSafeInteger(size) || size < 0 || p[1] < 0 || p[1] + size > section.bytes.length)
      throw new RangeError('Granny section range')
    return section
  }
  for (const section of sections) for (const p of section.pointers.values()) location(p, 0)
  const add = (p: Pointer, offset: number): Pointer => [p[0], p[1] + offset]
  const word = (p: Pointer) => location(p, 4).view.getUint32(p[1], true)
  const pointer = (p: Pointer): Pointer | null => {
    const section = location(p, pointerBytes)
    if (layout === 'relocated-le32') return section.pointers.get(p[1]) ?? null
    const encoded = section.view.getBigUint64(p[1], true)
    if (encoded === 0n) return null
    return [p[0], boundedCount(Number(encoded), section.bytes.length, 'Granny packed pointer')]
  }
  /** Native strings are NUL terminated within their own section and the caller scalar ceiling. */
  function string(p: Pointer | null): string {
    if (!p) return ''
    const section = location(p, 1)
    // Bound scanning and decoding by the remaining native-text budget, including one terminator.
    const tail = section.bytes.subarray(p[1], p[1] + (maxTextBytes - textBytes) + 1)
    const length = tail.indexOf(0)
    if (length < 0) throw new RangeError('Granny unterminated string or text budget')
    textBytes += length
    charge(length * 2)
    return new TextDecoder('utf-8', { fatal: true }).decode(tail.subarray(0, length))
  }
  const types = new Map<string, { members: Member[]; size: number; building: boolean }>()
  const recordTypes = new Set<string>()
  /** Strict admission applies even to cached schemas and parsed zero/all-null element arrays. */
  function recordType(key: string, schema: { members: Member[]; building: boolean }, depth: number): void {
    if (schema.building || recordTypes.has(key)) return
    if (new Set(schema.members.map(m => m.name)).size !== schema.members.length)
      throw new TypeError('Unsupported Granny duplicate member name in record view')
    for (const member of schema.members)
      if (member.kind === 1) type(member.type!, depth + 1, 'record')
    recordTypes.add(key)
  }
  /** Read the embedded schema once, permitting reference recursion but refusing recursive inline layout. */
  function type(p: Pointer, depth: number, view: 'record' | 'fields'): { members: Member[]; size: number; building: boolean } {
    if (depth > limits.maxDepth) throw new RangeError('Granny type depth')
    const key = p.join(':'), prior = types.get(key)
    if (prior) { if (view === 'record') recordType(key, prior, depth); return prior }
    const result = { members: [] as Member[], size: 0, building: true }; types.set(key, result)
    for (let at = p[1]; ; at += memberStride) {
      consume(); const member: Pointer = [p[0], at], kind = word(member)
      if (kind === 0) break
      location(member, memberStride)
      const name = string(pointer(add(member, 4))), element = pointer(add(member, 4 + pointerBytes)), width = word(add(member, 4 + pointerBytes * 2)) || 1
      if (!name || width > limits.maxNodes || kind === 6 || !(kind === 1 || kind in SIZES))
        throw new TypeError('Unsupported Granny member/type width')
      let size = layout === 'packed-le64' && [2, 8, 22].includes(kind) ? 8
        : layout === 'packed-le64' && [3, 4].includes(kind) ? 12
        : layout === 'packed-le64' && kind === 5 ? 16
        : layout === 'packed-le64' && kind === 7 ? 20 : SIZES[kind]!
      if (kind === 1) {
        if (!element) throw new TypeError('Granny inline without type')
        const nested = type(element, depth + 1, view)
        if (nested.building) throw new TypeError('Granny recursive inline type')
        size = nested.size
      }
      size *= width
      if (result.size + size > limits.maxBytes) throw new RangeError('Granny type size budget')
      result.members.push({ kind, name, type: element, width, offset: result.size, size })
      result.size += size
    }
    result.building = false
    if (view === 'record') recordType(key, result, depth)
    return result
  }
  const active = new Set<string>()
  const objects = new Map<string, GrannyValue>()
  /** Materialize a bounded acyclic object view; recursive extended-data cycles are refused. */
  function object(tp: Pointer, p: Pointer, depth: number, view: 'record' | 'fields' = 'record'): GrannyValue {
    consume(); if (depth > limits.maxDepth) throw new RangeError('Granny object depth')
    const schema = type(tp, depth, view), key = `${view}/${tp.join(':')}/${p.join(':')}`
    location(p, schema.size)
    if (active.has(key)) throw new TypeError('Granny cyclic object graph')
    const previous = objects.get(key)
    if (previous !== undefined) return previous
    charge(16)
    active.add(key)
    const result: Record<string, GrannyValue> = Object.create(null)
    const members: GrannyValue[] | undefined = view === 'fields' ? [] : undefined
    try {
      for (const m of schema.members) {
        const values: GrannyValue[] = []
        for (let n = 0; n < m.width; n++) values.push(value(m, add(p, m.offset + n * m.size / m.width), depth + 1, view))
        const decoded = m.width === 1 ? values[0]! : seal(values)
        if (members) {
          consume(); charge(16)
          members.push(seal({ name: m.name, value: decoded }))
        } else result[m.name] = decoded
      }
      if (members) { result['kind'] = 'struct'; result['members'] = seal(members) }
      seal(result)
      objects.set(key, result)
      return result
    } finally { active.delete(key) }
  }
  /** Decode member kinds with the admitted layout's widths and pointer authority. */
  function value(m: Member, p: Pointer, depth: number, viewMode: 'record' | 'fields'): GrannyValue {
    consume()
    charge(8)
    const section = location(p, m.size / m.width), view = section.view, at = p[1]
    if (m.kind === 1) return object(m.type!, p, depth, viewMode)
    if (m.kind === 8) return string(pointer(p))
    if (m.kind === 2 || m.kind === 22) { const dest = pointer(p); return dest && m.type ? object(m.type, dest, depth, viewMode) : null }
    if (m.kind === 5) { const tp = pointer(p), dest = pointer(add(p, pointerBytes)); return tp && dest ? object(tp, dest, depth, viewMode) : null }
    if (m.kind === 3 || m.kind === 4 || m.kind === 7) {
      const variant = m.kind === 7, tp = variant ? pointer(p) : m.type
      const length = word(add(p, variant ? pointerBytes : 0)), dest = pointer(add(p, variant ? pointerBytes + 4 : 4))
      if (length > remainingNodes()) throw new RangeError('Granny array node budget')
      if (length && (!dest || !tp)) throw new RangeError('Granny array pointer is absent')
      if (!dest || !tp) return seal([])
      const elementType = type(tp, depth, viewMode)
      const size = m.kind === 4 ? pointerBytes : elementType.size
      arrayBounds(length, dest, size)
      // Granny's Real32 array element type is a one-scalar wrapper, not a semantic object.
      const scalar = elementType.members.length === 1 ? elementType.members[0] : undefined
      if (m.kind !== 4 && scalar?.kind === 10 && scalar.width === 1 && scalar.name === 'Real32')
        return seal(Array.from({ length }, (_, i) => value(scalar, add(dest, i * size), depth, viewMode)))
      return seal(Array.from({ length }, (_, i) => {
        const slot = add(dest, i * size), target = m.kind === 4 ? pointer(slot) : slot
        return target ? object(tp, target, depth, viewMode) : null
      }))
    }
    if (m.kind === 9) return transform(p)
    if (m.kind === 10) { const f = view.getFloat32(at, true); if (!Number.isFinite(f)) throw new TypeError('Granny nonfinite float'); return f }
    if ([11, 13].includes(m.kind)) return view.getInt8(at)
    if ([12, 14].includes(m.kind)) return view.getUint8(at)
    if ([15, 17].includes(m.kind)) return view.getInt16(at, true)
    if ([16, 18].includes(m.kind)) return view.getUint16(at, true)
    if (m.kind === 19) return view.getInt32(at, true)
    if (m.kind === 20) return word(p)
    throw new TypeError(`Unsupported Granny scalar ${m.kind}`)
  }
  /** Transform floats use the same finite-value gate as ordinary Real32 members. */
  function floats(p: Pointer, length: number): number[] {
    const section = location(p, length * 4)
    return seal(Array.from({ length }, (_, i) => {
      const f = section.view.getFloat32(p[1] + i * 4, true)
      if (!Number.isFinite(f)) throw new TypeError('Granny nonfinite transform')
      return f
    }))
  }
  /** One extent/count/output gate for typed arrays and explicit native record slots. */
  function arrayBounds(length: number, dest: Pointer | null, size: number): void {
    if (length && !dest) throw new RangeError('Granny array pointer is absent')
    if (dest) location(dest, length * size)
    charge(length * 8)
  }
  /** Native transform semantics are shared with direct untyped-root reads. */
  function transform(p: Pointer) {
    location(p, 68)
    return seal({ flags: word(p), position: floats(add(p, 4), 3), orientation: floats(add(p, 16), 4), scaleShear: floats(add(p, 32), 9) })
  }
  return { object, pointer, string, word, floats, transform, arrayBounds }
}

/**
 * Evaluate the legacy explicit-knot Granny curve. Degree 0/1 are exact; degree 2/3 use
 * clamped de Boor interpolation. Engine agreement for higher-degree curves must be separately
 * qualified by the caller; this helper does not label a sampled projection lossless.
 */
export function sampleGrannyCurve(curve: GrannyCurve, time: number): number[] {
  const { degree, knots, controls, dimension } = curve, count = knots.length
  if (![0, 1, 2, 3].includes(degree) || !Number.isFinite(time) || dimension < 1 || dimension > 16 ||
    !Number.isInteger(dimension) || controls.length !== count * dimension || count < 1 ||
    knots.some((v, i) => !Number.isFinite(v) || (i > 0 && v < knots[i - 1]!)) || !controls.every(Number.isFinite))
    throw new TypeError('Invalid Granny curve')
  const point = (index: number) => controls.slice(Math.max(0, Math.min(count - 1, index)) * dimension,
    (Math.max(0, Math.min(count - 1, index)) + 1) * dimension)
  if (count === 1 || time <= knots[0]!) return [...point(0)]
  if (time >= knots[count - 1]!) return [...point(count - 1)]
  let high = 1
  while (high < count && knots[high]! <= time) high++
  if (degree === 0) return [...point(high - 1)]
  if (degree === 1) {
    const t = (time - knots[high - 1]!) / (knots[high]! - knots[high - 1]!)
    return point(high - 1).map((v, axis) => v + (point(high)[axis]! - v) * t)
  }
  const knot = (index: number) => knots[Math.max(0, Math.min(count - 1, index))]!
  const span = high - 1, p = Math.min(degree, count - 1)
  const d = Array.from({ length: p + 1 }, (_, j) => [...point(span - p + 1 + j)])
  for (let r = 1; r <= p; r++) for (let j = p; j >= r; j--) {
    const index = span - p + 1 + j, lower = knot(index - 1), upper = knot(index + p - r)
    const alpha = upper === lower ? 0 : Math.max(0, Math.min(1, (time - lower) / (upper - lower)))
    for (let axis = 0; axis < dimension; axis++) d[j]![axis] = (1 - alpha) * d[j - 1]![axis]! + alpha * d[j]![axis]!
  }
  return d[p]!
}
