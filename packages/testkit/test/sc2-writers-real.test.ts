import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
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
  type AssetNamespaceEntry,
  type ChangeSet,
  type FidelityEvidence,
  type NamespaceEntrySource,
  type PermissionGrant,
  type Writer,
} from '@modkitx-x3/sdk'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'
import { externalRepositoryRoot } from '../../../scripts/lib/external-extension-roots.mjs'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const blizzardRoot = externalRepositoryRoot(repoRoot, 'blizzard')
const explicitSc2Root = process.env.MODKITX_SC2_ROOT?.trim()
const sc2Root = explicitSc2Root || 'C:\\Apps\\StarCraft II'
const buildInfoPath = join(sc2Root, '.build.info')
const mapRoot = 'campaigns/liberty.sc2campaign/base.sc2maps/maps/campaign/tarcade.sc2map'
const writerModuleUrl = pathToFileURL(
  join(blizzardRoot, 'starcraft2', 'src', 'editing', 'workspace-copy-writer.js'),
).href

const HOST = 'org.example.app/sc2-writer-real-host'
const WORKERS = 'org.example.app/sc2-writer-real-workers'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.example.app/sc2-writer-real',
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
        maxResidentBytes: uint64('2147483648'),
        maxTransferBytes: uint64('536870912'),
        defaultDeadlineMs: 120_000,
      },
      policy: { id: 'org.example.policy/sc2-writer-real', revision: '1' },
    },
    nodeWorkerRealmProfile({
      realmId: WORKERS,
      budgets: {
        maxConcurrentTasks: 2,
        maxWorkerCount: 0,
        maxResidentBytes: uint64('1073741824'),
        maxTransferBytes: uint64('536870912'),
        defaultDeadlineMs: 120_000,
      },
      policy: { id: 'org.example.policy/sc2-writer-real-worker', revision: '1' },
    }),
  ],
  links: [...nodeWorkerLinks(HOST, WORKERS)],
})

const budget = {
  maxInputBytes: 268_435_456n,
  maxDepth: 128,
  maxNodes: 750_000,
  maxScalarBytes: 134_217_728,
  maxDiagnostics: 1_000,
}
const READ: PermissionGrant = { id: 'sc2-writer-real-read', classes: ['read-source'] }
const WRITE: PermissionGrant = {
  id: 'sc2-writer-real-write',
  classes: ['read-source', 'write-source'],
}
const scratch = mkdtempSync(join(tmpdir(), 'x3-sc2-writer-real-'))

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const linked = async (directory: string): Promise<ExtensionInput> => ({
  ...(await loadExtensionDirectory(directory)),
  execution: { origin: 'linked', allowTrustedInProcess: false },
})

const bundled = async (directory: string): Promise<ExtensionInput> => ({
  ...(await loadExtensionDirectory(directory)),
  execution: { origin: 'bundled', allowTrustedInProcess: true },
})

function evidenceFor(writer: Writer, change: ChangeSet): FidelityEvidence {
  const digest = createHash('sha256')
  for (const edit of change.edits) {
    if (edit.operation !== 'create' || edit.payload.kind !== 'inline') continue
    digest.update(edit.newPath)
    digest.update('\0')
    digest.update(edit.payload.bytes)
  }
  return {
    roundTrip: 'byte-identical',
    preservesUnknownData: true,
    evidenceId: writer.offer.fidelityEvidenceId,
    corpusId: 'installed-sc2-casc:tarcade.sc2map',
    corpusDigest: `sha256:${digest.digest('hex')}`,
    conformanceProfile: 'common.edit/writer-v1' as never,
    writer: writer.identity,
    optionsFingerprint: 'complete-casc-namespace-snapshot-v1',
    inputClass: 'real-installed-sc2-casc-workspace-copy',
    provenAt: '2026-08-27T00:00:00Z',
  }
}

