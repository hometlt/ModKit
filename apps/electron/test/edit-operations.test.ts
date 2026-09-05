import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  awaitSelfTestProbe,
  editOffer,
  editPlanFromOperationOutput,
  editSelfTestLine,
  invokeRefusalMessage,
  isSelfTestEditOutcome,
  offersEditOperations,
} from '../src/edit-operations.js'

function manifest(path: string) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as {
    spec: { operations: readonly Record<string, unknown>[] }
  }
}

function descriptor(path: string, metadata: readonly Record<string, unknown>[] = []) {
  return {
    operations: manifest(path).spec.operations.map(operation => ({
      ...operation,
      state: 'available',
    })),
    metadata,
    traits: [],
  }
}

const ZIP = descriptor('../../../extensions/archives/contributions/codec-zip.json')
const PNG = descriptor('../../../extensions/images/contributions/codec-png.json', [
  {
    id: 'png-text',
    label: 'Text',
    entries: [
      {
        key: 'Description',
        value: 'old',
        type: { kind: 'text' },
        editable: { write: { operation: 'edit.field' } },
      },
    ],
  },
])

describe('Electron schema-driven edit adapter', () => {
  it('uses the same published form schemas as every other app', () => {
    expect(editOffer(ZIP, { editable: true }).forms.map(form => form.id)).toEqual([
      'zip-add-entry',
      'zip-remove-entry',
      'zip-rename-entry',
      'zip-replace-entry',
    ])
    expect(
      editOffer(PNG, { editable: true }).forms[0]?.build(
        new Map([
          ['key', 'Title'],
          ['value', 'hello'],
        ]),
      ),
    ).toEqual({ groupId: 'png-text', key: 'Title', value: 'hello' })
    expect(editOffer(ZIP, { editable: false })).toEqual({ forms: [], unsupported: [] })
    expect(offersEditOperations(ZIP, { editable: true })).toBe(true)
  })

  it('reports unpublished schemas rather than guessing handler inputs', () => {
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

  it('retains plan, refusal and self-test helpers', async () => {
    const plan = { planId: 'p' } as never
    expect(editPlanFromOperationOutput({ kind: 'edit-plan', plan })).toBe(plan)
    expect(() => editPlanFromOperationOutput({ kind: 'json' })).toThrow(
      /not an edit plan|wrong kind/u,
    )
    expect(invokeRefusalMessage({ reason: 'permission-missing' })).toContain('permission-missing')
    expect(editSelfTestLine('png', 'png-set-text', 'ok', true)).toContain('changed=true')
    expect(isSelfTestEditOutcome('', 'Set PNG text — ok', 'Set PNG text')).toBe(true)
    await expect(awaitSelfTestProbe(Promise.resolve('ok'), 'quick')).resolves.toBe('ok')
  })
})
