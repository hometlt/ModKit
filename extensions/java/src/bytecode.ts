/**
 * JVM bytecode (JVMS §6.5): instruction decoding and a `javap -c`-style listing. Every operand is
 * bounds-checked; an unknown opcode or an operand running past the code is refused.
 */

import {
  ConstantPool,
  type ClassFile,
  type ClassMember,
  type ConstantEntry,
  javaRelease,
} from './class-file.js'

/** Operand layouts after the opcode byte. */
type Layout =
  | 'none'
  | 'local' // u1 local index (u2 under wide)
  | 'byte' // s1
  | 'short' // s2
  | 'cp1' // u1 pool index
  | 'cp2' // u2 pool index
  | 'iinc' // u1 local, s1 delta (u2, s2 under wide)
  | 'branch2' // s2 offset
  | 'branch4' // s4 offset
  | 'newarray' // u1 array type
  | 'multianewarray' // u2 pool index, u1 dimensions
  | 'invokeinterface' // u2 pool index, u1 count, u1 zero
  | 'invokedynamic' // u2 pool index, u2 zero
  | 'tableswitch'
  | 'lookupswitch'
  | 'wide'

const NAMES = [
  'nop',
  'aconst_null',
  'iconst_m1',
  'iconst_0',
  'iconst_1',
  'iconst_2',
  'iconst_3',
  'iconst_4',
  'iconst_5',
  'lconst_0',
  'lconst_1',
  'fconst_0',
  'fconst_1',
  'fconst_2',
  'dconst_0',
  'dconst_1',
  'bipush',
  'sipush',
  'ldc',
  'ldc_w',
  'ldc2_w',
  'iload',
  'lload',
  'fload',
  'dload',
  'aload',
  'iload_0',
  'iload_1',
  'iload_2',
  'iload_3',
  'lload_0',
  'lload_1',
  'lload_2',
  'lload_3',
  'fload_0',
  'fload_1',
  'fload_2',
  'fload_3',
  'dload_0',
  'dload_1',
  'dload_2',
  'dload_3',
  'aload_0',
  'aload_1',
  'aload_2',
  'aload_3',
  'iaload',
  'laload',
  'faload',
  'daload',
  'aaload',
  'baload',
  'caload',
  'saload',
  'istore',
  'lstore',
  'fstore',
  'dstore',
  'astore',
  'istore_0',
  'istore_1',
  'istore_2',
  'istore_3',
  'lstore_0',
  'lstore_1',
  'lstore_2',
  'lstore_3',
  'fstore_0',
  'fstore_1',
  'fstore_2',
  'fstore_3',
  'dstore_0',
  'dstore_1',
  'dstore_2',
  'dstore_3',
  'astore_0',
  'astore_1',
  'astore_2',
  'astore_3',
  'iastore',
  'lastore',
  'fastore',
  'dastore',
  'aastore',
  'bastore',
  'castore',
  'sastore',
  'pop',
  'pop2',
  'dup',
  'dup_x1',
  'dup_x2',
  'dup2',
  'dup2_x1',
  'dup2_x2',
  'swap',
  'iadd',
  'ladd',
  'fadd',
  'dadd',
  'isub',
  'lsub',
  'fsub',
  'dsub',
  'imul',
  'lmul',
  'fmul',
  'dmul',
  'idiv',
  'ldiv',
  'fdiv',
  'ddiv',
  'irem',
  'lrem',
  'frem',
  'drem',
  'ineg',
  'lneg',
  'fneg',
  'dneg',
  'ishl',
  'lshl',
  'ishr',
  'lshr',
  'iushr',
  'lushr',
  'iand',
  'land',
  'ior',
  'lor',
  'ixor',
  'lxor',
  'iinc',
  'i2l',
  'i2f',
  'i2d',
  'l2i',
  'l2f',
  'l2d',
  'f2i',
  'f2l',
  'f2d',
  'd2i',
  'd2l',
  'd2f',
  'i2b',
  'i2c',
  'i2s',
  'lcmp',
  'fcmpl',
  'fcmpg',
  'dcmpl',
  'dcmpg',
  'ifeq',
  'ifne',
  'iflt',
  'ifge',
  'ifgt',
  'ifle',
  'if_icmpeq',
  'if_icmpne',
  'if_icmplt',
  'if_icmpge',
  'if_icmpgt',
  'if_icmple',
  'if_acmpeq',
  'if_acmpne',
  'goto',
  'jsr',
  'ret',
  'tableswitch',
  'lookupswitch',
  'ireturn',
  'lreturn',
  'freturn',
  'dreturn',
  'areturn',
  'return',
  'getstatic',
  'putstatic',
  'getfield',
  'putfield',
  'invokevirtual',
  'invokespecial',
  'invokestatic',
  'invokeinterface',
  'invokedynamic',
  'new',
  'newarray',
  'anewarray',
  'arraylength',
  'athrow',
  'checkcast',
  'instanceof',
  'monitorenter',
  'monitorexit',
  'wide',
  'multianewarray',
  'ifnull',
  'ifnonnull',
  'goto_w',
  'jsr_w',
] as const

