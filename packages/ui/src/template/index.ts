import {
  GAME_TEMPLATE_PREVIEW_OPERATION_ID,
  GAME_TEMPLATE_WORKSPACE_INPUT,
  gameTemplateTextRuns,
  isGameTemplateDisplayItem,
  isGameTemplatePreviewResult,
  isGameTemplateTreeNode,
  type GameTemplateDisplayItem,
  type GameTemplatePreviewResult,
  type GameTemplateTreeNode,
  type GameTemplateValueSource,
} from '@modkit/sdk/templates'
import type {
  JsonValue,
  RasterResourcePort,
  ViewerModule,
  ViewerWorkspaceDocuments,
} from '@modkit/sdk'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  invokeOperation,
  safeViewerText,
  ViewerMountScope,
} from '../viewer/index.js'
import { setPart, setState } from '../parts.js'
import { type UiLocalizationOptions, type UiLocalizer } from '../localization/index.js'
import { TEMPLATE_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

const MAXIMUM_DISPLAY_ITEMS = 2_000
const MAXIMUM_TREE_TEXT = 200_000
/** A tree row is a DOM node; a mod's whole GameUI is not something a side panel lists. */
const MAXIMUM_TREE_ROWS = 2_000

function jsonText(value: JsonValue, maximum = MAXIMUM_TREE_TEXT): string {
  return safeViewerText(JSON.stringify(value, null, 2), maximum)
}

const SVG_NS = 'http://www.w3.org/2000/svg'
/** Below this the label would be unreadable anyway, and a template is full of one-pixel spacers. */
const MINIMUM_LABEL_SIZE = 12

function svg(document: Document, name: string, attributes: Readonly<Record<string, string>>) {
  const node = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value)
  return node
}

/**
 * The template as a picture: every item where the producer put it.
 *
 * Nothing here knows a game. A box is a rectangle, text is its resolved runs in the colours the
 * producer already decided, and an image is the rectangle plus the asset's name — a viewer may not
 * turn a logical asset id into a request, so an unresolved image says which asset it is waiting for
 * instead of silently drawing nothing.
 */
