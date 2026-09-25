/**
 * Lua-family syntax tree, version 1 (draft).
 *
 * Draft until the Multiverse Runtime owner has reviewed it: the one Luau→UVB compiler
 * (`multiverse/runtime/compiler`) is to read this tree instead of its own text matcher, so its
 * shape is frozen only with that owner's agreement.
 *
 * One tree for Lua 5.1–5.4, LuaJIT, Luau and CfxLua. Node and field names follow the official
 * Luau AST (`Ast/include/Luau/Ast.h`, JSON names from `Analysis/src/AstJsonEncoder.cpp`), so a
 * Luau program maps one to one. Nodes that Luau does not have (Lua 5.2+ `goto`/labels, Lua 5.4
 * attributes, Lua 5.3 bitwise operators, CfxLua set fields) extend the same vocabulary.
 *
 * The tree is produced by full-moon compiled to WebAssembly (`native/`); this file is the
 * contract both sides follow. Deliberate differences from the Luau AST:
 * - Ranges are half-open UTF-16 offsets into the parsed text, not line/column locations. A
 *   `LuaLineIndex` converts them to editor positions.
 * - Identifiers are syntactic (`AstExprName`). Luau resolves `AstExprLocal`/`AstExprGlobal` while
 *   parsing; here the binder (`binder.ts`) does it, so tools can see unresolved names.
 * - Literals keep their source text (`raw`). Exact decimal lowering (UVD Q32.32) needs it.
 * - `do … end` is `AstStatDo`, not a nested block; `T?` is `AstTypeOptional`; `{T}` is
 *   `AstTypeTable` with `array: true`.
 * - The source text is not duplicated. Comments and tokens are ranges into it.
 */

export const LUA_AST_VERSION = 1 as const

export type LuaDialect = 'lua51' | 'lua52' | 'lua53' | 'lua54' | 'luajit' | 'luau' | 'cfxlua'

export const LUA_DIALECTS: readonly LuaDialect[] = Object.freeze([
  'lua51',
  'lua52',
  'lua53',
  'lua54',
  'luajit',
  'luau',
  'cfxlua',
])

/** Half-open `[start, end)` offsets in UTF-16 code units of the parsed text. */
export type LuaRange = readonly [start: number, end: number]

/** Shared shape of every node. */
export interface LuaNodeBase<Type extends string> {
  readonly type: Type
  readonly range: LuaRange
}

/** A name written in the source: a local, a field, a label, a type or an attribute. */
export interface AstName {
  readonly name: string
  readonly range: LuaRange
}

/** A local binding introduced by `local`, `const`, `for`, a parameter or a local function. */
export interface AstLocal {
  readonly name: string
  readonly range: LuaRange
  readonly annotation?: AstType
  /** Luau `const` declarations. */
  readonly isConst?: boolean
  /** Lua 5.4 `<const>` / `<close>` (the attribute text without brackets). */
  readonly attribute?: string
}

/** Luau function attribute such as `@native` or `@checked`. */
export interface AstAttr {
  readonly name: string
  readonly range: LuaRange
}

// ---------------------------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------------------------

export interface AstStatBlock extends LuaNodeBase<'AstStatBlock'> {
  readonly body: readonly AstStat[]
}

export interface AstStatDo extends LuaNodeBase<'AstStatDo'> {
  readonly body: AstStatBlock
}

/** `elseif` chains are nested `AstStatIf` values in `elsebody`, as in Luau. */
export interface AstStatIf extends LuaNodeBase<'AstStatIf'> {
  readonly condition: AstExpr
  readonly thenbody: AstStatBlock
  readonly elsebody?: AstStatBlock | AstStatIf
}

export interface AstStatWhile extends LuaNodeBase<'AstStatWhile'> {
  readonly condition: AstExpr
  readonly body: AstStatBlock
}

export interface AstStatRepeat extends LuaNodeBase<'AstStatRepeat'> {
  readonly body: AstStatBlock
  readonly condition: AstExpr
}

export type AstStatBreak = LuaNodeBase<'AstStatBreak'>

export type AstStatContinue = LuaNodeBase<'AstStatContinue'>

export interface AstStatReturn extends LuaNodeBase<'AstStatReturn'> {
  readonly list: readonly AstExpr[]
}

/** A call used as a statement. */
export interface AstStatExpr extends LuaNodeBase<'AstStatExpr'> {
  readonly expr: AstExprCall
}

export interface AstStatLocal extends LuaNodeBase<'AstStatLocal'> {
  readonly vars: readonly AstLocal[]
  readonly values: readonly AstExpr[]
}

