/**
 * Granny v6 LE32 container and shared self-describing object reader. Packed LE64 variants require
 * explicit root offsets/profile; native carriers and roots remain with their format owner.
 * CRC, declared file/section sizes, relocation destinations, type widths, arrays, graph depth and
 * expanded bytes are checked before publication. GR2 supports stored and Oodle1 sections; Oodle0,
 * mixed marshalling and other GR2 endianness/pointer widths refuse explicitly, as do unknown types.
 * Facts: Granny file's own type library and header; references recorded in NOTICE.granny.md.
 */
import { boundedCount } from '../binary.js'
import { crc32 } from '../checksum/index.js'
import { decompressOodle1 } from '../compression/oodle1.js'
export { unpackGrannyCurve, type GrannyCurveDomain, type GrannyExpandedCurve } from './granny-curve-codec.js'

export type GrannyValue = number | string | null | GrannyValue[] | { [key: string]: GrannyValue }
export interface GrannyLimits { readonly maxBytes: number; readonly maxNodes: number; readonly maxDepth: number }
export interface GrannyCurve { readonly degree: number; readonly knots: readonly number[]; readonly controls: readonly number[]; readonly dimension: number }
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
  return readGrannyObjectGraph(sections, [u32(52), u32(56)], [u32(60), u32(64)], limits, 'relocated-le32', consume, charge, () => limits.maxNodes - nodes)
}

/** Self-describing variant with packed 64-bit offsets; this is not a GR2 container reader.
 * Explicit profile: little endian, 44-byte type members, no alignment padding, zero null pointers.
 * The caller owns native carrier/root admission. Other layouts and null sentinels are refused.
 */
export function readGrannyVariant(input: Uint8Array, typeOffset: number, dataOffset: number,
  profile: 'packed-le64', limits: GrannyLimits, signal?: AbortSignal): GrannyValue {
  signal?.throwIfAborted()
  if (profile !== 'packed-le64' || !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 0 ||
    !Number.isSafeInteger(limits.maxNodes) || limits.maxNodes < 1 ||
    !Number.isSafeInteger(limits.maxDepth) || limits.maxDepth < 1 || input.length > limits.maxBytes)
    throw new RangeError('Granny variant profile/input/limits')
  boundedCount(typeOffset, input.length, 'Granny variant root type')
  boundedCount(dataOffset, input.length, 'Granny variant root data')
  let nodes = 0, materialized = 0
  const consume = () => { signal?.throwIfAborted(); if (++nodes > limits.maxNodes) throw new RangeError('Granny node budget') }
  const charge = (bytes: number) => { materialized += bytes; if (materialized > limits.maxBytes) throw new RangeError('Granny materialized payload budget') }
  const section: Section = { bytes: input, view: new DataView(input.buffer, input.byteOffset, input.byteLength), pointers: new Map() }
  return readGrannyObjectGraph([section], [0, typeOffset], [0, dataOffset], limits, profile, consume, charge, () => limits.maxNodes - nodes)
}

/** One type/object engine for relocated LE32 containers and explicitly admitted packed variants.
 * Container node/materialized counters are passed through, retaining relocation charges.
 */
