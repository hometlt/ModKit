/**
 * RelationGraph — the MK2 relations panel, rebuilt in the shared design language.
 *
 * Format-neutral: it takes nodes, edges and type buckets, and knows nothing about units, upgrades
 * or catalogs. Rendering goes to a canvas because a 50 000-node graph must never become 50 000
 * DOM elements; the visible set is capped and the cap is reported rather than hidden.
 */
import type {
  Page,
  RelationGraphCompleteness,
  RelationGraphEdge as SourceGraphEdge,
  RelationGraphNode as SourceGraphNode,
  RelationGraphSource,
  RelationGraphTypeBucket as SourceGraphTypeBucket,
  ViewerModule,
} from '@modkit/sdk'
import { setPart, setState } from '../parts.js'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  safeViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'
import { type UiLocalizer } from '../localization/index.js'
import { GRAPH_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'
import { createOrbitController } from '../model/orbit.js'
import {
  depthFade,
  frame,
  hash,
  layoutRelationGraph,
  pick as pickNode,
  project,
  unproject,
  type Camera,
  type Framing,
  type Hit,
  type Vec3,
} from './projection.js'

export type GraphNode = SourceGraphNode
export type GraphEdge = SourceGraphEdge
export type GraphTypeBucket = SourceGraphTypeBucket

export interface GraphFooterGroup {
  readonly id: string
  readonly title: string
  readonly items: readonly { readonly label: string; readonly count: number }[]
}

import type {
  GraphRenderState,
  GraphRenderer,
  GraphRendererFactory,
} from '@modkit/scene/relations/contracts'
export type {
  GraphRenderState,
  GraphRenderer,
  GraphRendererFactory,
} from '@modkit/scene/relations/contracts'

export interface RelationGraphOptions {
  readonly localizer?: UiLocalizer
  readonly label: string
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  readonly types: readonly GraphTypeBucket[]
  readonly totalNodes?: number
  readonly totalEdges?: number
  /** Producer completeness is independent from this component's visible-node cap. */
  readonly sourceCompleteness?: RelationGraphCompleteness
  readonly sourceReason?: string
  /** Completeness of the bounded snapshot materialized by this consumer. */
  readonly consumerCompleteness?: RelationGraphCompleteness
  readonly consumerReason?: string
  readonly footer?: readonly GraphFooterGroup[]
  /** Maximum nodes drawn at once. Beyond this the view reports itself as capped. */
  readonly cap?: number
  /** Extra renderers offered in the controls; the built-in 2D canvas is always present. */
  readonly renderers?: readonly GraphRendererFactory[]
  onOpen?(node: GraphNode): void
}

export interface RelationGraphLoadOptions {
  readonly localizer?: UiLocalizer
  readonly label: string
  readonly nodeLimit?: number
  readonly edgeLimit?: number
  readonly pageSize?: number
  readonly signal?: AbortSignal
}

function positiveLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be positive`)
  return value
}

async function loadPages<T>(
  read: (cursor: string | undefined, limit: number) => Promise<Page<T>>,
  maximum: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<{
  readonly items: readonly T[]
  readonly completeness: 'complete' | 'capped'
}> {
  const items: T[] = []
  let cursor: string | undefined
  const seen = new Set<string>()
  while (items.length < maximum) {
    signal?.throwIfAborted()
    const remaining = maximum - items.length
    const requested = Math.min(pageSize, remaining)
    const page = await read(cursor, requested)
    signal?.throwIfAborted()
    items.push(...page.items.slice(0, requested))
    if (page.items.length > requested) {
      return { items: Object.freeze(items), completeness: 'capped' }
    }
    if (page.nextCursor === undefined) {
      return { items: Object.freeze(items), completeness: 'complete' }
    }
    if (page.items.length === 0) {
      throw new Error('relation graph source returned an empty page with a continuation cursor')
    }
    if (seen.has(page.nextCursor)) throw new Error('relation graph source repeated a page cursor')
    seen.add(page.nextCursor)
    cursor = page.nextCursor
  }
  return { items: Object.freeze(items), completeness: 'capped' }
}

function loadedCountReason(
  nodeCount: number,
  totalNodes: number,
  edgeCount: number,
  totalEdges: number,
  localizer: UiLocalizer,
): string {
  return localizer.text('graph.loadedCounts', {
    nodes: nodeCount.toLocaleString(localizer.locale),
    totalNodes: totalNodes.toLocaleString(localizer.locale),
    edges: edgeCount.toLocaleString(localizer.locale),
    totalEdges: totalEdges.toLocaleString(localizer.locale),
  })
}

/** Host-side adapter: codecs publish facts; the UI decides how many pages to materialize. */
export async function loadRelationGraphOptions(
  source: RelationGraphSource,
  options: RelationGraphLoadOptions,
): Promise<RelationGraphOptions> {
  const localizer = withEnglishUiFallback(options.localizer, GRAPH_FALLBACK_MESSAGES)
  const nodeLimit = positiveLimit(options.nodeLimit ?? 500, 'nodeLimit')
  const edgeLimit = positiveLimit(options.edgeLimit ?? 5_000, 'edgeLimit')
  const pageSize = positiveLimit(options.pageSize ?? 250, 'pageSize')
  options.signal?.throwIfAborted()
  const summary = await source.summary(options.signal)
  options.signal?.throwIfAborted()
  const [nodeLoad, edgeLoad] = await Promise.all([
    loadPages(
      (cursor, limit) =>
        source.nodes({ ...(cursor === undefined ? {} : { cursor }), limit }, options.signal),
      nodeLimit,
      pageSize,
      options.signal,
    ),
    loadPages(
      (cursor, limit) =>
        source.edges({ ...(cursor === undefined ? {} : { cursor }), limit }, options.signal),
      edgeLimit,
      pageSize,
      options.signal,
    ),
  ])
  options.signal?.throwIfAborted()
  const consumerCapped =
    nodeLoad.completeness === 'capped' ||
    edgeLoad.completeness === 'capped' ||
    (nodeLoad.items.length >= nodeLimit && nodeLoad.items.length < summary.totalNodes) ||
    (edgeLoad.items.length >= edgeLimit && edgeLoad.items.length < summary.totalEdges)
  const consumerPartial =
    !consumerCapped &&
    (nodeLoad.items.length < summary.totalNodes || edgeLoad.items.length < summary.totalEdges)
  const consumerCompleteness: RelationGraphCompleteness = consumerCapped
    ? 'capped'
    : consumerPartial
      ? 'partial'
      : 'complete'
  return {
    label: options.label,
    localizer,
    nodes: nodeLoad.items,
    edges: edgeLoad.items,
    types: summary.types,
    totalNodes: summary.totalNodes,
    totalEdges: summary.totalEdges,
    sourceCompleteness: summary.completeness,
    ...(summary.reason === undefined ? {} : { sourceReason: summary.reason }),
    consumerCompleteness,
    ...(consumerCompleteness === 'complete'
      ? {}
      : {
          consumerReason: loadedCountReason(
            nodeLoad.items.length,
            summary.totalNodes,
            edgeLoad.items.length,
            summary.totalEdges,
            localizer,
          ),
        }),
    cap: nodeLimit,
  }
}

export interface RelationGraph {
  readonly root: HTMLElement
  resize(): void
  destroy(): void
}

interface Placed {
  readonly node: GraphNode
  x: number
  y: number
  vx: number
  vy: number
}

const CATEGORICAL = 6
const RENDERER_3D = 'canvas-3d'
const RENDERER_2D = 'canvas-2d'
/** MK2 `LABEL_LIMIT`. */
const LABEL_LIMIT = 100
const FOCUS_MS = 250

export function createRelationGraph(
  document: Document,
  options: RelationGraphOptions,
): RelationGraph {
  const localizer = withEnglishUiFallback(options.localizer, GRAPH_FALLBACK_MESSAGES)
  const cap = options.cap ?? 500
  const root = document.createElement('div')
  root.className = 'modkit-graph'
  root.setAttribute('aria-label', options.label)
  setPart(root, 'graph')

  // ---------------------------------------------------------------- sidebar
  const sidebar = document.createElement('aside')
  sidebar.className = 'modkit-graph__sidebar'
  setPart(sidebar, 'graph.sidebar')

  const sidebarHead = document.createElement('div')
  sidebarHead.className = 'modkit-graph__sidebar-head'
  setPart(sidebarHead, 'graph.sidebar-head')
  const heading = document.createElement('span')
  heading.textContent = localizer.text('graph.nodeTypes')
  sidebarHead.append(heading)
  for (const [label, all] of [
    [localizer.text('graph.all'), true],
    [localizer.text('graph.none'), false],
  ] as const) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.addEventListener('click', () => {
      for (const id of hidden.keys()) hidden.set(id, !all)
      syncTypes()
      relayout()
    })
    sidebarHead.append(button)
  }
  sidebar.append(sidebarHead)

  const filter = document.createElement('input')
  filter.type = 'search'
  filter.placeholder = localizer.text('graph.filterClasses')
  filter.setAttribute('aria-label', localizer.text('graph.filterNodeTypes'))
  filter.className = 'modkit-graph__filter'
  sidebar.append(filter)

  const typeList = document.createElement('div')
  typeList.className = 'modkit-graph__types'
  typeList.setAttribute('role', 'group')
  setPart(typeList, 'graph.types')
  sidebar.append(typeList)

  const hidden = new Map<string, boolean>(options.types.map(type => [type.id, false]))
  const typeRows = new Map<string, HTMLElement>()
  const typeById = new Map(options.types.map(type => [type.id, type]))

  for (const type of options.types) {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'modkit-graph__type'
    row.dataset['tone'] = String(type.tone % CATEGORICAL)
    setPart(row, 'graph.type')

    const swatch = document.createElement('span')
    swatch.setAttribute('aria-hidden', 'true')
    setPart(swatch, 'graph.type-swatch')
    const label = document.createElement('span')
    label.textContent = safeViewerText(type.label, 64)
    const count = document.createElement('span')
    count.textContent = String(type.count)
    setPart(count, 'graph.type-count')

    row.append(swatch, label, count)
    row.addEventListener('click', () => {
      hidden.set(type.id, !(hidden.get(type.id) ?? false))
      syncTypes()
      relayout()
    })
    typeList.append(row)
    typeRows.set(type.id, row)
  }

  filter.addEventListener('input', () => {
    const needle = filter.value.trim().toLowerCase()
    for (const type of options.types) {
      const row = typeRows.get(type.id)
      if (row !== undefined)
        row.hidden = needle !== '' && !type.label.toLowerCase().includes(needle)
    }
  })

  const syncTypes = (): void => {
    for (const [id, row] of typeRows) {
      const off = hidden.get(id) ?? false
      row.setAttribute('aria-pressed', String(!off))
      setState(row, off ? ['disabled'] : ['active'])
    }
  }

  // Keyboard route to every drawn node: a native listbox, Enter opens the selection.
  const nodeList = document.createElement('select')
  nodeList.size = 8
  nodeList.className = 'modkit-graph__node-list'
  nodeList.setAttribute('aria-label', localizer.text('graph.nodeList'))
  setPart(nodeList, 'graph.node-list')
  sidebar.append(nodeList)

  // ---------------------------------------------------------------- main
  const main = document.createElement('div')
  main.className = 'modkit-graph__main'
  setPart(main, 'graph.main')

  const controls = document.createElement('div')
  controls.className = 'modkit-graph__controls'
  controls.setAttribute('role', 'toolbar')
  controls.setAttribute('aria-label', localizer.text('graph.controls'))
  setPart(controls, 'graph.controls')

  const status = document.createElement('output')
  status.className = 'modkit-graph__status'
  setPart(status, 'graph.status')
  controls.append(status)

  const search = document.createElement('input')
  search.type = 'search'
  search.className = 'modkit-graph__search'
  search.placeholder = localizer.text('graph.search')
  search.setAttribute('aria-label', localizer.text('graph.searchLabel'))
  setPart(search, 'graph.search')
  controls.append(search)

  const control = (
    labelText: string,
    values: readonly string[],
    value: string,
  ): HTMLSelectElement => {
    const wrapper = document.createElement('label')
    wrapper.className = 'modkit-graph__control'
    setPart(wrapper, 'graph.control')
    wrapper.append(document.createTextNode(labelText))
    const select = document.createElement('select')
    for (const item of values) {
      const option = document.createElement('option')
      option.value = item
      option.textContent = item
      select.append(option)
    }
    select.value = value
    wrapper.append(select)
    controls.append(wrapper)
    return select
  }

  const labelsWrapper = document.createElement('label')
  labelsWrapper.className = 'modkit-graph__control'
  setPart(labelsWrapper, 'graph.control')
  const labels = document.createElement('input')
  labels.type = 'checkbox'
  labels.checked = true
  labelsWrapper.append(labels, document.createTextNode(localizer.text('graph.labels')))
  controls.append(labelsWrapper)

  const nodeChoices = [...new Set([100, 250, 500, 1_000, cap])]
    .sort((left, right) => left - right)
    .map(String)
  const nodesCap = control(localizer.text('graph.nodes'), nodeChoices, String(cap))

  const roles = [...new Set(options.edges.flatMap(edge => (edge.role ? [edge.role] : [])))].sort()
  const roleSelect =
    roles.length === 0
      ? undefined
      : control(
          localizer.text('graph.relations'),
          [localizer.text('graph.allRelations'), ...roles],
          localizer.text('graph.allRelations'),
        )
  const roleShown = (edge: GraphEdge): boolean =>
    roleSelect === undefined ||
    roleSelect.selectedIndex <= 0 ||
    edge.role === roles[roleSelect.selectedIndex - 1]

  const rendererIds = [RENDERER_3D, RENDERER_2D, ...(options.renderers ?? []).map(item => item.id)]
  const rendererSelect = control(
    localizer.text('graph.renderer'),
    [
      localizer.text('graph.canvas3d'),
      localizer.text('graph.canvas2d'),
      ...(options.renderers ?? []).map(item => item.label),
    ],
    localizer.text('graph.canvas3d'),
  )
  let mode: string = RENDERER_3D

  const reset = document.createElement('button')
  reset.type = 'button'
  reset.textContent = localizer.text('graph.resetView')
  reset.addEventListener('click', () => {
    if (external !== undefined) {
      external.reset()
      return
    }
    layout()
    draw()
  })
  controls.append(reset)

  const stage = document.createElement('div')
  stage.className = 'modkit-graph__stage'

  const canvas = document.createElement('canvas')
  canvas.className = 'modkit-graph__canvas'
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', options.label)
  canvas.tabIndex = 0
  setPart(canvas, 'graph.canvas')

  const tooltip = document.createElement('div')
  tooltip.className = 'modkit-graph__tooltip'
  tooltip.hidden = true
  setPart(tooltip, 'graph.tooltip')
  stage.append(canvas, tooltip)

  const hint = document.createElement('p')
  hint.className = 'modkit-graph__hint'
  setPart(hint, 'graph.hint')
  const syncHint = (): void => {
    const open = options.onOpen !== undefined
    hint.textContent = localizer.text(
      mode === RENDERER_2D
        ? open
          ? 'graph.hintOpen'
          : 'graph.hint'
        : open
          ? 'graph.hint3dOpen'
          : 'graph.hint3d',
    )
  }
  syncHint()

  main.append(controls, stage, hint)

  // ---------------------------------------------------------------- footer
  const footer = document.createElement('div')
  footer.className = 'modkit-graph__footer'
  setPart(footer, 'graph.footer')
  for (const group of options.footer ?? []) {
    const box = document.createElement('section')
    box.className = 'modkit-graph__footer-group'
    setPart(box, 'graph.footer-group')
    const title = document.createElement('h4')
    title.textContent = safeViewerText(group.title, 64)
    box.append(title)
    for (const item of group.items) {
      const row = document.createElement('div')
      row.className = 'modkit-graph__footer-item'
      setPart(row, 'graph.footer-item')
      row.textContent = `${safeViewerText(item.label, 64)} (${item.count})`
      box.append(row)
    }
    footer.append(box)
  }

  root.append(sidebar, main, footer)

  // ---------------------------------------------------------------- layout and paint
  const context = canvas.getContext('2d')
  const view = document.defaultView
  const reducedMotion = (): boolean =>
    view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  let placed: Placed[] = []
  let zoom = 1
  let originX = 0
  let originY = 0
  let dragging: Placed | undefined
  let panning = false
  let last = { x: 0, y: 0 }

  // 3D state: world positions (MK2 layout), orbit camera, pan/focus target.
  const orbit = createOrbitController()
  let world: Vec3[] = []
  let worldKey = ''
  let framing: Framing = frame([])
  let target: Vec3 = [0, 0, 0]
  let hits: (Hit | undefined)[] = []
  let hovered = -1
  let selected = -1
  let animation = 0
  const degree = new Map<string, number>()
  for (const edge of options.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
  }
  const rootId = options.nodes[0]?.id

  const visibleNodes = (): GraphNode[] => {
    const limit = Number(nodesCap.value)
    return options.nodes.filter(node => !(hidden.get(node.type) ?? false)).slice(0, limit)
  }

  const completenessNotice = (
    owner: 'source' | 'view',
    completeness: RelationGraphCompleteness | undefined,
    reason: string | undefined,
  ): string | undefined => {
    if (completeness === undefined || (completeness === 'complete' && reason === undefined)) {
      return undefined
    }
    const state =
      completeness === undefined || completeness === 'complete' ? '' : ` ${completeness}`
    const explanation = reason === undefined ? '' : `: ${safeViewerText(reason, 240)}`
    return localizer.text('graph.completeness', {
      owner: localizer.text(owner === 'source' ? 'graph.source' : 'graph.view'),
      state,
      reason: explanation,
    })
  }

  const matches = (node: GraphNode): boolean | undefined => {
    const needle = search.value.trim().toLowerCase()
    if (needle === '') return undefined
    return node.label.toLowerCase().includes(needle) || node.id.toLowerCase().includes(needle)
  }

  const statusText = (drawnEdges: number, renderer?: string): string => {
    const totalNodes = options.totalNodes ?? options.nodes.length
    const visibleCandidates = options.nodes.filter(node => !(hidden.get(node.type) ?? false))
    const notices = [
      completenessNotice('source', options.sourceCompleteness, options.sourceReason),
      completenessNotice('view', options.consumerCompleteness, options.consumerReason),
      ...(placed.length < visibleCandidates.length
        ? [
            localizer.text('graph.visibleCapped', {
              count: placed.length.toLocaleString(localizer.locale),
            }),
          ]
        : []),
    ].filter((item): item is string => item !== undefined)
    const matched =
      search.value.trim() === ''
        ? undefined
        : localizer.text('graph.matches', {
            count: placed
              .filter(item => matches(item.node))
              .length.toLocaleString(localizer.locale),
          })
    return [
      localizer.text('graph.nodeCount', {
        visible: placed.length.toLocaleString(localizer.locale),
        total: totalNodes.toLocaleString(localizer.locale),
      }),
      localizer.text('graph.edgeCount', {
        count: drawnEdges.toLocaleString(localizer.locale),
      }),
      matched,
      renderer,
      ...notices,
    ]
      .filter((item): item is string => item !== undefined)
      .join(' · ')
  }

  const syncNodeList = (): void => {
    nodeList.replaceChildren(
      ...placed.map((item, index) => {
        const option = document.createElement('option')
        option.value = String(index)
        option.textContent = safeViewerText(item.node.label, 64)
        return option
      }),
    )
    nodeList.selectedIndex = selected
  }

  function layout(): void {
    const nodes = visibleNodes()
    const radius = Math.min(canvas.width, canvas.height) / 2.6
    placed = nodes.map((node, index) => {
      const angle = (index / Math.max(1, nodes.length)) * Math.PI * 2
      // Golden-ratio radial scatter keeps a readable ring without running a full simulation.
      const spread = radius * (0.35 + 0.65 * ((index * 0.618_033_988_75) % 1))
      return {
        node,
        x: Math.cos(angle) * spread,
        y: Math.sin(angle) * spread,
        vx: 0,
        vy: 0,
      }
    })
    zoom = 1
    originX = 0
    originY = 0
    // The force pass is O(n²·150); only rerun it when the visible set changes.
    const key = nodes.map(node => node.id).join('\n')
    if (key !== worldKey) {
      worldKey = key
      world = layoutRelationGraph({
        nodes,
        edges: options.edges,
        ...(rootId === undefined ? {} : { root: rootId }),
      })
      selected = -1
    }
    framing = frame(world)
    target = [...framing.center]
    orbit.reset()
    hovered = -1
    tooltip.hidden = true
    syncNodeList()
  }

  const relayout = (): void => {
    layout()
    draw()
  }

  const tokens = () => {
    const styles = getComputedStyle(root)
    return (name: string, fallback: string): string =>
      styles.getPropertyValue(name).trim() || fallback
  }

  const toneOf = (node: GraphNode): number =>
    ((typeById.get(node.type)?.tone ?? 0) % CATEGORICAL) + 1

  const edgeColour = (token: (name: string, fallback: string) => string, edge: GraphEdge) =>
    edge.dead === true
      ? token('--mk-color-graph-edge-dead', '#f14c4c')
      : edge.role === undefined
        ? token('--mk-color-graph-edge', '#5a5a5a')
        : token(`--mk-chart-categorical-${(hash(edge.role) % CATEGORICAL) + 1}`, '#5a5a5a')

  const cameraNow = (): Camera => ({
    target,
    eye: orbit.position(target, framing.distance),
    basis: orbit.basis(),
    width: canvas.width,
    height: canvas.height,
  })

  function draw(): void {
    if (context === null) {
      status.textContent = statusText(0)
      return
    }
    if (mode === RENDERER_3D) draw3d(context)
    else draw2d(context)
  }

  function draw2d(context: CanvasRenderingContext2D): void {
    const token = tokens()
    const width = canvas.width
    const height = canvas.height
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.fillStyle = token('--mk-color-canvas-bg', '#141414')
    context.fillRect(0, 0, width, height)
    context.translate(width / 2 + originX, height / 2 + originY)
    context.scale(zoom, zoom)

    const index = new Map(placed.map(item => [item.node.id, item]))
    let drawnEdges = 0
    context.lineWidth = 1 / zoom
    for (const edge of options.edges) {
      if (!roleShown(edge)) continue
      const from = index.get(edge.from)
      const to = index.get(edge.to)
      if (from === undefined || to === undefined) continue
      context.strokeStyle = edgeColour(token, edge)
      context.globalAlpha = edge.dead === true ? 0.9 : 0.45
      context.beginPath()
      context.moveTo(from.x, from.y)
      context.lineTo(to.x, to.y)
      context.stroke()
      drawnEdges += 1
    }
    context.globalAlpha = 1

    const showLabels = labels.checked
    placed.forEach((item, position) => {
      const match = matches(item.node)
      context.globalAlpha = match === false ? 0.2 : 1
      context.fillStyle = token(`--mk-chart-categorical-${toneOf(item.node)}`, '#4daafc')
      context.beginPath()
      context.arc(item.x, item.y, 4 / zoom + 1, 0, Math.PI * 2)
      context.fill()
      if (position === selected || match === true) {
        context.strokeStyle = token('--mk-color-focus', '#0078d4')
        context.lineWidth = 2 / zoom
        context.stroke()
        context.lineWidth = 1 / zoom
      }
      if ((showLabels && placed.length <= 120) || position === selected) {
        context.fillStyle = token('--mk-color-fg-muted', '#9d9d9d')
        context.font = `${11 / zoom}px ${token('--mk-font-sans', 'sans-serif')}`
        context.fillText(safeViewerText(item.node.label, 40), item.x + 7 / zoom, item.y + 3 / zoom)
      }
    })
    context.globalAlpha = 1

    status.textContent = statusText(drawnEdges)
  }

  function draw3d(context: CanvasRenderingContext2D): void {
    const token = tokens()
    const width = canvas.width
    const height = canvas.height
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.fillStyle = token('--mk-color-canvas-bg', '#141414')
    context.fillRect(0, 0, width, height)

    const camera = cameraNow()
    const projected = world.map(point => project(point, camera))
    let near = Infinity
    let far = -Infinity
    for (const point of projected) {
      if (point === undefined) continue
      near = Math.min(near, point.depth)
      far = Math.max(far, point.depth)
    }
    const index = new Map(placed.map((item, position) => [item.node.id, position]))
    const selectedId = placed[selected]?.node.id

    let drawnEdges = 0
    context.lineWidth = 1
    for (const edge of options.edges) {
      if (!roleShown(edge)) continue
      const fromIndex = index.get(edge.from)
      const toIndex = index.get(edge.to)
      if (fromIndex === undefined || toIndex === undefined) continue
      const from = projected[fromIndex]
      const to = projected[toIndex]
      if (from === undefined || to === undefined) continue
      const incident =
        selectedId !== undefined && (edge.from === selectedId || edge.to === selectedId)
      const fade = depthFade((from.depth + to.depth) / 2, near, far)
      context.strokeStyle = edgeColour(token, edge)
      context.globalAlpha =
        (edge.dead === true ? 0.9 : 0.45) * fade * (selectedId === undefined || incident ? 1 : 0.35)
      context.lineWidth = incident ? 2 : 1
      context.beginPath()
      context.moveTo(from.x, from.y)
      context.lineTo(to.x, to.y)
      context.stroke()
      drawnEdges += 1
    }

    // Painter's order: far nodes first so near ones overlap them, as depth testing would.
    const order = placed.map((_item, position) => position)
    order.sort((a, b) => (projected[b]?.depth ?? 0) - (projected[a]?.depth ?? 0))
    const showLabels = labels.checked && placed.length <= LABEL_LIMIT
    const font = token('--mk-font-sans', 'sans-serif')
    hits = placed.map(() => undefined)
    for (const position of order) {
      const point = projected[position]
      const item = placed[position]
      if (point === undefined || item === undefined) continue
      const isRoot = item.node.id === rootId
      // MK2 mesh scale: root 9, others 4.5 + log2(degree + 1) capped at +4; the 1.5 factor and the
      // pixel floor stand in for MK2's bloom halo, which kept distant nodes visible.
      const size = isRoot ? 9 : 4.5 + Math.min(4, Math.log2((degree.get(item.node.id) ?? 0) + 1))
      const radius = Math.max(2.5, Math.min(24, size * point.scale * 1.5))
      const match = matches(item.node)
      const fade = depthFade(point.depth, near, far)
      hits[position] = { x: point.x, y: point.y, radius, depth: point.depth }
      context.globalAlpha = fade * (match === false ? 0.2 : 1)
      context.fillStyle = isRoot
        ? token('--mk-color-graph-node', '#cccccc')
        : token(`--mk-chart-categorical-${toneOf(item.node)}`, '#4daafc')
      context.beginPath()
      context.arc(point.x, point.y, radius, 0, Math.PI * 2)
      context.fill()
      const emphasised = position === selected || position === hovered || match === true
      if (emphasised) {
        context.globalAlpha = 1
        context.strokeStyle = token('--mk-color-focus', '#0078d4')
        context.lineWidth = position === selected ? 2.5 : 1.5
        context.stroke()
      }
      if (showLabels || emphasised || isRoot) {
        context.globalAlpha = emphasised ? 1 : fade
        context.fillStyle = token(
          isRoot || emphasised ? '--mk-color-fg' : '--mk-color-fg-muted',
          '#9d9d9d',
        )
        context.font = `${isRoot ? 'bold ' : ''}11px ${font}`
        context.fillText(safeViewerText(item.node.label, 40), point.x + radius + 4, point.y + 4)
      }
    }
    context.globalAlpha = 1
    context.lineWidth = 1
    status.textContent = statusText(drawnEdges)
  }

  orbit.onChange(() => {
    if (mode === RENDERER_3D) draw()
  })

  const pointAt = (event: MouseEvent): { x: number; y: number } => {
    const box = canvas.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }

  const pick2d = (event: MouseEvent): Placed | undefined => {
    const box = canvas.getBoundingClientRect()
    const x = (event.clientX - box.left - canvas.width / 2 - originX) / zoom
    const y = (event.clientY - box.top - canvas.height / 2 - originY) / zoom
    return placed.find(item => Math.hypot(item.x - x, item.y - y) < 8 / zoom)
  }

  const hitIndex = (event: MouseEvent): number => {
    if (mode === RENDERER_2D) {
      const hit = pick2d(event)
      return hit === undefined ? -1 : placed.indexOf(hit)
    }
    const { x, y } = pointAt(event)
    return pickNode(hits, x, y)
  }

  const open = (position: number): void => {
    const item = placed[position]
    if (item !== undefined) options.onOpen?.(item.node)
  }

  /** Select a node and, in 3D, glide the orbit target onto it (instant under reduced motion). */
  const focus = (position: number): void => {
    selected = position
    if (nodeList.selectedIndex !== position) nodeList.selectedIndex = position
    const destination = world[position]
    if (view) view.cancelAnimationFrame(animation)
    if (mode !== RENDERER_3D || destination === undefined || !view || reducedMotion()) {
      if (mode === RENDERER_3D && destination !== undefined) target = [...destination]
      draw()
      return
    }
    const start: Vec3 = [...target]
    const began = view.performance.now()
    const step = (now: number): void => {
      const t = Math.min(1, (now - began) / FOCUS_MS)
      const ease = 1 - (1 - t) ** 3
      target = [
        start[0] + (destination[0] - start[0]) * ease,
        start[1] + (destination[1] - start[1]) * ease,
        start[2] + (destination[2] - start[2]) * ease,
      ]
      draw()
      if (t < 1) animation = view.requestAnimationFrame(step)
    }
    animation = view.requestAnimationFrame(step)
  }

  const showTooltip = (position: number, event: MouseEvent): void => {
    const item = placed[position]
    if (item === undefined) {
      tooltip.hidden = true
      return
    }
    const type = typeById.get(item.node.type)?.label ?? item.node.type
    tooltip.textContent = [item.node.label, type, item.node.kind]
      .filter((part): part is string => part !== undefined && part !== '')
      .map(part => safeViewerText(part, 80))
      .join(' · ')
    const { x, y } = pointAt(event)
    tooltip.style.setProperty('left', `${x + 14}px`)
    tooltip.style.setProperty('top', `${y + 14}px`)
    tooltip.hidden = false
  }

  interface Press {
    readonly index: number
    readonly pan: boolean
    readonly x: number
    readonly y: number
    moved: boolean
  }
  let press: Press | undefined

  canvas.addEventListener('pointerdown', event => {
    canvas.setPointerCapture(event.pointerId)
    last = { x: event.clientX, y: event.clientY }
    if (mode === RENDERER_2D) {
      dragging = pick2d(event)
      panning = dragging === undefined
    }
    press = {
      index: hitIndex(event),
      pan: event.button !== 0 || event.shiftKey,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    }
  })
  canvas.addEventListener('pointermove', event => {
    const dx = event.clientX - last.x
    const dy = event.clientY - last.y
    last = { x: event.clientX, y: event.clientY }
    if (press !== undefined && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 3) {
      press.moved = true
    }
    if (mode === RENDERER_2D) {
      if (dragging === undefined && !panning) return
      if (dragging !== undefined) {
        dragging.x += dx / zoom
        dragging.y += dy / zoom
      } else {
        originX += dx
        originY += dy
      }
      draw()
      return
    }
    if (press === undefined) {
      const next = hitIndex(event)
      canvas.style.setProperty('cursor', next >= 0 ? 'pointer' : '')
      if (next !== hovered) {
        hovered = next
        draw()
      }
      showTooltip(hovered, event)
      return
    }
    if (!press.moved) return
    tooltip.hidden = true
    const camera = cameraNow()
    const node = world[press.index]
    if (node !== undefined) {
      // MK2 dragged nodes on the camera-facing plane through the node.
      const depth = project(node, camera)?.depth ?? framing.distance
      const offset = unproject(dx, dy, depth, camera)
      world[press.index] = [node[0] + offset[0], node[1] + offset[1], node[2] + offset[2]]
      draw()
    } else if (press.pan) {
      const offset = unproject(dx, dy, framing.distance * orbit.pose.distanceScale, camera)
      target = [target[0] - offset[0], target[1] - offset[1], target[2] - offset[2]]
      draw()
    } else {
      orbit.orbit(-dx, dy)
    }
  })
  const release = (event: PointerEvent): void => {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    const clicked = press !== undefined && !press.moved && press.index >= 0
    const index = press?.index ?? -1
    dragging = undefined
    panning = false
    press = undefined
    if (clicked && event.type === 'pointerup') focus(index)
  }
  canvas.addEventListener('pointerup', release)
  canvas.addEventListener('pointercancel', release)
  canvas.addEventListener('pointerleave', () => {
    tooltip.hidden = true
    if (hovered >= 0 && press === undefined) {
      hovered = -1
      draw()
    }
  })
  canvas.addEventListener('contextmenu', event => event.preventDefault())
  canvas.addEventListener(
    'wheel',
    event => {
      event.preventDefault()
      if (mode === RENDERER_3D) {
        orbit.zoom(event.deltaY)
        return
      }
      zoom = Math.max(0.2, Math.min(6, zoom * (event.deltaY < 0 ? 1.12 : 0.89)))
      draw()
    },
    { passive: false },
  )
  canvas.addEventListener('dblclick', event => {
    const index = hitIndex(event)
    if (index >= 0) open(index)
  })
  canvas.addEventListener('keydown', event => {
    const step = event.shiftKey ? 40 : 12
    if (event.key === 'Enter' && selected >= 0) open(selected)
    else if (event.key === 'Escape') {
      selected = -1
      nodeList.selectedIndex = -1
      draw()
    } else if (mode !== RENDERER_3D) return
    else if (event.key === 'ArrowLeft') orbit.orbit(-step, 0)
    else if (event.key === 'ArrowRight') orbit.orbit(step, 0)
    else if (event.key === 'ArrowUp') orbit.orbit(0, -step)
    else if (event.key === 'ArrowDown') orbit.orbit(0, step)
    else if (event.key === '+' || event.key === '=') orbit.zoom(-1)
    else if (event.key === '-') orbit.zoom(1)
    else if (event.key === '0') {
      layout()
      draw()
    } else return
    event.preventDefault()
  })

  nodeList.addEventListener('change', () => focus(nodeList.selectedIndex))
  nodeList.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || nodeList.selectedIndex < 0) return
    event.preventDefault()
    open(nodeList.selectedIndex)
  })
  nodeList.addEventListener('dblclick', () => {
    if (nodeList.selectedIndex >= 0) open(nodeList.selectedIndex)
  })

  search.addEventListener('input', draw)
  search.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return
    const first = placed.findIndex(item => matches(item.node) === true)
    if (first >= 0) focus(first)
  })

  nodesCap.addEventListener('change', relayout)
  roleSelect?.addEventListener('change', draw)
  labels.addEventListener('change', draw)

  // ---------------------------------------------------------------- pluggable renderer
  let external: GraphRenderer | undefined
  const externalHost = document.createElement('div')
  externalHost.className = 'modkit-graph__external'
  externalHost.hidden = true
  setPart(externalHost, 'graph.canvas')
  stage.after(externalHost)

  const paletteSnapshot = (): Record<string, string> => {
    const styles = getComputedStyle(root)
    const read = (name: string) => styles.getPropertyValue(name).trim()
    const palette: Record<string, string> = {
      background: read('--mk-color-canvas-bg') || '#141414',
      edge: read('--mk-color-graph-edge') || '#5a5a5a',
      edgeDead: read('--mk-color-graph-edge-dead') || '#f14c4c',
      label: read('--mk-color-fg-muted') || '#9d9d9d',
    }
    for (let index = 1; index <= CATEGORICAL; index += 1) {
      palette[`categorical-${index}`] = read(`--mk-chart-categorical-${index}`) || '#4daafc'
    }
    return palette
  }

  const externalState = (): GraphRenderState => ({
    nodes: placed.map(item => item.node),
    edges: options.edges.filter(roleShown),
    types: options.types,
    labels: labels.checked,
    palette: paletteSnapshot(),
  })

  const selectRenderer = (): void => {
    const index = rendererSelect.selectedIndex
    const id = rendererIds[index] ?? RENDERER_3D
    external?.destroy()
    external = undefined
    mode = id
    syncHint()
    tooltip.hidden = true
    if (id === RENDERER_3D || id === RENDERER_2D) {
      stage.hidden = false
      externalHost.hidden = true
      resize()
      return
    }
    const factory = (options.renderers ?? []).find(item => item.id === id)
    if (factory === undefined) return
    stage.hidden = true
    externalHost.hidden = false
    const hooks = options.onOpen === undefined ? {} : { onOpen: options.onOpen }
    external = factory.create(externalHost, hooks)
    const box = externalHost.getBoundingClientRect()
    external.resize(Math.max(240, Math.round(box.width)), Math.max(200, Math.round(box.height)))
    external.render(externalState())
    const drawn = external.drawnEdges?.() ?? options.edges.length
    status.textContent = statusText(drawn, factory.label)
  }

  rendererSelect.addEventListener('change', selectRenderer)

  const resize = (): void => {
    if (external !== undefined) {
      const box = externalHost.getBoundingClientRect()
      external.resize(Math.max(240, Math.round(box.width)), Math.max(200, Math.round(box.height)))
      external.render(externalState())
      return
    }
    const box = canvas.getBoundingClientRect()
    canvas.width = Math.max(240, Math.round(box.width))
    canvas.height = Math.max(200, Math.round(box.height))
    layout()
    draw()
  }

  syncTypes()
  queueMicrotask(resize)

  return {
    root,
    resize,
    destroy() {
      if (view) view.cancelAnimationFrame(animation)
      external?.destroy()
      root.remove()
    },
  }
}

/** Standard stage adapter over the selected relation-graph data-source binding. */
export interface RelationGraphViewerOptions {
  readonly localizer?: UiLocalizer
}

export function createRelationGraphViewer(options: RelationGraphViewerOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, GRAPH_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('graph.viewer'))
      try {
        const lease = await unknownSourceLease(
          args.sources,
          args.slot,
          'common.view/relation-graph-source',
        )
        if (lease === undefined) throw new TypeError('relation graph binding is unavailable')
        scope.lease(lease)
        const options = await loadRelationGraphOptions(lease.value as RelationGraphSource, {
          label: localizer.text('graph.relation'),
          localizer,
          signal: scope.signal,
        })
        const navigation = args.subjectNavigation
        const graph = createRelationGraph(root.ownerDocument, {
          ...options,
          ...(navigation === undefined
            ? {}
            : {
                onOpen(node: GraphNode) {
                  if (node.subject === undefined) return
                  void navigation
                    .open({ scope: navigation.scope, target: node.subject }, scope.signal)
                    .catch(() => undefined)
                },
              }),
        })
        root.append(graph.root)
        scope.cleanup(() => graph.destroy())
        root.dataset['revision'] = args.descriptor.revision
        return createViewerMount(root, scope, args, ({ descriptor }) => {
          root.dataset['revision'] = descriptor.revision
        })
      } catch (error) {
        await scope.close()
        root.remove()
        throw error
      }
    },
  })
}

export const relationGraphViewer: ViewerModule = createRelationGraphViewer()

export default relationGraphViewer
