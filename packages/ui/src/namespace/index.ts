import type { NamespaceEntry, NamespaceEntrySource, Page, ViewerModule } from '@modkitx-x3/sdk'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  setViewerText,
  unknownSourceLease,
  ViewerMountScope,
} from '../viewer/index.js'

export function normalizeNamespacePath(value: string): string {
  if (value.includes('\\') || value.startsWith('/') || value.includes('\0')) {
    throw new TypeError('namespace path is not relative and portable')
  }
  const parts = value.split('/').filter(part => part !== '' && part !== '.')
  if (parts.some(part => part === '..')) throw new TypeError('namespace traversal is forbidden')
  return parts.join('/')
}

export class NamespaceModel {
  readonly #identities = new Map<string, string>()
  constructor(readonly source: NamespaceEntrySource) {}

  async list(prefix: string, cursor?: string, signal?: AbortSignal): Promise<Page<NamespaceEntry>> {
    const normalized = normalizeNamespacePath(prefix)
    const page = await this.source.list(
      normalized,
      { limit: 200, ...(cursor === undefined ? {} : { cursor }) },
      signal,
    )
    for (const entry of page.items) {
      const path = normalizeNamespacePath(entry.path)
      const identity = `${path}\0${entry.revision}`
      const existing = this.#identities.get(entry.id)
      if (existing !== undefined && existing !== identity) {
        throw new TypeError(`namespace entry identity changed: ${entry.id}`)
      }
      this.#identities.set(entry.id, identity)
    }
    return page
  }
}

export const namespaceViewer: ViewerModule = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'Namespace tree')
    root.setAttribute('role', 'tree')
    const lease = await unknownSourceLease(
      args.sources,
      args.slot,
      'common.view/namespace-entry-source',
    )
    if (lease === undefined) throw new TypeError('namespace binding is unavailable')
    scope.lease(lease)
    const source = lease.value as NamespaceEntrySource
    const model = new NamespaceModel(source)
    const list = element(root, 'ul', { part: 'namespace.list' })
    list.setAttribute('role', 'group')

    const renderPrefix = async (prefix: string, parent: HTMLElement) => {
      const page = await model.list(prefix, undefined, scope.signal)
      const seen = new Set<string>()
      for (const entry of page.items) {
        if (seen.has(entry.id)) throw new TypeError(`duplicate namespace entry id: ${entry.id}`)
        seen.add(entry.id)
        const item = element(parent, 'li', { part: 'namespace.item' })
        item.setAttribute('role', 'treeitem')
        item.dataset['entryId'] = entry.id
        item.dataset['revision'] = entry.revision
        const button = element(item, 'button', {
          text: entry.name,
          part: 'namespace.label',
        }) as HTMLButtonElement
        button.type = 'button'
        const detail = describeEntry(entry)
        if (detail !== '') {
          setViewerText(element(item, 'span', { part: 'namespace.detail' }), detail)
        }
        const activate = async () => {
          if (entry.kind === 'directory') {
            let nested = item.querySelector(':scope > ul') as HTMLElement | null
            if (nested === null) {
              nested = element(item, 'ul', { part: 'namespace.children' })
              nested.setAttribute('role', 'group')
              await renderPrefix(entry.path, nested)
            }
            nested.hidden = !nested.hidden
            return
          }
          const opened = await source.openEntry(entry.id, scope.signal)
          try {
            root.dispatchEvent(
              new CustomEvent('modkit-open-source', {
                bubbles: true,
                detail: { source: opened.value, entryId: entry.id, revision: entry.revision },
              }),
            )
          } finally {
            await opened.release()
          }
        }
        button.addEventListener('click', activate)
        scope.cleanup(() => button.removeEventListener('click', activate))
        setViewerText(button, entry.name)
      }
    }

    await renderPrefix('', list)
    return createViewerMount(root, scope, args, ({ descriptor }) => {
      root.dataset['revision'] = descriptor.revision
    })
  },
})

export default namespaceViewer /** Bytes as a container listing shows them: exact under 1 KiB, one decimal above. */
function formatEntryBytes(value: bigint): string {
  if (value < 1024n) return `${value} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let scaled = Number(value) / 1024
  let unit = 0
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024
    unit += 1
  }
  return `${scaled.toFixed(1)} ${units[unit]}`
}

/**
 * What the container knows about one entry, in one line.
 *
 * Only what this entry actually carries: a container that records no timestamp or no checksum must
 * not appear to record a zero one. The compression is shown with the stored size beside it because
 * neither means much alone — "deflate" without a ratio says nothing about what was saved, and a
 * stored size without the method looks like a contradiction of the real size.
 */
function describeEntry(entry: NamespaceEntry): string {
  if (entry.kind === 'directory') return ''
  const parts: string[] = []
  if (entry.size !== undefined) parts.push(formatEntryBytes(entry.size))
  if (entry.compression !== undefined) {
    parts.push(
      entry.storedSize === undefined
        ? entry.compression
        : `${entry.compression} ${formatEntryBytes(entry.storedSize)}`,
    )
  } else if (entry.storedSize !== undefined) {
    parts.push(`stored ${formatEntryBytes(entry.storedSize)}`)
  }
  if (entry.modifiedAt !== undefined) {
    // the container's stamp carries no zone, so it is read and shown as UTC rather than silently
    // shifted into the reader's own offset
    parts.push(`${new Date(entry.modifiedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC`)
  }
  if (entry.checksum !== undefined)
    parts.push(`${entry.checksum.algorithm} ${entry.checksum.value}`)
  return parts.join(' · ')
}
