/**
 * The JVM class file (JVMS §4): constant pool, fields, methods and their attributes, read with
 * bounds on every count and length. Attributes are kept as byte ranges; `Code` is decoded because
 * the listing and the constant interpreter read it. Nothing here knows any game.
 */

export const CLASS_MAGIC = 0xcafebabe

export type ConstantEntry =
  | { readonly tag: 'Utf8'; readonly value: string }
  | { readonly tag: 'Integer'; readonly value: number }
  | { readonly tag: 'Float'; readonly value: number }
  | { readonly tag: 'Long'; readonly value: bigint }
  | { readonly tag: 'Double'; readonly value: number }
  | { readonly tag: 'Class'; readonly nameIndex: number }
  | { readonly tag: 'String'; readonly stringIndex: number }
  | {
      readonly tag: 'Fieldref' | 'Methodref' | 'InterfaceMethodref'
      readonly classIndex: number
      readonly nameAndTypeIndex: number
    }
  | { readonly tag: 'NameAndType'; readonly nameIndex: number; readonly descriptorIndex: number }
  | { readonly tag: 'MethodHandle'; readonly kind: number; readonly referenceIndex: number }
  | { readonly tag: 'MethodType'; readonly descriptorIndex: number }
  | {
      readonly tag: 'Dynamic' | 'InvokeDynamic'
      readonly bootstrapIndex: number
      readonly nameAndTypeIndex: number
    }
  | { readonly tag: 'Module' | 'Package'; readonly nameIndex: number }

export interface ClassAttribute {
  readonly name: string
  /** Offset of the attribute's body in the class file. */
  readonly offset: number
  readonly length: number
}

export interface ExceptionHandler {
  readonly startPc: number
  readonly endPc: number
  readonly handlerPc: number
  /** Internal name of the caught class, or undefined for `finally`. */
  readonly catchType: string | undefined
}

export interface CodeAttribute {
  readonly maxStack: number
  readonly maxLocals: number
  readonly code: Uint8Array
  readonly exceptionHandlers: readonly ExceptionHandler[]
  readonly attributes: readonly ClassAttribute[]
}

export interface ClassMember {
  readonly accessFlags: number
  readonly name: string
  readonly descriptor: string
  readonly attributes: readonly ClassAttribute[]
  /** Methods only: the decoded `Code` attribute, absent for abstract and native methods. */
  readonly code?: CodeAttribute
  /** Fields only: the `ConstantValue` attribute's pool index. */
  readonly constantValueIndex?: number
}

export interface ClassFile {
  readonly minorVersion: number
  readonly majorVersion: number
  /** Index 0 and the slot after a Long or Double are `undefined`, as in the JVM. */
  readonly constantPool: readonly (ConstantEntry | undefined)[]
  readonly accessFlags: number
  readonly thisClass: string
  readonly superClass: string | undefined
  readonly interfaces: readonly string[]
  readonly fields: readonly ClassMember[]
  readonly methods: readonly ClassMember[]
  readonly attributes: readonly ClassAttribute[]
}

export interface ClassFileLimits {
  /** Largest member count (fields, methods) and attribute count accepted. Default 65535. */
  readonly maxMembers?: number
}

export function isClassFile(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 10 &&
    new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0) === CLASS_MAGIC
  )
}

class Cursor {
  private readonly view: DataView
  position = 0

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  private need(length: number, what: string): void {
    if (this.position + length > this.bytes.byteLength)
      throw new RangeError(`class file is truncated in ${what} at ${this.position}`)
  }

  u1(what: string): number {
    this.need(1, what)
    return this.view.getUint8(this.position++)
  }

  u2(what: string): number {
    this.need(2, what)
    const value = this.view.getUint16(this.position)
    this.position += 2
    return value
  }

  u4(what: string): number {
    this.need(4, what)
    const value = this.view.getUint32(this.position)
    this.position += 4
    return value
  }