describe('Block 15E installed SC2 CASC workspace-copy foundation', () => {
  it.skipIf(!existsSync(buildInfoPath))(
    'refuses an incomplete retail CASC snapshot, then copies real SC2 bytes through a complete loose workspace',
    async () => {
      const before = statSync(buildInfoPath)
      const services = await createNodeSubjectServices({
        topology,
        realms: { host: HOST, workers: WORKERS },
        extensions: await Promise.all([
          bundled(join(repoRoot, '..', 'modkit-blizzard', 'casc')),
          linked(join(repoRoot, '..', 'modkit-blizzard', 'starcraft2')),
        ]),
        policy: workerBackendPolicy({
          loadDeadlineMs: 30_000,
          defaultCallDeadlineMs: 120_000,
        }),
      })
      const sourceVfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
      const sourceMount = await sourceVfs.openMount(pathToFileURL(sc2Root).href)
      const targetDirectory = join(scratch, 'TArcade.SC2Map')
      mkdirSync(targetDirectory)
      const targetVfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
      const targetMount = await targetVfs.openMount(pathToFileURL(targetDirectory).href)
      let casc: Awaited<ReturnType<typeof openSubject>> | undefined
      let target: Awaited<ReturnType<typeof openSubject>> | undefined
      try {
        casc = await openSubject({
          inventory: services.inventory,
          source: artifactNamespaceSourceFromVfsMount(sourceMount),
          path: 'StarCraft II',
          intent: 'full',
          target: services.host.target,
          grant: READ,
          executionBackends: services.executionBackends,
          budget,
        })
        if (casc.state !== 'opened') throw new Error(`CASC open failed: ${casc.reason}`)
        const cascSession = casc.session
        expect(casc.descriptor.constraints.readOnly).toBe(true)
        const namespaceLease = await cascSession.dataSource('common.view/namespace-entry-source', 1)
        try {
          const namespace = namespaceLease.value as NamespaceEntrySource
          const targetUri = pathToFileURL(targetDirectory).href
          target = await openSubject({
            inventory: services.inventory,
            source: artifactNamespaceSourceFromVfsMount(targetMount, {
              ref: { id: targetUri, uri: targetUri },
            }),
            path: targetDirectory,
            intent: 'full',
            target: services.target,
            grant: WRITE,
            executionBackends: services.executionBackends,
            budget,
          })
          if (target.state !== 'unresolved') {
            throw new Error(`workspace target unexpectedly resolved as ${target.state}`)
          }
          if (services.serviceDefinitions === undefined) {
            throw new Error('SC2 writer service definitions were not registered')
          }
          const servicePort = createHostServiceResolver({
            inventory: services.inventory,
            target: services.target,
            executionBackends: services.executionBackends,
            definitions: services.serviceDefinitions,
            grant: WRITE,
            budgets: budget,
          })
          const writerLease = await servicePort.port.resolve({
            contract: 'common.edit/writer',
            major: 1,
            facet: {
              formatId: 'sc2-workspace-copy',
              representationId: 'namespace',
              mutationMode: 'export-only',
              minimumRoundTrip: 'byte-identical',
            },
          })
          const writer = writerLease.value as Writer
          const backend = createFileEditingBackend({ roots: [targetDirectory] })
          try {
            const initialEditing = createSubjectEditing({
              opened: target,
              grant: WRITE,
              backendFor: () => backend,
              evidenceFor: () => undefined,
              writer,
              maxInlinePayloadBytes: 134_217_728,
            })
            const editTarget = initialEditing.targets[0]
            if (editTarget === undefined) throw new Error('workspace target has no edit target')
            const writerModule = (await import(writerModuleUrl)) as {
              snapshotSc2WorkspaceCopy(options: unknown): Promise<ChangeSet>
            }
            const revision = (await cascSession.descriptor()).revision
            const readCasc = async (path: string): Promise<Uint8Array> => {
              let extracted
              try {
                extracted = await cascSession
                  .operations()
                  .invoke('extract-entry', { entryId: path })
              } catch (cause) {
                throw new Error(
                  `CASC extraction failed for ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
                )
              }
              if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes') {
                throw new Error(`CASC extraction failed for ${path}`)
              }
              return extracted.output.value
            }

            // This retail install advertises all locale entries but does not have every encoding
            // key locally. A preserving export must stop before it can produce a partial plan.
            await expect(
              writerModule.snapshotSc2WorkspaceCopy({
                source: {
                  revision,
                  list: (
                    prefix: string,
                    page: { cursor?: string; limit: number },
                    signal?: AbortSignal,
                  ) => namespace.list(prefix, page, signal),
                  read: readCasc,
                },
                sourcePrefix: mapRoot,
                sourceMode: 'read-only-casc',
                documentKind: 'SC2Map',
                target: editTarget,
                maxEntries: 1_024,
                maxEntryBytes: 134_217_728,
                maxTotalBytes: 268_435_456,
                pageLimit: 128,
              }),
            ).rejects.toThrow(/encoding key is not local/u)
            expect(readdirSync(targetDirectory)).toEqual([])

            // Build a bounded loose workspace from actual, locally readable map entries. This is
            // a new complete workspace snapshot, not a claim that the partial retail CASC map was
            // exported. Both source and destination are accessed through the standard VFS seam.
            const listed = await namespace.list(`${mapRoot}/`, { limit: 128 })
            expect(listed.nextCursor).toBeUndefined()
            const realPaths = ['objects', 'regions', 't3heightmap'].map(
              name => `${mapRoot}/${name}`,
            )
            const mapScript = listed.items.find(item => /\/mapscript\.galaxy$/iu.test(item.path))
            expect(mapScript, 'installed TArcade map has no Galaxy source').toBeDefined()
            if (mapScript !== undefined) realPaths.push(mapScript.path)
            const looseDirectory = join(scratch, 'CascLocal.SC2Map')
            mkdirSync(looseDirectory)
            for (const path of realPaths) {
              writeFileSync(
                join(looseDirectory, path.slice(mapRoot.length + 1)),
                await readCasc(path),
              )
            }
            const looseVfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
            const looseMount = await looseVfs.openMount(pathToFileURL(looseDirectory).href)
            const looseSource = artifactNamespaceSourceFromVfsMount(looseMount)
            const looseLease = await looseSource.openNamespace()
            let change: ChangeSet
            try {
              const looseEntries: AssetNamespaceEntry[] = []
              for await (const item of looseLease.value.list('')) {
                if (item.kind === 'file') looseEntries.push(item)
              }
              looseEntries.sort((left, right) => (left.path < right.path ? -1 : 1))
              const loosePrefix = 'CascLocal.SC2Map'
              change = await writerModule.snapshotSc2WorkspaceCopy({
                source: {
                  revision: looseSource.revision,
                  async list(_prefix: string, page: { cursor?: string; limit: number }) {
                    const from = page.cursor === undefined ? 0 : Number(page.cursor)
                    const items = looseEntries.slice(from, from + page.limit).map(item => ({
                      id: `${loosePrefix}/${item.path}`,
                      path: `${loosePrefix}/${item.path}`,
                      kind: 'file',
                      ...(item.size === undefined ? {} : { size: item.size }),
                      revision: looseSource.revision,
                    }))
                    return {
                      items,
                      ...(from + items.length < looseEntries.length
                        ? { nextCursor: String(from + items.length) }
                        : {}),
                    }
                  },
                  async read(path: string): Promise<Uint8Array> {
                    const entry = await looseLease.value.open(path.slice(loosePrefix.length + 1))
                    try {
                      if (entry.value.kind !== 'bytes' || entry.value.size === undefined) {
                        throw new Error(`loose workspace entry ${path} is not a sized byte source`)
                      }
                      return entry.value.read(0n, Number(entry.value.size))
                    } finally {
                      await entry.release()
                    }
                  },
                },
                sourcePrefix: loosePrefix,
                sourceMode: 'loose-workspace',
                documentKind: 'SC2Map',
                target: editTarget,
                maxEntries: 16,
                maxEntryBytes: 16_777_216,
                maxTotalBytes: 67_108_864,
                pageLimit: 2,
              })
            } finally {
              await looseLease.release()
              await looseMount.dispose()
            }
            expect(change.edits.length).toBeGreaterThan(3)
            const editing = createSubjectEditing({
              opened: target,
              grant: WRITE,
              backendFor: () => backend,
              evidenceFor: () => evidenceFor(writer, change),
              expectedWriter: writer.identity,
              writer,
              maxInlinePayloadBytes: 134_217_728,
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
            expect(committed.state).toBe('committed')
            if (committed.state !== 'committed') return

            for (const edit of change.edits) {
              if (edit.operation !== 'create' || edit.payload.kind !== 'inline') continue
              expect([...readFileSync(join(targetDirectory, ...edit.newPath.split('/')))]).toEqual([
                ...edit.payload.bytes,
              ])
            }
            const authored = change.edits.find(
              edit =>
                edit.operation === 'create' &&
                edit.payload.kind === 'inline' &&
                (/\.galaxy$/iu.test(edit.newPath) ||
                  /gamedata\/[^/]+data\.xml$/iu.test(edit.newPath)),
            )
            expect(
              authored,
              'real map contains no reopenable authored Galaxy/GameData entry',
            ).toBeDefined()
            if (authored?.operation === 'create' && authored.payload.kind === 'inline') {
              const copiedPath = join(targetDirectory, ...authored.newPath.split('/'))
              const reopened = await openSubject({
                inventory: services.inventory,
                source: await openFileArtifactSource(copiedPath),
                path: copiedPath,
                intent: 'inspect',
                target: services.target,
                grant: READ,
                executionBackends: services.executionBackends,
                budget,
              })
              if (reopened.state !== 'opened') {
                throw new Error(`copied authored file did not reopen: ${reopened.reason}`)
              }
              expect(['org.modkitx/galaxy', 'org.modkitx/sc2-data']).toContain(
                reopened.selected.contributionId,
              )
              await reopened.session.dispose()
            }

            const undone = await editing.coordinator.undo(committed.receipt.transactionId, {
              grant: editing.grantSnapshot,
            })
            expect(undone.state).toBe('committed')
            expect(readdirSync(targetDirectory)).toEqual([])
          } finally {
            await backend.dispose()
            await writerLease.release()
            await servicePort.release()
          }
        } finally {
          await namespaceLease.release()
        }
      } finally {
        if (target?.state === 'opened') await target.session.dispose()
        if (casc?.state === 'opened') await casc.session.dispose()
        await targetMount.dispose()
        await sourceMount.dispose()
      }
      const after = statSync(buildInfoPath)
      expect({ size: after.size, mtimeMs: after.mtimeMs }).toEqual({
        size: before.size,
        mtimeMs: before.mtimeMs,
      })
    },
    180_000,
  )
})
