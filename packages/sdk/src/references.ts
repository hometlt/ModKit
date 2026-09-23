/** Protocol-neutral typed references shared by language, graph, MCP and edit workflows. */

import { canonicalJsonStringify, isQualifiedId, type SourceSpan } from '@modkit/core'
import type { LanguageWorkspaceDocumentOrigin } from './language/index.js'
import type { SubjectRef } from './subjects/refs.js'

export type ReferenceOccurrenceRole = 'declaration' | 'reference' | 'include' | 'generated'
export type ReferenceOccurrenceForm = 'literal' | 'computed' | 'dynamic'

/** Logical address owned by exactly one format module. */
export interface ReferenceTargetAddress {
  /** Qualified module/owner id; the owner alone interprets the remaining address. */
  readonly owner: string
  readonly kind: string
  readonly id: string
  readonly namespace?: string
  readonly typeId?: string
  readonly locale?: string
  readonly workspace?: string
}

export interface ReferenceOccurrenceSource {
  readonly uri: string
  readonly sourceRevision: string
  readonly span: SourceSpan
  readonly origin?: LanguageWorkspaceDocumentOrigin
}

/** One exact use or declaration emitted by the parser that owns the source syntax. */
export interface ReferenceOccurrence {
  readonly target: ReferenceTargetAddress
  readonly source: ReferenceOccurrenceSource
  readonly semanticPath: readonly string[]
  readonly role: ReferenceOccurrenceRole
  readonly form: ReferenceOccurrenceForm
  readonly provenance: string
  /** Canonical declaration identity; required when role is `declaration`. */
  readonly subject?: SubjectRef
}

export interface ReferenceOccurrenceBatch {
  readonly contextId: string
  readonly contextRevision: string
  readonly semanticComplete: boolean
  readonly sourceUri: string
  readonly sourceRevision: string
  readonly occurrences: readonly ReferenceOccurrence[]
}

export interface ResolvedReferenceDeclaration {
  readonly subject: SubjectRef
  readonly source: ReferenceOccurrenceSource
  readonly semanticPath: readonly string[]
  /** True for the declaration selected after dependency/overlay precedence is applied. */
  readonly effective: boolean
}

export type ReferenceResolution =
  | Readonly<{
      state: 'resolved'
      target: ReferenceTargetAddress
      declaration: ResolvedReferenceDeclaration
      shadowedDeclarations: readonly ResolvedReferenceDeclaration[]
    }>
  | Readonly<{
      state: 'missing'
      target: ReferenceTargetAddress
      reason?: string
    }>
  | Readonly<{
      state: 'ambiguous'
      target: ReferenceTargetAddress
      candidates: readonly ResolvedReferenceDeclaration[]
    }>
  | Readonly<{
      state: 'dynamic'
      target: ReferenceTargetAddress
      reason: string
    }>
  | Readonly<{
      state: 'unsupported'
      target: ReferenceTargetAddress
      reason: string
    }>
  | Readonly<{
      state: 'incomplete'
      target: ReferenceTargetAddress
      reason: string
    }>

const bounded = (value: string, label: string): string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 8_192 ||
    value.includes('\0')
  ) {
    throw new TypeError(`${label} must be a bounded non-empty string`)
  }
  return value
}

/** Collision-free canonical key; context identity is supplied separately by the host index. */
export function referenceTargetKey(target: ReferenceTargetAddress): string {
  if (!isQualifiedId(target.owner)) throw new TypeError('reference target owner must be qualified')
  bounded(target.kind, 'reference target kind')
  bounded(target.id, 'reference target id')
  for (const [name, value] of Object.entries({
    namespace: target.namespace,
    typeId: target.typeId,
    locale: target.locale,
    workspace: target.workspace,
  })) {
    if (value !== undefined) bounded(value, `reference target ${name}`)
  }
  return canonicalJsonStringify({
    owner: target.owner,
    kind: target.kind,
    id: target.id,
    ...(target.namespace === undefined ? {} : { namespace: target.namespace }),
    ...(target.typeId === undefined ? {} : { typeId: target.typeId }),
    ...(target.locale === undefined ? {} : { locale: target.locale }),
    ...(target.workspace === undefined ? {} : { workspace: target.workspace }),
  })
}
