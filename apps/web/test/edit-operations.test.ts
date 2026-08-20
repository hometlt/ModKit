/**
 * The Edit panel's *policy*, in Node: the offer rule and every form's input shape.
 *
 * `edit-panel.test.ts` drives the panel in a real Chromium over real codecs, which is the proof
 * that the round trip works. It is also slow, and it can only reach the formats this app ships a
 * writable sample for. This file is the other half: the rule that decides whether a control is
 * drawn at all, and the exact JSON each form hands the codec — asserted directly, for every form
 * in the table including the ones no live test opens (MP3, JPEG, rename, replace).
 *
 * Nothing here mounts anything. `../src/edit-operations.ts` is data and pure functions on purpose.
 */
import { describe, expect, it } from 'vitest'
import type { AnyDescriptor, AssetEditPlan, MetadataGroup } from '@modkitx-x3/sdk'

import {
  base64OfUtf8,
  declaredMutatingOperations,
  editOffer,
  EDIT_FORM_IDS,
  fidelityNote,
  invokeRefusalMessage,
  metadataEntries,
  offersEditPanel,
  type EditOperationForm,
} from '../src/edit-operations.js'
import { declinedNonMutatingOperations, nonMutatingDescriptor } from '../src/inspector.js'

interface OperationFacts {
  readonly id: string
  readonly handlerId: string
  readonly mutatesSource: boolean
  readonly state?: 'available' | 'disabled' | 'dependency-required'
}

/** A resolved descriptor with exactly the operations and metadata a case is about. */
const descriptor = (
  operations: readonly OperationFacts[],
  metadata: readonly MetadataGroup[] = [],
): AnyDescriptor =>
  ({
    schemaVersion: 2,
    subjectUri: 'file-picker://sample',
    revision: 'content-hash.sha256:sample',
    interpretation: 'codec',
    identity: {
      codecId: 'test',
      codecVersion: '1',
      formatId: 'test',
      formatLabel: 'Test',
      confidence: 1,
      detection: [],
    },
    origin: { kind: 'source' },
    constraints: { readOnly: false, seekable: true, randomAccess: true, trusted: false },
    traits: [],
    dataSources: [],
    diagnostics: [],
    metadata,
    operations: operations.map(operation => ({
      state: 'available',
      ...operation,
      ...(operation.state === undefined || operation.state === 'available'
        ? {}
        : { reason: 'the codec refused it for this file' }),
    })),
  }) as unknown as AnyDescriptor

const ZIP_OPERATIONS: readonly OperationFacts[] = [
  { id: 'view.inspect', handlerId: 'inspect', mutatesSource: false },
  { id: 'asset.validate', handlerId: 'validate', mutatesSource: false },
  { id: 'export.raw', handlerId: 'export-raw', mutatesSource: false },
  {
    id: 'container.extract',
    handlerId: 'extract-entry',
    mutatesSource: false,
  },
  { id: 'edit.structure', handlerId: 'edit-structure', mutatesSource: true },
  { id: 'edit.content', handlerId: 'edit-content', mutatesSource: true },
]

const PNG_OPERATIONS: readonly OperationFacts[] = [
  { id: 'view.inspect', handlerId: 'inspect', mutatesSource: false },
  { id: 'edit.field', handlerId: 'set-text', mutatesSource: true },
]

const MP3_OPERATIONS: readonly OperationFacts[] = [
  { id: 'media.seek', handlerId: 'transport-seek', mutatesSource: false },
  { id: 'edit.field', handlerId: 'set-text-frame', mutatesSource: true },
]

const EDITABLE = { editable: true } as const

const formOf = (subject: AnyDescriptor, id: string): EditOperationForm => {
  const found = editOffer(subject, EDITABLE).forms.find(item => item.id === id)
  if (found === undefined) throw new Error(`no form «${id}» was offered`)
  return found
}

const built = (subject: AnyDescriptor, id: string, values: Record<string, string>): unknown =>
  formOf(subject, id).build(new Map(Object.entries(values)))

