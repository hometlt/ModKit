import { readFile } from 'node:fs/promises'
import { delimiter, resolve } from 'node:path'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import type { Inventory } from '@modkit/host'
import type { AnyDescriptor, AssetSession, KnowledgeCatalog, KnowledgeTarget } from '@modkit/sdk'
import { revisionId } from '@modkit/sdk'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ConfigurationError,
  MCP_MAX_OUTPUT_BYTES,
  ModkitMcpRuntime,
  boundedJson,
  createModkitMcpServer,
  encodeKnowledgeResourceTarget,
  parseModkitMcpConfiguration,
  type McpEnvelope,
  type McpLanguageRequest,
  type McpOpenedSubject,
  type ModkitMcpHostPort,
} from '../src/index.js'

const fixture = JSON.parse(
  await readFile(new URL('./fixtures/untrusted-facts.json', import.meta.url), 'utf8'),
) as { readonly summary: string; readonly source: string }

const descriptor = {
  schemaVersion: 2,
  subjectUri: 'fixture://subject',
  origin: { kind: 'single', binding: { source: { kind: 'opaque', id: 'fixture' } } },
  traits: [],
  operations: [
    {
      id: 'fixture/read',
      handlerId: 'read',
      mutatesSource: false,
      state: 'available',
    },
    {
      id: 'fixture/slow',
      handlerId: 'slow',
      mutatesSource: false,
      state: 'available',
    },
    {
      id: 'fixture/oversized',
      handlerId: 'oversized',
      mutatesSource: false,
      state: 'available',
    },
    {
      id: 'fixture/rejected',
      handlerId: 'rejected',
      mutatesSource: false,
      state: 'available',
    },
    {
      id: 'fixture/late-stream',
      handlerId: 'late-stream',
      mutatesSource: false,
      state: 'available',
    },
    {
      id: 'fixture/write',
      handlerId: 'write',
      mutatesSource: true,
      state: 'available',
    },
  ],
  constraints: { readOnly: true, seekable: true, randomAccess: true, trusted: false },
  dataSources: [
    { contract: 'common.view/subject-selector-source', major: 1 },
    { contract: 'common.view/subject-facts-source', major: 1 },
    { contract: 'common.view/relation-graph-source', major: 1 },
    { contract: 'common.view/subject-calculations-source', major: 1 },
  ],
  diagnostics: [],
  revision: 'fixture-revision',
  interpretation: 'codec',
  identity: {
    codecId: 'fixture/codec',
    codecVersion: '1.0.0',
    formatId: 'fixture',
    formatLabel: 'Fixture',
    confidence: 1,
    detection: [],
  },
  metadata: [],
} as unknown as AnyDescriptor

const sourceProvenance = [{ label: 'fixture', semanticPath: ['field'] }]

function fakeSession(
  options: {
    readonly waitForAbort?: boolean
    readonly onOperationInvoke?: (handlerId: string) => void
    readonly onOperationAbort?: (handlerId: string) => void
    readonly lateAbortController?: AbortController
    readonly onStreamRelease?: () => void
    readonly ignoreFactsAbort?: boolean
  } = {},
): AssetSession {
  const facts = {
    summary: async (signal?: AbortSignal) => {
      signal?.throwIfAborted()
      return {
        snapshotId: 'facts-v1',
        identity: {
          subjectId: 'fixture-subject',
          label: 'Fixture subject',
          kind: 'fixture',
          origins: sourceProvenance,
        },
        groupCount: 1,
        relationCount: 1,
        preview: {
          source: { kind: 'opaque' as const, id: 'fixture-preview' },
          mediaType: 'image/png',
          label: 'Fixture preview',
        },
      }
    },
    groups: async (_page: unknown, signal?: AbortSignal) => {
      signal?.throwIfAborted()
      if (options.ignoreFactsAbort) await new Promise<void>(() => undefined)
      if (options.waitForAbort) {
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      }
      signal?.throwIfAborted()
      return { items: [{ id: 'general', label: 'General', factCount: 1 }] }
    },
    facts: async () => ({
      items: [
        {
          id: 'fixture/value',
          label: 'Fixture value',
          value: fixture.summary,
          provenance: sourceProvenance,
          knowledgeTarget: {
            kind: 'concept',
            ecosystem: 'fixture',
            conceptId: 'fixture-value',
          },
        },
      ],
    }),
    relations: async () => ({
      items: [{ role: 'uses', subjectId: 'other', label: 'Other', kind: 'fixture' }],
    }),
  }
  const graphNodes = [
    { id: 'a', label: 'A', type: 'fixture' },
    { id: 'b', label: 'B', type: 'fixture' },
    { id: 'c', label: 'C', type: 'fixture' },
    { id: 'x', label: 'X', type: 'fixture' },
  ]
  const graphEdges = [
    { from: 'a', to: 'b', role: 'uses' },
    { from: 'b', to: 'c', role: 'uses' },
    { from: 'x', to: 'a', role: 'produces' },
  ]
  const graphPage = <Value>(
    values: readonly Value[],
    page: { readonly cursor?: string; readonly limit: number },
  ) => {
    const offset = page.cursor === undefined ? 0 : Number(page.cursor)
    const items = values.slice(offset, offset + page.limit)
    const nextOffset = offset + items.length
    return {
      items,
      ...(nextOffset < values.length ? { nextCursor: String(nextOffset) } : {}),
    }
  }
  const graph = {
    summary: async () => ({
      snapshotId: 'graph-v1',
      totalNodes: graphNodes.length,
      totalEdges: graphEdges.length,
      types: [{ id: 'fixture', label: 'Fixture', count: graphNodes.length, tone: 1 }],
      completeness: 'complete' as const,
    }),
    nodes: async (page: { readonly cursor?: string; readonly limit: number }) =>
      graphPage(graphNodes, page),
    edges: async (page: { readonly cursor?: string; readonly limit: number }) =>
      graphPage(graphEdges, page),
  }
  const calculations = {
    summary: async () => ({
      snapshotId: 'facts-v1',
      subjectId: 'fixture-subject',
      totalCalculations: 1,
      completeness: 'complete' as const,
    }),
    calculations: async () => ({
      items: [
        {
          id: 'fixture/double',
          label: 'Double',
          formula: { id: 'double', name: 'Double', version: '1', expression: 'x * 2' },
          status: 'computed' as const,
          value: 4,
          inputs: [
            {
              id: 'x',
              label: 'X',
              state: 'resolved' as const,
              value: 2,
              provenance: sourceProvenance,
            },
          ],
          provenance: sourceProvenance,
          warnings: [],
        },
      ],
    }),
  }
  const selector = {
    summary: async () => ({
      snapshotId: 'facts-v1',
      totalSubjects: 1,
      completeness: 'complete' as const,
    }),
    subjects: async (query: {
      readonly kind?: string
      readonly type?: string
      readonly text?: string
    }) => {
      const item = {
        subjectId: 'fixture-subject',
        label: 'Fixture subject',
        kind: 'fixture',
        type: 'Fixture',
      }
      const text = query.text?.toLowerCase()
      return {
        items:
          (query.kind === undefined || query.kind === item.kind) &&
          (query.type === undefined || query.type === item.type) &&
          (text === undefined ||
            item.subjectId.includes(text) ||
            item.label.toLowerCase().includes(text))
            ? [item]
            : [],
      }
    },
    openFacts: async (subjectId: string) => {
      if (subjectId !== 'fixture-subject') throw new RangeError('fixture subject not found')
      return { value: facts, release: async () => undefined }
    },
    openCalculations: async (subjectId: string) => {
      if (subjectId !== 'fixture-subject') throw new RangeError('fixture subject not found')
      return { value: calculations, release: async () => undefined }
    },
    editTarget: async (request: { subjectId: string; fieldPath: readonly string[] }) => ({
      state: 'resolved' as const,
      snapshotId: 'facts-v1',
      workspaceId: 'fixture-workspace',
      selectedRootId: 'C',
      subjectId: request.subjectId,
      fieldPath: request.fieldPath,
      action: 'create-local-field',
      destination: {
        rootId: 'C',
        path: 'C.SC2Mod/Base.SC2Data/GameData/UnitData.xml',
        mode: 'replace' as const,
        label: 'Write: C → C.SC2Mod/Base.SC2Data/GameData/UnitData.xml',
        targetId: 'fixture-target',
        subjectUri: 'file:///C.SC2Mod/Base.SC2Data/GameData/UnitData.xml',
      },
      candidates: [],
      selectionReason: 'last-local-declaration',
      guards: [
        {
          rootId: 'C',
          path: 'C.SC2Mod/Base.SC2Data/GameData/UnitData.xml',
          revision: 'content-hash.sha256:fixture' as const,
        },
      ],
    }),
    isolation: async (request: {
      ownerSubjectId: string
      targetSubjectId: string
      ownerFieldPath: readonly string[]
    }) => ({
      schemaVersion: 1 as const,
      state: 'ready' as const,
      snapshotId: 'facts-v1',
      ownerSubjectId: request.ownerSubjectId,
      targetSubjectId: request.targetSubjectId,
      ownerFieldPath: request.ownerFieldPath,
      shared: true,
      cloneRequired: true,
      referrers: [
        { subjectId: request.ownerSubjectId, fieldPaths: [[...request.ownerFieldPath]] },
        { subjectId: 'fixture/other-owner', fieldPaths: [['WeaponArray', '0', 'Link']] },
      ],
      otherReferrerIds: ['fixture/other-owner'],
      rewireFieldPaths: [[...request.ownerFieldPath]],
    }),
    isolationPlan: async (request: {
      ownerSubjectId: string
      targetSubjectId: string
      cloneSubjectId: string
      ownerFieldPath: readonly string[]
    }) => ({
      schemaVersion: 1 as const,
      state: 'planned' as const,
      snapshotId: 'facts-v1',
      previewSnapshotId: 'facts-preview-v1',
      ownerSubjectId: request.ownerSubjectId,
      targetSubjectId: request.targetSubjectId,
      cloneSubjectId: request.cloneSubjectId,
      analysis: {
        schemaVersion: 1 as const,
        state: 'ready' as const,
        snapshotId: 'facts-v1',
        ownerSubjectId: request.ownerSubjectId,
        targetSubjectId: request.targetSubjectId,
        ownerFieldPath: [...request.ownerFieldPath],
        shared: true,
        cloneRequired: true,
        referrers: [],
        otherReferrerIds: ['fixture/other-owner'],
        rewireFieldPaths: [[...request.ownerFieldPath]],
      },
      replacements: [
        {
          purpose: 'clone-and-rewire' as const,
          destination: {
            rootId: 'C',
            path: 'C.SC2Mod/Base.SC2Data/GameData/UnitData.xml',
            mode: 'replace' as const,
            label: 'Write: C → C.SC2Mod/Base.SC2Data/GameData/UnitData.xml',
            targetId: 'fixture-target',
            subjectUri: 'file:///C.SC2Mod/Base.SC2Data/GameData/UnitData.xml',
          },
          replacementBytes: 512,
        },
      ],
      diagnostics: [],
    }),
  }
  return {
    revision: 'fixture-revision' as never,
    state: () => 'live',
    descriptor: async () => descriptor,
    dataSource: async contract => {
      const value =
        contract === 'common.view/subject-selector-source'
          ? selector
          : contract === 'common.view/subject-facts-source'
            ? facts
            : contract === 'common.view/relation-graph-source'
              ? graph
              : calculations
      return { value, release: async () => undefined } as never
    },
    operations: () => ({
      invoke: async (handlerId, input, invokeOptions) => {
        options.onOperationInvoke?.(handlerId)
        if (handlerId === 'read') {
          invokeOptions?.onProgress?.({ completed: 1, total: 1, message: fixture.summary })
          return {
            state: 'ok',
            output: { kind: 'json', value: { input, summary: fixture.summary } },
            diagnostics: [],
          }
        }
        if (handlerId === 'slow') {
          return new Promise(resolve => {
            const operationSignal = invokeOptions?.signal
            const aborted = (): void => {
              options.onOperationAbort?.(handlerId)
              resolve({ state: 'rejected', reason: 'cancelled', diagnostics: [] })
            }
            operationSignal?.addEventListener('abort', aborted, { once: true })
            if (operationSignal?.aborted === true) aborted()
          })
        }
        if (handlerId === 'oversized') {
          const value: { text: string; self?: unknown } = { text: 'x'.repeat(2_000_000) }
          value.self = value
          return {
            state: 'ok',
            output: { kind: 'json', value },
            diagnostics: [],
          } as never
        }
        if (handlerId === 'rejected') {
          return {
            state: 'rejected',
            reason: 'dependency-required',
            diagnostics: [
              {
                code: 'fixture/dependency-required',
                message: fixture.summary,
                severity: 'warning',
              },
            ],
          }
        }
        if (handlerId === 'late-stream') {
          options.lateAbortController?.abort()
          return {
            state: 'ok',
            output: {
              kind: 'stream',
              stream: {
                value: {
                  chunks: async function* () {
                    yield new Uint8Array([1, 2, 3])
                  },
                },
                release: async () => options.onStreamRelease?.(),
              },
            },
            diagnostics: [],
          }
        }
        if (handlerId === 'write') {
          // What a codec really answers a write with: a plan, not a changed file.
          return {
            state: 'ok',
            output: {
              kind: 'edit-plan',
              plan: {
                planId: 'fixture-plan',
                targets: [
                  {
                    targetId: 'content',
                    subjectUri: 'fixture://subject',
                    ownerSource: { id: 'fixture', uri: 'fixture://subject' },
                    semanticPath: [],
                    expectedRevision: {
                      bindings: { content: revisionId('provider-token:fixture') },
                      compositionFingerprint: 'fixture',
                    },
                  },
                ],
                semantics: { mutationMode: 'mutate', minimumGuarantee: 'atomic' },
                diagnostics: [],
                fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
                edits: [
                  {
                    operation: 'replace',
                    label: 'set the fixture value',
                    targetId: 'content',
                    source: { id: 'fixture', uri: 'fixture://subject' },
                    range: { kind: 'bytes', offset: 4n, length: 2n },
                    payload: { kind: 'inline', bytes: new Uint8Array([65, 66, 67]) },
                  },
                ],
              },
            },
            diagnostics: [],
          }
        }
        return { state: 'rejected', reason: 'not-declared', diagnostics: [] }
      },
      dispose: async () => undefined,
    }),
    events: async function* () {
      yield* []
    },
    dispose: async () => undefined,
  }
}

