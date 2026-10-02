import type {
  AstExpr,
  AstExprCall,
  AstExprFunction,
  AstLocal,
  AstStat,
  AstStatBlock,
  LuaBinaryOp,
  LuaParseResult,
  LuaRange,
} from './ast.js'
import type { LuaStaticEntry, LuaStaticKey, LuaStaticValue } from './literal.js'
import {
  cFormat,
  luaNumberText,
  luaPatternFind,
  luaPatternIsPlain,
  luaPatternMatchAt,
  LuaPatternError,
  type LuaCaptureValue,
} from './lua-strings.js'

/**
 * A bounded evaluator of Lua data scripts (decision 30 (b)): what a definition file computes —
 * loops that build tables (`for i = 0, 15 do features["treetype" .. i] = { … } end`), local
 * functions, closures, string and math — without input, output or the host. Every statement,
 * expression and library step costs one of `maxSteps`; calls nest at most `maxDepth` deep; tables
 * and strings stay within their limits. A script past a limit is refused, not cut short.
 *
 * The base library is Lua 5.1's pure part (`pairs`, `ipairs`, `select`, `tostring`, `pcall`,
 * `setmetatable`…), `string` (patterns and `format` included), `math` (with a seeded, reported
 * `random`) and `table`. Nothing reads files, the clock or the environment; a host that wants
 * `VFS.Include` or `Spring.GetModOptions` passes them as `globals`. Numbers are doubles and print as
 * Lua 5.1 prints them (`%.14g`); `goto` is refused.
 *
 * Static reading (`readLuaModule`) stays the way to read a file without running it; the result here
 * converts to the same `LuaStaticValue` tree (`luaValueToStatic`).
 */

export type LuaValue = undefined | boolean | number | string | LuaTable | LuaFunction

export interface LuaEvaluationLimits {
  /** Statements, expressions and library steps together. */
  readonly maxSteps: number
  /** Nested calls. Default 200. */
  readonly maxDepth?: number
  /** Entries of all tables together. Default 1 000 000. */
  readonly maxTableEntries?: number
  /** Length of one string. Default 16 MiB. */
  readonly maxStringLength?: number
}

export interface LuaEvaluationOptions extends LuaEvaluationLimits {
  /**
   * Globals the host provides besides the library (`VFS`, `Spring`, a `UnitBlueprint` that collects
   * its argument). A native function receives its arguments and returns its results.
   */
  readonly globals?: Readonly<Record<string, LuaValue>>
  /**
   * The global table to run in: a host that runs several chunks in one state (a game's library
   * files before its definitions, Recoil's `VFS.Include`) passes the `globals` an earlier run
   * returned, with what it defined (`table.copy`). Absent, a fresh table with the library.
   */
  readonly globalTable?: LuaTable
  /** Seed of `math.random`; 0 by default. A script that draws a number says so (`usedRandom`). */
  readonly randomSeed?: number
  /** Varargs of the chunk (`...`). */
  readonly arguments?: readonly LuaValue[]
  readonly signal?: AbortSignal
}

export type LuaEvaluationResult =
  | {
      readonly state: 'returned'
      /** What the chunk's `return` gave. */
      readonly values: readonly LuaValue[]
      /** The global table after the run: data files that set globals instead of returning. */
      readonly globals: LuaTable
      readonly steps: number
      readonly usedRandom: boolean
    }
  | {
      readonly state: 'failed'
      /** A Lua error: `error(…)`, indexing nil, calling a non-function. */
      readonly code: 'runtime-error'
      readonly message: string
      readonly range?: LuaRange
      readonly steps: number
    }
  | {
      readonly state: 'refused'
      readonly code: 'step-limit' | 'depth-limit' | 'table-limit' | 'string-limit' | 'unsupported'
      readonly message: string
      readonly range?: LuaRange
      readonly steps: number
    }

/** A Lua table: keys by value, numbers normalized (−0 is 0), nil values absent. */
export class LuaTable {
  readonly entries = new Map<Exclude<LuaValue, undefined>, Exclude<LuaValue, undefined>>()
  metatable: LuaTable | undefined
  /** Where the constructor that made it stands, for reports. */
  readonly range: LuaRange | undefined
  /** A border found before: `#t` starts from here. */
  private border = 0
  /**
   * The positional items its constructor gave, whose last was not nil: Lua sizes the array part by
   * them, so `#{ 1, nil, 3 }` is 3, as the reference prints it.
   */
  arrayHint = 0

  constructor(range?: LuaRange) {
    this.range = range
  }

  get(key: LuaValue): LuaValue {
    if (key === undefined) return undefined
    return this.entries.get(typeof key === 'number' && Object.is(key, -0) ? 0 : key)
  }

  set(key: LuaValue, value: LuaValue): void {
    if (key === undefined) throw new LuaRuntimeError('table index is nil')
    if (typeof key === 'number' && Number.isNaN(key))
      throw new LuaRuntimeError('table index is NaN')
    const normalized = typeof key === 'number' && Object.is(key, -0) ? 0 : key
    if (value === undefined) {
      this.entries.delete(normalized)
      if (typeof normalized === 'number' && normalized <= this.border) this.border = normalized - 1
    } else this.entries.set(normalized, value)
  }

  /** A border: n with t[n] present and t[n + 1] absent (0 when t[1] is absent). */
  length(): number {
    if (
      this.arrayHint > 0 &&
      this.entries.has(this.arrayHint) &&
      !this.entries.has(this.arrayHint + 1)
    )
      return this.arrayHint
    let n = Math.max(0, this.border)
    if (n > 0 && !this.entries.has(n)) n = 0
    while (this.entries.has(n + 1)) n++
    this.border = n
    return n
  }
}

/** A function: a closure of the script, or one the library or the host provides. */
export class LuaFunction {
  constructor(
    readonly name: string,
    readonly call: (args: readonly LuaValue[]) => LuaValue[],
  ) {}
}

/** A Lua error raised while running; `pcall` catches it, the evaluator reports it. */
export class LuaRuntimeError extends Error {
  constructor(
    message: string,
    readonly value: LuaValue = message,
    public range?: LuaRange,
  ) {
    super(message)
  }
}

/** A limit reached: no Lua code may catch it. */
class LuaRefusal extends Error {
  constructor(
    readonly code: Extract<LuaEvaluationResult, { state: 'refused' }>['code'],
    message: string,
    readonly range?: LuaRange,
  ) {
    super(message)
  }
}

interface Cell {
  value: LuaValue
}

class Scope {
  readonly cells = new Map<string, Cell>()
  constructor(
    readonly parent: Scope | undefined,
    readonly varargs: readonly LuaValue[] | undefined,
  ) {}

  find(name: string): Cell | undefined {
    for (let scope: Scope | undefined = this; scope !== undefined; scope = scope.parent) {
      const cell = scope.cells.get(name)
      if (cell !== undefined) return cell
    }
    return undefined
  }

  declare(name: string, value: LuaValue): void {
    this.cells.set(name, { value })
  }

  get vararg(): readonly LuaValue[] {
    for (let scope: Scope | undefined = this; scope !== undefined; scope = scope.parent)
      if (scope.varargs !== undefined) return scope.varargs
    return []
  }
}

type Flow =
  | undefined
  | { readonly kind: 'break' }
  | { readonly kind: 'continue' }
  | { readonly kind: 'return'; readonly values: LuaValue[] }

