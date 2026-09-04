import type * as lsp from 'vscode-languageserver/node'
import type { TextDocument } from 'vscode-languageserver-textdocument'

/**
 * A file category a language contribution can own.
 *
 * The vocabulary is OPEN. A game-neutral contract cannot enumerate one game's formats, so a kind
 * is an opaque id chosen by the contributing codec; anything that is not a genuinely cross-game
 * concept should be namespaced by its owner.
 *
 * The closed union this replaces existed to guarantee that a document kind no contribution claims
 * stays visibly unrouted rather than being silently absorbed. That guarantee is unchanged — it is
 * now enforced where it belongs, in classification and routing rather than in the type system: an
 * unrecognised document classifies to `undefined` and reaches no module, and a kind no module
 * registered resolves to no owner. Widening this type must not weaken that, which is what the
 * unrouted-visibility suites in `@modkitx/lsp` pin.
 */
export type DocumentKind = string

/**
 * Substrate-adjacent data files that still belong to a loaded mod and must invalidate its
 * substrate (SC2: `*.SC2Style`, `*.SC2Components`).
 *
 * Named constants rather than bare literals because {@link DocumentKind} is now open: the union
 * no longer spell-checks these two, so the host references them by name instead.
 */
export const UNCLASSIFIED_CATEGORY = 'unclassified'

/**
 * Any other unnamed file (binary assets: images/models/audio/video/fonts). Owned by NO module:
 * a create/delete only refreshes the client's Files view and never reloads a language substrate.
 */
export const FILES_CATEGORY = 'files'

/** A watched-file category reserved for the host: never claimable as a {@link DocumentKind}. */
export type ReservedWatchedCategory = typeof UNCLASSIFIED_CATEGORY | typeof FILES_CATEGORY

/**
 * A classified watched-file category: a {@link DocumentKind} the registry recognised, or one of
 * the host-reserved fallbacks for paths it can't name.
 */
export type WatchedFileCategory = DocumentKind | ReservedWatchedCategory

/** Diagnostics for a single file, produced by the headless `modkit check` path. */
export interface CheckFile {
  uri: string
  diagnostics: lsp.Diagnostic[]
}

/** Something a substrate needs for this session and does not have. */
export interface UnmetPrerequisite {
  /** Stable machine-readable code, e.g. `'sc2.data-root-missing'`. */
  readonly code: string
  /** Shown to the user verbatim, on every channel the host has. Name the fix. */
  readonly message: string
}

/** What a substrate contributes to, or reports about, a session it is asked to prepare. */
export interface SessionPreparation {
  /**
   * Merged into the `initializationOptions` every module receives — how a substrate hands its
   * modules a resolved install root or project configuration without the host knowing the shape.
   */
  readonly initializationOptions?: Readonly<Record<string, unknown>>
  /**
   * Prerequisites this substrate needs and does not have. Non-empty means it stays unloaded for
   * this session: the host reports each one and skips {@link SessionSubstrate.startSession}, but
   * still completes `initialize`.
   *
   * A missing game install disables THAT GAME's services, never the protocol host. Another game's
   * contributions keep working, and so do the features of this game that need no install.
   */
  readonly unmet?: readonly UnmetPrerequisite[]
}

/**
 * A substrate several contributions of one game share for the length of a session — a loaded
 * mod, an archive set, a string store.
 *
 * It is obtained from {@link LanguageContributionContext.shared} at module-construction time,
 * never handed to modules through {@link RouterContext}. A single `host` field on the context
 * could only ever hold ONE game's substrate, which is why it no longer exists: two games
 * contributing at once each keep their own, keyed by their own service id.
 *
 * The host owns the session lifecycle and drives these hooks; modules stay passive consumers.
 * Both are optional — a substrate that is pure state implements neither.
 */
export interface SessionSubstrate {
  /**
   * Inspect the session at `initialize` time, before any module initializes: resolve install
   * roots, read project configuration, reset per-session caches, and report anything missing.
   *
   * This is where a game's "requires an install" policy lives. It reports rather than throws,
   * because refusing the whole `initialize` would take the host and every other game down with
   * one absent install.
   */
  prepareSession?(params: lsp.InitializeParams): SessionPreparation | Promise<SessionPreparation>
  /**
   * Prepare the substrate once per session, BEFORE any module's `onInitialized`. Modules may
   * therefore assume it is loaded by the time they index. Skipped when
   * {@link SessionPreparation.unmet} reported a missing prerequisite.
   */
  startSession?(connection: lsp.Connection, initParams: lsp.InitializeParams): void | Promise<void>
  /**
   * Register custom requests this substrate serves directly — data owned by no single module
   * (a mod resource tree spanning several languages). The module-level equivalent is
   * {@link LanguageModule.registerCustom}.
   */
  registerRequests?(connection: lsp.Connection): void
}

/**
 * Shared services the protocol host injects into each module (design §3 seam).
 *
 * Deliberately game-free: a module's game substrate arrives through its constructor from the
 * contribution's shared scope (see {@link SessionSubstrate}), so this context carries only what
 * the protocol host itself owns.
 */
export interface RouterContext {
  connection: lsp.Connection
  documents: lsp.TextDocuments<TextDocument>
}

