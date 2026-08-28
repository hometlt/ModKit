import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
  type NamespaceEntrySource,
  type PermissionGrant,
  type Writer,
} from '@modkitx-x3/sdk'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'
import {
  extractZipArchiveEntry,
  parseZipArchive,
} from 'modkit-extension-x3-archives/formats/zip/codec'
import { discoverWarzone2100Installations } from '../src/provider.js'
import { parseWarzoneGameMap } from '../src/warzone2100-map/format.js'
import { snapshotWarzoneWzGameMap } from '../src/warzone-wz/writer.js'

const extensionRoot = join(import.meta.dirname, '..')
const scratch = mkdtempSync(join(tmpdir(), 'x3-warzone-wz-save-as-'))
const HOST = 'org.example.app/warzone-wz-writer-host'
const WORKERS = 'org.example.app/warzone-wz-writer-workers'
const ENTRY = 'multiplay/maps/2c-highground/game.map'
const ARCHIVE_DIGEST = 'd698475eaa7b3386c2465e5850e5609b0d524157280c7d659dc5f79cde6e5688'
const ENTRY_DIGEST = 'c03e17c13a837339a1b8066047385758539cdc14ef903d806fcf871d30409111'
const budget = {
  maxInputBytes: 33_554_432n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 33_554_432,
  maxDiagnostics: 200,
}
const READ: PermissionGrant = { id: 'warzone-wz-writer-host-read', classes: ['read-source'] }
const WRITE: PermissionGrant = {
  id: 'warzone-wz-writer-host-write',
  classes: ['read-source', 'write-source'],
}
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.example.app/warzone-wz-writer',
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
        maxResidentBytes: uint64('268435456'),
        maxTransferBytes: uint64('67108864'),
        defaultDeadlineMs: 60_000,
      },
      policy: { id: 'org.example.policy/warzone-wz-writer', revision: '1' },
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
      policy: { id: 'org.example.policy/warzone-wz-writer-worker', revision: '1' },
    }),
  ],
  links: [...nodeWorkerLinks(HOST, WORKERS)],
})

const digest = (bytes: Uint8Array): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

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
      policy: workerBackendPolicy({ loadDeadlineMs: 15_000, defaultCallDeadlineMs: 60_000 }),
    }))())

afterAll(async () => {
  await (await cachedServices)?.dispose?.()
  rmSync(scratch, { recursive: true, force: true })
})

