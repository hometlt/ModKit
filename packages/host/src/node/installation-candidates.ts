/** Collect candidate installations; game providers still confirm every native marker. */
import { parse, resolve } from 'node:path'
import type { GameInstallationCandidate, GameInstallationOrigin } from '@modkit/sdk/games'

/** Absolute slash-normalized path, retaining a filesystem root's trailing separator. */
export function normalizeInstallationPath(value: string): string {
  const path = resolve(value)
  const normalized = path.replaceAll('\\', '/')
  return path === parse(path).root ? normalized : normalized.replace(/\/+$/u, '')
}

/** Filesystem identity uses case folding only on Windows. */
export function installationPathKey(value: string, platform = process.platform): string {
  const path = normalizeInstallationPath(value)
  return platform === 'win32' ? path.toLowerCase() : path
}

export interface CollectedInstallationCandidates {
  readonly candidates: readonly GameInstallationCandidate[]
  readonly origins: readonly (readonly GameInstallationOrigin[])[]
  readonly storeAppIds: readonly (readonly string[])[]
  readonly truncated: boolean
}

/** Preserve order/first metadata while merging all origins, including duplicates after the limit. */
export function collectInstallationCandidates(
  entries: Iterable<GameInstallationCandidate>,
  options: { readonly maxCandidates: number; readonly signal?: AbortSignal },
): CollectedInstallationCandidates {
  if (!Number.isSafeInteger(options.maxCandidates) || options.maxCandidates < 1)
    throw new RangeError('maxCandidates must be a positive safe integer')
  const found = new Map<
    string,
    {
      candidate: GameInstallationCandidate
      origins: GameInstallationOrigin[]
      storeAppIds: string[]
    }
  >()
  let truncated = false
  options.signal?.throwIfAborted()
  for (const entry of entries) {
    options.signal?.throwIfAborted()
    if (entry.path.trim() === '') continue
    const path = normalizeInstallationPath(entry.path)
    const key = installationPathKey(path)
    const known = found.get(key)
    if (known !== undefined) {
      if (!known.origins.includes(entry.origin)) known.origins.push(entry.origin)
      if (entry.storeAppId !== undefined && !known.storeAppIds.includes(entry.storeAppId))
        known.storeAppIds.push(entry.storeAppId)
    } else if (found.size >= options.maxCandidates) {
      truncated = true
    } else {
      found.set(key, {
        candidate: Object.freeze({ ...entry, path }),
        origins: [entry.origin],
        storeAppIds: entry.storeAppId === undefined ? [] : [entry.storeAppId],
      })
    }
  }
  const rows = [...found.values()]
  return Object.freeze({
    candidates: Object.freeze(rows.map(row => row.candidate)),
    origins: Object.freeze(rows.map(row => Object.freeze(row.origins))),
    storeAppIds: Object.freeze(rows.map(row => Object.freeze(row.storeAppIds))),
    truncated,
  })
}
