/**
 * Reference codec for the canonical UVB binary, version 1.0.
 *
 * The structural JSON form (behavior/schema/uvb.module.v1.schema.json) is the specification view;
 * this module is its canonical byte encoding and the inverse. Two rules make the encoding an
 * identity, not a serialisation convenience:
 *
 *   1. encode is a pure function of the structural content: the same module always yields the
 *      same bytes, on any machine, in any host;
 *   2. the identity digest covers every section EXCEPT the source map. Debug provenance may be
 *      stripped or added without changing what the module IS.
 *
 * The text projection `.uvbt` is the canonical-form JSON of the structural module (uv-canonical),
 * so binary<->text bijection is binary<->canonical JSON. No second grammar exists to drift.
 *
 * Layout (all integers little-endian), binary version 1.1 (1.0 was re-pinned the same day it was
 * frozen, before any consumer existed, to add the `types` section the review found missing):
 *   magic "UVB\0" | u8 major=1 | u8 minor=1
 *   sections in fixed order, each: u8 id | u32 byteLength | payload
 *     1 namespace   : string
 *     2 requires    : u32 count, string[]
 *     3 strings     : u32 count, string[]
 *     4 types       : u32 count, (string name, u32 fieldCount, (string name, string type)[])[]
 *                     — OPTIONAL when the module declares no record types
 *     5 functions   : u32 count, function[]
 *     6 sourcemap   : u32 count, (u32 functionIndex, u32 instructionIndex, string file, u32 line)[]
 *                     — OPTIONAL, excluded from the identity digest
 *   constants are encoded by their DECLARED `type` (i64/fixed64 → tag 1, bool → tag 2,
 *   strref → tag 3), never by the JavaScript type of the value; unused flag bits are refused.
 *   string          : u32 byteLength, UTF-8 bytes
 *   function        : string name | u32 paramCount, string[] | string returns | u32 registers
 *                     | u32 readCount, string[] | u32 writeCount, string[] | u32 instrCount, instruction[]
 *   instruction     : u8 opcode | u16 fieldFlags | present fields in flag order:
 *                     dst u32, a u32, b u32, value (u8 tag: 1 i64 LE64 / 2 bool u8 / 3 string),
 *                     type string, target u32, budget u8 (0 = typed-error), function string,
 *                     intrinsicIndex u32, args (u32 count, u32[])
 *
 * Dependency-free by design: Node built-ins only.
 */

import { createHash } from 'node:crypto'

export const OPCODES = [
  'const', 'move',
  'list.get', 'list.set', 'list.len', 'list.append',
  'record.get', 'record.set',
  'add.i64', 'sub.i64', 'mul.i64', 'div.i64',
  'add.fx', 'sub.fx', 'mul.fx', 'div.fx',
  'eq', 'lt', 'le', 'and', 'or', 'not',
  'br', 'br_if', 'loop', 'ret',
  'call', 'call.intrinsic',
  'result.ok', 'result.err', 'result.unwrap-or-branch',
]

const FIELDS = ['dst', 'a', 'b', 'value', 'type', 'target', 'budget', 'function', 'intrinsicIndex', 'args']
const MAGIC = [0x55, 0x56, 0x42, 0x00]
const BUDGET_MODES = ['typed-error']

// --- byte writer / reader ------------------------------------------------------------------------

class Writer {
  constructor() {
    this.chunks = []
    this.length = 0
  }
  push(bytes) {
    this.chunks.push(bytes)
    this.length += bytes.length
  }
  u8(v) {
    this.push(Uint8Array.of(v & 0xff))
  }
  u16(v) {
    const b = new Uint8Array(2)
    new DataView(b.buffer).setUint16(0, v, true)
    this.push(b)
  }
  u32(v) {
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new Error(`u32 out of range: ${v}`)
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, v, true)
    this.push(b)
  }
  i64(v) {
    const b = new Uint8Array(8)
    new DataView(b.buffer).setBigInt64(0, BigInt(v), true)
    this.push(b)
  }
  string(text) {
    const bytes = new TextEncoder().encode(text)
    this.u32(bytes.length)
    this.push(bytes)
  }
  bytes() {
    const out = new Uint8Array(this.length)
    let offset = 0
    for (const chunk of this.chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out
  }
}

