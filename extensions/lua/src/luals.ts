/**
 * A game's Lua API as LuaLS annotation files (`---@meta` libraries: `---@class`, `---@field`,
 * `---@param`, `---@return`, `---@enum`, `---@alias`, `---@type` above declarations), turned into
 * the `modkit.lua-environment@1` data this language reads. Files are parsed by the one Lua syntax
 * (Lua 5.1); annotations are the `---` comment block directly above a declaration, or a block of
 * their own for a class and its fields. Nothing is executed.
 *
 * - `function A.b(...)`: a function of the table `A` (a global, typed `A` unless declared
 *   otherwise); deeper paths make nested table types (`A.b.c` → type `A.b`).
 * - `function C:m(...)`: a method of the class `C`.
 * - `---@class C : P, Q` with `---@field`s: a type extending `P`; the members of `Q` are copied in,
 *   as the environment has one supertype.
 * - `---@enum E` over `E = { K = v }` and `---@type T` over `x = …`: globals and their members.
 * - `---@alias A T`: a type whose documentation names what it stands for.
 */
import type {
  AstExpr,
  AstExprFunction,
  AstExprTable,
  AstStat,
  LuaComment,
  LuaParseResult,
} from './ast.js'
import {
  LUA_ENVIRONMENT_FORMAT,
  type LuaEnvironment,
  type LuaEnvironmentMember,
  type LuaEnvironmentType,
} from './environment.js'
import { luaSyntax } from './syntax.js'

export interface LuaAnnotationFile {
  readonly path: string
  readonly text: string
}

interface Doc {
  readonly text: string
  readonly tags: readonly { readonly tag: string; readonly value: string }[]
}

interface MutableType {
  extends?: string
  doc?: string
  members: Record<string, LuaEnvironmentMember>
  /** Supertypes past the first, whose members are copied in at the end. */
  also: string[]
}

/** One type expression at the start of `text` (brackets balanced) and what follows it. */
export function readLuaAnnotationType(text: string): readonly [type: string, rest: string] {
  let depth = 0
  let at = 0
  const source = text.trimStart()
  for (; at < source.length; at += 1) {
    const character = source[at]!
    if ('(<[{'.includes(character)) depth += 1
    else if (')>]}'.includes(character)) depth -= 1
    else if (/\s/u.test(character) && depth <= 0) {
      // `fun(a: T): R` and `A | B` continue across spaces.
      const next = source.slice(at).trimStart()
      const previous = source.slice(0, at).trimEnd()
      if (
        next.startsWith('|') ||
        previous.endsWith('|') ||
        previous.endsWith(':') ||
        previous.endsWith(',')
      )
        continue
      if (next.startsWith(':') && /\)$/u.test(previous)) continue
      break
    }
  }
  return [source.slice(0, at).trim(), source.slice(at).trim()]
}

/** `[<a href="url" …>source</a>]` → `[source](url)`: the engine sources the extractor links. */
const markdownOf = (text: string) =>
  text.replace(/\[<a href="([^"]+)"[^>]*>([^<]*)<\/a>\]/gu, '[$2]($1)').trim()

function docOf(lines: readonly string[]): Doc {
  const text: string[] = []
  const tags: { tag: string; value: string }[] = []
  for (const raw of lines) {
    const line = raw.replace(/^---\s?/u, '')
    const tag = /^@(\w+)\s*(.*)$/su.exec(line)
    if (tag !== null) tags.push({ tag: tag[1]!, value: tag[2]!.trim() })
    else if (line.startsWith('|') && tags.length > 0) {
      const last = tags[tags.length - 1]!
      tags[tags.length - 1] = { tag: last.tag, value: `${last.value} ${line}` }
    } else text.push(line)
  }
  return { text: markdownOf(text.join('\n')), tags }
}

interface Block {
  readonly end: number
  readonly doc: Doc
}

/** Runs of `---` lines separated by line breaks only, each with the offset it ends at. */
function blocksOf(text: string, comments: readonly LuaComment[]): Block[] {
  const blocks: Block[] = []
  let lines: string[] = []
  let end = -1
  const flush = () => {
    if (lines.length > 0) blocks.push({ end, doc: docOf(lines) })
    lines = []
  }
  for (const comment of comments) {
    const body = text.slice(comment.range[0], comment.range[1])
    if (!body.startsWith('---') || body.startsWith('---[[')) {
      flush()
      continue
    }
    if (lines.length > 0 && !/^[ \t]*\r?\n[ \t]*$/u.test(text.slice(end, comment.range[0]))) flush()
    lines.push(body.replace(/\r$/u, ''))
    end = comment.range[1]
  }
  flush()
  return blocks
}

