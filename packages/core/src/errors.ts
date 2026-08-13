/**
 * Structured errors (canon §6.1 core row, §14.8: failures throw structured errors,
 * never bare strings). Error codes use the qualified grammar (MK3/23 §3).
 */

import { isQualifiedId, type ErrorCode } from './ids.js'

export type Retryability = 'never' | 'safe' | 'conditional'

export interface ModkitErrorOptions {
  readonly code: ErrorCode
  readonly message: string
  /** JSON-serializable context; never secrets (MK3/24 §12). */
  readonly context?: Readonly<Record<string, unknown>>
  readonly retryability?: Retryability
  readonly cause?: unknown
}

export class ModkitError extends Error {
  readonly code: ErrorCode
  readonly context?: Readonly<Record<string, unknown>>
  readonly retryability: Retryability

  constructor(options: ModkitErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ModkitError'
    if (!isQualifiedId(options.code)) {
      throw new TypeError(`ModkitError code must be a qualified id, got «${options.code}»`)
    }
    this.code = options.code
    if (options.context !== undefined) this.context = options.context
    this.retryability = options.retryability ?? 'never'
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      retryability: this.retryability,
      ...(this.context === undefined ? {} : { context: this.context }),
    }
  }
}

export function isModkitError(value: unknown): value is ModkitError {
  return value instanceof ModkitError
}
