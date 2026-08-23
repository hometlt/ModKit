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
  type TreeDataSource,
  type VideoMediaSource,
} from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const videoRoot = join(repoRoot, 'extensions', 'common', 'video')
const fixtureRoot = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')
const formats = ['avi', 'wmv'] as const
type Format = (typeof formats)[number]

const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 16,
  maxNodes: 10_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('MK2 video codecs have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('MK2 video codecs have no foreign service dependency')
    },
  },
}

function byteSource(format: Format, bytes: Uint8Array): ArtifactByteSource {
  const uri = `memory://mk2-video-codecs/minimal.${format}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:mk2-video-${format}`),
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
      compositionFingerprint: `mk2-video-${source.ref.id}`,
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
  const module = (await import(pathToFileURL(join(videoRoot, 'src', format, 'codec.js')).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  return module.createCodec(context)
}

async function fixture(format: Format): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(fixtureRoot, `minimal.${format}`)))
}

async function open(format: Format, bytes: Uint8Array, resourceBudget = budget) {
  const codec = await codecFor(format)
  const source = byteSource(format, bytes)
  return codec.open(inputFor(source), 'inspect', resourceBudget)
}

describe('ported MK2 AVI and WMV container codecs', () => {
  it.each(formats)('%s publishes validated video metadata and bounded sources', async format => {
    const session = await open(format, await fixture(format))
    const descriptor = await session.descriptor()
    expect(descriptor.traits).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'video.streams' })]),
    )
    expect(descriptor.constraints.maxDecodedBytes).not.toBe('0')

    const videoLease = await session.dataSource('common.view/video-media-source', 1)
    const video = videoLease.value as VideoMediaSource
    expect(await video.info()).toMatchObject({
      tracks: [
        expect.objectContaining({
          kind: 'video',
          codec: format === 'avi' ? 'DIB' : 'WMV3',
          width: 1,
          height: 1,
        }),
      ],
      frameAccess: false,
    })
    expect((await (await video.encoded()).descriptor()).mediaType).toMatch(/^video\//u)

    const treeLease = await session.dataSource('common.view/tree-data-source', 1)
    const tree = treeLease.value as TreeDataSource
    const root = await tree.root()
    expect((await tree.children(root, { limit: 100 })).items.length).toBeGreaterThan(3)
    await treeLease.release()
    await videoLease.release()
    await session.dispose()
  })

  it('derives AVI timing, dimensions, stream codec, and media-chunk inventory', async () => {
    const session = await open('avi', await fixture('avi'))
    await expect(session.operations().invoke('inspect', null)).resolves.toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: {
          format: 'avi',
          width: 1,
          height: 1,
          durationMs: 33,
          totalFrames: 1,
          streams: ['video:DIB'],
          mediaChunks: 1,
        },
      },
    })
    await session.dispose()
  })

  it('derives ASF mandatory-object, stream, file-size, and packet metadata', async () => {
    const bytes = await fixture('wmv')
    const session = await open('wmv', bytes)
    await expect(session.operations().invoke('inspect', null)).resolves.toMatchObject({
      state: 'ok',
      output: {
        kind: 'json',
        value: {
          format: 'wmv',
          container: 'asf',
          fileSize: bytes.byteLength,
          durationMs: 0,
          dataPackets: 0,
          streams: ['video:WMV3'],
          objects: 4,
        },
      },
    })
    await session.dispose()
  })

  it.each(formats)('%s rejects structural corruption', async format => {
    const corrupted = (await fixture(format)).slice()
    if (format === 'avi') new DataView(corrupted.buffer).setUint32(4, corrupted.byteLength, true)
    else corrupted[28] = 0
    await expect(open(format, corrupted)).rejects.toThrow(/AVI|ASF/u)
  })

  it.each(formats)('%s enforces node, depth, and scalar budgets', async format => {
    const bytes = await fixture(format)
    await expect(open(format, bytes, { ...budget, maxNodes: 0 })).rejects.toThrow(/maxNodes/u)
    await expect(open(format, bytes, { ...budget, maxDepth: 0 })).rejects.toThrow(/maxDepth/u)
    await expect(open(format, bytes, { ...budget, maxScalarBytes: 5 })).rejects.toThrow(
      /maxScalarBytes/u,
    )
  })
})
