import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  extractZipArchiveEntry,
  parseZipArchive,
} from 'modkit-extension-x3-archives/formats/zip/codec'
import { createCandidateWorldSceneLease } from '../../../../packages/host/src/maps/world-source.js'
import { analyzeWarzoneResolvedData } from '../src/data-provider.js'
import { analyzeWarzoneMapObjectResourceBindings } from '../src/data-resource-bindings.js'
import { analyzeWarzoneMapWorkspace } from '../src/map-provider.js'
import { applyWarzoneLastWins } from '../src/warzone-wz/codec.js'

const GAME_ID = 'org.modkitx/warzone-2100'
const corpusRoot = process.env['MODKITX_WARZONE_ROOT']
const configured = typeof corpusRoot === 'string' && corpusRoot.length > 0
const dataRoot = configured ? join(corpusRoot, 'data') : ''
const decoder = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()

const statFiles = [
  'templates.json',
  'structure.json',
  'features.json',
  'body.json',
  'construction.json',
  'ecm.json',
  'propulsion.json',
  'sensor.json',
  'weapons.json',
]

interface ArchiveFixture {
  readonly rootId: 'base' | 'mp'
  readonly bytes: Uint8Array
  readonly files: ReadonlyMap<string, ReturnType<typeof parseZipArchive>[number]>
}

async function openArchive(rootId: 'base' | 'mp'): Promise<ArchiveFixture> {
  const bytes = await readFile(join(dataRoot, `${rootId}.wz`))
  const entries = applyWarzoneLastWins(parseZipArchive(bytes, 20_000)).effective.filter(
    entry => entry.kind === 'file',
  )
  return {
    rootId,
    bytes,
    files: new Map(entries.map(entry => [entry.name.toLowerCase(), entry])),
  }
}

async function textOf(archive: ArchiveFixture, path: string): Promise<string | undefined> {
  const entry = archive.files.get(path.toLowerCase())
  if (entry === undefined) return undefined
  return decoder.decode(await extractZipArchiveEntry(archive.bytes, entry))
}

