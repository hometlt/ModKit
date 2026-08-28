import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import {
  artifactNamespaceSourceFromVfsMount,
  createEvidenceRegistry,
  createHostServiceResolver,
  createSubjectEditing,
  openSubject,
  serviceProviderFidelityEvidenceRecord,
  type ExtensionInput,
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
} from '@modkitx-x3/host/node'
import { createHostTopology, type PermissionGrant, type Writer } from '@modkitx-x3/sdk'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'
import { encodeFreshMpq, snapshotNativePreservingMpq } from '../src/mpq/fresh-writer.js'

const extensionRoot = join(import.meta.dirname, '..')
const starcraft2ExtensionRoot = join(import.meta.dirname, '..', '..', 'starcraft2')
const scratch = mkdtempSync(join(tmpdir(), 'x3-native-mpq-'))
const HOST = 'org.example.app/native-mpq-host'
const WORKERS = 'org.example.app/native-mpq-workers'
const budget = {
  maxInputBytes: 16_777_216n,
  maxDepth: 64,
  maxNodes: 10_000,
  maxScalarBytes: 16_777_216,
  maxDiagnostics: 100,
}
const READ: PermissionGrant = { id: 'native-mpq-read', classes: ['read-source'] }
const WRITE: PermissionGrant = {
  id: 'native-mpq-write',
  classes: ['read-source', 'write-source'],
}
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.example.app/native-mpq',
  realms: [
    {
      schemaVersion: 1,
      realmId: HOST,
      revision: '1',
      target: nodeRuntimeTargetBase(),
      facilities: ['filesystem.read-random', 'filesystem.atomic-replace', 'worker.module'],
      budgets: {
        maxConcurrentTasks: 2,
        maxWorkerCount: 1,
        maxResidentBytes: uint64('536870912'),
        maxTransferBytes: uint64('67108864'),
        defaultDeadlineMs: 60_000,
      },
      policy: { id: 'org.example.policy/native-mpq', revision: '1' },
    },
    nodeWorkerRealmProfile({
      realmId: WORKERS,
      budgets: {
        maxConcurrentTasks: 1,
        maxWorkerCount: 0,
        maxResidentBytes: uint64('268435456'),
        maxTransferBytes: uint64('67108864'),
        defaultDeadlineMs: 60_000,
      },
      policy: { id: 'org.example.policy/native-mpq-worker', revision: '1' },
    }),
  ],
  links: [...nodeWorkerLinks(HOST, WORKERS)],
})
const explicitSc2Root = process.env.MODKITX_SC2_ROOT?.trim()
const installedSc2Root = explicitSc2Root || 'C:\\Apps\\StarCraft II'
const installedMapPath = join(installedSc2Root, 'Maps', 'ex', 'WTE70_Madlibrarian.SC2Map')
const EVIDENCE_ID = 'mpq-native-preserving-writer-v1'
const EVIDENCE_CORPUS = 'installed-starcraft-2:Maps/ex/WTE70_Madlibrarian.SC2Map'
const EVIDENCE_DIGEST = 'sha256:f654e212dcff3ffe3e1090e383b7b25fac4def2a723b4eda408c1b5cdfb2a305'
const EVIDENCE_OPTIONS = 'fixed-slot-native-save-as-v1'
const EVIDENCE_INPUT_CLASS = 'mpq-v0-v1-fixed-slot-complete-source-stored-or-single-unit-zlib'

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const linked = async (root = extensionRoot): Promise<ExtensionInput> => ({
  ...(await loadExtensionDirectory(root)),
  execution: { origin: 'linked', allowTrustedInProcess: false },
})

let cachedServices: ReturnType<typeof createNodeSubjectServices> | undefined
const subjectServices = () =>
  (cachedServices ??= (async () =>
    createNodeSubjectServices({
      topology,
      realms: { host: HOST, workers: WORKERS },
      extensions: [await linked()],
      policy: workerBackendPolicy({ loadDeadlineMs: 15_000, defaultCallDeadlineMs: 30_000 }),
    }))())

