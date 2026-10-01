/**
 * The bounded constant interpreter (D2): walks one method's bytecode abstractly and reports the
 * calls it makes, with their arguments as constants or as symbolic values (a static field, a
 * parameter, another call's result). Nothing is executed. A branch or switch whose condition folds
 * to a constant follows its side, so a loop over a constant bound unrolls, within an instruction
 * budget; a condition over a symbol, a throw, an exception handler or any instruction outside this
 * subset refuses the method with its program counter and reason, and hands back what was recorded
 * up to there, so a caller can use it and name what it skipped.
 *
 * Builder code such as a model definition (`CubeListBuilder.create().texOffs(0, 0).addBox(...)`)
 * is straight-line with constant arguments and reads back as a list of calls. Code that reads the
 * model's state (`setupAnim`: fields, arrays of parts, static tables) folds when the caller answers
 * those reads through `heap`.
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
  | { readonly kind: 'methodType'; readonly descriptor: string }
  /** A method handle constant: `referenceKind` 1–9 (JVMS §5.4.3.5), the member it names. */
  | {
      readonly kind: 'methodHandle'
      readonly referenceKind: number
      readonly owner: string
      readonly name: string
      readonly descriptor: string
    }
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
  /** Arithmetic, a comparison or a conversion over values that are not all constants. */
  | { readonly kind: 'operation'; readonly op: string; readonly operands: readonly JvmValue[] }

export interface JvmCall {
  /** Order among calls and stores, one counter for both: a store in an unrolled loop falls between its calls. */
  readonly step: number
  readonly pc: number
  readonly invoke:
    'invokevirtual' | 'invokespecial' | 'invokestatic' | 'invokeinterface' | 'invokedynamic'
  /** The method's class; for `invokedynamic`, the bootstrap method's class. */
  readonly owner: string
  /** The method's name; for `invokedynamic`, the call site's (`accept`, `makeConcatWithConstants`). */
  readonly name: string
  readonly descriptor: string
  /** Absent for static and dynamic calls. */
  readonly receiver?: JvmValue
  readonly args: readonly JvmValue[]
  /**
   * `invokedynamic` only: the bootstrap method and its static arguments — for a lambda, the
   * LambdaMetafactory's method types and the implementation handle; for string concatenation,
   * the recipe and its constants.
   */
  readonly bootstrap?: {
    readonly name: string
    readonly descriptor: string
    readonly args: readonly JvmValue[]
  }
}

