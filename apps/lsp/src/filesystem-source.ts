import { opendir, readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  LanguageProviderRoute,
  LanguageWorkspaceDocumentSource,
  LanguageWorkspaceDocumentSourceRequest,
} from '@modkit/host/language'

export interface FilesystemLanguageDocumentSourceOptions {
  readonly roots: readonly string[]
  readonly routes: readonly LanguageProviderRoute[]
  readonly maxDocumentBytes: number
  readonly maxWorkspaceBytes: number
  readonly maxVisitedEntries?: number
}

const ignoredDirectory = (name: string): boolean => name === '.git' || name === 'node_modules'

export function createFilesystemLanguageDocumentSource(
  options: FilesystemLanguageDocumentSourceOptions,
): LanguageWorkspaceDocumentSource {
  const versions = new Map<string, { signature: string; version: number }>()
  const maxVisitedEntries = options.maxVisitedEntries ?? 16_384
  return Object.freeze({
    async snapshot(request: LanguageWorkspaceDocumentSourceRequest) {
      request.signal.throwIfAborted()
      if (request.maxDocuments === 0) return { documents: Object.freeze([]), isComplete: false }
      const accepted = new Set(request.workspaceLanguageIds)
      const languageIdsByExtension = new Map<string, Set<string>>()
      for (const route of options.routes) {
        if (route.extension === undefined) continue
        const ids = languageIdsByExtension.get(route.extension) ?? new Set<string>()
        ids.add(route.languageId)
        languageIdsByExtension.set(route.extension, ids)
      }
      const uniqueLanguageByExtension = new Map(
        [...languageIdsByExtension].flatMap(([extension, ids]) =>
          ids.size === 1 && accepted.has([...ids][0] as string)
            ? [[extension, [...ids][0] as string] as const]
            : [],
        ),
      )
      if (uniqueLanguageByExtension.size === 0) {
        return { documents: Object.freeze([]), isComplete: languageIdsByExtension.size === 0 }
      }
      // The document under the cursor is open too, and the host rejects a snapshot that repeats it.
      const openUris = new Set([
        request.document.uri,
        ...request.workspaceDocuments.map(document => document.uri),
      ])
      const candidates: string[] = []
      let visited = 0
      let complete = true
      const walk = async (directory: string): Promise<void> => {
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
          if (entry.isDirectory() && !ignoredDirectory(entry.name)) await walk(path)
          else if (entry.isFile()) {
            const extension = extname(entry.name).replace(/^\./u, '').toLowerCase()
            if (!uniqueLanguageByExtension.has(extension)) continue
            const uri = pathToFileURL(path).href
            if (!openUris.has(uri)) candidates.push(path)
            if (candidates.length > request.maxDocuments) {
              complete = false
              return
            }
          }
        }
      }
      for (const root of options.roots) await walk(root)
      /*
       * The snapshot is bounded by bytes, so order decides what survives the budget. Documents of
       * the request's own language come first: a layout resolves its templates against other
       * layouts, and losing them to unrelated scripts or catalogs that merely sort earlier turns a
       * resolvable reference into a reported error. The rest are interleaved by language rather
       * than sorted by path, so one large language cannot spend the remaining budget alone — in
       * Blizzard's core mod the scripts alphabetically precede the layouts and are nine megabytes.
       */
      const primaryLanguage = request.document.languageId
      const languageOf = (path: string): string =>
        uniqueLanguageByExtension.get(extname(path).replace(/^\./u, '').toLowerCase()) ?? ''
      const byLanguage = new Map<string, string[]>()
      for (const path of candidates.sort()) {
        const language = languageOf(path)
        byLanguage.set(language, [...(byLanguage.get(language) ?? []), path])
      }
      const ranked = byLanguage.get(primaryLanguage) ?? []
      const others = [...byLanguage.entries()]
        .filter(([language]) => language !== primaryLanguage)
        .map(([, paths]) => paths)
      for (let index = 0; others.some(paths => index < paths.length); index += 1)
        for (const paths of others) if (index < paths.length) ranked.push(paths[index] as string)
      const documents = []
      let totalBytes = 0
      for (const path of ranked.slice(0, request.maxDocuments)) {
        request.signal.throwIfAborted()
        const info = await stat(path)
        if (
          info.size > options.maxDocumentBytes ||
          totalBytes + info.size > options.maxWorkspaceBytes
        ) {
          complete = false
          continue
        }
        const bytes = await readFile(path)
        totalBytes += bytes.byteLength
        let text: string
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        } catch {
          complete = false
          continue
        }
        const uri = pathToFileURL(path).href
        const signature = `${info.size}:${info.mtimeMs}`
        const previous = versions.get(uri)
        const version =
          previous === undefined
            ? 1
            : previous.signature === signature
              ? previous.version
              : previous.version + 1
        versions.set(uri, { signature, version })
        const extension = extname(path).replace(/^\./u, '').toLowerCase()
        documents.push(
          Object.freeze({
            uri,
            languageId: uniqueLanguageByExtension.get(extension) as string,
            version,
            text,
          }),
        )
      }
      return { documents: Object.freeze(documents), isComplete: complete }
    },
  })
}
