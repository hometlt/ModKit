/**
 * Browser-safe cancellation contract shared by detection, load, operation, and edit paths.
 *
 * Every detector and codec load must be abortable (canonical architecture, section 5,
 * pipeline rule 2). This package owns the neutral token so codecs never import a host
 * cancellation type; `AbortSignal` bridges exist for hosts that already speak that dialect.
 */

export interface CancellationSubscription {
  dispose(): void
}

export interface CancellationToken {
  readonly isCancellationRequested: boolean
  /**
   * Registers `listener`, invoked at most once. When the token is already cancelled the
   * listener is invoked synchronously before this call returns.
   */
  onCancellationRequested(listener: () => void): CancellationSubscription
}

const NOOP_SUBSCRIPTION: CancellationSubscription = { dispose() {} }

function createToken(
  isCancelled: () => boolean,
  subscribe: (listener: () => void) => CancellationSubscription,
): CancellationToken {
  return {
    get isCancellationRequested(): boolean {
      return isCancelled()
    },
    onCancellationRequested: subscribe,
  }
}

/** A token that is never cancelled. */
export const CancellationTokenNone: CancellationToken = createToken(
  () => false,
  () => NOOP_SUBSCRIPTION,
)

/** A token that is already cancelled. */
export const CancellationTokenCancelled: CancellationToken = createToken(
  () => true,
  listener => {
    listener()
    return NOOP_SUBSCRIPTION
  },
)

/** Thrown by {@link throwIfCancelled}; hosts should treat it as "aborted", never as a failure. */
export class CancellationError extends Error {
  override readonly name = 'CancellationError'

  constructor(message = 'Operation was cancelled') {
    super(message)
  }
}

export function isCancellationError(value: unknown): value is CancellationError {
  return value instanceof CancellationError
}

export function throwIfCancelled(token?: CancellationToken, message?: string): void {
  if (token?.isCancellationRequested) throw new CancellationError(message)
}

/** Owns a token and the sole right to cancel it. Codecs receive the token, hosts keep the source. */
export class CancellationTokenSource {
  private cancelled = false
  private listeners: Array<() => void> | undefined = []

  readonly token: CancellationToken = createToken(
    () => this.cancelled,
    listener => this.subscribe(listener),
  )

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    const listeners = this.listeners ?? []
    this.listeners = []
    for (const listener of [...listeners]) listener()
  }

  /** Drops registered listeners without cancelling. Safe to call after {@link cancel}. */
  dispose(): void {
    this.listeners = undefined
  }

  private subscribe(listener: () => void): CancellationSubscription {
    if (this.cancelled) {
      listener()
      return NOOP_SUBSCRIPTION
    }
    const listeners = this.listeners
    if (!listeners) return NOOP_SUBSCRIPTION
    listeners.push(listener)
    return {
      dispose: () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      },
    }
  }
}

/** Adapts a host `AbortSignal` (browser, Node, VS Code adapters) to a {@link CancellationToken}. */
export function cancellationTokenFromAbortSignal(signal: AbortSignal): CancellationToken {
  return createToken(
    () => signal.aborted,
    listener => {
      if (signal.aborted) {
        listener()
        return NOOP_SUBSCRIPTION
      }
      const handler = (): void => listener()
      signal.addEventListener('abort', handler, { once: true })
      return { dispose: () => signal.removeEventListener('abort', handler) }
    },
  )
}

/** Adapts a {@link CancellationToken} to an `AbortSignal` for `fetch` and stream consumers. */
export function abortSignalFromCancellationToken(token: CancellationToken): AbortSignal {
  const controller = new AbortController()
  if (token.isCancellationRequested) controller.abort()
  else token.onCancellationRequested(() => controller.abort())
  return controller.signal
}
