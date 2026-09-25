import type { JsonValue } from '../asset-capabilities/types.js'

/** Stable read-only operation shared by game-specific template implementations. */
export const GAME_TEMPLATE_PREVIEW_OPERATION_ID = 'view.template' as const
export const GAME_TEMPLATE_PREVIEW_SCHEMA_VERSION = 1 as const

/**
 * Input property a caller fills with the documents around the subject.
 *
 * Named once here so a game's producer and a generic surface agree without either learning about
 * the other: a template that names a template in another file resolves only when the caller passes
 * what it has, and every producer reads the same key.
 */
export const GAME_TEMPLATE_WORKSPACE_INPUT = 'workspaceDocuments' as const

export interface GameTemplateViewport {
  readonly width: number
  readonly height: number
}

/**
 * Source-neutral request. A codec may accept additional game-specific input through `options`, but
 * it must not reinterpret the common bounds or mutate its subject.
 */
export interface GameTemplatePreviewInput {
  readonly templateKind: string
  readonly rootIds?: readonly string[]
  readonly rootPath?: string
  readonly viewport?: GameTemplateViewport
  readonly maxNodes?: number
  readonly maxEdges?: number
  readonly maxDiagnostics?: number
  readonly options?: JsonValue
}

export interface GameTemplatePreviewDiagnostic {
  readonly code: string
  readonly message: string
  readonly severity?: 'error' | 'warning' | 'information' | 'hint'
  readonly path?: readonly (string | number)[]
  readonly data?: JsonValue
}

export interface GameTemplatePreviewFidelity {
  /** Product GA compares represented meaning, not pixel-identical game output. */
  readonly comparison: 'semantic'
  readonly unsupported: readonly string[]
  readonly [key: string]: JsonValue
}

/** Where a display item sits, in the template's own coordinate space. */
export interface GameTemplateRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * One run of text with the appearance the producer already resolved.
 *
 * Resolved, not described: the producer knows the game's style sheet and its localization, the
 * viewer does not and must never learn. A run carries a CSS colour or nothing.
 */
export interface GameTemplateTextRun {
  readonly text: string
  readonly color?: string
  readonly bold?: boolean
  readonly italic?: boolean
  readonly underline?: boolean
  /** Glyph height in the template's own units, when the producer's style sheet says one. */
  readonly size?: number
  /**
   * An inline image in place of text: a logical id, like `GameTemplateDisplayItem.asset`, that only
   * the host turns into pixels. Such a run draws nothing else, so its `text` is empty.
   */
  readonly asset?: string
  /**
   * Why the producer could not resolve this run — a catalog reference with no catalog at hand, say.
   * `text` is what it shows instead; a viewer marks the run rather than passing it off as resolved.
   */
  readonly unresolved?: string
}

/**
 * One drawable thing a template resolved to.
 *
 * This is the whole reason `view.template` is not a StarCraft II operation: a box with a rectangle,
 * text with its runs and an image with the asset it names are what every game's template resolves
 * to, whatever the file format underneath. Anything a game cannot express this way still travels in
 * `resolvedTree`, which stays opaque.
 *
 * `asset` is a logical id, never a URL: only the host may turn one into pixels, and a viewer that
 * accepted a URL would be a way to make a page fetch whatever an extension named.
 */
