/**
 * The parts of the language adapter that decide something, kept free of `vscode` so they can be
 * tested: which native completion kind a provider's kind is drawn as, and where a provider's
 * command leads. `extension.ts` turns the answers into VS Code objects.
 */
import {
  languageFileAssociationFor,
  languageWorkspaceContextToken,
  type LanguageWorkspaceDocumentSourceRequest,
  type LanguageWorkspaceDocumentSourceResult,
} from '@modkit/host/language'
import type { LanguageFileAssociation } from '@modkit/sdk'
import type {
  LanguageCompletionItemKind,
  LanguagePosition,
  LanguageRange,
} from '@modkit/sdk/language'

/**
 * The command a lens, a code action or a hover link runs with a provider's `LanguageCommand` as its
 * argument — the same id the LSP server hands its clients (`apps/lsp` `LSP_LANGUAGE_COMMAND`).
 */
export const LANGUAGE_COMMAND = 'modkit.runLanguageCommand'

/** Reuse closed documents while the host supplies the current open editor overlays. */
export function rebaseLanguageSnapshot(
  snapshot: LanguageWorkspaceDocumentSourceResult,
  request: LanguageWorkspaceDocumentSourceRequest,
): LanguageWorkspaceDocumentSourceResult {
  const context = snapshot.workspaceContext
  if (context === undefined) return snapshot
  const openUris = new Set([
    request.document.uri,
    ...request.workspaceDocuments.map(document => document.uri),
  ])
  const closed = snapshot.documents.filter(document => !openUris.has(document.uri))
  const documents = Object.freeze(closed.slice(0, request.maxDocuments))
  const allowedUris = new Set([...openUris, ...documents.map(document => document.uri)])
  const documentOrigins = Object.freeze([
    ...request.workspaceDocumentOrigins,
    ...context.documentOrigins.filter(
      origin => !openUris.has(origin.uri) && allowedUris.has(origin.uri),
    ),
  ])
  return Object.freeze({
    ...snapshot,
    documents,
    isComplete: snapshot.isComplete && documents.length === closed.length,
    workspaceContext: Object.freeze({
      ...context,
      revision: languageWorkspaceContextToken({
        snapshotRevision: context.revision,
        openDocuments: documentOrigins
          .filter(origin => openUris.has(origin.uri))
          .map(origin => ({ uri: origin.uri, sourceRevision: origin.sourceRevision })),
      }),
      documentOrigins,
    }),
  })
}

/** Names of `vscode.CompletionItemKind` members. */
export type CompletionKindName =
  | 'Class'
  | 'Color'
  | 'Constant'
  | 'Enum'
  | 'EnumMember'
  | 'Event'
  | 'Field'
  | 'File'
  | 'Folder'
  | 'Function'
  | 'Interface'
  | 'Keyword'
  | 'Module'
  | 'Property'
  | 'Snippet'
  | 'Text'
  | 'TypeParameter'
  | 'Variable'

const COMPLETION_KINDS: Readonly<Record<LanguageCompletionItemKind, CompletionKindName>> = {
  class: 'Class',
  struct: 'Class',
  color: 'Color',
  constant: 'Constant',
  enum: 'Enum',
  'enum-member': 'EnumMember',
  event: 'Event',
  field: 'Field',
  file: 'File',
  folder: 'Folder',
  function: 'Function',
  interface: 'Interface',
  keyword: 'Keyword',
  module: 'Module',
  namespace: 'Module',
  parameter: 'Variable',
  variable: 'Variable',
  property: 'Property',
  snippet: 'Snippet',
  text: 'Text',
  type: 'TypeParameter',
}

/** The native kind a provider's completion kind is drawn as; an unknown one is plain text. */
export function completionKindName(kind: string): CompletionKindName {
  return Object.hasOwn(COMPLETION_KINDS, kind)
    ? COMPLETION_KINDS[kind as LanguageCompletionItemKind]
    : 'Text'
}

/** The stage an `open-subject` view opens on. */
const SUBJECT_STAGES = { card: 'card', graph: 'relations', resolved: 'tree' } as const

export type LanguageCommandTarget =
  | {
      readonly kind: 'subject'
      readonly subjectId: string
      readonly stage: (typeof SUBJECT_STAGES)[keyof typeof SUBJECT_STAGES]
    }
  | { readonly kind: 'location'; readonly uri: string; readonly range: LanguageRange }

const isPosition = (value: unknown): value is LanguagePosition =>
  typeof value === 'object' &&
  value !== null &&
  Number.isSafeInteger((value as LanguagePosition).line) &&
  Number.isSafeInteger((value as LanguagePosition).character) &&
  (value as LanguagePosition).line >= 0 &&
  (value as LanguagePosition).character >= 0

/**
 * Where a provider's command leads, or undefined for anything outside the closed set. The argument
 * reaches the command through a lens, an action or a hover link, so it is checked, not trusted.
 */
export function languageCommandTarget(value: unknown): LanguageCommandTarget | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const command = value as Record<string, unknown>
  if (command['kind'] === 'open-subject') {
    const subjectId = command['subjectId']
    const view = command['view'] ?? 'card'
    if (typeof subjectId !== 'string' || subjectId === '') return undefined
    if (typeof view !== 'string' || !Object.hasOwn(SUBJECT_STAGES, view)) return undefined
    return {
      kind: 'subject',
      subjectId,
      stage: SUBJECT_STAGES[view as keyof typeof SUBJECT_STAGES],
    }
  }
  if (command['kind'] === 'open-location') {
    const location = command['location'] as { uri?: unknown; range?: unknown } | undefined
    const range = location?.range as { start?: unknown; end?: unknown } | undefined
    if (typeof location?.uri !== 'string' || location.uri === '') return undefined
    if (!isPosition(range?.start) || !isPosition(range?.end)) return undefined
    return { kind: 'location', uri: location.uri, range: { start: range.start, end: range.end } }
  }
  return undefined
}

/**
 * The language a game gives an open document VS Code labelled only generically (plan 1.25). A plain
 * association names a file kind VS Code has no language for (`plaintext`); one by root element
 * relabels a generic XML document whose start opens that element (`<Catalog>` → `sc2-data`, for
 * GameData anywhere in a mod). A document VS Code labelled more precisely keeps its language.
 */
export function associatedLanguageOf(
  associations: readonly LanguageFileAssociation[],
  document: { readonly fileName: string; readonly languageId: string; readonly head: string },
): string | undefined {
  if (document.languageId !== 'plaintext' && document.languageId !== 'xml') return undefined
  const association = languageFileAssociationFor(associations, document.fileName, document.head)
  if (association === undefined) return undefined
  return document.languageId === 'plaintext' || association.rootElement !== undefined
    ? association.languageId
    : undefined
}