export type Mnemonic = (typeof NAMES)[number]

function layoutOf(opcode: number): Layout {
  if (opcode === 16) return 'byte'
  if (opcode === 17) return 'short'
  if (opcode === 18) return 'cp1'
  if (opcode === 19 || opcode === 20) return 'cp2'
  if ((opcode >= 21 && opcode <= 25) || (opcode >= 54 && opcode <= 58) || opcode === 169)
    return 'local'
  if (opcode === 132) return 'iinc'
  if ((opcode >= 153 && opcode <= 168) || opcode === 198 || opcode === 199) return 'branch2'
  if (opcode === 200 || opcode === 201) return 'branch4'
  if (opcode === 170) return 'tableswitch'
  if (opcode === 171) return 'lookupswitch'
  if (
    (opcode >= 178 && opcode <= 184) ||
    opcode === 187 ||
    opcode === 189 ||
    opcode === 192 ||
    opcode === 193
  )
    return 'cp2'
  if (opcode === 185) return 'invokeinterface'
  if (opcode === 186) return 'invokedynamic'
  if (opcode === 188) return 'newarray'
  if (opcode === 196) return 'wide'
  if (opcode === 197) return 'multianewarray'
  return 'none'
}

export interface Instruction {
  readonly pc: number
  readonly opcode: number
  readonly mnemonic: Mnemonic
  /** Under `wide`: the widened instruction's mnemonic is `mnemonic`, and this is true. */
  readonly wide?: true
  /** Local variable index, pool index, immediate value or array type, by layout. */
  readonly operand?: number
  /** `iinc` delta, `multianewarray` dimensions, `invokeinterface` count. */
  readonly second?: number
  /** Absolute branch target(s): one for jumps; default first, then cases, for switches. */
  readonly targets?: readonly number[]
  /** Switch keys, parallel to `targets.slice(1)`. */
  readonly keys?: readonly number[]
}

