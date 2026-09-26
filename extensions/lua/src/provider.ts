import {
  LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
  languageWorkspaceIsSemanticallyIncomplete,
  type LanguageAnalysis,
  type LanguageAnalysisRequest,
  type LanguageDiagnostic,
  type LanguageDocument,
  type LanguageDocumentSymbolList,
  type LanguageFeatureRequest,
  type LanguageHover,
  type LanguageLocation,
  type LanguageLocationList,
  type LanguagePositionRequest,
  type LanguageProvider,
  type LanguageProviderCompletionList,
  type LanguageReferencesRequest,
  type LanguageRenamePreparation,
  type LanguageRenameRequest,
  type LanguageSymbol,
  type LanguageSymbolKind,
  type LanguageTextDocumentEdit,
  type LanguageToken,
  type LanguageTokenKind,
  type LanguageWorkspaceEdit,
} from '@modkit/sdk'
import type {
  AstExpr,
  AstExprFunction,
  AstStat,
  AstStatBlock,
  AstType,
  AstTypeList,
  AstTypeOrPack,
  LuaDialect,
  LuaParseResult,
  LuaRange,
} from './ast.js'
import { LUA_DIALECTS, LUA_TOKEN_CLASSES } from './ast.js'
import { bindLuaChunk, type LuaBinding, type LuaBindResult } from './binder.js'
import {
  documentPathOf,
  environmentCompletion,
  environmentDefinition,
  environmentHover,
  LUA_ENVIRONMENT_FILE,
  luaEnvironmentOf,
  LuaEnvironmentView,
  type DocumentView,
} from './environment.js'
import { LuaLineIndex } from './line-index.js'
import { luaSyntax, type LuaSyntax } from './syntax.js'

export const LUA_LANGUAGE_IDS = Object.freeze(['lua', 'luau'] as const)

const PROVIDER_REVISION = '2'

/** A parsed, bound document version. */
export interface LuaDocumentState {
  readonly document: LanguageDocument
  readonly dialect: LuaDialect
  readonly parse: LuaParseResult
  readonly binding: LuaBindResult
  readonly lines: LuaLineIndex
  /** A dialect the document declared that this provider does not know; it was guessed instead. */
  readonly unknownDialect?: string
}

/**
 * The dialect a game declared for the file (`LanguageDocument.dialect`, from its
 * `modkit.languageFiles`) wins. Otherwise `luau` documents (and `.luau` files) are Luau, and a `lua`
 * document is Lua 5.4 unless Luau parses it with fewer errors: Roblox projects keep Luau in `.lua`
 * files, and Lua 5.1–5.3 programs are Lua 5.4 syntax apart from `goto` used as a name.
 */
export function resolveLuaDialect(
  syntax: LuaSyntax,
  document: LanguageDocument,
): {
  readonly dialect: LuaDialect
  readonly parse: LuaParseResult
  readonly unknownDialect?: string
} {
  const declared = document.dialect
  if (declared !== undefined) {
    const known = LUA_DIALECTS.find(dialect => dialect === declared)
    if (known !== undefined) return { dialect: known, parse: syntax.parse(document.text, known) }
    const { dialect: _unknown, ...undeclared } = document
    return { ...resolveLuaDialect(syntax, undeclared), unknownDialect: declared }
  }
  if (document.languageId === 'luau' || /\.luau$/iu.test(document.uri)) {
    return { dialect: 'luau', parse: syntax.parse(document.text, 'luau') }
  }
  // Only the order of attempts depends on this hint; the dialect with fewer errors still wins.
  const order: readonly [LuaDialect, LuaDialect] = LUAU_HINT.test(document.text)
    ? ['luau', 'lua54']
    : ['lua54', 'luau']
  const first = syntax.parse(document.text, order[0])
  if (first.errors.length === 0) return { dialect: order[0], parse: first }
  const second = syntax.parse(document.text, order[1])
  return second.errors.length < first.errors.length
    ? { dialect: order[1], parse: second }
    : { dialect: order[0], parse: first }
}

