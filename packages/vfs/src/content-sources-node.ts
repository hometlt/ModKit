/** Explicit trusted desktop configuration; never load executable paths received from a webview. */
import { readFile, mkdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CONTENT_SOURCE_METHODS, type ContentSources } from './content-sources.js'
export { callContentSources } from './content-sources.js'

export async function loadContentSources(configPath: string | undefined, storage: string): Promise<ContentSources | undefined> {
  if (!configPath) return undefined
  if (!isAbsolute(configPath)) throw new TypeError('Content source configuration must be an absolute trusted path')
  const raw = await readFile(configPath, 'utf8')
  if (raw.length > 65536) throw new TypeError('Content source configuration is too large')
  const config = JSON.parse(raw) as { module?: unknown; options?: unknown }
  if (typeof config.module !== 'string' || !isAbsolute(config.module)) throw new TypeError('Expected an absolute source module path')
  if (config.options !== undefined && (config.options === null || typeof config.options !== 'object' || Array.isArray(config.options))) {
    throw new TypeError('Invalid content source options')
  }
  return loadContentSourceModule(config.module, (config.options ?? {}) as Record<string, unknown>, storage)
}

/** Load one trusted module's `createContentSources` and check it implements the catalogue. */
export async function loadContentSourceModule(
  modulePath: string,
  options: Readonly<Record<string, unknown>>,
  storage: string,
): Promise<ContentSources> {
  if (!isAbsolute(modulePath)) throw new TypeError('Expected an absolute source module path')
  await mkdir(storage, { recursive: true })
  const module = await import(pathToFileURL(modulePath).href) as {
    createContentSources?: (options: Record<string, unknown>) => Promise<ContentSources>
  }
  if (typeof module.createContentSources !== 'function') throw new TypeError('Source module has no createContentSources export')
  const source = await module.createContentSources({ ...options,
    cacheDirectory: join(storage, 'cache'), stateDirectory: join(storage, 'state') })
  const required = ['snapshot', 'connect', 'disconnect', 'search', 'add', 'remove', 'refresh', 'list', 'read', 'dispose'] as const
  if (required.some(key => typeof source[key] !== 'function') ||
    CONTENT_SOURCE_METHODS.some(key => source[key] !== undefined && typeof source[key] !== 'function')) {
    await source.dispose?.()
    throw new TypeError('Source module does not implement the desktop catalogue contract')
  }
  return source
}
