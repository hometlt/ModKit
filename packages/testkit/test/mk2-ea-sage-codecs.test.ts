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
  type TreeDataSource,
} from '@modkitx-x3/sdk'

type CodecId = 'cnc3-data' | 'cnc3-localization' | 'cnc3-map' | 'sage-skudef'

const root = join(import.meta.dirname, '..', '..', '..')
const extension = join(root, 'extensions', 'ea', 'sage')
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
      throw new Error('EA SAGE codecs have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('EA SAGE codecs have no foreign service dependency')
    },
  },
}

function source(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://ea-sage/${name}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:ea-sage-${name}`),
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
  const module = (await import(pathToFileURL(join(extension, 'src', id, 'codec.js')).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  return module.createCodec(context)
}

async function open(id: CodecId, bytes: Uint8Array, name: string, resourceBudget = budget) {
  return (await codec(id)).open(input(source(bytes, name)), 'inspect', resourceBudget)
}

async function inspect(session: Awaited<ReturnType<typeof open>>) {
  const result = await session.operations().invoke('inspect', null)
  if (result.state !== 'ok' || result.output.kind !== 'json') throw new Error('inspect failed')
  return result.output.value
}

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(fixtureRoot, name)))
}

function csfWithExtraValue(bytes: Uint8Array, value: string): Uint8Array {
  const result = new Uint8Array(bytes.byteLength + 8 + value.length * 2)
  result.set(bytes)
  const cursor = bytes.byteLength
  result.set(new TextEncoder().encode(' RTS'), cursor)
  const view = new DataView(result.buffer)
  view.setUint32(12, 2, true)
  view.setUint32(28, 2, true)
  view.setUint32(cursor + 4, value.length, true)
  for (let index = 0; index < value.length; index += 1)
    view.setUint16(cursor + 8 + index * 2, ~value.charCodeAt(index) & 0xffff, true)
  return result
}

function ckmpWithRawChunk(name: string, payload: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(name)
  const result = new Uint8Array(8 + 1 + nameBytes.byteLength + 4 + 10 + payload.byteLength)
  result.set(new TextEncoder().encode('CkMp'))
  const view = new DataView(result.buffer)
  view.setUint32(4, 1, true)
  let cursor = 8
  result[cursor] = nameBytes.byteLength
  cursor += 1
  result.set(nameBytes, cursor)
  cursor += nameBytes.byteLength
  view.setUint32(cursor, 7, true)
  cursor += 4
  view.setUint32(cursor, 7, true)
  view.setUint16(cursor + 4, 1, true)
  view.setUint32(cursor + 6, payload.byteLength, true)
  result.set(payload, cursor + 10)
  return result
}

