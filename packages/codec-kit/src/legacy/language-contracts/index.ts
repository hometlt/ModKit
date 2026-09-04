/**
 * Language-contribution contracts shared by the LSP protocol host and the semantic codecs that
 * implement language services.
 *
 * This package exists because the dependency edge runs host → codec (through the generated codec
 * catalog's lazy loader edges), so a codec cannot import the contract from `@modkitx/lsp` without
 * creating a cycle. It carries types and a registry only: no parser, no semantic implementation,
 * and no protocol transport.
 *
 * It is deliberately NOT part of `@modkitx/assets`: these contracts are typed in terms of
 * `vscode-languageserver/node`, and `@modkitx/assets` is the browser-safe Phase A contract root.
 */
export type {
  CheckFile,
  DocumentKind,
  LanguageModule,
  ReservedWatchedCategory,
  RouterContext,
  SessionPreparation,
  SessionSubstrate,
  UnmetPrerequisite,
  WatchedFileCategory,
} from './module.js'
export { FILES_CATEGORY, UNCLASSIFIED_CATEGORY } from './module.js'
export { DocumentKindRegistry, MATCH_TIERS } from './document-kind.js'
export type {
  DocumentInput,
  DocumentMatch,
  KindRule,
  MatchTier,
  NormalizedInput,
} from './document-kind.js'
export { CodecLanguageContributionRegistry, LanguageContributionContext } from './contributions.js'
export type {
  CodecLanguageContribution,
  CodecLanguageContributionSummary,
} from './contributions.js'
