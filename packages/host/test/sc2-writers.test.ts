import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import {
  createHostTopology,
  revisionId,
  type ChangeSet,
  type FidelityEvidence,
  type PayloadStore,
  type PermissionGrant,
  type SubjectEditTarget,
  type Writer,
} from '@modkitx-x3/sdk'
import {
  artifactNamespaceSourceFromVfsMount,
  createHostServiceResolver,
  createSubjectEditing,
  openSubject,
  type ExtensionInput,
  type OpenedSubject,
} from '@modkitx-x3/host'
import {
  createFileEditingBackend,
  createNodeSubjectServices,
  loadExtensionDirectory,
  nodeRuntimeTargetBase,
  nodeWorkerLinks,
  nodeWorkerRealmProfile,
  openFileArtifactSource,
  workerBackendPolicy,
  type NodeSubjectServices,
} from '@modkitx-x3/host/node'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const extensionRoot = join(repoRoot, 'extensions', 'blizzard', 'starcraft2')
const workspaceWriterUrl = pathToFileURL(
  join(extensionRoot, 'src', 'editing', 'workspace-copy-writer.js'),
).href

const HOST = 'org.example.app/sc2-writer-host'
const WORKERS = 'org.example.app/sc2-writer-workers'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.example.app/sc2-writers',
  realms: [
    {
      schemaVersion: 1,
      realmId: HOST,
      revision: '1',
      target: nodeRuntimeTargetBase(),
      facilities: ['filesystem.read-random', 'filesystem.atomic-replace', 'worker.module'],
      budgets: {
        maxConcurrentTasks: 4,
        maxWorkerCount: 2,
        maxResidentBytes: uint64('1073741824'),
        maxTransferBytes: uint64('268435456'),
        defaultDeadlineMs: 60_000,
      },
      policy: { id: 'org.example.policy/sc2-writers', revision: '1' },
    },
    nodeWorkerRealmProfile({
      realmId: WORKERS,
      budgets: {
        maxConcurrentTasks: 2,
        maxWorkerCount: 0,
        maxResidentBytes: uint64('536870912'),
        maxTransferBytes: uint64('134217728'),
        defaultDeadlineMs: 60_000,
      },
      policy: { id: 'org.example.policy/sc2-writers-worker', revision: '1' },
    }),
  ],
  links: [...nodeWorkerLinks(HOST, WORKERS)],
})

const policy = workerBackendPolicy({ loadDeadlineMs: 15_000, defaultCallDeadlineMs: 15_000 })
const budget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 64,
  maxNodes: 10_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const WRITE: PermissionGrant = {
  id: 'sc2-writer-grant',
  classes: ['read-source', 'write-source'],
}
const scratch = mkdtempSync(join(tmpdir(), 'x3-sc2-writers-'))

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const linked = async (directory: string): Promise<ExtensionInput> => ({
  ...(await loadExtensionDirectory(directory)),
  execution: { origin: 'linked', allowTrustedInProcess: false },
})

let cached: Promise<NodeSubjectServices> | undefined
const services = () =>
  (cached ??= (async () =>
    createNodeSubjectServices({
      topology,
      realms: { host: HOST, workers: WORKERS },
      extensions: [await linked(extensionRoot)],
      policy,
    }))())

async function resolver() {
  const value = await services()
  if (value.serviceDefinitions === undefined) throw new Error('no service definitions')
  return createHostServiceResolver({
    inventory: value.inventory,
    target: value.target,
    executionBackends: value.executionBackends,
    definitions: value.serviceDefinitions,
    grant: WRITE,
    budgets: budget,
  })
}

async function openCopy(
  name: string,
  text?: string,
): Promise<{ path: string; opened: OpenedSubject }> {
  const path = join(scratch, name)
  if (text !== undefined) writeFileSync(path, text, 'utf8')
  const opened = await (
    await services()
  ).open({
    source: await openFileArtifactSource(path),
    path,
    intent: 'full',
    grant: WRITE,
    budget,
  })
  if (opened.state !== 'opened') throw new Error(`open failed for ${name}: ${opened.reason}`)
  return { path, opened }
}

