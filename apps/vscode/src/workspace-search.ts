/**
 * VS Code's own search over Modkit folders: quick open (Ctrl+P) and Find in Files (Ctrl+Shift+F)
 * inside a mounted content source (`modkit-source:`, the game's CASC storage among them) or
 * container (`modkit-container:`, an archive), as they work in a folder on disk.
 *
 * VS Code searches a scheme only through a search provider registered for it — the Explorer's
 * FileSystemProvider is not used — and without one it skips the folder silently. The provider API
 * is still a proposal (`fileSearchProvider`, `textSearchProvider`), available to an extension
 * when VS Code runs with `--enable-proposed-api modkit.modkit-vscode`; without the switch the
 * folders stay browsable and unsearched, as before, and the log says why.
 */

import * as vscode from 'vscode'

import {
  createQuickOpenRanking,
  decodeText,
  findTextMatches,
  globMatcher,
  looksBinary,
  quickOpenNeedle,
  textSearchRegExp,
  type LineRange,
} from './workspace-search-core.js'

/** One file beneath a searched folder; `path` is relative to it and `/`-separated. */
export interface SearchFolderFile {
  readonly path: string
  readonly size?: number
}

/** What a Modkit folder scheme answers a search with. */
export interface WorkspaceSearchBackend {
  /**
   * The files beneath `folder`, page by page. `pattern` and `extensions` are what the query
   * already rules out; a backend that cannot narrow may ignore them — the provider checks again.
   */
  files(
    folder: vscode.Uri,
    query: { readonly pattern?: string; readonly extensions?: readonly string[] },
    signal: AbortSignal,
  ): AsyncIterable<readonly SearchFolderFile[]>
  read(folder: vscode.Uri, path: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array>
}

/** Files read at once by one text search: a CASC read is a disk read and a decode. */
const TEXT_SEARCH_READS = 8
/** Larger files are skipped unless the search sets its own `search.maxFileSize`. */
const DEFAULT_MAX_FILE_BYTES = 32 * 1024 * 1024
/** The most a content source reads of one file. */
const MAX_READ_BYTES = 64 * 1024 * 1024
const DEFAULT_PREVIEW = { matchLines: 100, charsPerLine: 10_000 }

/**
 * Extensions every installed extension names as a language — `xml`, `txt`, `json`, `lua`, and
 * Modkit's `galaxy`, `sc2layout`, … — plus files with none (`Objects`, `DocumentInfo`). A text
 * search with no "files to include" reads these: the game's storage holds 58 GB of video and
 * 29 GB of textures, and reading them only to find they are binary is not a search.
 */
export function textFileExtensions(): readonly string[] {
  // Plain text is VS Code's own language, not one an extension contributes.
  const extensions = new Set(['', 'txt'])
  for (const extension of vscode.extensions.all) {
    const contributes = (extension.packageJSON as { contributes?: { languages?: unknown } })
      .contributes
    const languages = Array.isArray(contributes?.languages) ? contributes.languages : []
    for (const language of languages as { extensions?: unknown }[]) {
      if (!Array.isArray(language.extensions)) continue
      for (const item of language.extensions) {
        if (typeof item !== 'string') continue
        const name = item.replace(/^\./u, '').toLowerCase()
        if (/^[a-z0-9_-]{1,32}$/u.test(name)) extensions.add(name)
      }
    }
  }
  return [...extensions].sort()
}

function abortOn(token: vscode.CancellationToken): AbortSignal {
  const controller = new AbortController()
  if (token.isCancellationRequested) controller.abort()
  else token.onCancellationRequested(() => controller.abort())
  return controller.signal
}

const toRange = (range: LineRange) =>
  new vscode.Range(range.startLine, range.startCharacter, range.endLine, range.endCharacter)

const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * Register quick open and Find in Files for one scheme. Returns undefined when this VS Code does
 * not grant the proposed search API to Modkit.
 */
export function registerWorkspaceSearch(
  scheme: string,
  backend: WorkspaceSearchBackend,
  log: (message: string) => void,
): vscode.Disposable | undefined {
  const uriOf = (folder: vscode.Uri, path: string) =>
    vscode.Uri.joinPath(folder, ...path.split('/').filter(part => part !== ''))
  let textExtensions: readonly string[] | undefined

  const fileSearch: vscode.FileSearchProvider = {
    async provideFileSearchResults(query, options, token) {
      const signal = abortOn(token)
      const include = options.includes.length > 0 ? globMatcher(options.includes) : undefined
      const exclude = globMatcher(options.excludes)
      const ranking = createQuickOpenRanking(query.pattern, options.maxResults ?? 512)
      const needle = quickOpenNeedle(query.pattern)
      try {
        for await (const page of backend.files(
          options.folder,
          needle === '' ? {} : { pattern: needle },
          signal,
        )) {
          for (const file of page) {
            if (exclude(file.path) || (include !== undefined && !include(file.path))) continue
            ranking.add(file.path)
          }
          if (ranking.full || token.isCancellationRequested) break
        }
      } catch (error) {
        if (!token.isCancellationRequested) log(`[search] ${options.folder.toString()}: ${String(error)}`)
      }
      return ranking.results().map(path => uriOf(options.folder, path))
    },
  }

  const textSearch: vscode.TextSearchProvider = {
    async provideTextSearchResults(query, options, progress, token) {
      const signal = abortOn(token)
      const regexp = textSearchRegExp(query)
      const include = options.includes.length > 0 ? globMatcher(options.includes) : undefined
      const exclude = globMatcher(options.excludes)
      textExtensions ??= textFileExtensions()
      const known = include === undefined ? new Set(textExtensions) : undefined
      const maxBytes = Math.min(options.maxFileSize ?? DEFAULT_MAX_FILE_BYTES, MAX_READ_BYTES)
      const preview = options.previewOptions ?? DEFAULT_PREVIEW
      let remaining = options.maxResults
      let limitHit = false
      let skipped = 0

      const scan = async (file: SearchFolderFile): Promise<void> => {
        if (remaining <= 0 || signal.aborted) return
        let bytes: Uint8Array
        try {
          bytes = await backend.read(options.folder, file.path, maxBytes, signal)
        } catch {
          skipped++
          return
        }
        if (remaining <= 0 || signal.aborted || looksBinary(bytes)) return
        const found = findTextMatches(decodeText(bytes, options.encoding), regexp, {
          multiline: query.isMultiline === true,
          maximum: remaining,
          preview,
        })
        remaining -= found.matches
        if (found.limitHit) limitHit = true
        const uri = uriOf(options.folder, file.path)
        for (const hit of found.hits) {
          progress.report({
            uri,
            ranges: hit.ranges.map(toRange),
            preview: { text: hit.previewText, matches: hit.previewRanges.map(toRange) },
          })
        }
      }

      const reading = new Set<Promise<void>>()
      try {
        for await (const page of backend.files(
          options.folder,
          known === undefined ? {} : { extensions: [...known] },
          signal,
        )) {
          for (const file of page) {
            if (remaining <= 0 || signal.aborted) break
            if (exclude(file.path) || (include !== undefined && !include(file.path))) continue
            if (known !== undefined && !known.has(extensionOf(file.path))) continue
            if (file.size !== undefined && file.size > maxBytes) continue
            if (reading.size >= TEXT_SEARCH_READS) await Promise.race(reading)
            const task: Promise<void> = scan(file).finally(() => reading.delete(task))
            reading.add(task)
          }
          if (remaining <= 0 || signal.aborted) break
        }
        await Promise.all(reading)
      } catch (error) {
        if (!signal.aborted) throw error
      }
      if (remaining <= 0) limitHit = true
      if (skipped > 0) log(`[search] ${options.folder.toString()}: ${skipped} file(s) could not be read`)
      return { limitHit }
    },
  }

  const registered: vscode.Disposable[] = []
  try {
    registered.push(vscode.workspace.registerFileSearchProvider(scheme, fileSearch))
    registered.push(vscode.workspace.registerTextSearchProvider(scheme, textSearch))
    return vscode.Disposable.from(...registered)
  } catch (error) {
    for (const item of registered) item.dispose()
    log(
      `[search] ${scheme}: folders are browsable but not searchable from VS Code's search — ` +
        'start VS Code with --enable-proposed-api modkit.modkit-vscode ' +
        `(${error instanceof Error ? error.message : String(error)})`,
    )
    return undefined
  }
}
