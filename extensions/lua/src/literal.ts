import type {
  AstExpr,
  AstExprConstantNumber,
  AstExprTable,
  AstStat,
  AstStatBlock,
  LuaParseResult,
  LuaRange,
} from './ast.js'
import { bindLuaChunk, type LuaBindResult } from './binder.js'

/**
 * Static reading of Lua data modules — configuration tables, unit definitions — without running
 * anything. It answers "what would `return` give, as far as the source says it literally", and
 * marks every place where running the code could say something else.
 *
 * Evaluated: nil/boolean/number/string literals (numbers keep their source spelling), table
 * constructors, unary minus/not, arithmetic and concatenation of evaluated operands (marked
 * `derived`), chunk-level locals that are assigned only by their declaration, field reads of
 * evaluated tables, and chunk-level field assignments (`module.stat[9] = { … }`) in source order,
 * with Lua's reference semantics for tables.
 *
 * Not evaluated, reported as `unresolved` with the source range: calls, functions, globals
 * (`Enum.KeyCode.Q`, `game`), varargs, comparisons, and anything reading an unresolved value.
 * Writes the reader cannot apply — inside functions or loops, through calls that receive a known
 * table — are listed in `unappliedWrites`, because they may change the result at run time.
 *
 * Top-level calls of global names (`UnitBlueprint { … }`) are listed in `calls` with their
 * arguments read the same way: the call itself is not run, its literal arguments are the data.
 * A call inside an expression stays `unresolved`, and one of a global name keeps its callee and
 * arguments (`call`).
 *
 * Globals assigned at the top level are read like locals and listed in `globals`. Writing into
 * what a call returned (`GameData = Inherit([[…]])`, then `GameData["a"]["b"] = 5`) makes a table
 * that `extends` the call, with `overlay` tables for the keys written below it: the data a file adds
 * over the one it inherits from.
 */

export type LuaStaticKey =
  | { readonly kind: 'string'; readonly value: string }
  /** A global path such as `Enum.KeyCode.Q`, used as a key. */
  | { readonly kind: 'symbol'; readonly path: string }
  | { readonly kind: 'number'; readonly value: number; readonly raw: string }
  | { readonly kind: 'boolean'; readonly value: boolean }

export interface LuaStaticEntry {
  readonly key: LuaStaticKey
  readonly value: LuaStaticValue
  /** Range of the item or assignment that set this entry last. */
  readonly range: LuaRange
}

export type LuaStaticValue =
  | { readonly kind: 'nil'; readonly range: LuaRange }
  | { readonly kind: 'boolean'; readonly value: boolean; readonly range: LuaRange }
  | {
      readonly kind: 'number'
      /** Source spelling for literals; the expression text when `derived`. */
      readonly raw: string
      /** Absent when not finite. */
      readonly value?: number
      /** Computed from other values (arithmetic) rather than written as one literal. */
      readonly derived?: true
      readonly range: LuaRange
    }
  | {
      readonly kind: 'string'
      readonly value: string
      readonly bytesHex?: string
      readonly derived?: true
      readonly range: LuaRange
    }
  | {
      readonly kind: 'table'
      readonly entries: readonly LuaStaticEntry[]
      /**
       * Set by `setmetatable(t, mt)`: the listed entries are exact, but a key missing here may
       * still answer at run time through the metatable.
       */
      readonly metatable?: true
      /**
       * The table is what this call returns, with `entries` written over it: a variable assigned
       * from a call and then written into (`GameData = Inherit([[…]])`, `GameData.a = 1`).
       */
      readonly extends?: LuaStaticCall
      /**
       * Created by writing into a table that `extends` a call: it exists in the call's result, and
       * only the keys written here are known.
       */
      readonly overlay?: true
      readonly range: LuaRange
    }
  /**
   * A path from a global without calls (`Enum.KeyCode.Q`, `script.Parent.Util`): a stable name in
   * data, whose value the host environment defines.
   */
  | { readonly kind: 'symbol'; readonly path: string; readonly range: LuaRange }
  | {
      readonly kind: 'unresolved'
      readonly reason: LuaUnresolvedReason
      /** Source text of the expression. */
      readonly source: string
      /** For a call of a global name or path: what is called and its arguments, read as data. */
      readonly call?: LuaStaticCall
      readonly range: LuaRange
    }