/** The block directly above `start` (one line break away), if any. */
function attached(blocks: readonly Block[], text: string, start: number): Block | undefined {
  let found: Block | undefined
  for (const block of blocks) {
    if (block.end > start) break
    found = block
  }
  return found !== undefined && /^[ \t]*\r?\n[ \t]*$/u.test(text.slice(found.end, start))
    ? found
    : undefined
}

/** `A.b.c` of a name or index chain, or undefined for anything else. */
function pathOf(expr: AstExpr): string[] | undefined {
  if (expr.type === 'AstExprName') return [expr.name]
  if (expr.type === 'AstExprIndexName') {
    const base = pathOf(expr.expr)
    return base === undefined ? undefined : [...base, expr.index]
  }
  return undefined
}

function literalType(expr: AstExpr | undefined): string | undefined {
  switch (expr?.type) {
    case 'AstExprConstantNumber':
      return 'number'
    case 'AstExprConstantString':
      return 'string'
    case 'AstExprConstantBool':
      return 'boolean'
    case 'AstExprTable':
      return 'table'
    default:
      return undefined
  }
}

class Builder {
  readonly globals: Record<string, { type?: string; doc?: string }> = {}
  readonly types: Record<string, MutableType> = {}

  type(name: string): MutableType {
    return (this.types[name] ??= { members: {}, also: [] })
  }

  /** The type of the table at `path`, making globals and nested tables as it goes. */
  tableType(path: readonly string[]): string {
    const [head, ...rest] = path
    const global = (this.globals[head!] ??= {})
    let type = global.type ?? head!
    if (global.type === undefined && this.types[head!] === undefined) global.type = type
    for (const name of rest) {
      const owner = this.type(type)
      const member = owner.members[name]
      const next =
        member?.kind === 'property' && member.type !== undefined ? member.type : `${type}.${name}`
      if (member === undefined) owner.members[name] = { kind: 'property', type: next }
      type = next
    }
    this.type(type)
    return type
  }

  cls(doc: Doc): string | undefined {
    const declared = doc.tags.find(tag => tag.tag === 'class')
    if (declared === undefined) return undefined
    const [name, ...parents] = declared.value
      .replace(/^\(\w+\)\s*/u, '')
      .split(/[:,]/u)
      .map(part => part.trim())
      .filter(part => part !== '')
    if (name === undefined) return undefined
    const type = this.type(name)
    const [first, ...also] = parents
    if (first !== undefined) type.extends = first
    type.also.push(...also)
    if (doc.text !== '') type.doc = doc.text
    for (const field of doc.tags.filter(tag => tag.tag === 'field')) {
      const spec = field.value.replace(/^(?:private|protected|public|package)\s+/u, '')
      const [rawName, rest] = readLuaAnnotationType(spec)
      if (rawName.startsWith('[')) continue
      const [fieldType, description] = readLuaAnnotationType(rest)
      const optional = rawName.endsWith('?')
      const member: LuaEnvironmentMember = {
        kind: fieldType.startsWith('fun(') ? 'callback' : 'property',
        ...(fieldType === '' ? {} : { type: optional ? `${fieldType}?` : fieldType }),
        ...(description === '' ? {} : { doc: markdownOf(description) }),
      }
      type.members[rawName.replace(/\?$/u, '')] = member
    }
    return name
  }

  alias(doc: Doc): void {
    for (const alias of doc.tags.filter(tag => tag.tag === 'alias')) {
      const [, name = '', rest = ''] = /^(\S+)\s*(.*)$/su.exec(alias.value) ?? []
      if (name === '') continue
      const type = this.type(name)
      type.doc = [`Alias of \`${rest.replace(/\s+/gu, ' ')}\`.`, doc.text]
        .filter(Boolean)
        .join('\n\n')
    }
  }

