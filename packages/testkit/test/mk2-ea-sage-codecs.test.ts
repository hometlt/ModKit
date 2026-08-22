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
} from '@modkitx-x3/sdk'

type CodecId = 'cnc3-data' | 'cnc3-localization' | 'cnc3-map'

const root = join(import.meta.dirname, '..', '..', '..')
const extension = join(root, 'extensions', 'mk2', 'ea-sage')
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
    await session.dispose()
  })

  it('decodes compiled CSF values and authored STR blocks into the table surface', async () => {
    const session = await open(
      'cnc3-localization',
      await fixture('minimal.cnc3-localization.csf'),
      'fixture.csf',
    )
    expect(await inspect(session)).toMatchObject({
      format: 'cnc3-localization',
      encoding: 'csf',
      version: 3,
      labels: 1,
      strings: 1,
      notes: 1,
    })
    const lease = await session.dataSource('common.view/table-data-source', 1)
    const table = lease.value as TableDataSource
    expect(await table.shape()).toMatchObject({ rows: 1, columns: 3 })
    const page = await table.rows({ kind: 'range', from: 0, count: 10 })
    expect(page.items[0]?.cells).toEqual(['GUI:Fixture', 'Fixture value', 'fixture note'])
    await lease.release()
    await session.dispose()

    const str = new TextEncoder().encode('// source\nGUI:Hello\n"Hello\\nCommander"\nEND\n')
    const strSession = await open('cnc3-localization', str, 'fixture.str')
    expect(await inspect(strSession)).toMatchObject({ encoding: 'str', labels: 1, strings: 1 })
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
    expect(page.items.map(item => [item.id, item.path, item.storedSize])).toEqual([
      ['0', 'HeightMapData', 12n],
    ])
    await lease.release()
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
