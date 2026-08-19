/**
 * S7: the shared subject services and the Node file adapter — the pieces every Node product's
 * open path is made of, proven once here and then only composed by the apps.
 */
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import { createHostTopology } from '@modkitx-x3/sdk'
import {
  createBundledServiceDefinitionRegistry,
  createHostComposition,
  createSubjectServices,
  offersFromInventory,
  registerServiceDefinitionsOrThrow,
  serviceDefinitionSurfaces,
  supportedExtensionHints,
  type ExtensionInput,
} from '@modkitx-x3/host'
import {
  createNodeSubjectServices,
  loadExtensionDirectory,
  nodeRuntimeTargetBase,
  nodeWorkerLinks,
  nodeWorkerRealmProfile,
  openFileArtifactSource,
  workerBackendPolicy,
} from '@modkitx-x3/host/node'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const imagesDir = join(repoRoot, 'extensions', 'common', 'images')
const textJsonDir = join(repoRoot, 'extensions', 'common', 'text-json')
const png = join(repoRoot, 'apps', 'web', 'public', 'favicon-32.png')

const HOST = 'org.example.app/host'
const WORKERS = 'org.example.app/workers'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.example.app/s7',
  realms: [
    {
      schemaVersion: 1,
      realmId: HOST,
      revision: '1',
      target: nodeRuntimeTargetBase(),
      facilities: ['filesystem.read-random', 'worker.module'],
      budgets: {
        maxConcurrentTasks: 4,
        maxWorkerCount: 2,
        maxResidentBytes: uint64('1073741824'),
        maxTransferBytes: uint64('268435456'),
        defaultDeadlineMs: 60_000,
      },
      policy: { id: 'org.example.policy/s7', revision: '1' },
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
      policy: { id: 'org.example.policy/s7-worker', revision: '1' },
    }),
  ],
  links: [...nodeWorkerLinks(HOST, WORKERS)],
})
const policy = workerBackendPolicy({ loadDeadlineMs: 15_000, defaultCallDeadlineMs: 15_000 })
const budget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 128,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

const linked = async (directory: string, trust = false): Promise<ExtensionInput> => ({
  ...(await loadExtensionDirectory(directory)),
  execution: { origin: 'linked', allowTrustedInProcess: trust },
})

const scratch = mkdtempSync(join(tmpdir(), 'x3-subject-services-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe('supportedExtensionHints', () => {
  it('collects the codec match extensions of an inventory: lowercase, unique, sorted', async () => {
    const composition = await createHostComposition({
      topology,
      realmId: HOST,
      extensions: [await linked(imagesDir), await linked(textJsonDir)],
    })
    const hints = supportedExtensionHints(composition.inventory)
    expect(hints).toContain('png')
    expect(hints).toContain('json')
    expect([...hints]).toEqual([...new Set(hints)].sort())
    expect(hints.every(hint => hint === hint.toLowerCase())).toBe(true)
  })
})

describe('createNodeSubjectServices (host realm inventory, worker realm target)', () => {
  it('opens a real PNG worker-brokered through the composed pair and exposes both compositions', async () => {
    const services = await createNodeSubjectServices({
      topology,
      realms: { host: HOST, workers: WORKERS },
      extensions: [await linked(imagesDir)],
      policy,
    })
    expect(services.host.profile.realmId).toBe(HOST)
    expect(services.workers.profile.realmId).toBe(WORKERS)
    expect(services.inventory).toBe(services.host.inventory)
    expect(services.target).toBe(services.workers.target)
    expect(services.executionProfiles).toEqual(['trusted-in-process', 'worker-brokered'])
    expect(services.supportedExtensions).toContain('png')
    expect(services.serviceDefinitions).toBeDefined()
    // The published entries are bundled separately: this inventory was built by `host/node`, and
    // the root entry's offer projection must still recognise its private records (the record
    // travels on the contribution under a well-known symbol, not in a module-local WeakMap).
    // Meaningful against the bundled dist (`pnpm build` precedes `pnpm test` in `pnpm check`).
    expect(offersFromInventory(services.inventory).length).toBeGreaterThan(0)
    // …and a structural copy of a contribution still carries no record: spread drops the symbol
    const [extension] = services.inventory.extensions
    const original = extension?.contributions.find(item => item.record !== undefined)
    if (original === undefined) throw new Error('images inventory has no attested contribution')
    const copy = { ...original }
    expect(Object.getOwnPropertySymbols(copy)).toEqual([])
    expect(
      offersFromInventory({
        ...services.inventory,
        extensions: [{ ...extension!, contributions: [copy] }],
      }),
    ).toEqual([])

    const result = await services.open({
      source: await openFileArtifactSource(png),
      path: png,
      intent: 'full',
      grant: { id: 's7-open', classes: ['read-source'] },
      budget,
    })
    expect(result.state).toBe('opened')
    if (result.state !== 'opened') throw new Error(result.reason)
    expect(result.selected).toMatchObject({
      contributionId: 'org.modkitx/image-png',
      variantId: 'portable',
    })
    expect(result.diagnostics.map(item => item.code)).toContain('x3.host/worker-shared-process')
    // a linked artifact without the explicit decision never runs in-process
    const trusted = result.candidates.find(item => item.variantId === 'trusted-node')
    expect(trusted?.state).toBe('rejected')
    const bytes = await result.session.dataSource('common.view/byte-range-source', 1)
    expect(await (bytes.value as { size(): Promise<bigint> }).size()).toBe(2727n)
    await bytes.release()
    await result.session.dispose()
  }, 30_000)

  it('serviceDefinitions: false composes without a registry; a registry of the root is used as given', async () => {
    const own = createBundledServiceDefinitionRegistry()
    const [without, withOwn] = await Promise.all([
      createNodeSubjectServices({
        topology,
        realms: { host: HOST, workers: WORKERS },
        extensions: [],
        policy,
        serviceDefinitions: false,
      }),
      createNodeSubjectServices({
        topology,
        realms: { host: HOST, workers: WORKERS },
        extensions: [await linked(textJsonDir)],
        policy,
        serviceDefinitions: own,
      }),
    ])
    expect(without.serviceDefinitions).toBeUndefined()
    expect(withOwn.serviceDefinitions).toBe(own)
    // the inventory's definitions were registered into the given registry, fail-closed
    expect(own.list().length).toBeGreaterThan(0)
    expect(serviceDefinitionSurfaces(own).every(item => item.surface !== undefined)).toBe(true)
  })
})

