/**
 * The bounded constant interpreter (D2): walks one method's straight-line bytecode abstractly and
 * reports the calls it makes with their arguments as constants or as symbolic values (a static
 * field, a parameter, another call's result). Nothing is executed: a branch, a switch, a throw, an
 * exception handler or any instruction outside this subset refuses the whole method with the
 * program counter and the reason, so a caller can name what it skipped.
 *
 * Builder code such as a model definition (`CubeListBuilder.create().texOffs(0, 0).addBox(...)`)
 * is straight-line with constant arguments and reads back as a list of calls.
 */

import { ConstantPool, type ClassFile, type ClassMember } from './class-file.js'
import { arrayTypeName, decodeInstructions, type Instruction } from './bytecode.js'

export type JvmValue =
  | { readonly kind: 'int' | 'float' | 'double'; readonly value: number }
  | { readonly kind: 'long'; readonly value: bigint }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'null' }
  /** `ldc` of a class literal. */
  | { readonly kind: 'class'; readonly name: string }
  /** A method parameter (`this` is parameter 0 of an instance method). */
  | { readonly kind: 'parameter'; readonly index: number }
  | {
      readonly kind: 'static'
      readonly owner: string
      readonly name: string
      readonly descriptor: string
    }
  | {
      readonly kind: 'field'
      readonly target: JvmValue
      readonly owner: string
      readonly name: string
      readonly descriptor: string
    }
  /** An object `new` made; `init` is the index of its constructor call once it ran. */
  | { readonly kind: 'object'; readonly className: string; readonly id: number; init?: number }
  /** The value a call returned. */
  | { readonly kind: 'result'; readonly call: number }
  | {
      readonly kind: 'array'
      readonly elementType: string
      readonly elements: (JvmValue | undefined)[]
    }
  /** Arithmetic or a conversion over values that are not all constants. */
  | { readonly kind: 'operation'; readonly op: string; readonly operands: readonly JvmValue[] }

export interface JvmCall {
  readonly pc: number
  readonly invoke:
    'invokevirtual' | 'invokespecial' | 'invokestatic' | 'invokeinterface' | 'invokedynamic'
  readonly owner: string
  readonly name: string
  readonly descriptor: string
  /** Absent for static and dynamic calls. */
  readonly receiver?: JvmValue
  readonly args: readonly JvmValue[]
}

export interface JvmStore {
  readonly pc: number
  readonly target?: JvmValue
  readonly owner: string
  readonly name: string
  readonly value: JvmValue
}

export type InterpretResult =
  | {
      readonly state: 'ok'
      readonly calls: readonly JvmCall[]
      readonly stores: readonly JvmStore[]
      readonly returned?: JvmValue
    }
  | { readonly state: 'refused'; readonly pc: number; readonly reason: string }

class Refusal extends Error {
  constructor(
    readonly pc: number,
    reason: string,
  ) {
    super(reason)
  }
}

/** Argument slots of a method descriptor, one entry per argument (a long or double included). */
export function descriptorArguments(descriptor: string): { readonly wide: boolean }[] {
  const close = descriptor.indexOf(')')
  if (!descriptor.startsWith('(') || close < 0)
    throw new TypeError(`method descriptor ${descriptor} is invalid`)
  const args: { wide: boolean }[] = []
  for (let at = 1; at < close;) {
    const start = at
    while (descriptor[at] === '[') at += 1
    if (descriptor[at] === 'L') {
      const end = descriptor.indexOf(';', at)
      if (end < 0 || end > close) throw new TypeError(`method descriptor ${descriptor} is invalid`)
      at = end + 1
    } else if ('BCDFIJSZ'.includes(descriptor[at] ?? '')) at += 1
    else throw new TypeError(`method descriptor ${descriptor} is invalid`)
    args.push({
      wide: at - start === 1 && (descriptor[start] === 'J' || descriptor[start] === 'D'),
    })
  }
  return args
}

const returnsValue = (descriptor: string) => !descriptor.endsWith(')V')

const isWide = (value: JvmValue) => value.kind === 'long' || value.kind === 'double'