export interface GameTemplateDisplayItem {
  readonly kind: 'box' | 'text' | 'image'
  /** Path inside the template, root first; also what a viewer labels the item with. */
  readonly path: readonly string[]
  readonly rect: GameTemplateRect
  /** Absent means visible; `false` is a thing the template hides, which a viewer still shows faintly. */
  readonly visible?: boolean
  readonly text?: string | readonly GameTemplateTextRun[]
  readonly asset?: string
  /** The game's own name for what produced this item, for a viewer's label. */
  readonly frameType?: string
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const optionalBoolean = (value: unknown): boolean =>
  value === undefined || typeof value === 'boolean'

/** Runtime guard for one run, for surfaces that receive runs outside a display item. */
export function isGameTemplateTextRun(value: unknown): value is GameTemplateTextRun {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const run = value as Record<string, unknown>
  return (
    typeof run['text'] === 'string' &&
    (run['color'] === undefined || typeof run['color'] === 'string') &&
    optionalBoolean(run['bold']) &&
    optionalBoolean(run['italic']) &&
    optionalBoolean(run['underline']) &&
    (run['size'] === undefined || (finite(run['size']) && run['size'] > 0)) &&
    (run['asset'] === undefined || (typeof run['asset'] === 'string' && run['text'] === '')) &&
    (run['unresolved'] === undefined || typeof run['unresolved'] === 'string')
  )
}

/** Runtime guard: a viewer draws what conforms and reports the rest as data rather than guessing. */
export function isGameTemplateDisplayItem(value: unknown): value is GameTemplateDisplayItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const rect = item['rect'] as Record<string, unknown> | undefined
  const text = item['text']
  return (
    ['box', 'text', 'image'].includes(String(item['kind'])) &&
    Array.isArray(item['path']) &&
    item['path'].every(part => typeof part === 'string') &&
    typeof rect === 'object' &&
    rect !== null &&
    finite(rect['x']) &&
    finite(rect['y']) &&
    finite(rect['width']) &&
    finite(rect['height']) &&
    optionalBoolean(item['visible']) &&
    (text === undefined ||
      typeof text === 'string' ||
      (Array.isArray(text) && text.every(isGameTemplateTextRun))) &&
    (item['asset'] === undefined || typeof item['asset'] === 'string') &&
    (item['frameType'] === undefined || typeof item['frameType'] === 'string')
  )
}

/** The runs a display item's text consists of; a plain string is one unstyled run. */
export function gameTemplateTextRuns(
  item: GameTemplateDisplayItem,
): readonly GameTemplateTextRun[] {
  if (item.text === undefined) return []
  return typeof item.text === 'string' ? [{ text: item.text }] : item.text
}

/**
 * Where one resolved value came from, in the producer's own words.
 *
 * `origin` says how the value reached the node — its own declaration, a template it inherits, a
 * state — and `frame` names the declaring node when that is not the node itself. A viewer shows
 * both as text and never interprets them.
 */
export interface GameTemplateValueSource {
  readonly uri?: string
  readonly origin?: string
  readonly frame?: string
  readonly start?: number
  readonly end?: number
}

/** One property of a resolved node: what the source wrote and, when it differs, what it means. */
export interface GameTemplateNodeProperty {
  readonly name: string
  readonly val?: string
  readonly resolved?: string
  readonly source?: GameTemplateValueSource
}

/** One edge constraint of a resolved node, as the producer wrote it. */
export interface GameTemplateNodeAnchor {
  readonly side: string
  readonly relative?: string
  readonly pos?: string
  readonly offset?: string
  readonly source?: GameTemplateValueSource
}

/**
 * One node of a resolved template tree: what a viewer lists, selects and explains.
 *
 * `path` is the same key display items carry, so a tree row and a drawn rectangle are one thing.
 * A producer may carry more fields; a viewer reads only these.
 */
export interface GameTemplateTreeNode {
  readonly name: string
  readonly type?: string
  readonly path: readonly string[]
  /** The template this node was declared from, as written. */
  readonly template?: string
  readonly properties?: readonly GameTemplateNodeProperty[]
  readonly anchors?: readonly GameTemplateNodeAnchor[]
  readonly children: readonly GameTemplateTreeNode[]
}

const optionalString = (value: unknown): boolean => value === undefined || typeof value === 'string'

function isValueSource(value: unknown): boolean {
  if (value === undefined) return true
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const source = value as Record<string, unknown>
  return (
    optionalString(source['uri']) &&
    optionalString(source['origin']) &&
    optionalString(source['frame']) &&
    (source['start'] === undefined || finite(source['start'])) &&
    (source['end'] === undefined || finite(source['end']))
  )
}

