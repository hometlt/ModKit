/**
 * Internal exact-file lookup shared by content-source companions and dependency mounts.
 * Uses the existing ContentSources.lookup contract; no paths, scopes or provider authority added.
 * Missing/unsupported lookup and ordinary probe failures retain listing fallback. Cancellation,
 * structured provider refusals and OS access denials propagate instead of authorizing fallback.
 */
import { isQualifiedId, throwIfAborted } from '@modkit/core'
import type { ContentSourceEntry, ContentSources } from '@modkit/vfs/content-sources'

/** Existing content-source spelling normalization, shared without changing its path semantics. */
export const normalizedContentSourcePath = (path: string): string =>
  path.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '')

/** Return only the requested file/alias; undefined retains the caller's existing listing path. */
export async function lookupExactContentSourceFile(
  source: Pick<ContentSources, 'lookup'>,
  sourceId: string,
  path: string,
  signal?: AbortSignal,
): Promise<ContentSourceEntry | undefined> {
  throwIfAborted(signal)
  if (source.lookup === undefined) return undefined
  let entry: ContentSourceEntry | undefined
  try {
    entry = await source.lookup(sourceId, path)
  } catch (error) {
    throwIfAborted(signal)
    const object = error !== null && typeof error === 'object' ? error : undefined
    const code = object !== undefined && 'code' in object ? object.code : undefined
    const name = object !== undefined && 'name' in object ? object.name : undefined
    if (name === 'AbortError' || name === 'TimeoutError' ||
      typeof code === 'string' && (isQualifiedId(code) || code === 'EACCES' || code === 'EPERM'))
      throw error
    return undefined
  }
  throwIfAborted(signal)
  if (entry === undefined || entry.directory) return undefined
  const canonical = normalizedContentSourcePath(entry.path)
  if (canonical.toLowerCase() !== normalizedContentSourcePath(path).toLowerCase())
    throw new TypeError('content-source lookup returned an entry outside the requested path')
  // Origin adapters consume file identity and extent, not arbitrary provider-owned row fields.
  return Object.freeze({ path: canonical, name: entry.name, directory: false,
    ...(entry.size === undefined ? {} : { size: entry.size }) })
}