describe('createSubjectServices + definitions helpers', () => {
  it('binds inventory, target and backends; the definitions surfaces are what workers read', async () => {
    const definitions = createBundledServiceDefinitionRegistry()
    const extensions = [await linked(textJsonDir)]
    const [host, workers] = await Promise.all([
      createHostComposition({ topology, realmId: HOST, extensions }),
      createHostComposition({ topology, realmId: WORKERS, extensions }),
    ])
    const registrations = await registerServiceDefinitionsOrThrow(host.inventory, definitions)
    expect(registrations.every(item => item.state !== 'rejected')).toBe(true)
    const surfaces = serviceDefinitionSurfaces(definitions)
    expect(surfaces.length).toBe(
      definitions.list().filter(item => item.surface !== undefined).length,
    )
    const services = createSubjectServices({
      inventory: host.inventory,
      target: workers.target,
      executionBackends: host.executionBackends,
      serviceDefinitions: definitions,
    })
    expect(services.supportedExtensions).toEqual(['json', 'jsonc'])
    expect(services.executionProfiles).toEqual(host.executionBackends.profiles)
    expect(Object.isFrozen(services)).toBe(true)
  })
})

describe('openFileArtifactSource', () => {
  const path = join(scratch, 'sample.bin')
  const bytes = new Uint8Array(70_000).map((_, i) => (i * 13) % 256)
  writeFileSync(path, bytes)

  it('is a bounded, revision-pinned byte source over a real file', async () => {
    const source = await openFileArtifactSource(path)
    expect(source.kind).toBe('bytes')
    expect(source.ref.uri.startsWith('file:///')).toBe(true)
    expect(source.revision.startsWith('provider-token:')).toBe(true)
    expect(source.size).toBe(70_000n)
    expect([...(await source.read(65_000n, 24))]).toEqual([...bytes.slice(65_000, 65_024)])
    // reads past the end are bounded, not errors; reads beyond the size are refused
    expect((await source.read(69_990n, 100)).byteLength).toBe(10)
    await expect(source.read(70_001n, 1)).rejects.toMatchObject({
      code: 'x3.host/invalid-source-range',
    })
    const chunks: Uint8Array[] = []
    for await (const chunk of source.stream({ offset: 1_000n, length: 5_000n })) chunks.push(chunk)
    expect(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)).toBe(5_000)
    expect(chunks[0]?.[0]).toBe(bytes[1_000])
  })

  it('refuses to read a file whose revision changed while it was open', async () => {
    const source = await openFileArtifactSource(path)
    expect((await source.read(0n, 4)).byteLength).toBe(4)
    writeFileSync(path, new Uint8Array(70_000))
    utimesSync(path, new Date(Date.now() + 5_000), new Date(Date.now() + 5_000))
    await expect(source.read(0n, 4)).rejects.toMatchObject({
      code: 'x3.host/source-revision-changed',
    })
  })

  it('refuses directories', async () => {
    await expect(openFileArtifactSource(scratch)).rejects.toMatchObject({
      code: 'x3.host/source-not-a-file',
    })
  })
})
