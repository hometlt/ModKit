/**
 * Structured asset diagnostics.
 *
 * Unsupported variants, missing companions, unavailable runtimes, permission denials, and
 * resource limits produce diagnostics and partial views rather than blank or failed shells
 * (canonical architecture, section 5, pipeline rule 6). Capabilities, operations, companions,
 * and edit plans reference diagnostics by stable {@link AssetDiagnostic.id} so a descriptor
 * stays a flat, serializable value.
 */

import type { JsonValue } from './json.js'
import type { SourceRange } from './source.js'

export type AssetDiagnosticSeverity = 'info' | 'warning' | 'error'

/**
 * Why a diagnostic was raised. The union is intentionally about *classes of degradation*
 * rather than formats, so viewer chrome can render a consistent explanation without knowing
 * the codec.
 */
export type AssetDiagnosticCategory =
  | 'unsupported-feature'
  | 'unsupported-variant'
  | 'missing-companion'
  | 'ambiguous-companion'
  | 'runtime-unavailable'
  | 'permission-required'
  | 'resource-limit'
  | 'malformed'
  | 'truncated'
  | 'ambiguous-detection'
  | 'partial-support'
  | 'read-only-source'
  | 'cancelled'
  | 'other'

export interface AssetDiagnostic {
  /** Stable within one descriptor; referenced by `diagnosticIds` elsewhere in the descriptor. */
  readonly id: string
  readonly severity: AssetDiagnosticSeverity
  /** Stable machine code, e.g. `dds.unsupported-dxgi-format`. Never a localized sentence. */
  readonly code: string
  /** Human-readable, already-resolved message. */
  readonly message: string
  readonly category?: AssetDiagnosticCategory
  /** Codec/adapter ID that raised the diagnostic (the descriptor's `pluginId` by default). */
  readonly source?: string
  /** Byte range in the owning source, when the diagnostic is positional. */
  readonly range?: SourceRange
  /** Logical path (archive entry, companion, or child) the diagnostic refers to. */
  readonly path?: string
  /** Serializable structured detail for host telemetry and tests. */
  readonly detail?: { readonly [key: string]: JsonValue }
  /** Other diagnostic IDs in the same descriptor that explain or are caused by this one. */
  readonly relatedIds?: readonly string[]
}

const SEVERITY_ORDER: Readonly<Record<AssetDiagnosticSeverity, number>> = {
  info: 0,
  warning: 1,
  error: 2,
}

/** Negative when `a` is less severe than `b`; sorts `info < warning < error`. */
export function compareDiagnosticSeverity(
  a: AssetDiagnosticSeverity,
  b: AssetDiagnosticSeverity,
): number {
  return SEVERITY_ORDER[a] - SEVERITY_ORDER[b]
}

/** Highest severity present, or `undefined` for an empty list. */
export function worstDiagnosticSeverity(
  diagnostics: readonly AssetDiagnostic[],
): AssetDiagnosticSeverity | undefined {
  let worst: AssetDiagnosticSeverity | undefined
  for (const diagnostic of diagnostics) {
    if (!worst || compareDiagnosticSeverity(diagnostic.severity, worst) > 0) {
      worst = diagnostic.severity
    }
  }
  return worst
}

/**
 * Resolves `diagnosticIds` against a diagnostic list, preserving the requested order and
 * dropping unknown IDs. Dangling IDs are a producer bug; use {@link findDanglingDiagnosticIds}
 * in codec tests to catch them.
 */
export function collectDiagnosticsById(
  diagnostics: readonly AssetDiagnostic[],
  ids: readonly string[] | undefined,
): readonly AssetDiagnostic[] {
  if (!ids?.length) return []
  const byId = new Map(diagnostics.map(diagnostic => [diagnostic.id, diagnostic]))
  const resolved: AssetDiagnostic[] = []
  for (const id of ids) {
    const diagnostic = byId.get(id)
    if (diagnostic) resolved.push(diagnostic)
  }
  return resolved
}

/** IDs referenced by `ids` that are absent from `diagnostics`, in first-seen order. */
export function findDanglingDiagnosticIds(
  diagnostics: readonly AssetDiagnostic[],
  ids: readonly string[],
): readonly string[] {
  const known = new Set(diagnostics.map(diagnostic => diagnostic.id))
  const dangling: string[] = []
  for (const id of ids) {
    if (!known.has(id) && !dangling.includes(id)) dangling.push(id)
  }
  return dangling
}
