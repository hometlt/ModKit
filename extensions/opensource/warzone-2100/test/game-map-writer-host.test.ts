import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { canonicalJsonStringify, uint64 } from '@modkitx-x3/core'
import {
  createEvidenceRegistry,
  createSubjectEditing,
  resolveFormatWriter,
  serviceProviderFidelityEvidenceRecord,
  type EditingBackend,
} from '@modkitx-x3/host'
import {
  createNodeSubjectServices,
  loadExtensionDirectory,
  nodeRuntimeTargetBase,
  nodeWorkerLinks,
  nodeWorkerRealmProfile,
  workerBackendPolicy,
} from '@modkitx-x3/host/node'
import {
  createHostTopology,
  revisionId,
  type ArtifactByteSource,
  type AssetRevision,
  type ChangeSet,
  type PayloadStore,
  type PermissionGrant,
  type SourceEdit,
} from '@modkitx-x3/sdk'
import { parseWarzoneGameMap } from '../src/warzone2100-map/format.js'
import { WARZONE_GAME_MAP_WRITE_INTENT } from '../src/warzone2100-map/writer.js'

const extensionRoot = join(import.meta.dirname, '..')
const HOST = 'org.example.app/warzone-map-writer-host'
const WORKERS = 'org.example.app/warzone-map-writer-workers'
const SOURCE = Object.freeze({ id: 'content', uri: 'memory://warzone/game.map' })
const budget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const WRITE: PermissionGrant = {
  id: 'warzone-map-writer-host-write',
  classes: ['read-source', 'write-source'],
}
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.example.app/warzone-map-writer',
  realms: [
    {
      schemaVersion: 1,
      realmId: HOST,
      revision: '1',
      target: nodeRuntimeTargetBase(),
      facilities: ['worker.module'],
      budgets: {
        maxConcurrentTasks: 2,
        maxWorkerCount: 1,
        maxResidentBytes: uint64('268435456'),
        maxTransferBytes: uint64('67108864'),
        defaultDeadlineMs: 60_000,
      },
      policy: { id: 'org.example.policy/warzone-map-writer', revision: '1' },
    },
    nodeWorkerRealmProfile({
      realmId: WORKERS,
      budgets: {
        maxConcurrentTasks: 1,
        maxWorkerCount: 0,
        maxResidentBytes: uint64('134217728'),
        maxTransferBytes: uint64('67108864'),
        defaultDeadlineMs: 60_000,
      },
      policy: { id: 'org.example.policy/warzone-map-writer-worker', revision: '1' },
    }),
  ],
  links: [...nodeWorkerLinks(HOST, WORKERS)],
})

const digest = (bytes: Uint8Array): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

function revision(bytes: Uint8Array): AssetRevision {
  const value = revisionId(`content-hash.${digest(bytes)}`)
  return Object.freeze({
    bindings: Object.freeze({ content: value }),
    compositionFingerprint: canonicalJsonStringify({
      topology: 'single',
      bindingId: 'content',
      source: SOURCE,
      revision: value,
    }),
  })
}

function fixture(): Uint8Array {
  const width = 3
  const height = 2
  const gatewayOffset = 16 + width * height * 3
  const bytes = new Uint8Array(gatewayOffset + 8 + 4 + 3)
  bytes.set([0x6d, 0x61, 0x70, 0x20])
  const view = new DataView(bytes.buffer)
  view.setUint32(4, 10, true)
  view.setUint32(8, width, true)
  view.setUint32(12, height, true)
  for (let index = 0; index < width * height; index += 1) {
    const offset = 16 + index * 3
    view.setUint16(offset, 100 + index, true)
    view.setUint8(offset + 2, index + 1)
  }
  view.setUint32(gatewayOffset, 1, true)
  view.setUint32(gatewayOffset + 4, 1, true)
  bytes.set([0, 0, 2, 0], gatewayOffset + 8)
  bytes.set([0xde, 0xad, 0xbe], gatewayOffset + 12)
  return bytes
}