class Reader {
  constructor(bytes) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.offset = 0
  }
  need(n) {
    if (this.offset + n > this.bytes.length) throw new Error(`truncated: need ${n} bytes at ${this.offset}`)
  }
  u8() {
    this.need(1)
    return this.bytes[this.offset++]
  }
  u16() {
    this.need(2)
    const v = this.view.getUint16(this.offset, true)
    this.offset += 2
    return v
  }
  u32() {
    this.need(4)
    const v = this.view.getUint32(this.offset, true)
    this.offset += 4
    return v
  }
  i64() {
    this.need(8)
    const v = this.view.getBigInt64(this.offset, true)
    this.offset += 8
    return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString()
  }
  string() {
    const n = this.u32()
    this.need(n)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(this.bytes.subarray(this.offset, this.offset + n))
    this.offset += n
    return text
  }
}

// --- encode ----------------------------------------------------------------------------------------

const section = (id, body) => {
  const w = new Writer()
  const payload = body.bytes()
  w.u8(id)
  w.u32(payload.length)
  w.push(payload)
  return w.bytes()
}

const encodeStrings = (w, list) => {
  w.u32(list.length)
  for (const s of list) w.string(s)
}

const encodeValue = (w, value, type) => {
  if (type === 'i64' || type === 'fixed64') {
    if (typeof value === 'boolean' || (typeof value === 'string' && !/^-?\d+$/.test(value))) {
      throw new Error(`const of type ${type} carries a non-integer value ${JSON.stringify(value)}`)
    }
    w.u8(1)
    w.i64(value)
  } else if (type === 'bool') {
    if (typeof value !== 'boolean') throw new Error(`const of type bool carries ${JSON.stringify(value)}`)
    w.u8(2)
    w.u8(value ? 1 : 0)
  } else if (type === 'strref') {
    if (typeof value !== 'string') throw new Error(`const of type strref carries ${JSON.stringify(value)}`)
    w.u8(3)
    w.string(value)
  } else {
    throw new Error(`const with unencodable declared type ${JSON.stringify(type)}`)
  }
}

const encodeInstruction = (w, instruction, sourceMap, functionIndex, instructionIndex) => {
  const opcode = OPCODES.indexOf(instruction.op)
  if (opcode < 0) throw new Error(`unknown op ${instruction.op}`)
  w.u8(opcode)
  let flags = 0
  FIELDS.forEach((field, index) => {
    if (instruction[field] !== undefined) flags |= 1 << index
  })
  w.u16(flags)
  if (instruction.dst !== undefined) w.u32(instruction.dst)
  if (instruction.a !== undefined) w.u32(instruction.a)
  if (instruction.b !== undefined) w.u32(instruction.b)
  if (instruction.value !== undefined) encodeValue(w, instruction.value, instruction.type)
  if (instruction.type !== undefined) w.string(instruction.type)
  if (instruction.target !== undefined) w.u32(instruction.target)
  if (instruction.budget !== undefined) {
    const mode = BUDGET_MODES.indexOf(instruction.budget.onExhausted)
    if (mode < 0) throw new Error(`unknown budget mode ${instruction.budget.onExhausted}`)
    w.u8(mode)
  }
  if (instruction.function !== undefined) w.string(instruction.function)
  if (instruction.intrinsicIndex !== undefined) w.u32(instruction.intrinsicIndex)
  if (instruction.args !== undefined) {
    w.u32(instruction.args.length)
    for (const arg of instruction.args) w.u32(arg)
  }
  if (instruction.source !== undefined) {
    sourceMap.push({ functionIndex, instructionIndex, file: instruction.source.file, line: instruction.source.line })
  }
}

