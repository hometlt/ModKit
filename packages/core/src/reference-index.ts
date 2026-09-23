/** Dependency-free two-way membership index used by reference owners and the host coordinator. */
export interface ReferenceIndexSnapshot {
  readonly documents: number
  readonly targets: number
}

export interface ReferenceIndex {
  set(documentId: string, targets: Iterable<string>): void
  remove(documentId: string): void
  referencing(target: string): readonly string[]
  targetsOf(documentId: string): readonly string[]
  documents(): readonly string[]
  snapshot(): ReferenceIndexSnapshot
  clear(): void
}

export interface ReferenceIndexOptions {
  readonly normalizeDocumentId?: (documentId: string) => string
}

export function createReferenceIndex(options: ReferenceIndexOptions = {}): ReferenceIndex {
  const normalize = options.normalizeDocumentId ?? ((id: string) => id)
  const byTarget = new Map<string, Set<string>>()
  const byDocument = new Map<string, Set<string>>()
  const detach = (documentId: string): void => {
    for (const target of byDocument.get(documentId) ?? []) {
      const documents = byTarget.get(target)
      documents?.delete(documentId)
      if (documents?.size === 0) byTarget.delete(target)
    }
  }
  return {
    set(documentId, targets) {
      const id = normalize(documentId)
      detach(id)
      const set = new Set(targets)
      byDocument.set(id, set)
      for (const target of set) {
        const documents = byTarget.get(target) ?? new Set<string>()
        documents.add(id)
        byTarget.set(target, documents)
      }
    },
    remove(documentId) {
      const id = normalize(documentId)
      detach(id)
      byDocument.delete(id)
    },
    referencing: target => [...(byTarget.get(target) ?? [])],
    targetsOf: documentId => [...(byDocument.get(normalize(documentId)) ?? [])],
    documents: () => [...byDocument.keys()],
    snapshot: () => ({ documents: byDocument.size, targets: byTarget.size }),
    clear() {
      byTarget.clear()
      byDocument.clear()
    },
  }
}
