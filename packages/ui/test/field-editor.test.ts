import type { AnyDescriptor, FieldEditFormField, FieldType, JsonValue } from '@modkit/sdk'
import { describe, expect, it } from 'vitest'
import {
  createFieldEditorRegistry,
  editOffer,
  fieldValue,
  mountFieldEditor,
  type FieldEditorModuleV1,
} from '../src/field-editor/index.js'

function descriptor(document: JsonValue | undefined, metadata = true): AnyDescriptor {
  return {
    operations: [
      {
        id: 'edit.field',
        handlerId: 'write-field',
        mutatesSource: true,
        state: 'available',
        ...(document === undefined
          ? {}
          : { inputSchema: { $ref: 'modkit://test/edit-field.v1', document } }),
      },
    ],
    metadata: metadata
      ? [
          {
            id: 'properties',
            label: 'Properties',
            entries: [
              {
                key: 'title',
                value: 'old',
                type: { kind: 'text' },
                editable: { write: { operation: 'edit.field' } },
              },
            ],
          },
        ]
      : [],
  } as unknown as AnyDescriptor
}

const schema = {
  schemaVersion: 1,
  forms: [
    {
      id: 'set-title',
      label: 'Set title',
      summary: 'Sets a title.',
      binding: { groupId: 'properties', entryKey: 'title' },
      fields: [
        {
          key: 'value',
          label: 'Title',
          type: { kind: 'text', maxLength: 8 },
          inputPath: ['value'],
          source: 'entry-value',
          required: true,
        },
      ],
    },
  ],
} as const

describe('generic field editor', () => {
  it('resolves from the operation schema plus editable binding and builds a FieldWriteRequest', () => {
    const offer = editOffer(descriptor(schema), { editable: true })
    expect(offer.unsupported).toEqual([])
    expect(offer.forms[0]?.fields[0]?.initial).toBe('old')
    expect(offer.forms[0]?.build(new Map([['value', 'next']]))).toEqual({
      groupId: 'properties',
      key: 'title',
      value: 'next',
    })
    expect(() => offer.forms[0]?.build(new Map([['value', 'too-long-title']]))).toThrow(
      /at most 8/u,
    )
  })

  it('tells a field that names an entry which keys the subject already carries', () => {
    const keyed = {
      schemaVersion: 1,
      forms: [
        {
          id: 'set-property',
          label: 'Set a property',
          summary: 'Sets one property.',
          binding: { groupId: 'properties' },
          fields: [
            {
              key: 'key',
              label: 'Name',
              type: { kind: 'text' },
              inputPath: ['key'],
              source: 'entry-key',
            },
            { key: 'value', label: 'Value', type: { kind: 'text' }, inputPath: ['value'] },
          ],
        },
      ],
    }
    const fields = editOffer(descriptor(keyed), { editable: true }).forms[0]?.fields ?? []
    expect(fields.map(field => field.carried)).toEqual([['title'], undefined])
  })

  it('fails closed for missing, malformed, duplicate and unbound schemas', () => {
    expect(editOffer(descriptor(undefined), { editable: true }).forms).toEqual([])
    expect(editOffer(descriptor(schema, false), { editable: true }).unsupported[0]?.reason).toMatch(
      /editable field binding/u,
    )
    expect(
      editOffer(descriptor({ ...schema, forms: [...schema.forms, schema.forms[0]] } as never), {
        editable: true,
      }).unsupported[0]?.reason,
    ).toMatch(/malformed/u)
    expect(
      editOffer(descriptor({ ...schema, schemaVersion: 2 } as never), { editable: true })
        .unsupported[0]?.reason,
    ).toMatch(/malformed/u)
  })

  it.each(['__proto__', 'prototype', 'constructor'])(
    'rejects dangerous input path segment %s',
    segment => {
      const unsafe = {
        ...schema,
        forms: [
          {
            ...schema.forms[0],
            fields: [{ ...schema.forms[0].fields[0], inputPath: [segment] }],
          },
        ],
      }
      expect(
        editOffer(descriptor(unsafe as never), { editable: true }).unsupported[0]?.reason,
      ).toMatch(/malformed/u)
    },
  )

  it.each([
    [['value'], ['value', 'nested']],
    [['value', 'nested'], ['value']],
  ])('rejects ancestor/descendant input path collision %#', (first, second) => {
    const base = schema.forms[0].fields[0]
    const unsafe = {
      ...schema,
      forms: [
        {
          ...schema.forms[0],
          fields: [
            { ...base, inputPath: first },
            { ...base, key: 'other', inputPath: second },
          ],
        },
      ],
    }
    expect(
      editOffer(descriptor(unsafe as never), { editable: true }).unsupported[0]?.reason,
    ).toMatch(/malformed/u)
  })

  it.each([
    { kind: 'struct', fields: [{ key: 'child', type: { kind: 'text' } }] },
    { kind: 'array', item: { kind: 'text' }, max: -1 },
    { kind: 'subject-ref', subjectKind: 'sample', filter: { requireTags: [1] } },
    { kind: 'asset-ref', accepts: { unexpected: [] } },
    { kind: 'instructions', keywords: { set: [{ kind: 'unknown' }] }, delimiter: ',' },
    { kind: 'custom', typeId: 'sample', params: () => undefined },
    { kind: 'json', schema: { $ref: '' } },
  ])('rejects malformed nested field type %#', type => {
    const unsafe = {
      ...schema,
      forms: [
        {
          ...schema.forms[0],
          fields: [{ ...schema.forms[0].fields[0], type }],
        },
      ],
    }
    expect(
      editOffer(descriptor(unsafe as never), { editable: true }).unsupported[0]?.reason,
    ).toMatch(/malformed/u)
  })

  it('rejects empty binding identifiers', () => {
    const unsafe = {
      ...schema,
      forms: [{ ...schema.forms[0], binding: { groupId: '', entryKey: '' } }],
    }
    expect(
      editOffer(descriptor(unsafe as never), { editable: true }).unsupported[0]?.reason,
    ).toMatch(/malformed/u)
  })

  it('selects custom editors by published type/id/host and poisons duplicates', async () => {
    const target = {} as { rendered?: string }
    const module: FieldEditorModuleV1 = {
      abiVersion: 1,
      mount({ container, initial }) {
        const output = container as typeof target
        output.rendered = String(initial)
        return {
          read: () => output.rendered ?? '',
          validate: () => (output.rendered === '' ? 'required' : undefined),
        }
      },
    }
    const spec = {
      fieldTypeId: 'org.example/title',
      editorId: 'org.example/title-editor',
      priority: 10,
      hosts: ['web'],
    }
    const registry = createFieldEditorRegistry([{ spec, module }], 'web')
    expect(registry.resolve(spec.fieldTypeId, spec.editorId)).toBe(module)
    const field = {
      key: 'title',
      name: 'title',
      label: 'Title',
      kind: 'text',
      type: { kind: 'custom', typeId: spec.fieldTypeId },
      inputPath: ['value'],
      initial: 'old',
      initialText: 'old',
    } as const
    const control = await mountFieldEditor(
      target as unknown as HTMLElement,
      field,
      new AbortController().signal,
      registry,
      spec.editorId,
    )
    expect(target.rendered).toBe('old')
    expect(control.validate()).toBeUndefined()
    expect(
      createFieldEditorRegistry([{ spec, module }], 'desktop').resolve(spec.fieldTypeId),
    ).toBeUndefined()
    const duplicate = createFieldEditorRegistry(
      [
        { spec, module },
        { spec, module },
      ],
      'web',
    )
    expect(duplicate.resolve(spec.fieldTypeId)).toBeUndefined()
    expect(duplicate.problem(spec.fieldTypeId)).toMatch(/duplicate/u)
    const malformed = createFieldEditorRegistry(
      [{ spec: { ...spec, hosts: 'web' } as never, module }],
      'web',
    )
    expect(malformed.resolve(spec.fieldTypeId)).toBeUndefined()
    expect(malformed.problem(spec.fieldTypeId)).toMatch(/malformed/u)
  })

  it.each([
    [{ kind: 'text', pattern: '^ok$' }, 'ok'],
    [{ kind: 'number', integer: true }, '3'],
    [{ kind: 'boolean' }, 'true'],
    [{ kind: 'enum', members: [{ id: 'a' }] }, 'a'],
    [{ kind: 'flags', members: [{ id: 'a' }] }, 'a'],
    [{ kind: 'color', model: 'rgba' }, '#fff'],
    [{ kind: 'vector', size: 2 }, '[1,2]'],
    [{ kind: 'path' }, 'a/b'],
    [{ kind: 'script', language: 'text' }, 'return'],
    [{ kind: 'array', item: { kind: 'text' } }, '["a"]'],
    [{ kind: 'record', key: { kind: 'text' }, value: { kind: 'number' } }, '{"a":1}'],
    [{ kind: 'json' }, '{"a":1}'],
  ] as readonly (readonly [FieldType, JsonValue])[])(
    'validates built-in field type %#',
    (type, value) => {
      const field = {
        key: 'value',
        label: 'Value',
        type,
        inputPath: ['value'],
      } satisfies FieldEditFormField
      expect(() => fieldValue(field, value)).not.toThrow()
    },
  )
})

