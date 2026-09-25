import type {
  AstExpr,
  AstExprFunction,
  AstLocal,
  AstStat,
  AstStatBlock,
  AstType,
  AstTypeList,
  AstTypeOrPack,
  AstTypePack,
  LuaRange,
} from './ast.js'

/**
 * Lexical binding of a Lua-family chunk: which declaration every identifier refers to. This is
 * the step Luau performs while parsing (`AstExprLocal` / `AstExprGlobal`); here it runs over the
 * syntactic tree so unresolved names stay visible to tools.
 *
 * Lua scoping rules implemented:
 * - `local a = a` — the new local is visible only after its statement.
 * - `local function f` — `f` is visible inside its own body; `function f` assigns `f`.
 * - Numeric and generic `for` variables live in the loop body.
 * - `repeat … until cond` — `cond` sees locals of the loop body.
 * - A method declared with `:` has an implicit `self` parameter.
 * - `goto`/labels resolve to the label of the enclosing function with that name.
 * Luau type names are bound separately (type aliases and generics) and never shadow values.
 */

export type LuaBindingKind =
  | 'local'
  | 'const'
  | 'parameter'
  | 'self'
  | 'function'
  | 'for'
  | 'global'
  | 'label'
  | 'type'
  | 'generic'

export interface LuaBinding {
  readonly id: number
  readonly name: string
  readonly kind: LuaBindingKind
  /** Range of the declaring name; absent for globals and implicit `self`. */
  readonly declaration?: LuaRange
  /** Luau annotation of a local or parameter. */
  readonly annotation?: AstType
  /** For `function` bindings: the function value. */
  readonly func?: AstExprFunction
}

export interface LuaOccurrence {
  readonly range: LuaRange
  readonly binding: number
  readonly declaration: boolean
  readonly write: boolean
}

export interface LuaBindResult {
  readonly bindings: readonly LuaBinding[]
  /** Sorted by start offset. */
  readonly occurrences: readonly LuaOccurrence[]
  /** Global names in first-occurrence order. */
  readonly globals: ReadonlyMap<string, LuaBinding>
  occurrenceAt(offset: number): LuaOccurrence | undefined
  occurrencesOf(binding: number): readonly LuaOccurrence[]
}

interface Scope {
  readonly parent: Scope | undefined
  readonly values: Map<string, number>
  readonly types: Map<string, number>
  /** Function boundary for labels. */
  readonly labels: Map<string, number> | undefined
}

class Binder {
  readonly bindings: LuaBinding[] = []
  readonly occurrences: LuaOccurrence[] = []
  readonly globals = new Map<string, LuaBinding>()
  readonly #pendingGotos: { scope: Scope; name: string; range: LuaRange }[] = []

  scope(parent: Scope | undefined, functionBoundary = false): Scope {
    return {
      parent,
      values: new Map(),
      types: new Map(),
      labels: functionBoundary || parent === undefined ? new Map() : parent.labels,
    }
  }

  declare(
    scope: Scope,
    name: string,
    kind: LuaBindingKind,
    range: LuaRange | undefined,
    extra: Partial<Pick<LuaBinding, 'annotation' | 'func'>> = {},
  ): number {
    const id = this.bindings.length
    this.bindings.push({
      id,
      name,
      kind,
      ...(range === undefined ? {} : { declaration: range }),
      ...(extra.annotation === undefined ? {} : { annotation: extra.annotation }),
      ...(extra.func === undefined ? {} : { func: extra.func }),
    })
    const table = kind === 'type' || kind === 'generic' ? scope.types : scope.values
    table.set(name, id)
    if (range !== undefined) {
      this.occurrences.push({ range, binding: id, declaration: true, write: true })
    }
    return id
  }

  declareLocal(scope: Scope, local: AstLocal, kind: LuaBindingKind): number {
    if (local.annotation !== undefined) this.type(local.annotation, scope)
    const effective: LuaBindingKind =
      kind === 'local' && (local.isConst === true || local.attribute === 'const') ? 'const' : kind
    return this.declare(scope, local.name, effective, local.range, {
      ...(local.annotation === undefined ? {} : { annotation: local.annotation }),
    })
  }