describe.skipIf(!configured)('Warzone 2100 pinned 2c-highground resource bindings', () => {
  it('gives all 177 placed objects observed PIE paths and parses related PIE texture directives', async () => {
    if (!existsSync(join(dataRoot, 'base.wz')) || !existsSync(join(dataRoot, 'mp.wz'))) {
      throw new Error(
        'MODKITX_WARZONE_ROOT must identify a Warzone install with data/base.wz and data/mp.wz',
      )
    }
    const archives = await Promise.all([openArchive('base'), openArchive('mp')])
    const byRoot = new Map(archives.map(archive => [archive.rootId, archive]))
    const documents = []
    for (const archive of archives) {
      for (const file of statFiles) {
        const text = await textOf(archive, `stats/${file}`)
        if (text !== undefined) {
          documents.push({ rootId: archive.rootId, path: `${archive.rootId}/stats/${file}`, text })
        }
      }
    }
    const objectDocuments = await Promise.all(
      ['droid.json', 'struct.json', 'feature.json'].map(async file => {
        const text = await textOf(archives[1], `multiplay/maps/2c-highground/${file}`)
        if (text === undefined) throw new Error(`2c-highground/${file} is missing from mp.wz`)
        return {
          rootId: 'mp',
          path: `multiplay/maps/2c-highground/${file}`,
          text,
        }
      }),
    )
    expect(
      objectDocuments.map(document => createHash('sha256').update(document.text).digest('hex')),
    ).toEqual([
      '680dc6647d1602289035fd3d74e0b8ef2c42fae98a6139a05e51a8063ae90a62',
      'e2d95b97f69fdc6cd514b0e661fbb426d0f1ab59bd1ad75462cb28239ed3e090',
      '94be6c97eb5ffbe5c570e298d2a43c5c5e2930c5fb4a197bd2ce9322fd89225e',
    ])

    const workspaceId = 'warzone-2c-highground-bindings'
    const catalog = await analyzeWarzoneResolvedData({
      workspaceId,
      gameId: GAME_ID,
      documents,
      queries: [],
      maxDocuments: documents.length,
      maxTextBytes: 16_777_216,
      maxEntities: 100_000,
      maxDepth: 64,
      localizationDocuments: [],
      locales: [],
      localizationKeys: [],
      plannedDocumentCount: documents.length,
      unresolvedRequirementIds: [],
    })
    expect(catalog.entities).toEqual([])

    const gameMapEntry = archives[1].files.get('multiplay/maps/2c-highground/game.map')
    if (gameMapEntry === undefined) throw new Error('2c-highground/game.map is missing from mp.wz')
    const mapSnapshot = await analyzeWarzoneMapWorkspace({
      workspaceId,
      gameId: GAME_ID,
      mapId: 'multiplay/maps/2c-highground',
      documents: [
        {
          path: 'multiplay/maps/2c-highground/game.map',
          bytes: await extractZipArchiveEntry(archives[1].bytes, gameMapEntry),
        },
        ...objectDocuments.map(document => ({
          path: document.path,
          bytes: encoder.encode(document.text),
        })),
      ],
      catalog,
      snapshotId: 'warzone-2c-highground-resource-snapshot',
      unresolvedRequirementIds: [],
      requiredRequirementIds: ['warzone-game-map'],
      maxDocuments: 4,
      maxDocumentBytes: 16_777_216,
      maxTotalBytes: 33_554_432,
      maxObjects: 1_000,
      maxRegions: 1_000,
      maxTerrainCells: 65_536,
      maxTerrainSamples: 65_536,
      maxDepth: 64,
      maxDiagnostics: 2_048,
    })
    expect(mapSnapshot.semantic.objects).toHaveLength(177)
    expect(mapSnapshot.semantic.resolvedCatalogObjects).toBe(177)
    expect(mapSnapshot.semantic.warzoneResourceBindings).toMatchObject({
      objects: 177,
      definitionBoundObjects: 177,
      modelBoundObjects: 177,
      logicalModelReferences: 637,
      materialTextureReferences: 0,
      modelReferencesComplete: true,
      materialReferencesComplete: false,
      complete: false,
    })
    expect(
      mapSnapshot.semantic.objects.flatMap(object => object.warzoneResources.models),
    ).toHaveLength(637)
    const world = createCandidateWorldSceneLease(mapSnapshot, [], 256)
    try {
      const info = await world.value.info()
      const objectsFacet = info.facets.find(facet => facet.facet === 'objects')
      if (objectsFacet === undefined) throw new Error('world objects facet is missing')
      const page = await world.value.page({
        facet: 'objects',
        layerId: objectsFacet.layerId,
        limit: 256,
      })
      expect(page.items).toHaveLength(177)
      expect(page.items.flatMap(item => item.warzoneResources.models)).toHaveLength(637)
    } finally {
      await world.release()
    }

    const resourceEntries = archives.flatMap(archive =>
      [...archive.files.values()].map(entry => ({ rootId: archive.rootId, path: entry.name })),
    )
    const baseRequest = {
      workspaceId,
      gameId: GAME_ID,
      documents,
      objectDocuments,
      resourceEntries,
      maxObjects: 1_000,
      maxModelReferences: 100_000,
      maxDiagnostics: 2_048,
      maxTextBytes: 16_777_216,
      maxEntities: 10_000,
      maxDepth: 64,
    }
    const pathAnalysis = await analyzeWarzoneMapObjectResourceBindings({
      ...baseRequest,
      modelDocuments: [],
    })
    const modelResources = new Map<string, { readonly rootId: string; readonly path: string }>()
    for (const object of pathAnalysis.objectBindings) {
      for (const model of object.models) {
        if (model.state === 'resolved') {
          modelResources.set(
            `${model.resource.rootId}\0${model.resource.path.toLowerCase()}`,
            model.resource,
          )
        }
      }
    }
    const modelDocuments = await Promise.all(
      [...modelResources.values()].map(async resource => {
        const archive = byRoot.get(resource.rootId as 'base' | 'mp')
        if (archive === undefined) throw new Error(`unknown corpus root ${resource.rootId}`)
        const text = await textOf(archive, resource.path)
        if (text === undefined) throw new Error(`${resource.rootId}/${resource.path} disappeared`)
        return { rootId: resource.rootId, path: resource.path, text }
      }),
    )
    const analysis = await analyzeWarzoneMapObjectResourceBindings({
      ...baseRequest,
      modelDocuments,
    })

    expect(analysis.counts).toEqual({
      objects: 177,
      boundObjects: 177,
      definitions: 30,
      componentBindings: 308,
      modelBindings: 637,
      resolvedModelBindings: 637,
      missingModelBindings: 0,
      ambiguousModelBindings: 0,
      modelsWithReadMaterialEvidence: 637,
      textureBindings: 715,
      resolvedTextureBindings: 715,
      diagnostics: 0,
      omittedDiagnostics: 0,
    })
    expect(
      analysis.objectBindings.every(object =>
        object.models.some(model => model.state === 'resolved'),
      ),
    ).toBe(true)
    expect(analysis.objectBindings.some(object => object.kind === 'droid')).toBe(true)
    expect(analysis.objectBindings.some(object => object.kind === 'structure')).toBe(true)
    expect(analysis.objectBindings.some(object => object.kind === 'feature')).toBe(true)
    expect(analysis.pathComplete).toBe(true)
    expect(analysis.textureDirectiveComplete).toBe(true)
    expect(analysis.materialComplete).toBe(false)
    expect(JSON.stringify(analysis)).not.toMatch(/file:\/\/|"[A-Za-z]:[\\/]/u)
    console.info(
      `[warzone-bindings] ${JSON.stringify({
        placedObjects: mapSnapshot.semantic.objects.length,
        catalogLogicalModelReferences:
          mapSnapshot.semantic.warzoneResourceBindings.logicalModelReferences,
        catalogMaterialTextureReferences:
          mapSnapshot.semantic.warzoneResourceBindings.materialTextureReferences,
        observedPhysicalModelPaths: analysis.counts.resolvedModelBindings,
        observedTexturePaths: analysis.counts.resolvedTextureBindings,
      })}`,
    )
  }, 120_000)
})