export interface AstStatFor extends LuaNodeBase<'AstStatFor'> {
  readonly var: AstLocal
  readonly from: AstExpr
  readonly to: AstExpr
  readonly step?: AstExpr
  readonly body: AstStatBlock
}

export interface AstStatForIn extends LuaNodeBase<'AstStatForIn'> {
  readonly vars: readonly AstLocal[]
  readonly values: readonly AstExpr[]
  readonly body: AstStatBlock
}

export interface AstStatAssign extends LuaNodeBase<'AstStatAssign'> {
  readonly vars: readonly AstExpr[]
  readonly values: readonly AstExpr[]
}

export interface AstStatCompoundAssign extends LuaNodeBase<'AstStatCompoundAssign'> {
  readonly op: LuaBinaryOp
  readonly var: AstExpr
  readonly value: AstExpr
}

/**
 * `function a.b.c:d() end`. `name` is the assigned expression (`AstExprName` or an
 * `AstExprIndexName` chain); a method has `func.self` set, as in Luau.
 */
export interface AstStatFunction extends LuaNodeBase<'AstStatFunction'> {
  readonly name: AstExprName | AstExprIndexName
  readonly func: AstExprFunction
}

export interface AstStatLocalFunction extends LuaNodeBase<'AstStatLocalFunction'> {
  readonly name: AstLocal
  readonly func: AstExprFunction
}

export interface AstStatTypeAlias extends LuaNodeBase<'AstStatTypeAlias'> {
  readonly name: AstName
  readonly generics: readonly AstGenericType[]
  readonly genericPacks: readonly AstGenericTypePack[]
  readonly value: AstType
  readonly exported: boolean
}

export interface AstStatTypeFunction extends LuaNodeBase<'AstStatTypeFunction'> {
  readonly name: AstName
  readonly body: AstExprFunction
  readonly exported: boolean
}

/** Lua 5.2+. */
export interface AstStatGoto extends LuaNodeBase<'AstStatGoto'> {
  readonly label: AstName
}

/** Lua 5.2+ `::name::`. */
export interface AstStatLabel extends LuaNodeBase<'AstStatLabel'> {
  readonly name: AstName
}

export type AstStat =
  | AstStatBlock
  | AstStatDo
  | AstStatIf
  | AstStatWhile
  | AstStatRepeat
  | AstStatBreak
  | AstStatContinue
  | AstStatReturn
  | AstStatExpr
  | AstStatLocal
  | AstStatFor
  | AstStatForIn
  | AstStatAssign
  | AstStatCompoundAssign
  | AstStatFunction
  | AstStatLocalFunction
  | AstStatTypeAlias
  | AstStatTypeFunction
  | AstStatGoto
  | AstStatLabel

// ---------------------------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------------------------

export interface AstExprGroup extends LuaNodeBase<'AstExprGroup'> {
  readonly expr: AstExpr
}

export type AstExprConstantNil = LuaNodeBase<'AstExprConstantNil'>

export interface AstExprConstantBool extends LuaNodeBase<'AstExprConstantBool'> {
  readonly value: boolean
}

export interface AstExprConstantNumber extends LuaNodeBase<'AstExprConstantNumber'> {
  /** Source spelling, e.g. `0.35`, `0x1F`, `1_000`, `0b101`, `12LL`. Authoritative. */
  readonly raw: string
  /** IEEE-754 double of `raw`; absent when not finite. Integer semantics are the reader's job. */
  readonly value?: number
}

export type LuaQuoteStyle = 'double' | 'single' | 'long' | 'backtick'

export interface AstExprConstantString extends LuaNodeBase<'AstExprConstantString'> {
  /** Source spelling including quotes or brackets. */
  readonly raw: string
  readonly quoteStyle: LuaQuoteStyle
  /** Escapes decoded. Lua strings are bytes: when they are not UTF-8, see `bytesHex`. */
  readonly value: string
  /** Lower-case hex of the decoded bytes, present only when they are not valid UTF-8. */
  readonly bytesHex?: string
}

/** An identifier in expression position; the binder decides local or global. */
export interface AstExprName extends LuaNodeBase<'AstExprName'> {
  readonly name: string
}

export type AstExprVarargs = LuaNodeBase<'AstExprVarargs'>

export type LuaCallArgumentStyle = 'parens' | 'string' | 'table'

/** `a:b(...)` has `func` = `AstExprIndexName` with `op: ':'` and `self: true`, as in Luau. */
export interface AstExprCall extends LuaNodeBase<'AstExprCall'> {
  readonly func: AstExpr
  readonly args: readonly AstExpr[]
  readonly self: boolean
  readonly argStyle: LuaCallArgumentStyle
  /** Range of the argument list including its delimiters. */
  readonly argLocation: LuaRange
  /** Luau explicit instantiation `f<<T>>()`. */
  readonly typeArguments?: readonly AstTypeOrPack[]
}

