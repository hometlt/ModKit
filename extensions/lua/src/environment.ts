import type {
  LanguageCompletionItem,
  LanguageFeatureRequest,
  LanguageHover,
  LanguageLocation,
  LanguagePositionRequest,
} from '@modkit/sdk'
import type { AstExpr, AstExprCall, AstExprIndexName, LuaRange } from './ast.js'
import type { LuaBindResult } from './binder.js'
import type { LuaLineIndex } from './line-index.js'

/**
 * What a game knows about the Lua it runs, as data the language provider reads: global names and
 * their types, types with members, and an instance tree whose nodes name the files that implement
 * them. A game extension writes one `modkit.lua-environment.json` into its content context; the host
 * hands it to this provider as `language-knowledge`. Nothing here knows a particular game — which
 * global is the tree's root, which methods find a child and which function loads a module are part
 * of the file.
 */
export const LUA_ENVIRONMENT_FORMAT = 'modkit.lua-environment@1'
export const LUA_ENVIRONMENT_FILE = 'modkit.lua-environment.json'

export interface LuaEnvironmentMember {
  /** `method` is called with `:`; `function` with `.`. */
  readonly kind: 'property' | 'method' | 'function' | 'event' | 'callback'
  /** Value type of a property or event; display text, resolvable when it names a type. */
  readonly type?: string
  readonly params?: readonly { readonly name: string; readonly type?: string; readonly optional?: boolean }[]
  readonly returns?: readonly string[]
  readonly doc?: string
  readonly deprecated?: boolean
  readonly readOnly?: boolean
}

export interface LuaEnvironmentType {
  readonly extends?: string
  readonly doc?: string
  readonly members?: Readonly<Record<string, LuaEnvironmentMember>>
}

/** A node of the game's object tree; `filePaths` are relative to the project root. */
export interface LuaInstanceNode {
  readonly name: string
  readonly className: string
  readonly filePaths?: readonly string[]
  readonly children?: readonly LuaInstanceNode[]
}

export interface LuaEnvironmentInstances {
  /** The global that is the tree's root. */
  readonly global: string
  /** The global that is the node of the running file. */
  readonly self?: string
  /** The member naming a node's parent. */
  readonly parent?: string
  /** Methods whose first string argument names a child. */
  readonly childMethods?: readonly string[]
  /** Methods whose first string argument names a child by class or name. */
  readonly serviceMethods?: readonly string[]
  /** The function that loads the module a node's file implements. */
  readonly loader?: string
  readonly root: LuaInstanceNode
}

export interface LuaEnvironment {
  readonly format: typeof LUA_ENVIRONMENT_FORMAT
  readonly name?: string
  readonly globals?: Readonly<Record<string, { readonly type?: string; readonly doc?: string; readonly instancePath?: readonly string[] }>>
  readonly types?: Readonly<Record<string, LuaEnvironmentType>>
  readonly instances?: LuaEnvironmentInstances
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** The file's environment, or `undefined` when it is not one. */
export function parseLuaEnvironment(text: string): LuaEnvironment | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isObject(value) || value['format'] !== LUA_ENVIRONMENT_FORMAT) return undefined
  const instances = value['instances']
  if (
    (value['globals'] !== undefined && !isObject(value['globals'])) ||
    (value['types'] !== undefined && !isObject(value['types'])) ||
    (instances !== undefined && (!isObject(instances) || typeof instances['global'] !== 'string' || !isObject(instances['root'])))
  ) {
    return undefined
  }
  return value as unknown as LuaEnvironment
}

/** Later environments override earlier ones name by name; the last instance tree wins. */
export function mergeLuaEnvironments(environments: readonly LuaEnvironment[]): LuaEnvironment | undefined {
  if (environments.length <= 1) return environments[0]
  let instances: LuaEnvironmentInstances | undefined
  for (const environment of environments) instances = environment.instances ?? instances
  return {
    format: LUA_ENVIRONMENT_FORMAT,
    name: environments.flatMap(environment => (environment.name === undefined ? [] : [environment.name])).join(' + '),
    globals: Object.assign({}, ...environments.map(environment => environment.globals ?? {})),
    types: Object.assign({}, ...environments.map(environment => environment.types ?? {})),
    ...(instances === undefined ? {} : { instances }),
  }
}

const parsed = new Map<string, LuaEnvironment | undefined>()

