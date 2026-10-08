import { opendir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type {
  LanguageProviderRoute,
  LanguageWorkspaceDocumentSource,
  LanguageWorkspaceDocumentSourceRequest,
} from '../language/index.js'
import {
  createLanguageFileClassifier,
  languageDocumentSnapshot,
  languageDocumentTextToken,
  languageWorkspaceContextToken,
} from '../language/index.js'
import type { LanguageDocument, LanguageWorkspaceDocumentOrigin } from '@modkit/sdk/language'

export interface FilesystemLanguageDocumentSourceOptions {
  readonly roots: readonly string[]
  readonly routes: readonly LanguageProviderRoute[]
  readonly maxDocumentBytes: number
  readonly maxWorkspaceBytes: number
  readonly maxVisitedEntries?: number
}

export interface FilesystemLanguageDocumentSource extends LanguageWorkspaceDocumentSource {
  /** Identify an open file using the same overlay slots and precedence as filesystem snapshots. */
  origin(document: LanguageDocument): LanguageWorkspaceDocumentOrigin | undefined
}

const ignoredDirectory = (name: string): boolean => name === '.git' || name === 'node_modules'

export function createFilesystemLanguageDocumentSource(
  options: FilesystemLanguageDocumentSourceOptions,
): FilesystemLanguageDocumentSource {
  const versions = new Map<string, { signature: string; version: number }>()
  // Still read disk on every request; only equal text may reuse an owner capture and its token.
  let captures = new Map<string, LanguageDocument>()
  const captureBudget = Math.min(options.maxWorkspaceBytes, 256 * 1024 * 1024)
  const classify = createLanguageFileClassifier(options.routes)
  const maxVisitedEntries = options.maxVisitedEntries ?? 16_384
  const roots = options.roots.map(root => resolve(root))
  const contextId = languageWorkspaceContextToken({
    roots: roots.map(root => pathToFileURL(root).href),
  })
  const located = (path: string): { logicalId: string; precedence: number } | undefined => {
    for (let precedence = roots.length - 1; precedence >= 0; precedence -= 1) {
      const root = roots[precedence]
      if (root === undefined) continue
      const logicalPath = relative(root, path)
      if (
        logicalPath === '' ||
        logicalPath === '..' ||
        logicalPath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
        isAbsolute(logicalPath)
      ) {
        continue
      }
      return { logicalId: logicalPath.replaceAll('\\', '/'), precedence }
    }
    return undefined
  }
  return Object.freeze({
    origin(document: LanguageDocument) {
      let path: string
      try {
        path = fileURLToPath(document.uri)
      } catch {
        return undefined
      }
      const location = located(resolve(path))
      return location === undefined
        ? undefined
        : Object.freeze({
            uri: document.uri,
            layerId: `${contextId}:root:${location.precedence}`,
            ...location,
            sourceRevision: String(document.version),
            readOnly: false,
            overlay: true,
          })
    },
    async snapshot(request: LanguageWorkspaceDocumentSourceRequest) {
      request.signal.throwIfAborted()
      if (request.maxDocuments === 0) return { documents: Object.freeze([]), isComplete: false }
      const accepted = new Set(request.workspaceLanguageIds)
      // A file-name route (a game's `Objects`) wins over extension routes; an extension more than
      // one language claims decides nothing.
      const languageOf = (path: string): string | undefined => {
        const { languageId } = classify(path)
        return languageId !== undefined && accepted.has(languageId) ? languageId : undefined
      }
      const fileRoutes = options.routes.filter(
        route => route.extension !== undefined || route.fileName !== undefined,
      )
      const routable = fileRoutes.filter(
        route =>
          accepted.has(route.languageId) &&
          (route.fileName !== undefined ||
            classify(`x.${route.extension}`).languageId === route.languageId),
      )
      // Nothing this snapshot wants can be told apart: an honest empty snapshot, incomplete when
      // files of those kinds may exist.
      if (routable.length === 0) {
        return { documents: Object.freeze([]), isComplete: fileRoutes.length === 0 }
      }
      // The document under the cursor is open too, and the host rejects a snapshot that repeats it.
      const openUris = new Set([
        request.document.uri,
        ...request.workspaceDocuments.map(document => document.uri),
      ])
      const candidates: { path: string; logicalId: string; precedence: number }[] = []
      let visited = 0
      let complete = true
      const walk = async (directory: string, precedence: number): Promise<void> => {
        if (!complete && candidates.length >= request.maxDocuments) return
        request.signal.throwIfAborted()
        let handle
        try {
          handle = await opendir(directory)
        } catch {
          complete = false
          return
        }
        for await (const entry of handle) {
          request.signal.throwIfAborted()
          visited += 1
          if (visited > maxVisitedEntries) {
            complete = false
            return
          }
          const path = join(directory, entry.name)
          if (entry.isDirectory() && !ignoredDirectory(entry.name)) await walk(path, precedence)
          else if (entry.isFile()) {
            if (languageOf(entry.name) === undefined) continue
            const uri = pathToFileURL(path).href
            if (!openUris.has(uri)) {
              const root = roots[precedence]
              if (root === undefined) continue
              const logicalPath = relative(root, path)
              if (logicalPath !== '' && !logicalPath.startsWith('..') && !isAbsolute(logicalPath)) {
                candidates.push({
                  path,
                  logicalId: logicalPath.replaceAll('\\', '/'),
                  precedence,
                })
              }
            }
            if (candidates.length > request.maxDocuments) {
              complete = false
              return
            }
          }
        }
      }
      for (const [precedence, root] of roots.entries()) await walk(root, precedence)
      /*
       * The snapshot is bounded by bytes, so order decides what survives the budget. Documents of
       * the request's own language come first: a layout resolves its templates against other
       * layouts, and losing them to unrelated scripts or catalogs that merely sort earlier turns a
       * resolvable reference into a reported error. The rest are interleaved by language rather
       * than sorted by path, so one large language cannot spend the remaining budget alone — in
       * Blizzard's core mod the scripts alphabetically precede the layouts and are nine megabytes.
       */
      const primaryLanguage = request.document.languageId
      const languageOfCandidate = (candidate: (typeof candidates)[number]): string =>
        languageOf(candidate.path) ?? ''
      const byLanguage = new Map<string, typeof candidates>()
      for (const candidate of candidates.sort((left, right) =>
        left.path.localeCompare(right.path),
      )) {
        const language = languageOfCandidate(candidate)
        const group = byLanguage.get(language)
        if (group === undefined) byLanguage.set(language, [candidate])
        else group.push(candidate)
      }
      const ranked = byLanguage.get(primaryLanguage) ?? []
      const others = [...byLanguage.entries()]
        .filter(([language]) => language !== primaryLanguage)
        .map(([, paths]) => paths)
      for (let index = 0; others.some(paths => index < paths.length); index += 1)
        for (const paths of others)
          if (index < paths.length) ranked.push(paths[index] as (typeof candidates)[number])
      const documents = []
      const nextCaptures = new Map<string, LanguageDocument>()
      let captureBytes = 0
      const documentOrigins: LanguageWorkspaceDocumentOrigin[] = []
      let totalBytes = 0
      for (const candidate of ranked.slice(0, request.maxDocuments)) {
        request.signal.throwIfAborted()
        const { path } = candidate
        const info = await stat(path)
        if (
          info.size > options.maxDocumentBytes ||
          totalBytes + info.size > options.maxWorkspaceBytes
        ) {
          complete = false
          continue
        }
        const bytes = await readFile(path)
        // A file may grow between stat and read; the actual bytes must fit too.
        if (
          bytes.byteLength > options.maxDocumentBytes ||
          totalBytes + bytes.byteLength > options.maxWorkspaceBytes
        ) {
          complete = false
          continue
        }
        totalBytes += bytes.byteLength
        let text: string
        // UTF-16 by its BOM (Relic .ucs tables); such a document is analysed but read-only, since
        // the host's text splice writes UTF-8 and would corrupt it.
        const utf16 =
          bytes[0] === 0xff && bytes[1] === 0xfe
            ? 'utf-16le'
            : bytes[0] === 0xfe && bytes[1] === 0xff
              ? 'utf-16be'
              : undefined
        try {
          text = new TextDecoder(utf16 ?? 'utf-8', { fatal: true }).decode(bytes)
        } catch {
          complete = false
          continue
        }
        const uri = pathToFileURL(path).href
        const previous = versions.get(uri)
        const dialect = classify(path).dialect
        const languageId = languageOf(path) as string
        const retained = captures.get(uri)
        let document =
          retained !== undefined &&
          retained.text === text &&
          retained.languageId === languageId &&
          retained.dialect === dialect &&
          retained.version === previous?.version
            ? retained
            : languageDocumentSnapshot({
                uri,
                languageId,
                version: previous?.version ?? 1,
                text,
                ...(dialect === undefined ? {} : { dialect }),
              })
        const signature = languageDocumentTextToken(document)
        const version =
          previous === undefined
            ? 1
            : previous.signature === signature
              ? previous.version
              : previous.version + 1
        versions.set(uri, { signature, version })
        if (document.version !== version)
          document = languageDocumentSnapshot({ ...document, version })
        documents.push(document)
        // Keep the first fitting captures: evicting them for later files causes cyclic cache misses.
        const retainedBytes =
          256 + 2 * (uri.length + languageId.length + (dialect?.length ?? 0) + text.length)
        if (captureBytes + retainedBytes <= captureBudget) {
          nextCaptures.set(uri, document)
          captureBytes += retainedBytes
        }
        documentOrigins.push(
          Object.freeze({
            uri,
            layerId: `${contextId}:root:${candidate.precedence}`,
            logicalId: candidate.logicalId,
            precedence: candidate.precedence,
            sourceRevision: signature,
            readOnly: utf16 !== undefined,
          }),
        )
      }
      const openOrigins = request.workspaceDocumentOrigins.filter(origin =>
        origin.layerId.startsWith(`${contextId}:root:`),
      )
      const contextOrigins = Object.freeze([...openOrigins, ...documentOrigins])
      request.signal.throwIfAborted()
      captures = nextCaptures
      return {
        documents: Object.freeze(documents),
        isComplete: complete,
        workspaceContext: Object.freeze({
          id: contextId,
          revision: languageWorkspaceContextToken({
            complete,
            documents: contextOrigins.map(origin => ({
              logicalId: origin.logicalId,
              precedence: origin.precedence,
              sourceRevision: origin.sourceRevision,
            })),
          }),
          semanticComplete: complete,
          documentOrigins: contextOrigins,
          semanticInputs: Object.freeze([
            Object.freeze({
              kind: 'workspace-roots',
              id: contextId,
              revision: languageWorkspaceContextToken(
                options.roots.map((root, precedence) => ({ root, precedence })),
              ),
            }),
          ]),
        }),
      }
    },
  })
}