const inventory = {
  extensions: [
    {
      source: 'fixture-extension',
      origin: 'installed',
      container: 'directory',
      manifest: { schemaVersion: 1, publisher: 'fixture', id: 'extension', version: '1.0.0' },
      contributions: [],
    },
  ],
  diagnostics: [],
} as unknown as Inventory

function fakeKnowledge(): KnowledgeCatalog {
  const target: KnowledgeTarget = {
    kind: 'concept',
    ecosystem: 'fixture',
    conceptId: 'fixture-value',
  }
  const page = {
    snapshotId: 'knowledge-v1',
    total: 1,
    items: [
      {
        entry: {
          id: 'fixture/entry',
          target,
          locale: 'en',
          title: 'Fixture',
          summary: fixture.summary,
          claimKind: 'external-reference' as const,
          confidence: 'low' as const,
          sources: [
            {
              kind: 'external-reference' as const,
              title: 'Fixture source',
              url: fixture.source,
              reviewedAt: '2026-08-28',
            },
          ],
        },
        provenance: {
          packId: 'fixture/pack',
          ownerExtensionId: 'fixture/extension',
          extensionVersion: '1.0.0',
          manifestPath: 'knowledge.json',
          manifestDigest: 'sha256:fixture',
          artifactDigest: 'sha256:fixture',
        },
        localeRank: 0,
      },
    ],
    completeness: 'complete' as const,
    diagnostics: [],
  }
  return {
    snapshotId: page.snapshotId,
    search: async (_query, signal) => {
      signal?.throwIfAborted()
      return page
    },
    resolve: async (_query, signal) => {
      signal?.throwIfAborted()
      return page
    },
  }
}

