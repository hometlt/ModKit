/** A duration ceiling; cancellation is forwarded but does not imply backend interruption. */
export type LogicalResourceDeadlineResult<T> =
  { readonly state: 'complete'; readonly value: T } | { readonly state: 'deadline-exceeded' }

export function logicalResourceDeadline<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent?: AbortSignal,
): Promise<LogicalResourceDeadlineResult<T>> {
  parent?.throwIfAborted()
  if (timeoutMs <= 0) return Promise.resolve({ state: 'deadline-exceeded' })
  const controller = new AbortController()
  return new Promise((resolve, reject) => {
    let settled = false
    const clear = (): boolean => {
      if (settled) return false
      settled = true
      clearTimeout(timer)
      parent?.removeEventListener('abort', abort)
      return true
    }
    const abort = (): void => {
      if (!clear()) return
      controller.abort(parent?.reason)
      reject(parent?.reason)
    }
    const timer = setTimeout(() => {
      if (!clear()) return
      controller.abort(new DOMException('Logical resource deadline exceeded.', 'TimeoutError'))
      resolve({ state: 'deadline-exceeded' })
    }, timeoutMs)
    parent?.addEventListener('abort', abort, { once: true })
    if (parent?.aborted) abort()
    // Both handlers remain attached after timeout. The task owns any late lease cleanup;
    // late values never escape this boundary and late rejections cannot become unhandled.
    void Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted()
        return task(controller.signal)
      })
      .then(
        value => {
          if (clear()) resolve({ state: 'complete', value })
        },
        error => {
          if (clear()) reject(error)
        },
      )
  })
}
