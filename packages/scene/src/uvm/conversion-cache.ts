/** A single opened source may reuse its completed conversion across scene operations.
 * Create a separate cache for each immutable source/revision/bundle. The key describes
 * conversion options; this cache never shares mutable bytes with its callers. */
export interface UvmConversionCache {
  get(key: string, signal?: AbortSignal): Uint8Array | undefined
  set(key: string, bytes: Uint8Array, signal?: AbortSignal): void
  clear(): void
}

/** Retains at most one result. Oversize results remain usable but are not retained. */
export function createUvmConversionCache(maxBytes: number): UvmConversionCache {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new TypeError('invalid UVM conversion cache byte limit')
  let entry: { key: string; bytes: Uint8Array } | undefined
  return Object.freeze({
    get(key: string, signal?: AbortSignal): Uint8Array | undefined {
      signal?.throwIfAborted()
      return entry?.key === key ? Uint8Array.from(entry.bytes) : undefined
    },
    set(key: string, bytes: Uint8Array, signal?: AbortSignal): void {
      signal?.throwIfAborted()
      entry = bytes.byteLength <= maxBytes ? { key, bytes: Uint8Array.from(bytes) } : undefined
    },
    clear(): void {
      entry = undefined
    },
  })
}