function artifactSource(bytes: Uint8Array): ArtifactByteSource {
  const snapshot = bytes.slice()
  return Object.freeze({
    kind: 'bytes',
    ref: SOURCE,
    revision: revisionId(`content-hash.${digest(snapshot)}`),
    size: BigInt(snapshot.byteLength),
    async read(offset: bigint, length: number, signal?: AbortSignal) {
      signal?.throwIfAborted()
      const start = Number(offset)
      if (!Number.isSafeInteger(start) || start < 0 || length < 0) {
        throw new RangeError('invalid memory source range')
      }
      return snapshot.slice(start, Math.min(snapshot.byteLength, start + length))
    },
    async *stream(range, signal) {
      signal?.throwIfAborted()
      const start = Number(range?.offset ?? 0n)
      const end = Number(
        range?.length === undefined
          ? BigInt(snapshot.byteLength)
          : (range?.offset ?? 0n) + range.length,
      )
      yield snapshot.slice(start, Math.min(snapshot.byteLength, end))
    },
  })
}

class MemoryMapBackend implements EditingBackend {
  readonly profile = Object.freeze({
    backendId: 'warzone-game-map-memory-atomic',
    guarantees: ['atomic', 'transactional', 'recoverable', 'best-effort'] as const,
    supportsPrepare: true,
    supportsRollback: false,
    supportsJournal: false,
    supportsRename: false,
  })
  readonly writable = true

  constructor(readonly state: { bytes: Uint8Array }) {}

  async currentRevision(): Promise<AssetRevision> {
    return revision(this.state.bytes)
  }

  async apply(
    edit: SourceEdit,
    options: { expectedRevision: AssetRevision; payloads: PayloadStore },
  ): Promise<{ after: AssetRevision }> {
    if (
      canonicalJsonStringify(options.expectedRevision) !==
      canonicalJsonStringify(revision(this.state.bytes))
    ) {
      throw new Error('conditional memory write lost')
    }
    if (
      edit.operation !== 'replace' ||
      edit.range !== undefined ||
      edit.source.id !== SOURCE.id ||
      edit.payload.kind !== 'inline'
    ) {
      throw new TypeError('memory backend expected one complete inline replacement')
    }
    this.state.bytes = edit.payload.bytes.slice()
    return { after: revision(this.state.bytes) }
  }

  async applyBatch(
    requests: readonly { edit: SourceEdit; expectedRevision: AssetRevision }[],
    options: { transactionId: string; payloads: PayloadStore },
  ) {
    if (requests.length !== 1 || requests[0] === undefined) {
      throw new TypeError('memory backend expected one atomic game.map write')
    }
    const result = await this.apply(requests[0].edit, {
      expectedRevision: requests[0].expectedRevision,
      payloads: options.payloads,
    })
    return [{ targetId: requests[0].edit.targetId, ...result }]
  }
}

let cachedServices: ReturnType<typeof createNodeSubjectServices> | undefined
const services = () =>
  (cachedServices ??= (async () =>
    createNodeSubjectServices({
      topology,
      realms: { host: HOST, workers: WORKERS },
      extensions: [
        {
          ...(await loadExtensionDirectory(extensionRoot)),
          execution: { origin: 'linked', allowTrustedInProcess: false },
        },
      ],
      policy: workerBackendPolicy({ loadDeadlineMs: 15_000, defaultCallDeadlineMs: 30_000 }),
    }))())

afterAll(async () => {
  await (await cachedServices)?.dispose?.()
})