function fold(op: string, operands: readonly JvmValue[]): JvmValue {
  const [a, b] = operands
  const numeric = (value: JvmValue | undefined) =>
    value !== undefined &&
    (value.kind === 'int' || value.kind === 'float' || value.kind === 'double')
  if (op.startsWith('l') && operands.every(value => value.kind === 'long')) {
    const x = (a as { value: bigint }).value
    const y = (b as { value: bigint } | undefined)?.value ?? 0n
    const long = (value: bigint): JvmValue => ({ kind: 'long', value: BigInt.asIntN(64, value) })
    switch (op) {
      case 'ladd':
        return long(x + y)
      case 'lsub':
        return long(x - y)
      case 'lmul':
        return long(x * y)
      case 'lneg':
        return long(-x)
    }
  }
  if (operands.every(numeric)) {
    const x = (a as { value: number }).value
    const y = (b as { value: number } | undefined)?.value ?? 0
    const kind =
      op[0] === 'i' ? 'int' : op[0] === 'f' ? 'float' : op[0] === 'd' ? 'double' : undefined
    const typed = (value: number): JvmValue =>
      kind === 'int'
        ? { kind, value: value | 0 }
        : kind === 'float'
          ? { kind, value: Math.fround(value) }
          : { kind: 'double', value }
    switch (op.slice(1)) {
      case 'add':
        return typed(x + y)
      case 'sub':
        return typed(x - y)
      case 'mul':
        return kind === 'int' ? typed(Math.imul(x, y)) : typed(x * y)
      case 'div':
        if (kind === 'int') break // division by zero throws; keep it symbolic
        return typed(x / y)
      case 'neg':
        return typed(-x)
    }
    switch (op) {
      case 'i2f':
      case 'd2f':
        return { kind: 'float', value: Math.fround(x) }
      case 'i2d':
      case 'f2d':
        return { kind: 'double', value: x }
      case 'f2i':
      case 'd2i':
        return {
          kind: 'int',
          value: Number.isNaN(x) ? 0 : Math.max(-2147483648, Math.min(2147483647, Math.trunc(x))),
        }
      case 'i2l':
        return { kind: 'long', value: BigInt(x) }
    }
  }
  return { kind: 'operation', op, operands }
}

const ARITHMETIC = new Set([
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
])
const UNARY = new Set([
  'ineg',
  'lneg',
  'fneg',
  'dneg',
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
])

/**
 * Interpret `method` of `file` over its straight-line code. `maxInstructions` bounds the walk (the
 * code itself is at most 64 KiB, and straight-line code runs each instruction once).
 */