/** A call not run: the called global or path of names as written, and its arguments read as data. */
export interface LuaStaticCall {
  readonly callee: string
  readonly arguments: readonly LuaStaticValue[]
}

export type LuaUnresolvedReason =
  | 'call'
  /** A field of a table that `extends` a call and that this chunk does not write. */
  | 'inherited'
  | 'function'
  | 'global'
  | 'reassigned-local'
  | 'varargs'
  | 'operator'
  | 'unresolved-operand'
  | 'missing-field'
  | 'not-a-table'
  | 'interpolated-string'
  | 'type-assertion'
  | 'if-expression'
  | 'no-return'

export interface LuaUnappliedWrite {
  readonly range: LuaRange
  readonly reason:
    | 'inside-function'
    | 'inside-control-flow'
    | 'call-receives-table'
    | 'dynamic-key'
    /** The table being written was itself not statically known (for example built by a call). */
    | 'unresolved-target'
  readonly source: string
}

/**
 * A call statement at the chunk's top level, its arguments read like any other value: data files
 * that declare records by calling (`UnitBlueprint { … }` of Supreme Commander) rather than returning.
 */
export interface LuaTopLevelCall {
  /** The called global or path of names as written (`UnitBlueprint`, `Game.Register`). */
  readonly callee: string
  readonly arguments: readonly LuaStaticValue[]
  readonly range: LuaRange
}

/** A global the chunk assigns at its top level, with its value at the end of the chunk. */
export interface LuaStaticGlobal {
  readonly name: string
  readonly value: LuaStaticValue
  /** The last top-level assignment of the name itself. */
  readonly range: LuaRange
}

export interface LuaModuleReading {
  /** The value of the chunk's final `return`, or `unresolved` with reason `no-return`. */
  readonly value: LuaStaticValue
  readonly unappliedWrites: readonly LuaUnappliedWrite[]
  /** Calls of global names at the chunk's top level, in source order. */
  readonly calls: readonly LuaTopLevelCall[]
  /**
   * Globals assigned at the chunk's top level, in the order first assigned: data files that set a
   * global instead of returning (`GameData = Inherit([[…]])` of Dawn of War attributes).
   */
  readonly globals: readonly LuaStaticGlobal[]
}

interface CallBuilder {
  readonly callee: string
  readonly arguments: Value[]
}

/** Mutable table used while reading; frozen into `LuaStaticValue` at the end. */
interface TableBuilder {
  readonly kind: 'table'
  readonly range: LuaRange
  readonly entries: { key: LuaStaticKey; value: Value; range: LuaRange }[]
  metatable?: true
  extends?: CallBuilder
  overlay?: true
}

type UnresolvedBuilder = Omit<Extract<LuaStaticValue, { kind: 'unresolved' }>, 'call'> & { readonly call?: CallBuilder }

type Value = Exclude<LuaStaticValue, { kind: 'table' } | { kind: 'unresolved' }> | UnresolvedBuilder | TableBuilder

function keyOf(value: Value): LuaStaticKey | undefined {
  switch (value.kind) {
    case 'string':
      return { kind: 'string', value: value.value }
    case 'number':
      return value.value === undefined
        ? undefined
        : { kind: 'number', value: value.value, raw: value.raw }
    case 'boolean':
      return { kind: 'boolean', value: value.value }
    case 'symbol':
      return { kind: 'symbol', path: value.path }
    default:
      return undefined
  }
}

function sameKey(a: LuaStaticKey, b: LuaStaticKey): boolean {
  if (a.kind === 'symbol' || b.kind === 'symbol') {
    return a.kind === 'symbol' && b.kind === 'symbol' && a.path === b.path
  }
  return a.kind === b.kind && a.value === b.value
}

function lookup(table: TableBuilder, key: LuaStaticKey): Value | undefined {
  for (const entry of table.entries) if (sameKey(entry.key, key)) return entry.value
  return undefined
}

