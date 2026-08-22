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
  type ModelSceneSource,
  type NamespaceEntrySource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'

type CodecId = 'emperor-rfh-rfd' | 'emperor-xbf'

const root = join(import.meta.dirname, '..', '..', '..')
const extension = join(root, 'extensions', 'mk2', 'ea-emperor')
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
      throw new Error('EA Emperor codecs have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('EA Emperor codecs have no foreign service dependency')
    },
  },
}

function source(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://ea-emperor/${name}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:ea-emperor-${name}`),
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

async function extract(session: Awaited<ReturnType<typeof open>>, entryId: string) {
  const result = await session.operations().invoke('extract-entry', { entryId })
  if (result.state !== 'ok' || result.output.kind !== 'bytes') throw new Error('extract failed')
  return new TextDecoder().decode(result.output.value)
}

describe('ported EA Emperor codecs', () => {
  it('inventories and extracts the embedded RFH stored and deflate entries', async () => {
    const session = await open('emperor-rfh-rfd', await fixture('minimal.emperor.rfh'))
    expect(await inspect(session)).toMatchObject({
      format: 'emperor-rfh-rfd',
      layout: 'embedded',
      version: 1,
      entries: 2,
      compressed: 1,
      payloadSource: 'embedded',
    })
    const lease = await session.dataSource('common.view/namespace-entry-source', 1)
    const namespace = lease.value as NamespaceEntrySource
    const page = await namespace.list('', { limit: 10 })
    expect(page.items.map(item => [item.id, item.path, item.compression])).toEqual([
      ['0', 'stored.txt', 'stored'],
      ['1', 'deflate.txt', 'deflate'],
    ])
    expect(await extract(session, '0')).toBe('stored')
    expect(await extract(session, '1')).toBe('deflate payload')
    await lease.release()
    await session.dispose()
  })

  it('keeps retail RFH table inspection but reports the missing RFD extraction boundary', async () => {
    const name = new TextEncoder().encode('retail.bin\0')
    const bytes = new Uint8Array(24 + name.byteLength)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, name.byteLength, true)
    view.setUint32(4, 1234, true)
    view.setUint32(8, 0, true)
    view.setUint32(12, 6, true)
    view.setUint32(16, 6, true)
    view.setUint32(20, 200, true)
    bytes.set(name, 24)
    const session = await open('emperor-rfh-rfd', bytes)
    expect(await inspect(session)).toMatchObject({
      layout: 'retail',
      entries: 1,
      payloadSource: 'sibling-rfd-required',
    })
    await expect(extract(session, '0')).rejects.toThrow(/archive-companion-missing/u)
    await session.dispose()
  })

  it('validates the XBF v1 structural planes and exposes metadata-only model data', async () => {
    const session = await open('emperor-xbf', await fixture('minimal.emperor.xbf'))
    expect(await inspect(session)).toMatchObject({
      format: 'emperor-xbf',
      version: 1,
      fxDataBytes: 0,
      textureTableBytes: 12,
      textures: ['fixture.tga'],
      hasEndMarker: true,
      undecodedNodeBytes: 0,
      geometryAccess: 'metadata-only',
    })
    const lease = await session.dataSource('common.view/model-scene-source', 1)
    const model = lease.value as ModelSceneSource
    expect(await model.info()).toMatchObject({
      scenes: 1,
      nodes: 1,
      meshes: 0,
      textures: 1,
      geometryAccess: 'metadata-only',
    })
    await lease.release()
    await session.dispose()
  })

  it('rejects traversal, corrupt ranges, unsupported versions, and budget overflow', async () => {
    const rfh = await fixture('minimal.emperor.rfh')
    await expect(open('emperor-rfh-rfd', rfh, { ...budget, maxNodes: 1 })).rejects.toThrow(
      /maxNodes/u,
    )
    const traversal = rfh.slice()
    traversal.set(new TextEncoder().encode('../evil.tx\0'), 64)
    await expect(open('emperor-rfh-rfd', traversal)).rejects.toThrow(/unsafe path/u)
    const corruptRfh = rfh.slice()
    new DataView(corruptRfh.buffer).setUint32(24, 0xfffffff0, true)
    await expect(open('emperor-rfh-rfd', corruptRfh)).rejects.toThrow(/outside/u)

    const xbf = await fixture('minimal.emperor.xbf')
    const unsupported = xbf.slice()
    new DataView(unsupported.buffer).setInt32(0, 2, true)
    await expect(open('emperor-xbf', unsupported)).rejects.toThrow(/unsupported XBF version/u)
    await expect(open('emperor-xbf', xbf, { ...budget, maxScalarBytes: 4 })).rejects.toThrow(
      /texture table/u,
    )
  })
})
