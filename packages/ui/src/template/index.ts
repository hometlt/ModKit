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
      text: `${preview.fidelity.unsupported.length} named remainder`,
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
    element(items, 'li', { text: 'No display items.', part: 'viewer.empty' })
  } else if (visible.length < preview.displayItems.length) {
    element(items, 'li', {
      text: `Display capped at ${MAXIMUM_DISPLAY_ITEMS} of ${preview.displayItems.length} items.`,
      part: 'viewer.status',
    })
  }

  const details = document.createElement('details')
  details.className = 'modkit-template__details'
  const summary = document.createElement('summary')
  summary.textContent = 'Resolved semantic tree'
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

/** Standard operation-backed stage shared by SC2 layouts and Warzone research templates. */
export const gameTemplateViewer: ViewerModule = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'Game template')
    let renderRevision = 0
    const render = async (descriptor: typeof args.descriptor): Promise<void> => {
      const revision = ++renderRevision
      root.replaceChildren()
      element(root, 'output', { text: 'Loading template…', part: 'viewer.status' })
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
          text: `Template unavailable: ${result.reason}`,
          part: 'viewer.status',
        })
        return
      }
      if (result.output.kind !== 'json' || !isGameTemplatePreviewResult(result.output.value)) {
        throw new TypeError('view.template returned an invalid game-template-preview result')
      }
      renderGameTemplatePreview(root.ownerDocument, root, result.output.value)
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

export default gameTemplateViewer
