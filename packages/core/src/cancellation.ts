/**
 * Cancellation (BRIEF-12 §3.4): every potentially blocking async/provider/I/O API takes
 * an `AbortSignal`; pure value functions do not get a fake cancellation parameter.
 */

import { ModkitError } from './errors.js'

export const CANCELLED_CODE = 'x3.core/operation-cancelled'

export class OperationCancelledError extends ModkitError {
  constructor(reason?: unknown) {
    super({
      code: CANCELLED_CODE,
      message: 'operation cancelled',
      retryability: 'safe',
      ...(reason === undefined ? {} : { cause: reason }),
    })
    this.name = 'OperationCancelledError'
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new OperationCancelledError(signal.reason)
}

export function isCancellation(value: unknown): value is OperationCancelledError {
  return value instanceof OperationCancelledError
}
