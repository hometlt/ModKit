/** The VS Code-local Path A offer rule and every form it can honestly drive. */
import { describe, expect, it } from 'vitest'
import type { AssetEditPlan } from '@modkit/sdk'

import {
  EDIT_FORM_IDS,
  editOffer,
  editPlanFromOperationOutput,
  invokeRefusalMessage,
  type EditOperationForm,
} from '../src/edit-operations.js'

const operation = (
  id: string,
  handlerId: string,
  mutatesSource = true,
): Record<string, unknown> => ({ id, handlerId, mutatesSource, state: 'available' })

const descriptor = (operations: readonly Record<string, unknown>[]): Record<string, unknown> => ({
  dataSources: [{ contract: 'common.view/byte-range-source', major: 1 }],
  traits: [],
  operations,
})

const ZIP = descriptor([
  operation('view.inspect', 'inspect', false),
  operation('edit.structure', 'edit-structure'),
  operation('edit.content', 'edit-content'),
])
const PNG = descriptor([operation('edit.field', 'set-text')])
const MP3 = descriptor([operation('edit.field', 'set-text-frame')])
const JPEG = descriptor([
  operation('edit.field', 'set-comment'),
  operation('edit.structure', 'remove-segment'),
])

const formOf = (source: Record<string, unknown>, id: string): EditOperationForm => {
  const found = editOffer(source, { editable: true }).forms.find(item => item.id === id)
  if (found === undefined) throw new Error(`missing form ${id}`)
  return found
}

const values = (value: Readonly<Record<string, string>>): ReadonlyMap<string, string> =>
  new Map(Object.entries(value))

describe('the VS Code mutating-operation offer', () => {
  it('offers nothing without an editing arm and names an available handler it cannot drive', () => {
    expect(editOffer(ZIP, { editable: false })).toEqual({ forms: [], unsupported: [] })
    expect(
      editOffer(descriptor([operation('edit.field', 'codec-private-handler')]), {
        editable: true,
      }),
    ).toEqual({
      forms: [],
      unsupported: [
        {
          operationId: 'edit.field',
          handlerId: 'codec-private-handler',
          reason: 'this host cannot construct the input for «codec-private-handler» yet',
        },
      ],
    })
  })

  it('keys forms by handler, including three different edit.field input shapes', () => {
    expect(editOffer(PNG, { editable: true }).forms.map(item => item.handlerId)).toEqual([
      'set-text',
    ])
    expect(editOffer(MP3, { editable: true }).forms.map(item => item.handlerId)).toEqual([
      'set-text-frame',
    ])
    expect(editOffer(JPEG, { editable: true }).forms.map(item => item.handlerId)).toEqual([
      'set-comment',
      'remove-segment',
    ])
    expect(formOf(PNG, 'png-set-text').build(values({ keyword: 'Title', text: 'PNG' }))).toEqual({
      keyword: 'Title',
      text: 'PNG',
    })
    expect(
      formOf(MP3, 'mp3-set-text-frame').build(values({ keyword: 'TIT2', text: 'MP3' })),
    ).toEqual({ keyword: 'TIT2', text: 'MP3' })
    expect(formOf(JPEG, 'jpeg-set-comment').build(values({ text: 'JPEG' }))).toEqual({
      text: 'JPEG',
    })
  })

  it('builds every ZIP structure/content form and accounts for the complete local table', () => {
    expect(editOffer(ZIP, { editable: true }).forms.map(item => item.id)).toEqual([
      'zip-add-entry',
      'zip-remove-entry',
      'zip-rename-entry',
      'zip-replace-entry',
    ])
    expect(formOf(ZIP, 'zip-add-entry').build(values({ path: 'a.txt', content: 'hi' }))).toEqual({
      add: [{ path: 'a.txt', bytes: 'aGk=' }],
    })
    expect(formOf(ZIP, 'zip-remove-entry').build(values({ path: 'a.txt' }))).toEqual({
      remove: ['a.txt'],
    })
    expect(formOf(ZIP, 'zip-rename-entry').build(values({ from: 'a', to: 'b' }))).toEqual({
      rename: [{ from: 'a', to: 'b' }],
    })
    expect(formOf(ZIP, 'zip-replace-entry').build(values({ path: 'a', content: 'new' }))).toEqual({
      path: 'a',
      bytes: 'bmV3',
    })
    expect(EDIT_FORM_IDS).toEqual([
      'png-set-text',
      'mp3-set-text-frame',
      'jpeg-set-comment',
      'jpeg-remove-segment',
      'zip-add-entry',
      'zip-remove-entry',
      'zip-rename-entry',
      'zip-replace-entry',
    ])
  })
})

describe('Path A adaptation and refusal vocabulary', () => {
  it('accepts only an edit-plan output and preserves invoke reasons verbatim', () => {
    const plan = { planId: 'operation-plan' } as unknown as AssetEditPlan
    expect(editPlanFromOperationOutput({ kind: 'edit-plan', plan })).toBe(plan)
    expect(() => editPlanFromOperationOutput({ kind: 'json', value: 1 })).toThrow(/«json»/u)
    expect(
      invokeRefusalMessage({
        reason: 'permission-missing',
        diagnostics: [{ message: 'codec diagnostic, exact words' }],
      }),
    ).toContain('codec diagnostic, exact words')
    expect(invokeRefusalMessage({ reason: 'new-coordinator-reason' })).toBe(
      'refused: new-coordinator-reason',
    )
  })
})
