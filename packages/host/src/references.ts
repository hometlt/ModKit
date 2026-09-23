/** Host-owned typed cross-module occurrence index. Owners parse; this module only validates/indexes. */

import { compareUtf8, createReferenceIndex, isUInt64String, type SourceSpan } from '@modkit/core'
import {
  referenceTargetKey,
  type ReferenceOccurrence,
  type ReferenceOccurrenceBatch,
  type ReferenceResolution,
  type ReferenceTargetAddress,
  type ResolvedReferenceDeclaration,
} from '@modkit/sdk'

export interface ReferenceTargetResolver {
  readonly owner: string
  resolve(
    target: ReferenceTargetAddress,
    context: Readonly<{ id: string; revision: string; semanticComplete: boolean }>,
    signal?: AbortSignal,
  ): Promise<ReferenceResolution>
}

export interface WorkspaceReferenceIndexSnapshot {
  readonly contextId?: string
  readonly contextRevision?: string
  readonly semanticComplete: boolean
  readonly documents: number
  readonly targets: number
  readonly occurrences: number
}

export interface WorkspaceReferenceIndex {
  replace(batch: ReferenceOccurrenceBatch): void
  remove(sourceUri: string): void
  occurrences(target: ReferenceTargetAddress): readonly ReferenceOccurrence[]
  occurrencesIn(sourceUri: string): readonly ReferenceOccurrence[]
  resolveIndexed(target: ReferenceTargetAddress): ReferenceResolution
  resolve(
    target: ReferenceTargetAddress,
    resolver: ReferenceTargetResolver,
    signal?: AbortSignal,
  ): Promise<ReferenceResolution>
  snapshot(): WorkspaceReferenceIndexSnapshot
  clear(): void
}

const bounded = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 8_192 && !value.includes('\0')

const validSpan = (span: SourceSpan): boolean => {
  const value = span as Readonly<Record<string, unknown>>
  const byte = isUInt64String(value['byteOffset']) && isUInt64String(value['byteLength'])
  const text =
    Number.isSafeInteger(value['utf16Offset']) &&
    Number(value['utf16Offset']) >= 0 &&
    Number.isSafeInteger(value['utf16Length']) &&
    Number(value['utf16Length']) >= 0 &&
    Number.isSafeInteger(value['line']) &&
    Number(value['line']) >= 0 &&
    Number.isSafeInteger(value['column']) &&
    Number(value['column']) >= 0
  return byte || text
}

function validateOccurrence(value: ReferenceOccurrence, batch: ReferenceOccurrenceBatch): void {
  referenceTargetKey(value.target)
  if (
    !bounded(value.source.uri) ||
    value.source.uri !== batch.sourceUri ||
    !bounded(value.source.sourceRevision) ||
    value.source.sourceRevision !== batch.sourceRevision ||
    !validSpan(value.source.span) ||
    !['declaration', 'reference', 'include', 'generated'].includes(value.role) ||
    !['literal', 'computed', 'dynamic'].includes(value.form) ||
    !bounded(value.provenance) ||
    !Array.isArray(value.semanticPath) ||
    value.semanticPath.length > 64 ||
    value.semanticPath.some(segment => !bounded(segment)) ||
    (value.role === 'declaration' && value.subject === undefined)
  ) {
    throw new TypeError('reference occurrence is invalid')
  }
}

const declarationOf = (occurrence: ReferenceOccurrence): ResolvedReferenceDeclaration => ({
  subject: occurrence.subject!,
  source: occurrence.source,
  semanticPath: occurrence.semanticPath,
  effective: false,
})

