import { createMediaShell, type MediaShellState } from '@modkit/ui/media-shell'
import type { ViewerGalleryItem, ViewerGalleryPort } from '@modkit/sdk'

type ViewerGalleryThumbnail = NonNullable<
  Awaited<ReturnType<NonNullable<ViewerGalleryPort['thumbnail']>>>
>

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
  getState(): MediaShellState | undefined
  setState(state: MediaShellState): void
}

const api = acquireVsCodeApi()
let items: readonly ViewerGalleryItem[] = []
let generation = 0
const pending = new Map<number, (thumbnail: ViewerGalleryThumbnail | undefined) => void>()
const cache = new Map<string, ViewerGalleryThumbnail>()
const remembered = api.getState()
const shell = createMediaShell(document, {
  ...(remembered === undefined ? {} : { state: remembered }),
  onStateChange: state => api.setState(state),
  gallery: {
    async list() {
      return items
    },
    async open(id) {
      api.postMessage({ op: 'open', id })
    },
    thumbnail(id, _maxEdge, signal) {
      if (cache.has(id)) return Promise.resolve(cache.get(id))
      return new Promise(resolve => {
        if (signal?.aborted) {
          resolve(undefined)
          return
        }
        const request = ++generation
        const finish = (thumbnail: ViewerGalleryThumbnail | undefined) => {
          pending.delete(request)
          signal?.removeEventListener('abort', abort)
          if (thumbnail) cache.set(id, thumbnail)
          resolve(thumbnail)
        }
        const abort = () => finish(undefined)
        pending.set(request, finish)
        signal?.addEventListener('abort', abort, { once: true })
        api.postMessage({ op: 'thumbnail', id, generation: request })
      })
    },
  },
})
// Mount the original gallery pane on its own in the native sidebar.
const gallery = shell.root.querySelector<HTMLElement>("[data-mk-part='media-shell.gallery']")!
document.body.append(gallery)
let initial = true
window.addEventListener('message', async ({ data }) => {
  if (data.op === 'files') {
    cache.clear()
    items = data.items.map((item: ViewerGalleryItem) => ({
      ...item,
      active: item.id === data.active,
    }))
    await shell.refreshGallery()
    if (initial) {
      gallery
        .querySelectorAll<HTMLButtonElement>(
          "[data-mk-part='media-shell.gallery-group-header'][aria-expanded='false']",
        )
        .forEach(button => button.click())
      initial = false
    }
  } else if (data.op === 'active') {
    items = items.map(item => ({ ...item, active: item.id === data.id }))
    await shell.refreshGallery()
  } else if (data.op === 'thumbnail') {
    const thumbnail = data.thumbnail
    pending.get(data.generation)?.(
      thumbnail
        ? {
            width: thumbnail.width,
            height: thumbnail.height,
            rgba: new Uint8Array(thumbnail.pixels),
          }
        : undefined,
    )
  }
})
window.addEventListener('unload', () => shell.destroy())
api.postMessage({ op: 'refresh' })
