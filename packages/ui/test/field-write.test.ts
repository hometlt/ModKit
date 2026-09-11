import type { AnyDescriptor, FieldEditable, SubjectEditTargetResult } from '@modkit/sdk'
import { describe, expect, it } from 'vitest'
import { fieldEditTargetText, fieldWriteRefusal } from '../src/field-write/index.js'

function descriptor(
  operations: readonly { id: string; state: string; handlerId?: string }[],
): AnyDescriptor {
  return {
    operations: operations.map(operation => ({
      handlerId: 'h',
      mutatesSource: true,
      ...operation,
    })),
  } as unknown as AnyDescriptor
}

/**
 * The decision "may this value be edited" is the one place this surface can quietly lie: a control
 * that renders, accepts a value and then has nowhere to send it loses the reader's work. Each arm
 * below is a separate way that can happen, so each is pinned separately.
 */
describe('field write eligibility', () => {
  const available = descriptor([{ id: 'edit.field', state: 'available' }])

  it('accepts a declaration whose operation the descriptor offers', () => {
    const editable: FieldEditable = { write: { operation: 'edit.field' } } as FieldEditable
    expect(fieldWriteRefusal(available, editable)).toBeUndefined()
  })

  it('refuses when the codec published no declaration at all', () => {
    expect(fieldWriteRefusal(available, undefined)).toMatch(/does not offer/u)
  })

  it('repeats the codec’s own reason rather than inventing one', () => {
    const editable = {
      write: { operation: 'edit.field' },
      readonlyReason: 'the declaring mod is not writable',
    } as unknown as FieldEditable
    expect(fieldWriteRefusal(available, editable)).toBe('the declaring mod is not writable')
  })

  it('refuses a named operation this descriptor never declared', () => {
    const editable: FieldEditable = { write: { operation: 'edit.absent' } } as FieldEditable
    expect(fieldWriteRefusal(available, editable)).toMatch(/declares no operation/u)
  })

  it('refuses an operation the codec disabled for this file, and says so', () => {
    const disabled = descriptor([{ id: 'edit.field', state: 'disabled' }])
    const editable: FieldEditable = { write: { operation: 'edit.field' } } as FieldEditable
    expect(fieldWriteRefusal(disabled, editable)).toMatch(/is disabled for this file/u)
  })

  it('refuses a writer-service route, which this inline surface does not hold', () => {
    const editable = {
      write: { writer: { contract: 'common.edit/writer' } },
    } as unknown as FieldEditable
    expect(fieldWriteRefusal(available, editable)).toMatch(/writer service/u)
  })
})

describe('field edit target preview', () => {
  it('uses the exact host-bound destination label', () => {
    const target = {
      state: 'resolved',
      destination: {
        label: 'Write: C → C.SC2Mod/Base.SC2Data/GameData/UnitData.xml',
      },
    } as SubjectEditTargetResult
    expect(fieldEditTargetText(target)).toBe(
      'Write: C → C.SC2Mod/Base.SC2Data/GameData/UnitData.xml',
    )
  })

  it('names every candidate when explicit target selection is required', () => {
    const target = {
      state: 'selection-required',
      reason: 'choose the authored document',
      candidates: [
        { rootId: 'B', path: 'B.SC2Mod/Base.SC2Data/GameData/UnitData.xml' },
        { rootId: 'C', path: 'C.SC2Mod/Base.SC2Data/GameData/UnitData.xml' },
      ],
    } as SubjectEditTargetResult
    expect(fieldEditTargetText(target)).toBe(
      'choose the authored document: B → B.SC2Mod/Base.SC2Data/GameData/UnitData.xml; C → C.SC2Mod/Base.SC2Data/GameData/UnitData.xml',
    )
  })

  it('shows the provider refusal when no destination exists', () => {
    const target = {
      state: 'unavailable',
      reason: 'the selected mod is read-only',
    } as SubjectEditTargetResult
    expect(fieldEditTargetText(target)).toBe('the selected mod is read-only')
  })
})
