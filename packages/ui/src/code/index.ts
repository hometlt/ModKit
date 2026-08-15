import type { TextDataSource, ViewerModule } from '@modkitx-x3/sdk'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  safeViewerText,
  setViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'

export const MAX_MATERIALIZED_BYTES = 16 * 1024 * 1024
export const MAX_MATERIALIZED_LINE_BYTES = 1024 * 1024

export class BoundedTextModel {
  constructor(readonly source: TextDataSource) {}

  async load(signal?: AbortSignal): Promise<string> {
    const info = await this.source.info()
    if (
      info.bytes > BigInt(MAX_MATERIALIZED_BYTES) ||
      info.longestLineBytes === 'unknown' ||
      info.longestLineBytes > MAX_MATERIALIZED_LINE_BYTES
    ) {
      throw new RangeError('bounded text policy rejected this source')
    }
    const slice = await this.source.slice(
      {
        kind: 'from-line',
        line: 0,
        lineCount: info.lines === 'unknown' ? Number.MAX_SAFE_INTEGER : Math.max(1, info.lines),
        maxBytes: MAX_MATERIALIZED_BYTES,
      },
      signal,
    )
    if (!slice.complete) throw new RangeError('bounded text source exceeded materialization limit')
    return slice.text
  }

  async search(pattern: string, signal?: AbortSignal): Promise<number> {
    let matches = 0
    for await (const range of this.source.search({ pattern }, signal)) {
      void range
      matches += 1
    }
    return matches
  }
}

export const boundedTextViewer: ViewerModule = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'Bounded text viewer')
    const lease = await unknownSourceLease(args.sources, args.slot, 'common.view/text-data-source')
    if (lease === undefined) throw new TypeError('bounded text binding is unavailable')
    scope.lease(lease)
    const model = new BoundedTextModel(lease.value as TextDataSource)
    const toolbar = element(root, 'div', { className: 'modkit-viewer__toolbar', role: 'search' })
    const search = element(toolbar, 'input') as HTMLInputElement
    search.type = 'search'
    search.setAttribute('aria-label', 'Search text')
    const searchButton = element(toolbar, 'button', { text: 'Search' }) as HTMLButtonElement
    searchButton.type = 'button'
    const status = element(toolbar, 'output', { text: 'Ready' })
    const content = element(root, 'pre', { className: 'modkit-viewer__code' })
    content.tabIndex = 0
    content.setAttribute('aria-label', 'Text content')
    setViewerText(content, await model.load(scope.signal), MAX_MATERIALIZED_BYTES)

    const runSearch = async () => {
      const pattern = safeViewerText(search.value, 4096)
      setViewerText(status, pattern === '' ? 'Enter a search term' : 'Searching…')
      if (pattern === '') return
      const matches = await model.search(pattern, scope.signal)
      setViewerText(status, `${matches} match${matches === 1 ? '' : 'es'}`)
    }
    searchButton.addEventListener('click', runSearch)
    search.addEventListener('keydown', event => {
      if (event.key === 'Enter') void runSearch()
    })
    scope.cleanup(() => searchButton.removeEventListener('click', runSearch))

    return createViewerMount(root, scope, args, ({ descriptor }) => {
      root.dataset['revision'] = descriptor.revision
    })
  },
})

export default boundedTextViewer
