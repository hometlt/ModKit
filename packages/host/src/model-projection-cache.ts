import { canonicalJsonStringify } from '@modkit/core'
import type { ArtifactByteSource } from '@modkit/sdk'
import type { SubjectRasterResourceState } from './raster-resources.js'
import type { OpenedSubject } from './subject-open.js'

/** A sourceKey alone does not identify native companions. Reuse only attested full projections. */
export function modelProjectionKey(
  opened: OpenedSubject,
  source: ArtifactByteSource,
  sourceKey: string,
  logicalId: string,
): string | undefined {
  const descriptor = opened.descriptor
  if (descriptor.interpretation !== 'codec') return undefined
  const bindings =
    descriptor.origin.kind === 'bundle'
      ? descriptor.origin.bindings
      : descriptor.origin.kind === 'single'
        ? [descriptor.origin.binding]
        : []
  const receipt = descriptor.metadata
    .find(group => group.id === 'uv-projection-receipt')
    ?.entries.find(entry => entry.key === 'receipt')?.value
  if (
    receipt === null ||
    typeof receipt !== 'object' ||
    Array.isArray(receipt) ||
    !('confidence' in receipt) ||
    !['partial', 'high', 'exact'].includes(String(receipt['confidence'])) ||
    receipt['subjectRevision'] !== descriptor.revision ||
    !Array.isArray(receipt['companions']) ||
    receipt['companions'].some(
      companion =>
        companion === null ||
        typeof companion !== 'object' ||
        Array.isArray(companion) ||
        (companion['state'] === 'bound' &&
          typeof companion['revision'] !== 'string' &&
          !bindings.some(
            binding =>
              binding.id === companion['bindingId'] && typeof binding.revision === 'string',
          )) ||
        companion['state'] === 'refused',
    ) ||
    !Array.isArray(receipt['evidence']) ||
    !opened.detectionSelectionText ||
    !opened.lockText
  )
    return undefined
  // Projection confidence describes conversion fidelity, not cache identity. A partial M3
  // projection is still deterministic when its complete receipt and resource scope are stable.
  // Include the whole receipt: codecs can report post-open companions in evidence, beyond the
  // descriptor's pre-open origin bindings. Never parse format-specific prose to infer identity.
  return canonicalJsonStringify([
    sourceKey,
    source.ref,
    source.revision,
    logicalId,
    descriptor.origin,
    receipt,
    opened.detectionSelectionText,
    opened.lockText,
  ])
}

function waitForProjection(done: Promise<void>, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (signal === undefined) return done
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    void done.then(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    })
  })
}

/** Memory-only, one model port lifetime. Reservations include keys and retained UVM bytes. */
export function createModelProjectionCache(
  state: SubjectRasterResourceState,
  maxScalarBytes: number,
) {
  const maxBytes = Math.min(64 * 1024 * 1024, Math.floor(maxScalarBytes / 8))
  const entries = new Map<string, Uint8Array>()
  const pending = new Map<string, { done: Promise<void>; wake: () => void }>()
  let retainedBytes = 0
  let pendingBytes = 0
  let generation = 0
  const cost = (key: string, bytes: Uint8Array) => key.length * 2 + bytes.byteLength
  const evictOne = () => {
    const first = entries.entries().next().value
    if (first === undefined) return false
    entries.delete(first[0])
    const bytes = cost(first[0], first[1])
    retainedBytes -= bytes
    state.reservedBytes -= bytes
    return true
  }
  return {
    get retainedBytes() {
      return retainedBytes
    },
    trimForReservation(bytes: number) {
      while (state.reservedBytes + bytes > maxScalarBytes && evictOne()) {
        // Cache retention never prevents an otherwise admissible model reservation.
      }
    },
    clear() {
      generation++
      state.reservedBytes -= pendingBytes
      pendingBytes = 0
      for (const flight of pending.values()) flight.wake()
      pending.clear()
      while (evictOne()) {
        // Release every cache charge; outstanding acquisitions own their independent copies.
      }
    },
    async claim(key: string | undefined, signal?: AbortSignal) {
      let waited = false
      const claimGeneration = generation
      while (key !== undefined) {
        signal?.throwIfAborted()
        if (generation !== claimGeneration) break
        const bytes = entries.get(key)
        if (bytes !== undefined) {
          entries.delete(key)
          entries.set(key, bytes)
          return { state: waited ? ('shared-hit' as const) : ('hit' as const), bytes }
        }
        const flight = pending.get(key)
        if (flight !== undefined) {
          waited = true
          await waitForProjection(flight.done, signal)
          // A canceled/failed leader publishes no entry. A live waiter retries with its own
          // native session and signal; one consumer's cancellation never cancels another.
          continue
        }
        const keyBytes = key.length * 2
        if (keyBytes >= maxBytes || pending.size >= 256 || pendingBytes + keyBytes > maxBytes) break
        while (
          (state.reservedBytes + keyBytes > maxScalarBytes ||
            retainedBytes + pendingBytes + keyBytes > maxBytes ||
            entries.size + pending.size >= 256) &&
          evictOne()
        ) {
          // Metadata for in-flight work is bounded by the same subject reservation.
        }
        if (state.reservedBytes + keyBytes > maxScalarBytes) break
        const epoch = generation
        let wake!: () => void
        const done = new Promise<void>(resolve => {
          wake = resolve
        })
        pending.set(key, { done, wake })
        pendingBytes += keyBytes
        state.reservedBytes += keyBytes
        let finished = false
        return {
          state: 'miss' as const,
          finish(bytes?: Uint8Array) {
            if (finished) return
            finished = true
            if (epoch === generation) {
              pending.delete(key)
              pendingBytes -= keyBytes
              state.reservedBytes -= keyBytes
              if (bytes !== undefined && cost(key, bytes) <= maxBytes) {
                const charge = cost(key, bytes)
                while (
                  (retainedBytes + pendingBytes + charge > maxBytes ||
                    entries.size + pending.size >= 256 ||
                    state.reservedBytes + charge > maxScalarBytes) &&
                  evictOne()
                ) {
                  // Least recently used completed projections are the first to go.
                }
                if (
                  state.reservedBytes + charge <= maxScalarBytes &&
                  retainedBytes + pendingBytes + charge <= maxBytes
                ) {
                  entries.set(key, bytes)
                  retainedBytes += charge
                  state.reservedBytes += charge
                }
              }
            }
            wake()
          },
        }
      }
      return { state: 'bypass' as const }
    },
  }
}