describe('fixed operation input in common forms', () => {
  it('owns a new fixed input tree on every submission', () => {
    const document = {
      ...schema,
      forms: [{ ...schema.forms[0], baseInput: { schemaVersion: 1, context: { owner: 'scene' } } }],
    }
    const form = editOffer(descriptor(document), { editable: true }).forms[0]
    if (form === undefined) throw new Error('form unavailable')
    const first = form.build(new Map([['value', 'next']]))
    if (first === null || Array.isArray(first) || typeof first !== 'object')
      throw new Error('input absent')
    expect(Reflect.get(first, 'schemaVersion')).toBe(1)
    const context: unknown = Reflect.get(first, 'context')
    if (context === null || Array.isArray(context) || typeof context !== 'object')
      throw new Error('context absent')
    Reflect.set(context, 'owner', 'changed')
    expect(form.build(new Map([['value', 'again']]))).toMatchObject({
      schemaVersion: 1,
      context: { owner: 'scene' },
    })
    expect(document.forms[0]?.baseInput.context.owner).toBe('scene')
  })
  it('refuses an editable path overlapping a fixed key, including a descendant', () => {
    for (const inputPath of [['schemaVersion'], ['context', 'owner']]) {
      const document = {
        ...schema,
        forms: [
          {
            ...schema.forms[0],
            baseInput: { schemaVersion: 1, context: { owner: 'scene' } },
            fields: [{ ...schema.forms[0].fields[0], inputPath }],
          },
        ],
      }
      expect(editOffer(descriptor(document), { editable: true }).forms).toEqual([])
    }
  })
  it('refuses malformed fixed objects and unsafe fixed keys', () => {
    for (const baseInput of [[], null, JSON.parse('{"__proto__":{}}') as JsonValue]) {
      expect(
        editOffer(descriptor({ ...schema, forms: [{ ...schema.forms[0], baseInput }] }), {
          editable: true,
        }).forms,
      ).toEqual([])
    }
  })
})