function store(table: TableBuilder, key: LuaStaticKey, value: Value, range: LuaRange): void {
  const existing = table.entries.find(entry => sameKey(entry.key, key))
  if (existing === undefined) table.entries.push({ key, value, range })
  else {
    existing.value = value
    existing.range = range
  }
}

/** A value written into: what a call of a global returned becomes a table that extends the call. */
function extended(value: Value): Value {
  return value.kind === 'unresolved' && value.call !== undefined
    ? { kind: 'table', range: value.range, entries: [], extends: value.call }
    : value
}

class Reader {
  readonly #text: string
  readonly #binding: LuaBindResult
  /** Values of chunk-level locals, by binding id. */
  readonly #locals = new Map<number, Value>()
  /** Bindings whose only write is their declaration. */
  readonly #constant = new Set<number>()
  /** Globals assigned at the top level so far, in the order first assigned. */
  readonly globals = new Map<string, { value: Value; range: LuaRange }>()
  readonly unappliedWrites: LuaUnappliedWrite[] = []
  readonly calls: { callee: string; arguments: Value[]; range: LuaRange }[] = []

  constructor(text: string, binding: LuaBindResult) {
    this.#text = text
    this.#binding = binding
    for (const candidate of binding.bindings) {
      if (candidate.kind !== 'local' && candidate.kind !== 'const') continue
      const writes = binding.occurrencesOf(candidate.id).filter(occurrence => occurrence.write)
      if (writes.length === 1 && writes[0]?.declaration === true) this.#constant.add(candidate.id)
    }
  }

  source(range: LuaRange): string {
    return this.#text.slice(range[0], range[1])
  }

  unresolved(reason: LuaUnresolvedReason, range: LuaRange): UnresolvedBuilder {
    return { kind: 'unresolved', reason, source: this.source(range), range }
  }

  bindingOf(range: LuaRange): number | undefined {
    const occurrence = this.#binding.occurrenceAt(range[0])
    return occurrence !== undefined && occurrence.range[0] === range[0]
      ? occurrence.binding
      : undefined
  }

  /** Whether a name at this place refers to a global rather than a local. */
  isGlobal(expr: AstExpr & { type: 'AstExprName' }): boolean {
    const binding = this.bindingOf(expr.range)
    return binding === undefined || this.#binding.bindings[binding]?.kind === 'global'
  }

  /** `Name` or `Name.field…` rooted in a global, as written; `undefined` for anything else. */
  calleePath(expr: AstExpr): string | undefined {
    if (expr.type === 'AstExprName') {
      const binding = this.bindingOf(expr.range)
      return binding === undefined || this.#binding.bindings[binding]?.kind === 'global'
        ? expr.name
        : undefined
    }
    if (expr.type === 'AstExprIndexName' && expr.op === '.') {
      const base = this.calleePath(expr.expr)
      return base === undefined ? undefined : `${base}.${expr.index}`
    }
    return undefined
  }

  // --- expressions --------------------------------------------------------------------------

