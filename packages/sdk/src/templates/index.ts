import type { JsonValue } from '../asset-capabilities/types.js'

/** Stable read-only operation shared by game-specific template implementations. */
export const GAME_TEMPLATE_PREVIEW_OPERATION_ID = 'view.template' as const
export const GAME_TEMPLATE_PREVIEW_SCHEMA_VERSION = 1 as const

export interface GameTemplateViewport {
  readonly width: number
  readonly height: number
}

/**
 * Source-neutral request. A codec may accept additional game-specific input through `options`, but
 * it must not reinterpret the common bounds or mutate its subject.
 */
export interface GameTemplatePreviewInput {
  readonly templateKind: string
  readonly rootIds?: readonly string[]
  readonly rootPath?: string
  readonly viewport?: GameTemplateViewport
  readonly maxNodes?: number
  readonly maxEdges?: number
  readonly maxDiagnostics?: number
  readonly options?: JsonValue
}

export interface GameTemplatePreviewDiagnostic {
  readonly code: string
  readonly message: string
  readonly severity?: 'error' | 'warning' | 'information' | 'hint'
  readonly path?: readonly (string | number)[]
  readonly data?: JsonValue
}

export interface GameTemplatePreviewFidelity {
  /** Product GA compares represented meaning, not pixel-identical game output. */
  readonly comparison: 'semantic'
  readonly unsupported: readonly string[]
  readonly [key: string]: JsonValue
}

/**
 * Common semantic envelope. `resolvedTree` and `displayItems` intentionally remain JSON data: each
 * game owns how a template is formed, while every consumer gets the same evidence boundary.
 */
export interface GameTemplatePreviewResult {
  readonly schemaVersion: typeof GAME_TEMPLATE_PREVIEW_SCHEMA_VERSION
  readonly operationId: typeof GAME_TEMPLATE_PREVIEW_OPERATION_ID
  readonly templateKind: string
  readonly entryUri: string
  readonly rootPath?: string
  readonly resolvedTree: JsonValue
  readonly displayItems: readonly JsonValue[]
  readonly diagnostics: readonly GameTemplatePreviewDiagnostic[]
  readonly completeness: 'complete' | 'partial' | 'capped' | 'invalid'
  readonly fidelity: GameTemplatePreviewFidelity
  readonly provenance: JsonValue
  readonly digest: JsonValue
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

/** Runtime guard for JavaScript extensions and app/MCP trust boundaries. */
export function isGameTemplatePreviewResult(value: unknown): value is GameTemplatePreviewResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  const fidelity = result['fidelity']
  return (
    result['schemaVersion'] === GAME_TEMPLATE_PREVIEW_SCHEMA_VERSION &&
    result['operationId'] === GAME_TEMPLATE_PREVIEW_OPERATION_ID &&
    nonEmpty(result['templateKind']) &&
    nonEmpty(result['entryUri']) &&
    (result['rootPath'] === undefined || typeof result['rootPath'] === 'string') &&
    typeof result['resolvedTree'] === 'object' &&
    result['resolvedTree'] !== null &&
    Array.isArray(result['displayItems']) &&
    Array.isArray(result['diagnostics']) &&
    ['complete', 'partial', 'capped', 'invalid'].includes(String(result['completeness'])) &&
    typeof fidelity === 'object' &&
    fidelity !== null &&
    !Array.isArray(fidelity) &&
    (fidelity as Record<string, unknown>)['comparison'] === 'semantic' &&
    Array.isArray((fidelity as Record<string, unknown>)['unsupported']) &&
    result['provenance'] !== undefined &&
    result['digest'] !== undefined
  )
}
