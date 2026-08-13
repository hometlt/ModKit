/**
 * Structured diagnostics (canon §6.1; severity vocabulary: MK3/24 §3.1).
 * Diagnostics are data — reporting them never throws; errors that abort an operation
 * are `ModkitError`s carrying diagnostics where useful.
 */

export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint'

export interface Diagnostic {
  /** Qualified diagnostic code (MK3/23 §3 grammar). */
  readonly code: string
  readonly severity: DiagnosticSeverity
  readonly message: string
  /** JSON-pointer-like path into the offending document, when applicable. */
  readonly path?: readonly (string | number)[]
  readonly data?: unknown
}

export function diagnostic(
  severity: DiagnosticSeverity,
  code: string,
  message: string,
  path?: readonly (string | number)[],
  data?: unknown,
): Diagnostic {
  return {
    code,
    severity,
    message,
    ...(path === undefined ? {} : { path }),
    ...(data === undefined ? {} : { data }),
  }
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some(d => d.severity === 'error')
}
