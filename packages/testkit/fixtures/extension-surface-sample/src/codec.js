import {
  createInspectionCodec,
  createTreeDataSource,
  editPlanFromInput,
  replaceBytes,
} from '@modkit/codec-kit'

const decoder = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()
const header = 'MODKIT SURFACE SAMPLE\n'

function parse(bytes) {
  const text = decoder.decode(bytes)
  if (!text.startsWith(header)) throw new TypeError('surface sample header is missing')
  const name = /^name=(.*)$/mu.exec(text)?.[1]
  if (name === undefined || name.length === 0) throw new TypeError('surface sample name is missing')
  return { text, name }
}

function page(items, request, signal) {
  signal?.throwIfAborted()
  if (!Number.isSafeInteger(request?.limit) || request.limit <= 0)
    throw new RangeError('page limit must be positive')
  const offset = request.cursor === undefined ? 0 : Number(request.cursor)
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length)
    throw new RangeError('invalid cursor')
  const end = Math.min(items.length, offset + request.limit)
  return Promise.resolve({
    items: Object.freeze(items.slice(offset, end)),
    ...(end < items.length ? { nextCursor: String(end) } : {}),
  })
}

function facts(name, context) {
  const source = context.primary.source
  const provenance = Object.freeze([
    { label: source.uri, source, semanticPath: Object.freeze(['name']) },
  ])
  const groups = Object.freeze([{ id: 'identity', label: 'Identity', factCount: 1 }])
  const values = Object.freeze([
    {
      id: 'name',
      label: 'Name',
      value: name,
      provenance,
      knowledgeTarget: {
        kind: 'subject',
        ecosystem: 'org.example.surface-sample',
        subjectKind: 'org.example/surface-sample',
        subjectId: source.id,
      },
    },
  ])
  return Object.freeze({
    async summary(signal) {
      signal?.throwIfAborted()
      return Object.freeze({
        snapshotId: String(context.primary.revision),
        identity: Object.freeze({
          subjectId: source.id,
          label: name,
          kind: 'org.example/surface-sample',
          type: 'Surface sample',
          origins: provenance,
        }),
        groupCount: 1,
        relationCount: 0,
      })
    },
    groups: (request, signal) => page(groups, request, signal),
    facts: (groupId, request, signal) => {
      if (groupId !== 'identity') throw new RangeError(`unknown group ${groupId}`)
      return page(values, request, signal)
    },
    relations: (request, signal) => page(Object.freeze([]), request, signal),
  })
}

const operations = Object.freeze([
  {
    id: 'script.symbols',
    handlerId: 'script-symbols',
    mutatesSource: false,
    requiredPermissions: ['read-source'],
    outputKinds: ['json'],
  },
  {
    id: 'edit.field',
    handlerId: 'set-name',
    mutatesSource: true,
    requiredPermissions: ['read-source', 'write-source'],
    outputKinds: ['edit-plan'],
  },
])

const definition = Object.freeze({
  id: 'org.example/surface-sample-codec',
  format: Object.freeze({
    id: 'surface-sample',
    label: 'Surface sample',
    mediaType: 'application/x-modkit-surface-sample',
  }),
  operations,
  async detect(bytes) {
    return {
      confidence: decoder.decode(bytes).startsWith(header) ? 1 : 0.01,
      note: 'fixture-header',
    }
  },
  async inspect(bytes, context) {
    const parsed = parse(bytes)
    const nextBytes = name => encoder.encode(`${header}name=${name}\n`)
    return {
      summary: { format: 'surface-sample', name: parsed.name },
      metadata: [
        {
          id: 'identity',
          label: 'Identity',
          entries: [
            {
              key: 'name',
              value: parsed.name,
              type: { kind: 'text' },
              knowledgeTarget: {
                kind: 'subject',
                ecosystem: 'org.example.surface-sample',
                subjectKind: 'org.example/surface-sample',
                subjectId: context.primary.source.id,
              },
            },
          ],
        },
      ],
      traits: [
        { id: 'structure.hierarchy', parameters: { nodes: 2, lazy: true } },
        { id: 'content.text', parameters: { encoding: 'utf-8' } },
      ],
      text: parsed.text,
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'document',
          label: 'Surface sample',
          children: [{ kind: 'field', label: 'name', preview: parsed.name }],
        }),
        'common.view/subject-facts-source': facts(parsed.name, context),
      },
      handlers: {
        'script-symbols': async () => ({
          kind: 'json',
          value: [{ name: parsed.name, kind: 'subject', path: ['name'] }],
        }),
        'set-name': async value => {
          if (value === null || typeof value !== 'object' || Array.isArray(value))
            throw new TypeError('set-name expects an object')
          const name = value.name
          if (typeof name !== 'string' || name.length === 0) throw new TypeError('name is required')
          const output = nextBytes(name)
          return {
            kind: 'edit-plan',
            plan: editPlanFromInput(context.input, {
              planId: `surface-sample-set-name:${name}`,
              edits: [replaceBytes(0, bytes.byteLength, output, 'set sample name')],
              fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
            }),
          }
        },
      },
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