/** Decode a method's code into instructions, refusing unknown opcodes and overruns. */
export function decodeInstructions(code: Uint8Array): Instruction[] {
  const view = new DataView(code.buffer, code.byteOffset, code.byteLength)
  const instructions: Instruction[] = []
  const need = (at: number, length: number) => {
    if (at + length > code.byteLength)
      throw new RangeError(`bytecode operand runs past the code at ${at}`)
  }
  let pc = 0
  while (pc < code.byteLength) {
    const opcode = code[pc] ?? 0
    const mnemonic = NAMES[opcode]
    if (mnemonic === undefined) throw new TypeError(`bytecode opcode ${opcode} at ${pc} is unknown`)
    const at = pc + 1
    const layout = layoutOf(opcode)
    let next = at
    let instruction: Instruction
    switch (layout) {
      case 'none':
        instruction = { pc, opcode, mnemonic }
        break
      case 'local':
      case 'cp1':
      case 'newarray':
        need(at, 1)
        instruction = { pc, opcode, mnemonic, operand: view.getUint8(at) }
        next = at + 1
        break
      case 'byte':
        need(at, 1)
        instruction = { pc, opcode, mnemonic, operand: view.getInt8(at) }
        next = at + 1
        break
      case 'short':
        need(at, 2)
        instruction = { pc, opcode, mnemonic, operand: view.getInt16(at) }
        next = at + 2
        break
      case 'cp2':
        need(at, 2)
        instruction = { pc, opcode, mnemonic, operand: view.getUint16(at) }
        next = at + 2
        break
      case 'iinc':
        need(at, 2)
        instruction = {
          pc,
          opcode,
          mnemonic,
          operand: view.getUint8(at),
          second: view.getInt8(at + 1),
        }
        next = at + 2
        break
      case 'branch2':
        need(at, 2)
        instruction = { pc, opcode, mnemonic, targets: [pc + view.getInt16(at)] }
        next = at + 2
        break
      case 'branch4':
        need(at, 4)
        instruction = { pc, opcode, mnemonic, targets: [pc + view.getInt32(at)] }
        next = at + 4
        break
      case 'multianewarray':
      case 'invokeinterface':
        need(at, layout === 'multianewarray' ? 3 : 4)
        instruction = {
          pc,
          opcode,
          mnemonic,
          operand: view.getUint16(at),
          second: view.getUint8(at + 2),
        }
        next = at + (layout === 'multianewarray' ? 3 : 4)
        break
      case 'invokedynamic':
        need(at, 4)
        instruction = { pc, opcode, mnemonic, operand: view.getUint16(at) }
        next = at + 4
        break
      case 'tableswitch':
      case 'lookupswitch': {
        const base = (at + 3) & ~3
        need(base, 8)
        const fallback = pc + view.getInt32(base)
        const targets = [fallback]
        const keys: number[] = []
        if (layout === 'tableswitch') {
          need(base, 12)
          const low = view.getInt32(base + 4)
          const high = view.getInt32(base + 8)
          const count = high - low + 1
          if (count < 0 || count > code.byteLength)
            throw new RangeError(`tableswitch at ${pc} is invalid`)
          need(base + 12, count * 4)
          for (let index = 0; index < count; index += 1) {
            keys.push(low + index)
            targets.push(pc + view.getInt32(base + 12 + index * 4))
          }
          next = base + 12 + count * 4
        } else {
          const count = view.getInt32(base + 4)
          if (count < 0 || count > code.byteLength)
            throw new RangeError(`lookupswitch at ${pc} is invalid`)
          need(base + 8, count * 8)
          for (let index = 0; index < count; index += 1) {
            keys.push(view.getInt32(base + 8 + index * 8))
            targets.push(pc + view.getInt32(base + 12 + index * 8))
          }
          next = base + 8 + count * 8
        }
        instruction = { pc, opcode, mnemonic, targets, keys }
        break
      }
      case 'wide': {
        need(at, 3)
        const inner = view.getUint8(at)
        const innerName = NAMES[inner]
        const innerLayout = layoutOf(inner)
        if (innerName === undefined || (innerLayout !== 'local' && innerLayout !== 'iinc'))
          throw new TypeError(`wide at ${pc} widens opcode ${inner}`)
        if (innerLayout === 'iinc') {
          need(at, 5)
          instruction = {
            pc,
            opcode: inner,
            mnemonic: innerName,
            wide: true,
            operand: view.getUint16(at + 1),
            second: view.getInt16(at + 3),
          }
          next = at + 5
        } else {
          instruction = {
            pc,
            opcode: inner,
            mnemonic: innerName,
            wide: true,
            operand: view.getUint16(at + 1),
          }
          next = at + 3
        }
        break
      }
    }
    instructions.push(instruction)
    pc = next
  }
  return instructions
}

const ARRAY_TYPES: Readonly<Record<number, string>> = {
  4: 'boolean',
  5: 'char',
  6: 'float',
  7: 'double',
  8: 'byte',
  9: 'short',
  10: 'int',
  11: 'long',
}

export function arrayTypeName(code: number): string {
  const name = ARRAY_TYPES[code]
  if (name === undefined) throw new TypeError(`newarray type ${code} is invalid`)
  return name
}

/** A constant as `javap` prints it after an instruction: `String hello`, `Method a/B.c:()V`. */
export function describeConstant(pool: ConstantPool, index: number): string {
  const entry: ConstantEntry = pool.entry(index)
  switch (entry.tag) {
    case 'Utf8':
      return `Utf8 ${JSON.stringify(entry.value)}`
    case 'Integer':
      return `int ${entry.value}`
    case 'Double':
      return `double ${entry.value}`
    case 'Float':
      return `float ${entry.value}f`
    case 'Long':
      return `long ${entry.value}l`
    case 'Class':
      return `class ${pool.className(index)}`
    case 'String':
      return `String ${JSON.stringify(pool.utf8(entry.stringIndex))}`
    case 'Fieldref':
    case 'Methodref':
    case 'InterfaceMethodref': {
      const member = pool.member(index)
      const kind =
        entry.tag === 'Fieldref'
          ? 'Field'
          : entry.tag === 'Methodref'
            ? 'Method'
            : 'InterfaceMethod'
      return `${kind} ${member.owner}.${member.name}:${member.descriptor}`
    }
    case 'NameAndType': {
      const { name, descriptor } = pool.nameAndType(index)
      return `NameAndType ${name}:${descriptor}`
    }
    case 'MethodHandle':
      return `MethodHandle ${entry.kind}:${describeConstant(pool, entry.referenceIndex)}`
    case 'MethodType':
      return `MethodType ${pool.utf8(entry.descriptorIndex)}`
    case 'Dynamic':
    case 'InvokeDynamic': {
      const { name, descriptor } = pool.nameAndType(entry.nameAndTypeIndex)
      return `${entry.tag} #${entry.bootstrapIndex}:${name}:${descriptor}`
    }
    case 'Module':
    case 'Package':
      return `${entry.tag} ${pool.utf8(entry.nameIndex)}`
  }
}

