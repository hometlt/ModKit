import type { TextDataSource, TextSlice, ViewerModule } from '@modkit/sdk'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  setViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'
import { type UiLocalizationOptions } from '../localization/index.js'
import { TEXT_VIRTUAL_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

export const VIRTUAL_TEXT_PAGE_BYTES = 64 * 1024

export class VirtualTextModel {
  #cursor: string | undefined
  constructor(readonly source: TextDataSource) {}

  async first(line = 0, signal?: AbortSignal): Promise<TextSlice> {
    const page = await this.source.slice(
      { kind: 'from-line', line, lineCount: 200, maxBytes: VIRTUAL_TEXT_PAGE_BYTES },
      signal,
    )
    this.#cursor = page.complete ? undefined : page.nextCursor
    return page
  }

  async next(signal?: AbortSignal): Promise<TextSlice | undefined> {
    if (this.#cursor === undefined) return undefined
    const page = await this.source.slice(
      { kind: 'from-cursor', cursor: this.#cursor, maxBytes: VIRTUAL_TEXT_PAGE_BYTES },
      signal,
    )
    this.#cursor = page.complete ? undefined : page.nextCursor
    return page
  }
}

export function createVirtualTextViewer(options: UiLocalizationOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, TEXT_VIRTUAL_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('viewer.virtualText'))
      const lease = await unknownSourceLease(
        args.sources,
        args.slot,
        'common.view/text-data-source',
      )
      if (lease === undefined) throw new TypeError('virtual text binding is unavailable')
      scope.lease(lease)
      const model = new VirtualTextModel(lease.value as TextDataSource)
      const viewport = element(root, 'pre', {
        className: 'modkit-viewer__virtual-text',
        part: 'virtual-text',
      })
      viewport.tabIndex = 0
      viewport.setAttribute('aria-live', 'polite')
      const more = element(root, 'button', {
        text: localizer.text('viewer.loadNextPage'),
      }) as HTMLButtonElement
      more.type = 'button'

      const renderPage = (page: TextSlice | undefined, append: boolean) => {
        if (page === undefined) {
          more.disabled = true
          return
        }
        const text = append ? `${viewport.textContent ?? ''}${page.text}` : page.text
        setViewerText(viewport, text, 2 * VIRTUAL_TEXT_PAGE_BYTES)
        more.disabled = page.complete
        viewport.dataset['fromLine'] = String(page.fromLine)
      }
      renderPage(await model.first(0, scope.signal), false)
      const next = async () => renderPage(await model.next(scope.signal), true)
      more.addEventListener('click', next)
      scope.cleanup(() => more.removeEventListener('click', next))
      return createViewerMount(root, scope, args, ({ descriptor }) => {
        root.dataset['revision'] = descriptor.revision
      })
    },
  })
}

export const virtualTextViewer: ViewerModule = createVirtualTextViewer()

export default virtualTextViewer