export function interpretMethod(file: ClassFile, method: ClassMember): InterpretResult {
  const code = method.code
  if (code === undefined) return { state: 'refused', pc: 0, reason: 'the method has no code' }
  if (code.exceptionHandlers.length > 0)
    return {
      state: 'refused',
      pc: code.exceptionHandlers[0]?.startPc ?? 0,
      reason: 'the method handles exceptions',
    }
  const pool = new ConstantPool(file.constantPool)
  const locals = new Map<number, JvmValue>()
  let slot = 0
  if ((method.accessFlags & 0x0008) === 0) locals.set(slot++, { kind: 'parameter', index: 0 })
  descriptorArguments(method.descriptor).forEach((argument, index) => {
    locals.set(slot, {
      kind: 'parameter',
      index: index + ((method.accessFlags & 0x0008) === 0 ? 1 : 0),
    })
    slot += argument.wide ? 2 : 1
  })
  const stack: JvmValue[] = []
  const calls: JvmCall[] = []
  const stores: JvmStore[] = []
  let objects = 0
  let instruction: Instruction | undefined
  const pc = () => instruction?.pc ?? 0
  const pop = (): JvmValue => {
    const value = stack.pop()
    if (value === undefined) throw new Refusal(pc(), 'the operand stack underflows')
    return value
  }
  const push = (value: JvmValue) => {
    if (stack.length >= code.maxStack)
      throw new Refusal(pc(), 'the operand stack overflows max_stack')
    stack.push(value)
  }
  const load = (index: number) => {
    const value = locals.get(index)
    if (value === undefined) throw new Refusal(pc(), `local ${index} is read before it is written`)
    push(value)
  }
  const constant = (index: number): JvmValue => {
    const entry = pool.entry(index)
    switch (entry.tag) {
      case 'Integer':
        return { kind: 'int', value: entry.value }
      case 'Float':
        return { kind: 'float', value: entry.value }
      case 'Long':
        return { kind: 'long', value: entry.value }
      case 'Double':
        return { kind: 'double', value: entry.value }
      case 'String':
        return { kind: 'string', value: pool.utf8(entry.stringIndex) }
      case 'Class':
        return { kind: 'class', name: pool.className(index) }
      default:
        throw new Refusal(pc(), `ldc of a ${entry.tag} constant is not interpreted`)
    }
  }
  try {
    for (instruction of decodeInstructions(code.code)) {
      const name = instruction.mnemonic
      const operand = instruction.operand ?? 0
      if (name === 'nop') continue
      if (name === 'aconst_null') push({ kind: 'null' })
      else if (name.startsWith('iconst_'))
        push({ kind: 'int', value: name === 'iconst_m1' ? -1 : Number(name.slice(7)) })
      else if (name.startsWith('lconst_')) push({ kind: 'long', value: BigInt(name.slice(7)) })
      else if (name.startsWith('fconst_')) push({ kind: 'float', value: Number(name.slice(7)) })
      else if (name.startsWith('dconst_')) push({ kind: 'double', value: Number(name.slice(7)) })
      else if (name === 'bipush' || name === 'sipush') push({ kind: 'int', value: operand })
      else if (name === 'ldc' || name === 'ldc_w' || name === 'ldc2_w') push(constant(operand))
      else if (/^[ilfda]load$/u.test(name)) load(operand)
      else if (/^[ilfda]load_\d$/u.test(name)) load(Number(name.slice(-1)))
      else if (/^[ilfda]store(_\d)?$/u.test(name)) {
        const value = pop()
        locals.set(name.includes('_') ? Number(name.slice(-1)) : operand, value)
      } else if (name === 'iinc') {
        const index = operand
        const value = locals.get(index)
        if (value === undefined)
          throw new Refusal(pc(), `local ${index} is read before it is written`)
        locals.set(index, fold('iadd', [value, { kind: 'int', value: instruction.second ?? 0 }]))
      } else if (name === 'pop') pop()
      else if (name === 'pop2') {
        if (!isWide(pop())) pop()
      } else if (name === 'dup') {
        const value = pop()
        push(value)
        push(value)
      } else if (name === 'dup_x1') {
        const a = pop()
        const b = pop()
        push(a)
        push(b)
        push(a)
      } else if (name === 'dup2') {
        const a = pop()
        if (isWide(a)) {
          push(a)
          push(a)
        } else {
          const b = pop()
          push(b)
          push(a)
          push(b)
          push(a)
        }
      } else if (name === 'swap') {
        const a = pop()
        const b = pop()
        push(a)
        push(b)
      } else if (ARITHMETIC.has(name)) {
        const right = pop()
        const left = pop()
        push(fold(name, [left, right]))
      } else if (UNARY.has(name)) push(fold(name, [pop()]))
      else if (name === 'new')
        push({ kind: 'object', className: pool.className(operand), id: objects++ })
      else if (name === 'newarray' || name === 'anewarray') {
        const length = pop()
        if (length.kind !== 'int' || length.value < 0 || length.value > 65536)
          throw new Refusal(pc(), 'an array length is not a small constant')
        push({
          kind: 'array',
          elementType: name === 'newarray' ? arrayTypeName(operand) : pool.className(operand),
          elements: new Array<JvmValue | undefined>(length.value).fill(undefined),
        })
      } else if (/^[ilfdabcs]astore$/u.test(name)) {
        const value = pop()
        const index = pop()
        const array = pop()
        if (
          array.kind !== 'array' ||
          index.kind !== 'int' ||
          index.value < 0 ||
          index.value >= array.elements.length
        )
          throw new Refusal(pc(), 'an array store is not to a known array at a constant index')
        array.elements[index.value] = value
      } else if (name === 'checkcast') {
        // the value is unchanged; the cast only narrows its static type
      } else if (name === 'getstatic') {
        const { owner, name: field, descriptor } = pool.member(operand)
        push({ kind: 'static', owner, name: field, descriptor })
      } else if (name === 'getfield') {
        const { owner, name: field, descriptor } = pool.member(operand)
        push({ kind: 'field', target: pop(), owner, name: field, descriptor })
      } else if (name === 'putstatic' || name === 'putfield') {
        const { owner, name: field } = pool.member(operand)
        const value = pop()
        const target = name === 'putfield' ? pop() : undefined
        stores.push({
          pc: pc(),
          ...(target === undefined ? {} : { target }),
          owner,
          name: field,
          value,
        })
      } else if (name.startsWith('invoke')) {
        let owner: string
        let method: string
        let descriptor: string
        if (name === 'invokedynamic') {
          const entry = pool.entry(operand)
          if (entry.tag !== 'InvokeDynamic')
            throw new Refusal(pc(), 'invokedynamic names no call site')
          const site = pool.nameAndType(entry.nameAndTypeIndex)
          owner = `#bootstrap${entry.bootstrapIndex}`
          method = site.name
          descriptor = site.descriptor
        } else {
          const member = pool.member(operand)
          owner = member.owner
          method = member.name
          descriptor = member.descriptor
        }
        const count = descriptorArguments(descriptor).length
        const args: JvmValue[] = []
        for (let index = 0; index < count; index += 1) args.unshift(pop())
        const invoke = name as JvmCall['invoke']
        const receiver = invoke === 'invokestatic' || invoke === 'invokedynamic' ? undefined : pop()
        const index = calls.length
        calls.push({
          pc: pc(),
          invoke,
          owner,
          name: method,
          descriptor,
          ...(receiver === undefined ? {} : { receiver }),
          args,
        })
        if (
          invoke === 'invokespecial' &&
          method === '<init>' &&
          receiver?.kind === 'object' &&
          receiver.init === undefined
        )
          receiver.init = index
        else if (returnsValue(descriptor)) push({ kind: 'result', call: index })
      } else if (/^[ilfda]?return$/u.test(name)) {
        const returned = name === 'return' ? undefined : pop()
        return { state: 'ok', calls, stores, ...(returned === undefined ? {} : { returned }) }
      } else throw new Refusal(pc(), `${name} is outside the straight-line subset`)
    }
    return { state: 'refused', pc: pc(), reason: 'the code runs off its end' }
  } catch (error) {
    if (error instanceof Refusal) return { state: 'refused', pc: error.pc, reason: error.message }
    throw error
  }
}