export function drawTemplateItems(
  document: Document,
  host: HTMLElement,
  items: readonly GameTemplateDisplayItem[],
  images: ReadonlyMap<string, string> = new Map(),
): SVGElement {
  const bounds = items.reduce(
    (box, item) => ({
      minX: Math.min(box.minX, item.rect.x),
      minY: Math.min(box.minY, item.rect.y),
      maxX: Math.max(box.maxX, item.rect.x + item.rect.width),
      maxY: Math.max(box.maxY, item.rect.y + item.rect.height),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )
  const width = Math.max(1, bounds.maxX - bounds.minX)
  const height = Math.max(1, bounds.maxY - bounds.minY)
  const canvas = svg(document, 'svg', {
    class: 'modkit-template__canvas',
    viewBox: `${bounds.minX} ${bounds.minY} ${width} ${height}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
  })
  setPart(canvas, 'template.canvas')
  canvas.setAttribute('data-items', String(items.length))

  for (const item of items) {
    const group = svg(document, 'g', {
      class: `modkit-template__node modkit-template__node--${item.kind}`,
      'data-path': item.path.join('/'),
      ...(item.visible === false ? { 'data-hidden': 'true' } : {}),
    })
    group.append(
      svg(document, 'rect', {
        x: String(item.rect.x),
        y: String(item.rect.y),
        width: String(Math.max(0, item.rect.width)),
        height: String(Math.max(0, item.rect.height)),
        rx: '2',
      }),
    )
    const runs = gameTemplateTextRuns(item)
    const sized = runs.find(run => run.size !== undefined)?.size
    const fontSize = Math.max(
      MINIMUM_LABEL_SIZE,
      Math.min(sized ?? 24, item.rect.height * (sized === undefined ? 0.6 : 1)),
    )
    if (runs.length > 0 && item.rect.height >= MINIMUM_LABEL_SIZE) {
      const text = svg(document, 'text', {
        x: String(item.rect.x + 4),
        y: String(item.rect.y + fontSize),
        'font-size': String(fontSize),
      })
      for (const run of runs) {
        const span = svg(document, 'tspan', {
          ...(run.color === undefined ? {} : { fill: run.color }),
          ...(run.bold === true ? { 'font-weight': 'bold' } : {}),
          ...(run.italic === true ? { 'font-style': 'italic' } : {}),
          ...(run.underline === true ? { 'text-decoration': 'underline' } : {}),
        })
        span.textContent = safeViewerText(run.text, 512)
        text.append(span)
      }
      group.append(text)
    } else if (item.asset !== undefined && images.has(item.asset)) {
      group.append(
        svg(document, 'image', {
          href: images.get(item.asset) as string,
          x: String(item.rect.x),
          y: String(item.rect.y),
          width: String(Math.max(0, item.rect.width)),
          height: String(Math.max(0, item.rect.height)),
          preserveAspectRatio: 'xMidYMid meet',
        }),
      )
    } else if (item.asset !== undefined && item.rect.height >= MINIMUM_LABEL_SIZE) {
      const label = svg(document, 'text', {
        x: String(item.rect.x + 4),
        y: String(item.rect.y + fontSize),
        'font-size': String(fontSize),
        class: 'modkit-template__asset',
      })
      label.textContent = safeViewerText(item.asset.split(/[\\\/]/u).at(-1) ?? item.asset, 128)
      group.append(label)
    }
    const title = svg(document, 'title', {})
    title.textContent = `${item.path.join('/')}${item.frameType === undefined ? '' : ` — ${item.frameType}`}`
    group.append(title)
    canvas.append(group)
  }
  host.append(canvas)
  return canvas
}

/** One row of the tree panel, in document order. */
export interface TemplateTreeRow {
  /** The node's path joined with `/`, the same key a drawn item carries in `data-path`. */
  readonly key: string
  readonly depth: number
  readonly node: GameTemplateTreeNode
}

/** The tree as the rows a panel lists, pre-order and capped. */
export function templateTreeRows(
  root: GameTemplateTreeNode,
  maximum = MAXIMUM_TREE_ROWS,
): readonly TemplateTreeRow[] {
  const rows: TemplateTreeRow[] = []
  const pending: { readonly node: GameTemplateTreeNode; readonly depth: number }[] = [
    { node: root, depth: 0 },
  ]
  for (
    let next = pending.pop();
    next !== undefined && rows.length < maximum;
    next = pending.pop()
  ) {
    rows.push({ key: next.node.path.join('/'), depth: next.depth, node: next.node })
    for (let index = next.node.children.length - 1; index >= 0; index -= 1) {
      const child = next.node.children[index]
      if (child !== undefined) pending.push({ node: child, depth: next.depth + 1 })
    }
  }
  return rows
}

/** One line of the element view: a property, its value and where the value came from. */
export interface TemplatePropertyRow {
  readonly name: string
  readonly value: string
  readonly origin: string
}

const leafOf = (uri: string): string => uri.split(/[\\/]/u).at(-1) ?? uri

/** A source that names a node other than this one: an inherited template or a hookup. */
const foreignFrame = (node: GameTemplateTreeNode, source: GameTemplateValueSource | undefined) =>
  source?.frame !== undefined &&
  !node.path.join('/').toLowerCase().endsWith(source.frame.toLowerCase())
    ? source.frame
    : undefined

function originText(node: GameTemplateTreeNode, source: GameTemplateValueSource | undefined) {
  if (source === undefined) return ''
  return [source.origin, foreignFrame(node, source), source.uri && leafOf(source.uri)]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' · ')
}

/**
 * What the element view shows for one node: its properties with the value the producer resolved
 * (`#Constant → 120`) and their origin, then its anchors.
 */
export function templatePropertyRows(node: GameTemplateTreeNode): readonly TemplatePropertyRow[] {
  const rows: TemplatePropertyRow[] = []
  for (const property of node.properties ?? []) {
    const written = property.val ?? ''
    rows.push({
      name: property.name,
      value:
        property.resolved === undefined || property.resolved === written
          ? written
          : `${written} → ${property.resolved}`,
      origin: originText(node, property.source),
    })
  }
  for (const anchor of node.anchors ?? []) {
    rows.push({
      name: `Anchor ${anchor.side}`,
      value: [anchor.relative ?? '$parent', anchor.pos, anchor.offset]
        .filter((part): part is string => part !== undefined && part !== '')
        .join(' '),
      origin: originText(node, anchor.source),
    })
  }
  return rows
}

/** The template chain a node inherits: what it names, then every other node its values came from. */
export function templateChain(node: GameTemplateTreeNode): readonly string[] {
  const links = new Set<string>(node.template === undefined ? [] : [node.template])
  for (const source of [
    ...(node.properties ?? []).map(item => item.source),
    ...(node.anchors ?? []).map(item => item.source),
  ]) {
    const frame = foreignFrame(node, source)
    if (frame !== undefined) links.add(frame)
  }
  return [...links]
}

/**
 * «Reveal in DescTree» (plan 3.33): the template stage selects the node declared at `offset` of the
 * document `uri`. Dispatched on the page's document; the mounted viewer answers it.
 */
export const TEMPLATE_REVEAL_EVENT = 'modkit-template-reveal'

export interface TemplateRevealDetail {
  readonly uri: string
  readonly offset: number
}

/** A node's declaration to show as text: the document and the declaration's range in it. */
export interface TemplateSourceLocation {
  readonly uri: string
  readonly start?: number
  readonly end?: number
}

const sameDocument = (left: string, right: string): boolean => {
  const normal = (uri: string) => {
    let text = uri
    try {
      text = decodeURIComponent(uri)
    } catch {
      // a malformed escape is compared as written
    }
    return text.replaceAll('\\', '/').toLowerCase()
  }
  return left === right || normal(left) === normal(right)
}

/** The innermost node declared around `offset` of the document `uri`, if any. */
export function templateNodeAt(
  root: GameTemplateTreeNode,
  uri: string,
  offset: number,
): GameTemplateTreeNode | undefined {
  let found: GameTemplateTreeNode | undefined
  const pending = [root]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    const source = node.source
    if (
      source?.uri !== undefined &&
      source.start !== undefined &&
      source.end !== undefined &&
      source.start <= offset &&
      offset <= source.end &&
      sameDocument(source.uri, uri) &&
      (found?.source?.start === undefined || source.start >= found.source.start)
    ) {
      found = node
    }
    pending.push(...node.children)
  }
  return found
}

/** The node a viewer shows as selected; shared by re-renders of one mount. */
export interface TemplateSelection {
  key: string | undefined
  /** Selects the node declared at a document offset; set while a tree is on screen. */
  reveal?: ((uri: string, offset: number) => boolean) | undefined
  /** A reveal that arrived before the tree did. */
  pending?: TemplateRevealDetail | undefined
}

function renderTreePanel(
  host: HTMLElement,
  rows: readonly TemplateTreeRow[],
  select: (key: string) => void,
  openSource: ((node: GameTemplateTreeNode) => void) | undefined,
): Map<string, HTMLElement> {
  const panel = element(host, 'nav', { className: 'modkit-template__tree', part: 'tree' })
  const list = element(panel, 'ul', { part: 'tree.list', role: 'tree' })
  const byKey = new Map<string, HTMLElement>()
  rows.forEach((row, index) => {
    const item = element(list, 'li', { part: 'tree.item', role: 'treeitem' })
    item.setAttribute('aria-level', String(row.depth + 1))
    item.dataset['path'] = row.key
    item.tabIndex = -1
    item.style.setProperty('--template-depth', String(row.depth))
    const line = element(item, 'span', { part: 'tree.row' })
    element(line, 'span', { part: 'tree.label', text: row.node.name || '(anonymous)' })
    if (row.node.type !== undefined) {
      element(line, 'span', { part: 'tree.value', text: `[${row.node.type}]` })
    }
    if (row.node.template !== undefined) {
      element(line, 'span', { part: 'tree.key', text: `→ ${row.node.template}` })
    }
    item.addEventListener('click', () => select(row.key))
    if (openSource !== undefined) item.addEventListener('dblclick', () => openSource(row.node))
    item.addEventListener('keydown', event => {
      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
      const next = step === 0 ? undefined : rows[index + step]
      if (next === undefined) return
      event.preventDefault()
      select(next.key)
      byKey.get(next.key)?.focus()
    })
    byKey.set(row.key, item)
  })
  return byKey
}

function renderPropertiesPanel(
  panel: HTMLElement,
  node: GameTemplateTreeNode | undefined,
  localizer: UiLocalizer,
  openSource: ((node: GameTemplateTreeNode) => void) | undefined,
): void {
  panel.replaceChildren()
  if (node === undefined) {
    element(panel, 'p', { part: 'viewer.empty', text: localizer.text('viewer.templateSelectNode') })
    return
  }
  element(panel, 'strong', { part: 'viewer.status', text: node.path.join('/') })
  if (node.type !== undefined) element(panel, 'div', { part: 'viewer.status', text: node.type })
  if (openSource !== undefined && node.source?.uri !== undefined) {
    const show = element(panel, 'button', {
      part: 'operations.button',
      text: localizer.text('viewer.templateShowSource'),
    }) as HTMLButtonElement
    show.type = 'button'
    show.addEventListener('click', () => openSource(node))
  }
  const chain = templateChain(node)
  if (chain.length > 0) {
    element(panel, 'div', {
      part: 'viewer.status',
      text: localizer.text('viewer.templateChain', { chain: chain.join(' → ') }),
    })
  }
  const table = element(panel, 'div', { part: 'properties', role: 'table' })
  const rows = templatePropertyRows(node)
  for (const row of rows) {
    const line = element(table, 'div', { part: 'properties.row', role: 'row' })
    element(line, 'span', { part: 'properties.name', role: 'cell', text: row.name })
    element(line, 'span', {
      part: 'properties.value',
      role: 'cell',
      text: safeViewerText(row.value, 1_024),
    })
    element(line, 'span', { part: 'properties.origin', role: 'cell', text: row.origin })
  }
  if (rows.length === 0) {
    element(table, 'p', {
      part: 'viewer.empty',
      text: localizer.text('viewer.templateNoProperties'),
    })
  }
}

/**
 * The drawn template between its resolved tree and the selected node's properties.
 *
 * One selection drives all three: a tree row, a rectangle on the canvas and the element view are
 * the same node by path, so choosing any of them shows the others.
 */
function renderTemplateBody(
  document: Document,
  host: HTMLElement,
  tree: GameTemplateTreeNode,
  drawable: readonly GameTemplateDisplayItem[],
  images: ReadonlyMap<string, string>,
  localizer: UiLocalizer,
  selection: TemplateSelection,
  openSource: ((location: TemplateSourceLocation) => void) | undefined,
): void {
  const body = element(host, 'div', { className: 'modkit-template__body', part: 'template.body' })
  const showSource =
    openSource === undefined
      ? undefined
      : (node: GameTemplateTreeNode) => {
          const source = node.source
          if (source?.uri === undefined) return
          openSource({
            uri: source.uri,
            ...(source.start === undefined ? {} : { start: source.start }),
            ...(source.end === undefined ? {} : { end: source.end }),
          })
        }
  const rows = templateTreeRows(tree)
  const nodes = new Map(rows.map(row => [row.key, row.node]))
  let byKey = new Map<string, HTMLElement>()
  const select = (key: string): void => {
    selection.key = key
    for (const [candidate, item] of byKey) {
      setState(item, candidate === key ? ['selected'] : [])
      item.setAttribute('aria-selected', String(candidate === key))
    }
    for (const group of canvas?.querySelectorAll('g[data-path]') ?? []) {
      setState(group, group.getAttribute('data-path') === key ? ['selected'] : [])
    }
    renderPropertiesPanel(panel, nodes.get(key), localizer, showSource)
  }
  byKey = renderTreePanel(body, rows, select, showSource)
  const stage = element(body, 'div', { className: 'modkit-template__stage' })
  const canvas =
    drawable.length > 0 ? drawTemplateItems(document, stage, drawable, images) : undefined
  if (canvas === undefined) {
    element(stage, 'p', { part: 'viewer.empty', text: localizer.text('viewer.noDisplayItems') })
  }
  const panel = element(body, 'aside', { className: 'modkit-template__properties' })
  canvas?.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest('g[data-path]') : null
    const key = target?.getAttribute('data-path')
    if (key === null || key === undefined || !nodes.has(key)) return
    select(key)
    byKey.get(key)?.scrollIntoView({ block: 'nearest' })
  })
  if (rows.length >= MAXIMUM_TREE_ROWS) {
    element(host, 'p', {
      part: 'viewer.status',
      text: localizer.text('viewer.displayCapped', {
        maximum: MAXIMUM_TREE_ROWS,
        count: MAXIMUM_TREE_ROWS,
      }),
    })
  }
  const initial =
    selection.key !== undefined && nodes.has(selection.key) ? selection.key : rows[0]?.key
  if (initial !== undefined) select(initial)
  selection.reveal = (uri, offset) => {
    const key = templateNodeAt(tree, uri, offset)?.path.join('/')
    if (key === undefined || !nodes.has(key)) return false
    select(key)
    byKey.get(key)?.scrollIntoView({ block: 'nearest' })
    byKey.get(key)?.focus()
    return true
  }
  const pending = selection.pending
  selection.pending = undefined
  if (pending !== undefined) selection.reveal(pending.uri, pending.offset)
}

/** Render the common semantic template envelope without assuming one game's template format. */
export function renderGameTemplatePreview(
  document: Document,
  host: HTMLElement,
  preview: GameTemplatePreviewResult,
  localizer: UiLocalizer = withEnglishUiFallback(undefined, TEMPLATE_FALLBACK_MESSAGES),
  images: ReadonlyMap<string, string> = new Map(),
  options: {
    /** Which node is selected; kept across re-renders of the same subject. */
    readonly selection?: TemplateSelection
    /** Preview from another root the producer offered. */
    readonly chooseRoot?: (root: string) => void
    /** Show a node's declaration as text («Show in Text Editor»). */
    readonly openSource?: (location: TemplateSourceLocation) => void
  } = {},
): void {
  host.replaceChildren()
  host.dataset['templateKind'] = preview.templateKind
  host.dataset['completeness'] = preview.completeness

  const header = element(host, 'header', {
    className: 'modkit-template__header',
    part: 'viewer.toolbar',
  })
  element(header, 'strong', { text: preview.templateKind, part: 'viewer.status' })
  element(header, 'span', {
    text: preview.completeness,
    part: 'viewer.status',
  })
  const roots = preview.roots ?? []
  if (roots.length > 1 && options.chooseRoot !== undefined) {
    const choose = options.chooseRoot
    const picker = element(header, 'select', { part: 'field.control' }) as HTMLSelectElement
    picker.setAttribute('aria-label', localizer.text('viewer.templateRoot'))
    for (const root of roots) {
      const option = document.createElement('option')
      option.value = root
      option.textContent = root
      option.selected = root === (preview.rootPath ?? roots[0])
      picker.append(option)
    }
    picker.addEventListener('change', () => choose(picker.value))
  }
  if (preview.fidelity.unsupported.length > 0) {
    element(header, 'span', {
      text: localizer.text('viewer.namedRemainder', {
        count: preview.fidelity.unsupported.length,
      }),
      part: 'viewer.status',
    })
    const remainder = element(host, 'ul', {
      className: 'modkit-template__diagnostics',
      part: 'diagnostics.list',
    })
    for (const item of preview.fidelity.unsupported) {
      element(remainder, 'li', { text: item, part: 'diagnostics.item' })
    }
  }

  const drawable = preview.displayItems
    .slice(0, MAXIMUM_DISPLAY_ITEMS)
    .filter((item): item is GameTemplateDisplayItem & JsonValue => isGameTemplateDisplayItem(item))
  const rest = preview.displayItems
    .slice(0, MAXIMUM_DISPLAY_ITEMS)
    .filter(item => !isGameTemplateDisplayItem(item))

  const tree = isGameTemplateTreeNode(preview.resolvedTree) ? preview.resolvedTree : undefined
  if (tree !== undefined) {
    renderTemplateBody(
      document,
      host,
      tree,
      drawable,
      images,
      localizer,
      options.selection ?? { key: undefined },
      options.openSource,
    )
  } else if (drawable.length > 0) drawTemplateItems(document, host, drawable, images)

  if (rest.length > 0 || (drawable.length === 0 && tree === undefined)) {
    const items = element(host, 'ol', {
      className: 'modkit-template__items',
      part: 'tree.list',
    }) as HTMLOListElement
    for (const item of rest) {
      const row = document.createElement('li')
      row.className = 'modkit-template__item'
      row.setAttribute('data-mk-part', 'tree.item')
      row.textContent = jsonText(item, 4_096)
      items.append(row)
    }
    if (preview.displayItems.length === 0) {
      element(items, 'li', { text: localizer.text('viewer.noDisplayItems'), part: 'viewer.empty' })
    }
  }
  if (preview.displayItems.length > MAXIMUM_DISPLAY_ITEMS) {
    element(host, 'p', {
      text: localizer.text('viewer.displayCapped', {
        maximum: MAXIMUM_DISPLAY_ITEMS,
        count: preview.displayItems.length,
      }),
      part: 'viewer.status',
    })
  }

  // A tree this viewer cannot read is still evidence, shown as the data it is.
  if (tree === undefined) {
    const details = document.createElement('details')
    details.className = 'modkit-template__details'
    const summary = document.createElement('summary')
    summary.textContent = localizer.text('viewer.resolvedSemanticTree')
    const raw = document.createElement('pre')
    raw.setAttribute('data-mk-part', 'text')
    raw.textContent = jsonText(preview.resolvedTree)
    details.append(summary, raw)
    host.append(details)
  }

  if (preview.diagnostics.length > 0) {
    const diagnostics = element(host, 'ul', {
      className: 'modkit-template__diagnostics',
      part: 'diagnostics.list',
    })
    for (const item of preview.diagnostics) {
      element(diagnostics, 'li', {
        text: `${item.severity ?? 'information'} · ${item.code} · ${item.message}`,
        part: 'diagnostics.item',
      })
    }
  }
}

/** The operation input, carrying the host's snapshot when this window has one. */
async function templateInput(
  workspace: ViewerWorkspaceDocuments | undefined,
  signal: AbortSignal,
): Promise<JsonValue> {
  if (workspace === undefined) return {}
  const snapshot = await workspace.read({ signal })
  if (snapshot.documents.length === 0) return {}
  return {
    [GAME_TEMPLATE_WORKSPACE_INPUT]: snapshot.documents.map(document => ({
      uri: document.uri,
      languageId: document.languageId,
      version: document.version,
      text: document.text,
    })),
  } as JsonValue
}

/**
 * Pixels for the assets a template names, as data URLs.
 *
 * The host resolves the logical id — a viewer that turned one into a request would be a way to make
 * a page fetch whatever an extension named — and whoever implements this is the side that already
 * has both the host's raster port and a canvas to encode with. An asset that does not resolve is
 * simply absent from the map, and the canvas keeps naming it.
 */
export type GameTemplateImageResolver = (
  descriptor: unknown,
  assets: readonly string[],
  signal?: AbortSignal,
) => Promise<ReadonlyMap<string, string>>

/** What one template's icons may cost a page; a template names a few, not a mod's worth. */
const TEMPLATE_IMAGE_BUDGET_BYTES = 32 * 1024 * 1024

/**
 * One decoded region as a PNG data URL.
 *
 * Rows are copied one at a time because a region's stride is its own business: a decoder may pad,
 * and reading it as a tight buffer would shear the image.
 */
function encodeRegionAsPng(
  document: Document,
  region: {
    readonly width: number
    readonly height: number
    readonly rowStride: number
    readonly pixelFormat: string
    readonly pixels: Uint8Array
  },
): string | undefined {
  if (region.pixelFormat !== 'rgba8' || region.width <= 0 || region.height <= 0) return undefined
  const canvas = document.createElement('canvas')
  canvas.width = region.width
  canvas.height = region.height
  const context = canvas.getContext('2d')
  if (context === null) return undefined
  const image = context.createImageData(region.width, region.height)
  for (let row = 0; row < region.height; row += 1) {
    const from = row * region.rowStride
    image.data.set(region.pixels.subarray(from, from + region.width * 4), row * region.width * 4)
  }
  context.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * The icons a template names, decoded through a subject-bound raster port.
 *
 * Every host that has the port and a canvas answers the same way: the page receives pixels, never a
 * path or a codec choice, and an asset the host cannot resolve is left out so the stage keeps
 * naming it.
 */
export async function templateImagesFromRaster(
  document: Document,
  port: RasterResourcePort,
  assets: readonly string[],
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, string>> {
  const images = new Map<string, string>()
  let remaining = TEMPLATE_IMAGE_BUDGET_BYTES
  for (const [index, asset] of assets.entries()) {
    if (remaining <= 0 || signal?.aborted === true) break
    const result = await port.read(
      {
        kind: 'logical',
        requirement: {
          id: `template-image-${index}`,
          logicalId: asset,
          role: 'texture',
          scopes: [
            'sibling-directory',
            'workspace-dependency-layer',
            'current-mount',
            'enclosing-container',
          ],
        },
        maxBytes: remaining,
      },
      signal,
    )
    if (result.state !== 'decoded') continue
    const url = encodeRegionAsPng(document, result.region)
    if (url === undefined) continue
    remaining -= result.region.pixels.byteLength
    images.set(asset, url)
  }
  return images
}

export interface GameTemplateViewerOptions extends UiLocalizationOptions {
  readonly images?: GameTemplateImageResolver
  /** Show a node's declaration in the host's text editor (plan 3.33). */
  readonly openSource?: (location: TemplateSourceLocation) => void
}

/** Standard operation-backed stage shared by publisher-defined document templates. */
export function createGameTemplateViewer(options: GameTemplateViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, TEMPLATE_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.gameTemplate'))
      let renderRevision = 0
      let rootPath: string | undefined
      let shown:
        { descriptor: typeof args.descriptor; preview: GameTemplatePreviewResult } | undefined
      const selection: TemplateSelection = { key: undefined }
      /*
       * A template names templates in other files. The host is the only side that may read them,
       * so what it handed over goes to the operation; without the port the operation still runs
       * and reports what it could not resolve, which is the honest half-answer.
       */
      const fetchPreview = async (
        descriptor: typeof args.descriptor,
        from: string | undefined,
      ): Promise<GameTemplatePreviewResult | { readonly refused: string }> => {
        const input = await templateInput(args.workspaceDocuments, scope.signal)
        const result = await invokeOperation(
          descriptor,
          args.operations,
          GAME_TEMPLATE_PREVIEW_OPERATION_ID,
          (from === undefined
            ? input
            : { ...(input as Record<string, JsonValue>), rootPath: from }) as JsonValue,
          { signal: scope.signal },
        )
        if (result.state !== 'ok') return { refused: result.reason }
        if (result.output.kind !== 'json' || !isGameTemplatePreviewResult(result.output.value)) {
          throw new TypeError('view.template returned an invalid game-template-preview result')
        }
        return result.output.value
      }
      /*
       * «Reveal in DescTree»: a reveal that arrives before the tree is drawn waits for it; one the
       * shown root does not declare is looked for under the other roots the producer offers, and
       * the first that declares it is shown.
       */
      const revealElsewhere = async (detail: TemplateRevealDetail): Promise<void> => {
        const current = shown
        if (current === undefined) return
        for (const candidate of current.preview.roots ?? []) {
          if (candidate === (current.preview.rootPath ?? rootPath)) continue
          const other = await fetchPreview(current.descriptor, candidate)
          if (scope.signal.aborted || shown !== current) return
          if ('refused' in other || !isGameTemplateTreeNode(other.resolvedTree)) continue
          if (templateNodeAt(other.resolvedTree, detail.uri, detail.offset) === undefined) continue
          rootPath = candidate
          selection.key = undefined
          selection.pending = detail
          await render(current.descriptor)
          return
        }
      }
      const onReveal = (event: Event): void => {
        const detail = (event as CustomEvent<TemplateRevealDetail>).detail
        if (selection.reveal === undefined) selection.pending = detail
        else if (!selection.reveal(detail.uri, detail.offset))
          void revealElsewhere(detail).catch(() => undefined)
      }
      root.ownerDocument.addEventListener(TEMPLATE_REVEAL_EVENT, onReveal)
      scope.cleanup(() => root.ownerDocument.removeEventListener(TEMPLATE_REVEAL_EVENT, onReveal))
      const render = async (descriptor: typeof args.descriptor): Promise<void> => {
        const revision = ++renderRevision
        selection.reveal = undefined
        root.replaceChildren()
        element(root, 'output', {
          text: localizer.text('viewer.loadingTemplate'),
          part: 'viewer.status',
        })
        const answer = await fetchPreview(descriptor, rootPath)
        if (scope.signal.aborted || revision !== renderRevision) return
        if ('refused' in answer) {
          root.replaceChildren()
          element(root, 'output', {
            text: localizer.text('viewer.templateUnavailable', { reason: answer.refused }),
            part: 'viewer.status',
          })
          return
        }
        const preview = answer
        const assets = [
          ...new Set(
            preview.displayItems.flatMap(item =>
              isGameTemplateDisplayItem(item) && item.asset !== undefined ? [item.asset] : [],
            ),
          ),
        ]
        const images =
          options.images === undefined || assets.length === 0
            ? new Map<string, string>()
            : await options.images(descriptor, assets, scope.signal)
        if (scope.signal.aborted || revision !== renderRevision) return
        shown = { descriptor, preview }
        renderGameTemplatePreview(root.ownerDocument, root, preview, localizer, images, {
          selection,
          ...(options.openSource === undefined ? {} : { openSource: options.openSource }),
          chooseRoot: next => {
            rootPath = next
            selection.key = undefined
            void render(descriptor).catch(error => {
              root.replaceChildren()
              element(root, 'output', {
                text: localizer.text('viewer.templateUnavailable', { reason: String(error) }),
                part: 'viewer.status',
              })
            })
          },
        })
        root.dataset['revision'] = descriptor.revision
      }
      try {
        await render(args.descriptor)
        return createViewerMount(root, scope, args, ({ descriptor }) => render(descriptor))
      } catch (error) {
        await scope.close()
        root.remove()
        throw error
      }
    },
  })
}

export const gameTemplateViewer: ViewerModule = createGameTemplateViewer()

export default gameTemplateViewer