const recordsOk = (list: unknown, check: (item: Record<string, unknown>) => boolean): boolean =>
  list === undefined ||
  (Array.isArray(list) &&
    list.every(
      item =>
        typeof item === 'object' &&
        item !== null &&
        !Array.isArray(item) &&
        check(item as Record<string, unknown>),
    ))

function isNodeShallow(value: unknown): value is GameTemplateTreeNode {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const node = value as Record<string, unknown>
  return (
    typeof node['name'] === 'string' &&
    optionalString(node['type']) &&
    optionalString(node['template']) &&
    Array.isArray(node['path']) &&
    node['path'].every(part => typeof part === 'string') &&
    Array.isArray(node['children']) &&
    recordsOk(
      node['properties'],
      item =>
        typeof item['name'] === 'string' &&
        optionalString(item['val']) &&
        optionalString(item['resolved']) &&
        isValueSource(item['source']),
    ) &&
    recordsOk(
      node['anchors'],
      item =>
        typeof item['side'] === 'string' &&
        optionalString(item['relative']) &&
        optionalString(item['pos']) &&
        optionalString(item['offset']) &&
        isValueSource(item['source']),
    )
  )
}

/** Runtime guard for a whole tree, bounded so a hostile producer cannot make the check the cost. */
export function isGameTemplateTreeNode(
  value: unknown,
  maximumNodes = 100_000,
): value is GameTemplateTreeNode {
  const pending: unknown[] = [value]
  let seen = 0
  while (pending.length > 0) {
    const node = pending.pop()
    if (!isNodeShallow(node) || ++seen > maximumNodes) return false
    for (const child of node.children) pending.push(child)
  }
  return true
}

/**
 * Common semantic envelope. `resolvedTree` and `displayItems` intentionally remain JSON data: each
 * game owns how a template is formed, while every consumer gets the same evidence boundary.
 */
export interface GameTemplatePreviewResult {
  readonly schemaVersion: typeof GAME_TEMPLATE_PREVIEW_SCHEMA_VERSION
  readonly operationId: typeof GAME_TEMPLATE_PREVIEW_OPERATION_ID
  readonly templateKind: string
  readonly entryUri: string
  readonly rootPath?: string
  /** Other roots the same subject can be previewed from, by the name `rootPath` accepts. */
  readonly roots?: readonly string[]
  readonly resolvedTree: JsonValue
  readonly displayItems: readonly JsonValue[]
  readonly diagnostics: readonly GameTemplatePreviewDiagnostic[]
  readonly completeness: 'complete' | 'partial' | 'capped' | 'invalid'
  readonly fidelity: GameTemplatePreviewFidelity
  readonly provenance: JsonValue
  readonly digest: JsonValue
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

/** Runtime guard for JavaScript extensions and app/MCP trust boundaries. */
export function isGameTemplatePreviewResult(value: unknown): value is GameTemplatePreviewResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  const fidelity = result['fidelity']
  return (
    result['schemaVersion'] === GAME_TEMPLATE_PREVIEW_SCHEMA_VERSION &&
    result['operationId'] === GAME_TEMPLATE_PREVIEW_OPERATION_ID &&
    nonEmpty(result['templateKind']) &&
    nonEmpty(result['entryUri']) &&
    (result['rootPath'] === undefined || typeof result['rootPath'] === 'string') &&
    (result['roots'] === undefined ||
      (Array.isArray(result['roots']) &&
        result['roots'].every(root => typeof root === 'string'))) &&
    typeof result['resolvedTree'] === 'object' &&
    result['resolvedTree'] !== null &&
    Array.isArray(result['displayItems']) &&
    Array.isArray(result['diagnostics']) &&
    ['complete', 'partial', 'capped', 'invalid'].includes(String(result['completeness'])) &&
    typeof fidelity === 'object' &&
    fidelity !== null &&
    !Array.isArray(fidelity) &&
    (fidelity as Record<string, unknown>)['comparison'] === 'semantic' &&
    Array.isArray((fidelity as Record<string, unknown>)['unsupported']) &&
    result['provenance'] !== undefined &&
    result['digest'] !== undefined
  )
}
