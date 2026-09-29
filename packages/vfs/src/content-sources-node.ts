/** Explicit trusted desktop configuration; never load executable paths received from a webview. */
import { execFile } from 'node:child_process'
import { open, readdir, readFile, mkdir } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTENT_SOURCE_METHODS, type ContentSources } from './content-sources.js'
import type { LayerArchive } from './layered-archive-sources.js'

/**
 * What the host hands a module beside its options — `@modkit/sdk`'s `ContentSourceModuleContext`
 * (platform probes). Forwarded as is: vfs does not depend on sdk.
 */
export type ContentSourceModuleContextValue = Readonly<Record<string, unknown>>
export { callContentSources } from './content-sources.js'

export async function loadContentSources(
  configPath: string | undefined,
  storage: string,
  context: ContentSourceModuleContextValue = {},
): Promise<ContentSources | undefined> {
  if (!configPath) return undefined
  const config = await readContentSourceConfig(configPath)
  return loadContentSourceModule(config.module, config.options, storage, context)
}

/**
 * A trusted `{ module, options, extension? }` configuration. `extension` (`publisher/id`) says which
 * extension's declared module it stands in for; without it the configuration is the only source.
 */
export async function readContentSourceConfig(configPath: string): Promise<{
  readonly module: string
  readonly options: Readonly<Record<string, unknown>>
  readonly extension?: string
}> {
  if (!isAbsolute(configPath))
    throw new TypeError('Content source configuration must be an absolute trusted path')
  const raw = await readFile(configPath, 'utf8')
  if (raw.length > 65536) throw new TypeError('Content source configuration is too large')
  const config = JSON.parse(raw) as { module?: unknown; options?: unknown; extension?: unknown }
  if (typeof config.module !== 'string' || !isAbsolute(config.module))
    throw new TypeError('Expected an absolute source module path')
  if (
    config.options !== undefined &&
    (config.options === null || typeof config.options !== 'object' || Array.isArray(config.options))
  ) {
    throw new TypeError('Invalid content source options')
  }
  if (
    config.extension !== undefined &&
    (typeof config.extension !== 'string' || !/^[^/\s]+\/[^/\s]+$/u.test(config.extension))
  ) {
    throw new TypeError('Invalid content source extension (expected publisher/id)')
  }
  return {
    module: config.module,
    options: (config.options ?? {}) as Record<string, unknown>,
    ...(config.extension === undefined ? {} : { extension: config.extension }),
  }
}

/**
 * Load one trusted module's `createContentSources` and check it implements the catalogue. The host
 * hands the module its context (platform probes) as a second argument, beside its options.
 */
export async function loadContentSourceModule(
  modulePath: string,
  options: Readonly<Record<string, unknown>>,
  storage: string,
  context: ContentSourceModuleContextValue = {},
): Promise<ContentSources> {
  if (!isAbsolute(modulePath)) throw new TypeError('Expected an absolute source module path')
  await mkdir(storage, { recursive: true })
  const module = (await import(pathToFileURL(modulePath).href)) as {
    createContentSources?: (
      options: Record<string, unknown>,
      context: ContentSourceModuleContextValue,
    ) => Promise<ContentSources>
  }
  if (typeof module.createContentSources !== 'function')
    throw new TypeError('Source module has no createContentSources export')
  const source = await module.createContentSources(
    { ...options, cacheDirectory: join(storage, 'cache'), stateDirectory: join(storage, 'state') },
    Object.freeze({ ...context }),
  )
  const required = [
    'snapshot',
    'connect',
    'disconnect',
    'search',
    'add',
    'remove',
    'refresh',
    'list',
    'read',
    'dispose',
  ] as const
  if (
    required.some(key => typeof source[key] !== 'function') ||
    CONTENT_SOURCE_METHODS.some(
      key => source[key] !== undefined && typeof source[key] !== 'function',
    )
  ) {
    await source.dispose?.()
    throw new TypeError('Source module does not implement the desktop catalogue contract')
  }
  return source
}

/**
 * What Windows marks hidden under `root`: `/`-separated paths relative to it, of files and folders
 * (everything under a hidden folder is hidden too — the caller's rule, as in {@link hiddenPathMatcher}).
 * This is the one rule of what is hidden on disk; a name starting with a dot is not hidden. One
 * `dir` call for the whole tree; empty on other systems, and when `dir` cannot tell.
 */
export async function windowsHiddenPaths(
  root: string,
  signal?: AbortSignal,
): Promise<ReadonlySet<string>> {
  if (process.platform !== 'win32') return new Set()
  // `/u`: the listing comes as UTF-16, so names outside the console code page survive
  const listing = await new Promise<string>(resolveListing => {
    execFile(
      'cmd.exe',
      ['/d', '/u', '/c', 'dir', '/a:h', '/s', '/b', root],
      {
        encoding: 'buffer',
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
        ...(signal === undefined ? {} : { signal }),
      },
      (_error, stdout) => resolveListing(Buffer.from(stdout ?? []).toString('utf16le')),
    )
  })
  signal?.throwIfAborted()
  const hidden = new Set<string>()
  for (const line of listing.split(/\r?\n/u)) {
    const path = relative(root, line.trim())
    if (line.trim() !== '' && path !== '' && !path.startsWith('..') && !isAbsolute(path))
      hidden.add(path.split(sep).join('/'))
  }
  return hidden
}

export interface FolderLayerOptions {
  /** Files one folder may hold; a larger one is refused rather than listed in part (100 000). */
  readonly maxFiles?: number
  /** Names left out with everything under them (a game that ignores `.git`, say). */
  readonly ignore?: (name: string) => boolean
}

/**
 * A folder on disk as one archive of an installation tree (`createLayeredArchiveContentSources`):
 * an unpacked mod, the user's maps and replays folder. Lists its files once, recursively, `/`
 * separated and sorted; reads only a listed file, refusing one over `maxBytes` before reading it.
 * A file Windows marks hidden, or one under a hidden folder, is listed marked `hidden`.
 */
export async function folderLayer(
  root: string,
  options: FolderLayerOptions = {},
): Promise<LayerArchive> {
  const maxFiles = options.maxFiles ?? 100_000
  const paths: string[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (options.ignore?.(entry.name) === true) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) {
        paths.push(relative(root, path).split(sep).join('/'))
        if (paths.length > maxFiles)
          throw new RangeError(`${root} holds more than ${maxFiles} files`)
      }
    }
  }
  await visit(root)
  paths.sort()
  const listed = new Set(paths)
  const hidden = await windowsHiddenPaths(root)
  const isHidden = (path: string): boolean =>
    hidden.size > 0 &&
    path.split('/').some((_, index, segments) => hidden.has(segments.slice(0, index + 1).join('/')))
  return Object.freeze({
    id: root,
    entries: Object.freeze(
      paths.map(path => Object.freeze(isHidden(path) ? { path, hidden: true as const } : { path })),
    ),
    async read(file: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
      signal?.throwIfAborted()
      if (!listed.has(file)) throw new RangeError(`${root} has no «${file}»`)
      const handle = await open(join(root, ...file.split('/')), 'r')
      try {
        const { size } = await handle.stat()
        if (size > maxBytes)
          throw new RangeError(`${file} (${size} bytes) exceeds ${maxBytes} bytes`)
        return new Uint8Array(await handle.readFile())
      } finally {
        await handle.close()
      }
    },
    close() {},
  })
}