  func(
    path: readonly string[],
    method: boolean,
    func: AstExprFunction,
    doc: Doc | undefined,
  ): void {
    const name = path[path.length - 1]!
    const params = doc?.tags.filter(tag => tag.tag === 'param') ?? []
    const typed = new Map(
      params.map(param => {
        const [raw, rest] = readLuaAnnotationType(param.value)
        const [type] = readLuaAnnotationType(rest)
        return [
          raw.replace(/\?$/u, ''),
          { type, optional: raw.endsWith('?') || type.endsWith('?') },
        ] as const
      }),
    )
    // What the member fields cannot hold — parameter descriptions, return names — goes in the doc.
    const lines = [
      ...params.flatMap(param => {
        const [raw, rest] = readLuaAnnotationType(param.value)
        const [, description] = readLuaAnnotationType(rest)
        return description === ''
          ? []
          : [`- \`${raw.replace(/\?$/u, '')}\` — ${markdownOf(description)}`]
      }),
      ...(doc?.tags.filter(tag => tag.tag === 'return' || tag.tag === 'returns') ?? []).flatMap(
        tag => {
          const [type, rest] = readLuaAnnotationType(tag.value)
          return rest === ''
            ? []
            : [
                `- returns \`${rest.split(/\s/u)[0]!}\`: ${type}${rest.includes(' ') ? ` — ${markdownOf(rest.slice(rest.indexOf(' ') + 1))}` : ''}`,
              ]
        },
      ),
    ]
    const newline = String.fromCharCode(10)
    const text = [doc?.text ?? '', lines.join(newline)]
      .filter(part => part !== '')
      .join(newline + newline)
    const member: LuaEnvironmentMember = {
      kind: method ? 'method' : 'function',
      params: [...func.args.map(arg => arg.name), ...(func.vararg ? ['...'] : [])].map(arg => {
        const found = typed.get(arg)
        const type = found?.type.replace(/\?$/u, '')
        return {
          name: arg,
          ...(type === undefined || type === '' ? {} : { type }),
          ...(found?.optional === true ? { optional: true } : {}),
        }
      }),
      returns: (
        doc?.tags.filter(tag => tag.tag === 'return' || tag.tag === 'returns') ?? []
      ).flatMap(tag => {
        const [type] = readLuaAnnotationType(tag.value)
        return type === '' ? [] : [type]
      }),
      ...(text === '' ? {} : { doc: text }),
      ...(doc?.tags.some(tag => tag.tag === 'deprecated') === true ? { deprecated: true } : {}),
    }
    if (path.length === 1 && !method) {
      const params = (member.params ?? []).map(
        param => `${param.name}${param.type === undefined ? '' : `: ${param.type}`}`,
      )
      const returns =
        member.returns === undefined || member.returns.length === 0
          ? ''
          : `: ${member.returns.join(', ')}`
      this.globals[name] = {
        type: `function(${params.join(', ')})${returns}`,
        ...(member.doc === undefined ? {} : { doc: member.doc }),
      }
      return
    }
    const owner =
      method &&
      path.length === 2 &&
      this.types[path[0]!] !== undefined &&
      this.globals[path[0]!] === undefined
        ? path[0]!
        : this.tableType(path.slice(0, -1))
    this.type(owner).members[name] = member
  }

  /** `E = { K = v }` under `---@enum E` or a class: the table's keys as members. */
  table(owner: string, table: AstExprTable, text: string, blocks: readonly Block[]): void {
    for (const item of table.items) {
      if (item.kind !== 'record' || item.name === undefined) continue
      const doc = attached(blocks, text, item.range[0])?.doc
      const declared = doc?.tags.find(tag => tag.tag === 'type')?.value
      const type =
        declared === undefined ? literalType(item.value) : readLuaAnnotationType(declared)[0]
      this.type(owner).members[item.name.name] = {
        kind: 'property',
        ...(type === undefined ? {} : { type }),
        ...(doc === undefined || doc.text === '' ? {} : { doc: doc.text }),
      }
    }
  }