/** Encode a structural UVB module into its canonical bytes. */
export function encodeUvb(module) {
  if (module?.uv?.format !== 'UVB' || module.uv.version !== '1.0') throw new Error('not a UVB 1.0 module')
  const out = new Writer()
  out.push(Uint8Array.from(MAGIC))
  out.u8(1)
  out.u8(1)

  const ns = new Writer()
  ns.string(module.namespace)
  out.push(section(1, ns))

  const req = new Writer()
  encodeStrings(req, module.requires.intrinsics)
  out.push(section(2, req))

  const strs = new Writer()
  encodeStrings(strs, module.strings ?? [])
  out.push(section(3, strs))

  if ((module.types ?? []).length > 0) {
    const types = new Writer()
    types.u32(module.types.length)
    for (const record of module.types) {
      types.string(record.name)
      types.u32(record.fields.length)
      for (const field of record.fields) {
        types.string(field.name)
        types.string(field.type)
      }
    }
    out.push(section(4, types))
  }

  const sourceMap = []
  const fns = new Writer()
  fns.u32(module.functions.length)
  module.functions.forEach((fn, functionIndex) => {
    fns.string(fn.name)
    encodeStrings(fns, fn.params)
    fns.string(fn.returns)
    fns.u32(fn.registers)
    encodeStrings(fns, fn.effects.reads)
    encodeStrings(fns, fn.effects.writes)
    fns.u32(fn.body.length)
    fn.body.forEach((instruction, instructionIndex) =>
      encodeInstruction(fns, instruction, sourceMap, functionIndex, instructionIndex),
    )
  })
  out.push(section(5, fns))

  if (sourceMap.length > 0) {
    const sm = new Writer()
    sm.u32(sourceMap.length)
    for (const entry of sourceMap) {
      sm.u32(entry.functionIndex)
      sm.u32(entry.instructionIndex)
      sm.string(entry.file)
      sm.u32(entry.line)
    }
    out.push(section(6, sm))
  }
  return out.bytes()
}

// --- decode ----------------------------------------------------------------------------------------

const decodeStrings = r => {
  const n = r.u32()
  const list = []
  for (let i = 0; i < n; i += 1) list.push(r.string())
  return list
}

const decodeValue = r => {
  const tag = r.u8()
  if (tag === 1) return r.i64()
  if (tag === 2) return r.u8() === 1
  if (tag === 3) return r.string()
  throw new Error(`unknown value tag ${tag}`)
}

const decodeInstruction = r => {
  const opcode = r.u8()
  if (opcode >= OPCODES.length) throw new Error(`unknown opcode ${opcode}`)
  const instruction = { op: OPCODES[opcode] }
  const flags = r.u16()
  // unused flag bits must be zero: otherwise two different byte sequences would decode to one
  // module and the identity digest would stop being an identity
  if (flags >= 1 << FIELDS.length) throw new Error(`unknown field flags ${flags}`)
  const has = index => (flags & (1 << index)) !== 0
  if (has(0)) instruction.dst = r.u32()
  if (has(1)) instruction.a = r.u32()
  if (has(2)) instruction.b = r.u32()
  if (has(3)) instruction.value = decodeValue(r)
  if (has(4)) instruction.type = r.string()
  if (has(5)) instruction.target = r.u32()
  if (has(6)) {
    const mode = r.u8()
    if (mode >= BUDGET_MODES.length) throw new Error(`unknown budget mode ${mode}`)
    instruction.budget = { onExhausted: BUDGET_MODES[mode] }
  }
  if (has(7)) instruction.function = r.string()
  if (has(8)) instruction.intrinsicIndex = r.u32()
  if (has(9)) {
    const n = r.u32()
    instruction.args = []
    for (let i = 0; i < n; i += 1) instruction.args.push(r.u32())
  }
  return instruction
}