function fakeHost(
  options: {
    readonly waitForAbort?: boolean
    readonly lateAbortController?: AbortController
    readonly withSelection?: boolean
    readonly withDiscovery?: boolean
    readonly withLanguage?: boolean
    readonly withLanguageSession?: boolean
    readonly withEditing?: boolean
    readonly editsEnabled?: boolean
    readonly ignoreFactsAbort?: boolean
  } = {},
) {
  let closes = 0
  const operationInvocations: string[] = []
  const operationAborts: string[] = []
  let streamReleases = 0
  const selectionInvocations: string[] = []
  const languageInvocations: unknown[] = []
  const languageSessionInvocations: unknown[] = []
  let languageSessionCloses = 0
  const editInvocations: string[] = []
  const host: ModkitMcpHostPort = {
    inventory,
    knowledge: fakeKnowledge(),
    roots: ['C:\\allowed'],
    extensionCoordinates: ['fixture/extension'],
    executionProfiles: ['worker-brokered'],
    supportedExtensions: ['fixture'],
    ...(options.editsEnabled ? { editsEnabled: true } : {}),
    ...(options.withLanguage
      ? {
          async language(request: McpLanguageRequest, signal?: AbortSignal) {
            signal?.throwIfAborted()
            languageInvocations.push(request)
            return {
              snapshotId: 'language-v1',
              diagnostics: [],
              primaryUri: 'file:///C:/allowed/fixture.galaxy',
              feature: request.feature,
              result:
                request.feature === 'code-actions'
                  ? { actions: [], isIncomplete: false }
                  : { markdown: 'Fixture hover' },
            }
          },
        }
      : {}),
    ...(options.withLanguageSession
      ? {
          async openLanguageSession(
            request: import('../src/index.js').McpLanguageSessionOpenRequest,
            _signal?: AbortSignal,
            context?: import('../src/index.js').McpLanguageSessionContext,
          ) {
            languageSessionInvocations.push({
              kind: 'open',
              request,
              dependencyBound: context !== undefined,
            })
            const documents = request.documents.map((document, index) => ({
              uri: document.uri ?? `file:///C:/allowed/session-${index}.galaxy`,
              languageId: document.languageId,
              ...(document.documentKind === undefined
                ? {}
                : { documentKind: document.documentKind }),
              version: document.version ?? 1,
              // A session document states what it can answer; the fake answers nothing extra.
              features: [] as const,
            }))
            return {
              documents,
              workspaceIncomplete: true,
              diagnostics: [],
              async update(update: import('../src/index.js').McpLanguageSessionUpdateRequest) {
                languageSessionInvocations.push({ kind: 'update', update })
                return {
                  snapshotId: `session-v${update.version}`,
                  diagnostics: [],
                  primaryUri: update.uri,
                  feature: 'analyze' as const,
                  result: { documentVersion: update.version },
                }
              },
              async invoke(feature: import('../src/index.js').McpLanguageSessionFeatureRequest) {
                languageSessionInvocations.push({ kind: 'feature', feature })
                return {
                  snapshotId: 'session-feature-v1',
                  diagnostics: [],
                  primaryUri: feature.primaryUri,
                  feature: feature.feature,
                  result: { markdown: 'Session hover' },
                }
              },
              async close() {
                languageSessionCloses += 1
              },
            }
          },
        }
      : {}),
    ...(options.withDiscovery
      ? {
          async discoverInstallations() {
            return {
              snapshotId: 'installations-v1',
              complete: true,
              items: [
                {
                  selectionId: 'fixture-installation',
                  gameId: 'fixture-game',
                  displayName: 'Fixture Game',
                  openable: true,
                  version: '1.0',
                },
              ],
              diagnostics: [],
            }
          },
          async openDiscovered(selectionId: string, signal?: AbortSignal) {
            if (selectionId !== 'fixture-installation') {
              throw new RangeError('fixture discovery selection not found')
            }
            return host.open('C:\\allowed\\fixture', signal)
          },
        }
      : {}),
    async open(_path, signal): Promise<McpOpenedSubject> {
      signal?.throwIfAborted()
      const snapshot = {
        state: 'opened',
        sessionId: 'host-session-do-not-expose',
        descriptor: descriptor as unknown as Record<string, unknown>,
        selected: { contributionId: 'fixture/codec', variantId: 'worker', confidence: 1 },
        candidates: [],
        diagnostics: [],
      } as const
      const makeSession = () =>
        fakeSession({
          ...options,
          onOperationInvoke: handlerId => operationInvocations.push(handlerId),
          onOperationAbort: handlerId => operationAborts.push(handlerId),
          onStreamRelease: () => {
            streamReleases += 1
          },
        })
      const close = async () => {
        closes += 1
      }
      const receipt = (status: 'committed' | 'rolled-back') => ({
        transactionId: 'fixture-transaction',
        committedAt: '2026-09-15T00:00:00.000Z',
        mutationMode: 'mutate',
        commitGuarantee: 'atomic',
        status,
        undo: 'snapshot',
        before: [],
        after: [],
        writes: [],
        fidelity: {
          roundTrip: 'byte-identical',
          preservesUnknownData: true,
          evidenceId: 'fixture/evidence',
          corpusId: 'fixture/corpus',
          corpusDigest: 'fixture',
          conformanceProfile: 'common.edit/writer-v1',
          writer: { providerId: 'fixture/writer', formatId: 'fixture', representationId: 'raw' },
          optionsFingerprint: 'fixture',
          inputClass: 'fixture',
          provenAt: '2026-09-15T00:00:00.000Z',
        },
      })
      const editing = options.withEditing
        ? ({
            revision: descriptor.revision,
            targets: [],
            grantSnapshot: { snapshotId: 'fixture-grant', permissions: [], sourceIds: [] },
            coordinator: {
              async prepare(plan: unknown) {
                editInvocations.push('prepare')
                return {
                  state: 'ready',
                  prepared: {
                    preparedId: 'fixture-prepared',
                    plan,
                    planDigest: 'fixture-digest',
                    writeSet: { entries: [], digest: 'fixture-write-set' },
                    authorization: {
                      requiredPermissions: [],
                      granted: true,
                      achievableGuarantee: 'atomic',
                      missing: [],
                      scopeSatisfied: true,
                    },
                    preparedRevisionFingerprint: 'fixture-revision',
                    fidelity: receipt('committed').fidelity,
                  },
                }
              },
              async commit() {
                editInvocations.push('commit')
                return { state: 'committed', receipt: receipt('committed') }
              },
              async undo() {
                editInvocations.push('undo')
                return { state: 'rolled-back', receipt: receipt('rolled-back') }
              },
              async redo() {
                editInvocations.push('redo')
                return { state: 'committed', receipt: receipt('committed') }
              },
              async discardHistory() {
                editInvocations.push('discard-history')
                return true
              },
            },
            planFromOperation(output: { plan: unknown }) {
              return output.plan
            },
            async stagePlan(plan: unknown) {
              editInvocations.push('stage')
              return plan
            },
            async releasePlan() {
              editInvocations.push('release-plan')
            },
            dispose: () => Promise.resolve(),
          } as never)
        : undefined
      return {
        snapshot,
        session: makeSession(),
        ...(editing === undefined ? {} : { editing }),
        close,
        ...(options.withSelection
          ? {
              selectionCandidates: [
                {
                  candidateId: 'fixture-candidate',
                  displayName: 'Fixture candidate',
                  sourcePath: 'fixtures/example',
                },
              ],
              async select(selectionId: string, selectionSignal?: AbortSignal) {
                selectionSignal?.throwIfAborted()
                selectionInvocations.push(selectionId)
                if (selectionId !== 'fixture-candidate') {
                  throw new RangeError('fixture candidate not found')
                }
                return { snapshot, session: makeSession(), close }
              },
            }
          : {}),
      }
    },
    close: async () => undefined,
  }
  return {
    host,
    closes: () => closes,
    operationInvocations: () => operationInvocations,
    operationAborts: () => operationAborts,
    streamReleases: () => streamReleases,
    selectionInvocations: () => selectionInvocations,
    languageInvocations: () => languageInvocations,
    languageSessionInvocations: () => languageSessionInvocations,
    languageSessionCloses: () => languageSessionCloses,
    editInvocations: () => editInvocations,
  }
}

const clients: {
  readonly client: Client
  readonly app: ReturnType<typeof createModkitMcpServer>
}[] = []

afterEach(async () => {
  await Promise.allSettled(
    clients.splice(0).flatMap(({ client, app }) => [client.close(), app.dispose()]),
  )
})

async function connected(host: ModkitMcpHostPort) {
  const app = createModkitMcpServer(host)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'modkit-mcp-test', version: '1.0.0' })
  await Promise.all([app.server.connect(serverTransport), client.connect(clientTransport)])
  clients.push({ client, app })
  return { client, app }
}

const structured = (value: { readonly structuredContent?: unknown }): McpEnvelope =>
  value.structuredContent as McpEnvelope

const handleFrom = (value: McpEnvelope): string =>
  (value.data as { readonly handle: string }).handle

describe('MCP configuration', () => {
  it('requires explicit absolute root and extension allowlists', () => {
    expect(() => parseModkitMcpConfiguration([], {})).toThrow(ConfigurationError)
    expect(() =>
      parseModkitMcpConfiguration(['--root', 'relative', '--extension', 'C:\\extensions'], {}),
    ).toThrow(/absolute/u)
  })

  it('accepts repeatable CLI paths and independent environment fallbacks', () => {
    const config = parseModkitMcpConfiguration(['--root', 'C:\\one', '--root', 'C:\\two'], {
      MODKIT_MCP_EXTENSIONS: ['C:\\ext-a', 'C:\\ext-b'].join(delimiter),
    })
    expect(config.roots).toEqual([resolve('C:\\one'), resolve('C:\\two')])
    expect(config.extensions).toEqual([resolve('C:\\ext-a'), resolve('C:\\ext-b')])
    expect(config.baseMods).toBeUndefined()
    expect(
      parseModkitMcpConfiguration(['--root', 'C:\\one', '--base-mod', 'Mods/Liberty.SC2Mod'], {
        MODKIT_MCP_EXTENSIONS: 'C:\\ext-a',
      }).baseMods,
    ).toEqual(['Mods/Liberty.SC2Mod'])
  })

  it('requires explicit permission and effect policy for effectful service operations', () => {
    const config = parseModkitMcpConfiguration(
      [
        '--root',
        'C:\\one',
        '--extension',
        'C:\\ext',
        '--operation-permission',
        'network',
        '--allow-effectful-service-operations',
        '--allow-edits',
        '--trust-extensions',
      ],
      {},
    )
    expect(config.operationPermissions).toEqual(['network'])
    expect(config.allowEffectfulServiceOperations).toBe(true)
    expect(config.allowEdits).toBe(true)
    expect(config.trustExtensions).toBe(true)
    expect(() =>
      parseModkitMcpConfiguration(['--root', 'C:\\one', '--extension', 'C:\\ext'], {
        MODKIT_MCP_ALLOW_EDITS: 'sometimes',
      }),
    ).toThrow(/must be true or false/u)
    expect(() =>
      parseModkitMcpConfiguration(
        ['--root', 'C:\\one', '--extension', 'C:\\ext', '--operation-permission', 'root'],
        {},
      ),
    ).toThrow(/unknown operation permission/u)
  })

  it('requires paired absolute content source configuration', () => {
    const common = ['--root', 'C:\\one', '--extension', 'C:\\ext']
    expect(() =>
      parseModkitMcpConfiguration(
        [...common, '--content-source-config', 'C:\\config\\provider.json'],
        {},
      ),
    ).toThrow(/supplied together/u)
    const config = parseModkitMcpConfiguration(
      [
        ...common,
        '--content-source-config',
        'C:\\config\\provider.json',
        '--content-source-storage',
        'C:\\cache\\modkit',
      ],
      {},
    )
    expect(config).toMatchObject({
      contentSourceConfig: resolve('C:\\config\\provider.json'),
      contentSourceStorage: resolve('C:\\cache\\modkit'),
    })
  })
})

