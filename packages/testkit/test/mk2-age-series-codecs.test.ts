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
  type RasterImageSource,
  type ResourceBudget,
  type TreeDataSource,
} from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const extensionRoot = join(repoRoot, 'extensions', 'mk2', 'microsoft-age-series')
const fixtureRoot = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')
const formats = ['age-bar', 'age-drs', 'ddt'] as const
type Format = (typeof formats)[number]

const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('Age codecs have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('Age codecs have no foreign service dependency')
    },
  },
}

function byteSource(format: Format, bytes: Uint8Array): ArtifactByteSource {
  const uri = `memory://mk2-age-codecs/minimal.${format}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:mk2-age-${format}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      if (signal?.aborted) throw new Error('cancelled')
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

function inputFor(source: ArtifactByteSource): AssetInput {
  const binding = {
    sourceKind: 'candidate' as const,
    bindingId: 'content',
    role: 'content',
    ownership: 'owned' as const,
    source: source.ref,
    revision: source.revision,
  }
  return {
    originKind: 'single',
    bindings: [binding],
    primaryBindingId: binding.bindingId,
    revisions: {
      topology: 'single',
      revision: source.revision,
      bindings: [{ bindingId: binding.bindingId, revision: source.revision }],
      compositionFingerprint: `mk2-age-${source.ref.id}`,
    },
    bindingsFor: () => [],
    async openBinding() {
      return {
        value: source,
        async release() {
          return undefined
        },
      }
    },
  }
}

async function codecFor(format: Format): Promise<Codec> {
  const module = (await import(
    pathToFileURL(join(extensionRoot, 'src', format, 'codec.js')).href
  )) as { createCodec(context: ContributionContext): Codec }
  return module.createCodec(context)
}

async function fixture(format: Format): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(fixtureRoot, `minimal.${format}`)))
}

async function open(format: Format, bytes: Uint8Array, resourceBudget = budget) {
  const codec = await codecFor(format)
  return codec.open(inputFor(byteSource(format, bytes)), 'inspect', resourceBudget)
}

async function extract(session: Awaited<ReturnType<typeof open>>, entryId: string) {
  const result = await session.operations().invoke('extract-entry', { entryId })
  if (result.state !== 'ok' || result.output.kind !== 'bytes') {
    throw new Error(`entry ${entryId} did not extract to bytes`)
  }
  return result.output.value
}

async function summary(session: Awaited<ReturnType<typeof open>>) {
  const result = await session.operations().invoke('inspect', null)
  if (result.state !== 'ok' || result.output.kind !== 'json') {
    throw new Error('inspect did not return JSON')
  }
  return result.output.value
}

describe('ported Microsoft Age Series codecs', () => {
  it('walks and extracts stored, l33t and alz4 ESPN BAR entries', async () => {
    const session = await open('age-bar', await fixture('age-bar'))
    const descriptor = await session.descriptor()
    expect(await summary(session)).toMatchObject({
      layout: 'espn',
      version: 5,
      entries: 3,
      rootPath: 'art',
    })
    expect(descriptor.traits).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'container.entries' })]),
    )
    const lease = await session.dataSource('common.view/namespace-entry-source', 1)
    const namespace = lease.value as NamespaceEntrySource
    const first = await namespace.list('', { limit: 2 })
    expect(first.items.map(item => item.path)).toEqual([
      'art/data/proto.xmb',
      'art/strings/help.txt',
    ])
    expect(first.nextCursor).toBe('2')
    if (first.nextCursor === undefined) throw new Error('BAR pagination cursor is missing')
    expect(
      (await namespace.list('', { limit: 2, cursor: first.nextCursor })).items.map(
        item => item.path,
      ),
    ).toEqual(['art/textures/icon.ddt'])
    await expect(extract(session, '0')).resolves.toEqual(new TextEncoder().encode('<xmb/>'))
    await expect(extract(session, '1')).resolves.toEqual(new TextEncoder().encode('hello l33t\n'))
    await expect(extract(session, '2')).resolves.toEqual(new TextEncoder().encode('hello alz4\n'))
    await lease.release()
    await session.dispose()
  })

  it('decodes reverse-order DRS tags, lists stable paths and extracts resources', async () => {
    const session = await open('age-drs', await fixture('age-drs'))
    expect(await summary(session)).toMatchObject({
      headerVariant: 'aoe',
      tables: 2,
      resources: 2,
    })
    const namespaceLease = await session.dataSource('common.view/namespace-entry-source', 1)
    const namespace = namespaceLease.value as NamespaceEntrySource
    const page = await namespace.list('', { limit: 10 })
    expect(page.items.map(item => item.path)).toEqual(['slp/42.slp', 'wav/7.wav'])
    await expect(extract(session, '0')).resolves.toEqual(new TextEncoder().encode('sprite'))
    await expect(extract(session, '1')).resolves.toEqual(new TextEncoder().encode('sound'))
    const treeLease = await session.dataSource('common.view/tree-data-source', 1)
    const tree = treeLease.value as TreeDataSource
    expect((await tree.children(await tree.root(), { limit: 10 })).items).toHaveLength(2)
    await treeLease.release()
    await namespaceLease.release()
    await session.dispose()
  })

  it.each([
    { format: 'DXT1', bytes: ddtBytes([0, 0, 4], new Uint8Array([0x00, 0xf8, 0, 0, 0, 0, 0, 0])) },
    {
      format: 'DXT3',
      bytes: ddtBytes(
        [0, 0, 8],
        new Uint8Array([
          0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00, 0xf8, 0, 0, 0, 0, 0, 0,
        ]),
      ),
    },
    {
      format: 'DXT5',
      bytes: ddtBytes(
        [1, 0, 8],
        new Uint8Array([0xff, 0, 0, 0, 0, 0, 0, 0, 0x00, 0xf8, 0, 0, 0, 0, 0, 0]),
      ),
    },
  ])('decodes $format DDT blocks to bounded RGBA regions', async testCase => {
    const session = await open('ddt', testCase.bytes)
    expect(await summary(session)).toMatchObject({
      encoding: testCase.format,
      width: 4,
      height: 4,
    })
    const lease = await session.dataSource('common.view/raster-image-source', 1)
    const raster = lease.value as RasterImageSource
    expect(await raster.info()).toMatchObject({
      width: 4,
      height: 4,
      mipLevels: 1,
      decodedAccess: true,
    })
    if (raster.readRegion === undefined) throw new Error('DDT raster source has no decoded access')
    const region = await raster.readRegion({
      x: 0,
      y: 0,
      width: 4,
      height: 4,
      pixelFormat: 'rgba8',
      maxBytes: 64,
    })
    expect(region.pixels).toHaveLength(64)
    expect(Array.from(region.pixels.slice(0, 4))).toEqual([255, 0, 0, 255])
    expect(Array.from(region.pixels.slice(-4))).toEqual([255, 0, 0, 255])
    await lease.release()
    await session.dispose()
  })

  it.each(formats)('%s rejects a structurally corrupted source', async format => {
    const bytes = await fixture(format)
    const corrupted = bytes.slice()
    const view = new DataView(corrupted.buffer, corrupted.byteOffset, corrupted.byteLength)
    if (format === 'age-bar') view.setBigUint64(288, 0xffffffffffffffffn, true)
    else if (format === 'age-drs') view.setUint32(64 + 4, corrupted.byteLength + 1, true)
    else view.setUint32(20, 7, true)
    await expect(open(format, corrupted)).rejects.toThrow(/BAR|DRS|DDT/u)
  })

  it.each(formats)('%s enforces node and scalar budgets', async format => {
    const bytes = await fixture(format)
    await expect(open(format, bytes, { ...budget, maxNodes: 0 })).rejects.toThrow(/maxNodes/u)
    if (format === 'ddt') {
      await expect(open(format, bytes, { ...budget, maxScalarBytes: 63 })).rejects.toThrow(
        /maxScalarBytes/u,
      )
      return
    }
    const session = await open(format, bytes, { ...budget, maxScalarBytes: 1 })
    const operation = session.operations().invoke('extract-entry', { entryId: '0' })
    await expect(operation).rejects.toThrow(/maxScalarBytes/u)
    await session.dispose()
  })
})

function ddtBytes(flags: readonly number[], block: Uint8Array): Uint8Array {
  const out = new Uint8Array(24 + block.byteLength)
  out.set(new TextEncoder().encode('RTS3'), 0)
  out.set(flags, 4)
  out[7] = 1
  const view = new DataView(out.buffer)
  view.setUint32(8, 4, true)
  view.setUint32(12, 4, true)
  view.setUint32(16, 24, true)
  view.setUint32(20, block.byteLength, true)
  out.set(block, 24)
  return out
}