/** Decode canonical bytes back into the structural module. */
export function decodeUvb(bytes) {
  const r = new Reader(bytes)
  for (const expected of MAGIC) {
    if (r.u8() !== expected) throw new Error('bad magic: not a UVB binary')
  }
  const major = r.u8()
  const minor = r.u8()
  if (major !== 1 || minor !== 1) throw new Error(`unsupported UVB binary version ${major}.${minor}`)
  const module = { uv: { format: 'UVB', version: '1.0' } }
  let lastId = 0
  const sourceMap = []
  while (r.offset < bytes.length) {
    const id = r.u8()
    const length = r.u32()
    if (id <= lastId) throw new Error(`section ${id} out of canonical order after ${lastId}`)
    lastId = id
    const end = r.offset + length
    r.need(length)
    if (id === 1) module.namespace = r.string()
    else if (id === 2) module.requires = { intrinsics: decodeStrings(r) }
    else if (id === 3) module.strings = decodeStrings(r)
    else if (id === 4) {
      const n = r.u32()
      module.types = []
      for (let i = 0; i < n; i += 1) {
        const record = { name: r.string(), fields: [] }
        const fieldCount = r.u32()
        for (let j = 0; j < fieldCount; j += 1) record.fields.push({ name: r.string(), type: r.string() })
        module.types.push(record)
      }
    } else if (id === 5) {
      const n = r.u32()
      module.functions = []
      for (let i = 0; i < n; i += 1) {
        const fn = { name: r.string() }
        fn.params = decodeStrings(r)
        fn.returns = r.string()
        fn.registers = r.u32()
        fn.effects = { reads: decodeStrings(r), writes: decodeStrings(r) }
        const count = r.u32()
        fn.body = []
        for (let j = 0; j < count; j += 1) fn.body.push(decodeInstruction(r))
        module.functions.push(fn)
      }
    } else if (id === 6) {
      const n = r.u32()
      for (let i = 0; i < n; i += 1) {
        sourceMap.push({ functionIndex: r.u32(), instructionIndex: r.u32(), file: r.string(), line: r.u32() })
      }
    } else throw new Error(`unknown section ${id}`)
    if (r.offset !== end) throw new Error(`section ${id} length mismatch`)
  }
  if (module.namespace === undefined || module.requires === undefined || module.functions === undefined) {
    throw new Error('missing mandatory section')
  }
  if (module.strings !== undefined && module.strings.length === 0) delete module.strings
  for (const entry of sourceMap) {
    const instruction = module.functions[entry.functionIndex]?.body[entry.instructionIndex]
    if (instruction === undefined) throw new Error('source map names a missing instruction')
    instruction.source = { file: entry.file, line: entry.line }
  }
  return module
}

/**
 * Byte offset of the u16 field-flags of the first instruction of the first function — used by
 * conformance vectors that must corrupt exactly that word without hand-computing the layout.
 */
export function locateFirstInstructionFlags(bytes) {
  const r = new Reader(bytes)
  r.offset = 6
  while (r.offset < bytes.length) {
    const id = r.u8()
    const length = r.u32()
    if (id !== 5) {
      r.offset += length
      continue
    }
    const count = r.u32()
    if (count === 0) throw new Error('module has no functions')
    r.string() // name
    const params = r.u32()
    for (let i = 0; i < params; i += 1) r.string()
    r.string() // returns
    r.u32() // registers
    const reads = r.u32()
    for (let i = 0; i < reads; i += 1) r.string()
    const writes = r.u32()
    for (let i = 0; i < writes; i += 1) r.string()
    const instructions = r.u32()
    if (instructions === 0) throw new Error('first function has no instructions')
    return r.offset + 1 // skip the opcode byte; the flags word starts here
  }
  throw new Error('no functions section')
}

/** The identity digest: sha256 over every section except the source map. */
export function uvbIdentityDigest(bytes) {
  const r = new Reader(bytes)
  const hash = createHash('sha256')
  hash.update(bytes.subarray(0, 6))
  r.offset = 6
  while (r.offset < bytes.length) {
    const start = r.offset
    const id = r.u8()
    const length = r.u32()
    const end = r.offset + length
    r.need(length)
    if (id !== 6) hash.update(bytes.subarray(start, end))
    r.offset = end
  }
  return `sha256:${hash.digest('hex')}`
}
