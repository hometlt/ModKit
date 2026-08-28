export const CASC_LIMITS = Object.freeze({
  maxListEntries: 128,
  maxIndexFiles: 64,
  maxIndexBytes: 64 * 1024 * 1024,
  maxWholeFileBytes: 64 * 1024 * 1024,
  maxContainerReadBytes: 64 * 1024 * 1024,
  maxHostReadBytes: 16 * 1024 * 1024,
  maxDecodedBytes: 128 * 1024 * 1024,
  maxExtractBytes: 128 * 1024 * 1024,
  maxSourceReadBytes: 256 * 1024 * 1024,
  maxEntries: 750_000,
  maxPageItems: 256,
  maxSearchBasenames: 16,
  maxPathBytes: 4096,
})

export function cascError(code, message, context = {}) {
  return Object.assign(new Error(message), { code, context: Object.freeze({ ...context }) })
}

export function throwIfCancelled(signal) {
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
}
