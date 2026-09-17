import type { ResolvedCandidateInputBinding } from '@modkit/sdk'
import type { TextSyntaxProvider } from '@modkit/sdk/text-data'
import type { SourceSpan } from '@modkit/core'
import type {
  Codec,
  ContributionContext,
  OperationDecl,
  ByteRangeSource,
  TableDataSource,
  TablePageRequest,
  JsonValue,
  KnownDataSourceId,
  DataSourceMajor,
  DataSourceOf,
} from '@modkit/sdk'
import type { HostOperationHandler } from '@modkit/host/codec'
import type { TextDataContractId } from '@modkit/sdk/text-data'
export interface TextCodecDefinition {
  readonly format: string
  readonly semantic: 'tree' | 'table'
  readonly contract: TextDataContractId
  readonly dialect: string
  detect(text: string, uri: string): { confidence: number; note: string }
}
import {
  assembleSubjectDescriptor,
  createAssetSession,
  createUtf8TextDataSource,
} from '@modkit/host/codec'
import { revisionId } from '@modkit/sdk/codec'

const BASE_OPERATIONS = Object.freeze([
  {
    id: 'view.inspect' as OperationDecl['id'],
    handlerId: 'inspect',
    mutatesSource: false,
    requiredPermissions: ['read-source'] as const,
    outputKinds: ['json'] as const,
  },
  {
    id: 'asset.validate' as OperationDecl['id'],
    handlerId: 'validate',
    mutatesSource: false,
    requiredPermissions: ['read-source'] as const,
    outputKinds: ['none'] as const,
  },
  {
    id: 'asset.search' as OperationDecl['id'],
    handlerId: 'search',
    mutatesSource: false,
    requiredPermissions: ['read-source'] as const,
    outputKinds: ['json'] as const,
  },
  {
    id: 'export.raw' as OperationDecl['id'],
    handlerId: 'export-raw',
    mutatesSource: false,
    requiredPermissions: ['read-source'] as const,
    outputKinds: ['bytes'] as const,
  },
  {
    id: 'data.parse' as OperationDecl['id'],
    handlerId: 'parse',
    mutatesSource: false,
    requiredPermissions: ['read-source'] as const,
    outputKinds: ['json'] as const,
  },
  {
    id: 'data.serialize' as OperationDecl['id'],
    handlerId: 'serialize',
    mutatesSource: false,
    requiredPermissions: ['read-source'] as const,
    outputKinds: ['bytes'] as const,
  },
])

const DELIMITED_SCAN_OPERATION = Object.freeze({
  id: 'data.scan' as OperationDecl['id'],
  handlerId: 'scan',
  mutatesSource: false,
  requiredPermissions: ['read-source'] as const,
  outputKinds: ['json'] as const,
})

function operationsFor(definition: TextCodecDefinition) {
  return definition.semantic === 'table'
    ? Object.freeze([...BASE_OPERATIONS, DELIMITED_SCAN_OPERATION])
    : BASE_OPERATIONS
}

function simpleLease<T>(value: T) {
  let released = false
  return Object.freeze({
    value,
    async release() {
      released = true
    },
    isReleased: () => released,
  })
}

export function createTextCodec(
  definition: TextCodecDefinition,
  context: ContributionContext,
): Codec {
  const operations = operationsFor(definition)
  return Object.freeze<Codec>({
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
          codecId: `modkit/text-${definition.format}`,
          confidence: 0.01,
          evidence: [{ kind: 'structure', weight: -1, note: 'invalid-utf8' }],
          requiredRanges: [{ byteOffset: '0', byteLength: String(bytes.byteLength) } as SourceSpan],
        }
      }
      const result = definition.detect(text, request.source.ref.uri)
      return {
        codecId: `modkit/text-${definition.format}`,
        confidence: result.confidence,
        evidence: [{ kind: 'structure', weight: result.confidence, note: result.note }],
        requiredRanges: [{ byteOffset: '0', byteLength: String(bytes.byteLength) } as SourceSpan],
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
      const binding = input.bindings[0] as ResolvedCandidateInputBinding
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
        signal: signal as AbortSignal,
      })
      const provider = providerLease.value as TextSyntaxProvider<TextDataContractId>
      const parsed = await provider.parse({
        input: { bytes },
        dialect: definition.dialect,
        budget,
        signal: signal as AbortSignal,
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
        signal: signal as AbortSignal,
      })
      const byteSource: ByteRangeSource = {
        size: async () => source.size as bigint,
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
          codecId: `modkit/text-${definition.format}`,
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
            id: 'content.text' as OperationDecl['id'],
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
            id: 'content.binary' as OperationDecl['id'],
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
      const handlers = new Map<string, HostOperationHandler>([
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
                signal: signal as AbortSignal,
              })
            ).bytes,
          }),
        ],
      ])
      if (definition.semantic === 'table') {
        handlers.set('scan', async operationInput => {
          const request: TablePageRequest =
            operationInput &&
            typeof operationInput === 'object' &&
            (operationInput as { kind?: unknown }).kind === 'cursor'
              ? {
                  kind: 'cursor',
                  cursor: String((operationInput as { cursor?: unknown }).cursor ?? '0'),
                  count: 100,
                }
              : {
                  kind: 'range',
                  from:
                    operationInput &&
                    typeof operationInput === 'object' &&
                    Number.isSafeInteger((operationInput as { from?: number }).from as number)
                      ? Math.max(0, (operationInput as { from?: number }).from as number)
                      : 0,
                  count:
                    operationInput &&
                    typeof operationInput === 'object' &&
                    Number.isSafeInteger((operationInput as { count?: number }).count as number)
                      ? Math.min(
                          1000,
                          Math.max(1, (operationInput as { count?: number }).count as number),
                        )
                      : 100,
                }
          return {
            kind: 'json',
            value: (await (dataLease.value as TableDataSource).rows(
              request,
            )) as unknown as JsonValue,
          }
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
        async openDataSource<
          Contract extends KnownDataSourceId,
          Major extends DataSourceMajor<Contract>,
        >(contract: Contract) {
          if (contract === semanticContract)
            return simpleLease(dataLease.value as DataSourceOf<Contract, Major>)
          if (contract === 'common.view/text-data-source')
            return simpleLease(textSource as DataSourceOf<Contract, Major>)
          if (contract === 'common.view/byte-range-source')
            return simpleLease(byteSource as DataSourceOf<Contract, Major>)
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
