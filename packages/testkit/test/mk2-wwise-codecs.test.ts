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
  type NamespaceEntrySource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'

const root = join(import.meta.dirname, '..', '..', '..')
const extension = join(root, 'extensions', 'mk2', 'audiokinetic-wwise')
const fixtures = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')
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
      throw new Error('Wwise codecs have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('Wwise codecs have no foreign service dependency')
    },
  },
}

function source(format: string, bytes: Uint8Array): ArtifactByteSource {
  const uri = `memory://wwise/${format}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:wwise-${format}`),
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

async function fixture(name: string) {
  return new Uint8Array(await readFile(join(fixtures, name)))
}

async function codec(format: string): Promise<Codec> {
  const module = (await import(pathToFileURL(join(extension, 'src', format, 'codec.js')).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  return module.createCodec(context)
}

async function open(format: string, bytes: Uint8Array, resourceBudget = budget) {
  return (await codec(format)).open(input(source(format, bytes)), 'inspect', resourceBudget)
}

async function inspect(session: Awaited<ReturnType<typeof open>>) {
  const result = await session.operations().invoke('inspect', null)
  if (result.state !== 'ok' || result.output.kind !== 'json') throw new Error('inspect failed')
  return result.output.value
}

describe('ported Audiokinetic Wwise codecs', () => {
  it('inspects a RIFF WEM and publishes its encoded audio stream', async () => {
    const session = await open('wem', await fixture('minimal.wem'))
    expect(await inspect(session)).toMatchObject({
      format: 'wem',
      riff: 'RIFF',
      codec: 'pcm',
      channels: 1,
      sampleRate: 8000,
      bitsPerSample: 8,
      dataBytes: 4,
    })
    const lease = await session.dataSource('common.view/audio-media-source', 1)
    const audio = lease.value as AudioMediaSource
    expect(await audio.info()).toMatchObject({ tracks: [{ id: 'stream-0', codec: 'pcm' }] })
    expect(new TextDecoder('ascii').decode(await (await audio.encoded()).read(0n, 4))).toBe('RIFF')
    await lease.release()
    await session.dispose()
  })

  it('walks BNK chunks and exposes the first embedded DIDX/DATA WEM', async () => {
    const session = await open('bnk', await fixture('minimal.bnk'))
    expect(await inspect(session)).toMatchObject({
      format: 'bnk',
      bankVersion: 135,
      bankId: 42,
      chunks: 3,
      streams: 1,
      dataBytes: 48,
    })
    const lease = await session.dataSource('common.view/audio-media-source', 1)
    const audio = lease.value as AudioMediaSource
    expect(new TextDecoder('ascii').decode(await (await audio.encoded()).read(0n, 4))).toBe('RIFF')
    await lease.release()
    await session.dispose()
  })

  it('indexes a little-endian AKPK sound table', async () => {
    const session = await open('wwise-pck', await fixture('minimal.wwise.pck'))
    expect(await inspect(session)).toMatchObject({
      format: 'wwise-pck',
      endian: 'little',
      banks: 0,
      sounds: 1,
      entries: 1,
    })
    const lease = await session.dataSource('common.view/namespace-entry-source', 1)
    const namespace = lease.value as NamespaceEntrySource
    expect((await namespace.list('', { limit: 10 })).items).toMatchObject([
      { path: '5678.wem', size: 48n },
    ])
    await lease.release()
    await session.dispose()
  })

  it('rejects damaged indexes and enforces budgets', async () => {
    const wem = await fixture('minimal.wem')
    const badWem = wem.slice()
    new DataView(badWem.buffer).setUint32(4, wem.byteLength, true)
    await expect(open('wem', badWem)).rejects.toThrow(/RIFF size/u)

    const bnk = await fixture('minimal.bnk')
    const badBnk = bnk.slice()
    new DataView(badBnk.buffer).setUint32(28, 0xffffffff, true)
    await expect(open('bnk', badBnk)).rejects.toThrow(/outside DATA/u)

    const pck = await fixture('minimal.wwise.pck')
    const badPck = pck.slice()
    new DataView(badPck.buffer).setUint32(40, 0xffffffff, true)
    await expect(open('wwise-pck', badPck)).rejects.toThrow(/out of bounds/u)
    await expect(open('wwise-pck', pck, { ...budget, maxNodes: 0 })).rejects.toThrow(/maxNodes/u)
  })
})