/** Cheap signs of Roblox Luau: hot comments, engine globals, `continue`, compound assignment. */
const LUAU_HINT =
  /--!(?:strict|nonstrict|nocheck|native|optimize)\b|\b(?:game|script|workspace)\s*[.:]|\bcontinue\b|`|[-+*/%^]=/u

const cache = new Map<string, LuaDocumentState>()
const CACHE_LIMIT = 64

export async function luaDocumentState(
  document: LanguageDocument,
  dialect?: LuaDialect,
): Promise<LuaDocumentState> {
  const key = `${document.uri}\u0000${document.version}\u0000${dialect ?? document.dialect ?? ''}`
  const cached = cache.get(key)
  if (cached !== undefined && cached.document.text === document.text) return cached
  const syntax = await luaSyntax()
  const resolved =
    dialect === undefined
      ? resolveLuaDialect(syntax, document)
      : { dialect, parse: syntax.parse(document.text, dialect) }
  const state: LuaDocumentState = Object.freeze({
    document,
    dialect: resolved.dialect,
    parse: resolved.parse,
    binding: bindLuaChunk(resolved.parse.chunk),
    lines: new LuaLineIndex(document.text),
    ...('unknownDialect' in resolved && resolved.unknownDialect !== undefined ? { unknownDialect: resolved.unknownDialect } : {}),
  })
  cache.set(key, state)
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return state
}

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

const CONTEXTUAL_KEYWORDS = new Set(['type', 'export', 'continue', 'typeof'])

/** Syntactic roles of identifier ranges that binding alone cannot give. */
function identifierRoles(chunk: AstStatBlock): Map<number, LanguageTokenKind> {
  const roles = new Map<number, LanguageTokenKind>()
  const mark = (range: LuaRange, kind: LanguageTokenKind): void => {
    roles.set(range[0], kind)
  }
  const visitType = (type: AstTypeOrPack): void => {
    switch (type.type) {
      case 'AstTypeReference':
        mark(type.nameLocation, 'type')
        for (const parameter of type.parameters) visitType(parameter)
        return
      case 'AstTypeTable':
        for (const prop of type.props) {
          mark(prop.range, 'property')
          visitType(prop.type)
        }
        if (type.indexer?.indexType !== undefined) visitType(type.indexer.indexType)
        if (type.indexer !== undefined) visitType(type.indexer.resultType)
        return
      case 'AstTypeFunction':
        for (const generic of type.generics) mark(generic.range, 'type')
        for (const pack of type.genericPacks) mark(pack.range, 'type')
        visitList(type.argTypes)
        visitList(type.returnTypes)
        for (const name of type.argNames) if (name !== null) mark(name.range, 'parameter')
        return
      case 'AstTypeTypeof':
        visitExpr(type.expr)
        return
      case 'AstTypeOptional':
        visitType(type.base)
        return
      case 'AstTypeUnion':
      case 'AstTypeIntersection':
        for (const member of type.types) visitType(member)
        return
      case 'AstTypeGroup':
        visitType(type.inner)
        return
      case 'AstTypePackExplicit':
        visitList(type.typeList)
        return
      case 'AstTypePackVariadic':
        visitType(type.variadicType)
        return
      case 'AstTypePackGeneric':
        mark([type.range[0], type.range[0] + type.genericName.length], 'type')
        return
      case 'AstTypeSingletonBool':
      case 'AstTypeSingletonString':
        return
    }
  }
  const visitList = (list: AstTypeList): void => {
    for (const member of list.types) visitType(member)
    if (list.tailType !== undefined) visitType(list.tailType)
  }
  const visitFunction = (func: AstExprFunction): void => {
    for (const attribute of func.attributes) mark(attribute.range, 'function')
    for (const generic of func.generics) mark(generic.range, 'type')
    for (const pack of func.genericPacks) mark(pack.range, 'type')
    for (const arg of func.args) if (arg.annotation !== undefined) visitType(arg.annotation)
    if (func.varargAnnotation !== undefined) visitType(func.varargAnnotation)
    if (func.returnAnnotation !== undefined) visitList(func.returnAnnotation)
    visitBlock(func.body)
  }
  const visitCallee = (callee: AstExpr): void => {
    if (callee.type === 'AstExprName') mark(callee.range, 'function')
    else if (callee.type === 'AstExprIndexName') mark(callee.indexLocation, 'function')
  }
  const visitExpr = (expr: AstExpr): void => {
    switch (expr.type) {
      case 'AstExprCall':
        visitCallee(expr.func)
        visitExpr(expr.func)
        for (const arg of expr.args) visitExpr(arg)
        for (const argument of expr.typeArguments ?? []) visitType(argument)
        return
      case 'AstExprIndexName':
        if (!roles.has(expr.indexLocation[0])) mark(expr.indexLocation, 'property')
        visitExpr(expr.expr)
        return
      case 'AstExprIndexExpr':
        visitExpr(expr.expr)
        visitExpr(expr.index)
        return
      case 'AstExprFunction':
        visitFunction(expr)
        return
      case 'AstExprTable':
        for (const item of expr.items) {
          if (item.name !== undefined) mark(item.name.range, 'property')
          if (item.key !== undefined) visitExpr(item.key)
          if (item.value !== undefined) visitExpr(item.value)
        }
        return
      case 'AstExprGroup':
      case 'AstExprUnary':
        visitExpr(expr.expr)
        return
      case 'AstExprBinary':
        visitExpr(expr.left)
        visitExpr(expr.right)
        return
      case 'AstExprTypeAssertion':
        visitExpr(expr.expr)
        visitType(expr.annotation)
        return
      case 'AstExprIfElse':
        visitExpr(expr.condition)
        visitExpr(expr.trueExpr)
        visitExpr(expr.falseExpr)
        return
      case 'AstExprInterpString':
        for (const part of expr.expressions) visitExpr(part)
        return
      default:
        return
    }
  }
  const visitStat = (stat: AstStat): void => {
    switch (stat.type) {
      case 'AstStatBlock':
        visitBlock(stat)
        return
      case 'AstStatDo':
        visitBlock(stat.body)
        return
      case 'AstStatIf':
        visitExpr(stat.condition)
        visitBlock(stat.thenbody)
        if (stat.elsebody !== undefined) visitStat(stat.elsebody)
        return
      case 'AstStatWhile':
        visitExpr(stat.condition)
        visitBlock(stat.body)
        return
      case 'AstStatRepeat':
        visitBlock(stat.body)
        visitExpr(stat.condition)
        return
      case 'AstStatReturn':
        for (const value of stat.list) visitExpr(value)
        return
      case 'AstStatExpr':
        visitExpr(stat.expr)
        return
      case 'AstStatLocal':
        for (const local of stat.vars)
          if (local.annotation !== undefined) visitType(local.annotation)
        for (const value of stat.values) visitExpr(value)
        return
      case 'AstStatFor':
        visitExpr(stat.from)
        visitExpr(stat.to)
        if (stat.step !== undefined) visitExpr(stat.step)
        visitBlock(stat.body)
        return
      case 'AstStatForIn':
        for (const value of stat.values) visitExpr(value)
        visitBlock(stat.body)
        return
      case 'AstStatAssign':
        for (const target of stat.vars) visitExpr(target)
        for (const value of stat.values) visitExpr(value)
        return
      case 'AstStatCompoundAssign':
        visitExpr(stat.var)
        visitExpr(stat.value)
        return
      case 'AstStatFunction':
        visitCallee(stat.name)
        visitExpr(stat.name)
        visitFunction(stat.func)
        return
      case 'AstStatLocalFunction':
        mark(stat.name.range, 'function')
        visitFunction(stat.func)
        return
      case 'AstStatTypeAlias':
        mark(stat.name.range, 'type')
        for (const generic of stat.generics) mark(generic.range, 'type')
        for (const pack of stat.genericPacks) mark(pack.range, 'type')
        visitType(stat.value)
        return
      case 'AstStatTypeFunction':
        mark(stat.name.range, 'type')
        visitFunction(stat.body)
        return
      default:
        return
    }
  }
  const visitBlock = (block: AstStatBlock): void => {
    for (const stat of block.body) visitStat(stat)
  }
  visitBlock(chunk)
  return roles
}

const BINDING_TOKEN_KINDS: Readonly<Record<LuaBinding['kind'], LanguageTokenKind>> = Object.freeze({
  local: 'variable',
  const: 'variable',
  parameter: 'parameter',
  self: 'parameter',
  function: 'function',
  for: 'variable',
  global: 'variable',
  label: 'variable',
  type: 'type',
  generic: 'type',
})

export function luaSemanticTokens(state: LuaDocumentState): LanguageToken[] {
  const { parse, binding, lines, document } = state
  const roles = identifierRoles(parse.chunk)
  const tokens: { start: number; end: number; kind: LanguageTokenKind; modifiers?: string[] }[] = []
  for (const comment of parse.comments) {
    tokens.push({ start: comment.range[0], end: comment.range[1], kind: 'comment' })
  }
  const packed = parse.tokens
  for (let index = 0; index + 2 < packed.length; index += 3) {
    const code = packed[index] ?? 0
    const start = packed[index + 1] ?? 0
    const end = packed[index + 2] ?? 0
    if (end <= start) continue
    const tokenClass = LUA_TOKEN_CLASSES[code]
    let kind: LanguageTokenKind
    let modifiers: string[] | undefined
    switch (tokenClass) {
      case 'keyword':
        kind = 'keyword'
        break
      case 'number':
        kind = 'number'
        break
      case 'string':
      case 'interpolated-string':
        kind = 'string'
        break
      case 'operator':
        kind = 'operator'
        break
      default: {
        const occurrence = binding.occurrenceAt(start)
        const role = roles.get(start)
        const bound =
          occurrence !== undefined && occurrence.range[0] === start
            ? binding.bindings[occurrence.binding]
            : undefined
        if (role === 'function' || role === 'property' || role === 'type' || role === 'parameter') {
          kind = role
        } else if (bound !== undefined) {
          kind = BINDING_TOKEN_KINDS[bound.kind]
          if (bound.kind === 'global') modifiers = ['global']
          if (bound.kind === 'const') modifiers = ['readonly']
        } else if (CONTEXTUAL_KEYWORDS.has(document.text.slice(start, end))) {
          kind = 'keyword'
        } else {
          kind = 'variable'
        }
      }
    }
    tokens.push({ start, end, kind, ...(modifiers === undefined ? {} : { modifiers }) })
  }
  tokens.sort((a, b) => a.start - b.start)
  return tokens.map(token => ({
    range: lines.range([token.start, token.end]),
    kind: token.kind,
    ...(token.modifiers === undefined ? {} : { modifiers: token.modifiers }),
  }))
}

// ---------------------------------------------------------------------------------------------
// Diagnostics and symbols
// ---------------------------------------------------------------------------------------------

export function luaDiagnostics(state: LuaDocumentState): LanguageDiagnostic[] {
  const syntax = state.parse.errors.map(error => ({
    range: state.lines.range(error.range),
    severity: 'error' as const,
    message: error.message,
    code: 'syntax',
    source: state.dialect,
  }))
  if (state.unknownDialect === undefined) return syntax
  return [
    {
      range: state.lines.range([0, 0]),
      severity: 'warning' as const,
      message: `The file is declared as Lua dialect "${state.unknownDialect}", which this provider does not know (${LUA_DIALECTS.join(', ')}); it is read as ${state.dialect}.`,
      code: 'unknown-dialect',
      source: state.dialect,
    },
    ...syntax,
  ]
}

function exprName(expr: AstExpr): string | undefined {
  if (expr.type === 'AstExprName') return expr.name
  if (expr.type === 'AstExprIndexName') {
    const base = exprName(expr.expr)
    return base === undefined ? undefined : `${base}${expr.op}${expr.index}`
  }
  return undefined
}

function exprSelection(expr: AstExpr): LuaRange {
  return expr.type === 'AstExprIndexName' ? expr.indexLocation : expr.range
}

export function luaDocumentSymbols(state: LuaDocumentState): LanguageSymbol[] {
  const { lines } = state
  const symbol = (
    name: string,
    kind: LanguageSymbolKind,
    range: LuaRange,
    selection: LuaRange,
    children: LanguageSymbol[] = [],
    detail?: string,
  ): LanguageSymbol => ({
    name,
    kind,
    range: lines.range(range),
    selectionRange: lines.range(selection),
    ...(detail === undefined ? {} : { detail }),
    ...(children.length === 0 ? {} : { children }),
  })
  const signature = (func: AstExprFunction): string =>
    `(${[...func.args.map(arg => arg.name), ...(func.vararg ? ['...'] : [])].join(', ')})`
  const functionSymbols = (block: AstStatBlock): LanguageSymbol[] => {
    const out: LanguageSymbol[] = []
    const walkExpr = (expr: AstExpr, into: LanguageSymbol[]): void => {
      if (expr.type === 'AstExprFunction') into.push(...functionSymbols(expr.body))
      else if (expr.type === 'AstExprTable') {
        for (const item of expr.items) if (item.value !== undefined) walkExpr(item.value, into)
      } else if (expr.type === 'AstExprCall') {
        for (const arg of expr.args) walkExpr(arg, into)
      }
    }
    const walk = (stat: AstStat): void => {
      switch (stat.type) {
        case 'AstStatFunction': {
          const name = exprName(stat.name) ?? '<function>'
          out.push(
            symbol(
              name,
              'function',
              stat.range,
              exprSelection(stat.name),
              functionSymbols(stat.func.body),
              signature(stat.func),
            ),
          )
          return
        }
        case 'AstStatLocalFunction':
          out.push(
            symbol(
              stat.name.name,
              'function',
              stat.range,
              stat.name.range,
              functionSymbols(stat.func.body),
              signature(stat.func),
            ),
          )
          return
        case 'AstStatTypeAlias':
          out.push(symbol(stat.name.name, 'interface', stat.range, stat.name.range))
          return
        case 'AstStatTypeFunction':
          out.push(
            symbol(stat.name.name, 'function', stat.range, stat.name.range, [], 'type function'),
          )
          return
        case 'AstStatLocal':
          for (const [index, local] of stat.vars.entries()) {
            const value = stat.values[index]
            const children: LanguageSymbol[] = []
            if (value !== undefined) walkExpr(value, children)
            if (value?.type === 'AstExprFunction') {
              out.push(
                symbol(local.name, 'function', stat.range, local.range, children, signature(value)),
              )
            } else if (block === state.parse.chunk || children.length > 0) {
              out.push(
                symbol(
                  local.name,
                  local.isConst === true ? 'constant' : 'variable',
                  stat.range,
                  local.range,
                  children,
                ),
              )
            }
          }
          return
        case 'AstStatAssign':
          for (const [index, target] of stat.vars.entries()) {
            const value = stat.values[index]
            const name = exprName(target)
            if (name === undefined) continue
            const children: LanguageSymbol[] = []
            if (value !== undefined) walkExpr(value, children)
            if (value?.type === 'AstExprFunction') {
              out.push(
                symbol(
                  name,
                  'function',
                  stat.range,
                  exprSelection(target),
                  children,
                  signature(value),
                ),
              )
            } else if (block === state.parse.chunk && target.type === 'AstExprName') {
              out.push(symbol(name, 'variable', stat.range, exprSelection(target), children))
            } else {
              out.push(...children)
            }
          }
          return
        case 'AstStatReturn':
        case 'AstStatExpr': {
          const values = stat.type === 'AstStatReturn' ? stat.list : [stat.expr]
          for (const value of values) walkExpr(value, out)
          return
        }
        case 'AstStatDo':
          out.push(...functionSymbols(stat.body))
          return
        case 'AstStatIf':
          out.push(...functionSymbols(stat.thenbody))
          if (stat.elsebody !== undefined) {
            if (stat.elsebody.type === 'AstStatIf') walk(stat.elsebody)
            else out.push(...functionSymbols(stat.elsebody))
          }
          return
        case 'AstStatWhile':
        case 'AstStatRepeat':
        case 'AstStatFor':
        case 'AstStatForIn':
          out.push(...functionSymbols(stat.body))
          return
        default:
          return
      }
    }
    for (const stat of block.body) walk(stat)
    return out
  }
  return functionSymbols(state.parse.chunk)
}

// ---------------------------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------------------------

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u
const RESERVED = new Set([
  'and',
  'break',
  'do',
  'else',
  'elseif',
  'end',
  'false',
  'for',
  'function',
  'goto',
  'if',
  'in',
  'local',
  'nil',
  'not',
  'or',
  'repeat',
  'return',
  'then',
  'true',
  'until',
  'while',
])

function occurrenceAtPosition(state: LuaDocumentState, request: LanguagePositionRequest) {
  const offset = state.lines.offset(request.position)
  const occurrence = state.binding.occurrenceAt(offset)
  if (occurrence === undefined) return undefined
  const binding = state.binding.bindings[occurrence.binding]
  return binding === undefined ? undefined : { occurrence, binding }
}

async function workspaceStates(request: LanguageFeatureRequest): Promise<LuaDocumentState[]> {
  const documents = request.workspaceDocuments.some(
    document => document.uri === request.document.uri,
  )
    ? request.workspaceDocuments
    : [request.document, ...request.workspaceDocuments]
  const states: LuaDocumentState[] = []
  for (const document of documents) {
    request.signal?.throwIfAborted()
    if (!(LUA_LANGUAGE_IDS as readonly string[]).includes(document.languageId)) continue
    states.push(await luaDocumentState(document))
  }
  return states
}

/** Every occurrence of a global name across the snapshot, per document. */
function globalOccurrences(states: readonly LuaDocumentState[], name: string, writesOnly: boolean) {
  const result: { state: LuaDocumentState; range: LuaRange }[] = []
  for (const state of states) {
    const global = state.binding.globals.get(name)
    if (global === undefined) continue
    for (const occurrence of state.binding.occurrencesOf(global.id)) {
      if (!writesOnly || occurrence.write) result.push({ state, range: occurrence.range })
    }
  }
  return result
}

function location(state: LuaDocumentState, range: LuaRange): LanguageLocation {
  return { uri: state.document.uri, range: state.lines.range(range) }
}

function documentView(state: LuaDocumentState): DocumentView {
  return { chunk: state.parse.chunk, binding: state.binding, lines: state.lines, text: state.document.text }
}

/** The game environment's view of this document, when the host handed one. */
function environmentView(request: LanguageFeatureRequest, state: LuaDocumentState) {
  const environment = luaEnvironmentOf(request)
  return environment === undefined ? undefined : new LuaEnvironmentView(environment, documentView(state), documentPathOf(request))
}

export async function luaDefinition(
  request: LanguagePositionRequest,
): Promise<LanguageLocationList> {
  const state = await luaDocumentState(request.document)
  const view = environmentView(request, state)
  const file = view === undefined ? undefined : environmentDefinition(view, request)
  if (file !== undefined) return { locations: [file], isIncomplete: false }
  const found = occurrenceAtPosition(state, request)
  if (found === undefined) return { locations: [], isIncomplete: false }
  if (found.binding.declaration !== undefined) {
    return { locations: [location(state, found.binding.declaration)], isIncomplete: false }
  }
  if (found.binding.kind !== 'global') return { locations: [], isIncomplete: false }
  const states = await workspaceStates(request)
  const writes = globalOccurrences(states, found.binding.name, true)
  return {
    locations: writes.slice(0, request.maxResults).map(write => location(write.state, write.range)),
    isIncomplete:
      writes.length > request.maxResults || languageWorkspaceIsSemanticallyIncomplete(request),
  }
}

export async function luaReferences(
  request: LanguageReferencesRequest,
): Promise<LanguageLocationList> {
  const state = await luaDocumentState(request.document)
  const found = occurrenceAtPosition(state, request)
  if (found === undefined) return { locations: [], isIncomplete: false }
  const includeDeclaration = request.includeDeclaration !== false
  if (found.binding.kind !== 'global') {
    const locations = state.binding
      .occurrencesOf(found.binding.id)
      .filter(occurrence => includeDeclaration || !occurrence.declaration)
      .map(occurrence => location(state, occurrence.range))
    return {
      locations: locations.slice(0, request.maxResults),
      isIncomplete: locations.length > request.maxResults,
    }
  }
  const states = await workspaceStates(request)
  const all = globalOccurrences(states, found.binding.name, false)
  return {
    locations: all.slice(0, request.maxResults).map(entry => location(entry.state, entry.range)),
    isIncomplete:
      all.length > request.maxResults || languageWorkspaceIsSemanticallyIncomplete(request),
  }
}

export async function luaPrepareRename(
  request: LanguagePositionRequest,
): Promise<LanguageRenamePreparation | undefined> {
  const state = await luaDocumentState(request.document)
  const found = occurrenceAtPosition(state, request)
  if (found === undefined || found.binding.kind === 'self') return undefined
  if (found.binding.kind === 'global' && languageWorkspaceIsSemanticallyIncomplete(request))
    return undefined
  return { range: state.lines.range(found.occurrence.range), placeholder: found.binding.name }
}

export async function luaRename(
  request: LanguageRenameRequest,
): Promise<LanguageWorkspaceEdit | undefined> {
  if (!IDENTIFIER.test(request.newName) || RESERVED.has(request.newName)) return undefined
  const state = await luaDocumentState(request.document)
  const found = occurrenceAtPosition(state, request)
  if (found === undefined || found.binding.kind === 'self') return undefined
  const edits = new Map<LuaDocumentState, LuaRange[]>()
  if (found.binding.kind === 'global') {
    if (languageWorkspaceIsSemanticallyIncomplete(request)) return undefined
    for (const entry of globalOccurrences(
      await workspaceStates(request),
      found.binding.name,
      false,
    )) {
      const list = edits.get(entry.state)
      if (list === undefined) edits.set(entry.state, [entry.range])
      else list.push(entry.range)
    }
  } else {
    edits.set(
      state,
      state.binding.occurrencesOf(found.binding.id).map(occurrence => occurrence.range),
    )
  }
  let count = 0
  const documentChanges: LanguageTextDocumentEdit[] = []
  for (const [target, ranges] of edits) {
    count += ranges.length
    if (count > request.maxEdits) return undefined
    documentChanges.push({
      uri: target.document.uri,
      documentVersion: target.document.version,
      edits: ranges.map(range => ({ range: target.lines.range(range), newText: request.newName })),
    })
  }
  return { documentChanges, isComplete: true }
}

function typeText(state: LuaDocumentState, type: AstType | undefined): string {
  return type === undefined ? '' : `: ${state.document.text.slice(type.range[0], type.range[1])}`
}

export async function luaHover(
  request: LanguagePositionRequest,
): Promise<LanguageHover | undefined> {
  const state = await luaDocumentState(request.document)
  const view = environmentView(request, state)
  const known = view === undefined ? undefined : environmentHover(view, request)
  if (known !== undefined) return known
  const found = occurrenceAtPosition(state, request)
  if (found === undefined) return undefined
  const { binding } = found
  let line: string
  switch (binding.kind) {
    case 'function': {
      const func = binding.func
      const args =
        func === undefined
          ? ''
          : func.args.map(arg => `${arg.name}${typeText(state, arg.annotation)}`).join(', ')
      line = `local function ${binding.name}(${args}${func?.vararg === true ? (args === '' ? '...' : ', ...') : ''})`
      break
    }
    case 'global':
      line = `global ${binding.name}`
      break
    case 'type':
      line = `type ${binding.name}`
      break
    case 'generic':
      line = `generic ${binding.name}`
      break
    case 'label':
      line = `::${binding.name}::`
      break
    case 'self':
      line = 'self'
      break
    case 'parameter':
      line = `(parameter) ${binding.name}${typeText(state, binding.annotation)}`
      break
    default:
      line = `${binding.kind === 'const' ? 'const' : 'local'} ${binding.name}${typeText(state, binding.annotation)}`
  }
  return {
    markdown: `\`\`\`${state.dialect === 'luau' ? 'luau' : 'lua'}\n${line}\n\`\`\``,
    range: state.lines.range(found.occurrence.range),
    provenance: `modkit/lua ${state.dialect}`,
  }
}

