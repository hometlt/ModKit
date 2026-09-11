import type { NamespaceEntrySource } from '@modkit/sdk'
import type { FileAccess, ExplorerEntry } from '@modkit/ui/explorer'

/** Adapt a codec namespace (including an installed CASC) to the same tree port as remote VFS. */
export function namespaceFileAccess(options: {
  label: string
  parentSessionId: string
  source: NamespaceEntrySource
  read(entryId: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array>
}): FileAccess {
  const prefix = `modkit-container:${encodeURIComponent(options.parentSessionId)}?entryId=`
  const folders = new Map<string, string>()
  const files = new Map<string, { entryId: string; size?: number }>()
  return { label: options.label,
    async list(id, signal) {
      const path = id === undefined ? '' : folders.get(id)
      if (path === undefined) throw new Error('Unknown namespace directory')
      const parent = path ? `${path}/` : ''
      const entries = new Map<string, ExplorerEntry>()
      const cursors = new Set<string>()
      let cursor: string | undefined
      let examined = 0
      do {
        signal?.throwIfAborted()
        const page = await options.source.list(parent, { limit: 1000, ...(cursor === undefined ? {} : { cursor }) }, signal)
        examined += page.items.length
        if (examined > 750000) throw new Error('Installed namespace exceeds the tree index limit')
        for (const item of page.items) {
          if (!item.path.startsWith(parent)) continue
          const tail = item.path.slice(parent.length).replace(/\/$/u, '')
          if (!tail) continue
          const name = tail.split('/')[0]!
          if (name === '.' || name === '..') throw new Error('Invalid namespace path')
          const directory = tail.includes('/') || item.kind === 'directory'
          const uri = directory ? `modkit-source-directory:${encodeURIComponent(options.parentSessionId)}/${encodeURIComponent(parent + name)}`
            : `${prefix}${encodeURIComponent(item.id)}`
          if (directory) folders.set(uri, parent + name)
          else files.set(uri, { entryId: item.id, ...(item.size === undefined ? {} : { size: Number(item.size) }) })
          entries.set(name, { id: uri, name, directory, ...(directory || item.size === undefined ? {} : { size: Number(item.size) }) })
        }
        cursor = page.nextCursor
        if (cursor !== undefined) {
          if (cursors.has(cursor)) throw new Error('Namespace returned a repeated cursor')
          cursors.add(cursor)
        }
      } while (cursor !== undefined)
      return [...entries.values()].sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
    },
    async read(uri, maximum, signal) {
      const file = files.get(uri)
      if (!file) throw new Error('Select a file from this source tree')
      if (file.size !== undefined && file.size > maximum) throw new Error('File exceeds the preview size limit')
      const bytes = await options.read(file.entryId, maximum, signal)
      if (bytes.length > maximum) throw new Error('File exceeds the preview size limit')
      return bytes
    },
  }
}