export interface AstExprIndexName extends LuaNodeBase<'AstExprIndexName'> {
  readonly expr: AstExpr
  readonly index: string
  readonly indexLocation: LuaRange
  readonly op: '.' | ':'
}

export interface AstExprIndexExpr extends LuaNodeBase<'AstExprIndexExpr'> {
  readonly expr: AstExpr
  readonly index: AstExpr
}

export interface AstExprFunction extends LuaNodeBase<'AstExprFunction'> {
  readonly attributes: readonly AstAttr[]
  readonly generics: readonly AstGenericType[]
  readonly genericPacks: readonly AstGenericTypePack[]
  /** Implicit `self` of a method declared with `:`. */
  readonly self?: AstLocal
  readonly args: readonly AstLocal[]
  readonly vararg: boolean
  readonly varargLocation?: LuaRange
  readonly varargAnnotation?: AstTypePack
  readonly returnAnnotation?: AstTypeList
  readonly body: AstStatBlock
  /** Declared name for statements (`a.b:c`), absent for anonymous functions. */
  readonly debugname?: string
}

export type AstTableItemKind =
  /** `{ v }` */
  | 'item'
  /** `{ k = v }` */
  | 'record'
  /** `{ [k] = v }` */
  | 'general'
  /** CfxLua `{ .k }`, same as `{ k = true }` (`value` is absent). */
  | 'set'

export interface AstExprTableItem {
  readonly kind: AstTableItemKind
  readonly range: LuaRange
  /** `general` only: the bracketed key expression. */
  readonly key?: AstExpr
  /** `record` and `set`: the field name. */
  readonly name?: AstName
  /** Absent only for `set`. */
  readonly value?: AstExpr
}

export interface AstExprTable extends LuaNodeBase<'AstExprTable'> {
  readonly items: readonly AstExprTableItem[]
}

export type LuaUnaryOp = 'Not' | 'Minus' | 'Len' | 'BitNot'

export interface AstExprUnary extends LuaNodeBase<'AstExprUnary'> {
  readonly op: LuaUnaryOp
  readonly expr: AstExpr
}

export type LuaBinaryOp =
  | 'Add'
  | 'Sub'
  | 'Mul'
  | 'Div'
  | 'FloorDiv'
  | 'Mod'
  | 'Pow'
  | 'Concat'
  | 'CompareNe'
  | 'CompareEq'
  | 'CompareLt'
  | 'CompareLe'
  | 'CompareGt'
  | 'CompareGe'
  | 'And'
  | 'Or'
  | 'BitAnd'
  | 'BitOr'
  | 'BitXor'
  | 'Shl'
  | 'Shr'

export interface AstExprBinary extends LuaNodeBase<'AstExprBinary'> {
  readonly op: LuaBinaryOp
  readonly left: AstExpr
  readonly right: AstExpr
}

/** Luau `expr :: T`. */
export interface AstExprTypeAssertion extends LuaNodeBase<'AstExprTypeAssertion'> {
  readonly expr: AstExpr
  readonly annotation: AstType
}

/** Luau `if c then a elseif d then b else e`; `elseif` nests in `falseExpr`, as in Luau. */
export interface AstExprIfElse extends LuaNodeBase<'AstExprIfElse'> {
  readonly condition: AstExpr
  readonly trueExpr: AstExpr
  readonly falseExpr: AstExpr
}

/** Luau `` `a{b}c` ``: `strings.length === expressions.length + 1`. Strings are decoded. */
export interface AstExprInterpString extends LuaNodeBase<'AstExprInterpString'> {
  readonly strings: readonly string[]
  readonly expressions: readonly AstExpr[]
}

export type AstExpr =
  | AstExprGroup
  | AstExprConstantNil
  | AstExprConstantBool
  | AstExprConstantNumber
  | AstExprConstantString
  | AstExprName
  | AstExprVarargs
  | AstExprCall
  | AstExprIndexName
  | AstExprIndexExpr
  | AstExprFunction
  | AstExprTable
  | AstExprUnary
  | AstExprBinary
  | AstExprTypeAssertion
  | AstExprIfElse
  | AstExprInterpString

// ---------------------------------------------------------------------------------------------
// Luau types
// ---------------------------------------------------------------------------------------------

export interface AstGenericType {
  readonly name: string
  readonly range: LuaRange
  readonly defaultValue?: AstType
}

export interface AstGenericTypePack {
  readonly name: string
  readonly range: LuaRange
  readonly defaultValue?: AstTypePack
}