const initials = (subject: AnyDescriptor, id: string): Record<string, string> =>
  Object.fromEntries(formOf(subject, id).fields.map(field => [field.name, field.initial]))

// ---------------------------------------------------------------------------------------------

describe('the offer rule', () => {
  it('offers nothing at all for a subject this page cannot write', () => {
    const offer = editOffer(descriptor(ZIP_OPERATIONS), { editable: false })
    expect(offer.forms).toEqual([])
    expect(offer.unsupported).toEqual([])
    expect(offersEditPanel(descriptor(ZIP_OPERATIONS), { editable: false })).toBe(false)
  })

  it('offers one form per (verb, handler) the app knows, and ignores the read-only verbs', () => {
    const offer = editOffer(descriptor(ZIP_OPERATIONS), EDITABLE)
    expect(offer.forms.map(form => form.id)).toEqual([
      'zip-add-entry',
      'zip-remove-entry',
      'zip-rename-entry',
      'zip-replace-entry',
    ])
    expect(offer.unsupported).toEqual([])
    for (const form of offer.forms) expect(form.operationId.startsWith('edit.')).toBe(true)
  })

  it('names a mutating operation it has no form for instead of drawing one', () => {
    const offer = editOffer(
      descriptor([{ id: 'edit.field', handlerId: 'set-exif-tag', mutatesSource: true }]),
      EDITABLE,
    )
    expect(offer.forms).toEqual([])
    expect(offer.unsupported).toEqual([
      {
        operationId: 'edit.field',
        handlerId: 'set-exif-tag',
        reason: 'this host cannot construct the input for «set-exif-tag» yet',
      },
    ])
    // …and a subject with only unsupported operations gets no panel: there is nothing to fill in.
    expect(
      offersEditPanel(
        descriptor([{ id: 'edit.field', handlerId: 'set-exif-tag', mutatesSource: true }]),
        EDITABLE,
      ),
    ).toBe(false)
  })

  it('skips a mutating operation the codec itself disabled', () => {
    const offer = editOffer(
      descriptor([
        {
          id: 'edit.structure',
          handlerId: 'edit-structure',
          mutatesSource: true,
          state: 'disabled',
        },
      ]),
      EDITABLE,
    )
    expect(offer.forms).toEqual([])
    expect(offer.unsupported).toEqual([])
    // the operation is still declared, which is what the inspector counts and states
    expect(
      declaredMutatingOperations(
        descriptor([
          {
            id: 'edit.structure',
            handlerId: 'edit-structure',
            mutatesSource: true,
            state: 'disabled',
          },
        ]),
      ).map(operation => operation.id),
    ).toEqual(['edit.structure'])
  })

  it('refuses a form for a handler that is right but a verb that is not', () => {
    // `edit-structure` is a ZIP handler for `edit.structure`; the same handler name under
    // `edit.field` is a different codec's operation and this app has no form for it.
    const offer = editOffer(
      descriptor([{ id: 'edit.field', handlerId: 'edit-structure', mutatesSource: true }]),
      EDITABLE,
    )
    expect(offer.forms).toEqual([])
    expect(offer.unsupported.map(item => item.handlerId)).toEqual(['edit-structure'])
  })

  it('offers a form for every handler in the shipped table', () => {
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

describe('the toolbar rule stays out of the panel’s way', () => {
  it('gives the toolbar only the input-free verbs, and names the rest rather than hiding them', () => {
    const subject = descriptor(ZIP_OPERATIONS)
    expect(nonMutatingDescriptor(subject).operations.map(operation => operation.id)).toEqual([
      'view.inspect',
      'asset.validate',
      'export.raw',
    ])
    // the standard archive extraction operation is non-mutating but takes `{ entryId }`
    expect(declinedNonMutatingOperations(subject).map(operation => operation.id)).toEqual([
      'container.extract',
    ])
    // and no mutating operation is ever counted as declined-by-the-toolbar: they are the panel's
    expect(declinedNonMutatingOperations(subject).some(operation => operation.mutatesSource)).toBe(
      false,
    )
  })

  it('leaves the mutating operations in the descriptor the panel is given', () => {
    const subject = descriptor(ZIP_OPERATIONS)
    // the filter is applied to the toolbar's copy only; the source descriptor is untouched
    nonMutatingDescriptor(subject)
    expect(editOffer(subject, EDITABLE).forms.length).toBe(4)
  })
})

describe('form input shapes', () => {
  const zip = descriptor(ZIP_OPERATIONS)

  it('builds a ZIP add as one stored entry with base64 UTF-8 bytes', () => {
    expect(built(zip, 'zip-add-entry', { path: 'added/hello.txt', content: 'hi ☃\n' })).toEqual({
      add: [{ path: 'added/hello.txt', bytes: base64OfUtf8('hi ☃\n') }],
    })
  })

  it('builds a ZIP remove as a list of one path', () => {
    expect(built(zip, 'zip-remove-entry', { path: 'readme.txt' })).toEqual({
      remove: ['readme.txt'],
    })
  })

  it('builds a ZIP rename as one from/to pair', () => {
    expect(built(zip, 'zip-rename-entry', { from: 'readme.txt', to: 'docs/readme.txt' })).toEqual({
      rename: [{ from: 'readme.txt', to: 'docs/readme.txt' }],
    })
  })

  it('builds a ZIP replace as a path and its bytes', () => {
    expect(built(zip, 'zip-replace-entry', { path: 'readme.txt', content: 'new\n' })).toEqual({
      path: 'readme.txt',
      bytes: base64OfUtf8('new\n'),
    })
  })

  it('builds a PNG text field as keyword/text, and allows an empty text', () => {
    const png = descriptor(PNG_OPERATIONS)
    expect(built(png, 'png-set-text', { keyword: 'Author', text: 'Ada' })).toEqual({
      keyword: 'Author',
      text: 'Ada',
    })
    expect(built(png, 'png-set-text', { keyword: 'Author' })).toEqual({
      keyword: 'Author',
      text: '',
    })
  })

  it('builds an MP3 text frame as keyword/text', () => {
    expect(
      built(descriptor(MP3_OPERATIONS), 'mp3-set-text-frame', { keyword: 'TPE1', text: 'Ada' }),
    ).toEqual({ keyword: 'TPE1', text: 'Ada' })
  })

  it('builds the JPEG forms', () => {
    const jpeg = descriptor([
      { id: 'edit.field', handlerId: 'set-comment', mutatesSource: true },
      { id: 'edit.structure', handlerId: 'remove-segment', mutatesSource: true },
    ])
    expect(built(jpeg, 'jpeg-set-comment', { text: 'shot on film' })).toEqual({
      text: 'shot on film',
    })
    expect(built(jpeg, 'jpeg-remove-segment', { marker: 'APP1' })).toEqual({ marker: 'APP1' })
  })

  it('refuses an empty required value before the invoke, naming the field', () => {
    expect(() => built(zip, 'zip-remove-entry', { path: '' })).toThrow(/Entry path is required/u)
    expect(() =>
      built(descriptor(MP3_OPERATIONS), 'mp3-set-text-frame', { keyword: '', text: 'x' }),
    ).toThrow(/Frame is required/u)
  })

  it('encodes UTF-8 the way the codecs decode it', () => {
    for (const text of ['', 'a', 'ab', 'abc', 'abcd', 'hi ☃\n', 'ünïcødé']) {
      expect(base64OfUtf8(text)).toBe(Buffer.from(text, 'utf8').toString('base64'))
    }
  })
})

describe('prefill from what the codec publishes', () => {
  it('opens the PNG form on the tEXt chunk the file already carries', () => {
    const png = descriptor(PNG_OPERATIONS, [
      {
        id: 'png-text',
        label: 'Text fields (tEXt)',
        entries: [
          { key: 'Description', value: 'a small icon' },
          { key: 'Author', value: 'Ada' },
        ],
      },
    ])
    expect(initials(png, 'png-set-text')).toEqual({
      keyword: 'Description',
      text: 'a small icon',
    })
    const keyword = formOf(png, 'png-set-text').fields.find(field => field.name === 'keyword')
    expect(keyword?.hint).toBe('this file already carries: Description, Author')
  })

  it('opens the MP3 form on a text frame, never on the tag header entries', () => {
    const mp3 = descriptor(MP3_OPERATIONS, [
      {
        id: 'id3',
        label: 'ID3',
        entries: [
          { key: 'version', value: '2.3' },
          { key: 'bytes', value: 1024 },
          { key: 'TIT2', value: 'Nocturne' },
          { key: 'TPE1', value: 'Ada' },
        ],
      },
    ])
    expect(initials(mp3, 'mp3-set-text-frame')).toEqual({ keyword: 'TIT2', text: 'Nocturne' })
    const frame = formOf(mp3, 'mp3-set-text-frame').fields.find(field => field.name === 'keyword')
    expect(frame?.hint).toBe('this tag already carries: TIT2, TPE1')
  })

  it('keeps the static defaults when the codec published no such group', () => {
    expect(initials(descriptor(PNG_OPERATIONS), 'png-set-text')).toEqual({
      keyword: 'Description',
      text: 'set from the Modkit inspector',
    })
    expect(initials(descriptor(MP3_OPERATIONS), 'mp3-set-text-frame')).toEqual({
      keyword: 'TIT2',
      text: 'set from the Modkit inspector',
    })
    // an ID3 group with only the header entries is the same case: nothing to hand back
    const bare = descriptor(MP3_OPERATIONS, [
      { id: 'id3', label: 'ID3', entries: [{ key: 'version', value: '2.3' }] },
    ])
    expect(initials(bare, 'mp3-set-text-frame').keyword).toBe('TIT2')
  })

  it('reads a metadata group by id and answers nothing for an unresolved subject', () => {
    const png = descriptor(PNG_OPERATIONS, [
      { id: 'png-text', label: 'Text', entries: [{ key: 'Title', value: 'x' }] },
    ])
    expect(metadataEntries(png, 'png-text').map(entry => entry.key)).toEqual(['Title'])
    expect(metadataEntries(png, 'id3')).toEqual([])
    const unresolved = { interpretation: 'none', operations: [] } as unknown as AnyDescriptor
    expect(metadataEntries(unresolved, 'png-text')).toEqual([])
  })
})

describe('refusals in words', () => {
  it('states a host refusal in plain words and keeps its code', () => {
    expect(invokeRefusalMessage({ reason: 'permission-missing' })).toBe(
      'refused: this subject was opened without permission to write the file (permission-missing)',
    )
    expect(
      invokeRefusalMessage({ reason: 'disabled', diagnostics: [{ message: 'ZIP64 archive' }] }),
    ).toBe('refused: the codec disabled this operation for this file (disabled) — ZIP64 archive')
    // an unknown reason is reported verbatim rather than flattened to "failed"
    expect(invokeRefusalMessage({ reason: 'something-new' })).toBe('refused: something-new')
  })

  it('appends what a rewrite says it will not keep, and nothing when it keeps everything', () => {
    const plan = (fidelity: AssetEditPlan['fidelity']): AssetEditPlan =>
      ({ fidelity }) as unknown as AssetEditPlan
    expect(fidelityNote(plan({ roundTrip: 'byte-identical', preservesUnknownData: true }))).toBe('')
    expect(
      fidelityNote(plan({ roundTrip: 'semantic', preservesUnknownData: false, notes: ['a', 'b'] })),
    ).toBe(' (a; b)')
    expect(fidelityNote(plan({ roundTrip: 'semantic', preservesUnknownData: false }))).toBe(
      ' (this rewrite does not keep bytes the format does not account for)',
    )
  })
})
