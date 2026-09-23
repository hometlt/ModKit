/**
 * Anchor documents: entries that stand for the source that holds them.
 *
 * `MapInfo` names a StarCraft II map and carries almost nothing else, so a person who opens it
 * came for the map, not for a short XML document. The same is true of `DocumentInfo` for a mod.
 * Opening one of these opens the source instead — the archive for a packed map, the directory for
 * a loose one — which is also the only way a loose map directory gets an entry point at all: a
 * folder is not something a VS Code editor can be opened on.
 *
 * Which names those are belongs to the format, so a codec declares them in its manifest
 * (`spec.anchorDocuments`) and nothing here knows a game's file names. The rule is DOM-free on
 * purpose, like `view-policy`, so it is testable in Node.
 */

import type { Inventory } from '@modkit/host'

import {
  containerUriText,
  isContainerUriText,
  parseContainerUriText,
  splitContainer,
  type ContainerLocation,
} from './container-uri.js'

/** Extension (no dot, lowercase) → the anchor entry names declared for it, lowercase. */
export type AnchorDocumentIndex = ReadonlyMap<string, ReadonlySet<string>>

const BACKSLASH = String.fromCharCode(92)

function extensionOf(path: string): string | undefined {
  const name = path.split(/[/\\]/u).filter(Boolean).at(-1)
  if (name === undefined) return undefined
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? undefined : name.slice(dot + 1).toLowerCase()
}

/**
 * Read every codec's declared anchors out of the inventory, keyed by the extensions it matches.
 *
 * A codec that declares anchors but matches no extension is skipped rather than applied to every
 * path: an anchor is only meaningful relative to the kind of source that declares it.
 */
export function anchorDocumentIndex(inventory: Inventory): AnchorDocumentIndex {
  const index = new Map<string, Set<string>>()
  for (const extension of inventory.extensions) {
    for (const contribution of extension.contributions) {
      const spec = contribution.manifest?.spec as
        | { anchorDocuments?: readonly string[]; match?: { extensions?: readonly string[] } }
        | undefined
      // A manifest is data read off disk, so a malformed one must not take the window's page down
      // with it: this runs while a subject view is being served, where a throw costs every stage.
      const anchors = spec?.anchorDocuments
      const extensions = spec?.match?.extensions
      if (!Array.isArray(anchors) || anchors.length === 0) continue
      if (!Array.isArray(extensions) || extensions.length === 0) continue
      for (const candidate of extensions) {
        if (typeof candidate !== 'string') continue
        const key = candidate.replace(/^\./u, '').toLowerCase()
        if (key.length === 0) continue
        const names = index.get(key) ?? new Set<string>()
        for (const anchor of anchors) {
          if (typeof anchor === 'string') names.add(anchor.replace(/^\//u, '').toLowerCase())
        }
        index.set(key, names)
      }
    }
  }
  return index
}

function anchoredContainerMember(
  location: ContainerLocation,
  index: AnchorDocumentIndex,
): string | undefined {
  // The innermost container is the source the entry sits in; an outer one holds that container.
  const innermost = splitContainer(location.container)
  const holder = innermost.members.at(-1) ?? innermost.file
  const extension = extensionOf(holder)
  if (extension === undefined) return undefined
  if (index.get(extension)?.has(location.entry.toLowerCase()) !== true) return undefined
  // A map on disk opens by its own path; a map that is itself inside a container keeps a URI.
  return innermost.members.length === 0 ? innermost.file : containerUriText(location.container)
}

function anchoredFile(path: string, index: AnchorDocumentIndex): string | undefined {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf(BACKSLASH))
  if (cut <= 0) return undefined
  const parent = path.slice(0, cut)
  const name = path.slice(cut + 1)
  if (name.length === 0) return undefined
  const extension = extensionOf(parent)
  if (extension === undefined) return undefined
  return index.get(extension)?.has(name.toLowerCase()) === true ? parent : undefined
}

/**
 * The subject to open for a requested path: its source when the path names an anchor document,
 * and the path itself otherwise.
 *
 * Only a direct child anchors. A `MapInfo` nested deeper inside a map belongs to something else
 * that happens to live there — an embedded map, a backup — and opening the outer map for it would
 * be a guess.
 */
export function anchoredSubjectPath(requested: string, index: AnchorDocumentIndex): string {
  if (index.size === 0) return requested
  if (isContainerUriText(requested)) {
    let location: ContainerLocation | undefined
    try {
      location = parseContainerUriText(requested)
    } catch {
      return requested
    }
    if (location === undefined || location.entry.includes('/')) return requested
    return anchoredContainerMember(location, index) ?? requested
  }
  return anchoredFile(requested, index) ?? requested
}
