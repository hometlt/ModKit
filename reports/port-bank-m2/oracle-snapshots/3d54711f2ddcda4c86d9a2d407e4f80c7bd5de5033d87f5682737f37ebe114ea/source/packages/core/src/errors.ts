/**
 * ModkitError — the one thrown-error type for "failure to answer" across the codebase
 * (B1). See AGENTS.md for the null/throw policy (B2) this type exists to support:
 * `null`/`undefined` means "asked, answer is no" (semantic absence); anything that
 * couldn't even answer — I/O error, corrupt data, missing prerequisite, invariant
 * break — throws a `ModkitError` instead of returning a falsy sentinel.
 *
 * Add new codes here as they're needed; keep them stable once shipped (surfaced
 * error codes make user reports greppable across versions).
 */
export type ModkitErrorCode =
  | 'CASC_ENCODING_KEY_MISSING'
  | 'CASC_INSTALL_INCOMPLETE'
  | 'CASC_SOURCE_UNAVAILABLE'
  | 'MOD_NOT_FOUND'
  | 'MOD_DEP_UNRESOLVED'
  | 'VFS_SOURCE_UNAVAILABLE'
  | 'ARCHIVE_CORRUPT'
  | 'ARCHIVE_CODEC_UNAVAILABLE'
  | 'ARCHIVE_LIMIT_EXCEEDED'
  | 'ARCHIVE_SESSION_INVALIDATED'
  | 'ASSET_LIMIT_EXCEEDED'
  | 'ASSET_PERMISSION_DENIED'
  | 'PARSE_FAILED'
  | 'CONFIG_INVALID'
  | 'CODEC_ALREADY_REGISTERED'
  | 'CODEC_RUNTIME_LOAD_FAILED'
  | 'CODEC_RUNTIME_ACTIVATION_FAILED'
  | 'CODEC_RUNTIME_DISPOSE_FAILED'
  | 'CODEC_OPERATION_UNSUPPORTED'
  | 'TOOL_UNAVAILABLE'
  | 'TOOL_EXECUTION_FAILED'
  | 'ARTIFACT_SOURCE_REQUIRED'
  | 'GAME_ALREADY_REGISTERED'
  | 'GAME_NOT_REGISTERED'
  | 'UNKNOWN'

export interface ModkitErrorOptions {
  /** Stable machine-readable code — the primary thing a user report should include. */
  code: ModkitErrorCode
  message: string
  /** Structured context (paths, names, ids) — logged alongside the error, not interpolated
   * into `message` (keeps the message stable/greppable across differing context). */
  context?: Record<string, unknown>
  /** The underlying error, when this wraps one (standard `Error.cause` chaining). */
  cause?: unknown
  /** A user-actionable next step, e.g. "Run Scan & Repair in the Battle.net app." Surfaced
   * as an extra button/line by the boundary handler (B3) when present. */
  hint?: string
}

export class ModkitError extends Error {
  readonly code: ModkitErrorCode
  readonly context: Record<string, unknown> | undefined
  readonly hint: string | undefined

  constructor(opts: ModkitErrorOptions) {
    super(opts.message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'ModkitError'
    this.code = opts.code
    this.context = opts.context
    this.hint = opts.hint
    // Restore the prototype chain (extending Error is lossy through some transpile targets).
    Object.setPrototypeOf(this, ModkitError.prototype)
  }
}

export function isModkitError(err: unknown): err is ModkitError {
  return err instanceof ModkitError
}

/** Normalised shape for rendering any thrown value (ModkitError or not) consistently. */
export interface ErrorDescription {
  message: string
  code: ModkitErrorCode | undefined
  hint: string | undefined
  context: Record<string, unknown> | undefined
  stack: string | undefined
}

/** Extract a consistent `{message, code, hint, context, stack}` from any thrown value —
 * the boundary handler (B3) and log calls use this so ModkitError and plain errors render
 * uniformly. */
export function describeError(err: unknown): ErrorDescription {
  if (isModkitError(err)) {
    return {
      message: err.message,
      code: err.code,
      hint: err.hint,
      context: err.context,
      stack: err.stack,
    }
  }
  if (err instanceof Error) {
    return {
      message: err.message,
      code: undefined,
      hint: undefined,
      context: undefined,
      stack: err.stack,
    }
  }
  return {
    message: String(err),
    code: undefined,
    hint: undefined,
    context: undefined,
    stack: undefined,
  }
}
