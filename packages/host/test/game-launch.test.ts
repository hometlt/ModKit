import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import { GAME_LAUNCH_PLAN_CONTRACT, type GameInstallation } from '@modkitx-x3/sdk/games'
import { createHostTopology } from '@modkitx-x3/sdk'
import {
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  defineLinkedExtension,
  linkedExtensionInputs,
  linkedInProcessBackend,
  planGameLaunch,
  registerServiceDefinitionsOrThrow,
  TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
  type HostComposition,
} from '@modkitx-x3/host'
import { launchNodeGameResource, loadExtensionDirectory } from '@modkitx-x3/host/node'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const extensionRoot = join(repoRoot, 'extensions', 'blizzard', 'starcraft2-game')
const GAME_ID = 'org.modkitx/starcraft-2'
const REALM = 'org.modkitx.test/game-launch'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.modkitx.test/game-launch',
  realms: [
    {
      schemaVersion: 1,
      realmId: REALM,
      revision: '1',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      facilities: [],
      budgets: {
        maxConcurrentTasks: 2,
        maxWorkerCount: 0,
        maxResidentBytes: uint64('134217728'),
        maxTransferBytes: uint64('16777216'),
        defaultDeadlineMs: 10_000,
      },
      policy: { id: 'org.modkitx.test/game-launch-policy', revision: '1' },
    },
  ],
  links: [],
})
const budgets = {
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const temporaryRoots: string[] = []

let composition: HostComposition
let definitions: ReturnType<typeof createBundledServiceDefinitionRegistry>

beforeAll(async () => {
  const extension = await loadExtensionDirectory(extensionRoot)
  const executionBackends = createExecutionBackendRegistry([TRUSTED_IN_PROCESS_EXECUTION_BACKEND])
  composition = await createHostComposition({
    topology,
    realmId: REALM,
    extensions: [{ ...extension, execution: { origin: 'bundled', allowTrustedInProcess: true } }],
    executionBackends,
  })
  definitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(composition.inventory, definitions)
})

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })),
  )
})

async function fixture(includeSwitcher = true): Promise<{
  installation: GameInstallation
  mapPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'modkitx-sc2-launch-'))
  temporaryRoots.push(root)
  await mkdir(join(root, 'Support64'), { recursive: true })
  if (includeSwitcher) await writeFile(join(root, 'Support64', 'SC2Switcher_x64.exe'), '')
  const mapPath = join(root, 'Fixture.SC2Map')
  await writeFile(mapPath, 'fixture')
  return {
    installation: Object.freeze({
      gameId: GAME_ID,
      displayName: 'StarCraft II',
      installPath: root,
      normalizedPath: root.replace(/\\/gu, '/'),
      origins: Object.freeze(['configured-path'] as const),
      evidence: Object.freeze([
        Object.freeze({ kind: 'confirmed-test-installation', path: root, found: true }),
      ]),
    }),
    mapPath,
  }
}

const services = () => ({ ...composition, serviceDefinitions: definitions })
const launchGrant = { id: 'game-launch-test', classes: ['process-launch'] as const }

