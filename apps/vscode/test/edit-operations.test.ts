import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  editOffer,
  editPlanFromOperationOutput,
  invokeRefusalMessage,
  offersEditOperations,
} from '../src/edit-operations.js'

function descriptor(path: string, metadata: readonly Record<string, unknown>[] = []) {
  const parsed = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as {
    spec: { operations: readonly Record<string, unknown>[] }
  }
  return {
    operations: parsed.spec.operations.map(operation => ({ ...operation, state: 'available' })),
    metadata,
    traits: [],
  }
}

describe('VS Code schema-driven edit adapter', () => {
  it('discovers archive forms from descriptor input schemas', () => {
    const zip = descriptor('../../../extensions/archives/contributions/codec-zip.json')
    const offer = editOffer(zip, { editable: true })
    expect(offer.forms.map(form => form.id)).toEqual([
      'zip-add-entry',
      'zip-remove-entry',
      'zip-rename-entry',
      'zip-replace-entry',
    ])
    expect(offersEditOperations(zip, { editable: true })).toBe(true)
    expect(editOffer(zip, { editable: false })).toEqual({ forms: [], unsupported: [] })
  })

  it('fails closed for an unpublished handler schema', () => {
    const unknown = {
      operations: [
        { id: 'edit.field', handlerId: 'private', mutatesSource: true, state: 'available' },
      ],
      metadata: [],
      traits: [],
    }
    expect(editOffer(unknown, { editable: true }).unsupported[0]?.reason).toBe(
      'the operation did not publish an input schema',
    )
  })

  it('keeps protocol-neutral result helpers', () => {
    const plan = { planId: 'p' } as never
    expect(editPlanFromOperationOutput({ kind: 'edit-plan', plan })).toBe(plan)
    expect(() => editPlanFromOperationOutput(null)).toThrow(/not an edit plan/u)
    expect(invokeRefusalMessage({ reason: 'handler-unregistered' })).toContain(
      'handler-unregistered',
    )
  })
})