describe('MCP adapter lease and preparation regressions', () => {
  it('marks an unresolved open with host errors as a tool failure', async () => {
    const fake = fakeHost()
    const { client } = await connected({
      ...fake.host,
      open: async () =>
        ({
          snapshot: {
            state: 'unresolved',
            reason: 'input-unresolved',
            candidates: [],
            diagnostics: [
              {
                severity: 'error',
                code: 'x3.host/artifact-digest-mismatch',
                message: 'Artifact changed.',
              },
            ],
          },
          close: () => Promise.resolve(),
        }) as McpOpenedSubject,
    })
    const response = await client.callTool({
      name: 'modkit.open_subject',
      arguments: { path: 'C:/allowed/fixture' },
    })
    expect(response.isError).toBe(true)
    expect(structured(response).completeness).toBe('invalid')
  })

  it.each([
    ['modkit.subject_facts', { view: 'groups', limit: 20 }],
    ['modkit.subject_calculations', { view: 'calculations', limit: 20 }],
  ] as const)('keeps the source lease alive through %s', async (tool, query) => {
    const fake = fakeHost()
    const { client } = await connected({
      ...fake.host,
      async open(...args) {
        const opened = await fake.host.open(...args)
        const session = opened.session
        if (session === undefined) throw new Error('fixture did not expose a data session')
        return {
          ...opened,
          session: {
            ...session,
            dataSource: (async (contract, major) => {
              const lease = await session.dataSource(contract, major)
              let released = false
              return {
                value: new Proxy(lease.value, {
                  get(target, key) {
                    if (key !== 'summary') return Reflect.get(target, key)
                    return async (...input: unknown[]) => {
                      await new Promise(resolve => setTimeout(resolve, 0))
                      expect(released).toBe(false)
                      return Reflect.apply(Reflect.get(target, key), target, input)
                    }
                  },
                }),
                release: async () => {
                  released = true
                  await lease.release()
                },
              }
            }) as AssetSession['dataSource'],
          },
        }
      },
    })
    const opened = structured(
      await client.callTool({
        name: 'modkit.open_subject',
        arguments: { path: 'C:/allowed/fixture' },
      }),
    )
    const response = await client.callTool({
      name: tool,
      arguments: { handle: handleFrom(opened), ...query },
    })
    expect(response.isError).not.toBe(true)
    expect(structured(response).completeness).toBe('complete')
  })

  it('invalidates a previous preparation when revalidation rejects the plan', async () => {
    const fake = fakeHost({ withEditing: true, editsEnabled: true })
    let preparations = 0
    const { client } = await connected({
      ...fake.host,
      async open(...args) {
        const opened = await fake.host.open(...args)
        const editing = opened.editing
        if (editing === undefined) throw new Error('fixture did not expose editing')
        return {
          ...opened,
          editing: {
            ...editing,
            coordinator: {
              ...editing.coordinator,
              prepare: (async (...input) =>
                ++preparations === 1
                  ? editing.coordinator.prepare(...input)
                  : { state: 'rejected', diagnostics: [] }) as typeof editing.coordinator.prepare,
            },
          },
        }
      },
    })
    const opened = structured(
      await client.callTool({
        name: 'modkit.open_subject',
        arguments: { path: 'C:/allowed/fixture' },
      }),
    )
    const proposal = structured(
      await client.callTool({
        name: 'modkit.propose_edit',
        arguments: {
          handle: handleFrom(opened),
          operationId: 'fixture/write',
          input: {},
        },
      }),
    )
    const planHandle = (proposal.data as { planHandle: string }).planHandle
    await client.callTool({ name: 'modkit.prepare_edit', arguments: { planHandle } })
    const rejected = await client.callTool({
      name: 'modkit.prepare_edit',
      arguments: { planHandle },
    })
    expect(rejected.isError).toBe(true)
    const commit = await client.callTool({ name: 'modkit.commit_edit', arguments: { planHandle } })
    expect(commit.isError).toBe(true)
    expect(structured(commit).diagnostics[0]?.code).toBe('x3.mcp/edit-not-prepared')
    expect(fake.editInvocations()).not.toContain('commit')
  })
})

describe('bounded protocol projection', () => {
  it('preserves shared provenance without treating sibling references as cycles', () => {
    const provenance = [{ label: 'dependency', semanticPath: ['LifeMax'] }]
    const value = { inputs: [{ provenance }], provenance }
    expect(boundedJson(value)).toEqual({ value, capped: false })
  })

  it('caps cycles and oversized text before serialization', () => {
    const cyclic: { self?: unknown; text: string } = { text: 'x'.repeat(2_000_000) }
    cyclic.self = cyclic
    const projected = boundedJson(cyclic)
    const text = JSON.stringify(projected.value)
    expect(projected.capped).toBe(true)
    expect(Buffer.byteLength(text)).toBeLessThan(MCP_MAX_OUTPUT_BYTES)
    expect(text).toContain('cycle omitted')
  })

  it('projects hostile object keys without prototype mutation', () => {
    const projected = boundedJson(JSON.parse('{"__proto__":{"polluted":true}}'))
    const record = projected.value as Record<string, unknown>
    expect(Object.getPrototypeOf(record)).toBeNull()
    expect(Object.hasOwn(record, '__proto__')).toBe(true)
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })
})

