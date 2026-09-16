import {
  GAME_TEMPLATE_PREVIEW_OPERATION_ID,
  gameTemplateTextRuns,
  isGameTemplateDisplayItem,
  isGameTemplatePreviewResult,
  type GameTemplateDisplayItem,
  type GameTemplatePreviewResult,
} from '@modkit/sdk/templates'
import type { JsonValue, ViewerModule } from '@modkit/sdk'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  invokeOperation,
  safeViewerText,
  ViewerMountScope,
} from '../viewer/index.js'
import { type UiLocalizationOptions, type UiLocalizer } from '../localization/index.js'
import { TEMPLATE_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

const MAXIMUM_DISPLAY_ITEMS = 500
const MAXIMUM_TREE_TEXT = 200_000

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
): void {
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
  canvas.setAttribute('data-mk-part', 'viewer.canvas')
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
    const fontSize = Math.max(MINIMUM_LABEL_SIZE, Math.min(24, item.rect.height * 0.6))
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
}

/** Render the common semantic template envelope without assuming one game's template format. */
export function renderGameTemplatePreview(
  document: Document,
  host: HTMLElement,
  preview: GameTemplatePreviewResult,
  localizer: UiLocalizer = withEnglishUiFallback(undefined, TEMPLATE_FALLBACK_MESSAGES),
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

  if (drawable.length > 0) drawTemplateItems(document, host, drawable)

  if (rest.length > 0 || drawable.length === 0) {
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

  const details = document.createElement('details')
  details.className = 'modkit-template__details'
  const summary = document.createElement('summary')
  summary.textContent = localizer.text('viewer.resolvedSemanticTree')
  const tree = document.createElement('pre')
  tree.setAttribute('data-mk-part', 'text')
  tree.textContent = jsonText(preview.resolvedTree)
  details.append(summary, tree)
  host.append(details)

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

/** Standard operation-backed stage shared by publisher-defined document templates. */
export function createGameTemplateViewer(options: UiLocalizationOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, TEMPLATE_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.gameTemplate'))
      let renderRevision = 0
      const render = async (descriptor: typeof args.descriptor): Promise<void> => {
        const revision = ++renderRevision
        root.replaceChildren()
        element(root, 'output', {
          text: localizer.text('viewer.loadingTemplate'),
          part: 'viewer.status',
        })
        const result = await invokeOperation(
          descriptor,
          args.operations,
          GAME_TEMPLATE_PREVIEW_OPERATION_ID,
          {},
          { signal: scope.signal },
        )
        if (scope.signal.aborted || revision !== renderRevision) return
        if (result.state !== 'ok') {
          root.replaceChildren()
          element(root, 'output', {
            text: localizer.text('viewer.templateUnavailable', { reason: result.reason }),
            part: 'viewer.status',
          })
          return
        }
        if (result.output.kind !== 'json' || !isGameTemplatePreviewResult(result.output.value)) {
          throw new TypeError('view.template returned an invalid game-template-preview result')
        }
        renderGameTemplatePreview(root.ownerDocument, root, result.output.value, localizer)
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