  lookup(scope: Scope | undefined, name: string, types = false): number | undefined {
    for (let current = scope; current !== undefined; current = current.parent) {
      const found = (types ? current.types : current.values).get(name)
      if (found !== undefined) return found
    }
    return undefined
  }

  reference(scope: Scope, name: string, range: LuaRange, write: boolean): void {
    let binding = this.lookup(scope, name)
    if (binding === undefined) {
      let global = this.globals.get(name)
      if (global === undefined) {
        global = { id: this.bindings.length, name, kind: 'global' }
        this.bindings.push(global)
        this.globals.set(name, global)
      }
      binding = global.id
    }
    this.occurrences.push({ range, binding, declaration: false, write })
  }

  typeReference(scope: Scope, name: string, range: LuaRange): void {
    const binding = this.lookup(scope, name, true)
    if (binding !== undefined) {
      this.occurrences.push({ range, binding, declaration: false, write: false })
    }
  }

  // --- statements -------------------------------------------------------------------------

  block(block: AstStatBlock, scope: Scope): void {
    // Luau type aliases are visible in the whole block, including before their declaration.
    for (const statement of block.body) {
      if (statement.type === 'AstStatTypeAlias' || statement.type === 'AstStatTypeFunction') {
        this.declare(scope, statement.name.name, 'type', statement.name.range)
      }
    }
    for (const statement of block.body) this.statement(statement, scope)
  }

  statement(statement: AstStat, scope: Scope): void {
    switch (statement.type) {
      case 'AstStatBlock':
        this.block(statement, this.scope(scope))
        return
      case 'AstStatDo':
        this.block(statement.body, this.scope(scope))
        return
      case 'AstStatIf':
        this.expression(statement.condition, scope)
        this.block(statement.thenbody, this.scope(scope))
        if (statement.elsebody !== undefined) {
          if (statement.elsebody.type === 'AstStatIf') this.statement(statement.elsebody, scope)
          else this.block(statement.elsebody, this.scope(scope))
        }
        return
      case 'AstStatWhile':
        this.expression(statement.condition, scope)
        this.block(statement.body, this.scope(scope))
        return
      case 'AstStatRepeat': {
        const inner = this.scope(scope)
        this.block(statement.body, inner)
        this.expression(statement.condition, inner)
        return
      }
      case 'AstStatBreak':
      case 'AstStatContinue':
        return
      case 'AstStatReturn':
        for (const value of statement.list) this.expression(value, scope)
        return
      case 'AstStatExpr':
        this.expression(statement.expr, scope)
        return
      case 'AstStatLocal':
        for (const value of statement.values) this.expression(value, scope)
        for (const local of statement.vars) this.declareLocal(scope, local, 'local')
        return
      case 'AstStatFor': {
        this.expression(statement.from, scope)
        this.expression(statement.to, scope)
        if (statement.step !== undefined) this.expression(statement.step, scope)
        const inner = this.scope(scope)
        this.declareLocal(inner, statement.var, 'for')
        this.block(statement.body, inner)
        return
      }
      case 'AstStatForIn': {
        for (const value of statement.values) this.expression(value, scope)
        const inner = this.scope(scope)
        for (const local of statement.vars) this.declareLocal(inner, local, 'for')
        this.block(statement.body, inner)
        return
      }
      case 'AstStatAssign':
        for (const value of statement.values) this.expression(value, scope)
        for (const target of statement.vars) this.assignmentTarget(target, scope)
        return
      case 'AstStatCompoundAssign':
        this.expression(statement.value, scope)
        this.assignmentTarget(statement.var, scope)
        return
      case 'AstStatFunction':
        this.assignmentTarget(statement.name, scope)
        this.func(statement.func, scope)
        return
      case 'AstStatLocalFunction': {
        this.declare(
          scope,
          statement.name.name,
          statement.name.isConst === true ? 'const' : 'function',
          statement.name.range,
          { func: statement.func },
        )
        this.func(statement.func, scope)
        return
      }
      case 'AstStatTypeAlias': {
        const inner = this.scope(scope)
        for (const generic of statement.generics)
          this.declare(inner, generic.name, 'generic', generic.range)
        for (const pack of statement.genericPacks)
          this.declare(inner, pack.name, 'generic', pack.range)
        this.type(statement.value, inner)
        return
      }
      case 'AstStatTypeFunction':
        this.func(statement.body, scope)
        return
      case 'AstStatGoto':
        this.#pendingGotos.push({ scope, name: statement.label.name, range: statement.label.range })
        return
      case 'AstStatLabel':
        if (scope.labels !== undefined) {
          const id = this.bindings.length
          this.bindings.push({
            id,
            name: statement.name.name,
            kind: 'label',
            declaration: statement.name.range,
          })
          scope.labels.set(statement.name.name, id)
          this.occurrences.push({
            range: statement.name.range,
            binding: id,
            declaration: true,
            write: true,
          })
        }
        return
    }
  }

