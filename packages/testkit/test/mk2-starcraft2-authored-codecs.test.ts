import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type Codec,
  type ContributionContext,
  type NamespaceEntrySource,
  type ResourceBudget,
  type TableDataSource,
  type TextDataSource,
} from '@modkitx-x3/sdk'

type CodecId =
  | 'galaxy'
  | 'sc2-strings'
  | 'sc2-layout'
  | 'sc2-data'
  | 'sc2-bank'
  | 'sc2-document-metadata'
  | 'sc2-triggers'
  | 'sc2-runtime'
  | 'sc2-map'
  | 'sc2-mod'
  | 'sc2-campaign'
  | 'sc2-replay'

const root = join(import.meta.dirname, '..', '..', '..')
const extension = join(root, 'extensions', 'blizzard', 'starcraft2')
const fixtureRoot = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')
const budget: ResourceBudget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 32,
  maxNodes: 1000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('SC2 authored codecs have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('SC2 authored codecs have no foreign service dependency')
    },
  },
}

function source(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://blizzard-starcraft2/${name}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:blizzard-starcraft2-${name}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

function input(value: ArtifactByteSource): AssetInput {
  const binding = {
    sourceKind: 'candidate' as const,
    bindingId: 'content',
    role: 'content',
    ownership: 'owned' as const,
    source: value.ref,
    revision: value.revision,
  }
  return {
    originKind: 'single',
    bindings: [binding],
    primaryBindingId: 'content',
    revisions: {
      topology: 'single',
      revision: value.revision,
      bindings: [{ bindingId: 'content', revision: value.revision }],
      compositionFingerprint: value.ref.id,
    },
    bindingsFor: () => [],
    async openBinding() {
      return {
        value,
        async release() {
          return undefined
        },
      }
    },
  }
}

async function codec(id: CodecId): Promise<Codec> {
  const entrypoint =
    id === 'sc2-campaign'
      ? join(extension, 'src', 'formats', id, 'codec.js')
      : join(extension, 'src', id, 'codec.js')
  const module = (await import(pathToFileURL(entrypoint).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  return module.createCodec(context)
}

async function open(id: CodecId, bytes: Uint8Array, resourceBudget = budget) {
  return (await codec(id)).open(input(source(bytes, id)), 'inspect', resourceBudget)
}

async function inspect(session: Awaited<ReturnType<typeof open>>) {
  const result = await session.operations().invoke('inspect', null)
  if (result.state !== 'ok' || result.output.kind !== 'json') throw new Error('inspect failed')
  return result.output.value
}

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(fixtureRoot, name)))
}

