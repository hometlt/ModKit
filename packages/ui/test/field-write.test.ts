import type { AnyDescriptor, FieldEditable } from '@modkit/sdk'
import { describe, expect, it } from 'vitest'
import { fieldWriteRefusal } from '../src/field-write/index.js'

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