const BREAK: Flow = Object.freeze({ kind: 'break' })
const CONTINUE: Flow = Object.freeze({ kind: 'continue' })

const truthy = (value: LuaValue): boolean => value !== undefined && value !== false

export function luaType(value: LuaValue): string {
  if (value === undefined) return 'nil'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') return 'string'
  if (value instanceof LuaTable) return 'table'
  return 'function'
}

/** Lua's `tonumber` of a string, decimal or hexadecimal, or undefined. */
function stringNumber(text: string): number | undefined {
  const trimmed = text.trim()
  if (/^[-+]?0[xX][0-9a-fA-F]+$/u.test(trimmed)) {
    const negative = trimmed.startsWith('-')
    const value = Number.parseInt(trimmed.replace(/^[-+]/u, ''), 16)
    return negative ? -value : value
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/u.test(trimmed)) {
    if (/^[-+]?(inf|nan)$/iu.test(trimmed)) return undefined
    return undefined
  }
  return Number(trimmed)
}

const ARITHMETIC: Partial<Record<LuaBinaryOp, string>> = {
  Add: '__add',
  Sub: '__sub',
  Mul: '__mul',
  Div: '__div',
  Mod: '__mod',
  Pow: '__pow',
  FloorDiv: '__idiv',
  BitAnd: '__band',
  BitOr: '__bor',
  BitXor: '__bxor',
  Shl: '__shl',
  Shr: '__shr',
}

class Evaluator {
  steps = 0
  depth = 0
  tableEntries = 0
  usedRandom = false
  readonly globals: LuaTable
  private nextId = 1
  private readonly ids = new WeakMap<object, number>()
  private random: number
  private readonly maxDepth: number
  private readonly maxTableEntries: number
  private readonly maxStringLength: number

  constructor(private readonly options: LuaEvaluationOptions) {
    this.maxDepth = options.maxDepth ?? 200
    this.maxTableEntries = options.maxTableEntries ?? 1_000_000
    this.maxStringLength = options.maxStringLength ?? 16 * 1024 * 1024
    this.random = (options.randomSeed ?? 0) >>> 0
    if (!Number.isSafeInteger(options.maxSteps) || options.maxSteps <= 0)
      throw new TypeError('maxSteps is a positive safe integer')
    this.globals = options.globalTable ?? new LuaTable()
    // a table an earlier run filled keeps its library, with what that run added to it
    if (this.globals.get('_G') === undefined) installLibrary(this)
    this.stringMetatable.set('__index', this.globals.get('string'))
    for (const [name, value] of Object.entries(options.globals ?? {})) this.globals.set(name, value)
  }

  tick(range?: LuaRange): void {
    if (++this.steps > this.options.maxSteps)
      throw new LuaRefusal(
        'step-limit',
        `the script ran past ${this.options.maxSteps} steps`,
        range,
      )
    if ((this.steps & 0xfff) === 0) this.options.signal?.throwIfAborted()
  }

  newTable(range?: LuaRange): LuaTable {
    return new LuaTable(range)
  }

  /** Writes a table entry, counting a new key against the table limit. */
  rawSet(table: LuaTable, key: LuaValue, value: LuaValue): void {
    const had = key !== undefined && table.get(key) !== undefined
    table.set(key, value)
    if (!had && value !== undefined && ++this.tableEntries > this.maxTableEntries)
      throw new LuaRefusal(
        'table-limit',
        `the script made more than ${this.maxTableEntries} table entries`,
      )
  }

  checkString(text: string): string {
    this.checkLength(text.length)
    return text
  }

  /** Refuses a string of `length` characters before it is built. */
  checkLength(length: number): void {
    if (length > this.maxStringLength)
      throw new LuaRefusal('string-limit', `a string grew past ${this.maxStringLength} characters`)
  }

  idOf(value: object): string {
    let id = this.ids.get(value)
    if (id === undefined) this.ids.set(value, (id = this.nextId++))
    return `0x${id.toString(16).padStart(8, '0')}`
  }