export function createWorkspaceReferenceIndex(): WorkspaceReferenceIndex {
  const membership = createReferenceIndex()
  const byDocument = new Map<string, readonly ReferenceOccurrence[]>()
  const completenessByDocument = new Map<string, boolean>()
  let contextId: string | undefined
  let contextRevision: string | undefined
  let semanticComplete = false
  let generation = 0

  const clear = (): void => {
    membership.clear()
    byDocument.clear()
    completenessByDocument.clear()
    contextId = undefined
    contextRevision = undefined
    semanticComplete = false
    generation += 1
  }

  const indexed = (target: ReferenceTargetAddress): readonly ReferenceOccurrence[] => {
    if (contextId === undefined) return Object.freeze([])
    const key = `${contextId}\0${referenceTargetKey(target)}`
    return Object.freeze(
      membership
        .referencing(key)
        .flatMap(uri => byDocument.get(uri) ?? [])
        .filter(occurrence => referenceTargetKey(occurrence.target) === referenceTargetKey(target)),
    )
  }

  const resolveIndexed = (target: ReferenceTargetAddress): ReferenceResolution => {
    const found = indexed(target)
    if (!semanticComplete) {
      return Object.freeze({
        state: 'incomplete',
        target,
        reason: 'workspace context is incomplete',
      })
    }
    if (found.some(item => item.form === 'dynamic')) {
      return Object.freeze({ state: 'dynamic', target, reason: 'target is computed dynamically' })
    }
    const declarations = found.filter(item => item.role === 'declaration').map(declarationOf)
    if (declarations.length === 0) return Object.freeze({ state: 'missing', target })
    const ranked = declarations.sort((left, right) => {
      const lp = left.source.origin?.precedence ?? 0
      const rp = right.source.origin?.precedence ?? 0
      return rp - lp || compareUtf8(left.source.uri, right.source.uri)
    })
    const highest = ranked[0]!.source.origin?.precedence ?? 0
    const effective = ranked.filter(item => (item.source.origin?.precedence ?? 0) === highest)
    if (effective.length > 1) {
      return Object.freeze({ state: 'ambiguous', target, candidates: Object.freeze(effective) })
    }
    return Object.freeze({
      state: 'resolved',
      target,
      declaration: Object.freeze({ ...effective[0]!, effective: true }),
      shadowedDeclarations: Object.freeze(ranked.slice(1)),
    })
  }

  const api: WorkspaceReferenceIndex = {
    replace(batch) {
      if (
        !bounded(batch.contextId) ||
        !bounded(batch.contextRevision) ||
        typeof batch.semanticComplete !== 'boolean' ||
        !bounded(batch.sourceUri) ||
        !bounded(batch.sourceRevision) ||
        !Array.isArray(batch.occurrences)
      ) {
        throw new TypeError('reference occurrence batch is invalid')
      }
      for (const occurrence of batch.occurrences) validateOccurrence(occurrence, batch)
      if (contextId !== undefined && contextId !== batch.contextId) clear()
      contextId = batch.contextId
      if (contextRevision !== undefined && contextRevision !== batch.contextRevision) {
        membership.clear()
        byDocument.clear()
        completenessByDocument.clear()
        generation += 1
      }
      contextRevision = batch.contextRevision
      const frozen = Object.freeze(batch.occurrences.map(item => Object.freeze({ ...item })))
      byDocument.set(batch.sourceUri, frozen)
      completenessByDocument.set(batch.sourceUri, batch.semanticComplete)
      semanticComplete = [...completenessByDocument.values()].every(Boolean)
      membership.set(
        batch.sourceUri,
        frozen.map(item => `${batch.contextId}\0${referenceTargetKey(item.target)}`),
      )
      generation += 1
    },
    remove(sourceUri) {
      membership.remove(sourceUri)
      byDocument.delete(sourceUri)
      completenessByDocument.delete(sourceUri)
      semanticComplete =
        completenessByDocument.size > 0 && [...completenessByDocument.values()].every(Boolean)
      generation += 1
    },
    occurrences: indexed,
    occurrencesIn(sourceUri) {
      return byDocument.get(sourceUri) ?? Object.freeze([])
    },
    resolveIndexed,
    async resolve(target, resolver, signal) {
      if (resolver.owner !== target.owner) throw new TypeError('reference resolver owner mismatch')
      if (contextId === undefined || contextRevision === undefined) return resolveIndexed(target)
      const startGeneration = generation
      const startRevision = contextRevision
      const result = await resolver.resolve(
        target,
        { id: contextId, revision: contextRevision, semanticComplete },
        signal,
      )
      signal?.throwIfAborted()
      if (startGeneration !== generation || startRevision !== contextRevision) {
        return Object.freeze({
          state: 'incomplete',
          target,
          reason: 'workspace context changed during reference resolution',
        })
      }
      return result
    },
    snapshot() {
      const value = membership.snapshot()
      return Object.freeze({
        ...(contextId === undefined ? {} : { contextId }),
        ...(contextRevision === undefined ? {} : { contextRevision }),
        semanticComplete,
        documents: value.documents,
        targets: value.targets,
        occurrences: [...byDocument.values()].reduce((sum, items) => sum + items.length, 0),
      })
    },
    clear,
  }
  return Object.freeze(api)
}
