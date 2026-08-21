import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkitx-x3/core'
import { createHostTopology, type DataCatalogSnapshot } from '@modkitx-x3/sdk'
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
import { resolveMapSemanticAnalysis } from '@modkitx-x3/host/maps'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const { starcraft2Game } = (await import(
  pathToFileURL(join(repoRoot, 'extensions', 'blizzard', 'starcraft2-game', 'src', 'linked.js'))
    .href
)) as { readonly starcraft2Game: LinkedExtension }

const GAME_ID = 'org.modkitx/starcraft-2'
const REALM = 'org.modkitx.test/maps-host'
const operatingSystem =
  process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.modkitx.test/maps',
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
        maxTransferBytes: uint64('33554432'),
        defaultDeadlineMs: 10_000,
      },
      policy: { id: 'org.modkitx.test/maps-policy', revision: '1' },
    },
  ],
  links: [],
})
const activationBudget = {
  maxInputBytes: 33_554_432n,
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

function heightMap(): Uint8Array {
  const bytes = new Uint8Array(32 + 4 * 6)
  bytes.set(new TextEncoder().encode('HMAP'))
  const view = new DataView(bytes.buffer)
  view.setUint32(4, 101, true)
  view.setUint32(8, 2, true)
  view.setUint32(12, 2, true)
  for (let index = 0; index < 4; index += 1) {
    view.setUint16(32 + index * 6, 100 + index, true)
    view.setUint16(34 + index * 6, 10 + index, true)
    view.setUint16(36 + index * 6, index === 3 ? 0x9000 : 1, true)
  }
  return bytes
}

const encoder = new TextEncoder()
const documents = [
  {
    path: 'Objects',
    bytes: encoder.encode(
      '<?xml version="1.0"?><PlacedObjects Version="27"><ObjectUnit Id="7" Position="1,2,3" Rotation="0.5" Scale="1,1,1" UnitType="Marine" Player="1"/></PlacedObjects>',
    ),
  },
  {
    path: 'Regions',
    bytes: encoder.encode(
      '<?xml version="1.0"?><Regions><region id="2"><name value="Start"/><shape type="circle"><center value="1,2"/><radius value="3"/></shape></region></Regions>',
    ),
  },
  { path: 't3HeightMap', bytes: heightMap() },
] as const

const catalog = Object.freeze({
  schemaVersion: 1,
  workspaceId: 'map-workspace',
  gameId: GAME_ID,
  analyzerId: 'test/catalog',
  typeIds: Object.freeze(['CUnit']),
  namespaces: Object.freeze([{ namespace: 'Unit', entityCount: 1 }]),
  entityCount: 1,
  patchCount: 1,
  entities: Object.freeze([
    Object.freeze({
      namespace: 'Unit',
      typeId: 'CUnit',
      entityId: 'Marine',
      inheritanceChain: Object.freeze([{ namespace: 'Unit', entityId: 'Marine' }]),
      fields: Object.freeze({ LifeMax: 45, Race: 'Terr' }),
      sources: Object.freeze([{ rootId: 'base', path: 'UnitData.xml', documentIndex: 0 }]),
      complete: true,
    }),
  ]),
  diagnostics: Object.freeze([]),
  complete: true,
}) satisfies DataCatalogSnapshot

async function resolveMaps() {
  const resolution = await resolveMapSemanticAnalysis({
    services: { ...composition, serviceDefinitions: definitions },
    gameId: GAME_ID,
    grant: { id: 'maps-test', classes: [] },
    budgets: activationBudget,
  })
  expect(
    resolution.state,
    resolution.diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
  ).toBe('resolved')
  if (resolution.state !== 'resolved') throw new Error('semantic map analyzer did not resolve')
  return resolution
}

const limits = {
  maxDocuments: 8,
  maxDocumentBytes: 1_000_000,
  maxTotalBytes: 4_000_000,
  maxObjects: 1_000,
  maxRegions: 1_000,
  maxTerrainCells: 100_000,
  maxTerrainSamples: 16,
  maxDepth: 32,
} as const

describe('standard map contract and semantic game provider', () => {
  it('opens terrain, regions and placed objects, then binds them to the resolved catalog', async () => {
    const resolution = await resolveMaps()
    try {
      const preliminary = await resolution.analysis.open({
        workspaceId: 'map-workspace',
        gameId: GAME_ID,
        mapId: 'Synthetic.SC2Map',
        documents,
        ...limits,
      })
      expect(preliminary.complete).toBe(false)
      expect(preliminary.catalogQueries).toEqual([{ namespace: 'Unit', entityId: 'Marine' }])

      const snapshot = await resolution.analysis.open({
        workspaceId: 'map-workspace',
        gameId: GAME_ID,
        mapId: 'Synthetic.SC2Map',
        documents,
        catalog,
        ...limits,
      })
      expect(snapshot.complete).toBe(true)
      expect(snapshot.terrain).toMatchObject({
        version: 101,
        width: 2,
        height: 2,
        cellCount: 4,
        minimumHeightBase: 100,
        maximumHeightBase: 103,
        cliffCellCount: 1,
      })
      expect(snapshot.regions[0]).toMatchObject({
        regionId: 2,
        name: 'Start',
        shapes: [{ type: 'circle', parameters: { center: '1,2', radius: '3' } }],
      })
      expect(snapshot.objects[0]).toMatchObject({
        kind: 'unit',
        objectId: 7,
        typeId: 'Marine',
        position: { x: 1, y: 2, z: 3 },
        catalog: {
          ref: { namespace: 'Unit', entityId: 'Marine' },
          entity: { typeId: 'CUnit', fields: { LifeMax: 45, Race: 'Terr' } },
        },
      })
      expect(snapshot.resolvedCatalogObjects).toBe(1)
    } finally {
      await resolution.release()
    }
  })

  it('does not route the provider to another game', async () => {
    const resolution = await resolveMapSemanticAnalysis({
      services: { ...composition, serviceDefinitions: definitions },
      gameId: 'example/other-game',
      grant: { id: 'maps-test-mismatch', classes: [] },
      budgets: activationBudget,
    })
    expect(resolution.state).toBe('unresolved')
    expect(resolution.diagnostics.map(item => item.code)).toContain(
      'x3.host/map-semantic-unresolved',
    )
  })
})
