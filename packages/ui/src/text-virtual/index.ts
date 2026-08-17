import type { TextDataSource, TextSlice, ViewerModule } from '@modkitx-x3/sdk'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  setViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'

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

export const virtualTextViewer: ViewerModule = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'Virtual text viewer')
    const lease = await unknownSourceLease(args.sources, args.slot, 'common.view/text-data-source')
    if (lease === undefined) throw new TypeError('virtual text binding is unavailable')
    scope.lease(lease)
    const model = new VirtualTextModel(lease.value as TextDataSource)
    const viewport = element(root, 'pre', {
      className: 'modkit-viewer__virtual-text',
      part: 'virtual-text',
    })
    viewport.tabIndex = 0
    viewport.setAttribute('aria-live', 'polite')
    const more = element(root, 'button', { text: 'Load next page' }) as HTMLButtonElement
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

export default virtualTextViewer
