/**
 * VS-Code-free language-session controller.
 *
 * The adapter in `extension.ts` supplies full text snapshots and converts these neutral DTOs into
 * native editor objects. Routing, debounce, stale suppression and provider lifecycle remain
 * independently testable here without importing `vscode`.
 */

import {
  ModkitError,
  OperationCancelledError,
  isCancellation,
  throwIfAborted,
  type Diagnostic,
} from '@modkit/core'
import type {
  LanguageCodeActionList,
  LanguageCompletionItem,
  LanguageCodeLensList,
  LanguageDocumentHighlightList,
  LanguageDocumentLinkList,
  LanguageFoldingRangeList,
  LanguageInlayHintList,
  LanguageColor,
  LanguageColorList,
  LanguageColorPresentationList,
  LanguageDiagnostic,
  LanguageDiagnosticList,
  LanguageCompletionList,
  LanguageDocument,
  LanguageFormattingOptions,
  LanguageHover,
  LanguageLocationList,
  LanguageOnTypeEditResult,
  LanguagePosition,
  LanguageRange,
  LanguageRenamePreparation,
  LanguageSignatureHelp,
  LanguageSymbol,
  LanguageSymbolKind,
  LanguageTokenKind,
  LanguageTextEditList,
  LanguageTextEdit,
  LanguageWorkspaceEdit,
  LanguageWorkspaceSymbolList,
} from '@modkit/sdk/language'
import type {
  LanguageProjectDiagnostics,
  LanguageProviderRoute,
  LanguageWorkspace,
  LanguageWorkspaceAnalysisResult,
  LanguageWorkspaceDocumentRequest,
} from '@modkit/host/language'
import {
  LANGUAGE_MAX_DOCUMENTS,
  LANGUAGE_MAX_DOCUMENT_RESULTS,
  languageRouteServesFile,
} from '@modkit/host/language'

export const LANGUAGE_TOKEN_TYPES: readonly LanguageTokenKind[] = Object.freeze([
  'comment',
  'function',
  'keyword',
  'number',
  'operator',
  'parameter',
  'property',
  'string',
  'type',
  'variable',
])

export const LANGUAGE_TOKEN_MODIFIERS: readonly string[] = Object.freeze([
  'declaration',
  'definition',
  'readonly',
  'static',
  'deprecated',
  'abstract',
  'async',
  'modification',
  'documentation',
  'defaultLibrary',
])

const KNOWN_TOKEN_MODIFIERS = new Set(LANGUAGE_TOKEN_MODIFIERS)

export interface EditorLanguageDocument {
  readonly uri: string
  /** Host/editor file name, used only to select an advertised extension route. */
  readonly fileName: string
  readonly languageId: string
  readonly version: number
  /** Always a full snapshot. Providers never receive incremental editor events. */
  readonly text: string
}

export type EditorLanguageDiagnostic = Readonly<LanguageDiagnostic>

export interface EditorDocumentSymbol {
  readonly name: string
  readonly detail?: string
  readonly kind: LanguageSymbolKind
  readonly range: LanguageRange
  readonly selectionRange: LanguageRange
  readonly children: readonly EditorDocumentSymbol[]
}

export interface EditorSemanticToken {
  readonly line: number
  readonly character: number
  readonly length: number
  readonly tokenType: LanguageTokenKind
  readonly modifiers: readonly string[]
}

export interface LanguageControllerNotice {
  readonly code: string
  readonly message: string
  readonly uri?: string
}

export interface LanguageSessionControllerOptions {
  readonly workspace: LanguageWorkspace
  readonly routes: readonly LanguageProviderRoute[]
  /** How long an edit waits before it is synchronized; a function is asked each time (a setting). */
  readonly debounceMs?: number | (() => number)
  /**
   * After an edit, how long the other open documents wait for the edits to pause before their
   * semantic diagnostics are asked again (an edit here can break a reference there). Default 750 ms.
   */
  readonly relatedDiagnosticsDelayMs?: number
  /** Delay background analysis and semantic diagnostics so interactive requests run first. */
  readonly semanticDiagnosticsDelayMs?: number | (() => number)
  /** Document diagnostics have their own native collection. Host notices must not enter it. */
  readonly publishDiagnostics: (
    uri: string,
    diagnostics: readonly EditorLanguageDiagnostic[],
  ) => void
  readonly reportHostDiagnostics?: (uri: string, diagnostics: readonly Diagnostic[]) => void
  readonly reportNotice?: (notice: LanguageControllerNotice) => void
}

/** Small native-editor port for applying one exact-version on-type action in order. */
export interface EditorOnTypeEditTarget {
  applyEdits(edits: readonly LanguageTextEdit[]): Promise<boolean>
  moveCursor(position: LanguagePosition): void
  requestCompletion(): Promise<void>
}

/** Copy an editor-native structural position into the plain DTO required by worker RPC. */
export function plainLanguagePosition(position: LanguagePosition): LanguagePosition {
  return { line: position.line, character: position.character }
}

export async function applyEditorOnTypeEditResult(
  result: LanguageOnTypeEditResult,
  target: EditorOnTypeEditTarget,
): Promise<boolean> {
  if (!(await target.applyEdits(result.edits))) return false
  if (result.cursor !== undefined) target.moveCursor(result.cursor)
  if (result.requestCompletion === true) await target.requestCompletion()
  return true
}

