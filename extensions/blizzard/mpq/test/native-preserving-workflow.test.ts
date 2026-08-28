import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import {
  artifactNamespaceSourceFromVfsMount,
  createHostServiceResolver,
  createSubjectEditing,
  openSubject,
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
import {
  createHostTopology,
  type FidelityEvidence,
  type PermissionGrant,
  type Writer,
} from '@modkitx-x3/sdk'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'
import { encodeFreshMpq, snapshotNativePreservingMpq } from '../src/mpq/fresh-writer.js'
import { encodeNativePreservingMpq } from '../src/mpq/native-preserving.js'

const extensionRoot = join(import.meta.dirname, '..')
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

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const linked = async (): Promise<ExtensionInput> => ({
  ...(await loadExtensionDirectory(extensionRoot)),
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

function evidence(writer: Writer, source: Uint8Array): FidelityEvidence {
  return {
    roundTrip: 'semantic',
    preservesUnknownData: true,
    evidenceId: writer.offer.fidelityEvidenceId,
    corpusId: 'modkitX3/extensions/blizzard/mpq/test:native-preserving-workflow',
    corpusDigest: `sha256:${createHash('sha256').update(source).digest('hex')}`,
    conformanceProfile: 'common.edit/writer-v1' as never,
    writer: writer.identity,
    optionsFingerprint: 'fixed-slot-native-save-as-v1',
    inputClass: 'pinned-native-mpq-v0-stored',
    provenAt: '2026-08-28T00:00:00Z',
  }
}

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
      const editing = createSubjectEditing({
        opened,
        grant: WRITE,
        backendFor: () => backend,
        evidenceFor: () => evidence(writer, source),
        expectedWriter: writer.identity,
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
          fidelity: { roundTrip: 'semantic', preservesUnknownData: true },
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

  it.skipIf(!existsSync(installedMapPath))(
    'rewrites and reopens a bounded installed SC2Map without touching the installed source',
    async () => {
      const source = new Uint8Array(readFileSync(installedMapPath))
      const sourceDigest = createHash('sha256').update(source).digest('hex')
      if (explicitSc2Root === undefined) {
        expect(source.byteLength).toBe(22_703)
        expect(sourceDigest).toBe(
          'f654e212dcff3ffe3e1090e383b7b25fac4def2a723b4eda408c1b5cdfb2a305',
        )
      }
      const changed = new TextEncoder().encode(
        `void NativePreservingProof() {\r\n${'    // fixed-slot zlib proof\r\n'.repeat(40)}}\r\n`,
      )
      const encoded = await encodeNativePreservingMpq({
        sourceBytes: source,
        replacements: [{ path: 'MapScript.galaxy', bytes: changed }],
        maxArchiveBytes: 1_000_000,
        maxBlocks: 1_000,
      })
      expect(encoded.receipt).toMatchObject({
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
          },
        ],
        opaque: {
          changedEntrySlack: 'zero-filled-no-source-payload-retained',
          sourceArchive: 'not-mutated',
        },
      })
      expect(encoded.receipt.changed[0]?.zeroFilledSlackBytes).toBeGreaterThan(0)
      const outputPath = join(scratch, 'InstalledNativeProof.SC2Map')
      writeFileSync(outputPath, encoded.bytes)
      const services = await subjectServices()
      const reopened = await services.open({
        source: await openFileArtifactSource(outputPath),
        path: outputPath,
        intent: 'full',
        grant: READ,
        budget,
      })
      if (reopened.state !== 'opened') throw new Error('installed native output did not reopen')
      try {
        const extracted = await reopened.session.operations().invoke('extract-entry', {
          entryId: 'MapScript.galaxy',
        })
        expect(extracted.state).toBe('ok')
        if (extracted.state === 'ok' && extracted.output.kind === 'bytes') {
          expect([...extracted.output.value]).toEqual([...changed])
        }
      } finally {
        await reopened.session.dispose()
      }
      expect(createHash('sha256').update(readFileSync(installedMapPath)).digest('hex')).toBe(
        sourceDigest,
      )
    },
    60_000,
  )
})