describe('Warzone game.map writer through the ordinary host workflow', () => {
  it('opens, resolves by format, uses provider evidence, commits and reopens', async () => {
    const state = { bytes: fixture() }
    const svc = await services()
    const opened = await svc.open({
      source: artifactSource(state.bytes),
      path: 'game.map',
      intent: 'full',
      grant: WRITE,
      budget,
    })
    if (opened.state !== 'opened') throw new Error(`game.map open failed: ${opened.reason}`)
    expect(opened.selected.contributionId).toBe('org.modkitx/warzone2100-map')

    const resolution = await resolveFormatWriter({
      services: svc,
      opened,
      grant: WRITE,
      budgets: budget,
    })
    const writer = resolution.writer
    if (writer === undefined) {
      const contribution = svc.inventory.extensions
        .flatMap(item => item.contributions)
        .find(item => item.manifest?.id === 'org.modkitx.opensource/warzone2100-map-semantic')
      throw new Error(
        `format writer did not resolve: ${JSON.stringify({
          resolution: resolution.diagnostics,
          activationEligible: contribution?.activationEligible,
          specState: contribution?.specState,
          diagnostics: contribution?.diagnostics,
        })}`,
      )
    }
    expect(resolution.diagnostics.map(item => item.code)).toContain(
      'x3.host/format-writer-selected',
    )
    expect(writer.identity.providerId).toBe('org.modkitx.opensource/warzone2100-map-semantic')
    expect(writer.offer.representationId).toBe('source')

    const evidence = serviceProviderFidelityEvidenceRecord(svc.inventory, {
      writer,
      offerId: 'warzone2100-game-map-source',
      acceptedOrigins: ['linked'],
    })
    if (evidence === undefined) throw new Error('writer evidence did not materialize')
    expect(evidence.writer).toEqual(writer.identity)
    expect(evidence.evidenceId).toBe('warzone2100-game-map-preserving-writer-v1')
    const registry = createEvidenceRegistry([evidence])
    const backend = new MemoryMapBackend(state)
    const editing = createSubjectEditing({
      opened,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: plan => registry.evidenceFor(plan),
      expectedWriter: writer.identity,
      expectedEvidenceContext: {
        optionsFingerprint: 'options:unchanged-complete-game-map-v1',
        inputClass: 'warzone-game-map-v10-complete',
      },
      writer,
    })
    if (editing.session === undefined) throw new Error('writer session is unavailable')
    const target = editing.targets[0]
    if (target === undefined) throw new Error('game.map has no content target')
    const sourceDigest = digest(state.bytes)
    const change: ChangeSet = {
      targets: editing.targets,
      edits: [
        {
          operation: 'replace',
          targetId: target.targetId,
          source: target.ownerSource,
          payload: { kind: 'inline', bytes: state.bytes },
        },
      ],
      semanticIntent: {
        kind: WARZONE_GAME_MAP_WRITE_INTENT.kind,
        sourceComplete: true,
        sourceContentDigest: sourceDigest,
        unknownDataPolicy: WARZONE_GAME_MAP_WRITE_INTENT.unknownDataPolicy,
        updates: [{ kind: 'set-tile-v1', index: 1, texture: 0xabcd, height: 200 }],
      },
      provenance: { actor: 'user', note: 'ordinary host game.map workflow proof' },
    }
    expect(await editing.session.propose(change)).toEqual({ valid: true, diagnostics: [] })
    const plan = await editing.session.plan(change)
    const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
    expect(prepared.state).toBe('ready')
    if (prepared.state !== 'ready') return
    const committed = await editing.coordinator.commit(prepared.prepared, {
      grant: editing.grantSnapshot,
    })
    expect(committed.state).toBe('committed')
    if (committed.state !== 'committed') return
    expect(committed.receipt.fidelity.evidenceId).toBe('warzone2100-game-map-preserving-writer-v1')
    expect(parseWarzoneGameMap(state.bytes, budget).tiles[1]).toMatchObject({
      texture: 0xabcd,
      height: 200,
    })
    await opened.session.dispose()

    const reopened = await svc.open({
      source: artifactSource(state.bytes),
      path: 'game.map',
      intent: 'full',
      grant: WRITE,
      budget,
    })
    if (reopened.state !== 'opened') throw new Error(`edited game.map did not reopen`)
    expect(reopened.selected.contributionId).toBe('org.modkitx/warzone2100-map')
    const validation = await reopened.session.operations().invoke('validate', {})
    expect(validation.state).toBe('ok')
    await reopened.session.dispose()
    await resolution.release?.()
  }, 60_000)
})
