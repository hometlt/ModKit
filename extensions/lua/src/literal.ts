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
      readonly range: LuaRange
    }

export type LuaUnresolvedReason =
  | 'call'
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

export interface LuaModuleReading {
  /** The value of the chunk's final `return`, or `unresolved` with reason `no-return`. */
  readonly value: LuaStaticValue
  readonly unappliedWrites: readonly LuaUnappliedWrite[]
}

/** Mutable table used while reading; frozen into `LuaStaticValue` at the end. */
interface TableBuilder {
  readonly kind: 'table'
  readonly range: LuaRange
  readonly entries: { key: LuaStaticKey; value: Value; range: LuaRange }[]
}

type Value = Exclude<LuaStaticValue, { kind: 'table' }> | TableBuilder

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

class Reader {
  readonly #text: string
  readonly #binding: LuaBindResult
  /** Values of chunk-level locals, by binding id. */
  readonly #locals = new Map<number, Value>()
  /** Bindings whose only write is their declaration. */
  readonly #constant = new Set<number>()
  readonly unappliedWrites: LuaUnappliedWrite[] = []

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

  unresolved(reason: LuaUnresolvedReason, range: LuaRange): Value {
    return { kind: 'unresolved', reason, source: this.source(range), range }
  }

  bindingOf(range: LuaRange): number | undefined {
    const occurrence = this.#binding.occurrenceAt(range[0])
    return occurrence !== undefined && occurrence.range[0] === range[0]
      ? occurrence.binding
      : undefined
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
          return { kind: 'symbol', path: expr.name, range: expr.range }
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
        return lookup(base, key) ?? this.unresolved('missing-field', expr.range)
      }
      case 'AstExprCall':
        return this.unresolved('call', expr.range)
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

  /** Field path of an assignment target rooted at a chunk-level local table, if static. */
  target(
    expr: AstExpr,
  ):
    | { table: TableBuilder; key: LuaStaticKey }
    | { unapplied: 'dynamic-key' | 'unresolved-target' }
    | undefined {
    if (expr.type !== 'AstExprIndexName' && expr.type !== 'AstExprIndexExpr') return undefined
    const base = this.evaluate(expr.expr)
    if (base.kind !== 'table') {
      return base.kind === 'unresolved' && this.rootsInKnownTable(expr)
        ? { unapplied: 'unresolved-target' }
        : undefined
    }
    const key =
      expr.type === 'AstExprIndexName'
        ? ({ kind: 'string', value: expr.index } as const)
        : keyOf(this.evaluate(expr.index))
    return key === undefined ? { unapplied: 'dynamic-key' } : { table: base, key }
  }

  /** Whether an expression path starts at a chunk-level local whose value is known. */
  rootsInKnownTable(expr: AstExpr): boolean {
    let current: AstExpr = expr
    while (current.type === 'AstExprIndexName' || current.type === 'AstExprIndexExpr')
      current = current.expr
    if (current.type !== 'AstExprName') return false
    const binding = this.bindingOf(current.range)
    return binding !== undefined && this.#locals.get(binding)?.kind === 'table'
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
      case 'AstStatAssign':
        stat.vars.forEach((target, index) => {
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
          const init = stat.values[index]
          store(
            place.table,
            place.key,
            init === undefined ? { kind: 'nil', range: target.range } : this.evaluate(init),
            stat.range,
          )
        })
        return
      case 'AstStatExpr':
        this.callsWithTables(stat.expr.args, stat.range)
        return
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
          (arg.type === 'AstExprName' && this.isKnownTableName(arg.range)),
      )
    ) {
      this.unappliedWrites.push({
        range,
        reason: 'call-receives-table',
        source: this.source(range),
      })
    }
  }

  isKnownTableName(range: LuaRange): boolean {
    const binding = this.bindingOf(range)
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
          if (targets.some(target => this.rootsInKnownTable(target))) {
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
                (arg.type === 'AstExprName' && this.isKnownTableName(arg.range)),
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

function freeze(value: Value, seen = new Map<TableBuilder, LuaStaticValue>()): LuaStaticValue {
  if (value.kind !== 'table') return value
  const done = seen.get(value)
  if (done !== undefined) return done
  const entries: LuaStaticEntry[] = []
  const table: LuaStaticValue = { kind: 'table', entries, range: value.range }
  seen.set(value, table)
  for (const entry of value.entries)
    entries.push({ key: entry.key, value: freeze(entry.value, seen), range: entry.range })
  return table
}

/** Statically read what a Lua module returns. */
export function readLuaModule(parse: LuaParseResult, text: string): LuaModuleReading {
  const reader = new Reader(text, bindLuaChunk(parse.chunk))
  const value = reader.chunk(parse.chunk)
  return { value: freeze(value), unappliedWrites: reader.unappliedWrites }
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

/** Plain JSON view for inspection: unresolved values become `{ "$unresolved": reason, source }`. */
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
      return { $unresolved: value.reason, source: value.source }
    case 'table': {
      if (seen.has(value)) return { $cycle: true }
      seen.add(value)
      const keys = value.entries.map(entry => entry.key)
      const isArray = keys.every((key, index) => key.kind === 'number' && key.value === index + 1)
      if (isArray) return value.entries.map(entry => luaStaticToJson(entry.value, seen))
      const out: Record<string, unknown> = {}
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
