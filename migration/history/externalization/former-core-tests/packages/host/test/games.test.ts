import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import { createHostTopology } from '@modkitx-x3/sdk'
import {
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostComposition,
  registerServiceDefinitionsOrThrow,
  TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
  type HostComposition,
} from '@modkitx-x3/host'
import { discoverGameInstallations, resolveGameInstallationDiscovery } from '@modkitx-x3/host/games'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const starcraft2ExtensionRoot = join(repoRoot, '..', 'modkit-blizzard', 'starcraft2')

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
const installedRoot =
  process.env['MODKITX_SC2_ROOT'] ?? process.env['MODKITX_SC2_INSTALL'] ?? 'C:\\Apps\\StarCraft II'
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
  const extension = await loadExtensionDirectory(starcraft2ExtensionRoot)
  const executionBackends = createExecutionBackendRegistry([TRUSTED_IN_PROCESS_EXECUTION_BACKEND])
  composition = await createHostComposition({
    topology,
    realmId: REALM,
    extensions: [
      {
        ...extension,
        execution: { origin: 'bundled', allowTrustedInProcess: true },
      },
    ],
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
  it('runs discovery through a host-owned provider lease', async () => {
    const root = await syntheticInstallation()
    const discovery = await discoverGameInstallations({
      services: { ...composition, serviceDefinitions: definitions },
      gameId: GAME_ID,
      configuredPaths: [root],
      maxCandidates: 1,
      grant: { id: 'games-test-coordinator', classes: discoveryPermissions },
      budgets: activationBudget,
    })

    expect(
      discovery.state,
      discovery.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
    ).toBe('discovered')
    if (discovery.state !== 'discovered') throw new Error('installation discovery did not run')
    expect(discovery.result.complete).toBe(false)
    expect(discovery.result.installations).toHaveLength(1)
    expect(discovery.result.installations[0]?.normalizedPath).toBe(root.replace(/\\/gu, '/'))
    expect('release' in discovery).toBe(false)
  })

  it('verifies an installation through bounded filesystem evidence', async () => {
    const root = await syntheticInstallation()
    const buildPath = join(root, '.build.info')
    const beforeBytes = await readFile(buildPath)
    const before = await stat(buildPath)
    const resolution = await resolveStarcraft2()
    try {
      const result = await resolution.discovery.discover({
        gameId: GAME_ID,
        configuredPaths: [root],
        maxCandidates: 16,
      })
      expect(result.complete).toBe(true)
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
    const after = await stat(buildPath)
    expect(await readFile(buildPath)).toEqual(beforeBytes)
    expect({ size: after.size, mtimeMs: after.mtimeMs }).toEqual({
      size: before.size,
      mtimeMs: before.mtimeMs,
    })
  })

  it('prioritizes caller-configured paths over MODKITX_SC2_ROOT', async () => {
    const environmentRoot = await syntheticInstallation()
    const manualRoot = await syntheticInstallation()
    const configuredPaths = Object.freeze([manualRoot])
    const previousEnvironmentRoot = process.env['MODKITX_SC2_ROOT']
    process.env['MODKITX_SC2_ROOT'] = environmentRoot
    const resolution = await resolveStarcraft2()
    try {
      const result = await resolution.discovery.discover({
        gameId: GAME_ID,
        configuredPaths,
        maxCandidates: 2,
      })
      expect(result.complete).toBe(false)
      expect(result.probes.map(item => item.normalizedPath)).toEqual(
        [manualRoot, environmentRoot].map(path => path.replace(/\\/gu, '/')),
      )
      expect(result.installations.map(item => item.origins)).toEqual([
        ['configured-path'],
        ['configured-path'],
      ])
      expect(configuredPaths).toEqual([manualRoot])
    } finally {
      await resolution.release()
      if (previousEnvironmentRoot === undefined) delete process.env['MODKITX_SC2_ROOT']
      else process.env['MODKITX_SC2_ROOT'] = previousEnvironmentRoot
    }
  })

  it('fails closed for an invalid environment root while retaining a valid manual fallback', async () => {
    const manualRoot = await syntheticInstallation()
    const invalidEnvironmentRoot = join(manualRoot, 'not-an-installation')
    await mkdir(invalidEnvironmentRoot)
    const previousEnvironmentRoot = process.env['MODKITX_SC2_ROOT']
    process.env['MODKITX_SC2_ROOT'] = invalidEnvironmentRoot
    const resolution = await resolveStarcraft2()
    try {
      const result = await resolution.discovery.discover({
        gameId: GAME_ID,
        configuredPaths: [manualRoot],
        maxCandidates: 2,
      })
      expect(result.complete).toBe(false)
      const invalidNormalized = invalidEnvironmentRoot.replace(/\\/gu, '/')
      const manualNormalized = manualRoot.replace(/\\/gu, '/')
      expect(result.probes.map(item => [item.normalizedPath, item.confirmed])).toEqual([
        [manualNormalized, true],
        [invalidNormalized, false],
      ])
      expect(result.installations.map(item => item.normalizedPath)).toEqual([manualNormalized])
    } finally {
      await resolution.release()
      if (previousEnvironmentRoot === undefined) delete process.env['MODKITX_SC2_ROOT']
      else process.env['MODKITX_SC2_ROOT'] = previousEnvironmentRoot
    }
  })

  it('stays within each configured candidate and never promotes parent markers', async () => {
    const parent = await syntheticInstallation()
    const child = join(parent, 'child-without-markers')
    await mkdir(child)
    const resolution = await resolveStarcraft2()
    try {
      const result = await resolution.discovery.discover({
        gameId: GAME_ID,
        configuredPaths: [child],
        maxCandidates: 16,
      })
      const normalized = child.replace(/\\/gu, '/')
      expect(result.installations.some(item => item.normalizedPath === normalized)).toBe(false)
      const probe = result.probes.find(item => item.normalizedPath === normalized)
      expect(probe).toMatchObject({ confirmed: false })
      expect(probe?.evidence.every(item => item.path.startsWith(child))).toBe(true)
    } finally {
      await resolution.release()
    }
  })

  it('honors cancellation before reading installation evidence', async () => {
    const root = await syntheticInstallation()
    const resolution = await resolveStarcraft2()
    const cancelled = new AbortController()
    cancelled.abort()
    try {
      await expect(
        resolution.discovery.discover({
          gameId: GAME_ID,
          configuredPaths: [root],
          maxCandidates: 16,
          signal: cancelled.signal,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' })
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