describe('installed Warzone mp.wz preserving writer through the ordinary host workflow', () => {
  it('proves no-op identity, commits a typed game.map change, reopens and leaves the install file unchanged', async () => {
    const discovery = await discoverWarzone2100Installations({
      gameId: 'org.modkitx/warzone-2100',
      maxCandidates: 16,
    })
    const installation = discovery.installations[0]
    if (installation === undefined) {
      throw new Error(
        `installed Warzone corpus is mandatory: ${discovery.diagnostics.map(item => item.message).join('; ')}`,
      )
    }
    const archivePath = join(installation.installPath, 'data', 'mp.wz')
    const installed = new Uint8Array(readFileSync(archivePath))
    expect(digest(installed)).toBe(`sha256:${ARCHIVE_DIGEST}`)
    const entries = parseZipArchive(installed, budget.maxNodes)
    const aliases = entries.filter(item => item.name.toLowerCase() === ENTRY.toLowerCase())
    expect(aliases.map(item => item.name)).toEqual([ENTRY])
    const sourceEntry = aliases[0]
    if (sourceEntry === undefined) throw new Error(`installed mp.wz is missing ${ENTRY}`)
    const sourceMap = await extractZipArchiveEntry(installed, sourceEntry)
    expect(digest(sourceMap)).toBe(`sha256:${ENTRY_DIGEST}`)
    const parsedSourceMap = parseWarzoneGameMap(sourceMap, budget)

    const originalFileDigest = digest(new Uint8Array(readFileSync(archivePath)))
    const svc = await services()
    const sourceSubject = await svc.open({
      source: await openFileArtifactSource(archivePath),
      path: archivePath,
      intent: 'full',
      grant: READ,
      budget,
    })
    if (sourceSubject.state !== 'opened') {
      throw new Error(`installed mp.wz open failed: ${sourceSubject.reason}`)
    }
    expect(sourceSubject.selected.contributionId).toBe('org.modkitx/warzone-wz')
    await sourceSubject.session.dispose()

    const destination = join(scratch, 'real-save-as')
    mkdirSync(destination)
    const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
    const mount = await vfs.openMount(pathToFileURL(destination).href)
    const destinationUri = pathToFileURL(destination).href
    const targetSubject = await openSubject({
      inventory: svc.inventory,
      source: artifactNamespaceSourceFromVfsMount(mount, {
        ref: { id: destinationUri, uri: destinationUri },
      }),
      path: destination,
      intent: 'full',
      target: svc.target,
      grant: WRITE,
      executionBackends: svc.executionBackends,
      budget,
    })
    if (targetSubject.state !== 'unresolved') {
      throw new Error(`unexpected Warzone WZ Save As target state ${targetSubject.state}`)
    }
    if (svc.serviceDefinitions === undefined) throw new Error('WZ writer definitions are missing')
    const port = createHostServiceResolver({
      inventory: svc.inventory,
      target: svc.target,
      executionBackends: svc.executionBackends,
      definitions: svc.serviceDefinitions,
      grant: WRITE,
      budgets: budget,
    })
    const writerLease = await port.port.resolve({
      contract: 'common.edit/writer',
      major: 1,
      facet: {
        formatId: 'warzone-wz',
        representationId: 'source',
        mutationMode: 'export-only',
        minimumRoundTrip: 'semantic',
      },
    })
    const writer = writerLease.value as Writer
    expect(writer.identity.providerId).toBe('org.modkitx.opensource/warzone2100-wz-writer')
    expect(writer.offer.mutationMode).toBe('export-only')
    const evidence = serviceProviderFidelityEvidenceRecord(svc.inventory, {
      writer,
      offerId: 'warzone2100-wz-game-map-source',
      acceptedOrigins: ['linked'],
    })
    if (evidence === undefined) throw new Error('WZ writer evidence did not materialize')
    expect(evidence.corpusDigest).toBe(`sha256:${ARCHIVE_DIGEST}`)
    expect(evidence.claim.notes?.join('\n')).toContain(`sha256:${ENTRY_DIGEST}`)
    const registry = createEvidenceRegistry([evidence])
    const backend = createFileEditingBackend({ roots: [destination] })
    try {
      const editing = createSubjectEditing({
        opened: targetSubject,
        grant: WRITE,
        backendFor: () => backend,
        evidenceFor: plan => registry.evidenceFor(plan),
        expectedWriter: writer.identity,
        expectedEvidenceContext: {
          optionsFingerprint: 'options:replace-existing-2c-highground-game-map-v1',
          inputClass: 'warzone-wz-classic-canonical-complete',
        },
        writer,
      })
      if (editing.session === undefined) throw new Error('WZ writer session is unavailable')
      const target = editing.targets[0]
      if (target === undefined) throw new Error('WZ Save As target is unavailable')
      const archiveName = 'mp-preserving-save-as.wz'

      const noOp = await snapshotWarzoneWzGameMap({
        sourceBytes: installed,
        entryPath: ENTRY,
        updates: [],
        target,
        archiveName,
        budget,
      })
      const noOpPlan = await writer.plan(noOp)
      const noOpEdit = noOpPlan.edits[0]
      if (noOpEdit?.operation !== 'create' || noOpEdit.payload.kind !== 'inline') {
        throw new Error('WZ no-op plan returned no inline Save As artifact')
      }
      expect(noOpPlan.semantics).toEqual({
        mutationMode: 'export-only',
        minimumGuarantee: 'atomic',
      })
      expect(noOpEdit.payload.bytes).not.toBe(installed)
      expect(noOpEdit.payload.bytes).toEqual(installed)

      const changedTexture = parsedSourceMap.tiles[0].texture ^ 1
      const proposed = await snapshotWarzoneWzGameMap({
        sourceBytes: installed,
        entryPath: ENTRY,
        updates: [{ kind: 'set-tile-v1', index: 0, texture: changedTexture }],
        target,
        archiveName,
        budget,
      })
      expect(await editing.session.propose(proposed)).toEqual({ valid: true, diagnostics: [] })
      const plan = await editing.session.plan(proposed)
      const prepared = await editing.coordinator.prepare(plan, { grant: editing.grantSnapshot })
      expect(prepared.state).toBe('ready')
      if (prepared.state !== 'ready') return
      const committed = await editing.coordinator.commit(prepared.prepared, {
        grant: editing.grantSnapshot,
      })
      expect(committed.state).toBe('committed')
      if (committed.state !== 'committed') return
      expect(committed.receipt).toMatchObject({
        mutationMode: 'export-only',
        commitGuarantee: 'atomic',
        fidelity: {
          evidenceId: 'warzone2100-wz-game-map-preserving-writer-v1',
          corpusDigest: `sha256:${ARCHIVE_DIGEST}`,
        },
      })
      expect(committed.receipt.fidelity.notes?.join('\n')).toContain(`sha256:${ENTRY_DIGEST}`)

      const outputPath = join(destination, archiveName)
      const reopened = await svc.open({
        source: await openFileArtifactSource(outputPath),
        path: outputPath,
        intent: 'full',
        grant: READ,
        budget,
      })
      if (reopened.state !== 'opened') throw new Error('saved-as mp.wz did not reopen')
      try {
        expect(reopened.selected.contributionId).toBe('org.modkitx/warzone-wz')
        const namespaceLease = await reopened.session.dataSource(
          'common.view/namespace-entry-source',
          1,
        )
        try {
          const namespace = namespaceLease.value as NamespaceEntrySource
          const page = await namespace.list('', { limit: 1_000 })
          const reopenedEntry = page.items.find(item => item.path === ENTRY)
          if (reopenedEntry === undefined) {
            throw new Error('saved-as mp.wz lost 2c-highground/game.map')
          }
          const extracted = await reopened.session.operations().invoke('extract-entry', {
            entryId: reopenedEntry.id,
          })
          if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes') {
            throw new Error('saved-as mp.wz did not extract 2c-highground/game.map')
          }
          expect(parseWarzoneGameMap(extracted.output.value, budget).tiles[0].texture).toBe(
            changedTexture,
          )
        } finally {
          await namespaceLease.release()
        }
      } finally {
        await reopened.session.dispose()
      }
      expect(
        parseZipArchive(new Uint8Array(readFileSync(outputPath)), budget.maxNodes),
      ).toHaveLength(entries.length)
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

    expect(digest(new Uint8Array(readFileSync(archivePath)))).toBe(originalFileDigest)
    console.info(
      `[warzone-wz-writer] ${archivePath}: archive sha256:${ARCHIVE_DIGEST}, ${ENTRY} sha256:${ENTRY_DIGEST}, ${entries.length} entries; installation source unchanged`,
    )
  }, 180_000)
})
