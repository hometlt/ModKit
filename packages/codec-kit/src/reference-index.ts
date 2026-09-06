/**
 * A two-way reference index over a workspace: which documents mention a target, and which targets a
 * document mentions.
 *
 * Extracted from MK2's `sc2-data/language/providers/project-index.ts`, which is where the algorithm
 * was written and proven. Only the algorithm moved: that class walked a directory with `node:fs` and
 * knew what a GameData reference looks like, and both of those belong to the codec, not here. What
 * is shared is the bookkeeping — and the bookkeeping is the part that is easy to get subtly wrong.
 *
 * Three formats need it for the same question asked three ways. Deleting an entity should flag the
 * closed data file that still links to it; renaming an entity should flag the localization strings
 * that reference it; changing a text style should flag the strings that use it. One index answers
 * all three, and nothing here knows what any of those things are.
 *
 * No IO, no timers, no `node:` imports. It runs wherever a codec runs, browser included.
 */

export interface ReferenceIndexSnapshot {
  readonly documents: number
  readonly targets: number
}

export interface ReferenceIndex {
  /**
   * Record what one document references, replacing whatever it referenced before.
   *
   * Replacing rather than adding is the whole point of the two-way map: a document that stops
   * referencing a target must stop being reported for it, and an index that only ever grows will
   * keep pointing at edits that no longer exist.
   */
  set(documentId: string, targets: Iterable<string>): void
  /** Forget a document entirely — it was deleted, or moved out of the indexed scope. */
  remove(documentId: string): void
  /** Documents that reference `target`, in insertion order. */
  referencing(target: string): readonly string[]
  /** Targets `documentId` references. */
  targetsOf(documentId: string): readonly string[]
  /** Every indexed document id. */
  documents(): readonly string[]
  snapshot(): ReferenceIndexSnapshot
  clear(): void
}

export interface ReferenceIndexOptions {
  /**
   * Normalise a document id before storing it, for hosts where the same document arrives under
   * more than one spelling — `C:\Mod\A.xml` and `c:/mod/a.xml` being the case this was written for.
   * Left alone by default, because collapsing ids that a host means to keep apart is worse than
   * keeping two entries.
   */
  readonly normalizeDocumentId?: (documentId: string) => string
}

export function createReferenceIndex(options: ReferenceIndexOptions = {}): ReferenceIndex {
  const normalize = options.normalizeDocumentId ?? ((id: string) => id)
  /** target → documents referencing it. */
  const byTarget = new Map<string, Set<string>>()
  /** document → targets it references. */
  const byDocument = new Map<string, Set<string>>()

  const detach = (documentId: string): void => {
    for (const target of byDocument.get(documentId) ?? []) {
      const documents = byTarget.get(target)
      documents?.delete(documentId)
      // An empty set is not the same as an absent one for `snapshot`, so drop it rather than keep
      // a growing tail of targets nothing references any more.
      if (documents !== undefined && documents.size === 0) byTarget.delete(target)
    }
  }

  return {
    set(documentId, targets) {
      const id = normalize(documentId)
      detach(id)
      const set = new Set(targets)
      byDocument.set(id, set)
      for (const target of set) {
        let documents = byTarget.get(target)
        if (documents === undefined) {
          documents = new Set()
          byTarget.set(target, documents)
        }
        documents.add(id)
      }
    },
    remove(documentId) {
      const id = normalize(documentId)
      detach(id)
      byDocument.delete(id)
    },
    referencing(target) {
      return [...(byTarget.get(target) ?? [])]
    },
    targetsOf(documentId) {
      return [...(byDocument.get(normalize(documentId)) ?? [])]
    },
    documents() {
      return [...byDocument.keys()]
    },
    snapshot() {
      return { documents: byDocument.size, targets: byTarget.size }
    },
    clear() {
      byTarget.clear()
      byDocument.clear()
    },
  }
}