function evidence(writer: Writer, source: string, inputClass?: string): FidelityEvidence {
  return {
    roundTrip: 'byte-identical',
    preservesUnknownData: true,
    evidenceId: writer.offer.fidelityEvidenceId,
    corpusId: `modkitX3/packages/host/test/sc2-writers:${writer.identity.formatId}`,
    corpusDigest: `sha256:${createHash('sha256').update(source).digest('hex')}`,
    conformanceProfile: 'common.edit/writer-v1' as never,
    writer: writer.identity,
    optionsFingerprint: 'complete-snapshot-v1',
    inputClass: inputClass ?? `${writer.identity.formatId}-utf8`,
    provenAt: '2026-08-27T00:00:00Z',
  }
}

const show = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? String(item) : item))

interface WriterCase {
  readonly formatId: string
  readonly codecId: string
  readonly file: string
  readonly source: string
  readonly find: string
  readonly replacement: string
  readonly originalSignaturePresent?: false
}

const CASES: readonly WriterCase[] = [
  {
    formatId: 'galaxy',
    codecId: 'org.modkitx/galaxy',
    file: 'WriterProof.galaxy',
    source: '// opaque-directive stays byte-identical\r\nvoid Before() {\r\n}\r\n',
    find: 'Before',
    replacement: 'After',
  },
  {
    formatId: 'sc2-strings',
    codecId: 'org.modkitx/sc2-strings',
    file: 'GameStrings.txt',
    source: '# opaque-comment stays byte-identical\r\nUI/Title=Before\r\n',
    find: 'Before',
    replacement: 'After',
  },
  {
    formatId: 'sc2-layout',
    codecId: 'org.modkitx/sc2-layout',
    file: 'WriterProof.SC2Layout',
    source:
      '<?xml version="1.0"?>\r\n<Desc><!--opaque--><Unknown payload="keep"/><Frame name="Before" type="Frame"/></Desc>\r\n',
    find: 'Before',
    replacement: 'After',
  },
  {
    formatId: 'sc2-data',
    codecId: 'org.modkitx/sc2-data',
    file: 'UnitData.xml',
    source:
      '<?xml version="1.0"?>\r\n<Catalog><!--opaque--><CUnit id="Before"><Unknown value="keep"/></CUnit></Catalog>\r\n',
    find: 'Before',
    replacement: 'After',
  },
  {
    formatId: 'sc2-triggers',
    codecId: 'org.modkitx/sc2-triggers',
    file: 'Triggers',
    source:
      '<TriggerData><!--opaque--><Library Id="DEMO"/><Element Id="Before" Type="Trigger"><Unknown/></Element></TriggerData>\r\n',
    find: 'Before',
    replacement: 'After',
  },
  {
    formatId: 'sc2-bank',
    codecId: 'org.modkitx/sc2-bank',
    file: 'WriterProof.SC2Bank',
    source:
      '<Bank version="1"><!--opaque--><Section name="Progress"><Key name="Name"><Value string="Before"/></Key></Section></Bank>\r\n',
    find: 'Before',
    replacement: 'After',
    originalSignaturePresent: false,
  },
]

function completeSnapshotChange(
  testCase: WriterCase,
  targets: readonly SubjectEditTarget[],
  next: string,
): ChangeSet {
  const target = targets[0]
  if (target === undefined) throw new Error('no edit target')
  return {
    targets,
    edits: [
      {
        operation: 'replace',
        targetId: target.targetId,
        source: target.ownerSource,
        payload: { kind: 'text', text: next },
      },
    ],
    semanticIntent: {
      kind: 'sc2-authored-text-save-v1',
      formatId: testCase.formatId,
      sourceComplete: true,
      unknownDataPolicy: 'preserve-from-complete-snapshot',
      ...(testCase.originalSignaturePresent === undefined
        ? {}
        : { originalSignaturePresent: testCase.originalSignaturePresent }),
    },
    provenance: { actor: 'user', note: 'SC2 writer round-trip proof' },
  }
}