/**
 * After `.` or `:`, the members of the receiver as the game environment knows them; elsewhere the
 * environment's globals and the names this document declares before the position.
 */
export async function luaCompletion(
  request: LanguagePositionRequest,
): Promise<LanguageProviderCompletionList> {
  const state = await luaDocumentState(request.document)
  const completion = await environmentCompletion(
    luaEnvironmentOf(request),
    request,
    documentView(state),
    async text =>
      documentView(
        await luaDocumentState({ ...request.document, uri: `${request.document.uri}#modkit-complete`, text }, state.dialect),
      ),
  )
  const items = new Map(completion.items.map(item => [item.label, item]))
  if (!completion.member) {
    const offset = state.lines.offset(request.position)
    for (const binding of state.binding.bindings) {
      if (items.has(binding.name) || binding.kind === 'self' || binding.kind === 'label') continue
      if (binding.declaration !== undefined && binding.declaration[0] > offset) continue
      items.set(binding.name, {
        label: binding.name,
        kind: binding.kind === 'function' ? 'function' : binding.kind === 'type' || binding.kind === 'generic' ? 'type' : 'variable',
      })
    }
  }
  const all = [...items.values()]
  return { items: all.slice(0, request.maxResults), isIncomplete: all.length > request.maxResults }
}

// ---------------------------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------------------------

