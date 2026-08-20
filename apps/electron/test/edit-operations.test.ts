/**
 * The mutating-operation surface, everything of it that is decidable without a window.
 *
 * Three things are proved here, and the live `--selftest` run proves the fourth (that the plan
 * this produces reaches a file on disk):
 *
 *  - the offer rule: a subject with no editing arm offers nothing, a mutating operation the app
 *    cannot build an input for is reported in words rather than drawn, and only `available`
 *    operations are considered;
 *  - the forms: each builds the input its codec documents, and refuses an empty required value
 *    before anything is invoked;
 *  - the adaptation: an `edit-plan` output becomes a plan, any other output is refused, and a host
 *    refusal keeps the reason the host gave.
 */
import { describe, expect, it } from 'vitest'
import type { AssetEditPlan } from '@modkitx-x3/sdk'

import {
  base64OfUtf8,
  editOffer,
  editPlanFromOperationOutput,
  editSelfTestLine,
  invokeRefusalMessage,
  offersEditOperations,
  type EditOperationForm,
} from '../src/edit-operations.js'
import { applicablePanels } from '../src/view-policy.js'

const descriptorWith = (
  operations: readonly Record<string, unknown>[],
  contracts: readonly string[] = [],
): Record<string, unknown> => ({
  subjectUri: 'file:///sample',
  revision: 'content-hash.sha256:sample',
  dataSources: contracts.map(contract => ({ contract, major: 1 })),
  traits: [],
  operations,
})

const operation = (
  id: string,
  handlerId: string,
  overrides: { mutatesSource?: boolean; state?: string } = {},
): Record<string, unknown> => ({
  id,
  handlerId,
  mutatesSource: overrides.mutatesSource ?? true,
  state: overrides.state ?? 'available',
})

const ZIP = descriptorWith(
  [
    operation('view.inspect', 'inspect', { mutatesSource: false }),
    operation('edit.structure', 'edit-structure'),
    operation('edit.content', 'edit-content'),
  ],
  ['common.view/namespace-entry-source'],
)

const PNG = descriptorWith([
  operation('view.inspect', 'inspect', { mutatesSource: false }),
  operation('edit.field', 'set-text'),
])

const MP3 = descriptorWith([operation('edit.field', 'set-text-frame')])

const values = (entries: Readonly<Record<string, string>>): ReadonlyMap<string, string> =>
  new Map(Object.entries(entries))

const formOf = (descriptor: Record<string, unknown>, id: string): EditOperationForm => {
  const found = editOffer(descriptor, { editable: true }).forms.find(item => item.id === id)
  if (found === undefined) throw new Error(`no form ${id}`)
  return found
}

describe('the offer rule', () => {
  it('offers nothing at all for a subject this host holds no editing arm for', () => {
    expect(editOffer(ZIP, { editable: false })).toEqual({ forms: [], unsupported: [] })
    expect(editOffer(PNG, { editable: false }).forms).toEqual([])
    expect(offersEditOperations(PNG, { editable: false })).toBe(false)
  })

  it('offers a form per action the app can build an input for, and only for mutating operations', () => {
    const offer = editOffer(ZIP, { editable: true })
    expect(offer.forms.map(form => form.id)).toEqual([
      'zip-add-entry',
      'zip-remove-entry',
      'zip-rename-entry',
      'zip-replace-entry',
    ])
    // `view.inspect` is not mutating, so it belongs to the Operations panel, not to this one
    expect(offer.forms.every(form => form.operationId.startsWith('edit.'))).toBe(true)
    expect(offer.unsupported).toEqual([])
    expect(editOffer(PNG, { editable: true }).forms.map(form => form.handlerId)).toEqual([
      'set-text',
    ])
    expect(editOffer(MP3, { editable: true }).forms.map(form => form.handlerId)).toEqual([
      'set-text-frame',
    ])
  })

  it('states a mutating operation it cannot construct an input for instead of drawing a control', () => {
    const strange = descriptorWith([operation('edit.field', 'set-unknown-thing')])
    const offer = editOffer(strange, { editable: true })
    expect(offer.forms).toEqual([])
    expect(offer.unsupported).toEqual([
      {
        operationId: 'edit.field',
        handlerId: 'set-unknown-thing',
        reason: 'this host cannot construct the input for «set-unknown-thing» yet',
      },
    ])
    // the panel is still offered, because "not available here" is a sentence worth showing
    expect(offersEditOperations(strange, { editable: true })).toBe(true)
  })

  it('ignores an operation the codec itself disabled for this file', () => {
    // an encrypted or ZIP64 archive: the codec says the edit cannot happen for this input
    const refused = descriptorWith([
      operation('edit.structure', 'edit-structure', { state: 'unavailable' }),
    ])
    expect(editOffer(refused, { editable: true })).toEqual({ forms: [], unsupported: [] })
    expect(offersEditOperations(refused, { editable: true })).toBe(false)
  })

  it('refuses to match a form to a verb it was not written for', () => {
    // the same handler name under a different standard verb is a different operation
    const mismatched = descriptorWith([operation('edit.content', 'set-text')])
    expect(editOffer(mismatched, { editable: true }).forms).toEqual([])
    expect(editOffer(mismatched, { editable: true }).unsupported).toHaveLength(1)
  })
})