  s4(what: string): number {
    this.need(4, what)
    const value = this.view.getInt32(this.position)
    this.position += 4
    return value
  }

  f4(what: string): number {
    this.need(4, what)
    const value = this.view.getFloat32(this.position)
    this.position += 4
    return value
  }

  s8(what: string): bigint {
    this.need(8, what)
    const value = this.view.getBigInt64(this.position)
    this.position += 8
    return value
  }

  f8(what: string): number {
    this.need(8, what)
    const value = this.view.getFloat64(this.position)
    this.position += 8
    return value
  }

  take(length: number, what: string): Uint8Array {
    this.need(length, what)
    const value = this.bytes.subarray(this.position, this.position + length)
    this.position += length
    return value
  }
}

/** Modified UTF-8 (JVMS §4.4.7): NUL as C0 80, supplementary characters as surrogate pairs. */
export function decodeModifiedUtf8(bytes: Uint8Array): string {
  const units: number[] = []
  let out = ''
  for (let index = 0; index < bytes.byteLength;) {
    const a = bytes[index] ?? 0
    if (a < 0x80 && a !== 0) {
      units.push(a)
      index += 1
    } else if ((a & 0xe0) === 0xc0) {
      const b = bytes[index + 1]
      if (b === undefined || (b & 0xc0) !== 0x80)
        throw new TypeError('class file string is invalid')
      units.push(((a & 0x1f) << 6) | (b & 0x3f))
      index += 2
    } else if ((a & 0xf0) === 0xe0) {
      const b = bytes[index + 1]
      const c = bytes[index + 2]
      if (b === undefined || c === undefined || (b & 0xc0) !== 0x80 || (c & 0xc0) !== 0x80)
        throw new TypeError('class file string is invalid')
      units.push(((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f))
      index += 3
    } else throw new TypeError('class file string is invalid')
    if (units.length >= 4096) {
      out += String.fromCharCode(...units)
      units.length = 0
    }
  }
  return out + String.fromCharCode(...units)
}

function readConstant(cursor: Cursor, tag: number): ConstantEntry {
  switch (tag) {
    case 1:
      return { tag: 'Utf8', value: decodeModifiedUtf8(cursor.take(cursor.u2('Utf8'), 'Utf8')) }
    case 3:
      return { tag: 'Integer', value: cursor.s4('Integer') }
    case 4:
      return { tag: 'Float', value: cursor.f4('Float') }
    case 5:
      return { tag: 'Long', value: cursor.s8('Long') }
    case 6:
      return { tag: 'Double', value: cursor.f8('Double') }
    case 7:
      return { tag: 'Class', nameIndex: cursor.u2('Class') }
    case 8:
      return { tag: 'String', stringIndex: cursor.u2('String') }
    case 9:
    case 10:
    case 11:
      return {
        tag: tag === 9 ? 'Fieldref' : tag === 10 ? 'Methodref' : 'InterfaceMethodref',
        classIndex: cursor.u2('member reference'),
        nameAndTypeIndex: cursor.u2('member reference'),
      }
    case 12:
      return {
        tag: 'NameAndType',
        nameIndex: cursor.u2('NameAndType'),
        descriptorIndex: cursor.u2('NameAndType'),
      }
    case 15:
      return {
        tag: 'MethodHandle',
        kind: cursor.u1('MethodHandle'),
        referenceIndex: cursor.u2('MethodHandle'),
      }
    case 16:
      return { tag: 'MethodType', descriptorIndex: cursor.u2('MethodType') }
    case 17:
    case 18:
      return {
        tag: tag === 17 ? 'Dynamic' : 'InvokeDynamic',
        bootstrapIndex: cursor.u2('dynamic constant'),
        nameAndTypeIndex: cursor.u2('dynamic constant'),
      }
    case 19:
    case 20:
      return { tag: tag === 19 ? 'Module' : 'Package', nameIndex: cursor.u2('module constant') }
    default:
      throw new TypeError(`class file constant tag ${tag} is unknown at ${cursor.position - 1}`)
  }
}

/** Reads and resolves pool entries, checking every index and its expected kind. */
export class ConstantPool {
  constructor(readonly entries: readonly (ConstantEntry | undefined)[]) {}

  entry(index: number): ConstantEntry {
    const entry = this.entries[index]
    if (index <= 0 || entry === undefined)
      throw new RangeError(`constant pool index ${index} is invalid`)
    return entry
  }

  utf8(index: number): string {
    const entry = this.entry(index)
    if (entry.tag !== 'Utf8') throw new TypeError(`constant ${index} is ${entry.tag}, not Utf8`)
    return entry.value
  }

  /** The internal name a `Class` constant names (`net/minecraft/world/Item`, `[I`). */
  className(index: number): string {
    const entry = this.entry(index)
    if (entry.tag !== 'Class') throw new TypeError(`constant ${index} is ${entry.tag}, not Class`)
    return this.utf8(entry.nameIndex)
  }

  nameAndType(index: number): { readonly name: string; readonly descriptor: string } {
    const entry = this.entry(index)
    if (entry.tag !== 'NameAndType')
      throw new TypeError(`constant ${index} is ${entry.tag}, not NameAndType`)
    return { name: this.utf8(entry.nameIndex), descriptor: this.utf8(entry.descriptorIndex) }
  }

  /** A field or method reference: its owner class, name and descriptor. */
  member(index: number): {
    readonly kind: 'Fieldref' | 'Methodref' | 'InterfaceMethodref'
    readonly owner: string
    readonly name: string
    readonly descriptor: string
  } {
    const entry = this.entry(index)
    if (entry.tag !== 'Fieldref' && entry.tag !== 'Methodref' && entry.tag !== 'InterfaceMethodref')
      throw new TypeError(`constant ${index} is ${entry.tag}, not a member reference`)
    return {
      kind: entry.tag,
      owner: this.className(entry.classIndex),
      ...this.nameAndType(entry.nameAndTypeIndex),
    }
  }
}

function readAttributes(cursor: Cursor, pool: ConstantPool, limit: number): ClassAttribute[] {
  const count = cursor.u2('attribute count')
  if (count > limit) throw new RangeError(`class file declares ${count} attributes`)
  const attributes: ClassAttribute[] = []
  for (let index = 0; index < count; index += 1) {
    const name = pool.utf8(cursor.u2('attribute name'))
    const length = cursor.u4('attribute length')
    const offset = cursor.position
    cursor.take(length, `attribute ${name}`)
    attributes.push({ name, offset, length })
  }
  return attributes
}

function readCode(bytes: Uint8Array, attribute: ClassAttribute, pool: ConstantPool, limit: number) {
  const cursor = new Cursor(bytes.subarray(attribute.offset, attribute.offset + attribute.length))
  const maxStack = cursor.u2('Code')
  const maxLocals = cursor.u2('Code')
  const codeLength = cursor.u4('Code')
  if (codeLength === 0 || codeLength >= 65536)
    throw new RangeError(`Code attribute length ${codeLength} is invalid`)
  const code = cursor.take(codeLength, 'Code')
  const handlerCount = cursor.u2('exception table')
  const exceptionHandlers: ExceptionHandler[] = []
  for (let index = 0; index < handlerCount; index += 1) {
    const startPc = cursor.u2('exception table')
    const endPc = cursor.u2('exception table')
    const handlerPc = cursor.u2('exception table')
    const catchIndex = cursor.u2('exception table')
    exceptionHandlers.push({
      startPc,
      endPc,
      handlerPc,
      catchType: catchIndex === 0 ? undefined : pool.className(catchIndex),
    })
  }
  // nested attribute offsets are relative to the Code body; make them absolute
  const attributes = readAttributes(cursor, pool, limit).map(item => ({
    ...item,
    offset: item.offset + attribute.offset,
  }))
  if (cursor.position !== attribute.length) throw new TypeError('Code attribute length disagrees')
  return { maxStack, maxLocals, code, exceptionHandlers, attributes }
}

function readMembers(
  cursor: Cursor,
  pool: ConstantPool,
  limit: number,
  what: 'field' | 'method',
): ClassMember[] {
  const count = cursor.u2(`${what} count`)
  if (count > limit) throw new RangeError(`class file declares ${count} ${what}s`)
  const members: ClassMember[] = []
  for (let index = 0; index < count; index += 1) {
    const accessFlags = cursor.u2(what)
    const name = pool.utf8(cursor.u2(`${what} name`))
    const descriptor = pool.utf8(cursor.u2(`${what} descriptor`))
    const attributes = readAttributes(cursor, pool, limit)
    const codeAttribute = what === 'method' ? attributes.find(a => a.name === 'Code') : undefined
    const constant = what === 'field' ? attributes.find(a => a.name === 'ConstantValue') : undefined
    if (constant !== undefined && constant.length !== 2)
      throw new TypeError(`ConstantValue of field ${name} is invalid`)
    members.push({
      accessFlags,
      name,
      descriptor,
      attributes,
      ...(codeAttribute === undefined
        ? {}
        : { code: readCode(cursor.bytes, codeAttribute, pool, limit) }),
      ...(constant === undefined
        ? {}
        : {
            constantValueIndex:
              ((cursor.bytes[constant.offset] ?? 0) << 8) |
              (cursor.bytes[constant.offset + 1] ?? 0),
          }),
    })
  }
  return members
}

export function parseClassFile(bytes: Uint8Array, limits: ClassFileLimits = {}): ClassFile {
  const limit = limits.maxMembers ?? 65535
  const cursor = new Cursor(bytes)
  if (cursor.u4('magic') !== CLASS_MAGIC) throw new TypeError('not a JVM class file')
  const minorVersion = cursor.u2('version')
  const majorVersion = cursor.u2('version')
  const poolCount = cursor.u2('constant pool count')
  if (poolCount === 0) throw new TypeError('class file constant pool count is invalid')
  const entries: (ConstantEntry | undefined)[] = [undefined]
  while (entries.length < poolCount) {
    const entry = readConstant(cursor, cursor.u1('constant tag'))
    entries.push(entry)
    // a Long or Double takes two slots; the second is unusable
    if (entry.tag === 'Long' || entry.tag === 'Double') entries.push(undefined)
  }
  if (entries.length !== poolCount)
    throw new TypeError('class file wide constant overruns the pool')
  const pool = new ConstantPool(entries)
  const accessFlags = cursor.u2('access flags')
  const thisClass = pool.className(cursor.u2('this class'))
  const superIndex = cursor.u2('super class')
  const superClass = superIndex === 0 ? undefined : pool.className(superIndex)
  const interfaceCount = cursor.u2('interface count')
  const interfaces: string[] = []
  for (let index = 0; index < interfaceCount; index += 1)
    interfaces.push(pool.className(cursor.u2('interface')))
  const fields = readMembers(cursor, pool, limit, 'field')
  const methods = readMembers(cursor, pool, limit, 'method')
  const attributes = readAttributes(cursor, pool, limit)
  if (cursor.position !== bytes.byteLength)
    throw new TypeError(`class file has ${bytes.byteLength - cursor.position} trailing bytes`)
  return {
    minorVersion,
    majorVersion,
    constantPool: entries,
    accessFlags,
    thisClass,
    superClass,
    interfaces,
    fields,
    methods,
    attributes,
  }
}

/** Java SE release of a class file major version (45 → 1.1, 52 → 8, 69 → 25). */
export function javaRelease(majorVersion: number): string {
  if (majorVersion < 45) return `unknown (${majorVersion})`
  if (majorVersion <= 48) return `1.${majorVersion - 44}`
  return String(majorVersion - 44)
}
