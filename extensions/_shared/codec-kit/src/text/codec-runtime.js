import {
  assembleSubjectDescriptor,
  createAssetSession,
  createUtf8TextDataSource,
} from '@modkitx-x3/host'
import { revisionId } from '@modkitx-x3/sdk'

const BASE_OPERATIONS = Object.freeze([
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
  {
    id: 'data.parse',
    handlerId: 'parse',
    mutatesSource: false,
    requiredPermissions: ['read-source'],
    outputKinds: ['json'],
  },
  {
    id: 'data.serialize',
    handlerId: 'serialize',
    mutatesSource: false,
    requiredPermissions: ['read-source'],
    outputKinds: ['bytes'],
  },
])

const DELIMITED_SCAN_OPERATION = Object.freeze({
  id: 'data.scan',
  handlerId: 'scan',
  mutatesSource: false,
  requiredPermissions: ['read-source'],
  outputKinds: ['json'],
})

function operationsFor(definition) {
  return definition.semantic === 'table'
    ? Object.freeze([...BASE_OPERATIONS, DELIMITED_SCAN_OPERATION])
    : BASE_OPERATIONS
}

function simpleLease(value) {
  let released = false
  return Object.freeze({
    value,
    async release() {
      released = true
    },
    isReleased: () => released,
  })
}

