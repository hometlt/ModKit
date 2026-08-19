/**
 * Turning a namespace entry id back into its path.
 *
 * `namespaceViewer` reports the id of whatever the user activated; a codec's extraction operation
 * takes the entry's path. The contract has no id→path lookup, so the host walks the namespace once
 * and remembers. Bounded on purpose: a container with a hostile directory must not be able to make
 * the renderer walk forever, so the walk stops at a fixed number of entries and a fixed depth and
 * reports what it has.
 *
 * Pure and DOM-free so the bounds are testable in Node.
 */
import type { NamespaceEntrySource } from '@modkitx-x3/sdk'

export const NAMESPACE_MAXIMUM_ENTRIES = 5000
export const NAMESPACE_MAXIMUM_DEPTH = 12

export interface ArchiveEntryFact {
  readonly path: string
  readonly name: string
}

export async function indexNamespace(
  source: Pick<NamespaceEntrySource, 'list'>,
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, ArchiveEntryFact>> {
  const index = new Map<string, ArchiveEntryFact>()
  /*
   * A prefix is listed once. `list(prefix)` is defined as "entries under this prefix", and a
   * container is free to include the directory entry that *is* the prefix — the first-party ZIP
   * source does, because it filters by `startsWith`. Without this set the walk re-queues that same
   * directory at every level and only the depth bound stops it.
   */
  const visited = new Set<string>()
  const queue: { readonly prefix: string; readonly depth: number }[] = [{ prefix: '', depth: 0 }]
  while (queue.length > 0 && index.size < NAMESPACE_MAXIMUM_ENTRIES) {
    const next = queue.shift()
    if (next === undefined) break
    if (visited.has(next.prefix)) continue
    visited.add(next.prefix)
    let cursor: string | undefined
    do {
      const page = await source.list(
        next.prefix,
        { limit: 200, ...(cursor === undefined ? {} : { cursor }) },
        signal,
      )
      for (const entry of page.items) {
        if (entry.kind === 'directory') {
          if (next.depth + 1 < NAMESPACE_MAXIMUM_DEPTH && !visited.has(entry.path)) {
            queue.push({ prefix: entry.path, depth: next.depth + 1 })
          }
          continue
        }
        index.set(entry.id, { path: entry.path, name: entry.name })
        if (index.size >= NAMESPACE_MAXIMUM_ENTRIES) break
      }
      cursor = page.nextCursor
    } while (cursor !== undefined && index.size < NAMESPACE_MAXIMUM_ENTRIES)
  }
  return index
}