  evaluate(expr: AstExpr): Value {
    switch (expr.type) {
      case 'AstExprConstantNil':
        return { kind: 'nil', range: expr.range }
      case 'AstExprConstantBool':
        return { kind: 'boolean', value: expr.value, range: expr.range }
      case 'AstExprConstantNumber':
        return this.number(expr)
      case 'AstExprConstantString':
        return {
          kind: 'string',
          value: expr.value,
          ...(expr.bytesHex === undefined ? {} : { bytesHex: expr.bytesHex }),
          range: expr.range,
        }
      case 'AstExprGroup':
        return this.evaluate(expr.expr)
      case 'AstExprTable':
        return this.table(expr)
      case 'AstExprUnary':
        return this.unary(expr.op, this.evaluate(expr.expr), expr.range)
      case 'AstExprBinary':
        return this.binary(expr.op, this.evaluate(expr.left), this.evaluate(expr.right), expr.range)
      case 'AstExprName': {
        const binding = this.bindingOf(expr.range)
        const declared = binding === undefined ? undefined : this.#binding.bindings[binding]
        if (declared === undefined || declared.kind === 'global') {
          return this.globals.get(expr.name)?.value ?? { kind: 'symbol', path: expr.name, range: expr.range }
        }
        const value = this.#locals.get(declared.id)
        if (value === undefined || !this.#constant.has(declared.id)) {
          return this.unresolved('reassigned-local', expr.range)
        }
        return value
      }
      case 'AstExprIndexName':
      case 'AstExprIndexExpr': {
        const base = this.evaluate(expr.expr)
        if (base.kind === 'symbol') {
          return expr.type === 'AstExprIndexName'
            ? { kind: 'symbol', path: `${base.path}.${expr.index}`, range: expr.range }
            : this.unresolved('global', expr.range)
        }
        if (base.kind === 'unresolved') return this.unresolved('unresolved-operand', expr.range)
        if (base.kind !== 'table') return this.unresolved('not-a-table', expr.range)
        const key =
          expr.type === 'AstExprIndexName'
            ? ({ kind: 'string', value: expr.index } as const)
            : keyOf(this.evaluate(expr.index))
        if (key === undefined) return this.unresolved('unresolved-operand', expr.range)
        return (
          lookup(base, key) ??
          this.unresolved(base.extends !== undefined || base.overlay === true ? 'inherited' : 'missing-field', expr.range)
        )
      }
      case 'AstExprCall': {
        // `setmetatable(t, mt)` returns `t`; the metatable only answers keys `t` lacks.
        const first = expr.args[0]
        if (
          expr.func.type === 'AstExprName' &&
          expr.func.name === 'setmetatable' &&
          first !== undefined
        ) {
          const table = this.evaluate(first)
          const declared = this.bindingOf(expr.func.range)
          if (
            table.kind === 'table' &&
            (declared === undefined || this.#binding.bindings[declared]?.kind === 'global')
          ) {
            table.metatable = true
            return table
          }
        }
        // Not run; a call of a global name keeps what it calls and its arguments as data.
        const callee = this.calleePath(expr.func)
        return {
          ...this.unresolved('call', expr.range),
          ...(callee === undefined ? {} : { call: { callee, arguments: expr.args.map(arg => this.evaluate(arg)) } }),
        }
      }
      case 'AstExprFunction':
        return this.unresolved('function', expr.range)
      case 'AstExprVarargs':
        return this.unresolved('varargs', expr.range)
      case 'AstExprInterpString':
        return this.unresolved('interpolated-string', expr.range)
      case 'AstExprTypeAssertion':
        return this.evaluate(expr.expr)
      case 'AstExprIfElse':
        return this.unresolved('if-expression', expr.range)
    }
  }

  number(expr: AstExprConstantNumber): Value {
    return {
      kind: 'number',
      raw: expr.raw,
      ...(expr.value === undefined ? {} : { value: expr.value }),
      range: expr.range,
    }
  }

  table(expr: AstExprTable): TableBuilder {
    const table: TableBuilder = { kind: 'table', range: expr.range, entries: [] }
    let position = 0
    for (const item of expr.items) {
      if (item.kind === 'item') {
        position += 1
        const value =
          item.value === undefined
            ? this.unresolved('missing-field', item.range)
            : this.evaluate(item.value)
        store(table, { kind: 'number', value: position, raw: String(position) }, value, item.range)
        continue
      }
      if (item.kind === 'record' || item.kind === 'set') {
        const name = item.name?.name ?? ''
        const value: Value =
          item.kind === 'set'
            ? { kind: 'boolean', value: true, range: item.range }
            : item.value === undefined
              ? this.unresolved('missing-field', item.range)
              : this.evaluate(item.value)
        store(table, { kind: 'string', value: name }, value, item.range)
        continue
      }
      const key = item.key === undefined ? undefined : keyOf(this.evaluate(item.key))
      if (key === undefined) {
        this.unappliedWrites.push({
          range: item.range,
          reason: 'dynamic-key',
          source: this.source(item.range),
        })
        continue
      }
      const value =
        item.value === undefined
          ? this.unresolved('missing-field', item.range)
          : this.evaluate(item.value)
      store(table, key, value, item.range)
    }
    return table
  }

  unary(op: string, operand: Value, range: LuaRange): Value {
    if (op === 'Minus' && operand.kind === 'number') {
      const raw = operand.raw.startsWith('-') ? operand.raw.slice(1) : `-${operand.raw}`
      return {
        kind: 'number',
        raw: operand.derived === true ? this.source(range) : raw,
        ...(operand.value === undefined ? {} : { value: -operand.value }),
        ...(operand.derived === true ? { derived: true as const } : {}),
        range,
      }
    }
    if (op === 'Not' && (operand.kind === 'boolean' || operand.kind === 'nil')) {
      return { kind: 'boolean', value: operand.kind === 'nil' ? true : !operand.value, range }
    }
    return this.unresolved(operand.kind === 'unresolved' ? 'unresolved-operand' : 'operator', range)
  }

  binary(op: string, left: Value, right: Value, range: LuaRange): Value {
    // `flag and a or b`: Lua picks an operand by the left one's truthiness, whatever the other is.
    if ((op === 'And' || op === 'Or') && left.kind !== 'unresolved' && left.kind !== 'symbol') {
      const truthy = !(left.kind === 'nil' || (left.kind === 'boolean' && !left.value))
      return op === 'And' ? (truthy ? right : left) : truthy ? left : right
    }
    if (left.kind === 'unresolved' || right.kind === 'unresolved') {
      return this.unresolved('unresolved-operand', range)
    }
    if (op === 'Concat') {
      const leftText =
        left.kind === 'string' ? left.value : left.kind === 'number' ? left.raw : undefined
      const rightText =
        right.kind === 'string' ? right.value : right.kind === 'number' ? right.raw : undefined
      if (leftText === undefined || rightText === undefined)
        return this.unresolved('operator', range)
      return { kind: 'string', value: leftText + rightText, derived: true, range }
    }
    if (
      left.kind !== 'number' ||
      right.kind !== 'number' ||
      left.value === undefined ||
      right.value === undefined
    ) {
      return this.unresolved('operator', range)
    }
    const a = left.value
    const b = right.value
    let value: number
    switch (op) {
      case 'Add':
        value = a + b
        break
      case 'Sub':
        value = a - b
        break
      case 'Mul':
        value = a * b
        break
      case 'Div':
        value = a / b
        break
      case 'FloorDiv':
        value = Math.floor(a / b)
        break
      case 'Mod':
        value = a - Math.floor(a / b) * b
        break
      case 'Pow':
        value = a ** b
        break
      default:
        return this.unresolved('operator', range)
    }
    return {
      kind: 'number',
      raw: this.source(range),
      ...(Number.isFinite(value) ? { value } : {}),
      derived: true,
      range,
    }
  }

  // --- statements ---------------------------------------------------------------------------

  /** Field path of an assignment target rooted at a chunk-level local or global table, if static. */
  target(
    expr: AstExpr,
  ):
    | { table: TableBuilder; key: LuaStaticKey }
    | { unapplied: 'dynamic-key' | 'unresolved-target' }
    | undefined {
    if (expr.type !== 'AstExprIndexName' && expr.type !== 'AstExprIndexExpr') return undefined
    const table = this.container(expr.expr)
    if (table === undefined) return this.rootsInKnownTable(expr) ? { unapplied: 'unresolved-target' } : undefined
    const key = this.keyOfIndex(expr)
    return key === undefined ? { unapplied: 'dynamic-key' } : { table, key }
  }

  keyOfIndex(expr: AstExpr & { type: 'AstExprIndexName' | 'AstExprIndexExpr' }): LuaStaticKey | undefined {
    return expr.type === 'AstExprIndexName' ? { kind: 'string', value: expr.index } : keyOf(this.evaluate(expr.index))
  }

  /**
   * The table a write goes into. Writing into what a call returned makes the variable a table that
   * `extends` the call, and writing below it makes `overlay` tables for the keys the chunk names.
   */
  container(expr: AstExpr): TableBuilder | undefined {
    if (expr.type === 'AstExprName') {
      if (this.isGlobal(expr)) {
        const global = this.globals.get(expr.name)
        if (global === undefined) return undefined
        global.value = extended(global.value)
        return global.value.kind === 'table' ? global.value : undefined
      }
      const binding = this.bindingOf(expr.range)
      const value = binding === undefined || !this.#constant.has(binding) ? undefined : this.#locals.get(binding)
      if (binding === undefined || value === undefined) return undefined
      const table = extended(value)
      this.#locals.set(binding, table)
      return table.kind === 'table' ? table : undefined
    }
    if (expr.type !== 'AstExprIndexName' && expr.type !== 'AstExprIndexExpr') {
      const value = this.evaluate(expr)
      return value.kind === 'table' ? value : undefined
    }
    const parent = this.container(expr.expr)
    const key = parent === undefined ? undefined : this.keyOfIndex(expr)
    if (parent === undefined || key === undefined) return undefined
    const entry = parent.entries.find(item => sameKey(item.key, key))
    if (entry === undefined) {
      if (parent.extends === undefined && parent.overlay !== true) return undefined
      const overlay: TableBuilder = { kind: 'table', range: expr.range, entries: [], overlay: true }
      store(parent, key, overlay, expr.range)
      return overlay
    }
    entry.value = extended(entry.value)
    return entry.value.kind === 'table' ? entry.value : undefined
  }

  /** Whether an expression path starts at a chunk-level local or global whose value is a known table. */
  rootsInKnownTable(expr: AstExpr): boolean {
    let current: AstExpr = expr
    while (current.type === 'AstExprIndexName' || current.type === 'AstExprIndexExpr')
      current = current.expr
    if (current.type !== 'AstExprName') return false
    return this.isKnownTableName(current)
  }

  chunk(block: AstStatBlock): Value {
    for (const stat of block.body) {
      if (stat.type === 'AstStatReturn') {
        const first = stat.list[0]
        return first === undefined ? { kind: 'nil', range: stat.range } : this.evaluate(first)
      }
      this.statement(stat)
    }
    return this.unresolved('no-return', block.range)
  }

  statement(stat: AstStat): void {
    switch (stat.type) {
      case 'AstStatLocal':
        stat.vars.forEach((local, index) => {
          const binding = this.bindingOf(local.range)
          if (binding === undefined) return
          const init = stat.values[index]
          this.#locals.set(
            binding,
            init === undefined ? { kind: 'nil', range: local.range } : this.evaluate(init),
          )
        })
        return
      case 'AstStatAssign': {
        // Lua evaluates every value before it assigns any (`a, b = b, a`); a last call or `...`
        // gives the targets past the listed values results nobody knows statically.
        const values = stat.values.map(value => this.evaluate(value))
        const last = stat.values.at(-1)
        const spread = last?.type === 'AstExprCall' || last?.type === 'AstExprVarargs'
        const valueAt = (index: number, target: AstExpr): Value =>
          values[index] ??
          (spread && last !== undefined ? this.unresolved(last.type === 'AstExprCall' ? 'call' : 'varargs', last.range) : { kind: 'nil', range: target.range })
        stat.vars.forEach((target, index) => {
          if (target.type === 'AstExprName') {
            if (!this.isGlobal(target)) return
            const global = this.globals.get(target.name)
            if (global === undefined) this.globals.set(target.name, { value: valueAt(index, target), range: stat.range })
            else Object.assign(global, { value: valueAt(index, target), range: stat.range })
            return
          }
          const place = this.target(target)
          if (place === undefined) return
          if ('unapplied' in place) {
            this.unappliedWrites.push({
              range: target.range,
              reason: place.unapplied,
              source: this.source(stat.range),
            })
            return
          }
          store(place.table, place.key, valueAt(index, target), stat.range)
        })
        return
      }
      case 'AstStatExpr': {
        const callee = this.calleePath(stat.expr.func)
        if (callee !== undefined) {
          this.calls.push({ callee, arguments: stat.expr.args.map(arg => this.evaluate(arg)), range: stat.range })
        }
        this.callsWithTables(stat.expr.args, stat.range)
        return
      }
      case 'AstStatFunction': {
        // `function module.name() … end` stores a function into the table right here.
        const place = stat.name.type === 'AstExprName' ? undefined : this.target(stat.name)
        if (place !== undefined && !('unapplied' in place)) {
          store(place.table, place.key, this.unresolved('function', stat.func.range), stat.range)
        }
        this.nestedWrites(stat)
        return
      }
      default:
        this.nestedWrites(stat)
    }
  }

