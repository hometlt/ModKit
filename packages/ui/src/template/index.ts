import {
  GAME_TEMPLATE_PREVIEW_OPERATION_ID,
  isGameTemplatePreviewResult,
  type GameTemplatePreviewResult,
} from '@modkitx-x3/sdk/templates'
import type { JsonValue, ViewerModule } from '@modkitx-x3/sdk'
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

  const items = element(host, 'ol', {
    className: 'modkit-template__items',
    part: 'tree.list',
  }) as HTMLOListElement
  const visible = preview.displayItems.slice(0, MAXIMUM_DISPLAY_ITEMS)
  for (const item of visible) {
    const row = document.createElement('li')
    row.className = 'modkit-template__item'
    row.setAttribute('data-mk-part', 'tree.item')
    row.textContent = jsonText(item, 4_096)
    items.append(row)
  }
  if (visible.length === 0) {
    element(items, 'li', { text: localizer.text('viewer.noDisplayItems'), part: 'viewer.empty' })
  } else if (visible.length < preview.displayItems.length) {
    element(items, 'li', {
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