export function createTextCodec(definition, context) {
  const operations = operationsFor(definition)
  return Object.freeze({
    async probe(request, signal) {
      if (request.source.kind !== 'bytes' || request.plan.kind !== 'bytes') {
        throw new TypeError('text codecs require byte probes')
      }
      const length = Math.min(
        request.plan.maxBytes,
        request.plan.ranges[0]?.length ?? request.plan.maxBytes,
      )
      const bytes = await request.source.read(0n, length, signal)
      let text = ''
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        return {
          codecId: `org.modkitx/text-${definition.format}`,
          confidence: 0.01,
          evidence: [{ kind: 'structure', weight: -1, note: 'invalid-utf8' }],
          requiredRanges: [{ byteOffset: '0', byteLength: String(bytes.byteLength) }],
        }
      }
      const result = definition.detect(text, request.source.ref.uri)
      return {
        codecId: `org.modkitx/text-${definition.format}`,
        confidence: result.confidence,
        evidence: [{ kind: 'structure', weight: result.confidence, note: result.note }],
        requiredRanges: [{ byteOffset: '0', byteLength: String(bytes.byteLength) }],
      }
    },
    async planInput() {
      return {
        originKind: 'single',
        candidate: { bindingId: 'content', role: 'content', ownership: 'owned' },
        requirements: [],
      }
    },
    async open(input, _intent, budget, signal) {
      if (input.originKind !== 'single') throw new TypeError('text codec requires a single source')
      const binding = input.bindings[0]
      const sourceLease = await input.openBinding(binding.bindingId, signal)
      const source = sourceLease.value
      if (
        source.kind !== 'bytes' ||
        source.size === undefined ||
        source.size > budget.maxInputBytes
      ) {
        await sourceLease.release()
        throw new RangeError('text codec requires a sized source inside budget')
      }
      const bytes = await source.read(0n, Number(source.size), signal)
      const providerLease = await context.contracts.resolve({
        contract: definition.contract,
        major: 1,
        signal,
      })
      const provider = providerLease.value
      const parsed = await provider.parse({
        input: { bytes },
        dialect: definition.dialect,
        budget,
        signal,
      })
      if (parsed.state === 'failed') {
        await providerLease.release()
        await sourceLease.release()
        throw new TypeError(parsed.diagnostics[0]?.message ?? 'parse failed')
      }
      const dataLease = await provider.dataSource({
        input: { bytes },
        dialect: definition.dialect,
        budget,
        signal,
      })
      const byteSource = {
        size: async () => source.size,
        read: (offset, length, readSignal) => source.read(offset, length, readSignal),
      }
      const textSource = createUtf8TextDataSource(byteSource)
      const textInfo = await textSource.info()
      const semanticContract =
        definition.semantic === 'tree'
          ? 'common.view/tree-data-source'
          : 'common.view/table-data-source'
      const semanticTrait = definition.semantic === 'tree' ? 'structure.hierarchy' : 'table.cells'
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
          },
        },
        interpretation: 'codec',
        identity: {
          codecId: `org.modkitx/text-${definition.format}`,
          codecVersion: '1.0.0',
          formatId: definition.format,
          formatLabel: definition.format.toUpperCase(),
          confidence: 1,
          detection: [{ kind: 'structure', weight: 1 }],
        },
        traits: [
          {
            id: semanticTrait,
            descriptorVersion: 1,
            state: 'available',
            parameters:
              definition.semantic === 'tree'
                ? { nodeCount: 'unknown', lazy: true, hasLocations: true }
                : { rows: 'unknown', columns: 'unknown', sparse: false },
          },
          {
            id: 'content.text',
            descriptorVersion: 1,
            state: 'available',
            parameters: {
              encoding: textInfo.encoding,
              lineCount: textInfo.lines,
              bom: textInfo.bom,
              newline: textInfo.newline,
            },
          },
          {
            id: 'content.binary',
            descriptorVersion: 1,
            state: 'available',
            parameters: { bytes: source.size.toString(10) },
          },
        ],
        operations: operations.map(operation => ({
          id: operation.id,
          handlerId: operation.handlerId,
          mutatesSource: false,
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
          { contract: semanticContract, major: 1 },
          { contract: 'common.view/text-data-source', major: 1 },
          { contract: 'common.view/byte-range-source', major: 1 },
        ],
        diagnostics: [],
        metadata: [],
        revision: input.revisions.revision,
      })
      const handlers = new Map([
        [
          'inspect',
          async () => ({
            kind: 'json',
            value: { format: definition.format, parseState: parsed.state },
          }),
        ],
        ['validate', async () => ({ kind: 'none' })],
        ['search', async () => ({ kind: 'json', value: [] })],
        ['export-raw', async () => ({ kind: 'bytes', value: bytes })],
        ['parse', async () => ({ kind: 'json', value: { state: parsed.state } })],
        [
          'serialize',
          async () => ({
            kind: 'bytes',
            value: (
              await provider.serialize({
                document: parsed.document,
                dialect: definition.dialect,
                budget,
                signal,
              })
            ).bytes,
          }),
        ],
      ])
      if (definition.semantic === 'table') {
        handlers.set('scan', async operationInput => {
          const request =
            operationInput && typeof operationInput === 'object' && operationInput.kind === 'cursor'
              ? { kind: 'cursor', cursor: String(operationInput.cursor ?? '0'), count: 100 }
              : {
                  kind: 'range',
                  from:
                    operationInput &&
                    typeof operationInput === 'object' &&
                    Number.isSafeInteger(operationInput.from)
                      ? Math.max(0, operationInput.from)
                      : 0,
                  count:
                    operationInput &&
                    typeof operationInput === 'object' &&
                    Number.isSafeInteger(operationInput.count)
                      ? Math.min(1000, Math.max(1, operationInput.count))
                      : 100,
                }
          return { kind: 'json', value: await dataLease.value.rows(request) }
        })
      }
      const managed = createAssetSession({
        revision: revisionId(input.revisions.revision),
        descriptor,
        operationDeclarations: operations,
        permissionGrant: {
          id: `text-${definition.format}-session`,
          classes: ['read-source'],
        },
        handlers,
        async openDataSource(contract) {
          if (contract === semanticContract) return simpleLease(dataLease.value)
          if (contract === 'common.view/text-data-source') return simpleLease(textSource)
          if (contract === 'common.view/byte-range-source') return simpleLease(byteSource)
          throw new TypeError(`text-${definition.format} does not publish ${contract}`)
        },
        release: [
          () => dataLease.release(),
          () => providerLease.release(),
          () => sourceLease.release(),
        ],
      })
      return managed.session
    },
  })
}