export async function analyzeLua(request: LanguageAnalysisRequest): Promise<LanguageAnalysis> {
  request.signal?.throwIfAborted()
  const state = await luaDocumentState(request.document)
  const include = request.include
  const selected = (name: 'tokens' | 'diagnostics' | 'symbols'): boolean =>
    include === undefined || include[name] === true
  return {
    documentUri: request.document.uri,
    documentVersion: request.document.version,
    tokens: selected('tokens') ? luaSemanticTokens(state) : [],
    diagnostics: selected('diagnostics') ? luaDiagnostics(state) : [],
    symbols: selected('symbols') ? luaDocumentSymbols(state) : [],
  }
}

export function createLuaLanguageProvider(): LanguageProvider {
  return Object.freeze({
    contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
    languageIds: LUA_LANGUAGE_IDS,
    workspaceLanguageIds: LUA_LANGUAGE_IDS,
    semanticInputs: Object.freeze([
      Object.freeze({ kind: 'language-spec', id: 'modkit/lua-ast@1', revision: '1' }),
      Object.freeze({ kind: 'provider', id: 'modkit/lua-language', revision: PROVIDER_REVISION }),
    ]),
    // What a game knows about its Lua comes from its content context as data (environment.ts).
    semanticContextRequirements: Object.freeze([
      Object.freeze({ kind: 'language-knowledge' as const, fileNames: Object.freeze([LUA_ENVIRONMENT_FILE]) }),
    ]),
    analyze: analyzeLua,
    completion: luaCompletion,
    hover: luaHover,
    definition: luaDefinition,
    references: luaReferences,
    prepareRename: luaPrepareRename,
    rename: luaRename,
    async documentSymbols(request: LanguageFeatureRequest): Promise<LanguageDocumentSymbolList> {
      return {
        symbols: luaDocumentSymbols(await luaDocumentState(request.document)),
        isIncomplete: false,
      }
    },
    async diagnostics(request: LanguageFeatureRequest) {
      return {
        diagnostics: luaDiagnostics(await luaDocumentState(request.document)),
        isIncomplete: false,
      }
    },
  })
}

export const abiVersion = 1
export const provides = Object.freeze([LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT])

export function createProvider(selection: { readonly contract: string; readonly major: number }) {
  if (selection.contract !== LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT || selection.major !== 1) {
    throw new TypeError(`Unsupported language selection ${selection.contract}@${selection.major}`)
  }
  return Object.freeze({ value: createLuaLanguageProvider(), release: async () => undefined })
}