describe('the inspector panel policy', () => {
  it('adds the Edit panel only when the shell says the subject is editable here', () => {
    expect(applicablePanels(PNG).map(panel => panel.id)).not.toContain('edit')
    expect(applicablePanels(PNG, { editing: false }).map(panel => panel.id)).not.toContain('edit')
    expect(applicablePanels(PNG, { editing: true }).map(panel => panel.id)).toEqual([
      'operations',
      'edit',
      'metadata',
      'properties',
      'diagnostics',
    ])
  })
})

describe('the forms', () => {
  it('builds the ZIP structure inputs the codec documents', () => {
    expect(
      formOf(ZIP, 'zip-add-entry').build(values({ path: 'added/hello.txt', content: 'hi\n' })),
    ).toEqual({ add: [{ path: 'added/hello.txt', bytes: 'aGkK' }] })
    expect(formOf(ZIP, 'zip-remove-entry').build(values({ path: 'drop.bin' }))).toEqual({
      remove: ['drop.bin'],
    })
    expect(
      formOf(ZIP, 'zip-rename-entry').build(values({ from: 'a.txt', to: 'docs/a.txt' })),
    ).toEqual({ rename: [{ from: 'a.txt', to: 'docs/a.txt' }] })
    expect(
      formOf(ZIP, 'zip-replace-entry').build(values({ path: 'a.txt', content: 'new' })),
    ).toEqual({ path: 'a.txt', bytes: 'bmV3' })
  })

  it('builds the metadata inputs the image and audio codecs document', () => {
    expect(
      formOf(PNG, 'png-set-text').build(values({ keyword: 'Title', text: 'a title' })),
    ).toEqual({ keyword: 'Title', text: 'a title' })
    expect(
      formOf(MP3, 'mp3-set-text-frame').build(values({ keyword: 'TIT2', text: 'a title' })),
    ).toEqual({ keyword: 'TIT2', text: 'a title' })
    // an empty text is a legitimate value; an empty keyword is not, and nothing is invoked for it
    expect(formOf(PNG, 'png-set-text').build(values({ keyword: 'Title' }))).toEqual({
      keyword: 'Title',
      text: '',
    })
    expect(() => formOf(PNG, 'png-set-text').build(values({ keyword: '' }))).toThrow(/required/u)
    expect(() => formOf(ZIP, 'zip-add-entry').build(values({ content: 'x' }))).toThrow(/required/u)
  })

  it('every offered field is prefilled, so the control is usable without reading the format spec', () => {
    for (const descriptor of [ZIP, PNG, MP3]) {
      for (const form of editOffer(descriptor, { editable: true }).forms) {
        expect(form.fields.length, form.id).toBeGreaterThan(0)
        for (const field of form.fields)
          expect(field.initial, `${form.id}/${field.name}`).not.toBe('')
        // a form's own input must be buildable from its own defaults
        expect(() =>
          form.build(new Map(form.fields.map(field => [field.name, field.initial]))),
        ).not.toThrow()
      }
    }
  })

  it('encodes bytes parameters as standard base64 the codec accepts', () => {
    expect(base64OfUtf8('')).toBe('')
    expect(base64OfUtf8('a')).toBe('YQ==')
    expect(base64OfUtf8('ab')).toBe('YWI=')
    expect(base64OfUtf8('abc')).toBe('YWJj')
    expect(base64OfUtf8('hello from A4\n')).toBe('aGVsbG8gZnJvbSBBNAo=')
    // non-ASCII travels as UTF-8, which is what the app promises in the field hint
    expect(base64OfUtf8('é')).toBe('w6k=')
    // the ZIP codec refuses anything that is not standard base64 without whitespace
    expect(base64OfUtf8('the quick brown fox')).toMatch(
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u,
    )
  })
})

describe('plan adaptation and refusals', () => {
  const PLAN = {
    planId: 'zip-edit-structure:+1-0~0',
    targets: [],
    edits: [],
  } as unknown as AssetEditPlan

  it('takes the plan out of an edit-plan output', () => {
    expect(editPlanFromOperationOutput({ kind: 'edit-plan', plan: PLAN })).toBe(PLAN)
  })

  it('refuses any other output kind by name rather than casting it', () => {
    expect(() => editPlanFromOperationOutput({ kind: 'json', value: 1 })).toThrow(/«json»/u)
    expect(() => editPlanFromOperationOutput({ kind: 'none' })).toThrow(/«none»/u)
    expect(() => editPlanFromOperationOutput(undefined)).toThrow(/«nothing»/u)
    expect(() => editPlanFromOperationOutput({ kind: 'edit-plan' })).toThrow(/not an edit plan/u)
  })

  it('keeps the reason a refused invoke carried, in words and in code', () => {
    expect(invokeRefusalMessage({ reason: 'permission-missing', diagnostics: [] })).toBe(
      'refused: this session was not opened with permission to write the file (permission-missing)',
    )
    expect(
      invokeRefusalMessage({
        reason: 'permission-missing',
        diagnostics: [{ message: 'operation set-text requires classes: write-source' }],
      }),
    ).toContain('operation set-text requires classes: write-source')
    expect(invokeRefusalMessage({ reason: 'stale-revision' })).toContain('stale-revision')
    // an unknown reason is reported verbatim, never flattened into "failed"
    expect(invokeRefusalMessage({ reason: 'something-new' })).toBe('refused: something-new')
  })

  it('prints one line per applied operation, the shape the run is read by', () => {
    expect(editSelfTestLine('sample.zip', 'zip-add-entry', 'saved', true)).toBe(
      'selftest: edit-op sample.zip zip-add-entry status="saved" changed=true',
    )
  })
})
