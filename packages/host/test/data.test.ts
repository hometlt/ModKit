import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
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
import { resolveDataCatalogAnalysis } from '@modkitx-x3/host/data'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const { starcraft2Game } = (await import(
  pathToFileURL(join(repoRoot, 'extensions', 'blizzard', 'starcraft2-game', 'src', 'linked.js'))
    .href
)) as { readonly starcraft2Game: LinkedExtension }

const GAME_ID = 'org.modkitx/starcraft-2'
const REALM = 'org.modkitx.test/data-host'
const operatingSystem =
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.modkitx.test/data',
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
      policy: { id: 'org.modkitx.test/data-policy', revision: '1' },
    },
  ],
  links: [],
})
const activationBudget = {
  maxInputBytes: 16_777_216n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 4_194_304,
  maxDiagnostics: 100,
}

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

async function resolveCatalog() {
  const resolution = await resolveDataCatalogAnalysis({
    services: { ...composition, serviceDefinitions: definitions },
    gameId: GAME_ID,
    grant: { id: 'data-test', classes: [] },
    budgets: activationBudget,
  })
  expect(
    resolution.state,
    resolution.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
  ).toBe('resolved')
  if (resolution.state !== 'resolved') throw new Error('semantic catalog analyzer did not resolve')
  return resolution
}

describe('standard data contract and semantic game provider', () => {
  it('parses ordered XML patches and exposes inherited schema-backed entities', async () => {
    const resolution = await resolveCatalog()
    try {
      const snapshot = await resolution.analysis.analyze({
        workspaceId: 'map-workspace',
        gameId: GAME_ID,
        documents: [
          {
            rootId: 'base',
            path: 'Base.SC2Data/GameData/UnitData.xml',
            text: '<Catalog><CUnit id="Infantry"><LifeMax value="40"/><WeaponArray index="0" Link="Rifle"/></CUnit></Catalog>',
          },
          {
            rootId: 'active',
            path: 'Active.SC2Data/GameData/UnitData.xml',
            text: '<Catalog><CUnit id="Infantry"><LifeMax value="45"/></CUnit><CUnit id="Marine" parent="Infantry"><Race value="Terr"/><WeaponArray index="1" Link="Grenade"/></CUnit></Catalog>',
          },
        ],
        queries: [{ namespace: 'Unit', entityId: 'Marine' }],
        maxDocuments: 8,
        maxTextBytes: 32_768,
        maxEntities: 128,
        maxDepth: 16,
      })

      expect(snapshot.complete).toBe(true)
      expect(snapshot.entities[0]).toMatchObject({
        namespace: 'Unit',
        typeId: 'CUnit',
        entityId: 'Marine',
        parentEntityId: 'Infantry',
        fields: {
          LifeMax: 45,
          Race: 'Terr',
          WeaponArray: [
            { index: '0', value: { Link: 'Rifle' } },
            { index: '1', value: { Link: 'Grenade' } },
          ],
        },
      })
      expect(snapshot.entities[0]?.sources.map(item => item.rootId)).toEqual([
        'base',
        'active',
        'active',
      ])
    } finally {
      await resolution.release()
    }
  })

  it('does not route the provider to another game', async () => {
    const resolution = await resolveDataCatalogAnalysis({
      services: { ...composition, serviceDefinitions: definitions },
      gameId: 'example/other-game',
      grant: { id: 'data-test-mismatch', classes: [] },
      budgets: activationBudget,
    })
    expect(resolution.state).toBe('unresolved')
    expect(resolution.diagnostics.map(item => item.code)).toContain(
      'x3.host/data-catalog-unresolved',
    )
  })
})