function readGrannyObjectGraph(sections: Section[], rootType: Pointer, rootData: Pointer,
  limits: GrannyLimits, layout: 'relocated-le32' | 'packed-le64', consume: () => void,
  charge: (bytes: number) => void, remainingNodes: () => number): GrannyValue {
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
    const section = location(p, 1), end = section.bytes.indexOf(0, p[1])
    if (end < 0 || end - p[1] > limits.maxBytes) throw new RangeError('Granny unterminated string')
    charge((end - p[1]) * 2)
    return new TextDecoder('utf-8', { fatal: true }).decode(section.bytes.subarray(p[1], end))
  }
  const types = new Map<string, { members: Member[]; size: number; building: boolean }>()
  /** Read the embedded schema once, permitting reference recursion but refusing recursive inline layout. */
  function type(p: Pointer, depth: number): { members: Member[]; size: number; building: boolean } {
    if (depth > limits.maxDepth) throw new RangeError('Granny type depth')
    const key = p.join(':'), prior = types.get(key)
    if (prior) return prior
    const result = { members: [] as Member[], size: 0, building: true }; types.set(key, result)
    for (let at = p[1]; ; at += memberStride) {
      consume(); const member: Pointer = [p[0], at], kind = word(member)
      if (kind === 0) break
      location(member, memberStride)
      const name = string(pointer(add(member, 4))), element = pointer(add(member, 4 + pointerBytes)), width = word(add(member, 4 + pointerBytes * 2)) || 1
      if (!name || result.members.some(m => m.name === name) || width > limits.maxNodes || kind === 6 || !(kind === 1 || kind in SIZES))
        throw new TypeError('Unsupported Granny member/type width')
      let size = layout === 'packed-le64' && [2, 8, 22].includes(kind) ? 8
        : layout === 'packed-le64' && [3, 4].includes(kind) ? 12
        : layout === 'packed-le64' && kind === 5 ? 16
        : layout === 'packed-le64' && kind === 7 ? 20 : SIZES[kind]!
      if (kind === 1) {
        if (!element) throw new TypeError('Granny inline without type')
        const nested = type(element, depth + 1)
        if (nested.building) throw new TypeError('Granny recursive inline type')
        size = nested.size
      }
      size *= width
      if (result.size + size > limits.maxBytes) throw new RangeError('Granny type size budget')
      result.members.push({ kind, name, type: element, width, offset: result.size, size })
      result.size += size
    }
    result.building = false
    return result
  }
  const active = new Set<string>()
  const objects = new Map<string, GrannyValue>()
  /** Materialize a bounded acyclic object view; recursive extended-data cycles are refused. */
  function object(tp: Pointer, p: Pointer, depth: number): GrannyValue {
    consume(); if (depth > limits.maxDepth) throw new RangeError('Granny object depth')
    const schema = type(tp, depth), key = `${tp.join(':')}/${p.join(':')}`
    location(p, schema.size)
    if (active.has(key)) throw new TypeError('Granny cyclic object graph')
    const previous = objects.get(key)
    if (previous !== undefined) return previous
    charge(16)
    active.add(key)
    const result: Record<string, GrannyValue> = Object.create(null)
    try {
      for (const m of schema.members) {
        const values: GrannyValue[] = []
        for (let n = 0; n < m.width; n++) values.push(value(m, add(p, m.offset + n * m.size / m.width), depth + 1))
        result[m.name] = m.width === 1 ? values[0]! : values
      }
      objects.set(key, result)
      return result
    } finally { active.delete(key) }
  }
  /** Decode member kinds with the admitted layout's widths and pointer authority. */
  function value(m: Member, p: Pointer, depth: number): GrannyValue {
    consume()
    charge(8)
    const section = location(p, m.size / m.width), view = section.view, at = p[1]
    if (m.kind === 1) return object(m.type!, p, depth)
    if (m.kind === 8) return string(pointer(p))
    if (m.kind === 2 || m.kind === 22) { const dest = pointer(p); return dest && m.type ? object(m.type, dest, depth) : null }
    if (m.kind === 5) { const tp = pointer(p), dest = pointer(add(p, pointerBytes)); return tp && dest ? object(tp, dest, depth) : null }
    if (m.kind === 3 || m.kind === 4 || m.kind === 7) {
      const variant = m.kind === 7, tp = variant ? pointer(p) : m.type
      const length = word(add(p, variant ? pointerBytes : 0)), dest = pointer(add(p, variant ? pointerBytes + 4 : 4))
      if (length > remainingNodes()) throw new RangeError('Granny array node budget')
      if (length && (!dest || !tp)) throw new RangeError('Granny array pointer is absent')
      if (!dest || !tp) return []
      const elementType = type(tp, depth)
      const size = m.kind === 4 ? pointerBytes : elementType.size
      location(dest, length * size)
      charge(length * 8)
      // Granny's Real32 array element type is a one-scalar wrapper, not a semantic object.
      const scalar = elementType.members.length === 1 ? elementType.members[0] : undefined
      if (m.kind !== 4 && scalar?.kind === 10 && scalar.width === 1 && scalar.name === 'Real32')
        return Array.from({ length }, (_, i) => value(scalar, add(dest, i * size), depth))
      return Array.from({ length }, (_, i) => {
        const slot = add(dest, i * size), target = m.kind === 4 ? pointer(slot) : slot
        return target ? object(tp, target, depth) : null
      })
    }
    if (m.kind === 9) return { flags: word(p), position: floats(add(p, 4), 3), orientation: floats(add(p, 16), 4), scaleShear: floats(add(p, 32), 9) }
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
  function floats(p: Pointer, length: number): GrannyValue[] {
    const section = location(p, length * 4)
    return Array.from({ length }, (_, i) => {
      const f = section.view.getFloat32(p[1] + i * 4, true)
      if (!Number.isFinite(f)) throw new TypeError('Granny nonfinite transform')
      return f
    })
  }
  return object(rootType, rootData, 0)
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