describe('Block 15E SC2 authored text writers', () => {
  for (const testCase of CASES) {
    it(`${testCase.formatId}: resolves writer, commits, reopens, compares and rolls back`, async () => {
      const { path, opened } = await openCopy(testCase.file, testCase.source)
      expect(opened.selected.contributionId).toBe(testCase.codecId)

      const port = await resolver()
      const lease = await port.port.resolve({
        contract: 'common.edit/writer',
        major: 1,
        facet: {
          formatId: testCase.formatId,
          representationId: 'source',
          mutationMode: 'mutate',
          minimumRoundTrip: 'byte-identical',
        },
      })
      const writer = lease.value as Writer
      expect(writer.offer).toMatchObject({
        providerId: 'org.modkitx.blizzard/sc2-authored-text-writers',
        formatId: testCase.formatId,
        representationId: 'source',
        minimumRoundTrip: 'byte-identical',
      })

      const backend = createFileEditingBackend({ roots: [scratch] })
      const editing = createSubjectEditing({
        opened,
        grant: WRITE,
        backendFor: () => backend,
        evidenceFor: () => evidence(writer, testCase.source),
        expectedWriter: writer.identity,
        writer,
      })
      if (editing.session === undefined) throw new Error('no edit session')
      const next = testCase.source.replace(testCase.find, testCase.replacement)
      const change = completeSnapshotChange(testCase, editing.targets, next)
      expect(await editing.session.propose(change)).toEqual({ valid: true, diagnostics: [] })
      const plan = await editing.session.plan(change)
      expect(plan.fidelity).toMatchObject({
        roundTrip: 'byte-identical',
        preservesUnknownData: true,
      })
      const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
      expect(prepared.state, show(prepared)).toBe('ready')
      if (prepared.state !== 'ready') return
      const committed = await editing.coordinator.commit(prepared.prepared, {
        grant: editing.grantSnapshot,
      })
      expect(committed.state, show(committed)).toBe('committed')
      if (committed.state !== 'committed') return
      expect(committed.receipt).toMatchObject({
        mutationMode: 'mutate',
        commitGuarantee: 'atomic',
        fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
      })
      expect(readFileSync(path, 'utf8')).toBe(next)
      expect(readFileSync(path, 'utf8')).toContain('opaque')

      await opened.session.dispose()
      const { opened: reopened } = await openCopy(testCase.file)
      expect(reopened.selected.contributionId).toBe(testCase.codecId)
      const inspected = await reopened.session.operations().invoke('inspect', {})
      expect(inspected.state, show(inspected)).toBe('ok')
      if (inspected.state === 'ok' && inspected.output.kind === 'json') {
        expect(inspected.output.value).toMatchObject({ format: testCase.formatId })
      }
      await reopened.session.dispose()

      const undone = await editing.coordinator.undo(committed.receipt.transactionId, {
        grant: editing.grantSnapshot,
      })
      expect(undone.state, show(undone)).toBe('committed')
      expect(readFileSync(path, 'utf8')).toBe(testCase.source)

      await lease.release()
      await port.release()
      await backend.dispose()
    }, 60_000)
  }

  it('fails before write on malformed/truncated text, bounded-editor saves, signed banks and cancellation', async () => {
    const testCase = CASES.find(item => item.formatId === 'sc2-bank') as WriterCase
    const { opened } = await openCopy(testCase.file, testCase.source)
    const port = await resolver()
    const lease = await port.port.resolve({
      contract: 'common.edit/writer',
      major: 1,
      facet: {
        formatId: 'sc2-bank',
        representationId: 'source',
        mutationMode: 'mutate',
        minimumRoundTrip: 'byte-identical',
      },
    })
    const writer = lease.value as Writer
    const backend = createFileEditingBackend({ roots: [scratch] })
    const editing = createSubjectEditing({
      opened,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: () => evidence(writer, testCase.source),
      writer,
    })
    if (editing.session === undefined) throw new Error('no edit session')

    const malformed = completeSnapshotChange(testCase, editing.targets, '<Bank><Section></Bank>')
    expect((await editing.session.propose(malformed)).diagnostics[0]?.code).toBe(
      'org.modkitx.blizzard/sc2-writer-source-invalid',
    )
    const signed = completeSnapshotChange(
      { ...testCase, originalSignaturePresent: false },
      editing.targets,
      '<Bank version="1"><Signature value="not-valid-after-edit"/></Bank>',
    )
    expect((await editing.session.propose(signed)).diagnostics[0]?.message).toMatch(/signed/u)
    const { originalSignaturePresent: _signature, ...signatureUnknownCase } = testCase
    void _signature
    const signatureUnknown = completeSnapshotChange(
      signatureUnknownCase,
      editing.targets,
      '<Bank version="1"/>',
    )
    expect((await editing.session.propose(signatureUnknown)).diagnostics[0]?.code).toBe(
      'org.modkitx.blizzard/sc2-bank-signature-unsupported',
    )
    const target = editing.targets[0] as SubjectEditTarget
    const bounded: ChangeSet = {
      targets: editing.targets,
      edits: [
        {
          operation: 'replace',
          targetId: target.targetId,
          source: target.ownerSource,
          range: { kind: 'bytes', offset: 0n, length: 1n },
          payload: { kind: 'inline', bytes: new Uint8Array([0x3c]) },
        },
      ],
      provenance: { actor: 'user' },
    }
    expect((await editing.session.propose(bounded)).diagnostics[0]?.code).toBe(
      'org.modkitx.blizzard/sc2-writer-edit-shape-unsupported',
    )
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(writer.validate(malformed, cancelled.signal)).rejects.toMatchObject({
      name: 'OperationCancelledError',
    })
    expect(readFileSync(join(scratch, testCase.file), 'utf8')).toBe(testCase.source)

    await opened.session.dispose()
    await lease.release()
    await port.release()
    await backend.dispose()
  }, 60_000)

  it('detects a stale write between prepare and commit without touching the concurrent bytes', async () => {
    const testCase = CASES[0] as WriterCase
    const { path, opened } = await openCopy('Stale.galaxy', testCase.source)
    const port = await resolver()
    const lease = await port.port.resolve({
      contract: 'common.edit/writer',
      major: 1,
      facet: {
        formatId: 'galaxy',
        representationId: 'source',
        mutationMode: 'mutate',
        minimumRoundTrip: 'byte-identical',
      },
    })
    const writer = lease.value as Writer
    const backend = createFileEditingBackend({ roots: [scratch] })
    const editing = createSubjectEditing({
      opened,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: () => evidence(writer, testCase.source),
      writer,
    })
    if (editing.session === undefined) throw new Error('no edit session')
    const change = completeSnapshotChange(
      testCase,
      editing.targets,
      testCase.source.replace('Before', 'Mine'),
    )
    const plan = await editing.session.plan(change)
    const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
    expect(prepared.state).toBe('ready')
    if (prepared.state !== 'ready') return
    writeFileSync(path, testCase.source.replace('Before', 'Concurrent'), 'utf8')
    const result = await editing.coordinator.commit(prepared.prepared, {
      grant: editing.grantSnapshot,
    })
    expect(result).toMatchObject({ state: 'not-applied', reason: 'stale-revision' })
    expect(readFileSync(path, 'utf8')).toContain('Concurrent')

    await opened.session.dispose()
    await lease.release()
    await port.release()
    await backend.dispose()
  }, 60_000)
})

