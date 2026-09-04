/**
 * Operation, editing, and output contracts — canonical architecture section 5.5.
 *
 * `@modkitx/assets` owns only the domain-neutral contracts needed to coordinate operations.
 * "The contracts contain no SC2 types. Implementations belong to codecs": `sc2-data` owns
 * catalog source edits, `sc2-mod` coordinates cross-codec edit transactions, `@modkitx/xml`
 * owns the raw-preserving XML splice primitives that produce {@link SourceEdit} values.
 */

import type { AssetDiagnostic } from './diagnostics.js'
import type { SourceRange } from './source.js'

/** Section 5.5, verbatim. Produced bytes, not a descriptor — never embedded in a descriptor. */
export interface AssetOutput {
  path: string
  data: Uint8Array
  mediaType?: string
  role?: string
}

/**
 * A single change against one source. Range edits are offset-based so raw-preserving codecs can
 * splice bytes/text without reserializing (and therefore without losing unknown data).
 */
export interface SourceEdit {
  /** {@link import('./source.js').AssetSourceDescriptor.id} the edit applies to. */
  readonly sourceId: string
  readonly operation: 'replace' | 'create' | 'delete' | 'rename'
  /**
   * Byte range being replaced. Required for `replace` unless the whole source is rewritten;
   * a zero-length range is an insertion at that offset.
   */
  readonly range?: SourceRange
  /** Replacement text for text-backed sources. Mutually exclusive with {@link bytes}. */
  readonly text?: string
  /** Replacement bytes for binary sources. Mutually exclusive with {@link text}. */
  readonly bytes?: Uint8Array
  /** Target path for `create` and `rename`. */
  readonly newPath?: string
  /** Short description for undo stacks and review UI. */
  readonly label?: string
}

/** Section 5.5, verbatim. */
export interface AssetEditPlan {
  edits: readonly SourceEdit[]
  diagnostics: readonly AssetDiagnostic[]
  /**
   * Whether applying the plan preserves fields, chunks, and attributes the codec does not
   * understand. `false` must surface to the user before a destructive save.
   */
  preservesUnknownData: boolean
}

/** Section 5.5, verbatim. Cross-codec coordination lives in the owning semantic codec. */
export interface AssetEditTransaction {
  plans: readonly AssetEditPlan[]
  validate(): Promise<void>
  apply(): Promise<void>
}

/**
 * Orders edits for safe sequential application: descending offset within each source, so
 * applying one edit never shifts the offsets of the edits that follow. Non-range edits
 * (`create`, `delete`, `rename`) sort last and keep their relative order.
 */
export function sortSourceEdits(edits: readonly SourceEdit[]): readonly SourceEdit[] {
  return [...edits]
    .map((edit, index) => ({ edit, index }))
    .sort((a, b) => {
      const source = a.edit.sourceId.localeCompare(b.edit.sourceId)
      if (source !== 0) return source
      const aOffset = a.edit.range?.offset
      const bOffset = b.edit.range?.offset
      if (aOffset === undefined && bOffset === undefined) return a.index - b.index
      if (aOffset === undefined) return 1
      if (bOffset === undefined) return -1
      return bOffset - aOffset || a.index - b.index
    })
    .map(entry => entry.edit)
}

/**
 * Structural validation of an edit plan, independent of any codec: overlapping ranges on one
 * source, negative or non-integer offsets, missing or doubled payloads, and missing paths.
 *
 * Returns diagnostics rather than throwing so a host can show every problem at once. Semantic
 * validation (does this catalog edit produce valid XML?) belongs to the owning codec's
 * {@link AssetEditTransaction.validate}.
 */
export function validateEditPlan(
  plan: AssetEditPlan,
  idPrefix = 'edit',
): readonly AssetDiagnostic[] {
  const diagnostics: AssetDiagnostic[] = []
  const rangesBySource = new Map<string, Array<{ range: SourceRange; index: number }>>()

  plan.edits.forEach((edit, index) => {
    const id = `${idPrefix}.${index}`
    const hasText = edit.text !== undefined
    const hasBytes = edit.bytes !== undefined

    if (hasText && hasBytes) {
      diagnostics.push({
        id: `${id}.payload`,
        severity: 'error',
        code: 'edit.conflicting-payload',
        category: 'malformed',
        message: `Edit ${index} declares both text and bytes.`,
      })
    }
    if ((edit.operation === 'replace' || edit.operation === 'create') && !hasText && !hasBytes) {
      diagnostics.push({
        id: `${id}.payload`,
        severity: 'error',
        code: 'edit.missing-payload',
        category: 'malformed',
        message: `Edit ${index} (${edit.operation}) has no text or bytes payload.`,
      })
    }
    if ((edit.operation === 'create' || edit.operation === 'rename') && !edit.newPath) {
      diagnostics.push({
        id: `${id}.path`,
        severity: 'error',
        code: 'edit.missing-path',
        category: 'malformed',
        message: `Edit ${index} (${edit.operation}) has no target path.`,
      })
    }

    const range = edit.range
    if (!range) return
    if (
      !Number.isInteger(range.offset) ||
      !Number.isInteger(range.length) ||
      range.offset < 0 ||
      range.length < 0
    ) {
      diagnostics.push({
        id: `${id}.range`,
        severity: 'error',
        code: 'edit.invalid-range',
        category: 'malformed',
        message: `Edit ${index} has an invalid range (${range.offset}, ${range.length}).`,
      })
      return
    }
    const existing = rangesBySource.get(edit.sourceId) ?? []
    for (const other of existing) {
      const aEnd = range.offset + range.length
      const bEnd = other.range.offset + other.range.length
      const overlaps = range.offset < bEnd && other.range.offset < aEnd
      // Two zero-length insertions at the same offset are ambiguous, not overlapping.
      const collidingInsertions =
        range.length === 0 && other.range.length === 0 && range.offset === other.range.offset
      if (overlaps || collidingInsertions) {
        diagnostics.push({
          id: `${id}.overlap`,
          severity: 'error',
          code: 'edit.overlapping-range',
          category: 'malformed',
          message: `Edits ${other.index} and ${index} target overlapping ranges of ${edit.sourceId}.`,
          path: edit.sourceId,
        })
        break
      }
    }
    existing.push({ range, index })
    rangesBySource.set(edit.sourceId, existing)
  })

  return diagnostics
}