  assign(
    stat: Extract<AstStat, { type: 'AstStatAssign' }>,
    doc: Doc | undefined,
    text: string,
    blocks: readonly Block[],
  ): void {
    const path =
      stat.vars.length === 1 && stat.vars[0] !== undefined ? pathOf(stat.vars[0]) : undefined
    if (path === undefined) return
    const value = stat.values[0]
    const enumName = doc?.tags.find(tag => tag.tag === 'enum')?.value.split(/\s/u)[0]
    const className = doc === undefined ? undefined : this.cls(doc)
    const declared = doc?.tags.find(tag => tag.tag === 'type')?.value
    const type =
      enumName ??
      className ??
      (declared === undefined ? undefined : readLuaAnnotationType(declared)[0])
    const name = path[path.length - 1]!
    if (path.length === 1) {
      const global = (this.globals[name] ??= {})
      if (type !== undefined) global.type = type
      else if (global.type === undefined && value?.type === 'AstExprTable') global.type = name
      else if (global.type === undefined) {
        const literal = literalType(value)
        if (literal !== undefined) global.type = literal
      }
      if (doc !== undefined && doc.text !== '') global.doc = doc.text
    } else {
      const owner = this.tableType(path.slice(0, -1))
      const tableType = value?.type === 'AstExprTable' ? `${owner}.${name}` : undefined
      this.type(owner).members[name] = {
        kind: 'property',
        ...((type ?? tableType ?? literalType(value)) === undefined
          ? {}
          : { type: type ?? tableType ?? literalType(value)! }),
        ...(doc === undefined || doc.text === '' ? {} : { doc: doc.text }),
      }
    }
    if (value?.type === 'AstExprTable') {
      const owner =
        type ??
        (path.length === 1
          ? (this.globals[name]?.type ?? name)
          : `${this.tableType(path.slice(0, -1))}.${name}`)
      this.table(owner, value, text, blocks)
    }
  }

  /** Copy the members of each class's further supertypes, which the environment cannot chain. */
  environment(name: string): LuaEnvironment {
    const chain = (
      type: string,
      seen = new Set<string>(),
    ): Record<string, LuaEnvironmentMember> => {
      const at = this.types[type]
      if (at === undefined || seen.has(type)) return {}
      seen.add(type)
      return { ...(at.extends === undefined ? {} : chain(at.extends, seen)), ...at.members }
    }
    const types: Record<string, LuaEnvironmentType> = {}
    for (const key of Object.keys(this.types).sort()) {
      const type = this.types[key]!
      const inherited = Object.assign({}, ...type.also.map(parent => chain(parent)))
      const members = { ...inherited, ...type.members }
      types[key] = {
        ...(type.extends === undefined ? {} : { extends: type.extends }),
        ...(type.doc === undefined ? {} : { doc: type.doc }),
        ...(Object.keys(members).length === 0
          ? {}
          : {
              members: Object.fromEntries(
                Object.keys(members)
                  .sort()
                  .map(member => [member, members[member]!]),
              ),
            }),
      }
    }
    const globals = Object.fromEntries(
      Object.keys(this.globals)
        .sort()
        .map(global => [global, this.globals[global]!]),
    )
    return { format: LUA_ENVIRONMENT_FORMAT, name, globals, types }
  }
}

/**
 * The environment `files` describe. Classes are read from every file first, so a function of a
 * class declared in a later file still becomes its method.
 */
export async function luaEnvironmentFromAnnotations(
  name: string,
  files: readonly LuaAnnotationFile[],
  signal?: AbortSignal,
): Promise<LuaEnvironment> {
  const syntax = await luaSyntax()
  const parsed: { file: LuaAnnotationFile; tree: LuaParseResult; blocks: Block[] }[] = []
  const builder = new Builder()
  for (const file of files) {
    signal?.throwIfAborted()
    const tree = syntax.parse(file.text, 'lua51')
    const blocks = blocksOf(file.text, tree.comments)
    parsed.push({ file, tree, blocks })
    for (const block of blocks) {
      builder.cls(block.doc)
      builder.alias(block.doc)
    }
  }
  for (const { file, tree, blocks } of parsed) {
    signal?.throwIfAborted()
    for (const stat of tree.chunk.body) {
      const doc = attached(blocks, file.text, stat.range[0])?.doc
      if (stat.type === 'AstStatFunction') {
        const path = pathOf(stat.name)
        if (path !== undefined)
          builder.func(
            path,
            stat.name.type === 'AstExprIndexName' && stat.name.op === ':',
            stat.func,
            doc,
          )
      } else if (stat.type === 'AstStatAssign') builder.assign(stat, doc, file.text, blocks)
    }
  }
  return builder.environment(name)
}
