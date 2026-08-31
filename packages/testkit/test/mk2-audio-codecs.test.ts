import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type AudioMediaSource,
  type Codec,
  type ContributionContext,
  type ResourceBudget,
  type TreeDataSource,
} from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const extensionRoot = join(repoRoot, 'extensions', 'audio')
const fixtureRoot = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')
const budget: ResourceBudget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 32,
  maxNodes: 10_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('audio codecs have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('audio codecs have no foreign service dependency')
    },
  },
}

function source(format: string, bytes: Uint8Array): ArtifactByteSource {
  const uri = `memory://mk2-audio/minimal.${format}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:mk2-audio-${format}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

function inputFor(value: ArtifactByteSource): AssetInput {
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
    primaryBindingId: binding.bindingId,
    revisions: {
      topology: 'single',
      revision: value.revision,
      bindings: [{ bindingId: binding.bindingId, revision: value.revision }],
      compositionFingerprint: `mk2-audio-${value.ref.id}`,
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

async function fixture(format: string) {
  return new Uint8Array(await readFile(join(fixtureRoot, `minimal.${format}`)))
}

async function codecFor(format: string): Promise<Codec> {
  const module = (await import(
    pathToFileURL(join(extensionRoot, 'src', format, 'codec.js')).href
  )) as { createCodec(context: ContributionContext): Codec }
  return module.createCodec(context)
}

async function open(format: string, bytes: Uint8Array, resourceBudget = budget) {
  return (await codecFor(format)).open(inputFor(source(format, bytes)), 'inspect', resourceBudget)
}

async function summary(session: Awaited<ReturnType<typeof open>>) {
  const result = await session.operations().invoke('inspect', null)
  if (result.state !== 'ok' || result.output.kind !== 'json') throw new Error('inspect failed')
  return result.output.value
}

describe('ported common audio codecs', () => {
  it('walks every ADTS frame and publishes bounded AAC media', async () => {
    const bytes = await fixture('aac')
    const session = await open('aac', bytes)
    expect(await summary(session)).toMatchObject({
      format: 'aac',
      container: 'adts',
      mpegVersion: 4,
      profile: 'LC',
      sampleRate: 8000,
      channels: 1,
      frames: 2,
      samples: 2048,
      durationMs: 256,
    })
    const audioLease = await session.dataSource('common.view/audio-media-source', 1)
    const audio = audioLease.value as AudioMediaSource
    expect(await audio.info()).toMatchObject({
      durationMs: 256,
      tracks: [{ codec: 'aac-lc', channels: 1, sampleRate: 8000 }],
    })
    const treeLease = await session.dataSource('common.view/tree-data-source', 1)
    const tree = treeLease.value as TreeDataSource
    expect((await tree.children(await tree.root(), { limit: 10 })).items).toHaveLength(2)
    await treeLease.release()
    await audioLease.release()
    await session.dispose()
  })

  it('parses FLAC STREAMINFO and exposes the encoded lossless stream', async () => {
    const bytes = await fixture('flac')
    const session = await open('flac', bytes)
    expect(await summary(session)).toMatchObject({
      format: 'flac',
      sampleRate: 8000,
      channels: 1,
      bitsPerSample: 8,
      totalSamples: '16',
      durationMs: 2,
      minimumBlockSize: 16,
      maximumBlockSize: 16,
      metadataBlocks: 1,
    })
    const lease = await session.dataSource('common.view/audio-media-source', 1)
    const audio = lease.value as AudioMediaSource
    expect(await audio.info()).toMatchObject({
      durationMs: 2,
      tracks: [{ codec: 'flac', channels: 1, sampleRate: 8000 }],
    })
    expect(new TextDecoder('ascii').decode(await (await audio.encoded()).read(0n, 4))).toBe('fLaC')
    await lease.release()
    await session.dispose()
  })

  it('walks a nested ISO BMFF audio track and publishes M4A media', async () => {
    const bytes = await fixture('m4a')
    const session = await open('m4a', bytes)
    expect(await summary(session)).toMatchObject({
      format: 'm4a',
      container: 'iso-bmff',
      majorBrand: 'M4A ',
      codec: 'mp4a',
      channels: 1,
      bitsPerSample: 16,
      sampleRate: 8000,
      durationMs: 128,
      boxes: 16,
      mediaBytes: 1,
    })
    const lease = await session.dataSource('common.view/audio-media-source', 1)
    const audio = lease.value as AudioMediaSource
    expect(await audio.info()).toMatchObject({
      durationMs: 128,
      seekable: true,
      tracks: [{ codec: 'aac', channels: 1, sampleRate: 8000 }],
    })
    await lease.release()
    await session.dispose()
  })

  it('rejects damaged audio structures and enforces node/scalar budgets', async () => {
    const aac = await fixture('aac')
    const badAac = aac.slice()
    badAac[4] = 0xff
    await expect(open('aac', badAac)).rejects.toThrow(/AAC ADTS/u)
    await expect(open('aac', aac, { ...budget, maxNodes: 0 })).rejects.toThrow(/maxNodes/u)

    const flac = await fixture('flac')
    const badFlac = flac.slice()
    badFlac[7] = 33
    await expect(open('flac', badFlac)).rejects.toThrow(/FLAC/u)
    await expect(open('flac', flac, { ...budget, maxScalarBytes: 1 })).rejects.toThrow(
      /maxScalarBytes/u,
    )

    const m4a = await fixture('m4a')
    const badM4a = m4a.slice()
    new DataView(badM4a.buffer).setUint32(0, badM4a.byteLength + 1, false)
    await expect(open('m4a', badM4a)).rejects.toThrow(/M4A/u)
    await expect(open('m4a', m4a, { ...budget, maxNodes: 0 })).rejects.toThrow(/maxNodes/u)
  })
})
