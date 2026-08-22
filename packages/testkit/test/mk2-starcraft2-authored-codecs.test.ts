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
  type ResourceBudget,
  type TableDataSource,
  type TextDataSource,
} from '@modkitx-x3/sdk'

type CodecId = 'galaxy' | 'sc2-strings' | 'sc2-layout' | 'sc2-data'

const root = join(import.meta.dirname, '..', '..', '..')
const extension = join(root, 'extensions', 'mk2', 'blizzard-starcraft2')
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
  const module = (await import(pathToFileURL(join(extension, 'src', id, 'codec.js')).href)) as {
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

describe('ported StarCraft II authored-text codecs', () => {
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
        columns: ['Kind', 'Name', 'Type / Value'],
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
    await expect(open('sc2-layout', encode('<Desc><Frame></Desc>'))).rejects.toThrow(/nesting/u)
    await expect(
      open('sc2-data', encode('<Catalog><CUnit id="A"/></Catalog>'), { ...budget, maxNodes: 1 }),
    ).rejects.toThrow(/maxNodes/u)
    await expect(
      open('galaxy', await fixture('minimal.galaxy'), { ...budget, maxScalarBytes: 8 }),
    ).rejects.toThrow(/maxScalarBytes/u)
  })
})
