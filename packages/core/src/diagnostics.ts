/**
 * Structured diagnostics (canon §6.1; severity vocabulary: MK3/24 §3.1).
 * Diagnostics are data — reporting them never throws; errors that abort an operation
 * are `ModkitError`s carrying diagnostics where useful.
 */

import type { SourceSpan } from './source-span.js'
import { errorCode, type ErrorCode, type QualifiedIdLiteral } from './ids.js'

export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint'

export interface Diagnostic {
  /** Qualified diagnostic code (MK3/23 §3 grammar). */
  readonly code: ErrorCode
  readonly severity: DiagnosticSeverity
  readonly message: string
  /** JSON-pointer-like path into the offending document, when applicable. */
  readonly path?: readonly (string | number)[]
  /** Wire-safe byte and/or zero-based UTF-16 source coordinates. */
  readonly range?: SourceSpan
  readonly data?: unknown
}

export function diagnostic<const Code extends string>(
  severity: DiagnosticSeverity,
  code: string extends Code ? Code : QualifiedIdLiteral<Code>,
  message: string,
  path?: readonly (string | number)[],
  data?: unknown,
  range?: SourceSpan,
): Diagnostic {
  return {
    code: errorCode(code),
    severity,
    message,
    ...(path === undefined ? {} : { path }),
    ...(range === undefined ? {} : { range }),
    ...(data === undefined ? {} : { data }),
  }
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some(d => d.severity === 'error')
}