function describeInstruction(pool: ConstantPool, instruction: Instruction): string {
  const head = `${String(instruction.pc).padStart(6)}: ${instruction.wide === true ? 'wide ' : ''}${instruction.mnemonic}`
  const layout = layoutOf(instruction.opcode)
  if (instruction.keys !== undefined && instruction.targets !== undefined) {
    const cases = instruction.keys.map(
      (key, index) => `${key}: ${instruction.targets?.[index + 1]}`,
    )
    return `${head} { ${[...cases, `default: ${instruction.targets[0]}`].join(', ')} }`
  }
  if (instruction.targets !== undefined) return `${head} ${instruction.targets[0]}`
  if (instruction.operand === undefined) return head
  if (
    layout === 'cp1' ||
    layout === 'cp2' ||
    layout === 'multianewarray' ||
    layout === 'invokeinterface' ||
    layout === 'invokedynamic'
  ) {
    const extra = layout === 'multianewarray' ? `, ${instruction.second}` : ''
    return `${head} #${instruction.operand}${extra} // ${describeConstant(pool, instruction.operand)}`
  }
  if (layout === 'newarray') return `${head} ${arrayTypeName(instruction.operand)}`
  if (layout === 'iinc') return `${head} ${instruction.operand}, ${instruction.second}`
  return `${head} ${instruction.operand}`
}

const ACCESS: readonly (readonly [number, string])[] = [
  [0x0001, 'public'],
  [0x0002, 'private'],
  [0x0004, 'protected'],
  [0x0008, 'static'],
  [0x0010, 'final'],
  [0x0040, 'volatile'],
  [0x0080, 'transient'],
  [0x0100, 'native'],
  [0x0400, 'abstract'],
]

function modifiers(flags: number, method: boolean): string {
  return ACCESS.filter(
    ([bit, name]) =>
      (flags & bit) !== 0 &&
      // for methods 0x0040 is bridge and 0x0080 varargs, not volatile/transient
      !(method && (bit === 0x0040 || bit === 0x0080)),
  )
    .map(([, name]) => `${name} `)
    .join('')
}

function memberListing(pool: ConstantPool, member: ClassMember, method: boolean): string[] {
  const lines = [
    `  ${modifiers(member.accessFlags, method)}${member.name}${method ? '' : ': '}${member.descriptor}`,
  ]
  if (member.constantValueIndex !== undefined)
    lines.push(`    ConstantValue: ${describeConstant(pool, member.constantValueIndex)}`)
  if (member.code !== undefined) {
    lines.push(`    Code: stack=${member.code.maxStack}, locals=${member.code.maxLocals}`)
    for (const instruction of decodeInstructions(member.code.code))
      lines.push(`  ${describeInstruction(pool, instruction)}`)
    for (const handler of member.code.exceptionHandlers)
      lines.push(
        `    catch ${handler.catchType ?? 'any'} [${handler.startPc}, ${handler.endPc}) -> ${handler.handlerPc}`,
      )
  }
  return lines
}

/** A readable listing of the whole class: header, fields and methods with their bytecode. */
export function classListing(file: ClassFile): string {
  const pool = new ConstantPool(file.constantPool)
  const kind =
    (file.accessFlags & 0x0200) !== 0
      ? 'interface'
      : (file.accessFlags & 0x4000) !== 0
        ? 'enum'
        : 'class'
  const lines = [
    `// class file ${file.majorVersion}.${file.minorVersion} (Java ${javaRelease(file.majorVersion)})`,
    `${modifiers(file.accessFlags & ~0x0020, false)}${kind} ${file.thisClass}` +
      (file.superClass === undefined || file.superClass === 'java/lang/Object'
        ? ''
        : ` extends ${file.superClass}`) +
      (file.interfaces.length === 0 ? '' : ` implements ${file.interfaces.join(', ')}`) +
      ' {',
  ]
  for (const field of file.fields) lines.push(...memberListing(pool, field, false))
  for (const method of file.methods) {
    lines.push('')
    lines.push(...memberListing(pool, method, true))
  }
  lines.push('}', '')
  return lines.join('\n')
}