describe('ported EA SAGE semantic codecs', () => {
  it('inventories authored AssetDeclaration includes and direct assets', async () => {
    const session = await open('cnc3-data', await fixture('minimal.cnc3-data.xml'), 'fixture.xml')
    expect(await inspect(session)).toMatchObject({
      format: 'cnc3-data',
      namespace: 'uri:ea.com:eala:asset',
      includes: [
        { source: 'DATA:global.xml', path: 'data/global.xml', type: 'reference' },
        { source: 'ART:EVDefault.xml', path: 'art/EVDefault.xml', type: 'all' },
      ],
      assets: [
        { type: 'GameMap', id: 'FixtureMap' },
        { type: 'GameScriptList', id: 'FixtureScripts' },
      ],
      assetCountsByType: { GameMap: 1, GameScriptList: 1 },
      includeResolution: 'paths-only',
    })
    const tableLease = await session.dataSource('common.view/table-data-source', 1)
    const table = tableLease.value as TableDataSource
    expect(await table.shape()).toEqual({
      rows: 2,
      columns: 2,
      header: ['Type', 'Id'],
    })
    expect((await table.rows({ kind: 'range', from: 0, count: 10 })).items).toEqual([
      { index: 0, cells: ['GameMap', 'FixtureMap'] },
      { index: 1, cells: ['GameScriptList', 'FixtureScripts'] },
    ])
    await tableLease.release()
    await session.dispose()
  })

  it('preserves nested AssetDeclaration bodies in the lazy tree', async () => {
    const xml = new TextEncoder().encode(`
      <AssetDeclaration xmlns="uri:ea.com:eala:asset">
        <GameMap id="NestedMap">
          <WorldBuilderMapInfo>
            <MapMetaData displayName="Fixture"/>
          </WorldBuilderMapInfo>
        </GameMap>
      </AssetDeclaration>
    `)
    const session = await open('cnc3-data', xml, 'nested.xml')
    const lease = await session.dataSource('common.view/tree-data-source', 1)
    const tree = lease.value as TreeDataSource
    const root = await tree.root()
    expect(await tree.facts(root)).toMatchObject({ kind: 'catalog', label: 'AssetDeclaration' })
    const gameMap = (await tree.children(root, { limit: 10 })).items[0]
    if (gameMap === undefined) throw new Error('nested fixture has no GameMap node')
    expect(await tree.facts(gameMap)).toMatchObject({
      kind: 'asset',
      label: 'GameMap',
      preview: 'id=NestedMap',
    })
    const mapInfo = (await tree.children(gameMap, { limit: 10 })).items[0]
    if (mapInfo === undefined) throw new Error('nested fixture has no WorldBuilderMapInfo node')
    expect(await tree.facts(mapInfo)).toMatchObject({
      kind: 'element',
      label: 'WorldBuilderMapInfo',
    })
    const metadata = (await tree.children(mapInfo, { limit: 10 })).items[0]
    if (metadata === undefined) throw new Error('nested fixture has no MapMetaData node')
    expect(await tree.facts(metadata)).toMatchObject({
      kind: 'element',
      label: 'MapMetaData',
      preview: 'displayName=Fixture',
    })
    await lease.release()
    await session.dispose()
  })

  it('decodes compiled CSF values and authored STR blocks into the table surface', async () => {
    const csf = csfWithExtraValue(
      await fixture('minimal.cnc3-localization.csf'),
      'Fixture duplicate',
    )
    const session = await open('cnc3-localization', csf, 'fixture.csf')
    expect(await inspect(session)).toMatchObject({
      format: 'cnc3-localization',
      encoding: 'csf',
      version: 3,
      labels: 1,
      strings: 2,
      notes: 1,
      extraValues: 1,
    })
    const lease = await session.dataSource('common.view/table-data-source', 1)
    const table = lease.value as TableDataSource
    expect(await table.shape()).toEqual({
      rows: 2,
      columns: 4,
      header: ['Key', 'Value', 'Duplicate', 'WRTS note'],
    })
    const page = await table.rows({ kind: 'range', from: 0, count: 10 })
    expect(page.items.map(row => row.cells)).toEqual([
      ['GUI:Fixture', 'Fixture value', '0', 'fixture note'],
      ['GUI:Fixture', 'Fixture duplicate', '1', ''],
    ])
    await lease.release()
    const textLease = await session.dataSource('common.view/text-data-source', 1)
    const text = textLease.value as TextDataSource
    const slice = await text.slice({ kind: 'from-line', line: 0, lineCount: 10, maxBytes: 4096 })
    expect(slice.text).toContain('GUI:Fixture\tFixture value\t0\tfixture note')
    expect(slice.text).toContain('GUI:Fixture\tFixture duplicate\t1\t')
    await textLease.release()
    await session.dispose()

    const str = new TextEncoder().encode('// source\nGUI:Hello\n"Hello\\nCommander"\nEND\n')
    const strSession = await open('cnc3-localization', str, 'fixture.str')
    expect(await inspect(strSession)).toMatchObject({ encoding: 'str', labels: 1, strings: 1 })
    const strTableLease = await strSession.dataSource('common.view/table-data-source', 1)
    const strTable = strTableLease.value as TableDataSource
    expect((await strTable.rows({ kind: 'range', from: 0, count: 10 })).items[0]?.cells).toEqual([
      'GUI:Hello',
      'Hello\\nCommander',
      '0',
      '',
    ])
    await strTableLease.release()
    await strSession.dispose()
  })

  it('expands an EAR RefPack envelope and inventories CkMp chunks and dimensions', async () => {
    const session = await open('cnc3-map', await fixture('minimal.cnc3.map'), 'fixture.map')
    expect(await inspect(session)).toMatchObject({
      format: 'cnc3-map',
      envelope: 'ear-refpack',
      expandedBytes: 48,
      names: ['HeightMapData'],
      chunks: [{ id: '0', name: 'HeightMapData', version: 2, offset: 36, byteLength: 12 }],
      dimensions: { width: 256, height: 128, borderSize: 16 },
    })
    const lease = await session.dataSource('common.view/namespace-entry-source', 1)
    const namespace = lease.value as NamespaceEntrySource
    const page = await namespace.list('', { limit: 10 })
    expect(page.items.map(item => [item.id, item.path, item.size, item.storedSize])).toEqual([
      ['0', 'HeightMapData', 12n, 12n],
    ])
    await lease.release()
    const extracted = await session.operations().invoke('extract-entry', { entryId: '0' })
    if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes')
      throw new Error('CkMp extraction failed')
    expect(Array.from(extracted.output.value)).toEqual([0, 1, 0, 0, 128, 0, 0, 0, 16, 0, 0, 0])
    const treeLease = await session.dataSource('common.view/tree-data-source', 1)
    const tree = treeLease.value as TreeDataSource
    const root = await tree.root()
    const sections = (await tree.children(root, { limit: 10 })).items
    expect(await Promise.all(sections.map(node => tree.facts(node)))).toMatchObject([
      { kind: 'section', label: 'Directory' },
      { kind: 'section', label: 'Chunks' },
    ])
    const chunks = sections[1]
    if (chunks === undefined) throw new Error('CkMp tree has no chunks section')
    const heightMap = (await tree.children(chunks, { limit: 10 })).items[0]
    if (heightMap === undefined) throw new Error('CkMp tree has no HeightMapData chunk')
    expect(await tree.facts(heightMap)).toMatchObject({
      kind: 'height-map',
      label: 'HeightMapData',
    })
    const dimensions = await tree.children(heightMap, { limit: 10 })
    expect(await Promise.all(dimensions.items.map(node => tree.facts(node)))).toMatchObject([
      { kind: 'scalar', label: 'Width', preview: '256' },
      { kind: 'scalar', label: 'Height', preview: '128' },
      { kind: 'scalar', label: 'Border size', preview: '16' },
    ])
    await treeLease.release()
    await session.dispose()

    const rawSession = await open(
      'cnc3-map',
      ckmpWithRawChunk('UnknownData', new Uint8Array([1, 2, 3])),
      'raw.map',
    )
    const rawTreeLease = await rawSession.dataSource('common.view/tree-data-source', 1)
    const rawTree = rawTreeLease.value as TreeDataSource
    const rawRoot = await rawTree.root()
    const rawSections = (await rawTree.children(rawRoot, { limit: 10 })).items
    const rawChunks = rawSections[1]
    if (rawChunks === undefined) throw new Error('raw CkMp tree has no chunks section')
    const rawChunk = (await rawTree.children(rawChunks, { limit: 10 })).items[0]
    if (rawChunk === undefined) throw new Error('raw CkMp tree has no chunk')
    expect(await rawTree.facts(rawChunk)).toMatchObject({
      kind: 'raw-chunk',
      label: 'UnknownData',
    })
    const rawExtracted = await rawSession.operations().invoke('extract-entry', { entryId: '0' })
    if (rawExtracted.state !== 'ok' || rawExtracted.output.kind !== 'bytes')
      throw new Error('raw CkMp extraction failed')
    expect(Array.from(rawExtracted.output.value)).toEqual([1, 2, 3])
    await rawTreeLease.release()
    await rawSession.dispose()
  })

  it('preserves SkuDef directive order and exposes typed unresolved references', async () => {
    const session = await open(
      'sage-skudef',
      await fixture('minimal.sage.skudef'),
      'fixture.skudef',
    )
    expect(await inspect(session)).toMatchObject({
      format: 'sage-skudef',
      directives: 5,
      resolution: 'not-performed',
    })
    const namespaceLease = await session.dataSource('common.view/namespace-entry-source', 1)
    const namespace = namespaceLease.value as NamespaceEntrySource
    const page = await namespace.list('', { limit: 10 })
    expect(page.items.map(item => [item.id, item.path, item.kind])).toEqual([
      ['0', 'CNC3.exe', 'file'],
      ['1', 'Core/1.0/config.txt', 'file'],
      ['2', 'Core/1.0/core.big', 'file'],
      ['3', 'Mods/Fixture', 'file'],
      ['4', 'Fixture', 'file'],
    ])
    expect((await namespace.list('Core/', { limit: 10 })).items.map(item => item.id)).toEqual([
      '1',
      '2',
    ])
    await namespaceLease.release()

    const treeLease = await session.dataSource('common.view/tree-data-source', 1)
    const tree = treeLease.value as TreeDataSource
    const root = await tree.root()
    const directives = (await tree.children(root, { limit: 10 })).items
    expect(await Promise.all(directives.map(node => tree.facts(node)))).toMatchObject([
      {
        kind: 'set-exe',
        label: 'CNC3.exe',
        preview: 'line 2',
        semanticPath: ['2', 'set-exe'],
      },
      { kind: 'add-config', label: 'Core\\1.0\\config.txt' },
      { kind: 'add-big', label: 'Core\\1.0\\core.big' },
      { kind: 'add-search-path', label: 'Mods\\Fixture' },
      { kind: 'mod-name', label: 'Fixture' },
    ])
    expect((await session.descriptor()).constraints.unsupportedFeatures).toContain(
      'external-reference-byte-opening',
    )
    await treeLease.release()
    await session.dispose()
  })

  it('rejects malformed structure, corrupt counts, and expansion budget overflow', async () => {
    const xml = new TextEncoder().encode('<AssetDeclaration><GameMap></AssetDeclaration>')
    await expect(open('cnc3-data', xml, 'bad.xml')).rejects.toThrow(/nesting/u)

    const csf = await fixture('minimal.cnc3-localization.csf')
    const wrongCount = csf.slice()
    new DataView(wrongCount.buffer).setUint32(12, 2, true)
    await expect(open('cnc3-localization', wrongCount, 'bad.csf')).rejects.toThrow(
      /count mismatch/u,
    )

    const map = await fixture('minimal.cnc3.map')
    await expect(
      open('cnc3-map', map, 'small.map', { ...budget, maxScalarBytes: 47 }),
    ).rejects.toThrow(/maxScalarBytes/u)
  })
})