  assignmentTarget(target: AstExpr, scope: Scope): void {
    if (target.type === 'AstExprName') {
      this.reference(scope, target.name, target.range, true)
      return
    }
    this.expression(target, scope)
  }

  func(func: AstExprFunction, scope: Scope): void {
    const inner = this.scope(scope, true)
    for (const generic of func.generics) this.declare(inner, generic.name, 'generic', generic.range)
    for (const pack of func.genericPacks) this.declare(inner, pack.name, 'generic', pack.range)
    if (func.self !== undefined) this.declare(inner, 'self', 'self', undefined)
    for (const arg of func.args) this.declareLocal(inner, arg, 'parameter')
    if (func.varargAnnotation !== undefined) this.typePack(func.varargAnnotation, inner)
    if (func.returnAnnotation !== undefined) this.typeList(func.returnAnnotation, inner)
    this.block(func.body, inner)
  }

  // --- expressions ------------------------------------------------------------------------

  expression(expression: AstExpr, scope: Scope): void {
    switch (expression.type) {
      case 'AstExprName':
        this.reference(scope, expression.name, expression.range, false)
        return
      case 'AstExprGroup':
        this.expression(expression.expr, scope)
        return
      case 'AstExprConstantNil':
      case 'AstExprConstantBool':
      case 'AstExprConstantNumber':
      case 'AstExprConstantString':
      case 'AstExprVarargs':
        return
      case 'AstExprCall':
        this.expression(expression.func, scope)
        for (const arg of expression.args) this.expression(arg, scope)
        for (const argument of expression.typeArguments ?? []) this.typeOrPack(argument, scope)
        return
      case 'AstExprIndexName':
        this.expression(expression.expr, scope)
        return
      case 'AstExprIndexExpr':
        this.expression(expression.expr, scope)
        this.expression(expression.index, scope)
        return
      case 'AstExprFunction':
        this.func(expression, scope)
        return
      case 'AstExprTable':
        for (const item of expression.items) {
          if (item.key !== undefined) this.expression(item.key, scope)
          if (item.value !== undefined) this.expression(item.value, scope)
        }
        return
      case 'AstExprUnary':
        this.expression(expression.expr, scope)
        return
      case 'AstExprBinary':
        this.expression(expression.left, scope)
        this.expression(expression.right, scope)
        return
      case 'AstExprTypeAssertion':
        this.expression(expression.expr, scope)
        this.type(expression.annotation, scope)
        return
      case 'AstExprIfElse':
        this.expression(expression.condition, scope)
        this.expression(expression.trueExpr, scope)
        this.expression(expression.falseExpr, scope)
        return
      case 'AstExprInterpString':
        for (const part of expression.expressions) this.expression(part, scope)
        return
    }
  }

  // --- Luau types -------------------------------------------------------------------------