  /** A call that receives a known table may change it (`table.insert`, `setmetatable`). */
  callsWithTables(args: readonly AstExpr[], range: LuaRange): void {
    if (
      args.some(
        arg =>
          this.rootsInKnownTable(arg) ||
          (arg.type === 'AstExprName' && this.isKnownTableName(arg)),
      )
    ) {
      this.unappliedWrites.push({
        range,
        reason: 'call-receives-table',
        source: this.source(range),
      })
    }
  }

  isKnownTableName(expr: AstExpr & { type: 'AstExprName' }): boolean {
    if (this.isGlobal(expr)) return this.globals.get(expr.name)?.value.kind === 'table'
    const binding = this.bindingOf(expr.range)
    return binding !== undefined && this.#locals.get(binding)?.kind === 'table'
  }

  /** Writes into known tables that happen inside functions, loops or branches. */
  nestedWrites(stat: AstStat): void {
    const reason: LuaUnappliedWrite['reason'] =
      stat.type === 'AstStatFunction' || stat.type === 'AstStatLocalFunction'
        ? 'inside-function'
        : 'inside-control-flow'
    const visitBlock = (block: AstStatBlock): void => {
      for (const inner of block.body) visit(inner)
    }
    const visit = (inner: AstStat): void => {
      switch (inner.type) {
        case 'AstStatAssign':
        case 'AstStatCompoundAssign': {
          const targets = inner.type === 'AstStatAssign' ? inner.vars : [inner.var]
          // Also a global the chunk assigns: a function or loop may set it again at run time.
          const global = (target: AstExpr) => target.type === 'AstExprName' && this.isGlobal(target) && this.globals.has(target.name)
          if (targets.some(target => this.rootsInKnownTable(target) || global(target))) {
            this.unappliedWrites.push({
              range: inner.range,
              reason,
              source: this.source(inner.range),
            })
          }
          return
        }
        case 'AstStatExpr':
          if (
            inner.expr.args.some(
              arg =>
                this.rootsInKnownTable(arg) ||
                (arg.type === 'AstExprName' && this.isKnownTableName(arg)),
            )
          ) {
            this.unappliedWrites.push({
              range: inner.range,
              reason: 'call-receives-table',
              source: this.source(inner.range),
            })
          }
          return
        case 'AstStatBlock':
          visitBlock(inner)
          return
        case 'AstStatDo':
        case 'AstStatWhile':
        case 'AstStatRepeat':
        case 'AstStatFor':
        case 'AstStatForIn':
          visitBlock(inner.body)
          return
        case 'AstStatIf':
          visitBlock(inner.thenbody)
          if (inner.elsebody !== undefined) {
            if (inner.elsebody.type === 'AstStatIf') visit(inner.elsebody)
            else visitBlock(inner.elsebody)
          }
          return
        case 'AstStatFunction':
        case 'AstStatLocalFunction':
          visitBlock(inner.func.body)
          return
        default:
          return
      }
    }
    visit(stat)
  }
}