/** One language's server, driven by the protocol host (no self-owned connection). */
export interface LanguageModule {
  readonly languageId: string
  readonly extensions: string[]
  /**
   * Document kinds this module owns (R3). The host maps a
   * {@link DocumentKind} classified by its document-kind registry back to its module
   * through this list, so a module may own SEVERAL kinds (e.g. a GameData module owning both
   * `gamedata` and `include-manifest`) rather than one module = one extension. Optional:
   * modules that omit it are still reachable through the coarse languageId/extension
   * fallback, matching the pre-R3 routing.
   */
  readonly kinds?: readonly DocumentKind[]
  /**
   * Which classified watched-file categories this module's `onDidChangeWatchedFiles`
   * handler wants the host to route to it (G5). The host classifies each changed
   * path ONCE and dispatches to a module only the changes whose category is in this set — so
   * kinds a module doesn't own never reach its handler.
   *
   * Defaults to {@link kinds} when omitted (galaxy → `galaxy`, layout → `layout`). A
   * module whose substrate spans the WHOLE mod (a GameData substrate reloads its catalog
   * on any adjacent mod-file edit) widens this to include the other data categories plus
   * `'unclassified'`, which is why it's a separate declaration from `kinds` (feature
   * routing) rather than reused from it.
   */
  readonly watchedFileKinds?: readonly WatchedFileCategory[]
  /**
   * File extensions (lower-case, leading dot) that carry no {@link DocumentKind} of their own but
   * whose creation or deletion still invalidates this module's substrate — so the host classifies
   * them as {@link UNCLASSIFIED_CATEGORY} instead of the module-less {@link FILES_CATEGORY}.
   *
   * A contribution declares these because only it knows them. The host used to hold the list
   * itself, as a literal `Set(['.sc2style', '.sc2components'])` in its router: two StarCraft II
   * extensions deciding, inside the one package the architecture declares game-neutral, which
   * document changes reach a substrate. Rule 25 could not see it — it checks the dependency list,
   * not the vocabulary — so the clause that checks vocabulary was added with this field.
   *
   * Declaring an extension here is only meaningful for a module that also claims
   * {@link UNCLASSIFIED_CATEGORY} in {@link watchedFileKinds}; the two are separate because this
   * one names paths and that one names categories.
   */
  readonly substrateAdjacentExtensions?: readonly string[]
  capabilities(): lsp.ServerCapabilities
  /** Wire internal state against the shared connection/documents; no connection.onX registration. */
  initialize(ctx: RouterContext, initParams: lsp.InitializeParams): void | Promise<void>
  /** Unconditional reindex (config-less contract). */
  onInitialized(): void | Promise<void>
  // document lifecycle (called by the host's shared TextDocuments fan-out)
  onDidOpen(ev: lsp.TextDocumentChangeEvent<TextDocument>): void | Promise<void>
  onDidChangeContent(ev: lsp.TextDocumentChangeEvent<TextDocument>): void | Promise<void>
  onDidClose(ev: lsp.TextDocumentChangeEvent<TextDocument>): void | Promise<void>
  onDidSave(ev: lsp.TextDocumentChangeEvent<TextDocument>): void | Promise<void>
  onDidChangeWatchedFiles?(ev: lsp.DidChangeWatchedFilesParams): void | Promise<void>
  onDidChangeConfiguration?(ev: lsp.DidChangeConfigurationParams): void | Promise<void>
  // return-value feature methods (undefined = not supported by this language)
  completion?(
    p: lsp.CompletionParams,
    t: lsp.CancellationToken,
  ): Promise<lsp.CompletionList | lsp.CompletionItem[] | null | undefined>
  completionResolve?(item: lsp.CompletionItem): lsp.CompletionItem | Promise<lsp.CompletionItem>
  definition?(
    p: lsp.TextDocumentPositionParams,
    t: lsp.CancellationToken,
  ): Promise<lsp.Definition | lsp.DefinitionLink[] | null | undefined>
  hover?(
    p: lsp.TextDocumentPositionParams,
    t: lsp.CancellationToken,
  ): Promise<lsp.Hover | null | undefined>
  references?(
    p: lsp.ReferenceParams,
    t: lsp.CancellationToken,
  ): Promise<lsp.Location[] | null | undefined>
  documentSymbol?(
    p: lsp.DocumentSymbolParams,
    t: lsp.CancellationToken,
  ): Promise<lsp.SymbolInformation[] | lsp.DocumentSymbol[] | null | undefined>
  workspaceSymbol?(
    p: lsp.WorkspaceSymbolParams,
    t: lsp.CancellationToken,
  ): Promise<lsp.SymbolInformation[] | null | undefined>
  signatureHelp?(
    p: lsp.SignatureHelpParams,
    t: lsp.CancellationToken,
  ): Promise<lsp.SignatureHelp | null | undefined>
  documentColor?(
    p: lsp.DocumentColorParams,
    t: lsp.CancellationToken,
  ): Promise<lsp.ColorInformation[]>
  colorPresentation?(
    p: lsp.ColorPresentationParams,
    t: lsp.CancellationToken,
  ): Promise<lsp.ColorPresentation[]>
  rename?(
    p: lsp.RenameParams,
    t: lsp.CancellationToken,
  ): Promise<lsp.WorkspaceEdit | null | undefined>
  prepareRename?(
    p: lsp.TextDocumentPositionParams,
    t: lsp.CancellationToken,
  ): Promise<lsp.Range | { range: lsp.Range; placeholder: string } | null | undefined>
  /** Register any language-specific custom requests (e.g. descTree) on the shared connection. */
  registerCustom?(connection: lsp.Connection): void
  /**
   * Connection-free workspace diagnostics for `modkit check`. Returns per-file
   * diagnostics over the already-indexed workspace. Absent → contributes none.
   * `recursive` (galaxy only) follows the `#include` chain from entry documents.
   */
  diagnoseWorkspace?(opts?: { recursive?: boolean }): Promise<CheckFile[]>
}