export interface AstTypeReference extends LuaNodeBase<'AstTypeReference'> {
  /** Module prefix of `module.Type`. */
  readonly prefix?: string
  readonly name: string
  readonly nameLocation: LuaRange
  readonly parameters: readonly AstTypeOrPack[]
}

export interface AstTableProp {
  readonly name: string
  readonly range: LuaRange
  readonly type: AstType
  /** `read` / `write` access modifier. */
  readonly access?: string
}

export interface AstTableIndexer {
  readonly range: LuaRange
  /** Absent for the array shorthand `{T}`. */
  readonly indexType?: AstType
  readonly resultType: AstType
  readonly access?: string
}

export interface AstTypeTable extends LuaNodeBase<'AstTypeTable'> {
  readonly props: readonly AstTableProp[]
  readonly indexer?: AstTableIndexer
  /** `{T}`. */
  readonly array?: boolean
}

export interface AstTypeFunction extends LuaNodeBase<'AstTypeFunction'> {
  readonly generics: readonly AstGenericType[]
  readonly genericPacks: readonly AstGenericTypePack[]
  readonly argTypes: AstTypeList
  readonly argNames: readonly (AstName | null)[]
  readonly returnTypes: AstTypeList
}

export interface AstTypeTypeof extends LuaNodeBase<'AstTypeTypeof'> {
  readonly expr: AstExpr
}

export interface AstTypeOptional extends LuaNodeBase<'AstTypeOptional'> {
  readonly base: AstType
}

export interface AstTypeUnion extends LuaNodeBase<'AstTypeUnion'> {
  readonly types: readonly AstType[]
}

export interface AstTypeIntersection extends LuaNodeBase<'AstTypeIntersection'> {
  readonly types: readonly AstType[]
}

export interface AstTypeSingletonBool extends LuaNodeBase<'AstTypeSingletonBool'> {
  readonly value: boolean
}

export interface AstTypeSingletonString extends LuaNodeBase<'AstTypeSingletonString'> {
  readonly value: string
  readonly raw: string
}

/** `(T)` in type position. A parenthesised list of several types is an `AstTypePackExplicit`. */
export interface AstTypeGroup extends LuaNodeBase<'AstTypeGroup'> {
  readonly inner: AstType
}

export type AstType =
  | AstTypeReference
  | AstTypeTable
  | AstTypeFunction
  | AstTypeTypeof
  | AstTypeOptional
  | AstTypeUnion
  | AstTypeIntersection
  | AstTypeSingletonBool
  | AstTypeSingletonString
  | AstTypeGroup

export interface AstTypeList {
  readonly types: readonly AstType[]
  readonly tailType?: AstTypePack
}

export interface AstTypePackExplicit extends LuaNodeBase<'AstTypePackExplicit'> {
  readonly typeList: AstTypeList
}

/** `...T` */
export interface AstTypePackVariadic extends LuaNodeBase<'AstTypePackVariadic'> {
  readonly variadicType: AstType
}

/** `T...` */
export interface AstTypePackGeneric extends LuaNodeBase<'AstTypePackGeneric'> {
  readonly genericName: string
}

export type AstTypePack = AstTypePackExplicit | AstTypePackVariadic | AstTypePackGeneric

export type AstTypeOrPack = AstType | AstTypePack

// ---------------------------------------------------------------------------------------------
// Parse result
// ---------------------------------------------------------------------------------------------

export type LuaCommentKind = 'line' | 'block' | 'shebang' | 'c-style'

export interface LuaComment {
  readonly kind: LuaCommentKind
  readonly range: LuaRange
}

/**
 * Lexical classes of significant tokens. Keywords are reserved words of the dialect; contextual
 * Luau words (`type`, `export`, `continue`) are identifiers here and classified by the provider.
 */
export type LuaTokenClass =
  'identifier' | 'keyword' | 'number' | 'string' | 'interpolated-string' | 'operator'

/** Order of `LuaTokenClass` codes in `LuaParseResult.tokens`. */
export const LUA_TOKEN_CLASSES: readonly LuaTokenClass[] = Object.freeze([
  'identifier',
  'keyword',
  'number',
  'string',
  'interpolated-string',
  'operator',
])

export interface LuaSyntaxError {
  readonly message: string
  readonly range: LuaRange
}

export interface LuaParseResult {
  readonly version: typeof LUA_AST_VERSION
  readonly dialect: LuaDialect
  /**
   * Always present. With errors it is full-moon's recovered tree: it may contain phantom tokens
   * with empty ranges and does not reprint as valid code.
   */
  readonly chunk: AstStatBlock
  readonly comments: readonly LuaComment[]
  /** Significant tokens as flat `[classCode, start, end]` triples, in source order. */
  readonly tokens: readonly number[]
  readonly errors: readonly LuaSyntaxError[]
}
