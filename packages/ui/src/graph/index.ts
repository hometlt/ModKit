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

export type GraphNode = SourceGraphNode
export type GraphEdge = SourceGraphEdge
export type GraphTypeBucket = SourceGraphTypeBucket

export interface GraphFooterGroup {
  readonly id: string
  readonly title: string
  readonly items: readonly { readonly label: string; readonly count: number }[]
}

/**
 * A graph renderer owns only pixels. The sidebar, controls and footer stay in the component, so a
 * GPU backend is a drop-in replacement rather than a second widget (doc 06 §19: alternative
 * backends are provider offers of one render contract, not hardcoded imports).
 */
export interface GraphRenderState {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  readonly types: readonly GraphTypeBucket[]
  readonly labels: boolean
  /** Resolved from the host theme so a renderer never hardcodes colour. */
  readonly palette: Readonly<Record<string, string>>
}

export interface GraphRenderer {
  /** Draw or redraw. Called on state change, resize and theme change. */
  render(state: GraphRenderState): void
  resize(width: number, height: number): void
  /** Reset camera/zoom to the default framing. */
  reset(): void
  destroy(): void
  /** Reported back into the status line; a renderer that caps must say so. */
  drawnEdges?(): number
}

export interface GraphRendererFactory {
  readonly id: string
  readonly label: string
  create(host: HTMLElement, hooks: { onOpen?(node: GraphNode): void }): GraphRenderer
}

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
      draw()
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
      draw()
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

  const rendererIds = ['canvas-2d', ...(options.renderers ?? []).map(item => item.id)]
  const rendererSelect = control(
    localizer.text('graph.renderer'),
    [localizer.text('graph.canvas2d'), ...(options.renderers ?? []).map(item => item.label)],
    localizer.text('graph.canvas2d'),
  )

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

  const canvas = document.createElement('canvas')
  canvas.className = 'modkit-graph__canvas'
  canvas.setAttribute('role', 'img')
  canvas.tabIndex = 0
  setPart(canvas, 'graph.canvas')

  const hint = document.createElement('p')
  hint.className = 'modkit-graph__hint'
  hint.textContent = localizer.text(options.onOpen === undefined ? 'graph.hint' : 'graph.hintOpen')
  setPart(hint, 'graph.hint')

  main.append(controls, canvas, hint)

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
  let placed: Placed[] = []
  let zoom = 1
  let originX = 0
  let originY = 0
  let dragging: Placed | undefined
  let panning = false
  let last = { x: 0, y: 0 }

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
    return [
      localizer.text('graph.nodeCount', {
        visible: placed.length.toLocaleString(localizer.locale),
        total: totalNodes.toLocaleString(localizer.locale),
      }),
      localizer.text('graph.edgeCount', {
        count: drawnEdges.toLocaleString(localizer.locale),
      }),
      renderer,
      ...notices,
    ]
      .filter((item): item is string => item !== undefined)
      .join(' · ')
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
  }

  function draw(): void {
    if (context === null) {
      status.textContent = statusText(0)
      return
    }
    const styles = getComputedStyle(root)
    const token = (name: string, fallback: string): string =>
      styles.getPropertyValue(name).trim() || fallback
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
      const from = index.get(edge.from)
      const to = index.get(edge.to)
      if (from === undefined || to === undefined) continue
      context.strokeStyle =
        edge.dead === true
          ? token('--mk-color-graph-edge-dead', '#f14c4c')
          : token('--mk-color-graph-edge', '#5a5a5a')
      context.globalAlpha = edge.dead === true ? 0.9 : 0.45
      context.beginPath()
      context.moveTo(from.x, from.y)
      context.lineTo(to.x, to.y)
      context.stroke()
      drawnEdges += 1
    }
    context.globalAlpha = 1

    const showLabels = labels.checked
    for (const item of placed) {
      const bucket = options.types.find(type => type.id === item.node.type)
      const tone = ((bucket?.tone ?? 0) % CATEGORICAL) + 1
      context.fillStyle = token(`--mk-chart-categorical-${tone}`, '#4daafc')
      context.beginPath()
      context.arc(item.x, item.y, 4 / zoom + 1, 0, Math.PI * 2)
      context.fill()
      if (showLabels && placed.length <= 120) {
        context.fillStyle = token('--mk-color-fg-muted', '#9d9d9d')
        context.font = `${11 / zoom}px ${token('--mk-font-sans', 'sans-serif')}`
        context.fillText(safeViewerText(item.node.label, 40), item.x + 7 / zoom, item.y + 3 / zoom)
      }
    }

    status.textContent = statusText(drawnEdges)
  }

  const pick = (event: PointerEvent): Placed | undefined => {
    const box = canvas.getBoundingClientRect()
    const x = (event.clientX - box.left - canvas.width / 2 - originX) / zoom
    const y = (event.clientY - box.top - canvas.height / 2 - originY) / zoom
    return placed.find(item => Math.hypot(item.x - x, item.y - y) < 8 / zoom)
  }

  canvas.addEventListener('pointerdown', event => {
    canvas.setPointerCapture(event.pointerId)
    dragging = pick(event)
    panning = dragging === undefined
    last = { x: event.clientX, y: event.clientY }
  })
  canvas.addEventListener('pointermove', event => {
    if (dragging === undefined && !panning) return
    const dx = event.clientX - last.x
    const dy = event.clientY - last.y
    last = { x: event.clientX, y: event.clientY }
    if (dragging !== undefined) {
      dragging.x += dx / zoom
      dragging.y += dy / zoom
    } else {
      originX += dx
      originY += dy
    }
    draw()
  })
  const release = (event: PointerEvent): void => {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    dragging = undefined
    panning = false
  }
  canvas.addEventListener('pointerup', release)
  canvas.addEventListener('pointercancel', release)
  canvas.addEventListener('wheel', event => {
    event.preventDefault()
    zoom = Math.max(0.2, Math.min(6, zoom * (event.deltaY < 0 ? 1.12 : 0.89)))
    draw()
  })
  if (options.onOpen !== undefined) {
    canvas.addEventListener('dblclick', event => {
      const box = canvas.getBoundingClientRect()
      const x = (event.clientX - box.left - canvas.width / 2 - originX) / zoom
      const y = (event.clientY - box.top - canvas.height / 2 - originY) / zoom
      const hit = placed.find(item => Math.hypot(item.x - x, item.y - y) < 8 / zoom)
      if (hit !== undefined) options.onOpen?.(hit.node)
    })
  }

  for (const input of [nodesCap]) {
    input.addEventListener('change', () => {
      layout()
      draw()
    })
  }
  labels.addEventListener('change', draw)

  // ---------------------------------------------------------------- pluggable renderer
  let external: GraphRenderer | undefined
  const externalHost = document.createElement('div')
  externalHost.className = 'modkit-graph__external'
  externalHost.hidden = true
  setPart(externalHost, 'graph.canvas')
  canvas.after(externalHost)

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
    edges: options.edges,
    types: options.types,
    labels: labels.checked,
    palette: paletteSnapshot(),
  })

  const selectRenderer = (): void => {
    const index = rendererSelect.selectedIndex
    const id = rendererIds[index] ?? 'canvas-2d'
    external?.destroy()
    external = undefined
    if (id === 'canvas-2d') {
      canvas.hidden = false
      externalHost.hidden = true
      resize()
      return
    }
    const factory = (options.renderers ?? []).find(item => item.id === id)
    if (factory === undefined) return
    canvas.hidden = true
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
        const graph = createRelationGraph(root.ownerDocument, options)
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
