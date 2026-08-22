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

const root = join(import.meta.dirname, '..', '..', '..')
const extension = join(root, 'extensions', 'mk2', 'firelight-fmod')
const fixturePath = join(import.meta.dirname, 'fixtures', 'mk2-synthetic', 'minimal.fsb')
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
      throw new Error('FSB codec has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('FSB codec has no foreign service dependency')
    },
  },
}

function source(bytes: Uint8Array): ArtifactByteSource {
  const uri = 'memory://firelight-fmod/minimal.fsb'
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId('content-hash.sha256:firelight-fmod-fsb'),
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

async function fsbCodec(): Promise<Codec> {
  const module = (await import(pathToFileURL(join(extension, 'src', 'fsb', 'codec.js')).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  return module.createCodec(context)
}

async function open(bytes: Uint8Array, resourceBudget = budget) {
  return (await fsbCodec()).open(input(source(bytes)), 'inspect', resourceBudget)
}

async function inspect(session: Awaited<ReturnType<typeof open>>) {
  const result = await session.operations().invoke('inspect', null)
  if (result.state !== 'ok' || result.output.kind !== 'json') throw new Error('inspect failed')
  return result.output.value
}

describe('ported Firelight FMOD codec', () => {
  it('parses the FSB5 sample table and publishes the encoded sound bank', async () => {
    const bytes = new Uint8Array(await readFile(fixturePath))
    const session = await open(bytes)
    expect(await inspect(session)).toMatchObject({
      format: 'fsb',
      container: 'fsb5',
      version: 1,
      codec: 'pcm8',
      streams: 1,
      sampleHeaderBytes: 8,
      nameTableBytes: 9,
      audioBytes: 32,
    })
    const lease = await session.dataSource('common.view/audio-media-source', 1)
    const audio = lease.value as AudioMediaSource
    expect(await audio.info()).toMatchObject({
      durationMs: 4,
      tracks: [{ id: 'stream-0', codec: 'pcm8', channels: 1, sampleRate: 8000 }],
      pcmAccess: false,
    })
    expect(new TextDecoder('ascii').decode(await (await audio.encoded()).read(0n, 4))).toBe('FSB5')
    await lease.release()
    await session.dispose()
  })

  it('keeps the stream name in the inspection tree', async () => {
    const session = await open(new Uint8Array(await readFile(fixturePath)))
    const lease = await session.dataSource('common.view/tree-data-source', 1)
    const tree = lease.value as TreeDataSource
    const children = await tree.children(await tree.root(), { limit: 10 })
    expect(children.items).toHaveLength(1)
    const [stream] = children.items
    if (stream === undefined) throw new Error('FSB tree did not expose its stream')
    expect(await tree.facts(stream)).toMatchObject({ kind: 'stream', label: 'tone' })
    await lease.release()
    await session.dispose()
  })

  it('rejects damaged sizes, unsupported rate codes, and budget overflow', async () => {
    const bytes = new Uint8Array(await readFile(fixturePath))
    const badSize = bytes.slice()
    new DataView(badSize.buffer).setUint32(20, 31, true)
    await expect(open(badSize)).rejects.toThrow(/declared size/u)

    const badRate = bytes.slice()
    const mode = new DataView(badRate.buffer).getBigUint64(60, true)
    new DataView(badRate.buffer).setBigUint64(60, mode | (15n << 1n), true)
    await expect(open(badRate)).rejects.toThrow(/audio parameters/u)
    await expect(open(bytes, { ...budget, maxNodes: 0 })).rejects.toThrow(/maxNodes/u)
  })
})