function freezeCall(call: CallBuilder, seen: Map<TableBuilder, LuaStaticValue>): LuaStaticCall {
  return { callee: call.callee, arguments: call.arguments.map(argument => freeze(argument, seen)) }
}

function freeze(value: Value, seen = new Map<TableBuilder, LuaStaticValue>()): LuaStaticValue {
  if (value.kind === 'unresolved') {
    const { call, ...rest } = value
    return call === undefined ? rest : { ...rest, call: freezeCall(call, seen) }
  }
  if (value.kind !== 'table') return value
  const done = seen.get(value)
  if (done !== undefined) return done
  const entries: LuaStaticEntry[] = []
  const table: LuaStaticValue = {
    kind: 'table',
    entries,
    ...(value.metatable === true ? { metatable: true as const } : {}),
    ...(value.extends === undefined ? {} : { extends: freezeCall(value.extends, seen) }),
    ...(value.overlay === true ? { overlay: true as const } : {}),
    range: value.range,
  }
  seen.set(value, table)
  for (const entry of value.entries)
    entries.push({ key: entry.key, value: freeze(entry.value, seen), range: entry.range })
  return table
}

/** Statically read what a Lua module returns. */
export function readLuaModule(parse: LuaParseResult, text: string): LuaModuleReading {
  const reader = new Reader(text, bindLuaChunk(parse.chunk))
  const value = reader.chunk(parse.chunk)
  // One map, so a table that is both returned and passed to a call stays one value.
  const seen = new Map<TableBuilder, LuaStaticValue>()
  return {
    value: freeze(value, seen),
    unappliedWrites: reader.unappliedWrites,
    calls: reader.calls.map(call => ({
      callee: call.callee,
      arguments: call.arguments.map(argument => freeze(argument, seen)),
      range: call.range,
    })),
    globals: [...reader.globals].map(([name, global]) => ({ name, value: freeze(global.value, seen), range: global.range })),
  }
}

