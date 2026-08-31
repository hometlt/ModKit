import {
  assembleSubjectDescriptor,
  createAssetSession,
  createUtf8TextDataSource,
} from '@modkit/host'
import { revisionId } from '@modkit/sdk'
import { probePlainText } from './shared/probe.js'
import { textParameters } from './shared/decode.js'

const OPERATION_DECLARATIONS = Object.freeze([
  {
    id: 'view.inspect',
    handlerId: 'inspect',
    mutatesSource: false,
    requiredPermissions: ['read-source'],
    outputKinds: ['json'],
  },
  {
    id: 'asset.validate',
    handlerId: 'validate',
    mutatesSource: false,
    requiredPermissions: ['read-source'],
    outputKinds: ['none'],
  },
  {
    id: 'asset.search',
    handlerId: 'search',
    mutatesSource: false,
    requiredPermissions: ['read-source'],
    outputKinds: ['json'],
  },
  {
    id: 'export.raw',
    handlerId: 'export-raw',
    mutatesSource: false,
    requiredPermissions: ['read-source'],
    outputKinds: ['bytes'],
  },
])

function lease(value) {
  let released = false
  return Object.freeze({
    value,
    async release() {
      released = true
    },
    released: () => released,
  })
}

export async function openPlainText(input, _intent, budget, signal) {
  if (input.originKind !== 'single') throw new TypeError('plain-text requires a single input')
  const binding = input.bindings[0]
  const sourceLease = await input.openBinding(binding.bindingId, signal)
  const source = sourceLease.value
  if (source.kind !== 'bytes' || source.size === undefined) {
    await sourceLease.release()
    throw new TypeError('plain-text requires a sized byte source')
  }
  if (source.size > budget.maxInputBytes) {
    await sourceLease.release()
    throw new RangeError('plain-text input exceeds the session budget')
  }
  const bytes = Object.freeze({
    size: async () => source.size,
    read: (offset, length, readSignal) => source.read(offset, length, readSignal),
  })
  const text = createUtf8TextDataSource(bytes)
  const info = await text.info()
  const descriptor = await assembleSubjectDescriptor({
    schemaVersion: 2,
    subjectUri: binding.source.uri,
    origin: {
      kind: 'single',
      binding: {
        id: binding.bindingId,
        role: binding.role,
        source: binding.source,
        required: true,
        ownership: binding.ownership,
        revision: binding.revision,
        mediaType: 'text/plain',
      },
    },
    interpretation: 'codec',
    identity: {
      codecId: 'modkit/plain-text',
      codecVersion: '1.0.0',
      formatId: 'plain-text',
      formatLabel: 'Plain text',
      mediaType: 'text/plain',
      confidence: 1,
      detection: [{ kind: 'structure', weight: 0.9, note: 'strict UTF-8 text' }],
    },
    traits: [
      {
        id: 'content.text',
        descriptorVersion: 1,
        state: 'available',
        parameters: textParameters(info),
      },
      {
        id: 'content.binary',
        descriptorVersion: 1,
        state: 'available',
        parameters: { bytes: source.size.toString(10) },
      },
      {
        id: 'content.metadata',
        descriptorVersion: 1,
        state: 'available',
        parameters: { groups: 1, completeness: 'complete' },
      },
    ],
    operations: OPERATION_DECLARATIONS.map(operation => ({
      id: operation.id,
      handlerId: operation.handlerId,
      mutatesSource: operation.mutatesSource,
      state: 'available',
    })),
    constraints: {
      readOnly: true,
      seekable: true,
      randomAccess: true,
      trusted: false,
      maxDecodedBytes: source.size.toString(10),
    },
    dataSources: [
      { contract: 'common.view/text-data-source', major: 1 },
      { contract: 'common.view/byte-range-source', major: 1 },
    ],
    diagnostics: [],
    revision: input.revisions.revision,
    metadata: [
      {
        id: 'text',
        label: 'Text',
        entries: [
          { key: 'encoding', value: info.encoding },
          { key: 'lines', value: info.lines },
          { key: 'newline', value: info.newline },
        ],
      },
    ],
  })
  const handlers = new Map([
    [
      'inspect',
      async () => ({
        kind: 'json',
        value: { ...info, bytes: info.bytes.toString(10) },
      }),
    ],
    ['validate', async () => ({ kind: 'none' })],
    [
      'search',
      async inputValue => {
        const pattern =
          typeof inputValue === 'object' &&
          inputValue !== null &&
          !Array.isArray(inputValue) &&
          typeof inputValue.pattern === 'string'
            ? inputValue.pattern
            : ''
        const matches = []
        for await (const match of text.search({ pattern }, signal)) {
          matches.push(match)
          if (matches.length >= budget.maxDiagnostics) break
        }
        return { kind: 'json', value: matches }
      },
    ],
    [
      'export-raw',
      async () => ({
        kind: 'bytes',
        value: await source.read(0n, Number(source.size), signal),
      }),
    ],
  ])
  const managed = createAssetSession({
    revision: revisionId(input.revisions.revision),
    descriptor,
    operationDeclarations: OPERATION_DECLARATIONS,
    permissionGrant: { id: 'plain-text-session', classes: ['read-source'] },
    handlers,
    async openDataSource(contract) {
      if (contract === 'common.view/text-data-source') return lease(text)
      if (contract === 'common.view/byte-range-source') return lease(bytes)
      throw new TypeError(`plain-text does not publish ${contract}`)
    },
    release: [() => sourceLease.release()],
  })
  return managed.session
}

export const plainTextCodec = Object.freeze({
  probe: probePlainText,
  async planInput(source) {
    if (source.kind === 'derived') throw new TypeError('plain-text requires a byte candidate')
    return {
      originKind: 'single',
      candidate: { bindingId: 'content', role: 'content', ownership: 'owned' },
      requirements: [],
    }
  },
  open: openPlainText,
})
