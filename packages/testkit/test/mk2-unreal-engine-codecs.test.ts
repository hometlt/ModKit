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
  type TreeDataSource,
} from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const extensionRoot = join(repoRoot, 'extensions', 'mk2', 'epic-games-unreal-engine')
const fixtureRoot = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')

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
      throw new Error('Unreal codecs have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('Unreal codecs have no foreign service dependency')
    },
  },
}

function byteSource(format: string, bytes: Uint8Array): ArtifactByteSource {
  const uri = `memory://mk2-unreal/minimal.${format}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:mk2-unreal-${format}`),
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
      compositionFingerprint: `mk2-unreal-${source.ref.id}`,
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

function bundleInput(primary: ArtifactByteSource, companion: ArtifactByteSource): AssetInput {
  const candidate = {
    sourceKind: 'candidate' as const,
    bindingId: 'utoc',
    role: 'table-of-contents',
    ownership: 'owned' as const,
    source: primary.ref,
    revision: primary.revision,
  }
  const required = {
    sourceKind: 'requirement' as const,
    bindingId: 'ucas',
    requirementId: 'ucas',
    role: 'container-payload',
    ownership: 'companion' as const,
    source: companion.ref,
    revision: companion.revision,
  }
  const sources = new Map([
    [candidate.bindingId, primary],
    [required.bindingId, companion],
  ])
  return {
    originKind: 'bundle',
    bindings: [candidate, required],
    primaryBindingId: candidate.bindingId,
    revisions: {
      topology: 'bundle',
      revision: primary.revision,
      bindings: [
        { bindingId: candidate.bindingId, revision: candidate.revision },
        { bindingId: required.bindingId, revision: required.revision },
      ],
      compositionFingerprint: `mk2-unreal-iostore-${primary.ref.id}-${companion.ref.id}`,
    },
    bindingsFor(requirementId) {
      return requirementId === 'ucas' ? [required] : []
    },
    async openBinding(bindingId) {
      const source = sources.get(bindingId)
      if (source === undefined) throw new TypeError(`unknown bundle binding ${bindingId}`)
      return {
        value: source,
        async release() {
          return undefined
        },
      }
    },
  }
}

async function codecFor(format: string): Promise<Codec> {
  const module = (await import(
    pathToFileURL(join(extensionRoot, 'src', format, 'codec.js')).href
  )) as { createCodec(context: ContributionContext): Codec }
  return module.createCodec(context)
}

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(fixtureRoot, name)))
}

async function open(format: string, bytes: Uint8Array, resourceBudget = budget) {
  const codec = await codecFor(format)
  return codec.open(inputFor(byteSource(format, bytes)), 'inspect', resourceBudget)
}

async function openIoStore(utoc: Uint8Array, ucas: Uint8Array, resourceBudget = budget) {
  const codec = await codecFor('unreal-iostore')
  return codec.open(
    bundleInput(byteSource('unreal.utoc', utoc), byteSource('unreal.ucas', ucas)),
    'inspect',
    resourceBudget,
  )
}

async function summary(session: Awaited<ReturnType<typeof open>>) {
  const result = await session.operations().invoke('inspect', null)
  if (result.state !== 'ok' || result.output.kind !== 'json')
    throw new Error('inspect did not return JSON')
  return result.output.value
}

async function extract(session: Awaited<ReturnType<typeof open>>, entryId: string) {
  const result = await session.operations().invoke('extract-entry', { entryId })
  if (result.state !== 'ok' || result.output.kind !== 'bytes')
    throw new Error(`entry ${entryId} did not extract to bytes`)
  return result.output.value
}

