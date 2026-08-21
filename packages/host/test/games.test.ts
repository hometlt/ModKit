import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import { createHostTopology } from '@modkitx-x3/sdk'
import {
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  linkedExtensionInputs,
  linkedInProcessBackend,
  registerServiceDefinitionsOrThrow,
  type HostComposition,
  type LinkedExtension,
} from '@modkitx-x3/host'
import { resolveGameInstallationDiscovery } from '@modkitx-x3/host/games'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const { starcraft2Game } = (await import(
  pathToFileURL(join(repoRoot, 'extensions', 'blizzard', 'starcraft2-game', 'src', 'linked.js'))
    .href
)) as { readonly starcraft2Game: LinkedExtension }

const GAME_ID = 'org.modkitx/starcraft-2'
const REALM = 'org.modkitx.test/games-host'
const operatingSystem =
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.modkitx.test/games',
  realms: [
    {
      schemaVersion: 1,
      realmId: REALM,
      revision: '1',
      target: { environment: 'node', operatingSystem, architecture: 'x64' },
      facilities: [],
      budgets: {
        maxConcurrentTasks: 2,
        maxWorkerCount: 0,
        maxResidentBytes: uint64('134217728'),
        maxTransferBytes: uint64('16777216'),
        defaultDeadlineMs: 10_000,
      },
      policy: { id: 'org.modkitx.test/games-policy', revision: '1' },
    },
  ],
  links: [],
})
const activationBudget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const temporaryRoots: string[] = []
const installedRoot = process.env['MODKITX_SC2_INSTALL'] ?? 'C:\\Apps\\StarCraft II'
const installedEvidenceAvailable =
  existsSync(join(installedRoot, '.build.info')) &&
  existsSync(join(installedRoot, 'SC2Data', 'config')) &&
  existsSync(join(installedRoot, 'SC2Data', 'data')) &&
  existsSync(join(installedRoot, 'SC2Data', 'indices'))
const discoveryPermissions =
  process.platform === 'win32'
    ? (['filesystem-read', 'process-launch'] as const)
    : (['filesystem-read'] as const)

let composition: HostComposition
let definitions: ReturnType<typeof createBundledServiceDefinitionRegistry>

beforeAll(async () => {
  const linked = linkedExtensionInputs([starcraft2Game])
  const executionBackends = createExecutionBackendRegistry([linkedInProcessBackend(linked.modules)])
  composition = await createHostComposition({
    topology,
    realmId: REALM,
    extensions: linked.inputs,
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

async function syntheticInstallation(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'modkitx-sc2-install-'))
  temporaryRoots.push(root)
  await Promise.all(
    ['config', 'data', 'indices'].map(segment =>
      mkdir(join(root, 'SC2Data', segment), { recursive: true }),
    ),
  )
  await writeFile(
    join(root, '.build.info'),
    [
      'Branch!STRING:0|Active!DEC:1|Version!STRING:0|Product!STRING:0|CDN Path!STRING:0',
      'public|1|5.0.16.97563|s2|tpr/sc2',
    ].join('\n'),
  )
  return root
}

async function resolveStarcraft2() {
  const resolution = await resolveGameInstallationDiscovery({
    services: { ...composition, serviceDefinitions: definitions },
    gameId: GAME_ID,
    grant: { id: 'games-test', classes: discoveryPermissions },
    budgets: activationBudget,
  })
  expect(
    resolution.state,
    resolution.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
  ).toBe('resolved')
  if (resolution.state !== 'resolved') throw new Error('StarCraft II discovery did not resolve')
  return resolution
}

describe('standard game-installation contract and StarCraft II provider', () => {
  it('verifies an installation through bounded filesystem evidence', async () => {
    const root = await syntheticInstallation()
    const resolution = await resolveStarcraft2()
    try {
      const result = await resolution.discovery.discover({
        gameId: GAME_ID,
        configuredPaths: [root],
        maxCandidates: 16,
      })
      const installation = result.installations.find(
        item => item.normalizedPath === root.replace(/\\/gu, '/'),
      )
      const probe = result.probes.find(item => item.normalizedPath === root.replace(/\\/gu, '/'))

      expect(installation).toMatchObject({
        gameId: GAME_ID,
        displayName: 'StarCraft II',
        version: '5.0.16.97563',
        origins: ['configured-path'],
      })
      expect(probe?.confirmed).toBe(true)
      expect(probe?.evidence).toHaveLength(5)
      expect(probe?.evidence.every(item => item.found)).toBe(true)
    } finally {
      await resolution.release()
    }
  })

  it.skipIf(!installedEvidenceAvailable)(
    'confirms the locally installed StarCraft II root with real build evidence',
    async () => {
      const resolution = await resolveStarcraft2()
      try {
        const result = await resolution.discovery.discover({
          gameId: GAME_ID,
          configuredPaths: [installedRoot],
          maxCandidates: 16,
        })
        const normalized = installedRoot.replace(/\\/gu, '/').replace(/\/+$/gu, '')
        const installation = result.installations.find(item => item.normalizedPath === normalized)
        expect(installation).toMatchObject({ gameId: GAME_ID, normalizedPath: normalized })
        expect(installation?.version).toMatch(/^5\./u)
        expect(installation?.evidence.every(item => item.found)).toBe(true)
      } finally {
        await resolution.release()
      }
    },
  )

  it('does not select the StarCraft II provider for another named game', async () => {
    const resolution = await resolveGameInstallationDiscovery({
      services: { ...composition, serviceDefinitions: definitions },
      gameId: 'org.modkitx/warcraft-3',
      grant: { id: 'games-test-mismatch', classes: discoveryPermissions },
      budgets: activationBudget,
    })
    expect(resolution.state).toBe('unresolved')
    expect(resolution.diagnostics.map(item => item.code)).toContain(
      'x3.host/game-installation-unresolved',
    )
  })

  it.skipIf(process.platform !== 'win32')(
    'requires process-launch before querying the Windows Registry',
    async () => {
      const resolution = await resolveGameInstallationDiscovery({
        services: { ...composition, serviceDefinitions: definitions },
        gameId: GAME_ID,
        grant: { id: 'games-test-no-registry-process', classes: ['filesystem-read'] },
        budgets: activationBudget,
      })
      expect(resolution.state).toBe('unresolved')
      expect(resolution.diagnostics.map(item => item.message).join('\n')).toContain(
        'permission-required',
      )
    },
  )
})