describe('MCP v2 adapter', () => {
  it('advertises bounded inspection and explicitly effectful service-operation tools', async () => {
    const { client } = await connected(fakeHost().host)
    const tools = await client.listTools()
    expect(tools.tools.map(tool => tool.name)).toEqual([
      'modkit.inventory',
      'modkit.capabilities',
      'modkit.service_operations',
      'modkit.invoke_service_operation',
      'modkit.language',
      'modkit.language_session_open',
      'modkit.language_session_update',
      'modkit.language_session_feature',
      'modkit.language_session_close',
      'modkit.discover_installations',
      'modkit.open_discovered',
      'modkit.open_subject',
      'modkit.close_subject',
      'modkit.open_selection',
      'modkit.inspect',
      'modkit.list_subjects',
      'modkit.search_subjects',
      'modkit.select_subject',
      'modkit.close_selected_subject',
      'modkit.subject_facts',
      'modkit.relation_graph',
      'modkit.subject_calculations',
      'modkit.invoke_readonly',
      'modkit.subject_edit_target',
      'modkit.subject_isolation',
      'modkit.subject_isolation_plan',
      'modkit.release_output',
      // Reads what a change would be and writes nothing; see propose_edit's own case below.
      'modkit.propose_edit',
      'modkit.open_resolved_workspace',
      'modkit.propose_resolved_edit',
      'modkit.prepare_edit',
      'modkit.commit_edit',
      'modkit.edit_history',
      'modkit.undo_edit',
      'modkit.redo_edit',
      'modkit.discard_edit',
      'modkit.knowledge_search',
      'modkit.knowledge_resolve',
    ])
    expect(
      tools.tools
        .filter(
          tool =>
            ![
              'modkit.invoke_service_operation',
              'modkit.commit_edit',
              'modkit.undo_edit',
              'modkit.redo_edit',
              'modkit.discard_edit',
            ].includes(tool.name),
        )
        .every(tool => tool.annotations?.readOnlyHint === true),
    ).toBe(true)
    expect(
      tools.tools.find(tool => tool.name === 'modkit.invoke_service_operation')?.annotations,
    ).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true })
    for (const name of [
      'modkit.commit_edit',
      'modkit.undo_edit',
      'modkit.redo_edit',
      'modkit.discard_edit',
    ]) {
      expect(tools.tools.find(tool => tool.name === name)?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      })
    }
    const resources = await client.listResources()
    expect(resources.resources.map(resource => resource.uri)).toEqual([
      'modkit://inventory',
      'modkit://capabilities',
    ])
    const templates = await client.listResourceTemplates()
    expect(templates.resourceTemplates.map(template => template.uriTemplate)).toEqual([
      'modkit://output/{id}',
      'modkit://output/{id}/chunks/{offset}',
      'modkit://subject/{handle}/inspect',
      'modkit://subject/{handle}/facts',
      'modkit://subject/{handle}/graph',
      'modkit://subject/{handle}/formulas',
      'modkit://subject/{handle}/preview',
      'modkit://knowledge/{target}/{locale}',
      'modkit://schema/{target}/{locale}',
    ])
  })

  it('projects the generic service-operation catalog and invocation without domain branches', async () => {
    const descriptor = {
      schemaVersion: 1 as const,
      id: 'fixture.echo',
      title: 'Echo',
      summary: 'Return the input.',
      requiredPermissions: [] as const,
      effects: 'none' as const,
      inputSchema: { type: 'object' },
      resultSchema: { type: 'object' },
      budget: { maxInputBytes: 1024, maxOutputBytes: 1024, maxWallTimeMs: 1000 },
    }
    const host: ModkitMcpHostPort = {
      ...fakeHost().host,
      outputArtifacts: true,
      serviceOperationPermissions: [],
      effectfulServiceOperations: false,
      async serviceOperations(offset, limit, activate) {
        expect({ offset, limit, activate }).toEqual({ offset: 0, limit: 20, activate: true })
        return {
          total: 1,
          offset: 0,
          complete: true,
          entries: [
            {
              operationId: descriptor.id,
              declaredProviderIds: ['fixture/provider'],
              eligibleProviderIds: ['fixture/provider'],
              state: 'activatable',
              selectedProviderId: 'fixture/provider',
              descriptor,
              diagnostics: [],
            },
          ],
        }
      },
      async invokeServiceOperation(operationId, input) {
        return {
          state: 'invoked',
          descriptor,
          result: { state: 'completed', operationId, value: input, diagnostics: [] },
          diagnostics: [],
        }
      },
    }
    const { client } = await connected(host)
    const catalog = structured(
      await client.callTool({
        name: 'modkit.service_operations',
        arguments: { limit: 20, activate: true },
      }),
    )
    expect(catalog.data).toMatchObject({
      total: 1,
      items: [
        { operationId: 'fixture.echo', state: 'activatable', descriptor: { effects: 'none' } },
      ],
    })
    const invoked = structured(
      await client.callTool({
        name: 'modkit.invoke_service_operation',
        arguments: { operationId: 'fixture.echo', input: { message: 'hello' } },
      }),
    )
    expect(invoked.data).toMatchObject({
      state: 'invoked',
      result: { state: 'completed', value: { message: 'hello' } },
    })
    const retained = structured(
      await client.callTool({
        name: 'modkit.invoke_service_operation',
        arguments: {
          operationId: 'fixture.echo',
          input: { message: 'retained' },
          retainOutput: true,
        },
      }),
    )
    const retainedData = retained.data as {
      readonly state: string
      readonly outputArtifact: { readonly id: string; readonly firstChunkUri: string }
    }
    expect(retainedData).toMatchObject({
      state: 'retained',
      outputArtifact: { operationId: 'fixture.echo' },
    })
    const manifest = await client.readResource({
      uri: `modkit://output/${retainedData.outputArtifact.id}`,
    })
    expect(JSON.parse((manifest.contents[0] as { text: string }).text)).toMatchObject({
      operationId: 'fixture.echo',
    })
  })

  it('runs a bounded language feature over explicitly listed files', async () => {
    const fake = fakeHost({ withLanguage: true })
    const { client } = await connected(fake.host)
    const result = structured(
      await client.callTool({
        name: 'modkit.language',
        arguments: {
          documents: [{ path: 'C:\\allowed\\fixture.galaxy', languageId: 'galaxy' }],
          primaryIndex: 0,
          feature: 'hover',
          position: { line: 0, character: 1 },
          maxResults: 20,
          maxEdits: 100,
        },
      }),
    )
    expect(result).toMatchObject({
      snapshotId: 'language-v1',
      completeness: 'partial',
      data: {
        workspaceIncomplete: true,
        feature: 'hover',
        result: { markdown: 'Fixture hover' },
      },
    })
    expect(fake.languageInvocations()).toEqual([
      expect.objectContaining({
        feature: 'hover',
        position: { line: 0, character: 1 },
      }),
    ])
  })

  it('keeps language limits inside the host contract', async () => {
    const fake = fakeHost({ withLanguage: true })
    const { client } = await connected(fake.host)
    await client.callTool({
      name: 'modkit.language',
      arguments: {
        documents: [{ path: 'C:\\allowed\\fixture.galaxy', languageId: 'galaxy' }],
        feature: 'analyze',
      },
    })
    expect(fake.languageInvocations()).toEqual([
      expect.objectContaining({ maxResults: 1_000, maxEdits: 1_024 }),
    ])

    const rejected = await client.callTool({
      name: 'modkit.language',
      arguments: {
        documents: [{ path: 'C:\\allowed\\fixture.galaxy', languageId: 'galaxy' }],
        feature: 'analyze',
        maxEdits: 4_097,
      },
    })
    expect(rejected.isError).toBe(true)
  })

  it('retains a host-owned virtual language session across overlay and feature calls', async () => {
    const fake = fakeHost({ withLanguageSession: true })
    const { client } = await connected(fake.host)
    const uri = 'modkit-source://workspace/Scripts/Main.galaxy'
    const subject = structured(
      await client.callTool({
        name: 'modkit.open_subject',
        arguments: { path: 'C:\\allowed\\fixture' },
      }),
    )
    const opened = structured(
      await client.callTool({
        name: 'modkit.language_session_open',
        arguments: {
          dependencySubjectHandle: handleFrom(subject),
          documents: [{ uri, languageId: 'galaxy', version: 4, text: 'void main() {}' }],
        },
      }),
    )
    const sessionHandle = (opened.data as { sessionHandle: string }).sessionHandle
    expect(sessionHandle).toMatch(/^[0-9a-f-]{36}$/u)
    expect(opened).toMatchObject({ completeness: 'partial', data: { workspaceIncomplete: true } })

    const updated = structured(
      await client.callTool({
        name: 'modkit.language_session_update',
        arguments: { sessionHandle, uri, version: 5, text: 'void main() { return; }' },
      }),
    )
    expect(updated).toMatchObject({
      snapshotId: 'session-v5',
      data: { result: { documentVersion: 5 } },
    })

    const feature = structured(
      await client.callTool({
        name: 'modkit.language_session_feature',
        arguments: {
          sessionHandle,
          primaryUri: uri,
          feature: 'hover',
          position: { line: 0, character: 5 },
        },
      }),
    )
    expect(feature).toMatchObject({ data: { result: { markdown: 'Session hover' } } })
    await client.callTool({
      name: 'modkit.language_session_close',
      arguments: { sessionHandle },
    })
    expect(fake.languageSessionCloses()).toBe(1)
    expect(fake.languageSessionInvocations()).toEqual([
      expect.objectContaining({ kind: 'open', dependencyBound: true }),
      expect.objectContaining({ kind: 'update', update: expect.objectContaining({ version: 5 }) }),
      expect.objectContaining({
        kind: 'feature',
        feature: expect.objectContaining({ feature: 'hover' }),
      }),
    ])
    const stale = await client.callTool({
      name: 'modkit.language_session_feature',
      arguments: { sessionHandle, primaryUri: uri, feature: 'diagnostics' },
    })
    expect(stale.isError).toBe(true)
  })

  it('closes retained language sessions when the runtime is disposed', async () => {
    const fake = fakeHost({ withLanguageSession: true })
    const runtime = new ModkitMcpRuntime(fake.host)
    await runtime.openLanguageSession(
      {
        documents: [
          {
            uri: 'modkit-source://workspace/Scripts/Main.galaxy',
            languageId: 'galaxy',
            version: 1,
            text: 'void main() {}',
          },
        ],
      },
      new AbortController().signal,
    )

    await runtime.dispose()

    expect(fake.languageSessionCloses()).toBe(1)
  })

  it('forwards bounded code-action context without applying edits', async () => {
    const fake = fakeHost({ withLanguage: true })
    const { client } = await connected(fake.host)
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }
    const result = structured(
      await client.callTool({
        name: 'modkit.language',
        arguments: {
          documents: [{ path: 'C:\\allowed\\fixture.galaxy', languageId: 'galaxy' }],
          feature: 'code-actions',
          range,
          languageDiagnostics: [
            {
              range,
              severity: 'warning',
              message: 'fixture warning',
              code: 'fixture/warning',
            },
          ],
          maxResults: 20,
          maxEdits: 10,
        },
      }),
    )
    expect(result).toMatchObject({
      completeness: 'partial',
      data: { feature: 'code-actions', result: { actions: [] } },
    })
    expect(fake.languageInvocations()).toEqual([
      expect.objectContaining({
        feature: 'code-actions',
        range,
        languageDiagnostics: [expect.objectContaining({ code: 'fixture/warning' })],
      }),
    ])
  })

  it('opens, inspects and closes an opaque handle', async () => {
    const fake = fakeHost()
    const { client } = await connected(fake.host)
    const opened = structured(
      await client.callTool({
        name: 'modkit.open_subject',
        arguments: { path: 'C:\\allowed\\fixture' },
      }),
    )
    const handle = handleFrom(opened)
    expect(handle).not.toBe('host-session-do-not-expose')
    const inspected = structured(
      await client.callTool({ name: 'modkit.inspect', arguments: { handle } }),
    )
    expect(inspected.trust).toBe('untrusted-data')
    expect(JSON.stringify(inspected.data)).toContain('fixture/write')
    const resource = await client.readResource({ uri: `modkit://subject/${handle}/inspect` })
    const first = resource.contents[0]
    expect(first !== undefined && 'text' in first ? first.text : '').toContain('fixture-revision')
    const closed = structured(
      await client.callTool({ name: 'modkit.close_subject', arguments: { handle } }),
    )
    expect((closed.data as { state: string }).state).toBe('closed')
    expect(fake.closes()).toBe(1)
  })

  it('continues an open container selection on the same handle', async () => {
    const fake = fakeHost({ withSelection: true })
    const { client } = await connected(fake.host)
    const opened = structured(
      await client.callTool({
        name: 'modkit.open_subject',
        arguments: { path: 'C:\\allowed\\fixture' },
      }),
    )
    const handle = handleFrom(opened)
    expect(opened.data).toMatchObject({
      selectionCandidates: [{ candidateId: 'fixture-candidate' }],
    })
    const selected = structured(
      await client.callTool({
        name: 'modkit.open_selection',
        arguments: { handle, selectionId: 'fixture-candidate' },
      }),
    )
    expect(selected.data).toMatchObject({ state: 'opened', handle })
    expect(fake.selectionInvocations()).toEqual(['fixture-candidate'])
    await client.callTool({ name: 'modkit.close_subject', arguments: { handle } })
    expect(fake.closes()).toBe(1)
  })

  it('opens an opaque verified discovery result and closes its handle on success and error', async () => {
    const fake = fakeHost({ withDiscovery: true })
    const { client } = await connected(fake.host)
    const discovered = structured(
      await client.callTool({
        name: 'modkit.discover_installations',
        arguments: { gameId: 'fixture-game', maxCandidates: 4 },
      }),
    )
    expect(JSON.stringify(discovered.data)).not.toContain('C:\\allowed')
    expect(discovered.data).toMatchObject({
      items: [
        {
          selectionId: 'fixture-installation',
          openable: true,
          locator: { kind: 'discovered-installation' },
        },
      ],
    })
    const opened = structured(
      await client.callTool({
        name: 'modkit.open_discovered',
        arguments: { selectionId: 'fixture-installation' },
      }),
    )
    const handle = handleFrom(opened)
    const closed = structured(
      await client.callTool({ name: 'modkit.close_subject', arguments: { handle } }),
    )
    expect(closed.data).toMatchObject({ state: 'closed', handle })
    const refused = await client.callTool({
      name: 'modkit.open_discovered',
      arguments: { selectionId: 'missing-installation' },
    })
    expect(refused.isError).toBe(true)
    const secondClose = await client.callTool({
      name: 'modkit.close_subject',
      arguments: { handle },
    })
    expect(structured(secondClose).diagnostics[0]?.code).toBe('x3.mcp/unknown-handle')
    expect(fake.closes()).toBe(1)
  })

  it('reads facts, graph, calculations and the single injected knowledge catalog', async () => {
    const { client } = await connected(fakeHost().host)
    const opened = structured(
      await client.callTool({
        name: 'modkit.open_subject',
        arguments: { path: 'C:\\allowed\\fixture' },
      }),
    )
    const handle = handleFrom(opened)
    const facts = structured(
      await client.callTool({
        name: 'modkit.subject_facts',
        arguments: { handle, view: 'facts', groupId: 'general', limit: 10 },
      }),
    )
    expect(JSON.stringify(facts.data)).toContain(fixture.summary)
    expect(facts.provenance).toHaveLength(1)
    const graph = structured(
      await client.callTool({
        name: 'modkit.relation_graph',
        arguments: { handle, view: 'edges', limit: 10 },
      }),
    )
    expect(JSON.stringify(graph.data)).toContain('uses')
    const traversal = structured(
      await client.callTool({
        name: 'modkit.relation_graph',
        arguments: { handle, view: 'traverse', roots: ['a'], depth: 2 },
      }),
    )
    expect(traversal.completeness).toBe('complete')
    expect(traversal.data).toMatchObject({
      roots: ['a'],
      direction: 'outgoing',
      depth: 2,
      nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
      missingNodeIds: [],
      scanned: { nodes: 4, edges: 3 },
    })
    const calculations = structured(
      await client.callTool({
        name: 'modkit.subject_calculations',
        arguments: { handle, view: 'calculations', limit: 10 },
      }),
    )
    expect(JSON.stringify(calculations.data)).toContain('x * 2')
    const knowledge = structured(
      await client.callTool({
        name: 'modkit.knowledge_resolve',
        arguments: {
          target: { kind: 'concept', ecosystem: 'fixture', conceptId: 'fixture-value' },
          locales: ['en'],
          limit: 10,
        },
      }),
    )
    expect(JSON.stringify(knowledge.data)).toContain(fixture.source)
    expect(knowledge.snapshotId).toBe('knowledge-v1')

    const graphResource = await client.readResource({ uri: `modkit://subject/${handle}/graph` })
    const formulasResource = await client.readResource({
      uri: `modkit://subject/${handle}/formulas`,
    })
    const previewResource = await client.readResource({
      uri: `modkit://subject/${handle}/preview`,
    })
    expect(JSON.stringify(graphResource.contents)).toContain('graph-v1')
    expect(JSON.stringify(formulasResource.contents)).toContain('x * 2')
    expect(JSON.stringify(previewResource.contents)).toContain('fixture-preview')

    const knowledgeTarget = encodeKnowledgeResourceTarget({
      kind: 'concept',
      ecosystem: 'fixture',
      conceptId: 'fixture-value',
    })
    const schemaTarget = encodeKnowledgeResourceTarget({
      kind: 'field',
      ecosystem: 'fixture',
      schema: { contract: 'fixture/schema', major: 1, revision: 'v1' },
      typeId: 'Fixture',
      canonicalPath: ['value'],
    })
    const knowledgeResource = await client.readResource({
      uri: `modkit://knowledge/${knowledgeTarget}/en`,
    })
    const schemaResource = await client.readResource({
      uri: `modkit://schema/${schemaTarget}/en`,
    })
    expect(JSON.stringify(knowledgeResource.contents)).toContain(fixture.source)
    expect(JSON.stringify(schemaResource.contents)).toContain('knowledge-v1')
  })

  it('lists and selects a publisher-parsed entity through host-owned leases', async () => {
    const { client } = await connected(fakeHost().host)
    const opened = structured(
      await client.callTool({
        name: 'modkit.open_subject',
        arguments: { path: 'C:\\allowed\\fixture' },
      }),
    )
    const parentHandle = handleFrom(opened)
    const listed = structured(
      await client.callTool({
        name: 'modkit.list_subjects',
        arguments: { handle: parentHandle, limit: 10, kind: 'fixture', text: 'subject' },
      }),
    )
    expect(listed.data).toMatchObject({
      total: 1,
      items: [{ subjectId: 'fixture-subject', kind: 'fixture' }],
    })
    const filteredOut = structured(
      await client.callTool({
        name: 'modkit.list_subjects',
        arguments: { handle: parentHandle, limit: 10, kind: 'not-fixture' },
      }),
    )
    expect(filteredOut.data).toMatchObject({ total: 1, items: [] })
    const exact = structured(
      await client.callTool({
        name: 'modkit.search_subjects',
        arguments: {
          handle: parentHandle,
          subjectId: 'fixture-subject',
          kind: 'fixture',
          limit: 10,
        },
      }),
    )
    expect(exact.data).toMatchObject({
      items: [
        {
          subjectId: 'fixture-subject',
          locator: {
            kind: 'nested-subject',
            handle: parentHandle,
            subjectId: 'fixture-subject',
          },
          coordinate: { namespace: 'fixture', entityId: 'fixture-subject' },
        },
      ],
    })
    const exactMiss = structured(
      await client.callTool({
        name: 'modkit.search_subjects',
        arguments: { handle: parentHandle, label: 'fixture subject', limit: 10 },
      }),
    )
    expect(exactMiss.data).toMatchObject({ items: [] })
    const graphPage = structured(
      await client.callTool({
        name: 'modkit.relation_graph',
        arguments: { handle: parentHandle, view: 'nodes', limit: 1 },
      }),
    )
    const crossedCursor = await client.callTool({
      name: 'modkit.search_subjects',
      arguments: {
        handle: parentHandle,
        subjectId: 'fixture-subject',
        cursor: graphPage.nextCursor,
        limit: 10,
      },
    })
    expect(crossedCursor.isError).toBe(true)
    expect(structured(crossedCursor).diagnostics[0]?.code).toBe('x3.mcp/invalid-cursor')
    const selected = structured(
      await client.callTool({
        name: 'modkit.select_subject',
        arguments: { handle: parentHandle, subjectId: 'fixture-subject' },
      }),
    )
    const entityHandle = handleFrom(selected)
    expect(entityHandle).not.toBe(parentHandle)
    const facts = structured(
      await client.callTool({
        name: 'modkit.subject_facts',
        arguments: { handle: entityHandle, view: 'summary' },
      }),
    )
    const calculations = structured(
      await client.callTool({
        name: 'modkit.subject_calculations',
        arguments: { handle: entityHandle, view: 'summary' },
      }),
    )
    expect(facts.data).toMatchObject({ identity: { subjectId: 'fixture-subject' } })
    expect(calculations.data).toMatchObject({ subjectId: 'fixture-subject' })
    const editTarget = structured(
      await client.callTool({
        name: 'modkit.subject_edit_target',
        arguments: { handle: entityHandle, fieldPath: ['LifeMax'] },
      }),
    )
    expect(editTarget.data).toMatchObject({
      state: 'resolved',
      subjectId: 'fixture-subject',
      destination: {
        rootId: 'C',
        label: 'Write: C → C.SC2Mod/Base.SC2Data/GameData/UnitData.xml',
        targetId: 'fixture-target',
      },
      guards: [{ rootId: 'C', revision: 'content-hash.sha256:fixture' }],
    })
    const isolation = structured(
      await client.callTool({
        name: 'modkit.subject_isolation',
        arguments: {
          handle: entityHandle,
          targetSubjectId: 'fixture/weapon',
          ownerFieldPath: ['WeaponArray', '0', 'Link'],
        },
      }),
    )
    expect(isolation.data).toMatchObject({
      schemaVersion: 1,
      state: 'ready',
      ownerSubjectId: 'fixture-subject',
      targetSubjectId: 'fixture/weapon',
      shared: true,
      cloneRequired: true,
      otherReferrerIds: ['fixture/other-owner'],
      rewireFieldPaths: [['WeaponArray', '0', 'Link']],
    })
    const isolationPlan = structured(
      await client.callTool({
        name: 'modkit.subject_isolation_plan',
        arguments: {
          handle: entityHandle,
          targetSubjectId: 'fixture/weapon',
          cloneSubjectId: 'fixture/marine-weapon',
          ownerFieldPath: ['WeaponArray', '0', 'Link'],
        },
      }),
    )
    expect(isolationPlan.data).toMatchObject({
      schemaVersion: 1,
      state: 'planned',
      ownerSubjectId: 'fixture-subject',
      targetSubjectId: 'fixture/weapon',
      cloneSubjectId: 'fixture/marine-weapon',
      replacements: [
        {
          purpose: 'clone-and-rewire',
          replacementBytes: 512,
          destination: { rootId: 'C', mode: 'replace', targetId: 'fixture-target' },
        },
      ],
    })
    expect(JSON.stringify(isolationPlan.data)).not.toContain('replacementText')
    expect(JSON.stringify(isolationPlan.data)).not.toContain('<Catalog')
    const closed = structured(
      await client.callTool({
        name: 'modkit.close_selected_subject',
        arguments: { handle: entityHandle },
      }),
    )
    expect(closed.data).toMatchObject({ state: 'closed', subjectId: 'fixture-subject' })
  })

  it('force-closes a selected subject when its source ignores cancellation', async () => {
    const fake = fakeHost({ ignoreFactsAbort: true })
    const runtime = new ModkitMcpRuntime(fake.host)
    const opened = await runtime.open('C:\\allowed\\fixture', new AbortController().signal)
    const parentHandle = handleFrom(opened)
    const selected = await runtime.selectSubject(
      parentHandle,
      'fixture-subject',
      new AbortController().signal,
    )
    const entityHandle = handleFrom(selected)
    const pending = runtime.facts(
      entityHandle,
      { view: 'groups', limit: 10 },
      new AbortController().signal,
    )
    void pending.catch(() => undefined)
    await new Promise(resolve => setTimeout(resolve, 0))
    const started = performance.now()
    const closed = await runtime.closeEntity(entityHandle)
    expect(performance.now() - started).toBeGreaterThanOrEqual(900)
    expect(closed).toMatchObject({
      completeness: 'capped',
      diagnostics: [{ code: 'x3.mcp/close-deadline' }],
    })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await runtime.close(parentHandle)
  })

  it('marks a depth-limited relation traversal incomplete when its source scan is capped', async () => {
    const { client } = await connected(fakeHost().host)
    const opened = structured(
      await client.callTool({
        name: 'modkit.open_subject',
        arguments: { path: 'C:\\allowed\\fixture' },
      }),
    )
    const traversal = structured(
      await client.callTool({
        name: 'modkit.relation_graph',
        arguments: {
          handle: handleFrom(opened),
          view: 'traverse',
          roots: ['a'],
          direction: 'both',
          depth: 3,
          scanLimit: 1,
        },
      }),
    )
    expect(traversal.completeness).toBe('capped')
    expect(traversal.diagnostics.map(item => item.code)).toContain(
      'x3.mcp/relation-graph-scan-capped',
    )
    expect(traversal.data).toMatchObject({
      roots: ['a'],
      scanned: { nodes: 1, edges: 1 },
    })
  })

  it('invokes an exact descriptor-advertised read-only operation with bounded evidence', async () => {
    const fake = fakeHost()
    const { client } = await connected(fake.host)
    const opened = structured(
      await client.callTool({
        name: 'modkit.open_subject',
        arguments: { path: 'C:\\allowed\\fixture' },
      }),
    )
    const result = structured(
      await client.callTool({
        name: 'modkit.invoke_readonly',
        arguments: {
          handle: handleFrom(opened),
          operationId: 'fixture/read',
          input: { value: 2 },
        },
      }),
    )
    expect(result.completeness).toBe('complete')
    expect(result.provenance).toHaveLength(2)
    expect(JSON.stringify(result.data)).toContain(fixture.summary)
    expect(fake.operationInvocations()).toEqual(['read'])
  })

  it('refuses mutating and unknown operation IDs before session invocation', async () => {
    const fake = fakeHost()
    const { client } = await connected(fake.host)
    const opened = structured(
      await client.callTool({
        name: 'modkit.open_subject',
        arguments: { path: 'C:\\allowed\\fixture' },
      }),
    )
    const handle = handleFrom(opened)
    const mutating = await client.callTool({
      name: 'modkit.invoke_readonly',
      arguments: { handle, operationId: 'fixture/write', input: null },
    })
    expect(mutating.isError).toBe(true)
    expect(structured(mutating).diagnostics[0]?.code).toBe('x3.mcp/mutating-operation-refused')
    const unknown = await client.callTool({
      name: 'modkit.invoke_readonly',
      arguments: { handle, operationId: 'fixture/missing', input: null },
    })
    expect(unknown.isError).toBe(true)
    expect(structured(unknown).diagnostics[0]?.code).toBe('x3.mcp/operation-not-declared')
    expect(fake.operationInvocations()).toEqual([])
  })

  /*
   * An agent that can read a mod and not propose a change to it is half a tool. The obvious way to
   * close that gap — letting it invoke mutating operations — is the wrong one, and MK3 already has
   * the right shape: a codec answers a write with a plan, so the plan is what an agent gets.
   */
  it('returns what a mutating operation would change, and writes nothing', async () => {
    const fake = fakeHost()
    const { client } = await connected(fake.host)
    const opened = structured(
      await client.callTool({
        name: 'modkit.open_subject',
        arguments: { path: 'C:\\allowed\\fixture' },
      }),
    )
    const result = structured(
      await client.callTool({
        name: 'modkit.propose_edit',
        arguments: {
          handle: handleFrom(opened),
          operationId: 'fixture/write',
          input: { value: 1 },
        },
      }),
    )
    expect(result.completeness).toBe('complete')
    const data = result.data as {
      committed?: boolean
      plan?: { planId?: string; edits?: readonly Record<string, unknown>[] }
    }
    expect(data.committed).toBe(false)
    expect(data.plan?.planId).toBe('fixture-plan')
    const edit = data.plan?.edits?.[0]
    expect(edit).toMatchObject({ operation: 'replace', offset: '4', length: '2' })
    /*
     * The replacement bytes are counted, not carried. For a re-encoded texture they are the whole
     * file, and an agent asking what would change wants the shape of the change.
     */
    expect(edit?.['replacementBytes']).toBe(3)
    expect(result.diagnostics.some(item => item.code === 'x3.mcp/edit-not-committed')).toBe(true)
  })

  it('keeps edit authority server-side through prepare, commit, history, undo and redo', async () => {
    const fake = fakeHost({ withEditing: true, editsEnabled: true })
    const { client } = await connected(fake.host)
    const opened = structured(
      await client.callTool({
        name: 'modkit.open_subject',
        arguments: { path: 'C:\\allowed\\fixture' },
      }),
    )
    const proposed = structured(
      await client.callTool({
        name: 'modkit.propose_edit',
        arguments: {
          handle: handleFrom(opened),
          operationId: 'fixture/write',
          input: { value: 2 },
        },
      }),
    )
    const planHandle = (proposed.data as { planHandle?: string }).planHandle
    expect(planHandle).toMatch(/^[0-9a-f-]{36}$/u)
    expect(JSON.stringify(proposed.data)).not.toContain('65,66,67')

    const prepared = structured(
      await client.callTool({
        name: 'modkit.prepare_edit',
        arguments: { planHandle },
      }),
    )
    expect(prepared.data).toMatchObject({ state: 'ready', planDigest: 'fixture-digest' })

    const committed = structured(
      await client.callTool({
        name: 'modkit.commit_edit',
        arguments: { planHandle },
      }),
    )
    expect(committed.data).toMatchObject({ result: { state: 'committed' } })
    const replayedCommit = await client.callTool({
      name: 'modkit.commit_edit',
      arguments: { planHandle },
    })
    expect(replayedCommit.isError).toBe(true)
    expect(structured(replayedCommit).diagnostics[0]?.code).toBe('x3.mcp/unknown-edit-plan')
    const history = structured(
      await client.callTool({ name: 'modkit.edit_history', arguments: { limit: 10 } }),
    )
    expect(history.data).toMatchObject({
      total: 1,
      items: [{ transactionId: 'fixture-transaction', status: 'committed' }],
    })
    await client.callTool({
      name: 'modkit.undo_edit',
      arguments: { transactionId: 'fixture-transaction' },
    })
    await client.callTool({
      name: 'modkit.redo_edit',
      arguments: { transactionId: 'fixture-transaction' },
    })
    await client.callTool({
      name: 'modkit.discard_edit',
      arguments: { id: 'fixture-transaction' },
    })
    expect(fake.editInvocations()).toEqual([
      'stage',
      'prepare',
      'commit',
      'undo',
      'redo',
      'discard-history',
    ])
  })

  it('validates a retained plan but refuses commit without the startup edit policy', async () => {
    const fake = fakeHost({ withEditing: true })
    const { client } = await connected(fake.host)
    const opened = structured(
      await client.callTool({
        name: 'modkit.open_subject',
        arguments: { path: 'C:\\allowed\\fixture' },
      }),
    )
    const proposed = structured(
      await client.callTool({
        name: 'modkit.propose_edit',
        arguments: { handle: handleFrom(opened), operationId: 'fixture/write', input: {} },
      }),
    )
    const planHandle = (proposed.data as { planHandle: string }).planHandle
    const prepared = await client.callTool({
      name: 'modkit.prepare_edit',
      arguments: { planHandle },
    })
    expect(prepared.isError).not.toBe(true)
    const commit = await client.callTool({
      name: 'modkit.commit_edit',
      arguments: { planHandle },
    })
    expect(commit.isError).toBe(true)
    expect(structured(commit).diagnostics[0]?.code).toBe('x3.mcp/edit-commit-disabled')
    expect(fake.editInvocations()).toEqual(['stage', 'prepare'])
  })

  it('refuses a read-only operation sent to the proposal adapter', async () => {
    const fake = fakeHost()
    const { client } = await connected(fake.host)
    const opened = structured(
      await client.callTool({
        name: 'modkit.open_subject',
        arguments: { path: 'C:\\allowed\\fixture' },
      }),
    )
    const response = await client.callTool({
      name: 'modkit.propose_edit',
      arguments: { handle: handleFrom(opened), operationId: 'fixture/read', input: null },
    })
    expect(response.isError).toBe(true)
    expect(structured(response).diagnostics[0]?.code).toBe('x3.mcp/non-mutating-operation-refused')
  })

  it('expires a retained plan after its TTL and releases its staged payloads', async () => {
    const fake = fakeHost({ withEditing: true, editsEnabled: true })
    const { client } = await connected(fake.host)
    const opened = structured(
      await client.callTool({
        name: 'modkit.open_subject',
        arguments: { path: 'C:\\allowed\\fixture' },
      }),
    )
    const proposed = structured(
      await client.callTool({
        name: 'modkit.propose_edit',
        arguments: { handle: handleFrom(opened), operationId: 'fixture/write', input: {} },
      }),
    )
    const { planHandle, expiresAt } = proposed.data as { planHandle: string; expiresAt: string }
    const now = Date.now
    Date.now = () => Date.parse(expiresAt) + 1
    try {
      const expired = await client.callTool({
        name: 'modkit.prepare_edit',
        arguments: { planHandle },
      })
      expect(expired.isError).toBe(true)
      expect(structured(expired).diagnostics[0]?.code).toBe('x3.mcp/unknown-edit-plan')
    } finally {
      Date.now = now
    }
    expect(fake.editInvocations()).toEqual(['stage', 'release-plan'])
  })

  it('preserves a host operation rejection as bounded invalid data', async () => {
    const fake = fakeHost()
    const { client } = await connected(fake.host)
    const opened = structured(
      await client.callTool({
        name: 'modkit.open_subject',
        arguments: { path: 'C:\\allowed\\fixture' },
      }),
    )
    const response = await client.callTool({
      name: 'modkit.invoke_readonly',
      arguments: {
        handle: handleFrom(opened),
        operationId: 'fixture/rejected',
        input: null,
      },
    })
    const result = structured(response)
    expect(response.isError).toBe(true)
    expect(result.completeness).toBe('invalid')
    expect(result.diagnostics[0]?.code).toBe('fixture/dependency-required')
    expect(result.provenance).toHaveLength(2)
    expect(result.data).toMatchObject({ result: { state: 'rejected' }, progress: [] })
    expect(fake.operationInvocations()).toEqual(['rejected'])
  })

  it('caps oversized cyclic operation output without leaking the cycle', async () => {
    const fake = fakeHost()
    const runtime = new ModkitMcpRuntime(fake.host)
    const opened = await runtime.open('C:\\allowed\\fixture', new AbortController().signal)
    const result = await runtime.invokeReadonly(
      handleFrom(opened),
      'fixture/oversized',
      null,
      new AbortController().signal,
    )
    const text = JSON.stringify(result)
    expect(result.completeness).toBe('capped')
    expect(text).toContain('cycle omitted')
    expect(Buffer.byteLength(text)).toBeLessThan(MCP_MAX_OUTPUT_BYTES)
    await runtime.dispose()
  })

  it('rejects capped hostile operation input before session invocation', async () => {
    const fake = fakeHost()
    const runtime = new ModkitMcpRuntime(fake.host)
    const opened = await runtime.open('C:\\allowed\\fixture', new AbortController().signal)
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    await expect(
      runtime.invokeReadonly(
        handleFrom(opened),
        'fixture/read',
        cyclic,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'x3.mcp/operation-input-too-large' })
    expect(fake.operationInvocations()).toEqual([])
    await runtime.dispose()
  })

  it('cancels an active operation and drains it when its handle closes', async () => {
    const fake = fakeHost()
    const runtime = new ModkitMcpRuntime(fake.host)
    const opened = await runtime.open('C:\\allowed\\fixture', new AbortController().signal)
    const handle = handleFrom(opened)
    const pending = runtime.invokeReadonly(
      handle,
      'fixture/slow',
      null,
      new AbortController().signal,
    )
    while (fake.operationInvocations().length === 0) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    const [invocation, closed] = await Promise.allSettled([pending, runtime.close(handle)])
    expect(invocation).toMatchObject({ status: 'rejected' })
    expect(fake.operationAborts()).toEqual(['slow'])
    expect(closed).toMatchObject({ status: 'fulfilled', value: { completeness: 'complete' } })
    expect(fake.operationInvocations()).toEqual(['slow'])
    expect(fake.closes()).toBe(1)
  })

  it('releases a returned stream when a late abort makes normalization throw', async () => {
    const controller = new AbortController()
    const fake = fakeHost({ lateAbortController: controller })
    const runtime = new ModkitMcpRuntime(fake.host)
    const opened = await runtime.open('C:\\allowed\\fixture', new AbortController().signal)
    const handle = handleFrom(opened)
    await expect(
      runtime.invokeReadonly(handle, 'fixture/late-stream', null, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    const closed = await runtime.close(handle)
    expect(closed.completeness).toBe('complete')
    expect(fake.streamReleases()).toBe(1)
  })

  it('rejects oversized requests before the host port is called', async () => {
    const fake = fakeHost()
    const { client } = await connected(fake.host)
    const result = await client.callTool({
      name: 'modkit.open_subject',
      arguments: { path: `C:\\allowed\\${'x'.repeat(5_000)}` },
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect(fake.closes()).toBe(0)
  })

  it('binds data-source cursors to the exact handle, snapshot and view', async () => {
    const { client } = await connected(fakeHost().host)
    const opened = structured(
      await client.callTool({
        name: 'modkit.open_subject',
        arguments: { path: 'C:\\allowed\\fixture' },
      }),
    )
    const handle = handleFrom(opened)
    const nodes = structured(
      await client.callTool({
        name: 'modkit.relation_graph',
        arguments: { handle, view: 'nodes', limit: 1 },
      }),
    )
    expect(nodes.nextCursor).not.toBeNull()
    const crossed = await client.callTool({
      name: 'modkit.relation_graph',
      arguments: { handle, view: 'edges', limit: 1, cursor: nodes.nextCursor },
    })
    expect(crossed.isError).toBe(true)
    expect(structured(crossed).diagnostics[0]?.code).toBe('x3.mcp/invalid-cursor')
    const cursor = nodes.nextCursor ?? ''
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('A') ? 'B' : 'A'}`
    const forged = await client.callTool({
      name: 'modkit.relation_graph',
      arguments: { handle, view: 'nodes', limit: 1, cursor: tampered },
    })
    expect(forged.isError).toBe(true)
  })

  it('aborts an active source read before closing its handle', async () => {
    const fake = fakeHost({ waitForAbort: true })
    const runtime = new ModkitMcpRuntime(fake.host)
    const opened = await runtime.open('C:\\allowed\\fixture', new AbortController().signal)
    const handle = handleFrom(opened)
    const pending = runtime.facts(
      handle,
      { view: 'groups', limit: 10 },
      new AbortController().signal,
    )
    await expect(Promise.allSettled([pending, runtime.close(handle)])).resolves.toEqual([
      expect.objectContaining({ status: 'rejected' }),
      expect.objectContaining({ status: 'fulfilled' }),
    ])
    expect(fake.closes()).toBe(1)
  })
})
