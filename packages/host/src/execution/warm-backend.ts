/**
 * Keeps an activated extension realm warm for the next open of the same kind.
 *
 * Opening a file activates exactly one codec — the signature index shortlists before any extension
 * code runs — but the activation was torn down with the subject session, so the *next* open of a
 * second texture paid for a fresh worker and a cold module graph again. Measured on the VS Code
 * host: ~190 ms per open, of which the spawn is ~18 ms and the rest is evaluating the codec and
 * its dependencies in an empty module cache. For a person walking a folder of icons that is the
 * whole wait.
 *
 * What is cached is the *lease* — a realm with a module graph loaded — and a realm carries no
 * authority. Nothing grant-shaped crosses into it: the worker is spawned with the artifact root,
 * its file digests and the protocol limits, and loaded with a module URL and digests. Authority
 * lives in the context the host builds for each activation (`createCodec(context)`) and in the
 * gate's checks at dispatch, and both stay per activation. So the key is the *code* — contribution,
 * variant, artifact digest, entrypoint, target realm — and two activations of the same code under
 * different grants share one load. That is what lets the probe (narrowed to the probe classes) and
 * the open (with `write-source` for a writable file) use one realm instead of bringing up two.
 *
 * Releases are reference counted and then idle: the last release starts a timer, and a reuse
 * inside that window takes the warm realm. A realm that died is dropped from the cache rather
 * than handed out, because the wrapped backend's own restart policy belongs to its lease.
 */
import type {
  ExecutionBackend,
  ExecutionBackendActivation,
  ExecutionModuleLease,
} from './backend.js'

export interface WarmExecutionBackendOptions {
  /** How long a realm with no users stays warm. */
  readonly idleMs?: number
  /** How many warm realms to keep; the least recently released is dropped first. */
  readonly maxEntries?: number
  /** Tells the caller a realm was reused, so a host can log what it did not pay for. */
  readonly onReuse?: (contributionId: string) => void
}

const DEFAULT_IDLE_MS = 60_000
const DEFAULT_MAX_ENTRIES = 8

interface Entry {
  readonly key: string
  readonly lease: Promise<ExecutionModuleLease>
  users: number
  idle: ReturnType<typeof setTimeout> | undefined
  released: boolean
  releasedAt: number
}

/** Same code in the same realm: everything a reuse must not change. */
function activationKey(context: ExecutionBackendActivation): string {
  return [
    context.ticket.contributionId,
    context.ticket.artifactDigest,
    context.variant.variantId,
    context.variant.executionProfile,
    context.target.environment,
    context.entrypoint.href,
  ].join('|')
}

export function warmExecutionBackend(
  inner: ExecutionBackend,
  options: WarmExecutionBackendOptions = {},
): ExecutionBackend {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const entries = new Map<string, Entry>()

  const drop = (entry: Entry): void => {
    if (entries.get(entry.key) === entry) entries.delete(entry.key)
    if (entry.idle !== undefined) clearTimeout(entry.idle)
    entry.idle = undefined
    if (entry.released) return
    entry.released = true
    void entry.lease.then(
      lease => lease.release(),
      () => undefined,
    )
  }

  const evictIfCrowded = (): void => {
    while (entries.size > maxEntries) {
      // The least recently released idle realm goes; a realm in use is never evicted.
      let oldest: Entry | undefined
      for (const entry of entries.values()) {
        if (entry.users > 0) continue
        if (oldest === undefined || entry.releasedAt < oldest.releasedAt) oldest = entry
      }
      if (oldest === undefined) return
      drop(oldest)
    }
  }

  /** A per-caller handle: releasing it lets the realm go idle, never immediately dead. */
  const handleFor = (entry: Entry, lease: ExecutionModuleLease): ExecutionModuleLease => {
    let released = false
    return Object.freeze({
      module: lease.module,
      async release(): Promise<void> {
        if (released) return
        released = true
        entry.users -= 1
        if (entry.users > 0) return
        entry.releasedAt = Date.now()
        if (idleMs <= 0) {
          drop(entry)
          return
        }
        entry.idle = setTimeout(() => drop(entry), idleMs)
        // A warm realm must never hold the process open on its own account.
        entry.idle.unref?.()
      },
    })
  }

  return Object.freeze({
    profile: inner.profile,
    supports: inner.supports,
    async activate(context: ExecutionBackendActivation): Promise<ExecutionModuleLease> {
      const key = activationKey(context)
      const warm = entries.get(key)
      if (warm !== undefined && !warm.released) {
        if (warm.idle !== undefined) clearTimeout(warm.idle)
        warm.idle = undefined
        warm.users += 1
        try {
          const lease = await warm.lease
          options.onReuse?.(context.ticket.contributionId)
          return handleFor(warm, lease)
        } catch {
          // The cached activation failed: drop it and load afresh below.
          warm.users -= 1
          drop(warm)
        }
      }
      const entry: Entry = {
        key,
        lease: Promise.resolve(inner.activate(context)),
        users: 1,
        idle: undefined,
        released: false,
        releasedAt: Date.now(),
      }
      entries.set(key, entry)
      let lease: ExecutionModuleLease
      try {
        lease = await entry.lease
      } catch (error) {
        drop(entry)
        throw error
      }
      evictIfCrowded()
      return handleFor(entry, lease)
    },
  } satisfies ExecutionBackend)
}