  type(type: AstType, scope: Scope): void {
    switch (type.type) {
      case 'AstTypeReference':
        if (type.prefix === undefined) this.typeReference(scope, type.name, type.nameLocation)
        for (const parameter of type.parameters) this.typeOrPack(parameter, scope)
        return
      case 'AstTypeTable':
        for (const prop of type.props) this.type(prop.type, scope)
        if (type.indexer !== undefined) {
          if (type.indexer.indexType !== undefined) this.type(type.indexer.indexType, scope)
          this.type(type.indexer.resultType, scope)
        }
        return
      case 'AstTypeFunction': {
        const inner = this.scope(scope)
        for (const generic of type.generics)
          this.declare(inner, generic.name, 'generic', generic.range)
        for (const pack of type.genericPacks) this.declare(inner, pack.name, 'generic', pack.range)
        this.typeList(type.argTypes, inner)
        this.typeList(type.returnTypes, inner)
        return
      }
      case 'AstTypeTypeof':
        this.expression(type.expr, scope)
        return
      case 'AstTypeOptional':
        this.type(type.base, scope)
        return
      case 'AstTypeUnion':
      case 'AstTypeIntersection':
        for (const member of type.types) this.type(member, scope)
        return
      case 'AstTypeSingletonBool':
      case 'AstTypeSingletonString':
        return
      case 'AstTypeGroup':
        this.type(type.inner, scope)
        return
    }
  }

  typeList(list: AstTypeList, scope: Scope): void {
    for (const member of list.types) this.type(member, scope)
    if (list.tailType !== undefined) this.typePack(list.tailType, scope)
  }

  typePack(pack: AstTypePack, scope: Scope): void {
    switch (pack.type) {
      case 'AstTypePackExplicit':
        this.typeList(pack.typeList, scope)
        return
      case 'AstTypePackVariadic':
        this.type(pack.variadicType, scope)
        return
      case 'AstTypePackGeneric': {
        const binding = this.lookup(scope, pack.genericName, true)
        if (binding !== undefined) {
          this.occurrences.push({
            range: [pack.range[0], pack.range[0] + pack.genericName.length],
            binding,
            declaration: false,
            write: false,
          })
        }
        return
      }
    }
  }

  typeOrPack(value: AstTypeOrPack, scope: Scope): void {
    if (
      value.type === 'AstTypePackExplicit' ||
      value.type === 'AstTypePackVariadic' ||
      value.type === 'AstTypePackGeneric'
    ) {
      this.typePack(value, scope)
    } else {
      this.type(value, scope)
    }
  }

  resolveGotos(): void {
    for (const pending of this.#pendingGotos) {
      const binding = pending.scope.labels?.get(pending.name)
      if (binding !== undefined) {
        this.occurrences.push({ range: pending.range, binding, declaration: false, write: false })
      }
    }
  }
}

export function bindLuaChunk(chunk: AstStatBlock): LuaBindResult {
  const binder = new Binder()
  const root = binder.scope(undefined, true)
  binder.block(chunk, root)
  binder.resolveGotos()
  const occurrences = binder.occurrences.sort(
    (a, b) => a.range[0] - b.range[0] || a.range[1] - b.range[1],
  )
  const byBinding = new Map<number, LuaOccurrence[]>()
  for (const occurrence of occurrences) {
    const list = byBinding.get(occurrence.binding)
    if (list === undefined) byBinding.set(occurrence.binding, [occurrence])
    else list.push(occurrence)
  }
  return Object.freeze({
    bindings: binder.bindings,
    occurrences,
    globals: binder.globals,
    occurrenceAt(offset: number): LuaOccurrence | undefined {
      let low = 0
      let high = occurrences.length - 1
      while (low <= high) {
        const middle = (low + high) >> 1
        const candidate = occurrences[middle]
        if (candidate === undefined) break
        if (candidate.range[1] < offset) low = middle + 1
        else if (candidate.range[0] > offset) high = middle - 1
        else return candidate
      }
      return undefined
    },
    occurrencesOf(binding: number): readonly LuaOccurrence[] {
      return byBinding.get(binding) ?? []
    },
  })
}