/** The environment the host handed this request, merged in layer order. */
export function luaEnvironmentOf(request: LanguageFeatureRequest): LuaEnvironment | undefined {
  const found: LuaEnvironment[] = []
  for (const input of request.workspaceContext?.semanticInputs ?? []) {
    if (input.kind !== 'language-knowledge' || !isObject(input.payload)) continue
    const { fileName, text } = input.payload
    if (typeof fileName !== 'string' || fileName.toLowerCase() !== LUA_ENVIRONMENT_FILE || typeof text !== 'string') continue
    const key = `${input.id}\u0000${input.revision}`
    if (!parsed.has(key)) {
      parsed.set(key, parseLuaEnvironment(text))
      if (parsed.size > 8) parsed.delete(parsed.keys().next().value!)
    }
    const environment = parsed.get(key)
    if (environment !== undefined) found.push(environment)
  }
  return mergeLuaEnvironments(found)
}

// ---------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------

/** What an expression is known to be: an instance of the tree, or a value of a named type. */
export interface LuaEnvironmentValue {
  readonly node?: LuaInstanceNode
  readonly type?: string
}

interface AstLike {
  readonly type: string
  readonly range: LuaRange
}

/** Every AST node below `root`, in source order. */
function astNodes(root: unknown): AstLike[] {
  const out: AstLike[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!isObject(value)) return
    if (typeof value['type'] === 'string' && Array.isArray(value['range'])) out.push(value as unknown as AstLike)
    for (const key in value) if (key !== 'range') visit(value[key])
  }
  visit(root)
  return out
}

export interface DocumentView {
  readonly chunk: unknown
  readonly binding: LuaBindResult
  readonly lines: LuaLineIndex
  readonly text: string
}

const parents = new WeakMap<LuaInstanceNode, Map<LuaInstanceNode, LuaInstanceNode>>()
function parentOf(root: LuaInstanceNode, node: LuaInstanceNode): LuaInstanceNode | undefined {
  let map = parents.get(root)
  if (map === undefined) {
    map = new Map()
    const visit = (parent: LuaInstanceNode): void => {
      for (const child of parent.children ?? []) {
        map!.set(child, parent)
        visit(child)
      }
    }
    visit(root)
    parents.set(root, map)
  }
  return map.get(node)
}