/** Entry of a static table by string or integer key. */
export function luaStaticField(
  value: LuaStaticValue | undefined,
  key: string | number,
): LuaStaticValue | undefined {
  if (value?.kind !== 'table') return undefined
  for (const entry of value.entries) {
    if (typeof key === 'string' && entry.key.kind === 'string' && entry.key.value === key)
      return entry.value
    if (typeof key === 'number' && entry.key.kind === 'number' && entry.key.value === key)
      return entry.value
  }
  return undefined
}

function callToJson(call: LuaStaticCall, seen: Set<LuaStaticValue>): unknown {
  return { callee: call.callee, arguments: call.arguments.map(argument => luaStaticToJson(argument, seen)) }
}

/**
 * Plain JSON view for inspection: unresolved values become `{ "$unresolved": reason, source }` (with
 * `$call` for a call of a global), a table built over a call carries `$extends`, an overlay `$overlay`.
 */
export function luaStaticToJson(value: LuaStaticValue, seen = new Set<LuaStaticValue>()): unknown {
  switch (value.kind) {
    case 'nil':
      return null
    case 'boolean':
      return value.value
    case 'number':
      return value.value ?? value.raw
    case 'string':
      return value.value
    case 'symbol':
      return { $symbol: value.path }
    case 'unresolved':
      return {
        $unresolved: value.reason,
        source: value.source,
        ...(value.call === undefined ? {} : { $call: callToJson(value.call, seen) }),
      }
    case 'table': {
      if (seen.has(value)) return { $cycle: true }
      seen.add(value)
      const keys = value.entries.map(entry => entry.key)
      const isArray =
        value.extends === undefined && value.overlay !== true && keys.every((key, index) => key.kind === 'number' && key.value === index + 1)
      if (isArray) return value.entries.map(entry => luaStaticToJson(entry.value, seen))
      const out: Record<string, unknown> = {
        ...(value.extends === undefined ? {} : { $extends: callToJson(value.extends, seen) }),
        ...(value.overlay === true ? { $overlay: true } : {}),
      }
      for (const entry of value.entries) {
        const name =
          entry.key.kind === 'number'
            ? entry.key.raw
            : entry.key.kind === 'symbol'
              ? `[${entry.key.path}]`
              : String(entry.key.value)
        out[name] = luaStaticToJson(entry.value, seen)
      }
      return out
    }
  }
}

/**
 * The plain decimal spelling of a Lua number literal, for exact decimal consumers such as the
 * UVD Q32.32 quantizer — never through a double. Luau digit separators are dropped and hex or
 * binary integers become decimal integers; hex floats (`0x1p4`) and LuaJIT suffixes (`12LL`,
 * `3i`) give `undefined`.
 */
export function luaDecimalSpelling(raw: string): string | undefined {
  const text = raw.replace(/_/gu, '')
  const sign = text.startsWith('-') ? '-' : ''
  const body = sign === '' ? text : text.slice(1)
  if (/^0[xX][0-9a-fA-F]+$/u.test(body) || /^0[bB][01]+$/u.test(body)) {
    return `${sign}${BigInt(body).toString()}`
  }
  return /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(body) ? `${sign}${body}` : undefined
}