let cachedSc2Services: ReturnType<typeof createNodeSubjectServices> | undefined
const sc2SubjectServices = () =>
  (cachedSc2Services ??= (async () =>
    createNodeSubjectServices({
      topology,
      realms: { host: HOST, workers: WORKERS },
      extensions: [await linked(), await linked(starcraft2ExtensionRoot)],
      policy: workerBackendPolicy({ loadDeadlineMs: 15_000, defaultCallDeadlineMs: 30_000 }),
    }))())

describe('Block 15 native MPQ durable workflow', () => {
  it('resolves, validates, confines, atomically writes, reopens, compares and undoes', async () => {
    const source = encodeFreshMpq([
      { path: 'MapScript.galaxy', bytes: new TextEncoder().encode('void Before() {}\r\n') },
      { path: 'Opaque.bin', bytes: new Uint8Array([0, 255, 1, 2, 3, 254]) },
    ])
    const sourcePath = join(scratch, 'Original.SC2Map')
    writeFileSync(sourcePath, source)
    const destination = join(scratch, 'export')
    mkdirSync(destination)
    const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
    const mount = await vfs.openMount(pathToFileURL(destination).href)
    const services = await subjectServices()
    const destinationUri = pathToFileURL(destination).href
    const opened = await openSubject({
      inventory: services.inventory,
      source: artifactNamespaceSourceFromVfsMount(mount, {
        ref: { id: destinationUri, uri: destinationUri },
      }),
      path: destination,
      intent: 'full',
      target: services.target,
      grant: WRITE,
      executionBackends: services.executionBackends,
      budget,
    })
    if (opened.state !== 'unresolved') throw new Error(`unexpected target state ${opened.state}`)
    if (services.serviceDefinitions === undefined) throw new Error('no MPQ writer definitions')
    const port = createHostServiceResolver({
      inventory: services.inventory,
      target: services.target,
      executionBackends: services.executionBackends,
      definitions: services.serviceDefinitions,
      grant: WRITE,
      budgets: budget,
    })
    const writerLease = await port.port.resolve({
      contract: 'common.edit/writer',
      major: 1,
      facet: {
        formatId: 'mpq',
        representationId: 'native-source',
        mutationMode: 'export-only',
        minimumRoundTrip: 'semantic',
      },
    })
    const writer = writerLease.value as Writer
    const backend = createFileEditingBackend({ roots: [destination] })
    try {
      expect(writer.offer).toMatchObject({
        fidelityEvidenceId: 'mpq-native-preserving-writer-v1',
        representationId: 'native-source',
      })
      expect(writer.identity).toMatchObject({
        providerId: 'org.modkitx.blizzard/mpq-fresh-writer',
        providerVersion: expect.any(String),
        artifactDigest: expect.any(String),
        formatId: 'mpq',
        representationId: 'native-source',
      })
      const evidence = serviceProviderFidelityEvidenceRecord(services.inventory, {
        writer,
        offerId: 'mpq-native-preserving-v1',
        acceptedOrigins: ['linked'],
      })
      if (evidence === undefined) throw new Error('native MPQ writer evidence did not materialize')
      expect(evidence).toMatchObject({
        claim: { roundTrip: 'semantic', preservesUnknownData: true },
        evidenceId: EVIDENCE_ID,
        corpusId: EVIDENCE_CORPUS,
        corpusDigest: EVIDENCE_DIGEST,
        conformanceProfile: 'common.edit/writer-v1',
        writer: writer.identity,
        optionsFingerprint: EVIDENCE_OPTIONS,
        inputClass: EVIDENCE_INPUT_CLASS,
        provenAt: '2026-08-28T00:00:00Z',
      })
      const evidenceRegistry = createEvidenceRegistry([evidence])
      const editing = createSubjectEditing({
        opened,
        grant: WRITE,
        backendFor: () => backend,
        evidenceFor: plan => evidenceRegistry.evidenceFor(plan),
        expectedWriter: writer.identity,
        expectedEvidenceContext: {
          optionsFingerprint: EVIDENCE_OPTIONS,
          inputClass: EVIDENCE_INPUT_CLASS,
        },
        writer,
      })
      const target = editing.targets[0]
      if (target === undefined) throw new Error('no native MPQ destination target')
      const changed = new TextEncoder().encode('void After_() {}\r\n')
      const change = await snapshotNativePreservingMpq({
        sourceBytes: source,
        replacements: [{ path: 'MapScript.galaxy', bytes: changed }],
        target,
        archiveName: 'Changed.SC2Map',
      })
      expect(await writer.validate(change)).toEqual({ valid: true, diagnostics: [] })
      const plan = await writer.plan(change)
      const prepared = await editing.coordinator.prepare(plan, {
        grant: editing.grantSnapshot,
      })
      expect(prepared.state).toBe('ready')
      if (prepared.state !== 'ready') return
      const committed = await editing.coordinator.commit(prepared.prepared, {
        grant: editing.grantSnapshot,
      })
      expect(committed).toMatchObject({
        state: 'committed',
        receipt: {
          mutationMode: 'export-only',
          commitGuarantee: 'atomic',
          fidelity: {
            roundTrip: 'semantic',
            preservesUnknownData: true,
            evidenceId: EVIDENCE_ID,
            writer: writer.identity,
            optionsFingerprint: EVIDENCE_OPTIONS,
            inputClass: EVIDENCE_INPUT_CLASS,
          },
        },
      })
      if (committed.state !== 'committed') return

      expect([...readFileSync(sourcePath)]).toEqual([...source])
      const outputPath = join(destination, 'Changed.SC2Map')
      const reopened = await services.open({
        source: await openFileArtifactSource(outputPath),
        path: outputPath,
        intent: 'full',
        grant: READ,
        budget,
      })
      if (reopened.state !== 'opened') throw new Error(`native output did not reopen`)
      try {
        expect(reopened.selected.contributionId).toBe('org.modkitx/mpq')
        for (const [entryId, expected] of [
          ['MapScript.galaxy', changed],
          ['Opaque.bin', new Uint8Array([0, 255, 1, 2, 3, 254])],
        ] as const) {
          const extracted = await reopened.session.operations().invoke('extract-entry', { entryId })
          expect(extracted.state).toBe('ok')
          if (extracted.state === 'ok' && extracted.output.kind === 'bytes') {
            expect([...extracted.output.value]).toEqual([...expected])
          }
        }
      } finally {
        await reopened.session.dispose()
      }
      expect(
        await editing.coordinator.undo(committed.receipt.transactionId, {
          grant: editing.grantSnapshot,
        }),
      ).toMatchObject({ state: 'committed' })
      expect(() => readFileSync(outputPath)).toThrow()
    } finally {
      await backend.dispose()
      await writerLease.release()
      await port.release()
      await mount.dispose()
    }
  }, 60_000)

  it('runs the ordinary semantic Save As workflow on the installed WTE70 SC2Map', async () => {
    expect(
      existsSync(installedMapPath),
      `installed SC2 proof corpus is required at ${installedMapPath}`,
    ).toBe(true)
    const installedBytes = new Uint8Array(readFileSync(installedMapPath))
    const sourceDigest = createHash('sha256').update(installedBytes).digest('hex')
    expect(installedBytes.byteLength).toBe(22_703)
    expect(`sha256:${sourceDigest}`).toBe(EVIDENCE_DIGEST)

    const semanticServices = await sc2SubjectServices()
    const installed = await semanticServices.open({
      source: await openFileArtifactSource(installedMapPath),
      path: installedMapPath,
      intent: 'full',
      grant: READ,
      budget,
    })
    if (installed.state !== 'opened') throw new Error('installed SC2Map did not open semantically')
    let source: Uint8Array
    let beforeSummary: unknown
    try {
      expect(installed.selected.contributionId).toBe('org.modkitx/sc2-map')
      const inspected = await installed.session.operations().invoke('inspect', {})
      expect(inspected.state).toBe('ok')
      if (inspected.state !== 'ok' || inspected.output.kind !== 'json') {
        throw new Error('installed SC2Map inspection did not return JSON')
      }
      beforeSummary = inspected.output.value
      expect(beforeSummary).toMatchObject({
        format: 'sc2-map',
        mpqVersion: 1,
        entries: 32,
        mapDocuments: expect.arrayContaining(['mapinfo', 'objects', 't3terrain.xml']),
      })
      const exported = await installed.session.operations().invoke('export-raw', {})
      expect(exported.state).toBe('ok')
      if (exported.state !== 'ok' || exported.output.kind !== 'bytes') {
        throw new Error('installed SC2Map raw export did not return bytes')
      }
      source = exported.output.value
      expect([...source]).toEqual([...installedBytes])
    } finally {
      await installed.session.dispose()
    }

    const mpqServices = await subjectServices()
    const sourceMpq = await mpqServices.open({
      source: await openFileArtifactSource(installedMapPath),
      path: installedMapPath,
      intent: 'full',
      grant: READ,
      budget,
    })
    if (sourceMpq.state !== 'opened') throw new Error('installed SC2Map did not open as MPQ')
    let mapInfoBefore: Uint8Array
    try {
      expect(sourceMpq.selected.contributionId).toBe('org.modkitx/mpq')
      const extracted = await sourceMpq.session.operations().invoke('extract-entry', {
        entryId: 'MapInfo',
      })
      expect(extracted.state).toBe('ok')
      if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes') {
        throw new Error('installed MapInfo did not extract')
      }
      mapInfoBefore = extracted.output.value
    } finally {
      await sourceMpq.session.dispose()
    }

    const destination = join(scratch, 'installed-save-as')
    mkdirSync(destination)
    const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
    const mount = await vfs.openMount(pathToFileURL(destination).href)
    const destinationUri = pathToFileURL(destination).href
    const targetSubject = await openSubject({
      inventory: semanticServices.inventory,
      source: artifactNamespaceSourceFromVfsMount(mount, {
        ref: { id: destinationUri, uri: destinationUri },
      }),
      path: destination,
      intent: 'full',
      target: semanticServices.target,
      grant: WRITE,
      executionBackends: semanticServices.executionBackends,
      budget,
    })
    if (targetSubject.state !== 'unresolved') {
      throw new Error(`unexpected native Save As target state ${targetSubject.state}`)
    }
    if (semanticServices.serviceDefinitions === undefined) {
      throw new Error('no native MPQ writer definitions')
    }
    const port = createHostServiceResolver({
      inventory: semanticServices.inventory,
      target: semanticServices.target,
      executionBackends: semanticServices.executionBackends,
      definitions: semanticServices.serviceDefinitions,
      grant: WRITE,
      budgets: budget,
    })
    const writerLease = await port.port.resolve({
      contract: 'common.edit/writer',
      major: 1,
      facet: {
        formatId: 'mpq',
        representationId: 'native-source',
        mutationMode: 'export-only',
        minimumRoundTrip: 'semantic',
      },
    })
    const writer = writerLease.value as Writer
    const evidence = serviceProviderFidelityEvidenceRecord(semanticServices.inventory, {
      writer,
      offerId: 'mpq-native-preserving-v1',
      acceptedOrigins: ['linked'],
    })
    if (evidence === undefined) throw new Error('installed MPQ evidence did not materialize')
    expect(evidence).toMatchObject({
      evidenceId: EVIDENCE_ID,
      corpusId: EVIDENCE_CORPUS,
      corpusDigest: EVIDENCE_DIGEST,
      writer: writer.identity,
      optionsFingerprint: EVIDENCE_OPTIONS,
      inputClass: EVIDENCE_INPUT_CLASS,
    })
    const evidenceRegistry = createEvidenceRegistry([evidence])
    const backend = createFileEditingBackend({ roots: [destination] })
    try {
      const editing = createSubjectEditing({
        opened: targetSubject,
        grant: WRITE,
        backendFor: () => backend,
        evidenceFor: plan => evidenceRegistry.evidenceFor(plan),
        expectedWriter: writer.identity,
        expectedEvidenceContext: {
          optionsFingerprint: EVIDENCE_OPTIONS,
          inputClass: EVIDENCE_INPUT_CLASS,
        },
        writer,
      })
      if (editing.session === undefined) throw new Error('native MPQ editing session is absent')
      const target = editing.targets[0]
      if (target === undefined) throw new Error('native MPQ destination target is absent')
      const changed = new TextEncoder().encode(
        `void NativePreservingProof() {\r\n${'    // fixed-slot zlib proof\r\n'.repeat(40)}}\r\n`,
      )
      const archiveName = 'WTE70_Madlibrarian.NativeProof.SC2Map'
      const change = await snapshotNativePreservingMpq({
        sourceBytes: source,
        replacements: [{ path: 'MapScript.galaxy', bytes: changed }],
        target,
        archiveName,
      })
      expect(change.semanticIntent.nativeExportReceipt).toMatchObject({
        source: {
          version: 1,
          archiveBytes: 20_143,
          userDataBytes: 2_252,
          prefixBytes: 2_560,
          hashSlots: 64,
          blockSlots: 32,
        },
        changed: [
          {
            path: 'MapScript.galaxy',
            blockIndex: 10,
            flags: '0x81000200',
            method: 'zlib',
            sourceBytes: 2_244,
            zeroFilledSlackBytes: expect.any(Number),
          },
        ],
        opaque: {
          changedEntrySlack: 'zero-filled-no-source-payload-retained',
          sourceArchive: 'not-mutated',
        },
      })
      expect(await editing.session.propose(change)).toEqual({ valid: true, diagnostics: [] })
      const plan = await editing.session.plan(change)
      expect(plan).toMatchObject({
        semantics: { mutationMode: 'export-only', minimumGuarantee: 'atomic' },
        fidelity: { roundTrip: 'semantic', preservesUnknownData: true },
      })
      const prepared = await editing.coordinator.prepare(plan, {
        grant: editing.grantSnapshot,
      })
      expect(prepared.state).toBe('ready')
      if (prepared.state !== 'ready') return
      const committed = await editing.coordinator.commit(prepared.prepared, {
        grant: editing.grantSnapshot,
      })
      expect(committed).toMatchObject({
        state: 'committed',
        receipt: {
          mutationMode: 'export-only',
          commitGuarantee: 'atomic',
          fidelity: {
            roundTrip: 'semantic',
            preservesUnknownData: true,
            evidenceId: EVIDENCE_ID,
            writer: writer.identity,
            optionsFingerprint: EVIDENCE_OPTIONS,
            inputClass: EVIDENCE_INPUT_CLASS,
          },
        },
      })
      if (committed.state !== 'committed') return

      const outputPath = join(destination, archiveName)
      const semanticReopen = await semanticServices.open({
        source: await openFileArtifactSource(outputPath),
        path: outputPath,
        intent: 'full',
        grant: READ,
        budget,
      })
      if (semanticReopen.state !== 'opened') throw new Error('saved SC2Map did not reopen')
      try {
        expect(semanticReopen.selected.contributionId).toBe('org.modkitx/sc2-map')
        const inspected = await semanticReopen.session.operations().invoke('inspect', {})
        expect(inspected.state).toBe('ok')
        if (inspected.state !== 'ok' || inspected.output.kind !== 'json') {
          throw new Error('saved SC2Map inspection did not return JSON')
        }
        expect(inspected.output.value).toEqual(beforeSummary)
      } finally {
        await semanticReopen.session.dispose()
      }

      const mpqReopen = await mpqServices.open({
        source: await openFileArtifactSource(outputPath),
        path: outputPath,
        intent: 'full',
        grant: READ,
        budget,
      })
      if (mpqReopen.state !== 'opened') throw new Error('saved SC2Map did not reopen as MPQ')
      try {
        expect(mpqReopen.selected.contributionId).toBe('org.modkitx/mpq')
        for (const [entryId, expected] of [
          ['MapScript.galaxy', changed],
          ['MapInfo', mapInfoBefore],
        ] as const) {
          const extracted = await mpqReopen.session.operations().invoke('extract-entry', {
            entryId,
          })
          expect(extracted.state).toBe('ok')
          if (extracted.state === 'ok' && extracted.output.kind === 'bytes') {
            expect([...extracted.output.value]).toEqual([...expected])
          }
        }
      } finally {
        await mpqReopen.session.dispose()
      }
      expect(createHash('sha256').update(readFileSync(installedMapPath)).digest('hex')).toBe(
        sourceDigest,
      )
      expect(
        await editing.coordinator.undo(committed.receipt.transactionId, {
          grant: editing.grantSnapshot,
        }),
      ).toMatchObject({ state: 'committed' })
      expect(() => readFileSync(outputPath)).toThrow()
    } finally {
      await backend.dispose()
      await writerLease.release()
      await port.release()
      await mount.dispose()
    }
  }, 60_000)
})