const normalise = (path: string) => path.replaceAll('\\', '/').replace(/^\.\//u, '')

/** The node whose files include `documentPath` (a path or URI path that ends with one of them). */
function nodeOfFile(root: LuaInstanceNode, documentPath: string): LuaInstanceNode | undefined {
  const wanted = normalise(documentPath).toLowerCase()
  let found: LuaInstanceNode | undefined
  const visit = (node: LuaInstanceNode): void => {
    for (const file of node.filePaths ?? []) {
      const path = normalise(file).toLowerCase()
      if (wanted === path || wanted.endsWith(`/${path}`)) found = node
    }
    if (found === undefined) node.children?.forEach(visit)
  }
  visit(root)
  return found
}

/** A path the host knows the document by: its layer path when it has an origin, else its URI path. */
export function documentPathOf(request: LanguageFeatureRequest): string {
  const origin = request.workspaceContext?.documentOrigins.find(entry => entry.uri === request.document.uri)
  if (origin !== undefined) return origin.logicalId
  try {
    return decodeURIComponent(new URL(request.document.uri).pathname)
  } catch {
    return request.document.uri
  }
}

export class LuaEnvironmentView {
  readonly #locals = new Map<number, AstExpr>()
  readonly #self: LuaInstanceNode | undefined

  constructor(
    readonly environment: LuaEnvironment,
    readonly document: DocumentView,
    documentPath: string,
  ) {
    const instances = environment.instances
    this.#self = instances === undefined ? undefined : nodeOfFile(instances.root, documentPath)
    // ponytail: a local is its first initialiser; later assignments and branches are not followed.
    for (const node of astNodes(document.chunk)) {
      if (node.type !== 'AstStatLocal') continue
      const stat = node as unknown as { vars: readonly { range: LuaRange }[]; values: readonly AstExpr[] }
      stat.vars.forEach((local, index) => {
        const occurrence = document.binding.occurrenceAt(local.range[0])
        const init = stat.values[index]
        if (occurrence !== undefined && init !== undefined) this.#locals.set(occurrence.binding, init)
      })
    }
  }

  #node(path: readonly string[]): LuaInstanceNode | undefined {
    let node = this.environment.instances?.root
    for (const name of path) node = node?.children?.find(child => child.name === name)
    return node
  }

  typeOf(value: LuaEnvironmentValue): string | undefined {
    return value.node?.className ?? value.type
  }

  /** A member of the type and its supertypes. */
  member(type: string | undefined, name: string): LuaEnvironmentMember | undefined {
    for (let at = type, depth = 0; at !== undefined && depth < 64; depth += 1) {
      const found = this.environment.types?.[at]?.members?.[name]
      if (found !== undefined) return found
      at = this.environment.types?.[at]?.extends
    }
    return undefined
  }

  /** `value.name`: a child or the parent of a node, else the member's value type. */
  index(value: LuaEnvironmentValue | undefined, name: string): LuaEnvironmentValue | undefined {
    if (value === undefined) return undefined
    const instances = this.environment.instances
    if (value.node !== undefined && instances !== undefined) {
      const child = value.node.children?.find(candidate => candidate.name === name)
      if (child !== undefined) return { node: child }
      if (name === instances.parent) {
        const parent = parentOf(instances.root, value.node)
        if (parent !== undefined) return { node: parent }
      }
    }
    const member = this.member(this.typeOf(value), name)
    return member?.kind === 'property' && member.type !== undefined ? { type: member.type } : undefined
  }

  evaluate(expr: AstExpr | undefined, depth = 0): LuaEnvironmentValue | undefined {
    if (expr === undefined || depth > 32) return undefined
    switch (expr.type) {
      case 'AstExprGroup':
      case 'AstExprTypeAssertion':
        return this.evaluate(expr.expr, depth + 1)
      case 'AstExprName': {
        const occurrence = this.document.binding.occurrenceAt(expr.range[0])
        const binding = occurrence === undefined ? undefined : this.document.binding.bindings[occurrence.binding]
        if (binding === undefined) return undefined
        if (binding.kind !== 'global') return this.evaluate(this.#locals.get(binding.id), depth + 1)
        return this.global(binding.name)
      }
      case 'AstExprIndexName':
        return this.index(this.evaluate(expr.expr, depth + 1), expr.index)
      case 'AstExprIndexExpr':
        return expr.index.type === 'AstExprConstantString' ? this.index(this.evaluate(expr.expr, depth + 1), expr.index.value) : undefined
      case 'AstExprCall':
        return this.call(expr, depth)
      default:
        return undefined
    }
  }

  global(name: string): LuaEnvironmentValue | undefined {
    const instances = this.environment.instances
    if (instances !== undefined && name === instances.global) return { node: instances.root }
    if (instances !== undefined && name === instances.self && this.#self !== undefined) return { node: this.#self }
    const global = this.environment.globals?.[name]
    if (global === undefined) return undefined
    const node = global.instancePath === undefined ? undefined : this.#node(global.instancePath)
    return node !== undefined ? { node } : global.type === undefined ? undefined : { type: global.type }
  }

  call(expr: AstExprCall, depth: number): LuaEnvironmentValue | undefined {
    const func = expr.func
    if (func.type !== 'AstExprIndexName') return undefined
    const base = this.evaluate(func.expr, depth + 1)
    if (base === undefined) return undefined
    const instances = this.environment.instances
    const first = expr.args[0]
    const argument = first?.type === 'AstExprConstantString' ? first.value : undefined
    if (func.op === ':' && base.node !== undefined && argument !== undefined && instances !== undefined) {
      if (instances.childMethods?.includes(func.index) === true) {
        const child = base.node.children?.find(candidate => candidate.name === argument)
        if (child !== undefined) return { node: child }
      }
      if (instances.serviceMethods?.includes(func.index) === true) {
        const child = base.node.children?.find(candidate => candidate.className === argument || candidate.name === argument)
        return child !== undefined ? { node: child } : { type: argument }
      }
    }
    const returned = this.member(this.typeOf(base), func.index)?.returns?.[0]
    return returned === undefined ? undefined : { type: returned }
  }
}

// ---------------------------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------------------------

function nodePath(root: LuaInstanceNode, node: LuaInstanceNode): string {
  const names: string[] = []
  for (let at: LuaInstanceNode | undefined = node; at !== undefined && at !== root; at = parentOf(root, at)) names.unshift(at.name)
  return names.length === 0 ? root.name : names.join('.')
}

function signature(owner: string, name: string, member: LuaEnvironmentMember): string {
  const params = (member.params ?? []).map(param => `${param.name}${param.type === undefined ? '' : `: ${param.type}${param.optional === true ? '?' : ''}`}`)
  const returns = member.returns === undefined || member.returns.length === 0 ? '' : `: ${member.returns.join(', ')}`
  switch (member.kind) {
    case 'method':
      return `(method) ${owner}:${name}(${params.join(', ')})${returns}`
    case 'function':
      return `(function) ${owner}.${name}(${params.join(', ')})${returns}`
    default:
      return `(${member.kind}) ${owner}.${name}${member.type === undefined ? '' : `: ${member.type}`}`
  }
}

function markdown(line: string, doc?: string, deprecated?: boolean): string {
  return ['```luau', line, '```', ...(deprecated === true ? ['*Deprecated.*'] : []), ...(doc === undefined ? [] : [doc])].join('\n')
}

/** Where the member's owner declares it: the type in the chain that has it. */
function ownerOf(view: LuaEnvironmentView, type: string | undefined, name: string): string {
  for (let at = type, depth = 0; at !== undefined && depth < 64; depth += 1) {
    if (view.environment.types?.[at]?.members?.[name] !== undefined) return at
    at = view.environment.types?.[at]?.extends
  }
  return type ?? '?'
}

function describe(view: LuaEnvironmentView, base: LuaEnvironmentValue | undefined, name: string): { line: string; doc?: string; deprecated?: boolean } | undefined {
  const value = view.index(base, name)
  const root = view.environment.instances?.root
  if (value?.node !== undefined && root !== undefined) {
    const file = value.node.filePaths?.[0]
    return { line: `(instance) ${nodePath(root, value.node)}: ${value.node.className}`, ...(file === undefined ? {} : { doc: `\`${file}\`` }) }
  }
  const type = base === undefined ? undefined : view.typeOf(base)
  const member = view.member(type, name)
  if (member === undefined) return undefined
  return {
    line: signature(ownerOf(view, type, name), name, member),
    ...(member.doc === undefined ? {} : { doc: member.doc }),
    ...(member.deprecated === true ? { deprecated: true } : {}),
  }
}

/** Hover for a member access or a global the environment knows. */
export function environmentHover(view: LuaEnvironmentView, request: LanguagePositionRequest): LanguageHover | undefined {
  const offset = view.document.lines.offset(request.position)
  const provenance = `modkit/lua environment${view.environment.name === undefined ? '' : ` ${view.environment.name}`}`
  for (const node of astNodes(view.document.chunk)) {
    if (node.type !== 'AstExprIndexName') continue
    const access = node as unknown as AstExprIndexName
    if (offset < access.indexLocation[0] || offset > access.indexLocation[1]) continue
    const found = describe(view, view.evaluate(access.expr), access.index)
    if (found === undefined) return undefined
    return { markdown: markdown(found.line, found.doc, found.deprecated), range: view.document.lines.range(access.indexLocation), provenance }
  }
  const occurrence = view.document.binding.occurrenceAt(offset)
  const binding = occurrence === undefined ? undefined : view.document.binding.bindings[occurrence.binding]
  if (occurrence === undefined || binding?.kind !== 'global') return undefined
  const value = view.global(binding.name)
  if (value === undefined) return undefined
  const root = view.environment.instances?.root
  const type = value.node !== undefined && root !== undefined ? `${value.node.className} (${nodePath(root, value.node)})` : view.typeOf(value)
  const doc = view.environment.globals?.[binding.name]?.doc
  return { markdown: markdown(`(global) ${binding.name}: ${type ?? '?'}`, doc), range: view.document.lines.range(occurrence.range), provenance }
}

/**
 * The file a node implements, found among the snapshot's documents or the host's document origins.
 * A node without a file, or whose file is not in the workspace, has no location.
 */
function fileLocation(request: LanguageFeatureRequest, node: LuaInstanceNode | undefined): LanguageLocation | undefined {
  for (const file of node?.filePaths ?? []) {
    const wanted = normalise(file).toLowerCase()
    const matches = (path: string) => {
      const candidate = normalise(path).toLowerCase()
      return candidate === wanted || candidate.endsWith(`/${wanted}`)
    }
    const origin = request.workspaceContext?.documentOrigins.find(entry => matches(entry.logicalId))
    const uri =
      origin?.uri ??
      [request.document, ...request.workspaceDocuments].find(document => {
        try {
          return matches(decodeURIComponent(new URL(document.uri).pathname))
        } catch {
          return false
        }
      })?.uri
    if (uri !== undefined) return { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }
  }
  return undefined
}

/**
 * Go to the file behind `loader(x)` (anywhere in the call) or behind an instance member access: the
 * innermost such expression around the position whose node has a file.
 */
export function environmentDefinition(view: LuaEnvironmentView, request: LanguagePositionRequest): LanguageLocation | undefined {
  const offset = view.document.lines.offset(request.position)
  const loader = view.environment.instances?.loader
  let best: { node: LuaInstanceNode; width: number } | undefined
  for (const node of astNodes(view.document.chunk)) {
    if (offset < node.range[0] || offset > node.range[1]) continue
    const width = node.range[1] - node.range[0]
    if (best !== undefined && width >= best.width) continue
    let found: LuaInstanceNode | undefined
    if (node.type === 'AstExprCall') {
      const call = node as unknown as AstExprCall
      if (loader !== undefined && call.func.type === 'AstExprName' && call.func.name === loader) found = view.evaluate(call.args[0])?.node
    } else if (node.type === 'AstExprIndexName') {
      const access = node as unknown as AstExprIndexName
      if (offset >= access.indexLocation[0]) found = view.evaluate(access as unknown as AstExpr)?.node
    }
    if (found?.filePaths !== undefined && found.filePaths.length > 0) best = { node: found, width }
  }
  return fileLocation(request, best?.node)
}

const COMPLETION_PLACEHOLDER = '__modkit_complete__'
const IDENTIFIER_CHAR = /[A-Za-z0-9_]/u

/**
 * Completion items at the position: after `.` or `:` the members of what stands before it (the text
 * is re-read with a placeholder call there, so an unfinished line still parses); elsewhere the
 * environment's globals. `reread` parses a text as this document.
 */
export async function environmentCompletion(
  environment: LuaEnvironment | undefined,
  request: LanguagePositionRequest,
  document: DocumentView,
  reread: (text: string) => Promise<DocumentView>,
): Promise<{ readonly member: boolean; readonly items: LanguageCompletionItem[] }> {
  const text = document.text
  const offset = document.lines.offset(request.position)
  let start = offset
  while (start > 0 && IDENTIFIER_CHAR.test(text[start - 1]!)) start -= 1
  let end = offset
  while (end < text.length && IDENTIFIER_CHAR.test(text[end]!)) end += 1
  const replacementRange = document.lines.range([start, offset])
  const trigger = text[start - 1]
  if (trigger !== '.' && trigger !== ':') {
    return {
      member: false,
      items: Object.entries(environment?.globals ?? {}).map(([name, global]) => ({
        label: name,
        kind: 'variable' as const,
        ...(global.type === undefined ? {} : { detail: global.type }),
        ...(global.doc === undefined ? {} : { documentation: global.doc }),
        replacementRange,
      })),
    }
  }
  if (environment === undefined) return { member: true, items: [] }
  const reread_ = await reread(`${text.slice(0, start)}${COMPLETION_PLACEHOLDER}()${text.slice(end)}`)
  const path = documentPathOf(request)
  const view = new LuaEnvironmentView(environment, reread_, path)
  const access = astNodes(reread_.chunk).find(
    (node): node is AstLike => node.type === 'AstExprIndexName' && (node as unknown as AstExprIndexName).index === COMPLETION_PLACEHOLDER,
  ) as unknown as AstExprIndexName | undefined
  const base = access === undefined ? undefined : view.evaluate(access.expr)
  if (base === undefined) return { member: true, items: [] }
  const items = new Map<string, LanguageCompletionItem>()
  if (trigger === '.') {
    for (const child of base.node?.children ?? []) {
      items.set(child.name, { label: child.name, kind: 'module', detail: child.className, replacementRange, sortText: `0${child.name}` })
    }
  }
  const type = view.typeOf(base)
  for (let at = type, depth = 0; at !== undefined && depth < 64; depth += 1) {
    for (const [name, member] of Object.entries(view.environment.types?.[at]?.members ?? {})) {
      if (items.has(name) || (trigger === ':') !== (member.kind === 'method')) continue
      items.set(name, {
        label: name,
        kind: member.kind === 'property' ? 'property' : member.kind === 'event' || member.kind === 'callback' ? 'field' : 'function',
        detail: signature(at, name, member),
        ...(member.doc === undefined ? {} : { documentation: member.doc }),
        replacementRange,
        sortText: `${member.deprecated === true ? 2 : 1}${name}`,
      })
    }
    at = view.environment.types?.[at]?.extends
  }
  return { member: true, items: [...items.values()] }
}