describe('ported StarCraft II authored and structural codecs', () => {
  it('inspects Galaxy declarations and publishes the exact UTF-8 source', async () => {
    const bytes = await fixture('minimal.galaxy')
    const session = await open('galaxy', bytes)
    expect(await inspect(session)).toMatchObject({
      format: 'galaxy',
      functions: 2,
      functionNames: ['InitMap', 'Add'],
      includes: ['TriggerLibs/NativeLib'],
      maximumBlockDepth: 1,
    })
    const lease = await session.dataSource('common.view/text-data-source', 1)
    const text = lease.value as TextDataSource
    const slice = await text.slice({ kind: 'from-line', line: 0, lineCount: 10, maxBytes: 4096 })
    expect(slice.text).toContain('void InitMap()')
    expect(slice.text).toContain('int Add(int a, int b)')
    await lease.release()
    await session.dispose()
  })

  it('publishes bounded rows for localization, layout, and GameData catalogs', async () => {
    const cases = [
      {
        id: 'sc2-strings' as const,
        sample: 'minimal.sc2strings.txt',
        summary: { entries: 3, duplicateKeys: 0, markupReferences: 1 },
        columns: ['Key', 'Value'],
        first: ['UI/Title', 'Fixture Map'],
      },
      {
        id: 'sc2-layout' as const,
        sample: 'minimal.SC2Layout',
        summary: { frames: 1, frameNames: ['FixturePanel'], constants: 1 },
        columns: ['Kind', 'Path', 'Type / Value'],
        first: ['Include', 'UI/Layout/Shared.SC2Layout', ''],
      },
      {
        id: 'sc2-data' as const,
        sample: 'minimal.gamedata.xml',
        summary: { entities: 2, classes: ['CUnit', 'CWeapon'], inheritedEntities: 1 },
        columns: ['Class', 'Id', 'Parent', 'Default'],
        first: ['CUnit', 'Marine', 'BaseUnit', ''],
      },
    ]
    for (const value of cases) {
      const session = await open(value.id, await fixture(value.sample)).catch(error => {
        throw new Error(`${value.id}: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        })
      })
      expect(await inspect(session)).toMatchObject(value.summary)
      const lease = await session.dataSource('common.view/table-data-source', 1)
      const table = lease.value as TableDataSource
      expect(await table.shape()).toMatchObject({ header: value.columns })
      expect((await table.rows({ kind: 'range', from: 0, count: 10 })).items[0]?.cells).toEqual(
        value.first,
      )
      await lease.release()
      await session.dispose()
    }
  })

  it('rejects malformed structure and enforces scalar, node, and depth budgets', async () => {
    const encode = (value: string) => new TextEncoder().encode(value)
    await expect(open('galaxy', encode('void Broken() {'))).rejects.toThrow(/unbalanced/u)
    await expect(open('sc2-strings', encode('not-a-key-value-line'))).rejects.toThrow(
      /separator|entries/u,
    )
    await expect(open('sc2-layout', encode('<Desc><Frame></Desc>'))).rejects.toThrow(
      'Unexpected closing tag Desc.; Element Frame is not closed.; Element Desc is not closed.; Frame requires attribute name.',
    )
    await expect(
      open('sc2-data', encode('<Catalog><CUnit id="A"/></Catalog>'), { ...budget, maxNodes: 1 }),
    ).rejects.toThrow(/maxNodes/u)
    await expect(
      open('galaxy', await fixture('minimal.galaxy'), { ...budget, maxScalarBytes: 8 }),
    ).rejects.toThrow(/maxScalarBytes/u)
  })

  it('inspects SC2 banks as bounded section/key tables', async () => {
    const session = await open('sc2-bank', await fixture('minimal.SC2Bank'))
    expect(await inspect(session)).toMatchObject({
      format: 'sc2-bank',
      version: '1',
      sections: 2,
      keys: 3,
      valueTypes: ['flag', 'int', 'string'],
      signaturePresent: true,
    })
    const lease = await session.dataSource('common.view/table-data-source', 1)
    const table = lease.value as TableDataSource
    expect(await table.shape()).toMatchObject({ header: ['Section', 'Key', 'Type', 'Value'] })
    expect((await table.rows({ kind: 'range', from: 0, count: 10 })).items[0]?.cells).toEqual([
      'Progress',
      'Score',
      'int',
      '42',
    ])
    await lease.release()
    await session.dispose()
  })

  it('distinguishes DocInfo, H2CS DocumentHeader, and cdes version metadata', async () => {
    const info = await open('sc2-document-metadata', await fixture('DocumentInfo'))
    expect(await inspect(info)).toMatchObject({
      format: 'document-info',
      sections: ['Dependencies', 'Preload'],
      dependencies: ['file:Mods/Liberty.SC2Mod'],
      preloads: ['Assets/Loading.dds'],
    })
    await info.dispose()

    const header = new Uint8Array(96)
    header.set(new TextEncoder().encode('H2CS'))
    const headerView = new DataView(header.buffer)
    headerView.setUint32(0x04, 8, true)
    headerView.setUint32(0x08, 0x5332, true)
    headerView.setUint16(0x0c, 0x0501, true)
    headerView.setUint16(0x0e, 96, true)
    headerView.setUint32(0x10, 95_841, true)
    headerView.setUint32(0x18, 2, true)
    headerView.setUint32(0x2c, 1, true)
    header.set(new TextEncoder().encode('file:Mods/Liberty.SC2Mod\0'), 0x30)
    const headerSession = await open('sc2-document-metadata', header)
    expect(await inspect(headerSession)).toMatchObject({
      format: 'document-header',
      markerVersion: 8,
      gameSignature: 0x5332,
      buildNumber: 95_841,
      dependencies: ['file:Mods/Liberty.SC2Mod'],
    })
    await headerSession.dispose()

    const version = new Uint8Array(44)
    version.set(new TextEncoder().encode('cdess2mv'))
    const versionView = new DataView(version.buffer)
    versionView.setUint32(0x08, 2, true)
    versionView.setUint32(0x0c, 95_841, true)
    versionView.setUint32(0x10, 5, true)
    versionView.setUint32(0x14, 0, true)
    versionView.setUint32(0x18, 12, true)
    versionView.setUint32(0x1c, 95_841, true)
    versionView.setUint32(0x20, 7, true)
    versionView.setUint32(0x24, 1_700_000_000, true)
    versionView.setUint32(0x28, 1, true)
    const versionSession = await open('sc2-document-metadata', version)
    expect(await inspect(versionSession)).toMatchObject({
      format: 'version-file',
      typeTag: 's2mv',
      formatVersion: 2,
      buildNumber: 95_841,
      majorVersion: 5,
      minorVersion: 0,
      patchVersion: 12,
      entryCount: 7,
    })
    await versionSession.dispose()
  })

  it('inspects TriggerData structure and the non-executing runtime program boundary', async () => {
    const triggers = await open('sc2-triggers', await fixture('Triggers'))
    expect(await inspect(triggers)).toMatchObject({
      format: 'sc2-triggers',
      libraries: ['DEMO'],
      elements: 2,
      typeCounts: { Trigger: 1, FunctionDef: 1 },
      customScriptBlocks: 1,
    })
    await triggers.dispose()

    const runtime = await open('sc2-runtime', await fixture('minimal-runtime.galaxy'))
    expect(await inspect(runtime)).toMatchObject({
      format: 'sc2-runtime',
      functions: 2,
      entrypoints: ['Spawn', 'main'],
      nativeCalls: 4,
      nativeInvocations: 4,
    })
    const lease = await runtime.dataSource('common.view/table-data-source', 1)
    const table = lease.value as TableDataSource
    expect(await table.shape()).toMatchObject({ header: ['Native', 'Invocations'], rows: 4 })
    await lease.release()
    await runtime.dispose()
  })

  it('rejects malformed local structural and runtime surfaces', async () => {
    const encode = (value: string) => new TextEncoder().encode(value)
    await expect(open('sc2-bank', encode('<Bank><Section></Bank>'))).rejects.toThrow(/nesting/u)
    await expect(
      open('sc2-triggers', encode('<TriggerData><Element></TriggerData>')),
    ).rejects.toThrow(/nesting/u)
    await expect(open('sc2-runtime', await fixture('minimal.galaxy'))).rejects.toThrow(/main/u)
    const malformedVersion = new Uint8Array(44)
    malformedVersion.set(encode('cdess2mv'))
    new DataView(malformedVersion.buffer).setUint32(0x08, 1, true)
    await expect(open('sc2-document-metadata', malformedVersion)).rejects.toThrow(/not supported/u)
  })

  it('decrypts packed SC2Map, SC2Mod, and SC2Campaign namespaces and classifies semantic markers', async () => {
    const cases = [
      {
        id: 'sc2-map' as const,
        sample: 'minimal.SC2Map',
        summary: { format: 'sc2-map', entries: 5, localizedData: 0, scripts: 1 },
        names: ['(listfile)', 'MapInfo', 'MapScript.galaxy', 'Objects', 'Terrain'],
      },
      {
        id: 'sc2-mod' as const,
        sample: 'minimal.SC2Mod',
        summary: {
          format: 'sc2-mod',
          entries: 6,
          componentLists: 1,
          documentInfo: 1,
          gameDataEntries: 1,
          layouts: 1,
          localizedData: 1,
        },
        names: [
          '(listfile)',
          'ComponentList.SC2Components',
          'DocumentInfo',
          'enUS.SC2Data/LocalizedData/GameStrings.txt',
          'GameData/UnitData.xml',
          'UI/Layout/Fixture.SC2Layout',
        ],
      },
      {
        id: 'sc2-campaign' as const,
        sample: 'minimal.SC2Campaign',
        summary: {
          format: 'sc2-campaign',
          entries: 9,
          campaignDataEntries: 1,
          containedMapRoots: ['Base.SC2Maps/Maps/Campaign/Fixture.SC2Map'],
          componentLists: 1,
          documentInfo: 1,
          gameDataEntries: 1,
          layouts: 1,
          localizedData: 1,
        },
        names: [
          '(listfile)',
          'Base.SC2Data/GameData/CampaignData.xml',
          'Base.SC2Maps/Maps/Campaign/Fixture.SC2Map/MapInfo',
          'Base.SC2Maps/Maps/Campaign/Fixture.SC2Map/Objects',
          'CampaignData/Story.xml',
          'ComponentList.SC2Components',
          'DocumentInfo',
          'enUS.SC2Data/LocalizedData/GameStrings.txt',
          'UI/Layout/Campaign.SC2Layout',
        ],
      },
    ]
    for (const value of cases) {
      const session = await open(value.id, await fixture(value.sample))
      expect(await inspect(session)).toMatchObject(value.summary)
      const lease = await session.dataSource('common.view/namespace-entry-source', 1)
      const namespace = lease.value as NamespaceEntrySource
      const page = await namespace.list('', { limit: 20 })
      expect(page.items.map(item => item.path)).toEqual(value.names)
      if (value.id === 'sc2-map') {
        const extracted = await session.operations().invoke('extract-entry', { entryId: 'Objects' })
        expect(extracted).toMatchObject({ state: 'ok', output: { kind: 'bytes' } })
        if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes') {
          throw new Error('SC2Map stored entry was not extracted')
        }
        expect(new TextDecoder().decode(extracted.output.value)).toBe('<PlacedObjects/>')
      }
      await lease.release()
      await session.dispose()
    }
  })

  it('validates replay user data and classifies the contained MPQ streams without decoding events', async () => {
    const session = await open('sc2-replay', await fixture('minimal.SC2Replay'))
    expect(await inspect(session)).toMatchObject({
      format: 'sc2-replay',
      signature: 'StarCraft II replay',
      signatureOffset: 16,
      knownStreams: 5,
      streamNames: [
        'replay.attributes.events',
        'replay.details',
        'replay.game.events',
        'replay.initData',
        'replay.tracker.events',
      ],
    })
    const lease = await session.dataSource('common.view/table-data-source', 1)
    const table = lease.value as TableDataSource
    expect(await table.shape()).toMatchObject({
      header: ['Path', 'Bytes', 'Replay role'],
      rows: 6,
    })
    await lease.release()
    await session.dispose()
  })

  it('does not reinterpret a generic MPQ as a map, mod, campaign, or replay', async () => {
    const bytes = await fixture('minimal.mpq')
    await expect(open('sc2-map', bytes)).rejects.toThrow(/map documents/u)
    await expect(open('sc2-mod', bytes)).rejects.toThrow(/ComponentList|GameData/u)
    await expect(open('sc2-campaign', bytes)).rejects.toThrow(/CampaignData|SC2Map roots/u)
    await expect(open('sc2-replay', bytes)).rejects.toThrow(/replay signature/u)
  })

  it('requires campaign-specific structure and does not reinterpret packed maps or mods', async () => {
    await expect(open('sc2-campaign', await fixture('minimal.SC2Map'))).rejects.toThrow(
      /CampaignData|SC2Map roots/u,
    )
    await expect(open('sc2-campaign', await fixture('minimal.SC2Mod'))).rejects.toThrow(
      /CampaignData|SC2Map roots/u,
    )
  })
})