export interface LanguageSessionController {
  initialize(): Promise<void>
  supports(document: Pick<EditorLanguageDocument, 'fileName' | 'languageId'>): boolean
  /**
   * The trigger characters the document's own language declares for a feature — not the union a
   * single editor registration carries for every language. Undefined when no route is selected.
   */
  triggerCharacters(
    document: Pick<EditorLanguageDocument, 'fileName' | 'languageId'>,
    feature: 'completion' | 'signatureHelp',
  ): readonly string[] | undefined
  open(document: EditorLanguageDocument): void
  change(document: EditorLanguageDocument): void
  close(uri: string): Promise<void>
  documentSymbols(
    document: EditorLanguageDocument,
    signal?: AbortSignal,
  ): Promise<readonly EditorDocumentSymbol[] | undefined>
  completion(
    document: EditorLanguageDocument,
    position: LanguagePosition,
    signal?: AbortSignal,
  ): Promise<LanguageCompletionList | undefined>
  /** The item the editor focused, filled in: documentation read on demand, its asset drawn. */
  resolveCompletion(
    document: EditorLanguageDocument,
    position: LanguagePosition,
    item: LanguageCompletionItem,
    signal?: AbortSignal,
  ): Promise<LanguageCompletionItem | undefined>
  hover(
    document: EditorLanguageDocument,
    position: LanguagePosition,
    signal?: AbortSignal,
  ): Promise<LanguageHover | undefined>
  signatureHelp(
    document: EditorLanguageDocument,
    position: LanguagePosition,
    signal?: AbortSignal,
  ): Promise<LanguageSignatureHelp | undefined>
  definition(
    document: EditorLanguageDocument,
    position: LanguagePosition,
    signal?: AbortSignal,
  ): Promise<LanguageLocationList | undefined>
  references(
    document: EditorLanguageDocument,
    position: LanguagePosition,
    includeDeclaration: boolean,
    signal?: AbortSignal,
  ): Promise<LanguageLocationList | undefined>
  prepareRename(
    document: EditorLanguageDocument,
    position: LanguagePosition,
    signal?: AbortSignal,
  ): Promise<LanguageRenamePreparation | undefined>
  rename(
    document: EditorLanguageDocument,
    position: LanguagePosition,
    newName: string,
    signal?: AbortSignal,
  ): Promise<LanguageWorkspaceEdit | undefined>
  formatting(
    document: EditorLanguageDocument,
    formatting: LanguageFormattingOptions,
    signal?: AbortSignal,
  ): Promise<LanguageTextEditList | undefined>
  onTypeFormatting(
    document: EditorLanguageDocument,
    position: LanguagePosition,
    ch: string,
    formatting: LanguageFormattingOptions,
    signal?: AbortSignal,
  ): Promise<LanguageOnTypeEditResult | undefined>
  codeActions(
    document: EditorLanguageDocument,
    range: LanguageRange,
    diagnostics: readonly LanguageDiagnostic[],
    signal?: AbortSignal,
  ): Promise<LanguageCodeActionList | undefined>
  documentColors(
    document: EditorLanguageDocument,
    signal?: AbortSignal,
  ): Promise<LanguageColorList | undefined>
  colorPresentations(
    document: EditorLanguageDocument,
    color: LanguageColor,
    range: LanguageRange,
    signal?: AbortSignal,
  ): Promise<LanguageColorPresentationList | undefined>
  codeLenses(
    document: EditorLanguageDocument,
    signal?: AbortSignal,
  ): Promise<LanguageCodeLensList | undefined>
  foldingRanges(
    document: EditorLanguageDocument,
    signal?: AbortSignal,
  ): Promise<LanguageFoldingRangeList | undefined>
  documentLinks(
    document: EditorLanguageDocument,
    signal?: AbortSignal,
  ): Promise<LanguageDocumentLinkList | undefined>
  documentHighlights(
    document: EditorLanguageDocument,
    position: LanguagePosition,
    signal?: AbortSignal,
  ): Promise<LanguageDocumentHighlightList | undefined>
  /** Hints inside `range`, the part of the document the editor shows. */
  inlayHints(
    document: EditorLanguageDocument,
    range: LanguageRange,
    signal?: AbortSignal,
  ): Promise<LanguageInlayHintList | undefined>
  workspaceSymbols(
    query: string,
    signal?: AbortSignal,
  ): Promise<LanguageWorkspaceSymbolList | undefined>
  diagnostics(
    document: EditorLanguageDocument,
    signal?: AbortSignal,
  ): Promise<LanguageDiagnosticList | undefined>
  /** The project files nobody has open, analyzed by the document's provider; on request only. */
  projectDiagnostics(
    document: EditorLanguageDocument,
    signal?: AbortSignal,
  ): Promise<LanguageProjectDiagnostics | undefined>
  /** Explicit verification uses the live buffer and publishes only its current revision. */
  verify(
    document: EditorLanguageDocument,
    signal?: AbortSignal,
  ): Promise<LanguageDiagnosticList | undefined>
  semanticTokens(
    document: EditorLanguageDocument,
    signal?: AbortSignal,
  ): Promise<readonly EditorSemanticToken[] | undefined>
  shutdown(): Promise<void>
}

const EDITOR_MAX_RESULTS = 512
// A mod is the unit these languages resolve against; the host's byte budget is the real bound.
const EDITOR_MAX_DOCUMENTS = LANGUAGE_MAX_DOCUMENTS
const EDITOR_MAX_EDITS = 4_096
/** Most other open documents one edit asks diagnostics for again. */
const RELATED_DIAGNOSTICS_LIMIT = 32

interface Selection {
  readonly state: 'selected'
  readonly route: LanguageProviderRoute
}

interface NoSelection {
  readonly state: 'none' | 'ambiguous'
  readonly routes: readonly LanguageProviderRoute[]
}

type RouteSelection = Selection | NoSelection

interface TrackedDocument {
  document: EditorLanguageDocument
  readonly route: LanguageProviderRoute
  opened: boolean
  /** Opened in an editor: its first analysis runs the semantic diagnostics too. */
  editorOpened?: boolean
  generation: number
  timer?: ReturnType<typeof setTimeout>
  controller?: AbortController
  /** Resolves as soon as the live document version is accepted, before provider analysis. */
  synchronized?: Promise<void>
  /** The exact editor generation accepted by Host, independent of background analysis. */
  synchronizedGeneration?: number
  /** Resolves after provider analysis, before resolved-workspace semantic diagnostics. */
  ready?: Promise<void>
  /** Explicit tokens/hover/Verify requests bypass only the automatic diagnostics idle delay. */
  requestAnalysis?: () => void
  task?: Promise<void>
  taskGeneration?: number
  analysis?: Extract<LanguageWorkspaceAnalysisResult, { readonly state: 'resolved' }>
}

const normalizedExtension = (value: string): string => value.replace(/^\./u, '').toLowerCase()

/**
 * One build per key at a time. A caller that finds its key's build running waits for it and takes
 * what it left (`settled`); when that build failed — a cancelled request's does — the caller builds
 * on its own instead of failing with it.
 */
