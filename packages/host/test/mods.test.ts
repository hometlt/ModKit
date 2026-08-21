import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import { createHostTopology, type ModWorkspaceRootCandidate } from '@modkitx-x3/sdk'
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
import { resolveModWorkspaceComposition } from '@modkitx-x3/host/mods'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const { starcraft2Game } = (await import(
  pathToFileURL(join(repoRoot, 'extensions', 'blizzard', 'starcraft2-game', 'src', 'linked.js'))
    .href
)) as { readonly starcraft2Game: LinkedExtension }

const GAME_ID = 'org.modkitx/starcraft-2'
const REALM = 'org.modkitx.test/mods-host'
const operatingSystem =
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.modkitx.test/mods',
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
      policy: { id: 'org.modkitx.test/mods-policy', revision: '1' },
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
const source = { sourceId: 'retail-casc', kind: 'casc', location: 'casc://retail' }

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

function stockRoot(name: string): ModWorkspaceRootCandidate {
  return {
    rootId: `retail:${name.toLowerCase()}`,
    sourceId: source.sourceId,
    sourcePath: `mods/${name.toLowerCase()}`,
    displayName: name,
    kind: 'mod',
    declaredDependencies: [],
  }
}

async function resolveStarcraft2Workspace() {
  const resolution = await resolveModWorkspaceComposition({
    services: { ...composition, serviceDefinitions: definitions },
    gameId: GAME_ID,
    grant: { id: 'mods-test', classes: [] },
    budgets: activationBudget,
  })
  expect(
    resolution.state,
    resolution.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
  ).toBe('resolved')
  if (resolution.state !== 'resolved') throw new Error('StarCraft II workspace did not resolve')
  return resolution
}

describe('standard mod-workspace contract and StarCraft II provider', () => {
  it('composes the stock engine chain into a portable workspace lock', async () => {
    const resolution = await resolveStarcraft2Workspace()
    try {
      const roots = ['Core.SC2Mod', 'Liberty.SC2Mod', 'Swarm.SC2Mod', 'Void.SC2Mod'].map(stockRoot)
      const activeRootId = 'retail:void.sc2mod'
      const lock = await resolution.composition.compose({
        workspaceId: 'retail-void',
        gameId: GAME_ID,
        activeRootId,
        sources: [source],
        roots,
        maxRoots: 32,
        maxDepth: 16,
      })

      expect(lock).toMatchObject({
        schemaVersion: 1,
        workspaceId: 'retail-void',
        gameId: GAME_ID,
        activeRootId,
        complete: true,
      })
      expect(lock.loadOrder.map(item => item.displayName)).toEqual([
        'Core.SC2Mod',
        'Liberty.SC2Mod',
        'Swarm.SC2Mod',
        'Void.SC2Mod',
      ])
      expect(
        lock.loadOrder.flatMap(root => root.dependencies.map(dependency => dependency.provenance)),
      ).toContain('implicit')
    } finally {
      await resolution.release()
    }
  })

  it('uses source priority for declared refs while retaining default engine data', async () => {
    const resolution = await resolveStarcraft2Workspace()
    try {
      const localSource = { sourceId: 'local', kind: 'directory', location: 'file:///mods' }
      const fallbackSource = {
        sourceId: 'fallback',
        kind: 'archive',
        location: 'memory://fallback',
      }
      const roots: ModWorkspaceRootCandidate[] = [
        {
          rootId: 'local:assets',
          sourceId: localSource.sourceId,
          sourcePath: 'Mods/Assets.SC2Mod',
          displayName: 'Assets.SC2Mod',
          kind: 'mod',
          declaredDependencies: [],
        },
        {
          rootId: 'fallback:assets',
          sourceId: fallbackSource.sourceId,
          sourcePath: 'Mods/Assets.SC2Mod',
          displayName: 'Assets.SC2Mod',
          kind: 'mod',
          declaredDependencies: [],
        },
        {
          rootId: 'local:map',
          sourceId: localSource.sourceId,
          sourcePath: 'Maps/Scenario.SC2Map',
          displayName: 'Scenario.SC2Map',
          kind: 'map',
          declaredDependencies: [{ ref: 'Assets.SC2Mod', required: true }],
        },
        ...['Core.SC2Mod', 'Liberty.SC2Mod'].map(stockRoot),
      ]
      const lock = await resolution.composition.compose({
        workspaceId: 'source-priority',
        gameId: GAME_ID,
        activeRootId: 'local:map',
        sources: [localSource, source, fallbackSource],
        roots,
        maxRoots: 32,
        maxDepth: 16,
      })

      expect(lock.complete).toBe(true)
      expect(lock.loadOrder.map(item => item.rootId)).toEqual([
        'retail:core.sc2mod',
        'retail:liberty.sc2mod',
        'local:assets',
        'local:map',
      ])
      expect(lock.loadOrder.map(item => item.rootId)).not.toContain('fallback:assets')
    } finally {
      await resolution.release()
    }
  })

  it('does not select the StarCraft II workspace provider for another game', async () => {
    const resolution = await resolveModWorkspaceComposition({
      services: { ...composition, serviceDefinitions: definitions },
      gameId: 'org.modkitx/warcraft-3',
      grant: { id: 'mods-test-mismatch', classes: [] },
      budgets: activationBudget,
    })
    expect(resolution.state).toBe('unresolved')
    expect(resolution.diagnostics.map(item => item.code)).toContain(
      'x3.host/mod-workspace-unresolved',
    )
  })
})