describe('StarCraft II native map launch contract', () => {
  it('builds the sealed deterministic SC2Switcher plan through the game provider', async () => {
    const { installation, mapPath } = await fixture()
    const request = {
      gameId: GAME_ID,
      installation,
      resource: { kind: 'map' as const, path: mapPath },
    }
    const plannedA = await planGameLaunch({
      services: services(),
      ...request,
      grant: launchGrant,
      budgets,
    })
    const plannedB = await planGameLaunch({
      services: services(),
      ...request,
      grant: launchGrant,
      budgets,
    })
    expect(plannedA.state).toBe('planned')
    expect(plannedB.state).toBe('planned')
    if (plannedA.state !== 'planned' || plannedB.state !== 'planned') {
      throw new Error('StarCraft II launch provider did not resolve')
    }
    expect(plannedA.plan).toEqual(plannedB.plan)
    expect(plannedA.plan).toMatchObject({
      executableRelativePath: 'Support64/SC2Switcher_x64.exe',
      workingDirectoryRelativePath: '.',
      resourceArgumentIndex: 1,
      mode: 'detached',
      stdio: 'ignore',
    })
    expect(plannedA.plan.arguments).toEqual([
      '-run',
      mapPath,
      '-preload',
      '1',
      '-NoUserCheats',
      '-meleeMod',
      'Void',
      '-difficulty',
      '2',
      '-speed',
      '2',
      '-displaymode',
      '1',
    ])
  })

  it('denies a missing process-launch grant before invoking the spawner', async () => {
    const { installation, mapPath } = await fixture()
    let spawned = false
    const result = await launchNodeGameResource({
      services: services(),
      gameId: GAME_ID,
      installation,
      resource: { kind: 'map', path: mapPath },
      grant: { id: 'game-launch-denied', classes: [] },
      budgets,
      spawner: async () => {
        spawned = true
        return { release: async () => undefined }
      },
    })
    expect(result.state).toBe('denied')
    expect(spawned).toBe(false)
    expect(result.diagnostics.map(item => item.code)).toContain(
      'x3.host/game-launch-permission-required',
    )
  })

  it('fails closed when the installed SC2Switcher path is missing', async () => {
    const { installation, mapPath } = await fixture(false)
    let spawned = false
    const result = await launchNodeGameResource({
      services: services(),
      gameId: GAME_ID,
      installation,
      resource: { kind: 'map', path: mapPath },
      grant: launchGrant,
      budgets,
      spawner: async () => {
        spawned = true
        return { release: async () => undefined }
      },
    })
    expect(result.state).toBe('invalid')
    expect(spawned).toBe(false)
    expect(result.diagnostics.map(item => item.code)).toContain('x3.host/game-launch-path-missing')
  })

  it('refuses an installation whose evidence is not confirmed', async () => {
    const { installation, mapPath } = await fixture()
    let spawned = false
    const result = await launchNodeGameResource({
      services: services(),
      gameId: GAME_ID,
      installation: {
        ...installation,
        evidence: [
          { kind: 'failed-test-installation', path: installation.installPath, found: false },
        ],
      },
      resource: { kind: 'map', path: mapPath },
      grant: launchGrant,
      budgets,
      spawner: async () => {
        spawned = true
        return { release: async () => undefined }
      },
    })
    expect(result.state).toBe('unresolved')
    expect(spawned).toBe(false)
    expect(result.diagnostics.map(item => item.code)).toContain(
      'x3.host/game-launch-request-invalid',
    )
  })

  it('uses an injected host spawner and releases its lease exactly once', async () => {
    const { installation, mapPath } = await fixture()
    const calls: unknown[] = []
    let releases = 0
    const result = await launchNodeGameResource({
      services: services(),
      gameId: GAME_ID,
      installation,
      resource: { kind: 'map', path: mapPath },
      grant: launchGrant,
      budgets,
      spawner: async request => {
        calls.push(request)
        return { pid: 4242, release: async () => void (releases += 1) }
      },
    })
    expect(result.state).toBe('launched')
    expect(calls).toHaveLength(1)
    if (result.state !== 'launched') throw new Error('launch did not reach the injected spawner')
    expect(result.receipt).toMatchObject({
      gameId: GAME_ID,
      resource: { path: mapPath },
      pid: 4242,
    })
    expect(result.receipt.arguments[1]).toBe(mapPath)
    await result.release()
    await result.release()
    expect(releases).toBe(1)
  })

  it('propagates cancellation from an injected spawner without launching the real game', async () => {
    const { installation, mapPath } = await fixture()
    const controller = new AbortController()
    let entered!: () => void
    const spawnerEntered = new Promise<void>(resolveEntered => (entered = resolveEntered))
    const pending = launchNodeGameResource({
      services: services(),
      gameId: GAME_ID,
      installation,
      resource: { kind: 'map', path: mapPath },
      grant: launchGrant,
      budgets,
      signal: controller.signal,
      spawner: request =>
        new Promise((_resolve, reject) => {
          entered()
          request.signal?.addEventListener('abort', () => reject(request.signal?.reason), {
            once: true,
          })
        }),
    })
    await spawnerEntered
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('releases a resolved provider lease when planning is cancelled', async () => {
    let releaseCount = 0
    let entered!: () => void
    const plannerEntered = new Promise<void>(resolveEntered => (entered = resolveEntered))
    const module = Object.freeze({
      abiVersion: 1,
      provides: Object.freeze([GAME_LAUNCH_PLAN_CONTRACT]),
      createProvider: () => ({
        value: {
          contract: GAME_LAUNCH_PLAN_CONTRACT,
          plannerId: 'org.modkitx.test/cancellable-launch',
          gameIds: [GAME_ID],
          plan: (request: { readonly signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              entered()
              request.signal?.addEventListener('abort', () => reject(request.signal?.reason), {
                once: true,
              })
            }),
        },
        release: async () => void (releaseCount += 1),
      }),
    })
    const linked = defineLinkedExtension({
      source: 'linked:test/cancellable-game-launch',
      packageJson: {
        name: 'modkitx-test-cancellable-game-launch',
        version: '1.0.0',
        license: 'MIT',
        modkit: {
          schemaVersion: 1,
          publisher: 'org.modkitx.test',
          id: 'game-launch',
          contributionManifests: ['./contributions/*.json'],
        },
      },
      contributions: [
        {
          path: 'contributions/launch.json',
          manifest: {
            schemaVersion: 1,
            contract: { id: 'org.modkitx/service-provider-contribution', major: 1 },
            id: 'org.modkitx.test/cancellable-game-launch',
            displayName: 'Cancellable game launch fixture',
            status: 'supported',
            runtimeVariants: [
              {
                variantId: 'linked-node-windows',
                entrypoint: './launch.js',
                target: { environments: ['node'], operatingSystems: ['windows'] },
                executionProfile: 'trusted-in-process',
                requestedPermissionClasses: [],
              },
            ],
            spec: {
              provides: [
                {
                  offerId: 'cancellable-launch-v1',
                  contract: GAME_LAUNCH_PLAN_CONTRACT,
                  major: 1,
                  version: '1.0.0',
                  facet: { gameIds: [GAME_ID] },
                },
              ],
              lifecycleScope: 'operation',
            },
          },
        },
      ],
      modules: { './launch.js': module },
    })
    const linkedSet = linkedExtensionInputs([linked])
    const linkedBackends = createExecutionBackendRegistry([
      linkedInProcessBackend(linkedSet.modules),
    ])
    const linkedComposition = await createHostComposition({
      topology,
      realmId: REALM,
      extensions: linkedSet.inputs,
      executionBackends: linkedBackends,
    })
    expect({
      extensions: linkedComposition.inventory.extensions,
      diagnostics: linkedComposition.inventory.diagnostics,
    }).toEqual({ extensions: expect.any(Array), diagnostics: [] })
    expect(linkedComposition.inventory.extensions[0]?.contributions).toEqual(
      expect.arrayContaining([expect.objectContaining({ activationEligible: true })]),
    )
    const linkedDefinitions = createBundledServiceDefinitionRegistry()
    await registerServiceDefinitionsOrThrow(linkedComposition.inventory, linkedDefinitions)
    const { installation, mapPath } = await fixture()
    const controller = new AbortController()
    const pending = planGameLaunch({
      services: { ...linkedComposition, serviceDefinitions: linkedDefinitions },
      gameId: GAME_ID,
      installation,
      resource: { kind: 'map', path: mapPath },
      grant: launchGrant,
      budgets,
      signal: controller.signal,
    })
    const started = await Promise.race([
      plannerEntered.then(() => 'entered' as const),
      pending.then(result => ({ result })),
    ])
    expect(started).toBe('entered')
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(releaseCount).toBe(1)
  })
})
