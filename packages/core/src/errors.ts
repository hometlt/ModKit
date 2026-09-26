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

/**
 * A realm-wide brand: an extension brings its own copy of `@modkit/core` (a vendored package), and
 * its ModkitError is not `instanceof` the host's class, so a codec's typed refusal crossed the worker
 * as a foreign error and lost its code. `Symbol.for` is shared by every copy in one realm.
 */
const MODKIT_ERROR_BRAND = Symbol.for('modkit.core/error')

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
    Object.defineProperty(this, MODKIT_ERROR_BRAND, { value: true })
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
  if (value instanceof ModkitError) return true
  // Another copy of this package in the same realm: same brand, same shape.
  return (
    value instanceof Error &&
    (value as unknown as Record<symbol, unknown>)[MODKIT_ERROR_BRAND] === true &&
    typeof (value as unknown as { code?: unknown }).code === 'string' &&
    isQualifiedId((value as unknown as { code: string }).code) &&
    ['never', 'safe', 'conditional'].includes(
      (value as unknown as { retryability?: unknown }).retryability as string,
    )
  )
}