describe('ported Epic Games / Unreal Engine codecs', () => {
  it('resolves a real UE5 UTOC/UCAS bundle and extracts stored blocks', async () => {
    const [utoc, ucas] = await Promise.all([
      fixture('minimal.unreal.utoc'),
      fixture('minimal.unreal.ucas'),
    ])
    const session = await openIoStore(utoc, ucas)
    expect(await summary(session)).toMatchObject({
      format: 'unreal-iostore',
      version: 6,
      mountPoint: 'Demo/Content',
      entries: 2,
      blocks: 2,
      blockSize: 64,
      companionBytes: ucas.byteLength,
    })
    const lease = await session.dataSource('common.view/namespace-entry-source', 1)
    const namespace = lease.value as NamespaceEntrySource
    expect((await namespace.list('', { limit: 10 })).items.map(item => item.path)).toEqual([
      'Demo/Content/Meshes/Unit.uasset',
      'Demo/Content/Config/DefaultGame.ini',
    ])
    await expect(extract(session, '0')).resolves.toEqual(
      new TextEncoder().encode('iostore unit asset'),
    )
    await expect(extract(session, '1')).resolves.toEqual(
      new TextEncoder().encode('[IoStore]\nMounted=true\n'),
    )
    await lease.release()
    await session.dispose()
  })

  it('rejects IoStore blocks outside UCAS and enforces bundle budgets', async () => {
    const [utoc, ucas] = await Promise.all([
      fixture('minimal.unreal.utoc'),
      fixture('minimal.unreal.ucas'),
    ])
    const corrupted = utoc.slice()
    // Header + chunk ids + offset/length table is the compressed-block table.
    new DataView(corrupted.buffer).setUint32(0x90 + 24 + 20 + 12, ucas.byteLength + 1, true)
    await expect(openIoStore(corrupted, ucas)).rejects.toThrow(/IoStore/u)
    await expect(openIoStore(utoc, ucas, { ...budget, maxNodes: 0 })).rejects.toThrow(/maxNodes/u)
    await expect(openIoStore(utoc, ucas, { ...budget, maxScalarBytes: 1 })).rejects.toThrow(
      /maxInputBytes|maxScalarBytes/u,
    )
  })

  it('walks a UE4 Pak v8 footer/index and extracts cross-checked stored entries', async () => {
    const bytes = await fixture('minimal.unreal.pak')
    const session = await open('unreal-pak', bytes)
    expect(await summary(session)).toMatchObject({
      format: 'unreal-pak',
      version: 8,
      mountPoint: 'Demo/Content',
      entries: 2,
      stored: 2,
      compressionMethods: ['Zlib', 'Gzip', 'Oodle'],
    })
    const lease = await session.dataSource('common.view/namespace-entry-source', 1)
    const namespace = lease.value as NamespaceEntrySource
    expect((await namespace.list('', { limit: 10 })).items.map(item => item.path)).toEqual([
      'Demo/Content/Meshes/Unit.uasset',
      'Demo/Content/Config/DefaultGame.ini',
    ])
    await expect(extract(session, '0')).resolves.toEqual(new TextEncoder().encode('unit asset'))
    await expect(extract(session, '1')).resolves.toEqual(
      new TextEncoder().encode('[Game]\nName=Demo\n'),
    )
    await lease.release()
    await session.dispose()
  })

  it('rejects a Pak local/index disagreement and bounds extraction', async () => {
    const bytes = await fixture('minimal.unreal.pak')
    const corrupted = bytes.slice()
    // First local FPakEntry starts at zero; changing its declared size disagrees with the index.
    new DataView(corrupted.buffer).setBigInt64(8, 99n, true)
    await expect(open('unreal-pak', corrupted)).rejects.toThrow(/Unreal Pak/u)
    await expect(open('unreal-pak', bytes, { ...budget, maxNodes: 0 })).rejects.toThrow(/maxNodes/u)
    const session = await open('unreal-pak', bytes, { ...budget, maxScalarBytes: 1 })
    await expect(extract(session, '0')).rejects.toThrow(/maxScalarBytes/u)
    await session.dispose()
  })

  it('decodes genuine ActorX chunk records into bounded triangle geometry', async () => {
    const bytes = await fixture('minimal.actorx.psk')
    const session = await open('unreal-actorx', bytes)
    expect(await summary(session)).toMatchObject({
      format: 'unreal-actorx',
      kind: 'psk',
      chunks: 7,
      points: 3,
      wedges: 3,
      faces: 1,
      materials: 1,
      bones: 1,
      weights: 3,
      bounds: { min: [0, 0, 0], max: [1, 1, 0] },
    })
    const modelLease = await session.dataSource('common.view/model-scene-source', 1)
    const model = modelLease.value as ModelSceneSource
    expect(await model.info()).toMatchObject({
      scenes: 1,
      meshes: 1,
      primitives: 1,
      geometryAccess: 'decoded',
    })
    expect(await model.primitive?.('primitive-0', { maxBytes: 1024 })).toMatchObject({
      topology: 'triangles',
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      textureCoordinates: new Float32Array([0, 0, 1, 0, 0, 1]),
    })
    const treeLease = await session.dataSource('common.view/tree-data-source', 1)
    const tree = treeLease.value as TreeDataSource
    expect((await tree.children(await tree.root(), { limit: 20 })).items).toHaveLength(7)
    await treeLease.release()
    await modelLease.release()
    await session.dispose()
  })

  it('independently verifies the ActorX wire tables', async () => {
    const bytes = await fixture('minimal.actorx.psk')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const chunks: [string, number, number][] = []
    let offset = 0
    while (offset < bytes.byteLength) {
      const nameBytes = bytes.subarray(offset, offset + 20)
      const zero = nameBytes.indexOf(0)
      const name = new TextDecoder('ascii').decode(nameBytes.subarray(0, zero))
      const recordSize = view.getInt32(offset + 24, true)
      const count = view.getInt32(offset + 28, true)
      chunks.push([name, recordSize, count])
      offset += 32 + recordSize * count
    }
    expect(offset).toBe(bytes.byteLength)
    expect(chunks).toEqual([
      ['ACTRHEAD', 0, 0],
      ['PNTS0000', 12, 3],
      ['VTXW0000', 16, 3],
      ['FACE0000', 12, 1],
      ['MATT0000', 88, 1],
      ['REFSKELT', 120, 1],
      ['RAWWEIGHTS', 12, 3],
    ])
  })

  it('rejects corrupt ActorX indices and enforces budgets', async () => {
    const bytes = await fixture('minimal.actorx.psk')
    const corrupted = bytes.slice()
    // ACTRHEAD (32), PNTS header+records (68), VTXW header+records (80), FACE header.
    new DataView(corrupted.buffer).setUint16(32 + 32 + 36 + 32 + 48 + 32, 9, true)
    await expect(open('unreal-actorx', corrupted)).rejects.toThrow(/ActorX/u)
    await expect(open('unreal-actorx', bytes, { ...budget, maxNodes: 0 })).rejects.toThrow(
      /maxNodes/u,
    )
    await expect(open('unreal-actorx', bytes, { ...budget, maxScalarBytes: 1 })).rejects.toThrow(
      /maxScalarBytes/u,
    )
  })
})