  nextRandom(): number {
    this.usedRandom = true
    // mulberry32: a fixed sequence for a fixed seed
    this.random = (this.random + 0x6d2b79f5) >>> 0
    let t = this.random
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  // ---- metatables -----------------------------------------------------------------------

  metamethod(value: LuaValue, event: string): LuaValue {
    if (value instanceof LuaTable) return value.metatable?.get(event)
    if (typeof value === 'string') return this.stringMetatable.get(event)
    return undefined
  }

  readonly stringMetatable = new LuaTable()

  index(target: LuaValue, key: LuaValue, range?: LuaRange): LuaValue {
    for (let loop = 0; loop < 100; loop++) {
      if (target instanceof LuaTable) {
        const value = target.get(key)
        if (value !== undefined) return value
        const handler = target.metatable?.get('__index')
        if (handler === undefined) return undefined
        if (handler instanceof LuaFunction) return this.call(handler, [target, key], range)[0]
        target = handler
        continue
      }
      const handler = this.metamethod(target, '__index')
      if (handler === undefined)
        throw new LuaRuntimeError(
          `attempt to index a ${luaType(target)} value${typeof key === 'string' ? ` (field '${key}')` : ''}`,
          undefined,
          range,
        )
      if (handler instanceof LuaFunction) return this.call(handler, [target, key], range)[0]
      target = handler
    }
    throw new LuaRuntimeError("'__index' chain too long; possible loop", undefined, range)
  }

  assign(target: LuaValue, key: LuaValue, value: LuaValue, range?: LuaRange): void {
    for (let loop = 0; loop < 100; loop++) {
      if (target instanceof LuaTable) {
        const handler =
          target.get(key) === undefined ? target.metatable?.get('__newindex') : undefined
        if (handler === undefined) {
          this.rawSet(target, key, value)
          return
        }
        if (handler instanceof LuaFunction) {
          this.call(handler, [target, key, value], range)
          return
        }
        target = handler
        continue
      }
      const handler = this.metamethod(target, '__newindex')
      if (handler === undefined)
        throw new LuaRuntimeError(`attempt to index a ${luaType(target)} value`, undefined, range)
      if (handler instanceof LuaFunction) {
        this.call(handler, [target, key, value], range)
        return
      }
      target = handler
    }
    throw new LuaRuntimeError("'__newindex' chain too long; possible loop", undefined, range)
  }

  call(callee: LuaValue, args: readonly LuaValue[], range?: LuaRange): LuaValue[] {
    if (!(callee instanceof LuaFunction)) {
      const handler = this.metamethod(callee, '__call')
      if (handler instanceof LuaFunction) return this.call(handler, [callee, ...args], range)
      throw new LuaRuntimeError(`attempt to call a ${luaType(callee)} value`, undefined, range)
    }
    if (++this.depth > this.maxDepth) {
      this.depth--
      throw new LuaRefusal('depth-limit', `calls nested deeper than ${this.maxDepth}`, range)
    }
    try {
      this.tick(range)
      return callee.call(args)
    } catch (error) {
      if (error instanceof LuaRuntimeError && error.range === undefined) error.range = range
      throw error
    } finally {
      this.depth--
    }
  }

  // ---- values ---------------------------------------------------------------------------

  toNumber(value: LuaValue): number | undefined {
    if (typeof value === 'number') return value
    if (typeof value === 'string') return stringNumber(value)
    return undefined
  }

  tostring(value: LuaValue): string {
    const handler = this.metamethod(value, '__tostring')
    if (handler !== undefined) {
      const text = this.call(handler, [value])[0]
      if (typeof text !== 'string') throw new LuaRuntimeError("'__tostring' must return a string")
      return text
    }
    if (value === undefined) return 'nil'
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    if (typeof value === 'number') return luaNumberText(value)
    if (typeof value === 'string') return value
    return `${luaType(value)}: ${this.idOf(value)}`
  }

  arithmetic(op: LuaBinaryOp, left: LuaValue, right: LuaValue, range?: LuaRange): LuaValue {
    const a = this.toNumber(left)
    const b = this.toNumber(right)
    if (a !== undefined && b !== undefined) {
      switch (op) {
        case 'Add':
          return a + b
        case 'Sub':
          return a - b
        case 'Mul':
          return a * b
        case 'Div':
          return a / b
        case 'Mod':
          return b === Infinity
            ? a >= 0
              ? a
              : b
            : b === -Infinity
              ? a <= 0
                ? a
                : b
              : a - Math.floor(a / b) * b
        case 'Pow':
          return a ** b
        case 'FloorDiv':
          return Math.floor(a / b)
        default:
          return this.bitwise(op, a, b, range)
      }
    }
    const event = ARITHMETIC[op]!
    const handler = this.metamethod(left, event) ?? this.metamethod(right, event)
    if (handler !== undefined) return this.call(handler, [left, right], range)[0]
    const culprit = a === undefined ? left : right
    throw new LuaRuntimeError(
      `attempt to perform arithmetic on a ${luaType(culprit)} value`,
      undefined,
      range,
    )
  }

  private integer(value: number, range?: LuaRange): bigint {
    if (!Number.isInteger(value))
      throw new LuaRuntimeError('number has no integer representation', undefined, range)
    return BigInt.asIntN(64, BigInt(value))
  }

  bitwise(op: LuaBinaryOp, a: number, b: number, range?: LuaRange): number {
    const x = this.integer(a, range)
    const y = this.integer(b, range)
    let result: bigint
    switch (op) {
      case 'BitAnd':
        result = x & y
        break
      case 'BitOr':
        result = x | y
        break
      case 'BitXor':
        result = x ^ y
        break
      case 'Shl':
        result = y >= 64n || y <= -64n ? 0n : y >= 0n ? x << y : BigInt.asUintN(64, x) >> -y
        break
      default:
        result = y >= 64n || y <= -64n ? 0n : y >= 0n ? BigInt.asUintN(64, x) >> y : x << -y
    }
    return Number(BigInt.asIntN(64, result))
  }

  concat(left: LuaValue, right: LuaValue, range?: LuaRange): LuaValue {
    const text = (value: LuaValue) =>
      typeof value === 'string'
        ? value
        : typeof value === 'number'
          ? luaNumberText(value)
          : undefined
    const a = text(left)
    const b = text(right)
    if (a !== undefined && b !== undefined) return this.checkString(a + b)
    const handler = this.metamethod(left, '__concat') ?? this.metamethod(right, '__concat')
    if (handler !== undefined) return this.call(handler, [left, right], range)[0]
    throw new LuaRuntimeError(
      `attempt to concatenate a ${luaType(a === undefined ? left : right)} value`,
      undefined,
      range,
    )
  }

  equals(left: LuaValue, right: LuaValue, range?: LuaRange): boolean {
    if (left === right) return true
    if (left instanceof LuaTable && right instanceof LuaTable) {
      const handler = this.metamethod(left, '__eq') ?? this.metamethod(right, '__eq')
      if (handler !== undefined) return truthy(this.call(handler, [left, right], range)[0])
    }
    return false
  }

  lessThan(left: LuaValue, right: LuaValue, orEqual: boolean, range?: LuaRange): boolean {
    if (typeof left === 'number' && typeof right === 'number')
      return orEqual ? left <= right : left < right
    if (typeof left === 'string' && typeof right === 'string')
      return orEqual ? left <= right : left < right
    const event = orEqual ? '__le' : '__lt'
    const handler = this.metamethod(left, event) ?? this.metamethod(right, event)
    if (handler !== undefined) return truthy(this.call(handler, [left, right], range)[0])
    throw new LuaRuntimeError(
      luaType(left) === luaType(right)
        ? `attempt to compare two ${luaType(left)} values`
        : `attempt to compare ${luaType(left)} with ${luaType(right)}`,
      undefined,
      range,
    )
  }

  length(value: LuaValue, range?: LuaRange): number {
    if (typeof value === 'string') return value.length
    const handler = this.metamethod(value, '__len')
    if (handler !== undefined) {
      const length = this.call(handler, [value], range)[0]
      if (typeof length !== 'number')
        throw new LuaRuntimeError("'__len' must return a number", undefined, range)
      return length
    }
    if (value instanceof LuaTable) return value.length()
    throw new LuaRuntimeError(
      `attempt to get length of a ${luaType(value)} value`,
      undefined,
      range,
    )
  }

  // ---- statements -----------------------------------------------------------------------

  block(block: AstStatBlock, scope: Scope): Flow {
    for (const statement of block.body) {
      const flow = this.statement(statement, scope)
      if (flow !== undefined) return flow
    }
    return undefined
  }

  statement(statement: AstStat, scope: Scope): Flow {
    this.tick(statement.range)
    switch (statement.type) {
      case 'AstStatBlock':
        return this.block(statement, new Scope(scope, undefined))
      case 'AstStatDo':
        return this.block(statement.body, new Scope(scope, undefined))
      case 'AstStatIf': {
        if (truthy(this.expression(statement.condition, scope)))
          return this.block(statement.thenbody, new Scope(scope, undefined))
        const otherwise = statement.elsebody
        if (otherwise === undefined) return undefined
        return otherwise.type === 'AstStatIf'
          ? this.statement(otherwise, scope)
          : this.block(otherwise, new Scope(scope, undefined))
      }
      case 'AstStatWhile':
        while (truthy(this.expression(statement.condition, scope))) {
          const flow = this.block(statement.body, new Scope(scope, undefined))
          if (flow === BREAK) break
          if (flow !== undefined && flow !== CONTINUE) return flow
        }
        return undefined
      case 'AstStatRepeat':
        for (;;) {
          // the condition sees the body's locals
          const inner = new Scope(scope, undefined)
          const flow = this.block(statement.body, inner)
          if (flow === BREAK) break
          if (flow !== undefined && flow !== CONTINUE) return flow
          if (truthy(this.expression(statement.condition, inner))) break
        }
        return undefined
      case 'AstStatBreak':
        return BREAK
      case 'AstStatContinue':
        return CONTINUE
      case 'AstStatReturn':
        return { kind: 'return', values: this.expressions(statement.list, scope) }
      case 'AstStatExpr':
        this.callExpression(statement.expr, scope)
        return undefined
      case 'AstStatLocal': {
        const values = this.expressions(statement.values, scope)
        statement.vars.forEach((variable, index) => scope.declare(variable.name, values[index]))
        return undefined
      }
      case 'AstStatFor':
        return this.numericFor(statement, scope)
      case 'AstStatForIn':
        return this.genericFor(statement, scope)
      case 'AstStatAssign': {
        // targets first (their table and key), then values, then the writes
        const targets = statement.vars.map(target => this.target(target, scope))
        const values = this.expressions(statement.values, scope)
        targets.forEach((write, index) => write(values[index]))
        return undefined
      }
      case 'AstStatCompoundAssign': {
        const write = this.target(statement.var, scope)
        const current = this.expression(statement.var, scope)
        const value = this.expression(statement.value, scope)
        write(this.binary(statement.op, current, value, statement.range))
        return undefined
      }
      case 'AstStatFunction': {
        const func = this.closure(statement.func, scope)
        this.target(statement.name, scope)(func)
        return undefined
      }
      case 'AstStatLocalFunction': {
        // declared before the body is made, so it can call itself
        scope.declare(statement.name.name, undefined)
        scope.find(statement.name.name)!.value = this.closure(statement.func, scope)
        return undefined
      }
      case 'AstStatTypeAlias':
      case 'AstStatTypeFunction':
        return undefined
      case 'AstStatGoto':
      case 'AstStatLabel':
        throw new LuaRefusal('unsupported', 'goto and labels are not evaluated', statement.range)
    }
  }

  private numericFor(statement: Extract<AstStat, { type: 'AstStatFor' }>, scope: Scope): Flow {
    const number = (expression: AstExpr, what: string) => {
      const value = this.toNumber(this.expression(expression, scope))
      if (value === undefined)
        throw new LuaRuntimeError(`'for' ${what} must be a number`, undefined, expression.range)
      return value
    }
    const from = number(statement.from, 'initial value')
    const to = number(statement.to, 'limit')
    const step = statement.step === undefined ? 1 : number(statement.step, 'step')
    if (step === 0) throw new LuaRuntimeError("'for' step is zero", undefined, statement.range)
    for (let index = from; step > 0 ? index <= to : index >= to; index += step) {
      const inner = new Scope(scope, undefined)
      inner.declare(statement.var.name, index)
      const flow = this.block(statement.body, inner)
      if (flow === BREAK) break
      if (flow !== undefined && flow !== CONTINUE) return flow
    }
    return undefined
  }

  private genericFor(statement: Extract<AstStat, { type: 'AstStatForIn' }>, scope: Scope): Flow {
    const [iterator, state, initial] = this.expressions(statement.values, scope)
    let control = initial
    for (;;) {
      const results = this.call(iterator, [state, control], statement.range)
      if (results[0] === undefined) break
      control = results[0]
      const inner = new Scope(scope, undefined)
      statement.vars.forEach((variable: AstLocal, index) =>
        inner.declare(variable.name, results[index]),
      )
      const flow = this.block(statement.body, inner)
      if (flow === BREAK) break
      if (flow !== undefined && flow !== CONTINUE) return flow
    }
    return undefined
  }

  /** A writable place: a name or a table field, its table and key evaluated now. */
  private target(expression: AstExpr, scope: Scope): (value: LuaValue) => void {
    if (expression.type === 'AstExprName') {
      const cell = scope.find(expression.name)
      return cell !== undefined
        ? value => void (cell.value = value)
        : value => this.rawSet(this.globals, expression.name, value)
    }
    if (expression.type === 'AstExprIndexName') {
      const table = this.expression(expression.expr, scope)
      return value => this.assign(table, expression.index, value, expression.range)
    }
    if (expression.type === 'AstExprIndexExpr') {
      const table = this.expression(expression.expr, scope)
      const key = this.expression(expression.index, scope)
      return value => this.assign(table, key, value, expression.range)
    }
    throw new LuaRefusal('unsupported', 'this expression cannot be assigned to', expression.range)
  }

  private closure(func: AstExprFunction, scope: Scope): LuaFunction {
    return new LuaFunction(func.debugname ?? 'anonymous', args => {
      const inner = new Scope(
        scope,
        func.vararg ? args.slice(func.args.length + (func.self ? 1 : 0)) : undefined,
      )
      let offset = 0
      if (func.self !== undefined) inner.declare(func.self.name, args[offset++])
      for (const parameter of func.args) inner.declare(parameter.name, args[offset++])
      const flow = this.block(func.body, inner)
      return flow !== undefined && flow.kind === 'return' ? flow.values : []
    })
  }

  // ---- expressions ----------------------------------------------------------------------

  /** Values of a list: the last one expands (a call's results, `...`), the others give one. */
  expressions(list: readonly AstExpr[], scope: Scope): LuaValue[] {
    const values: LuaValue[] = []
    list.forEach((expression, index) => {
      if (index === list.length - 1) values.push(...this.multiple(expression, scope))
      else values.push(this.expression(expression, scope))
    })
    return values
  }

  private multiple(expression: AstExpr, scope: Scope): LuaValue[] {
    if (expression.type === 'AstExprCall') return this.callExpression(expression, scope)
    if (expression.type === 'AstExprVarargs') {
      this.tick(expression.range)
      return [...scope.vararg]
    }
    return [this.expression(expression, scope)]
  }

  private callExpression(expression: AstExprCall, scope: Scope): LuaValue[] {
    this.tick(expression.range)
    if (expression.self && expression.func.type === 'AstExprIndexName') {
      const receiver = this.expression(expression.func.expr, scope)
      const method = this.index(receiver, expression.func.index, expression.func.range)
      return this.call(
        method,
        [receiver, ...this.expressions(expression.args, scope)],
        expression.range,
      )
    }
    const callee = this.expression(expression.func, scope)
    return this.call(callee, this.expressions(expression.args, scope), expression.range)
  }

  expression(expression: AstExpr, scope: Scope): LuaValue {
    this.tick(expression.range)
    switch (expression.type) {
      case 'AstExprGroup':
        return this.expression(expression.expr, scope)
      case 'AstExprConstantNil':
        return undefined
      case 'AstExprConstantBool':
        return expression.value
      case 'AstExprConstantNumber': {
        if (expression.value !== undefined) return expression.value
        const parsed = stringNumber(expression.raw)
        return parsed ?? (expression.raw.startsWith('-') ? -Infinity : Infinity)
      }
      case 'AstExprConstantString':
        return expression.value
      case 'AstExprName': {
        const cell = scope.find(expression.name)
        return cell !== undefined ? cell.value : this.globals.get(expression.name)
      }
      case 'AstExprVarargs':
        return scope.vararg[0]
      case 'AstExprCall':
        return this.callExpression(expression, scope)[0]
      case 'AstExprIndexName':
        return this.index(
          this.expression(expression.expr, scope),
          expression.index,
          expression.range,
        )
      case 'AstExprIndexExpr': {
        const table = this.expression(expression.expr, scope)
        return this.index(table, this.expression(expression.index, scope), expression.range)
      }
      case 'AstExprFunction':
        return this.closure(expression, scope)
      case 'AstExprTable': {
        const table = this.newTable(expression.range)
        let position = 1
        let lastPositional: LuaValue
        expression.items.forEach((item, index) => {
          if (item.kind === 'item') {
            if (index === expression.items.length - 1) {
              for (const value of this.multiple(item.value!, scope)) {
                this.rawSet(table, position++, value)
                lastPositional = value
              }
            } else {
              lastPositional = this.expression(item.value!, scope)
              this.rawSet(table, position++, lastPositional)
            }
          } else if (item.kind === 'record')
            this.rawSet(table, item.name!.name, this.expression(item.value!, scope))
          else if (item.kind === 'set') this.rawSet(table, item.name!.name, true)
          else {
            const key = this.expression(item.key!, scope)
            this.rawSet(table, key, this.expression(item.value!, scope))
          }
        })
        if (lastPositional !== undefined) table.arrayHint = position - 1
        return table
      }
      case 'AstExprUnary': {
        const value = this.expression(expression.expr, scope)
        switch (expression.op) {
          case 'Not':
            return !truthy(value)
          case 'Len':
            return this.length(value, expression.range)
          case 'Minus': {
            const number = this.toNumber(value)
            if (number !== undefined) return -number
            const handler = this.metamethod(value, '__unm')
            if (handler !== undefined)
              return this.call(handler, [value, value], expression.range)[0]
            throw new LuaRuntimeError(
              `attempt to perform arithmetic on a ${luaType(value)} value`,
              undefined,
              expression.range,
            )
          }
          case 'BitNot': {
            const number = this.toNumber(value)
            if (number === undefined)
              throw new LuaRuntimeError(
                `attempt to perform bitwise operation on a ${luaType(value)} value`,
                undefined,
                expression.range,
              )
            return this.bitwise('BitXor', number, -1, expression.range)
          }
        }
        return undefined
      }
      case 'AstExprBinary': {
        if (expression.op === 'And') {
          const left = this.expression(expression.left, scope)
          return truthy(left) ? this.expression(expression.right, scope) : left
        }
        if (expression.op === 'Or') {
          const left = this.expression(expression.left, scope)
          return truthy(left) ? left : this.expression(expression.right, scope)
        }
        const left = this.expression(expression.left, scope)
        const right = this.expression(expression.right, scope)
        return this.binary(expression.op, left, right, expression.range)
      }
      case 'AstExprTypeAssertion':
        return this.expression(expression.expr, scope)
      case 'AstExprIfElse':
        return truthy(this.expression(expression.condition, scope))
          ? this.expression(expression.trueExpr, scope)
          : this.expression(expression.falseExpr, scope)
      case 'AstExprInterpString': {
        let text = expression.strings[0] ?? ''
        expression.expressions.forEach((part, index) => {
          text +=
            this.tostring(this.expression(part, scope)) + (expression.strings[index + 1] ?? '')
        })
        return this.checkString(text)
      }
    }
  }

  binary(op: LuaBinaryOp, left: LuaValue, right: LuaValue, range?: LuaRange): LuaValue {
    switch (op) {
      case 'Concat':
        return this.concat(left, right, range)
      case 'CompareEq':
        return this.equals(left, right, range)
      case 'CompareNe':
        return !this.equals(left, right, range)
      case 'CompareLt':
        return this.lessThan(left, right, false, range)
      case 'CompareLe':
        return this.lessThan(left, right, true, range)
      case 'CompareGt':
        return this.lessThan(right, left, false, range)
      case 'CompareGe':
        return this.lessThan(right, left, true, range)
      case 'And':
        return truthy(left) ? right : left
      case 'Or':
        return truthy(left) ? left : right
      default:
        return this.arithmetic(op, left, right, range)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------------------------

function installLibrary(vm: Evaluator): void {
  const define = (table: LuaTable, name: string, call: (args: readonly LuaValue[]) => LuaValue[]) =>
    table.set(name, new LuaFunction(name, call))
  const g = vm.globals
  const argError = (index: number, name: string, message: string): never => {
    throw new LuaRuntimeError(`bad argument #${index} to '${name}' (${message})`)
  }
  const checkTable = (args: readonly LuaValue[], index: number, name: string): LuaTable => {
    const value = args[index - 1]
    return value instanceof LuaTable
      ? value
      : argError(index, name, `table expected, got ${luaType(value)}`)
  }
  const checkNumber = (args: readonly LuaValue[], index: number, name: string): number => {
    const value = vm.toNumber(args[index - 1])
    return value === undefined
      ? argError(index, name, `number expected, got ${luaType(args[index - 1])}`)
      : value
  }
  const optNumber = (args: readonly LuaValue[], index: number, name: string, fallback: number) =>
    args[index - 1] === undefined ? fallback : checkNumber(args, index, name)
  const checkString = (args: readonly LuaValue[], index: number, name: string): string => {
    const value = args[index - 1]
    if (typeof value === 'string') return value
    if (typeof value === 'number') return luaNumberText(value)
    return argError(index, name, `string expected, got ${luaType(value)}`)
  }
  const checkFunction = (args: readonly LuaValue[], index: number, name: string): LuaFunction => {
    const value = args[index - 1]
    return value instanceof LuaFunction
      ? value
      : argError(index, name, `function expected, got ${luaType(value)}`)
  }

  g.set('_G', g)
  g.set('_VERSION', 'Lua 5.1')
  define(g, 'assert', args => {
    if (!truthy(args[0]))
      throw new LuaRuntimeError(
        typeof args[1] === 'string' ? args[1] : 'assertion failed!',
        args[1] ?? 'assertion failed!',
      )
    return [...args]
  })
  define(g, 'error', args => {
    const value = args[0]
    throw new LuaRuntimeError(typeof value === 'string' ? value : vm.tostring(value), value)
  })
  define(g, 'type', args => {
    if (args.length === 0) argError(1, 'type', 'value expected')
    return [luaType(args[0])]
  })
  define(g, 'tostring', args => [vm.tostring(args[0])])
  define(g, 'tonumber', args => {
    const base = args[1]
    if (base === undefined) return [vm.toNumber(args[0])]
    const radix = checkNumber(args, 2, 'tonumber')
    const text = checkString(args, 1, 'tonumber').trim().toLowerCase()
    if (!/^-?[0-9a-z]+$/u.test(text)) return [undefined]
    const digits = text.replace(/^-/u, '')
    let value = 0
    for (const digit of digits) {
      const d = Number.parseInt(digit, 36)
      if (d >= radix) return [undefined]
      value = value * radix + d
    }
    return [text.startsWith('-') ? -value : value]
  })
  define(g, 'rawget', args => [checkTable(args, 1, 'rawget').get(args[1])])
  define(g, 'rawset', args => {
    vm.rawSet(checkTable(args, 1, 'rawset'), args[1], args[2])
    return [args[0]]
  })
  define(g, 'rawequal', args => [args[0] === args[1]])
  define(g, 'rawlen', args => {
    const value = args[0]
    if (typeof value === 'string') return [value.length]
    return [checkTable(args, 1, 'rawlen').length()]
  })
  define(g, 'setmetatable', args => {
    const table = checkTable(args, 1, 'setmetatable')
    const metatable = args[1]
    if (metatable !== undefined && !(metatable instanceof LuaTable))
      argError(2, 'setmetatable', 'nil or table expected')
    table.metatable = metatable as LuaTable | undefined
    return [table]
  })
  define(g, 'getmetatable', args => {
    const metatable =
      args[0] instanceof LuaTable
        ? args[0].metatable
        : typeof args[0] === 'string'
          ? vm.stringMetatable
          : undefined
    const protectedValue = metatable?.get('__metatable')
    return [protectedValue ?? metatable]
  })
  const next = (table: LuaTable, key: LuaValue): LuaValue[] => {
    const keys = [...table.entries.keys()]
    const at =
      key === undefined
        ? 0
        : keys.indexOf(typeof key === 'number' && Object.is(key, -0) ? 0 : (key as never)) + 1
    if (key !== undefined && at === 0) throw new LuaRuntimeError("invalid key to 'next'")
    vm.tick()
    const found = keys[at]
    return found === undefined ? [undefined] : [found, table.entries.get(found)]
  }
  define(g, 'next', args => next(checkTable(args, 1, 'next'), args[1]))
  define(g, 'pairs', args => {
    const handler = vm.metamethod(args[0], '__pairs')
    if (handler !== undefined) return vm.call(handler, [args[0]]).slice(0, 3)
    const table = checkTable(args, 1, 'pairs')
    // a snapshot of the keys: a loop may set or clear fields it has seen
    const keys = [...table.entries.keys()]
    let position = 0
    const iterator = new LuaFunction('pairs-iterator', () => {
      while (position < keys.length) {
        vm.tick()
        const key = keys[position++]!
        const value = table.entries.get(key)
        if (value !== undefined) return [key, value]
      }
      return [undefined]
    })
    return [iterator, table, undefined]
  })
  const ipairsIterator = new LuaFunction('ipairs-iterator', args => {
    const index = (args[1] as number) + 1
    const value = vm.index(args[0], index)
    return value === undefined ? [undefined] : [index, value]
  })
  define(g, 'ipairs', args => {
    if (args[0] === undefined) argError(1, 'ipairs', 'table expected, got nil')
    return [ipairsIterator, args[0], 0]
  })
  define(g, 'select', args => {
    if (args[0] === '#') return [args.length - 1]
    const index = checkNumber(args, 1, 'select')
    if (index < 0) {
      if (-index > args.length - 1) argError(1, 'select', 'index out of range')
      return args.slice(args.length + index)
    }
    if (index === 0) argError(1, 'select', 'index out of range')
    return args.slice(index)
  })
  const unpack = (args: readonly LuaValue[], name: string): LuaValue[] => {
    const table = args[0]
    const from = optNumber(args, 2, name, 1)
    const to = args[2] === undefined ? vm.length(table) : checkNumber(args, 3, name)
    const values: LuaValue[] = []
    for (let index = from; index <= to; index++) {
      vm.tick()
      values.push(vm.index(table, index))
    }
    return values
  }
  define(g, 'unpack', args => unpack(args, 'unpack'))
  define(g, 'pcall', args => {
    const callee = args[0]
    try {
      return [true, ...vm.call(callee, args.slice(1))]
    } catch (error) {
      if (error instanceof LuaRuntimeError) return [false, error.value]
      throw error
    }
  })
  define(g, 'xpcall', args => {
    try {
      return [true, ...vm.call(args[0], args.slice(2))]
    } catch (error) {
      if (error instanceof LuaRuntimeError) return [false, ...vm.call(args[1], [error.value])]
      throw error
    }
  })
  // print writes nowhere: a data script runs without output
  define(g, 'print', () => [])

  // ---- string ---------------------------------------------------------------------------
  const string = new LuaTable()
  g.set('string', string)
  const position = (value: number, length: number) =>
    value >= 0 ? value : Math.max(0, length + value + 1)
  define(string, 'len', args => [checkString(args, 1, 'len').length])
  define(string, 'lower', args => [checkString(args, 1, 'lower').toLowerCase()])
  define(string, 'upper', args => [checkString(args, 1, 'upper').toUpperCase()])
  define(string, 'reverse', args => [[...checkString(args, 1, 'reverse')].reverse().join('')])
  define(string, 'rep', args => {
    const text = checkString(args, 1, 'rep')
    const count = Math.trunc(checkNumber(args, 2, 'rep'))
    const separator = args[2] === undefined ? '' : checkString(args, 3, 'rep')
    if (count <= 0) return ['']
    vm.checkLength(text.length * count + separator.length * (count - 1))
    for (let index = 0; index < count; index += 256) vm.tick()
    return [Array.from({ length: count }, () => text).join(separator)]
  })
  define(string, 'sub', args => {
    const text = checkString(args, 1, 'sub')
    const length = text.length
    let from = position(Math.trunc(optNumber(args, 2, 'sub', 1)), length)
    let to = position(Math.trunc(optNumber(args, 3, 'sub', -1)), length)
    if (from < 1) from = 1
    if (to > length) to = length
    return [from > to ? '' : text.slice(from - 1, to)]
  })
  define(string, 'byte', args => {
    const text = checkString(args, 1, 'byte')
    const from = position(Math.trunc(optNumber(args, 2, 'byte', 1)), text.length)
    const to = position(Math.trunc(optNumber(args, 3, 'byte', from)), text.length)
    const values: LuaValue[] = []
    for (let index = Math.max(1, from); index <= Math.min(to, text.length); index++)
      values.push(text.charCodeAt(index - 1))
    return values
  })
  define(string, 'char', args => [
    String.fromCharCode(
      ...args.map((_, index) => Math.trunc(checkNumber(args, index + 1, 'char'))),
    ),
  ])
  const tick = () => vm.tick()
  const pattern = <T>(name: string, run: () => T): T => {
    try {
      return run()
    } catch (error) {
      if (error instanceof LuaPatternError) throw new LuaRuntimeError(`${name}: ${error.message}`)
      throw error
    }
  }
  const find = (args: readonly LuaValue[], name: 'find' | 'match'): LuaValue[] => {
    const text = checkString(args, 1, name)
    const what = checkString(args, 2, name)
    const init = position(Math.trunc(optNumber(args, 3, name, 1)), text.length)
    if (init > text.length + 1) return [undefined]
    const start = Math.max(1, init) - 1
    if (name === 'find' && (truthy(args[3]) || luaPatternIsPlain(what))) {
      const at = text.indexOf(what, start)
      return at < 0 ? [undefined] : [at + 1, at + what.length]
    }
    const found = pattern(name, () => luaPatternFind(text, what, start, tick))
    if (found === undefined) return [undefined]
    if (name === 'match') return [...found.captures]
    return [found.start + 1, found.end, ...(found.explicit ? found.captures : [])]
  }
  define(string, 'find', args => find(args, 'find'))
  define(string, 'match', args => find(args, 'match'))
  define(string, 'gmatch', args => {
    const text = checkString(args, 1, 'gmatch')
    const what = checkString(args, 2, 'gmatch')
    let at = 0
    let lastEnd = -1
    return [
      new LuaFunction('gmatch-iterator', () => {
        while (at <= text.length) {
          const found = pattern('gmatch', () => luaPatternMatchAt(text, what, at, tick))
          if (found !== undefined && found.end !== lastEnd) {
            at = lastEnd = found.end
            if (found.end === found.start) at++
            return [...found.captures]
          }
          at++
        }
        return [undefined]
      }),
    ]
  })
  define(string, 'gsub', args => {
    const text = checkString(args, 1, 'gsub')
    const what = checkString(args, 2, 'gsub')
    const replacement = args[2]
    const limit = args[3] === undefined ? Infinity : Math.trunc(checkNumber(args, 4, 'gsub'))
    if (!(
      typeof replacement === 'string' ||
      typeof replacement === 'number' ||
      replacement instanceof LuaTable ||
      replacement instanceof LuaFunction
    ))
      argError(3, 'gsub', `string/function/table expected, got ${luaType(replacement)}`)
    const anchored = what.startsWith('^')
    const body = anchored ? what.slice(1) : what
    let output = ''
    let at = 0
    let lastMatch = -1
    let count = 0
    const substitute = (whole: string, captures: readonly LuaCaptureValue[]): string => {
      let value: LuaValue
      if (typeof replacement === 'string' || typeof replacement === 'number') {
        const template = typeof replacement === 'number' ? luaNumberText(replacement) : replacement
        return template.replace(/%(.)/gu, (_, character: string) => {
          if (character === '0') return whole
          if (/\d/u.test(character)) {
            const capture =
              captures[Number(character) - 1] ?? (character === '1' ? whole : undefined)
            if (capture === undefined)
              throw new LuaRuntimeError(`invalid capture index %${character} in replacement string`)
            return typeof capture === 'number' ? luaNumberText(capture) : capture
          }
          if (character === '%') return '%'
          throw new LuaRuntimeError("invalid use of '%' in replacement string")
        })
      }
      const first = captures[0] ?? whole
      value =
        replacement instanceof LuaTable
          ? vm.index(replacement, first)
          : vm.call(replacement, captures.length > 0 ? [...captures] : [whole])[0]
      if (!truthy(value)) return whole
      if (typeof value === 'string' || typeof value === 'number') return vm.tostring(value)
      throw new LuaRuntimeError(`invalid replacement value (a ${luaType(value)})`)
    }
    while (count < limit) {
      const found = pattern('gsub', () => luaPatternMatchAt(text, body, at, tick))
      if (found !== undefined && found.end !== lastMatch) {
        count++
        const whole = text.slice(found.start, found.end)
        output = vm.checkString(output + substitute(whole, found.explicit ? found.captures : []))
        at = lastMatch = found.end
      } else if (at < text.length) output += text[at++]
      else break
      if (anchored) break
    }
    return [vm.checkString(output + text.slice(at)), count]
  })
  define(string, 'format', args => [vm.checkString(format(args))])
  const format = (args: readonly LuaValue[]): string => {
    const template = checkString(args, 1, 'format')
    let argument = 1
    return template.replace(
      /%([-+ #0]*)(\d*)(?:\.(\d*))?([a-zA-Z%])/gu,
      (whole, flags: string, width: string, precision: string | undefined, conversion: string) => {
        if (conversion === '%') return '%'
        argument++
        const index = argument
        let text: string
        switch (conversion) {
          case 'd':
          case 'i': {
            const value = checkNumber(args, index, 'format')
            if (!Number.isInteger(value))
              argError(index, 'format', 'number has no integer representation')
            text = Math.abs(value).toString()
            if (precision !== undefined) text = text.padStart(Number(precision || '0'), '0')
            text =
              (value < 0 ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '') + text
            break
          }
          case 'u':
            text = Math.abs(Math.trunc(checkNumber(args, index, 'format'))).toString()
            break
          case 'c':
            text = String.fromCharCode(Math.trunc(checkNumber(args, index, 'format')))
            break
          case 'x':
          case 'X':
          case 'o': {
            const value = Math.trunc(checkNumber(args, index, 'format'))
            const unsigned = value < 0 ? BigInt.asUintN(64, BigInt(value)) : BigInt(value)
            text = unsigned.toString(conversion === 'o' ? 8 : 16)
            if (conversion === 'X') text = text.toUpperCase()
            if (precision !== undefined) text = text.padStart(Number(precision || '0'), '0')
            if (flags.includes('#') && value !== 0)
              text = (conversion === 'o' ? '0' : conversion === 'x' ? '0x' : '0X') + text
            break
          }
          case 'e':
          case 'E':
          case 'f':
          case 'F':
          case 'g':
          case 'G': {
            const value = checkNumber(args, index, 'format')
            const lower = conversion.toLowerCase() as 'e' | 'f' | 'g'
            text = cFormat(
              value,
              lower,
              precision === undefined ? 6 : Number(precision || '0'),
              flags,
            )
            if (value >= 0 && flags.includes('+')) text = `+${text}`
            else if (value >= 0 && flags.includes(' ')) text = ` ${text}`
            if (conversion !== lower) text = text.toUpperCase()
            break
          }
          case 'q': {
            const value = args[index - 1]
            text =
              typeof value === 'string'
                ? `"${value.replace(/[\\"\n\r\0]/gu, character => (character === '\n' ? '\\\n' : character === '\r' ? '\\r' : character === '\0' ? '\\0' : `\\${character}`))}"`
                : vm.tostring(value)
            break
          }
          case 's': {
            if (args.length < index) argError(index, 'format', 'no value')
            text = vm.tostring(args[index - 1])
            if (precision !== undefined) text = text.slice(0, Number(precision || '0'))
            break
          }
          default:
            throw new LuaRuntimeError(`invalid option '${whole}' to 'format'`)
        }
        const size = Number(width || '0')
        if (text.length >= size) return text
        if (flags.includes('-')) return text.padEnd(size)
        if (flags.includes('0') && /[dioxXeEfFgGu]/u.test(conversion)) {
          const sign = /^[-+ ]/u.test(text) ? text[0]! : ''
          return sign + text.slice(sign.length).padStart(size - sign.length, '0')
        }
        return text.padStart(size)
      },
    )
  }

  // ---- math -----------------------------------------------------------------------------
  const math = new LuaTable()
  g.set('math', math)
  math.set('pi', Math.PI)
  math.set('huge', Infinity)
  math.set('maxinteger', Number.MAX_SAFE_INTEGER)
  math.set('mininteger', Number.MIN_SAFE_INTEGER)
  const unary = (name: string, operation: (value: number) => number) =>
    define(math, name, args => [operation(checkNumber(args, 1, name))])
  unary('abs', Math.abs)
  unary('ceil', Math.ceil)
  unary('floor', Math.floor)
  unary('sqrt', Math.sqrt)
  unary('sin', Math.sin)
  unary('cos', Math.cos)
  unary('tan', Math.tan)
  unary('asin', Math.asin)
  unary('acos', Math.acos)
  unary('exp', Math.exp)
  unary('log10', Math.log10)
  unary('deg', value => (value * 180) / Math.PI)
  unary('rad', value => (value * Math.PI) / 180)
  define(math, 'atan', args => [
    args[1] === undefined
      ? Math.atan(checkNumber(args, 1, 'atan'))
      : Math.atan2(checkNumber(args, 1, 'atan'), checkNumber(args, 2, 'atan')),
  ])
  define(math, 'atan2', args => [
    Math.atan2(checkNumber(args, 1, 'atan2'), checkNumber(args, 2, 'atan2')),
  ])
  define(math, 'log', args => {
    const value = checkNumber(args, 1, 'log')
    return [
      args[1] === undefined
        ? Math.log(value)
        : Math.log(value) / Math.log(checkNumber(args, 2, 'log')),
    ]
  })
  define(math, 'pow', args => [checkNumber(args, 1, 'pow') ** checkNumber(args, 2, 'pow')])
  define(math, 'fmod', args => {
    const a = checkNumber(args, 1, 'fmod')
    const b = checkNumber(args, 2, 'fmod')
    return [a % b]
  })
  define(math, 'modf', args => {
    const value = checkNumber(args, 1, 'modf')
    const whole = value >= 0 ? Math.floor(value) : Math.ceil(value)
    return [whole, Number.isFinite(value) ? value - whole : 0]
  })
  define(math, 'max', args => {
    let best = checkNumber(args, 1, 'max')
    for (let index = 2; index <= args.length; index++)
      best = Math.max(best, checkNumber(args, index, 'max'))
    return [best]
  })
  define(math, 'min', args => {
    let best = checkNumber(args, 1, 'min')
    for (let index = 2; index <= args.length; index++)
      best = Math.min(best, checkNumber(args, index, 'min'))
    return [best]
  })
  define(math, 'random', args => {
    const fraction = vm.nextRandom()
    if (args.length === 0) return [fraction]
    const low = args.length === 1 ? 1 : Math.trunc(checkNumber(args, 1, 'random'))
    const high = Math.trunc(checkNumber(args, args.length === 1 ? 1 : 2, 'random'))
    if (low > high) argError(args.length === 1 ? 1 : 2, 'random', 'interval is empty')
    return [low + Math.floor(fraction * (high - low + 1))]
  })
  define(math, 'randomseed', () => [])
  define(math, 'tointeger', args => {
    const value = vm.toNumber(args[0])
    return [value !== undefined && Number.isInteger(value) ? value : undefined]
  })
  define(math, 'type', args => [
    typeof args[0] === 'number' ? (Number.isInteger(args[0]) ? 'integer' : 'float') : undefined,
  ])

  // ---- table ----------------------------------------------------------------------------
  const table = new LuaTable()
  g.set('table', table)
  define(table, 'insert', args => {
    const target = checkTable(args, 1, 'insert')
    const length = target.length()
    if (args.length === 2) {
      vm.rawSet(target, length + 1, args[1])
      return []
    }
    if (args.length !== 3) throw new LuaRuntimeError("wrong number of arguments to 'insert'")
    const at = Math.trunc(checkNumber(args, 2, 'insert'))
    if (at < 1 || at > length + 1) argError(2, 'insert', 'position out of bounds')
    for (let index = length; index >= at; index--) {
      vm.tick()
      vm.rawSet(target, index + 1, target.get(index))
    }
    vm.rawSet(target, at, args[2])
    return []
  })
  define(table, 'remove', args => {
    const target = checkTable(args, 1, 'remove')
    const length = target.length()
    const at = args[1] === undefined ? length : Math.trunc(checkNumber(args, 2, 'remove'))
    if (length === 0 && (args[1] === undefined || at === 0 || at === length))
      return [target.get(at)]
    if (length + 1 === at) {
      const value = target.get(at)
      target.set(at, undefined)
      return [value]
    }
    if (at < 1 || at > length + 1) argError(2, 'remove', 'position out of bounds')
    const value = target.get(at)
    for (let index = at; index < length; index++) {
      vm.tick()
      target.set(index, target.get(index + 1))
    }
    target.set(length, undefined)
    return [value]
  })
  define(table, 'concat', args => {
    const target = checkTable(args, 1, 'concat')
    const separator = args[1] === undefined ? '' : checkString(args, 2, 'concat')
    const from = Math.trunc(optNumber(args, 3, 'concat', 1))
    const to = args[3] === undefined ? target.length() : Math.trunc(checkNumber(args, 4, 'concat'))
    const parts: string[] = []
    for (let index = from; index <= to; index++) {
      vm.tick()
      const value = target.get(index)
      if (typeof value === 'string') parts.push(value)
      else if (typeof value === 'number') parts.push(luaNumberText(value))
      else throw new LuaRuntimeError(`invalid value (at index ${index}) in table for 'concat'`)
    }
    return [vm.checkString(parts.join(separator))]
  })
  define(table, 'unpack', args => unpack(args, 'unpack'))
  define(table, 'pack', args => {
    const packed = vm.newTable()
    args.forEach((value, index) => vm.rawSet(packed, index + 1, value))
    vm.rawSet(packed, 'n', args.length)
    return [packed]
  })
  define(table, 'getn', args => [checkTable(args, 1, 'getn').length()])
  define(table, 'sort', args => {
    const target = checkTable(args, 1, 'sort')
    const comparator = args[1] === undefined ? undefined : checkFunction(args, 2, 'sort')
    const length = target.length()
    const values: LuaValue[] = []
    for (let index = 1; index <= length; index++) values.push(target.get(index))
    values.sort((left, right) => {
      vm.tick()
      if (comparator === undefined)
        return vm.lessThan(left, right, false) ? -1 : vm.lessThan(right, left, false) ? 1 : 0
      return truthy(vm.call(comparator, [left, right])[0])
        ? -1
        : truthy(vm.call(comparator, [right, left])[0])
          ? 1
          : 0
    })
    values.forEach((value, index) => target.set(index + 1, value))
    return []
  })
}

// ---------------------------------------------------------------------------------------------

/** Run a parsed chunk within the limits; see the module comment for what it can do. */
export function evaluateLuaChunk(
  parse: LuaParseResult,
  options: LuaEvaluationOptions,
): LuaEvaluationResult {
  const vm = new Evaluator(options)
  try {
    const scope = new Scope(undefined, options.arguments ?? [])
    const flow = vm.block(parse.chunk, scope)
    return Object.freeze({
      state: 'returned',
      values: Object.freeze(flow !== undefined && flow.kind === 'return' ? flow.values : []),
      globals: vm.globals,
      steps: vm.steps,
      usedRandom: vm.usedRandom,
    })
  } catch (error) {
    if (error instanceof LuaRefusal)
      return Object.freeze({
        state: 'refused',
        code: error.code,
        message: error.message,
        ...(error.range === undefined ? {} : { range: error.range }),
        steps: vm.steps,
      })
    if (error instanceof LuaRuntimeError)
      return Object.freeze({
        state: 'failed',
        code: 'runtime-error',
        message: error.message,
        ...(error.range === undefined ? {} : { range: error.range }),
        steps: vm.steps,
      })
    if (error instanceof RangeError && /call stack/iu.test(error.message))
      return Object.freeze({
        state: 'refused',
        code: 'depth-limit',
        message: 'the script nested too deep',
        steps: vm.steps,
      })
    throw error
  }
}

/**
 * An evaluated value as the static reader's tree (`LuaStaticValue`), so a consumer of static
 * readings takes evaluated ones too: numbers marked `derived`, a function `unresolved`
 * (`function`), a table key that is a table or a function left out. A table met twice is one
 * value; a cycle stops at its second visit as `unresolved`.
 */
export function luaValueToStatic(value: LuaValue, range: LuaRange = [0, 0]): LuaStaticValue {
  const seen = new Map<LuaTable, LuaStaticValue>()
  const visiting = new Set<LuaTable>()
  const convert = (item: LuaValue, at: LuaRange): LuaStaticValue => {
    if (item === undefined) return { kind: 'nil', range: at }
    if (typeof item === 'boolean') return { kind: 'boolean', value: item, range: at }
    if (typeof item === 'number')
      return {
        kind: 'number',
        raw: luaNumberText(item),
        ...(Number.isFinite(item) ? { value: item } : {}),
        derived: true,
        range: at,
      }
    if (typeof item === 'string') return { kind: 'string', value: item, derived: true, range: at }
    if (item instanceof LuaFunction)
      return { kind: 'unresolved', reason: 'function', source: item.name, range: at }
    const known = seen.get(item)
    if (known !== undefined) return known
    const own = item.range ?? at
    if (visiting.has(item))
      return { kind: 'unresolved', reason: 'operator', source: 'cycle', range: own }
    visiting.add(item)
    const entries: LuaStaticEntry[] = []
    for (const [key, entry] of item.entries) {
      const staticKey: LuaStaticKey | undefined =
        typeof key === 'string'
          ? { kind: 'string', value: key }
          : typeof key === 'number'
            ? { kind: 'number', value: key, raw: luaNumberText(key) }
            : typeof key === 'boolean'
              ? { kind: 'boolean', value: key }
              : undefined
      if (staticKey !== undefined)
        entries.push({ key: staticKey, value: convert(entry, own), range: own })
    }
    visiting.delete(item)
    const converted: LuaStaticValue = {
      kind: 'table',
      entries,
      ...(item.metatable === undefined ? {} : { metatable: true }),
      range: own,
    }
    seen.set(item, converted)
    return converted
  }
  return convert(value, range)
}