async function namespaceTarget(directory: string) {
  const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
  const mount = await vfs.openMount(pathToFileURL(directory).href)
  const value = await services()
  const uri = pathToFileURL(directory).href
  const opened = await openSubject({
    inventory: value.inventory,
    source: artifactNamespaceSourceFromVfsMount(mount, { ref: { id: uri, uri } }),
    path: directory,
    intent: 'full',
    target: value.target,
    grant: WRITE,
    budget,
    executionBackends: value.executionBackends,
  })
  if (opened.state !== 'unresolved')
    throw new Error(`expected unresolved namespace, got ${opened.state}`)
  return { opened, vfs, mount }
}

describe('Block 15E SC2 workspace-copy export', () => {
  it('rolls back owned nested paths on batch failure and never removes preexisting or concurrent data', async () => {
    const directory = join(scratch, 'copy-backend-atomicity')
    mkdirSync(join(directory, 'preexisting'), { recursive: true })
    writeFileSync(join(directory, 'preexisting', 'keep.bin'), new Uint8Array([7]))
    writeFileSync(join(directory, 'taken.bin'), new Uint8Array([9]))
    const { opened, mount } = await namespaceTarget(directory)
    const port = await resolver()
    const lease = await port.port.resolve({
      contract: 'common.edit/writer',
      major: 1,
      facet: {
        formatId: 'sc2-workspace-copy',
        representationId: 'namespace',
        mutationMode: 'export-only',
        minimumRoundTrip: 'byte-identical',
      },
    })
    const writer = lease.value as Writer
    const backend = createFileEditingBackend({ roots: [directory] })
    const editing = createSubjectEditing({
      opened,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: () => evidence(writer, 'backend-atomicity'),
      writer,
    })
    const target = editing.targets[0]
    if (target === undefined || backend.applyBatch === undefined) throw new Error('no batch target')
    const create = (newPath: string, byte: number) => ({
      operation: 'create' as const,
      targetId: target.targetId,
      source: target.ownerSource,
      newPath,
      payload: { kind: 'inline' as const, bytes: new Uint8Array([byte]) },
    })
    const locallyFailing = create(`failure-owned/${'x'.repeat(300)}.bin`, 0)
    await expect(
      backend.apply(locallyFailing, {
        transactionId: 'sc2-local-create-failure',
        payloads: {
          async open() {
            throw new Error('inline payload expected')
          },
        },
        expectedRevision: target.expectedRevision,
      }),
    ).rejects.toThrow()
    expect(readdirSync(directory).sort()).toEqual(['preexisting', 'taken.bin'])
    const refreshedRevision = await backend.currentRevision(target)

    const first = create('preexisting/ours.bin', 1)
    const second = create('owned/nested/first.bin', 2)
    const failing = create('taken.bin', 3)
    await expect(
      backend.applyBatch(
        [first, second, failing].map(edit => ({
          edit,
          expectedRevision: refreshedRevision,
        })),
        {
          transactionId: 'sc2-batch-failure',
          payloads: {
            async open() {
              throw new Error('inline payload expected')
            },
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'EEXIST' })
    expect(readdirSync(directory).sort()).toEqual(['preexisting', 'taken.bin'])
    expect(readdirSync(join(directory, 'preexisting'))).toEqual(['keep.bin'])
    expect([...readFileSync(join(directory, 'preexisting', 'keep.bin'))]).toEqual([7])
    expect([...readFileSync(join(directory, 'taken.bin'))]).toEqual([9])

    // The coordinator treats a thrown atomic batch as not applied. A defensive repeated rollback
    // must therefore be harmless and must not expand the backend's ownership.
    await backend.rollback?.('sc2-batch-failure', second, refreshedRevision)
    await backend.rollback?.('sc2-batch-failure', first, refreshedRevision)
    expect(readdirSync(directory).sort()).toEqual(['preexisting', 'taken.bin'])

    await backend.dispose()
    await lease.release()
    await port.release()
    await mount.dispose()
  }, 60_000)

  it('records only the winner of a concurrent parent mkdir and relinquishes it when foreign data appears', async () => {
    const directory = join(scratch, 'copy-backend-race')
    mkdirSync(directory)
    const { opened, mount } = await namespaceTarget(directory)
    const port = await resolver()
    const lease = await port.port.resolve({
      contract: 'common.edit/writer',
      major: 1,
      facet: {
        formatId: 'sc2-workspace-copy',
        representationId: 'namespace',
        mutationMode: 'export-only',
        minimumRoundTrip: 'byte-identical',
      },
    })
    const writer = lease.value as Writer
    const backend = createFileEditingBackend({ roots: [directory] })
    const editing = createSubjectEditing({
      opened,
      grant: WRITE,
      backendFor: () => backend,
      evidenceFor: () => evidence(writer, 'backend-race'),
      writer,
    })
    const target = editing.targets[0]
    if (target === undefined) throw new Error('no namespace target')
    let waiting = 0
    let releaseBarrier: (() => void) | undefined
    const barrier = new Promise<void>(resolveBarrier => {
      releaseBarrier = resolveBarrier
    })
    const payloads: PayloadStore = {
      async open() {
        waiting += 1
        if (waiting === 2) releaseBarrier?.()
        await barrier
        return {
          value: {
            async read() {
              return { complete: true as const, bytes: new Uint8Array([waiting]) }
            },
          },
          async release() {
            return undefined
          },
        }
      },
    }
    const create = (handleId: string) => ({
      operation: 'create' as const,
      targetId: target.targetId,
      source: target.ownerSource,
      newPath: `race/${handleId}.bin`,
      payload: {
        kind: 'staged' as const,
        ref: {
          storeId: 'race',
          handleId,
          digest: `sha256:${handleId}`,
          bytes: 1n,
          replayable: true as const,
        },
      },
    })
    const left = create('left')
    const right = create('right')
    await Promise.all([
      backend.apply(left, {
        transactionId: 'race-left',
        payloads,
        expectedRevision: target.expectedRevision,
      }),
      backend.apply(right, {
        transactionId: 'race-right',
        payloads,
        expectedRevision: target.expectedRevision,
      }),
    ])
    writeFileSync(join(directory, 'race', 'foreign.bin'), new Uint8Array([99]))
    await backend.rollback?.('race-left', left, target.expectedRevision)
    await backend.rollback?.('race-right', right, target.expectedRevision)
    expect(readdirSync(join(directory, 'race'))).toEqual(['foreign.bin'])
    expect([...readFileSync(join(directory, 'race', 'foreign.bin'))]).toEqual([99])

    await backend.dispose()
    await lease.release()
    await port.release()
    await mount.dispose()
  }, 60_000)

  it('copies Map/Mod/Campaign snapshots byte-for-byte, reopens authored XML, and rolls back', async () => {
    const module = (await import(workspaceWriterUrl)) as {
      snapshotSc2WorkspaceCopy(options: unknown): Promise<ChangeSet>
    }
    const sourceEntries = new Map<string, Uint8Array>([
      [
        'GameData/UnitData.xml',
        new TextEncoder().encode('<Catalog><CUnit id="Marine"/></Catalog>'),
      ],
      [
        'UI/Layout/Proof.SC2Layout',
        new TextEncoder().encode('<Desc><Unknown value="opaque"/></Desc>'),
      ],
      ['Opaque.bin', new Uint8Array([0, 255, 3, 9])],
    ])
    for (const documentKind of ['SC2Map', 'SC2Mod', 'SC2Campaign'] as const) {
      const directory = join(scratch, `copy-${documentKind}`)
      mkdirSync(directory)
      const { opened, mount } = await namespaceTarget(directory)
      const port = await resolver()
      const lease = await port.port.resolve({
        contract: 'common.edit/writer',
        major: 1,
        facet: {
          formatId: 'sc2-workspace-copy',
          representationId: 'namespace',
          mutationMode: 'export-only',
          minimumRoundTrip: 'byte-identical',
        },
      })
      const writer = lease.value as Writer
      const backend = createFileEditingBackend({ roots: [directory] })
      const editing = createSubjectEditing({
        opened,
        grant: WRITE,
        backendFor: () => backend,
        evidenceFor: () => evidence(writer, documentKind, `${documentKind}-loose-workspace`),
        expectedWriter: writer.identity,
        writer,
      })
      const target = editing.targets[0]
      if (target === undefined) throw new Error('no namespace edit target')
      const prefix = `Proof.${documentKind}`
      const sorted = [...sourceEntries].sort(([left], [right]) => (left < right ? -1 : 1))
      const change = await module.snapshotSc2WorkspaceCopy({
        source: {
          revision: revisionId(`provider-token:${documentKind}-source`),
          async list(requestPrefix: string, page: { cursor?: string; limit: number }) {
            const from = page.cursor === undefined ? 0 : Number(page.cursor)
            const items = sorted.slice(from, from + page.limit).map(([path, bytes]) => ({
              id: `${prefix}/${path}`,
              path: `${prefix}/${path}`,
              kind: 'file',
              size: BigInt(bytes.byteLength),
              revision: revisionId(
                `provider-token:${createHash('sha256').update(`${documentKind}:${path}`).digest('hex')}`,
              ),
            }))
            return {
              items,
              ...(from + items.length < sorted.length
                ? { nextCursor: String(from + items.length) }
                : {}),
            }
          },
          async read(path: string) {
            const relative = path.slice(prefix.length + 1)
            const bytes = sourceEntries.get(relative)
            if (bytes === undefined) throw new Error(`missing ${relative}`)
            return bytes
          },
        },
        sourcePrefix: prefix,
        sourceMode: 'loose-workspace',
        documentKind,
        target,
        pageLimit: 2,
      })
      expect(await writer.validate(change)).toEqual({ valid: true, diagnostics: [] })
      const plan = await writer.plan(change)
      expect(plan).toMatchObject({
        semantics: { mutationMode: 'export-only', minimumGuarantee: 'recoverable' },
        fidelity: { roundTrip: 'byte-identical', preservesUnknownData: true },
      })
      const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
      expect(prepared.state, show(prepared)).toBe('ready')
      if (prepared.state !== 'ready') continue
      const committed = await editing.coordinator.commit(prepared.prepared, {
        grant: editing.grantSnapshot,
      })
      expect(committed.state, show(committed)).toBe('committed')
      if (committed.state !== 'committed') continue
      expect([...readFileSync(join(directory, 'Opaque.bin'))]).toEqual([
        ...(sourceEntries.get('Opaque.bin') as Uint8Array),
      ])
      expect([...readFileSync(join(directory, 'GameData', 'UnitData.xml'))]).toEqual([
        ...(sourceEntries.get('GameData/UnitData.xml') as Uint8Array),
      ])
      const reopened = await openCopy(
        `copy-${documentKind}-UnitData.xml`,
        readFileSync(join(directory, 'GameData', 'UnitData.xml'), 'utf8'),
      )
      expect(reopened.opened.selected.contributionId).toBe('org.modkitx/sc2-data')
      await reopened.opened.session.dispose()

      const undone = await editing.coordinator.undo(committed.receipt.transactionId, {
        grant: editing.grantSnapshot,
      })
      expect(undone.state, show(undone)).toBe('committed')
      expect(readdirSync(directory)).toEqual([])

      await lease.release()
      await port.release()
      await backend.dispose()
      await mount.dispose()
    }
  }, 120_000)

  it('refuses traversal, duplicate/repeated pages, budgets, cancellation and every native MPQ claim before write', async () => {
    const module = (await import(workspaceWriterUrl)) as {
      SC2_NATIVE_REPACK_UNSUPPORTED: string
      snapshotSc2WorkspaceCopy(options: unknown): Promise<ChangeSet>
    }
    const directory = join(scratch, 'copy-refusals')
    mkdirSync(directory)
    const { opened, mount } = await namespaceTarget(directory)
    const port = await resolver()
    const lease = await port.port.resolve({
      contract: 'common.edit/writer',
      major: 1,
      facet: {
        formatId: 'sc2-workspace-copy',
        representationId: 'namespace',
        mutationMode: 'export-only',
        minimumRoundTrip: 'byte-identical',
      },
    })
    const writer = lease.value as Writer
    const target = createSubjectEditing({
      opened,
      grant: WRITE,
      backendFor: () => createFileEditingBackend({ roots: [directory] }),
      evidenceFor: () => evidence(writer, 'refusal'),
      writer,
    }).targets[0] as SubjectEditTarget
    const baseSource = {
      revision: revisionId('provider-token:hostile'),
      async list() {
        return {
          items: [
            {
              id: 'bad',
              path: 'Bad.SC2Map/../escape.bin',
              kind: 'file',
              size: 1n,
              revision: revisionId('provider-token:bad'),
            },
          ],
        }
      },
      async read() {
        return new Uint8Array([1])
      },
    }
    await expect(
      module.snapshotSc2WorkspaceCopy({
        source: baseSource,
        sourcePrefix: 'Bad.SC2Map',
        sourceMode: 'loose-workspace',
        documentKind: 'SC2Map',
        target,
      }),
    ).rejects.toThrow(/traversal/u)
    await expect(
      module.snapshotSc2WorkspaceCopy({
        source: baseSource,
        sourcePrefix: 'Bad.SC2Map',
        sourceMode: 'native-mpq',
        documentKind: 'SC2Map',
        target,
      }),
    ).rejects.toThrow(module.SC2_NATIVE_REPACK_UNSUPPORTED)
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(
      module.snapshotSc2WorkspaceCopy({
        source: baseSource,
        sourcePrefix: 'Bad.SC2Map',
        sourceMode: 'loose-workspace',
        documentKind: 'SC2Map',
        target,
        signal: cancelled.signal,
      }),
    ).rejects.toThrow(/cancel/u)

    const validItem = {
      id: 'valid',
      path: 'Bad.SC2Map/valid.bin',
      kind: 'file',
      size: 2n,
      revision: revisionId('provider-token:valid'),
    }
    await expect(
      module.snapshotSc2WorkspaceCopy({
        source: {
          ...baseSource,
          async list() {
            return { items: [validItem, validItem] }
          },
        },
        sourcePrefix: 'Bad.SC2Map',
        sourceMode: 'loose-workspace',
        documentKind: 'SC2Map',
        target,
      }),
    ).rejects.toThrow(/duplicate/u)
    let pages = 0
    await expect(
      module.snapshotSc2WorkspaceCopy({
        source: {
          ...baseSource,
          async list() {
            pages += 1
            return pages === 1
              ? { items: [validItem], nextCursor: 'repeat' }
              : { items: [], nextCursor: 'repeat' }
          },
        },
        sourcePrefix: 'Bad.SC2Map',
        sourceMode: 'loose-workspace',
        documentKind: 'SC2Map',
        target,
      }),
    ).rejects.toThrow(/repeated.*cursor/u)
    await expect(
      module.snapshotSc2WorkspaceCopy({
        source: {
          ...baseSource,
          async list() {
            return { items: [validItem] }
          },
          async read() {
            return new Uint8Array([1, 2])
          },
        },
        sourcePrefix: 'Bad.SC2Map',
        sourceMode: 'loose-workspace',
        documentKind: 'SC2Map',
        target,
        maxEntryBytes: 1,
      }),
    ).rejects.toThrow(/maxEntryBytes/u)

    const nativeChange: ChangeSet = {
      targets: [target],
      edits: [],
      semanticIntent: {
        kind: 'sc2-workspace-copy-export-v1',
        documentKind: 'SC2Map',
        sourceMode: 'native-mpq',
        completeSnapshot: true,
        unknownDataPolicy: 'copy-every-entry-byte-for-byte',
        entryCount: 0,
        encrypted: true,
        highOffset: true,
        patchEntries: true,
        unknownNativeFeatures: ['version-4-table'],
      },
      provenance: { actor: 'user' },
    }
    const refused = await writer.validate(nativeChange)
    expect(refused.valid).toBe(false)
    expect(refused.diagnostics[0]?.code).toBe(module.SC2_NATIVE_REPACK_UNSUPPORTED)
    const nativeIntent = nativeChange.semanticIntent as Readonly<
      Record<string, string | boolean | number | readonly string[]>
    >
    for (const [feature, message] of [
      ['encrypted', /encrypted/u],
      ['highOffset', /high-offset/u],
      ['patchEntries', /patch entries/u],
    ] as const) {
      const result = await writer.validate({
        ...nativeChange,
        semanticIntent: {
          ...nativeIntent,
          sourceMode: 'loose-workspace',
          encrypted: false,
          highOffset: false,
          patchEntries: false,
          [feature]: true,
        },
      })
      expect(result.valid).toBe(false)
      expect(result.diagnostics[0]?.message).toMatch(message)
    }
    const unknownFeature = await writer.validate({
      ...nativeChange,
      semanticIntent: {
        ...nativeIntent,
        sourceMode: 'loose-workspace',
        encrypted: false,
        highOffset: false,
        patchEntries: false,
        unknownNativeFeatures: ['version-4-table'],
      },
    })
    expect(unknownFeature.valid).toBe(false)
    expect(unknownFeature.diagnostics[0]?.message).toMatch(/version-4-table/u)
    expect(readdirSync(directory)).toEqual([])

    for (const formatId of ['sc2-map', 'sc2-mod', 'sc2-campaign']) {
      await expect(
        port.port.resolve({
          contract: 'common.edit/writer',
          major: 1,
          facet: {
            formatId,
            representationId: 'source',
            mutationMode: 'mutate',
            minimumRoundTrip: 'semantic',
          },
        }),
      ).rejects.toMatchObject({ code: 'x3.host/service-contract-unresolved' })
    }

    await lease.release()
    await port.release()
    await mount.dispose()
  }, 60_000)
})