export async function oneBuildPerKey<T>(
  builds: Map<string, Promise<unknown>>,
  key: string,
  settled: () => T | undefined,
  build: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  for (;;) {
    const done = settled()
    if (done !== undefined) return done
    const running = builds.get(key)
    if (running === undefined) break
    await running.catch(() => undefined)
    signal.throwIfAborted()
  }
  const own = build()
  builds.set(key, own)
  try {
    return await own
  } finally {
    if (builds.get(key) === own) builds.delete(key)
  }
}

/** VS Code glob matching is case-sensitive even on Windows; SC2 uses mixed-case suffixes. */
export function caseInsensitiveExtensionPattern(extension: string): string {
  return caseInsensitiveNamePattern(extension.replace(/^\./u, ''))
}

/** A glob for one exact file name, whatever its case (`Objects`, `preload.xml`). */
export function caseInsensitiveNamePattern(name: string): string {
  return name
    .split('')
    .map(character => {
      const lower = character.toLowerCase()
      const upper = character.toUpperCase()
      return lower === upper ? character : `[${lower}${upper}]`
    })
    .join('')
}

function extensionOf(fileName: string): string | undefined {
  const normalized = fileName.replaceAll('\\', '/')
  const name = normalized.slice(normalized.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 || dot === name.length - 1 ? undefined : normalizedExtension(name.slice(dot + 1))
}

function selectRoute(
  routes: readonly LanguageProviderRoute[],
  document: Pick<EditorLanguageDocument, 'fileName' | 'languageId'>,
): RouteSelection {
  const named = routes.filter(
    route => route.fileName !== undefined && languageRouteServesFile(route, document.fileName),
  )
  if (named.length === 1) return { state: 'selected', route: named[0]! }
  if (named.length > 1) return { state: 'ambiguous', routes: Object.freeze([...named]) }
  const extension = extensionOf(document.fileName)
  const candidates = routes.filter(route => {
    if (route.fileName !== undefined) return false
    const languageMatches = route.languageId === document.languageId
    if (route.extension === undefined) return languageMatches
    const extensionMatches = normalizedExtension(route.extension) === extension
    return extensionMatches
  })
  if (candidates.length === 0) return { state: 'none', routes: Object.freeze([]) }
  const exactLanguage = candidates.filter(route => route.languageId === document.languageId)
  const selected = exactLanguage.length > 0 ? exactLanguage : candidates
  if (selected.length !== 1) {
    return { state: 'ambiguous', routes: Object.freeze([...selected]) }
  }
  const route = selected[0]
  return route === undefined
    ? { state: 'none', routes: Object.freeze([]) }
    : { state: 'selected', route }
}

const sameRoute = (left: LanguageProviderRoute, right: LanguageProviderRoute): boolean =>
  left.languageId === right.languageId &&
  left.documentKind === right.documentKind &&
  left.extension === right.extension &&
  left.fileName === right.fileName

const languageDocument = (
  editor: EditorLanguageDocument,
  route: LanguageProviderRoute,
): LanguageDocument =>
  Object.freeze({
    uri: editor.uri,
    languageId: route.languageId,
    version: editor.version,
    text: editor.text,
    // A game's file association (`.scar` → lua51) names the dialect; the provider need not guess it.
    ...(route.dialect === undefined ? {} : { dialect: route.dialect }),
  })

const requestOf = (
  editor: EditorLanguageDocument,
  route: LanguageProviderRoute,
  signal: AbortSignal,
): LanguageWorkspaceDocumentRequest => ({
  ...route,
  document: languageDocument(editor, route),
  include: { tokens: true, diagnostics: true, symbols: true },
  signal,
})

async function waitWithSignal<Value>(
  promise: Promise<Value>,
  signal?: AbortSignal,
): Promise<Value> {
  throwIfAborted(signal)
  if (signal === undefined) return promise
  return new Promise<Value>((resolve, reject) => {
    const abort = (): void => reject(new OperationCancelledError(signal.reason))
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(
      value => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      error => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

const symbolOf = (symbol: LanguageSymbol): EditorDocumentSymbol =>
  Object.freeze({
    name: symbol.name,
    ...(symbol.detail === undefined ? {} : { detail: symbol.detail }),
    kind: symbol.kind,
    range: symbol.range,
    selectionRange: symbol.selectionRange,
    children: Object.freeze((symbol.children ?? []).map(symbolOf)),
  })

function lineLengths(text: string): readonly number[] {
  return text.split('\n').map(line => (line.endsWith('\r') ? line.length - 1 : line.length))
}

function splitToken(
  token: {
    readonly range: LanguageRange
    readonly kind: LanguageTokenKind
    readonly modifiers?: readonly string[]
  },
  lengths: readonly number[],
): readonly EditorSemanticToken[] {
  const out: EditorSemanticToken[] = []
  const modifiers = Object.freeze(
    (token.modifiers ?? []).filter(modifier => KNOWN_TOKEN_MODIFIERS.has(modifier)),
  )
  for (let line = token.range.start.line; line <= token.range.end.line; line += 1) {
    const lineLength = lengths[line]
    if (lineLength === undefined) break
    const character = line === token.range.start.line ? token.range.start.character : 0
    const end = line === token.range.end.line ? token.range.end.character : lineLength
    if (end <= character) continue
    out.push(
      Object.freeze({
        line,
        character,
        length: end - character,
        tokenType: token.kind,
        modifiers,
      }),
    )
  }
  return Object.freeze(out)
}

function noticeFor(error: unknown, uri: string): LanguageControllerNotice {
  return {
    code: error instanceof ModkitError ? error.code : 'x3.app/vscode-language-failed',
    message: error instanceof Error ? error.message : String(error),
    uri,
  }
}

/** Create the editor-neutral side of the native VS Code language bridge. */
export function createLanguageSessionController(
  options: LanguageSessionControllerOptions,
): LanguageSessionController {
  const documents = new Map<string, TrackedDocument>()
  const refusals = new Map<string, string>()
  const delay = (value: number | (() => number) | undefined, fallback: number): number => {
    const ms = typeof value === 'function' ? value() : value
    return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : fallback
  }
  const debounceMs = (): number => delay(options.debounceMs, 150)
  const semanticDiagnosticsDelayMs = (): number => delay(options.semanticDiagnosticsDelayMs, 0)
  const relatedDiagnosticsDelayMs = options.relatedDiagnosticsDelayMs ?? 750
  let state: 'new' | 'ready' | 'shut-down' = 'new'
  let shutdownPromise: Promise<void> | undefined
  let interactiveRequests = 0
  let interactiveIdle: Promise<void> = Promise.resolve()
  let markInteractiveIdle = (): void => undefined

  const withInteractive = async <Value>(
    operation: () => Promise<Value>,
    signal?: AbortSignal,
  ): Promise<Value> => {
    throwIfAborted(signal)
    if (interactiveRequests === 0) {
      interactiveIdle = new Promise(resolve => {
        markInteractiveIdle = resolve
      })
    }
    interactiveRequests += 1
    try {
      return await waitWithSignal(operation(), signal)
    } finally {
      interactiveRequests -= 1
      if (interactiveRequests === 0) markInteractiveIdle()
    }
  }

  const waitForInteractive = async (signal: AbortSignal): Promise<void> => {
    // An idle timer can expire while a slow worker request is still producing suggestions.
    // Admission is workspace-wide: a second document's diagnostics use that same worker too.
    while (interactiveRequests > 0) await waitWithSignal(interactiveIdle, signal)
    throwIfAborted(signal)
  }

  const requireReady = (): void => {
    if (state !== 'ready') {
      throw new ModkitError({
        code: 'x3.app/vscode-language-controller-unavailable',
        message:
          state === 'new'
            ? 'initialize the VS Code language controller first'
            : 'the VS Code language controller is shut down',
      })
    }
  }

  const clearTimer = (tracked: TrackedDocument): void => {
    if (tracked.timer === undefined) return
    clearTimeout(tracked.timer)
    delete tracked.timer
  }

  const reportResult = (
    tracked: TrackedDocument,
    generation: number,
    result: LanguageWorkspaceAnalysisResult,
    semanticDiagnostics?: readonly EditorLanguageDiagnostic[],
  ): void => {
    if (documents.get(tracked.document.uri) !== tracked || tracked.generation !== generation) return
    options.reportHostDiagnostics?.(tracked.document.uri, result.hostDiagnostics)
    if (result.state === 'unresolved') {
      delete tracked.analysis
      options.publishDiagnostics(tracked.document.uri, [])
      return
    }
    if (
      result.analysis.documentUri !== tracked.document.uri ||
      result.analysis.documentVersion !== tracked.document.version
    ) {
      return
    }
    tracked.analysis = result
    options.publishDiagnostics(
      tracked.document.uri,
      semanticDiagnostics ?? result.analysis.diagnostics,
    )
  }

  /*
   * An edit can break or mend references in the other documents open in editors — an entity
   * removed here leaves a dangling reference there (plan 0.7). Once the edits pause, every other
   * editor document whose own analysis is not running gets its semantic diagnostics again.
   */
  const changedSince = new Set<string>()
  let relatedTimer: ReturnType<typeof setTimeout> | undefined
  let relatedController: AbortController | undefined
  const relatedTasks = new Set<Promise<void>>()
  const retirements = new Set<Promise<void>>()
  const refreshRelated = async (
    changed: ReadonlySet<string>,
    signal: AbortSignal,
  ): Promise<void> => {
    let left = RELATED_DIAGNOSTICS_LIMIT
    for (const tracked of [...documents.values()]) {
      if (state !== 'ready' || left <= 0) return
      const document = tracked.document
      if (changed.has(document.uri) || tracked.editorOpened !== true || !tracked.opened) continue
      if (tracked.task !== undefined) continue
      left -= 1
      try {
        await waitForInteractive(signal)
        if (state !== 'ready' || documents.get(document.uri) !== tracked) return
        if (tracked.document !== document || tracked.task !== undefined) continue
        const answer = await options.workspace.diagnostics({
          uri: document.uri,
          documentVersion: document.version,
          maxResults: EDITOR_MAX_RESULTS,
          maxDocuments: EDITOR_MAX_DOCUMENTS,
          signal,
        })
        throwIfAborted(signal)
        // a newer version, or its own analysis, owns what is published now
        if (documents.get(document.uri) !== tracked || tracked.document !== document) continue
        if (tracked.task !== undefined || answer === undefined) continue
        options.publishDiagnostics(document.uri, answer.diagnostics)
      } catch (error) {
        if (!isCancellation(error)) options.reportNotice?.(noticeFor(error, document.uri))
      }
    }
  }
  const scheduleRelated = (uri: string): void => {
    changedSince.add(uri)
    if (relatedTimer !== undefined) clearTimeout(relatedTimer)
    relatedTimer = setTimeout(() => {
      relatedTimer = undefined
      const changed = new Set(changedSince)
      changedSince.clear()
      relatedController?.abort('new related diagnostics refresh')
      const controller = new AbortController()
      relatedController = controller
      const task = refreshRelated(changed, controller.signal)
      relatedTasks.add(task)
      void task.finally(() => {
        relatedTasks.delete(task)
        if (relatedController === controller) relatedController = undefined
      })
    }, relatedDiagnosticsDelayMs)
  }

  const execute = (tracked: TrackedDocument): Promise<void> => {
    clearTimer(tracked)
    const generation = tracked.generation
    tracked.taskGeneration = generation
    const document = tracked.document
    const route = tracked.route
    const predecessor = tracked.task
    const closing = [...retirements]
    const controller = new AbortController()
    tracked.controller = controller
    let markSynchronized = (): void => undefined
    const synchronized = new Promise<void>(resolve => {
      markSynchronized = resolve
    })
    tracked.synchronized = synchronized
    let markReady = (): void => undefined
    const ready = new Promise<void>(resolve => {
      markReady = resolve
    })
    tracked.ready = ready
    const analysisRequested = new Promise<void>(resolve => {
      tracked.requestAnalysis = resolve
    })
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const task = (async (): Promise<void> => {
      if (predecessor !== undefined) {
        try {
          await predecessor
        } catch {
          // The earlier version owns its report; this version must still get a chance to run.
        }
      }
      try {
        await Promise.all(closing)
        if (
          controller.signal.aborted ||
          documents.get(document.uri) !== tracked ||
          tracked.generation !== generation
        ) {
          throw new OperationCancelledError('stale editor document')
        }
        /*
         * A file an editor opens shows its broken references at once, not after the first edit. A
         * document staged only for a request (a hover, a verification with its own diagnostics
         * call) is analysed without them, as before.
         */
        const refreshSemanticDiagnostics = tracked.opened || tracked.editorOpened === true
        const request = requestOf(document, route, controller.signal)
        const synchronizedResult = await options.workspace.synchronize(request)
        // Even an activation superseded just after acceptance must be closed when retired.
        if (synchronizedResult.state === 'resolved') tracked.opened = true
        throwIfAborted(controller.signal)
        if (documents.get(document.uri) !== tracked || tracked.generation !== generation) {
          throw new OperationCancelledError('stale editor synchronization')
        }
        if (synchronizedResult.state === 'unresolved') {
          options.reportHostDiagnostics?.(document.uri, synchronizedResult.hostDiagnostics)
          options.publishDiagnostics(document.uri, [])
          markSynchronized()
          markReady()
          return
        }
        tracked.synchronizedGeneration = generation
        markSynchronized()
        // Analysis is intentionally idle-delayed. Completion and on-type formatting only need the
        // synchronized live snapshot and should enter the provider worker before background work.
        const idle = semanticDiagnosticsDelayMs()
        if (idle > 0) {
          await waitWithSignal(
            Promise.race([
              analysisRequested,
              new Promise<void>(resolve => {
                idleTimer = setTimeout(resolve, idle)
              }),
            ]),
            controller.signal,
          )
        }
        await waitForInteractive(controller.signal)
        const result = await options.workspace.analyze(request)
        let semanticDiagnostics: readonly EditorLanguageDiagnostic[] | undefined
        if (result.state === 'resolved') {
          reportResult(tracked, generation, result)
          markReady()
          try {
            if (!refreshSemanticDiagnostics) {
              return
            }
            await waitForInteractive(controller.signal)
            semanticDiagnostics = (
              await options.workspace.diagnostics({
                uri: document.uri,
                documentVersion: document.version,
                maxResults: EDITOR_MAX_RESULTS,
                maxDocuments: EDITOR_MAX_DOCUMENTS,
                signal: controller.signal,
              })
            )?.diagnostics
          } catch (error) {
            if (isCancellation(error) || controller.signal.aborted) throw error
            options.reportNotice?.(noticeFor(error, document.uri))
          }
        }
        reportResult(tracked, generation, result, semanticDiagnostics)
        // an edit (not the first analysis of an opened file) may have changed the others' references
        if (generation > 1 && result.state === 'resolved') scheduleRelated(document.uri)
      } catch (error) {
        if (isCancellation(error) || controller.signal.aborted) return
        options.reportNotice?.(noticeFor(error, document.uri))
      } finally {
        if (idleTimer !== undefined) clearTimeout(idleTimer)
        markSynchronized()
        markReady()
        if (tracked.controller === controller) {
          delete tracked.controller
          delete tracked.synchronized
          delete tracked.ready
          delete tracked.requestAnalysis
          delete tracked.task
          delete tracked.taskGeneration
        }
      }
    })()
    tracked.task = task
    return task
  }

  const retire = (tracked: TrackedDocument): Promise<void> => {
    clearTimer(tracked)
    tracked.controller?.abort('editor document retired')
    const task = (async (): Promise<void> => {
      try {
        await tracked.task
      } catch {
        // Cancellation is expected; provider failures were already reported by `execute`.
      }
      if (tracked.opened) await options.workspace.close(tracked.document.uri)
      options.publishDiagnostics(tracked.document.uri, [])
    })()
    retirements.add(task)
    void task.then(
      () => retirements.delete(task),
      () => retirements.delete(task),
    )
    return task
  }

  const stage = (
    document: EditorLanguageDocument,
    immediate: boolean,
    editorOpened = false,
  ): TrackedDocument | undefined => {
    requireReady()
    const selection = selectRoute(options.routes, document)
    const prior = documents.get(document.uri)
    if (selection.state !== 'selected') {
      if (prior !== undefined) {
        documents.delete(document.uri)
        void retire(prior)
      } else {
        options.publishDiagnostics(document.uri, [])
      }
      if (selection.state === 'ambiguous') {
        const refusal = `${document.version}:${document.languageId}:${document.fileName}`
        if (refusals.get(document.uri) !== refusal) {
          refusals.set(document.uri, refusal)
          options.reportNotice?.({
            code: 'x3.app/vscode-language-route-ambiguous',
            message: `more than one configured language route matches ${document.fileName}`,
            uri: document.uri,
          })
        }
      }
      return undefined
    }
    refusals.delete(document.uri)

    if (prior !== undefined && sameRoute(prior.route, selection.route)) {
      if (document.version < prior.document.version) return prior
      if (document.version === prior.document.version && document.text === prior.document.text) {
        if (
          immediate &&
          prior.analysis === undefined &&
          (prior.task === undefined || prior.taskGeneration !== prior.generation)
        ) {
          void execute(prior)
        }
        return prior
      }
      prior.document = document
      prior.generation += 1
      relatedController?.abort('editor document changed')
      delete prior.analysis
      prior.controller?.abort('editor document changed')
      clearTimer(prior)
      const wait = debounceMs()
      if (immediate || wait === 0) void execute(prior)
      else prior.timer = setTimeout(() => void execute(prior), wait)
      return prior
    }

    const tracked: TrackedDocument = {
      document,
      route: selection.route,
      opened: false,
      ...(editorOpened ? { editorOpened } : {}),
      generation: 1,
    }
    documents.set(document.uri, tracked)
    if (prior !== undefined) {
      tracked.task = retire(prior)
    }
    const wait = debounceMs()
    if (immediate || wait === 0) void execute(tracked)
    else tracked.timer = setTimeout(() => void execute(tracked), wait)
    return tracked
  }

  /** Flush editor snapshots across languages, without waiting for idle analysis/diagnostics. */
  const synchronizeWorkspace = async (signal?: AbortSignal): Promise<boolean> => {
    for (;;) {
      throwIfAborted(signal)
      requireReady()
      const pending = [...documents.values()]
        .filter(tracked => tracked.synchronizedGeneration !== tracked.generation)
        .map(tracked => ({ tracked, generation: tracked.generation }))
      if (pending.length === 0 && retirements.size === 0) return true
      for (const { tracked } of pending) {
        if (tracked.task === undefined || tracked.taskGeneration !== tracked.generation) {
          void execute(tracked)
        }
      }
      await waitWithSignal(
        Promise.all([
          ...retirements,
          ...pending.map(({ tracked }) => tracked.synchronized ?? tracked.task),
        ]),
        signal,
      )
      throwIfAborted(signal)
      // A failed current synchronization must never expose its predecessor's old Host buffer.
      if (
        pending.some(
          ({ tracked, generation }) =>
            documents.get(tracked.document.uri) === tracked &&
            tracked.generation === generation &&
            tracked.synchronizedGeneration !== generation,
        )
      )
        return false
      // Edits/open/close received during activation belong to the next pass of this same barrier.
    }
  }

  const ensure = async (
    document: EditorLanguageDocument,
    signal?: AbortSignal,
  ): Promise<
    Extract<LanguageWorkspaceAnalysisResult, { readonly state: 'resolved' }> | undefined
  > => {
    const tracked = stage(document, true)
    if (tracked === undefined) return undefined
    if (tracked.document.version !== document.version) {
      throw new OperationCancelledError('stale editor document')
    }
    const ready = tracked.ready ?? tracked.task
    if (!(await synchronizeWorkspace(signal))) return undefined
    if (documents.get(document.uri) !== tracked || tracked.document.version !== document.version) {
      throw new OperationCancelledError('stale editor document')
    }
    if (tracked.analysis !== undefined) return tracked.analysis
    tracked.requestAnalysis?.()
    const abort = (): void => tracked.controller?.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      if (ready !== undefined) await waitWithSignal(ready, signal)
    } finally {
      signal?.removeEventListener('abort', abort)
    }
    throwIfAborted(signal)
    if (documents.get(document.uri) !== tracked || tracked.document.version !== document.version) {
      throw new OperationCancelledError('stale editor document')
    }
    return tracked.analysis
  }

  /** Exact-version request using the interactive or whole-document result ceiling. */
  const featureRequest = (
    document: EditorLanguageDocument,
    signal?: AbortSignal,
    maxResults = EDITOR_MAX_RESULTS,
  ) => ({
    uri: document.uri,
    documentVersion: document.version,
    maxResults,
    maxDocuments: EDITOR_MAX_DOCUMENTS,
    ...(signal === undefined ? {} : { signal }),
  })

  const prepareInteractive = async (
    document: EditorLanguageDocument,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    const tracked = stage(document, true)
    if (tracked === undefined) return false
    if (tracked.document.version !== document.version) {
      throw new OperationCancelledError('stale editor document')
    }
    if (!(await synchronizeWorkspace(signal))) return false
    if (documents.get(document.uri) !== tracked || tracked.document.version !== document.version) {
      throw new OperationCancelledError('stale editor document')
    }
    return tracked.opened
  }

  const diagnosticsFor = async (
    document: EditorLanguageDocument,
    signal?: AbortSignal,
    publish = false,
  ): Promise<LanguageDiagnosticList | undefined> => {
    const result = await ensure(document, signal)
    if (result === undefined) return undefined
    const tracked = documents.get(document.uri)
    if (tracked === undefined || tracked.document.version !== document.version) {
      throw new OperationCancelledError('stale editor document')
    }
    const semantic = await waitWithSignal(
      options.workspace.diagnostics({
        uri: document.uri,
        documentVersion: document.version,
        maxResults: EDITOR_MAX_RESULTS,
        maxDocuments: EDITOR_MAX_DOCUMENTS,
        ...(signal === undefined ? {} : { signal }),
      }),
      signal,
    )
    throwIfAborted(signal)
    if (documents.get(document.uri) !== tracked || tracked.document.version !== document.version) {
      throw new OperationCancelledError('stale editor document')
    }
    const diagnostics = semantic ?? {
      diagnostics: result.analysis.diagnostics,
      isIncomplete: true,
    }
    if (publish) options.publishDiagnostics(document.uri, diagnostics.diagnostics)
    return diagnostics
  }

  return Object.freeze({
    supports(document: Pick<EditorLanguageDocument, 'fileName' | 'languageId'>): boolean {
      return state !== 'shut-down' && selectRoute(options.routes, document).state === 'selected'
    },
    triggerCharacters(
      document: Pick<EditorLanguageDocument, 'fileName' | 'languageId'>,
      feature: 'completion' | 'signatureHelp',
    ): readonly string[] | undefined {
      const selection = selectRoute(options.routes, document)
      if (selection.state !== 'selected') return undefined
      return feature === 'completion'
        ? (selection.route.completionTriggerCharacters ?? [])
        : (selection.route.signatureHelpTriggerCharacters ?? [])
    },
    async initialize(): Promise<void> {
      if (state === 'shut-down') {
        throw new ModkitError({
          code: 'x3.app/vscode-language-controller-unavailable',
          message: 'the VS Code language controller is shut down',
        })
      }
      if (state === 'ready') return
      await options.workspace.initialize()
      state = 'ready'
    },

    open(document: EditorLanguageDocument): void {
      stage(document, false, true)
    },

    change(document: EditorLanguageDocument): void {
      stage(document, false)
    },

    async close(uri: string): Promise<void> {
      requireReady()
      const tracked = documents.get(uri)
      if (tracked === undefined) {
        options.publishDiagnostics(uri, [])
        return
      }
      documents.delete(uri)
      relatedController?.abort('editor document closed')
      refusals.delete(uri)
      await retire(tracked)
    },

    async documentSymbols(
      document: EditorLanguageDocument,
      signal?: AbortSignal,
    ): Promise<readonly EditorDocumentSymbol[] | undefined> {
      const result = await ensure(document, signal)
      if (result === undefined) return undefined
      const semantic = await options.workspace.documentSymbols({
        uri: document.uri,
        documentVersion: document.version,
        maxResults: LANGUAGE_MAX_DOCUMENT_RESULTS,
        maxDocuments: EDITOR_MAX_DOCUMENTS,
        ...(signal === undefined ? {} : { signal }),
      })
      const symbols = semantic?.symbols ?? result.analysis.symbols
      return Object.freeze(symbols.map(symbolOf))
    },

    async completion(
      document: EditorLanguageDocument,
      position: LanguagePosition,
      signal?: AbortSignal,
    ): Promise<LanguageCompletionList | undefined> {
      return withInteractive(async () => {
        if (!(await prepareInteractive(document, signal))) return undefined
        return options.workspace.completion({
          uri: document.uri,
          documentVersion: document.version,
          position,
          maxResults: EDITOR_MAX_RESULTS,
          maxDocuments: EDITOR_MAX_DOCUMENTS,
          semanticContextPolicy: 'cached',
          ...(signal === undefined ? {} : { signal }),
        })
      }, signal)
    },

    async resolveCompletion(
      document: EditorLanguageDocument,
      position: LanguagePosition,
      item: LanguageCompletionItem,
      signal?: AbortSignal,
    ): Promise<LanguageCompletionItem | undefined> {
      return withInteractive(async () => {
        if (!(await prepareInteractive(document, signal))) return undefined
        return options.workspace.resolveCompletion({
          ...featureRequest(document, signal),
          position,
          item,
        })
      }, signal)
    },

    async projectDiagnostics(
      document: EditorLanguageDocument,
      signal?: AbortSignal,
    ): Promise<LanguageProjectDiagnostics | undefined> {
      if ((await ensure(document, signal)) === undefined) return undefined
      return options.workspace.projectDiagnostics(featureRequest(document, signal))
    },

    async hover(
      document: EditorLanguageDocument,
      position: LanguagePosition,
      signal?: AbortSignal,
    ): Promise<LanguageHover | undefined> {
      const result = await ensure(document, signal)
      if (result === undefined) return undefined
      return options.workspace.hover({
        uri: document.uri,
        documentVersion: document.version,
        position,
        maxResults: EDITOR_MAX_RESULTS,
        maxDocuments: EDITOR_MAX_DOCUMENTS,
        ...(signal === undefined ? {} : { signal }),
      })
    },

    async signatureHelp(
      document: EditorLanguageDocument,
      position: LanguagePosition,
      signal?: AbortSignal,
    ): Promise<LanguageSignatureHelp | undefined> {
      const result = await ensure(document, signal)
      if (result === undefined) return undefined
      return options.workspace.signatureHelp({
        uri: document.uri,
        documentVersion: document.version,
        position,
        maxResults: EDITOR_MAX_RESULTS,
        maxDocuments: EDITOR_MAX_DOCUMENTS,
        ...(signal === undefined ? {} : { signal }),
      })
    },

    async definition(
      document: EditorLanguageDocument,
      position: LanguagePosition,
      signal?: AbortSignal,
    ): Promise<LanguageLocationList | undefined> {
      const result = await ensure(document, signal)
      if (result === undefined) return undefined
      return options.workspace.definition({
        uri: document.uri,
        documentVersion: document.version,
        position,
        maxResults: EDITOR_MAX_RESULTS,
        maxDocuments: EDITOR_MAX_DOCUMENTS,
        ...(signal === undefined ? {} : { signal }),
      })
    },

    async references(
      document: EditorLanguageDocument,
      position: LanguagePosition,
      includeDeclaration: boolean,
      signal?: AbortSignal,
    ): Promise<LanguageLocationList | undefined> {
      const result = await ensure(document, signal)
      if (result === undefined) return undefined
      return options.workspace.references({
        uri: document.uri,
        documentVersion: document.version,
        position,
        includeDeclaration,
        maxResults: EDITOR_MAX_RESULTS,
        maxDocuments: EDITOR_MAX_DOCUMENTS,
        ...(signal === undefined ? {} : { signal }),
      })
    },

    async prepareRename(
      document: EditorLanguageDocument,
      position: LanguagePosition,
      signal?: AbortSignal,
    ): Promise<LanguageRenamePreparation | undefined> {
      const result = await ensure(document, signal)
      if (result === undefined) return undefined
      return options.workspace.prepareRename({
        uri: document.uri,
        documentVersion: document.version,
        position,
        maxResults: EDITOR_MAX_RESULTS,
        maxDocuments: EDITOR_MAX_DOCUMENTS,
        ...(signal === undefined ? {} : { signal }),
      })
    },

    async rename(
      document: EditorLanguageDocument,
      position: LanguagePosition,
      newName: string,
      signal?: AbortSignal,
    ): Promise<LanguageWorkspaceEdit | undefined> {
      const result = await ensure(document, signal)
      if (result === undefined) return undefined
      return options.workspace.rename({
        uri: document.uri,
        documentVersion: document.version,
        position,
        newName,
        maxResults: EDITOR_MAX_RESULTS,
        maxDocuments: EDITOR_MAX_DOCUMENTS,
        maxEdits: EDITOR_MAX_EDITS,
        ...(signal === undefined ? {} : { signal }),
      })
    },

    async formatting(
      document: EditorLanguageDocument,
      formatting: LanguageFormattingOptions,
      signal?: AbortSignal,
    ): Promise<LanguageTextEditList | undefined> {
      const result = await ensure(document, signal)
      if (result === undefined) return undefined
      return options.workspace.formatting({
        uri: document.uri,
        documentVersion: document.version,
        options: formatting,
        maxResults: EDITOR_MAX_RESULTS,
        maxDocuments: EDITOR_MAX_DOCUMENTS,
        ...(signal === undefined ? {} : { signal }),
      })
    },

    async onTypeFormatting(
      document: EditorLanguageDocument,
      position: LanguagePosition,
      ch: string,
      formatting: LanguageFormattingOptions,
      signal?: AbortSignal,
    ): Promise<LanguageOnTypeEditResult | undefined> {
      return withInteractive(async () => {
        if (!(await prepareInteractive(document, signal))) return undefined
        return options.workspace.onTypeFormatting({
          uri: document.uri,
          documentVersion: document.version,
          position,
          ch,
          options: formatting,
          maxResults: EDITOR_MAX_RESULTS,
          maxDocuments: EDITOR_MAX_DOCUMENTS,
          semanticContextPolicy: 'cached',
          ...(signal === undefined ? {} : { signal }),
        })
      }, signal)
    },

    async codeActions(
      document: EditorLanguageDocument,
      range: LanguageRange,
      diagnostics: readonly LanguageDiagnostic[],
      signal?: AbortSignal,
    ): Promise<LanguageCodeActionList | undefined> {
      const result = await ensure(document, signal)
      if (result === undefined) return undefined
      return options.workspace.codeActions({
        uri: document.uri,
        documentVersion: document.version,
        range,
        diagnostics,
        maxResults: EDITOR_MAX_RESULTS,
        maxDocuments: EDITOR_MAX_DOCUMENTS,
        maxEdits: EDITOR_MAX_EDITS,
        ...(signal === undefined ? {} : { signal }),
      })
    },

    async documentColors(
      document: EditorLanguageDocument,
      signal?: AbortSignal,
    ): Promise<LanguageColorList | undefined> {
      const result = await ensure(document, signal)
      if (result === undefined) return undefined
      return options.workspace.documentColors({
        uri: document.uri,
        documentVersion: document.version,
        maxResults: LANGUAGE_MAX_DOCUMENT_RESULTS,
        maxDocuments: EDITOR_MAX_DOCUMENTS,
        ...(signal === undefined ? {} : { signal }),
      })
    },

    async colorPresentations(
      document: EditorLanguageDocument,
      color: LanguageColor,
      range: LanguageRange,
      signal?: AbortSignal,
    ): Promise<LanguageColorPresentationList | undefined> {
      const result = await ensure(document, signal)
      if (result === undefined) return undefined
      return options.workspace.colorPresentations({
        uri: document.uri,
        documentVersion: document.version,
        color,
        range,
        maxResults: EDITOR_MAX_RESULTS,
        maxDocuments: EDITOR_MAX_DOCUMENTS,
        ...(signal === undefined ? {} : { signal }),
      })
    },

    async codeLenses(
      document: EditorLanguageDocument,
      signal?: AbortSignal,
    ): Promise<LanguageCodeLensList | undefined> {
      if ((await ensure(document, signal)) === undefined) return undefined
      return options.workspace.codeLenses(featureRequest(document, signal, LANGUAGE_MAX_DOCUMENT_RESULTS))
    },

    async foldingRanges(
      document: EditorLanguageDocument,
      signal?: AbortSignal,
    ): Promise<LanguageFoldingRangeList | undefined> {
      if ((await ensure(document, signal)) === undefined) return undefined
      return options.workspace.foldingRanges(featureRequest(document, signal, LANGUAGE_MAX_DOCUMENT_RESULTS))
    },

    async documentLinks(
      document: EditorLanguageDocument,
      signal?: AbortSignal,
    ): Promise<LanguageDocumentLinkList | undefined> {
      if ((await ensure(document, signal)) === undefined) return undefined
      return options.workspace.documentLinks(featureRequest(document, signal, LANGUAGE_MAX_DOCUMENT_RESULTS))
    },

    async documentHighlights(
      document: EditorLanguageDocument,
      position: LanguagePosition,
      signal?: AbortSignal,
    ): Promise<LanguageDocumentHighlightList | undefined> {
      if ((await ensure(document, signal)) === undefined) return undefined
      return options.workspace.documentHighlights({
        ...featureRequest(document, signal),
        position,
      })
    },

    async inlayHints(
      document: EditorLanguageDocument,
      range: LanguageRange,
      signal?: AbortSignal,
    ): Promise<LanguageInlayHintList | undefined> {
      if ((await ensure(document, signal)) === undefined) return undefined
      return options.workspace.inlayHints({ ...featureRequest(document, signal), range })
    },

    async workspaceSymbols(
      query: string,
      signal?: AbortSignal,
    ): Promise<LanguageWorkspaceSymbolList | undefined> {
      requireReady()
      const tracked = documents.values().next().value as TrackedDocument | undefined
      if (tracked === undefined) return undefined
      const result = await ensure(tracked.document, signal)
      if (result === undefined) return undefined
      return options.workspace.workspaceSymbols({
        uri: tracked.document.uri,
        documentVersion: tracked.document.version,
        query,
        maxResults: EDITOR_MAX_RESULTS,
        maxDocuments: EDITOR_MAX_DOCUMENTS,
        ...(signal === undefined ? {} : { signal }),
      })
    },

    async diagnostics(
      document: EditorLanguageDocument,
      signal?: AbortSignal,
    ): Promise<LanguageDiagnosticList | undefined> {
      return diagnosticsFor(document, signal)
    },

    async verify(
      document: EditorLanguageDocument,
      signal?: AbortSignal,
    ): Promise<LanguageDiagnosticList | undefined> {
      return diagnosticsFor(document, signal, true)
    },

    async semanticTokens(
      document: EditorLanguageDocument,
      signal?: AbortSignal,
    ): Promise<readonly EditorSemanticToken[] | undefined> {
      const result = await ensure(document, signal)
      if (result === undefined) return undefined
      const lengths = lineLengths(document.text)
      return Object.freeze(result.analysis.tokens.flatMap(token => splitToken(token, lengths)))
    },

    shutdown(): Promise<void> {
      if (shutdownPromise !== undefined) return shutdownPromise
      state = 'shut-down'
      if (relatedTimer !== undefined) clearTimeout(relatedTimer)
      relatedController?.abort('VS Code language controller shut down')
      changedSince.clear()
      shutdownPromise = (async () => {
        const tracked = [...documents.values()]
        documents.clear()
        refusals.clear()
        for (const document of tracked) {
          clearTimer(document)
          document.controller?.abort('VS Code language controller shut down')
        }
        await Promise.all(tracked.map(retire))
        await Promise.all(retirements)
        await Promise.all(relatedTasks)
        await options.workspace.shutdown()
      })()
      return shutdownPromise
    },
  })
}
