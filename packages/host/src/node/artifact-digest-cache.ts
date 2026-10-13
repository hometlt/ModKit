/**
 * Artifact digests that survive a restart.
 *
 * Loading the bundled catalog reads and hashes every file of every extension root, and an
 * application does that once per window start — ~190 ms for the nine roots this build ships, all
 * of it recomputing digests of files that have not changed since the last launch. The cheap part
 * is a stat walk (paths, sizes, modification times: ~5 ms); the expensive part is the hashing, and
 * the stat walk is exactly the evidence that the hashing can be reused.
 *
 * An entry is keyed by the root and admitted only when the stat fingerprint matches, so a file
 * that changed — content, size, timestamp, added or removed — invalidates it. A digest is identity
 * here: the cache never invents one, it only skips recomputing one it has seen for a tree in the
 * state it recorded. A missing, unreadable or version-mismatched cache file is simply not used.
 *
 * The host does not choose where it lives: an application installs a path (VS Code hands it its
 * own global storage), or there is no cache at all. A record of a root that is no longer on disk (a
 * moved workspace, a replaced snapshot) is dropped when the cache is read, so the file does not
 * grow with every path a root ever had.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Bumped when the record shape or the fingerprint rule changes. */
const CACHE_VERSION = 1

export interface ArtifactDigestRecord {
  readonly fingerprint: string
  readonly artifactDigest: string
  readonly fileDigests: Readonly<Record<string, string>>
}

interface CacheFile {
  readonly version: number
  readonly roots: Readonly<Record<string, ArtifactDigestRecord>>
}

let cachePath: string | undefined
let loaded: Map<string, ArtifactDigestRecord> | undefined
let dirty = false
let writeScheduled = false

/**
 * Keep artifact digests in this file between runs. Called once, before any root is loaded; passing
 * `undefined` switches the cache off again (a test, or a host that does not want one).
 */
export function useArtifactDigestCache(path: string | undefined): void {
  cachePath = path
  loaded = undefined
  dirty = false
}

function entries(): Map<string, ArtifactDigestRecord> {
  if (loaded !== undefined) return loaded
  loaded = new Map()
  if (cachePath === undefined) return loaded
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as CacheFile
    if (parsed.version !== CACHE_VERSION || typeof parsed.roots !== 'object') return loaded
    for (const [root, record] of Object.entries(parsed.roots)) {
      if (
        typeof record?.fingerprint === 'string' &&
        typeof record.artifactDigest === 'string' &&
        typeof record.fileDigests === 'object'
      ) {
        if (existsSync(root)) loaded.set(root, record)
        else dirty = true
      }
    }
  } catch {
    // No cache, a partial write, or a file from another version: hash afresh.
  }
  return loaded
}

/** The record for this root, if the tree is in the state the cache recorded. */
export function cachedArtifactDigest(
  root: string,
  fingerprint: string,
): ArtifactDigestRecord | undefined {
  const record = entries().get(root)
  return record?.fingerprint === fingerprint ? record : undefined
}

export function rememberArtifactDigest(root: string, record: ArtifactDigestRecord): void {
  if (cachePath === undefined) return
  entries().set(root, record)
  dirty = true
  scheduleWrite()
}

/**
 * Written on the next tick, not on every record: a catalog load fills several roots in a row, and
 * a window start should pay for one file write rather than nine. Unreferenced so a pending write
 * never holds the process open.
 */
function scheduleWrite(): void {
  if (writeScheduled || cachePath === undefined) return
  writeScheduled = true
  const timer = setTimeout(() => {
    writeScheduled = false
    flushArtifactDigestCache()
  }, 0)
  timer.unref?.()
}

/** Write the cache now. A failure is silent: a cache that cannot be written is still only a cache. */
export function flushArtifactDigestCache(): void {
  const path = cachePath
  if (path === undefined || !dirty || loaded === undefined) return
  const file: CacheFile = {
    version: CACHE_VERSION,
    roots: Object.fromEntries([...loaded].sort(([left], [right]) => (left < right ? -1 : 1))),
  }
  try {
    mkdirSync(dirname(path), { recursive: true })
    // Written beside the target and moved into place, so a crash cannot leave half a cache.
    const temporary = join(dirname(path), `.${CACHE_VERSION}.${process.pid}.digests.tmp`)
    writeFileSync(temporary, `${JSON.stringify(file)}\n`, 'utf8')
    renameSync(temporary, path)
    dirty = false
  } catch {
    // Read-only storage, a full disk, a racing window: the next run hashes again.
  }
}
