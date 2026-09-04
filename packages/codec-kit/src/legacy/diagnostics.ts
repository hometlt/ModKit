import { errorCode, ModkitError, uint64 } from '@modkit/core'
import type { AssetDiagnostic, AssetDiagnosticCategory } from '@modkit/sdk'
import type {
  AssetDiagnostic as LegacyDiagnostic,
  AssetDiagnosticCategory as LegacyCategory,
} from './assets/diagnostics.js'
import { ModkitError as LegacyError } from './core/errors.js'

export const LEGACY_DIAGNOSTIC_CATEGORIES = Object.freeze({
  'unsupported-feature': 'fidelity',
  'unsupported-variant': 'fidelity',
  'missing-companion': 'dependency',
  'ambiguous-companion': 'dependency',
  'runtime-unavailable': 'dependency',
  'permission-required': 'security',
  'resource-limit': 'performance',
  malformed: 'syntax',
  truncated: 'structure',
  'ambiguous-detection': 'structure',
  'partial-support': 'fidelity',
  'read-only-source': 'io',
  cancelled: 'operation',
  other: 'unknown',
} satisfies Record<LegacyCategory, AssetDiagnosticCategory>)

// Hex encoding is injective and obeys the lowercase qualified-id grammar for every legacy code.
export const legacyBoundaryCode = (code: string): string =>
  `codec-kit/legacy-${Array.from(new TextEncoder().encode(code), byte => byte.toString(16).padStart(2, '0')).join('') || 'empty'}`

/** Preserve the original code/category/detail in data; qualify only at the MK3 boundary. */
export function adaptDiagnostic(value: LegacyDiagnostic): AssetDiagnostic {
  return {
    id: value.id,
    code: errorCode(legacyBoundaryCode(value.code)),
    severity: value.severity === 'info' ? 'information' : value.severity,
    message: value.message,
    category: LEGACY_DIAGNOSTIC_CATEGORIES[value.category ?? 'other'],
    ...(value.source === undefined ? {} : { source: { contributionId: value.source } }),
    ...(value.range === undefined
      ? {}
      : {
          range: {
            byteOffset: uint64(BigInt(value.range.offset)),
            byteLength: uint64(BigInt(value.range.length)),
          },
        }),
    ...(value.relatedIds === undefined ? {} : { relatedIds: value.relatedIds }),
    data: {
      legacyCode: value.code,
      legacyCategory: value.category ?? 'other',
      ...(value.path === undefined ? {} : { legacyPath: value.path }),
      ...(value.detail === undefined ? {} : { legacyDetail: value.detail }),
    },
  }
}

export function adaptLegacyError(value: unknown): unknown {
  if (!(value instanceof LegacyError)) return value
  return new ModkitError({
    code: errorCode(legacyBoundaryCode(value.code)),
    message: value.message,
    cause: value,
    context: {
      legacyCode: value.code,
      ...(value.context === undefined ? {} : { legacyContext: value.context }),
      ...(value.hint === undefined ? {} : { legacyHint: value.hint }),
    },
  })
}
