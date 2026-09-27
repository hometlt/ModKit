import { resolve } from 'node:path'

import type { Inventory } from '@modkit/host'

/**
 * The extension roots whose `modkit.contentSources` this window composes: exactly the roots the
 * inventory loaded, one per extension id. Gathering them again from the settings, the workspace and
 * the managed list named the same extension twice when a live repository and the acceptance
 * snapshot both held it, and two modules naming one region broke the sources of every game.
 */
export function contentSourceRoots(inventory: Pick<Inventory, 'extensions'>): string[] {
  const seen = new Set<string>()
  return inventory.extensions.flatMap(extension => {
    const id = `${extension.manifest.publisher}/${extension.manifest.id}`
    if (seen.has(id)) return []
    seen.add(id)
    return [resolve(extension.source)]
  })
}