export interface JvmStore {
  /** See {@link JvmCall.step}. */
  readonly step: number
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
  | {
      readonly state: 'refused'
      readonly pc: number
      readonly reason: string
      /** What the walk recorded before it stopped. */
      readonly calls: readonly JvmCall[]
      readonly stores: readonly JvmStore[]
    }

export interface JvmField {
  readonly owner: string
  readonly name: string
  readonly descriptor: string
}

/**
 * The caller's answers for the memory a method reads. A field the method itself wrote before
 * reading it (on the same object, parameter or class) reads back what it wrote, ahead of these. An answer replaces the symbolic value, so a
 * constant folds branches and unrolls loops; `undefined` keeps the read symbolic (an array read
 * then refuses, as without a heap). An object the caller hands out is `{ kind: 'object',
 * className, id }` with its own ids, an array `{ kind: 'array', elementType, elements }` or
 * answered through `arrayLength` and `arrayElement`. A static table a class fills in `<clinit>`
 * is the value of that method's `putstatic` store, read with this interpreter.
 */
export interface JvmHeap {
  getStatic?(field: JvmField): JvmValue | undefined
  getField?(target: JvmValue, field: JvmField): JvmValue | undefined
  arrayLength?(array: JvmValue): number | undefined
  arrayElement?(array: JvmValue, index: number): JvmValue | undefined
  /**
   * What a call returns (a getter: `state.getArmPose(arm).isTwoHanded()`), in place of the
   * symbol `{ kind: 'result', call }`. The call stays recorded: the caller still makes it, the
   * heap only tells what it gives back. Not asked for constructors or `invokedynamic`.
   */
  invoke?(call: JvmCall): JvmValue | undefined
}

export interface InterpretOptions {
  /** Values for the parameters (`this` first for an instance method); the rest stay symbolic. */
  readonly args?: readonly (JvmValue | undefined)[]
  /** Instructions walked at most, loops unrolled included. Default 100 000. */
  readonly maxInstructions?: number
  readonly heap?: JvmHeap
  /** The id of the first object `new` makes here, above the ids of the caller's objects. Default 0. */
  readonly firstObjectId?: number
}

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

const INT_MIN = -2147483648
const INT_MAX = 2147483647
const LONG_MIN = -(2n ** 63n)
const LONG_MAX = 2n ** 63n - 1n

type Numeric = { readonly kind: 'int' | 'float' | 'double'; readonly value: number }
const isNumeric = (value: JvmValue | undefined): value is Numeric =>
  value !== undefined && (value.kind === 'int' || value.kind === 'float' || value.kind === 'double')

function toInt(value: number): number {
  return Number.isNaN(value) ? 0 : Math.max(INT_MIN, Math.min(INT_MAX, Math.trunc(value)))
}

function toLong(value: number): bigint {
  if (Number.isNaN(value)) return 0n
  if (value >= 2 ** 63) return LONG_MAX
  if (value <= -(2 ** 63)) return LONG_MIN
  return BigInt(Math.trunc(value))
}

/** Fold `op` over constant operands with Java semantics; otherwise a symbolic operation. */
function fold(op: string, operands: readonly JvmValue[]): JvmValue {
  const [a, b] = operands
  const symbolic: JvmValue = { kind: 'operation', op, operands }
  if (a?.kind === 'long' && (b === undefined || b.kind === 'long' || b.kind === 'int')) {
    const x = a.value
    const y = b === undefined ? 0n : b.kind === 'long' ? b.value : BigInt(b.value)
    const long = (value: bigint): JvmValue => ({ kind: 'long', value: BigInt.asIntN(64, value) })
    switch (op) {
      case 'ladd':
        return long(x + y)
      case 'lsub':
        return long(x - y)
      case 'lmul':
        return long(x * y)
      case 'ldiv':
        return y === 0n ? symbolic : long(x / y)
      case 'lrem':
        return y === 0n ? symbolic : long(x % y)
      case 'lneg':
        return long(-x)
      case 'land':
        return long(x & y)
      case 'lor':
        return long(x | y)
      case 'lxor':
        return long(x ^ y)
      case 'lshl':
        return long(x << (y & 63n))
      case 'lshr':
        return long(x >> (y & 63n))
      case 'lushr':
        return long(BigInt.asUintN(64, x) >> (y & 63n))
      case 'lcmp':
        return { kind: 'int', value: x < y ? -1 : x > y ? 1 : 0 }
      case 'l2i':
        return { kind: 'int', value: Number(BigInt.asIntN(32, x)) }
      case 'l2f':
        return { kind: 'float', value: Math.fround(Number(x)) }
      case 'l2d':
        return { kind: 'double', value: Number(x) }
    }
    return symbolic
  }
  if (!operands.every(isNumeric)) return symbolic
  const x = (a as Numeric).value
  const y = (b as Numeric | undefined)?.value ?? 0
  switch (op) {
    case 'i2l':
      return { kind: 'long', value: BigInt(x) }
    case 'f2l':
    case 'd2l':
      return { kind: 'long', value: toLong(x) }
    case 'i2f':
    case 'd2f':
      return { kind: 'float', value: Math.fround(x) }
    case 'i2d':
    case 'f2d':
      return { kind: 'double', value: x }
    case 'f2i':
    case 'd2i':
      return { kind: 'int', value: toInt(x) }
    case 'i2b':
      return { kind: 'int', value: (x << 24) >> 24 }
    case 'i2c':
      return { kind: 'int', value: x & 0xffff }
    case 'i2s':
      return { kind: 'int', value: (x << 16) >> 16 }
    case 'fcmpl':
    case 'fcmpg':
    case 'dcmpl':
    case 'dcmpg':
      if (Number.isNaN(x) || Number.isNaN(y))
        return { kind: 'int', value: op.endsWith('l') ? -1 : 1 }
      return { kind: 'int', value: x < y ? -1 : x > y ? 1 : 0 }
  }
  const kind =
    op[0] === 'i' ? 'int' : op[0] === 'f' ? 'float' : op[0] === 'd' ? 'double' : undefined
  if (kind === undefined) return symbolic
  const typed = (value: number): JvmValue =>
    kind === 'int'
      ? { kind, value: value | 0 }
      : kind === 'float'
        ? { kind, value: Math.fround(value) }
        : { kind, value }
  switch (op.slice(1)) {
    case 'add':
      return typed(x + y)
    case 'sub':
      return typed(x - y)
    case 'mul':
      return kind === 'int' ? typed(Math.imul(x, y)) : typed(x * y)
    case 'div':
      // integer division by zero throws in the JVM: keep it symbolic
      return kind === 'int' ? (y === 0 ? symbolic : typed(Math.trunc(x / y))) : typed(x / y)
    case 'rem':
      return kind === 'int' && y === 0 ? symbolic : typed(x % y)
    case 'neg':
      return typed(-x)
  }
  if (kind !== 'int') return symbolic
  switch (op) {
    case 'ishl':
      return typed(x << (y & 31))
    case 'ishr':
      return typed(x >> (y & 31))
    case 'iushr':
      return typed(x >>> (y & 31))
    case 'iand':
      return typed(x & y)
    case 'ior':
      return typed(x | y)
    case 'ixor':
      return typed(x ^ y)
  }
  return symbolic
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
  'lcmp',
  'fcmpl',
  'fcmpg',
  'dcmpl',
  'dcmpg',
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
const NON_NULL = new Set(['string', 'class', 'object', 'array', 'methodType', 'methodHandle'])

/** Whether a two-way branch is taken, or undefined when its condition is not a constant. */
function branchTaken(name: string, operands: readonly JvmValue[]): boolean | undefined {
  const [a, b] = operands
  const compare = (x: number, y: number) => {
    switch (name.replace('if_icmp', 'if')) {
      case 'ifeq':
        return x === y
      case 'ifne':
        return x !== y
      case 'iflt':
        return x < y
      case 'ifge':
        return x >= y
      case 'ifgt':
        return x > y
      case 'ifle':
        return x <= y
    }
    return undefined
  }
  if (name === 'ifnull' || name === 'ifnonnull') {
    if (a === undefined) return undefined
    const isNull = a.kind === 'null' ? true : NON_NULL.has(a.kind) ? false : undefined
    return isNull === undefined ? undefined : name === 'ifnull' ? isNull : !isNull
  }
  if (name === 'if_acmpeq' || name === 'if_acmpne') {
    if (a === undefined || b === undefined) return undefined
    // the same tracked object (by id: the caller's heap may answer one object twice), or two
    // nulls, are equal; two different objects are not
    const same =
      a === b ||
      (a.kind === 'null' && b.kind === 'null') ||
      (a.kind === 'object' && b.kind === 'object' && a.id === b.id)
    const different =
      !same &&
      (a.kind === 'object' || a.kind === 'array' || a.kind === 'null') &&
      (b.kind === 'object' || b.kind === 'array' || b.kind === 'null')
    if (!same && !different) return undefined
    return name === 'if_acmpeq' ? same : !same
  }
  if (a?.kind !== 'int') return undefined
  if (name.startsWith('if_icmp')) return b?.kind === 'int' ? compare(a.value, b.value) : undefined
  return compare(a.value, 0)
}

/**
 * Interpret `method` of `file`. Each instruction walked counts against `maxInstructions`, so a
 * constant loop unrolls until the budget and then refuses.
 */
export function interpretMethod(
  file: ClassFile,
  method: ClassMember,
  options: InterpretOptions = {},
): InterpretResult {
  const calls: JvmCall[] = []
  const stores: JvmStore[] = []
  const refused = (pc: number, reason: string): InterpretResult => ({
    state: 'refused',
    pc,
    reason,
    calls,
    stores,
  })
  const code = method.code
  if (code === undefined) return refused(0, 'the method has no code')
  if (code.exceptionHandlers.length > 0)
    return refused(code.exceptionHandlers[0]?.startPc ?? 0, 'the method handles exceptions')
  const pool = new ConstantPool(file.constantPool)
  const isStatic = (method.accessFlags & 0x0008) !== 0
  const locals = new Map<number, JvmValue>()
  let slot = 0
  let parameter = 0
  const bind = (wide: boolean) => {
    locals.set(slot, options.args?.[parameter] ?? { kind: 'parameter', index: parameter })
    parameter += 1
    slot += wide ? 2 : 1
  }
  if (!isStatic) bind(false)
  for (const argument of descriptorArguments(method.descriptor)) bind(argument.wide)
  const instructions = decodeInstructions(code.code)
  const byPc = new Map(instructions.map((item, index) => [item.pc, index]))
  const stack: JvmValue[] = []
  let objects = options.firstObjectId ?? 0
  let step = 0
  const heap = options.heap
  /** Fields the method wrote, by target and field: what it reads back. */
  const written = new Map<string, JvmValue>()
  const targetKey = (target: JvmValue | undefined): string | undefined =>
    target === undefined
      ? 'static'
      : target.kind === 'object'
        ? `object:${target.id}`
        : target.kind === 'parameter'
          ? `parameter:${target.index}`
          : undefined
  const fieldKey = (target: JvmValue | undefined, owner: string, field: string) => {
    const at = targetKey(target)
    return at === undefined ? undefined : `${at}|${owner}.${field}`
  }
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
      case 'MethodType':
        return { kind: 'methodType', descriptor: pool.utf8(entry.descriptorIndex) }
      case 'MethodHandle': {
        // the member's own `kind` (Methodref …) must not replace this value's
        const { owner, name, descriptor } = pool.member(entry.referenceIndex)
        return { kind: 'methodHandle', referenceKind: entry.kind, owner, name, descriptor }
      }
      default:
        throw new Refusal(pc(), `a ${entry.tag} constant is not interpreted`)
    }
  }
  const budget = options.maxInstructions ?? 100_000
  let walked = 0
  let index = 0
  try {
    for (;;) {
      instruction = instructions[index]
      if (instruction === undefined) return refused(pc(), 'the code runs off its end')
      if ((walked += 1) > budget)
        throw new Refusal(instruction.pc, `the instruction budget of ${budget} is spent`)
      let next = index + 1
      const jump = (target: number | undefined) => {
        const at = target === undefined ? undefined : byPc.get(target)
        if (at === undefined) throw new Refusal(pc(), `a branch to ${target} is not an instruction`)
        next = at
      }
      const name = instruction.mnemonic
      const operand = instruction.operand ?? 0
      if (name === 'nop') {
        // nothing
      } else if (name === 'aconst_null') push({ kind: 'null' })
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
        const value = locals.get(operand)
        if (value === undefined)
          throw new Refusal(pc(), `local ${operand} is read before it is written`)
        locals.set(operand, fold('iadd', [value, { kind: 'int', value: instruction.second ?? 0 }]))
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
      else if (name.startsWith('if')) {
        const operands = name.startsWith('if_') ? [pop(), pop()].reverse() : [pop()]
        const taken = branchTaken(name, operands)
        if (taken === undefined)
          throw new Refusal(pc(), `${name} tests a value that is not a constant`)
        if (taken) jump(instruction.targets?.[0])
      } else if (name === 'goto' || name === 'goto_w') jump(instruction.targets?.[0])
      else if (name === 'tableswitch' || name === 'lookupswitch') {
        const key = pop()
        if (key.kind !== 'int')
          throw new Refusal(pc(), `${name} tests a value that is not a constant`)
        const at = instruction.keys?.indexOf(key.value) ?? -1
        jump(instruction.targets?.[at + 1])
      } else if (name === 'new')
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
      } else if (name === 'arraylength') {
        const array = pop()
        const length = array.kind === 'array' ? array.elements.length : heap?.arrayLength?.(array)
        if (length === undefined || !Number.isSafeInteger(length) || length < 0)
          throw new Refusal(pc(), 'arraylength of an unknown array')
        push({ kind: 'int', value: length })
      } else if (/^[ilfdabcs]aload$/u.test(name)) {
        const at = pop()
        const array = pop()
        const element =
          at.kind !== 'int'
            ? undefined
            : array.kind === 'array'
              ? array.elements[at.value]
              : heap?.arrayElement?.(array, at.value)
        if (element === undefined)
          throw new Refusal(pc(), 'an array load is not of a known element at a constant index')
        push(element)
      } else if (/^[ilfdabcs]astore$/u.test(name)) {
        const value = pop()
        const at = pop()
        const array = pop()
        if (
          array.kind !== 'array' ||
          at.kind !== 'int' ||
          at.value < 0 ||
          at.value >= array.elements.length
        )
          throw new Refusal(pc(), 'an array store is not to a known array at a constant index')
        array.elements[at.value] = value
      } else if (name === 'checkcast') {
        // the value is unchanged; the cast only narrows its static type
      } else if (name === 'getstatic') {
        const { owner, name: field, descriptor } = pool.member(operand)
        push(
          written.get(fieldKey(undefined, owner, field)!) ??
            heap?.getStatic?.({ owner, name: field, descriptor }) ?? {
              kind: 'static',
              owner,
              name: field,
              descriptor,
            },
        )
      } else if (name === 'getfield') {
        const { owner, name: field, descriptor } = pool.member(operand)
        const target = pop()
        const key = fieldKey(target, owner, field)
        push(
          (key === undefined ? undefined : written.get(key)) ??
            heap?.getField?.(target, { owner, name: field, descriptor }) ?? {
              kind: 'field',
              target,
              owner,
              name: field,
              descriptor,
            },
        )
      } else if (name === 'putstatic' || name === 'putfield') {
        const { owner, name: field } = pool.member(operand)
        const value = pop()
        const target = name === 'putfield' ? pop() : undefined
        const key = fieldKey(target, owner, field)
        if (key !== undefined) written.set(key, value)
        stores.push({
          step: step++,
          pc: pc(),
          ...(target === undefined ? {} : { target }),
          owner,
          name: field,
          value,
        })
      } else if (name.startsWith('invoke')) {
        const invoke = name as JvmCall['invoke']
        let owner: string
        let called: string
        let descriptor: string
        let bootstrap: JvmCall['bootstrap']
        if (invoke === 'invokedynamic') {
          const entry = pool.entry(operand)
          if (entry.tag !== 'InvokeDynamic')
            throw new Refusal(pc(), 'invokedynamic names no call site')
          const site = pool.nameAndType(entry.nameAndTypeIndex)
          const linked = file.bootstrapMethods[entry.bootstrapIndex]
          if (linked === undefined) throw new Refusal(pc(), 'the call site has no bootstrap method')
          const handle = constant(linked.methodIndex)
          if (handle.kind !== 'methodHandle')
            throw new Refusal(pc(), 'the bootstrap method is not a method handle')
          owner = handle.owner
          called = site.name
          descriptor = site.descriptor
          bootstrap = {
            name: handle.name,
            descriptor: handle.descriptor,
            args: linked.argumentIndexes.map(constant),
          }
        } else {
          const member = pool.member(operand)
          owner = member.owner
          called = member.name
          descriptor = member.descriptor
        }
        const args: JvmValue[] = []
        for (let count = descriptorArguments(descriptor).length; count > 0; count -= 1)
          args.unshift(pop())
        const receiver = invoke === 'invokestatic' || invoke === 'invokedynamic' ? undefined : pop()
        const at = calls.length
        calls.push({
          step: step++,
          pc: pc(),
          invoke,
          owner,
          name: called,
          descriptor,
          ...(receiver === undefined ? {} : { receiver }),
          args,
          ...(bootstrap === undefined ? {} : { bootstrap }),
        })
        if (
          invoke === 'invokespecial' &&
          called === '<init>' &&
          receiver?.kind === 'object' &&
          receiver.init === undefined
        )
          receiver.init = at
        else if (returnsValue(descriptor))
          push(
            (invoke === 'invokedynamic' || called === '<init>'
              ? undefined
              : heap?.invoke?.(calls[at]!)) ?? { kind: 'result', call: at },
          )
      } else if (/^[ilfda]?return$/u.test(name)) {
        const returned = name === 'return' ? undefined : pop()
        return { state: 'ok', calls, stores, ...(returned === undefined ? {} : { returned }) }
      } else throw new Refusal(pc(), `${name} is outside the interpreted subset`)
      index = next
    }
  } catch (error) {
    if (error instanceof Refusal) return refused(error.pc, error.message)
    throw error
  }
}
