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
  type RasterImageSource,
  type ResourceBudget,
  type TreeDataSource,
} from '@modkitx-x3/sdk'

const root = join(import.meta.dirname, '..', '..', '..')
const extension = join(root, 'extensions', 'mk2', 'unity-engine')
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
      throw new Error('Unity container codecs have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('Unity container codecs have no foreign service dependency')
    },
  },
}

function source(format: string, bytes: Uint8Array): ArtifactByteSource {
  const uri = `memory://unity/${format}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:unity-${format}`),
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

async function namespace(session: Awaited<ReturnType<typeof open>>) {
  const lease = await session.dataSource('common.view/namespace-entry-source', 1)
  return { lease, source: lease.value as NamespaceEntrySource }
}

describe('ported Unity codecs', () => {
  it('opens a UnityFS block table and publishes its serialized asset entry', async () => {
    const session = await open('unityfs', await fixture('minimal.unityfs'))
    expect(await inspect(session)).toMatchObject({
      format: 'unityfs',
      version: 6,
      unityVersion: '2021.3.0f1',
      blocks: 1,
      entries: 1,
    })
    const { lease, source: entries } = await namespace(session)
    expect((await entries.list('', { limit: 10 })).items).toMatchObject([
      { path: 'cab-fixture.assets', size: 137n },
    ])
    const treeLease = await session.dataSource('common.view/tree-data-source', 1)
    const tree = treeLease.value as TreeDataSource
    expect((await tree.children(await tree.root(), { limit: 10 })).items).toHaveLength(1)
    await treeLease.release()
    await lease.release()
    await session.dispose()
  })

  it('walks a stripped Unity serialized object table', async () => {
    const session = await open('unity-assets', await fixture('minimal.unity.assets'))
    expect(await inspect(session)).toMatchObject({
      format: 'unity-assets',
      serializedVersion: 17,
      unityVersion: '2021.3.0f1',
      types: 1,
      objects: 1,
    })
    const { lease, source: entries } = await namespace(session)
    expect((await entries.list('objects/', { limit: 10 })).items).toMatchObject([
      { path: 'objects/0000-FixtureText.bin', size: 25n },
    ])
    await lease.release()
    await session.dispose()
  })

  it('exposes the complete headerless .ress stream without inventing class ranges', async () => {
    const bytes = await fixture('minimal.unity.ress')
    const session = await open('unity-ress', bytes)
    expect(await inspect(session)).toMatchObject({
      format: 'unity-ress',
      entries: 1,
      bytes: bytes.byteLength,
      classAwareRanges: false,
    })
    const { lease, source: entries } = await namespace(session)
    expect((await entries.list('', { limit: 1 })).items).toMatchObject([
      { path: 'resource-stream.bin', size: BigInt(bytes.byteLength) },
    ])
    await lease.release()
    await session.dispose()
  })

  it('decodes an MKXUNITYTEX RGBA32 payload to raster regions', async () => {
    const session = await open('unity', await fixture('minimal.unitytex'))
    expect(await inspect(session)).toMatchObject({
      format: 'unity',
      profile: 'MKXUNITYTEX/RGBA32',
      name: 'T_Fixture',
      width: 2,
      height: 1,
      pixelFormat: 'RGBA32',
    })
    const lease = await session.dataSource('common.view/raster-image-source', 1)
    const raster = lease.value as RasterImageSource
    expect(await raster.info()).toMatchObject({ width: 2, height: 1, decodedAccess: true })
    await expect(
      raster.readRegion?.({
        x: 0,
        y: 0,
        width: 2,
        height: 1,
        pixelFormat: 'rgba8',
        maxBytes: 8,
      }),
    ).resolves.toMatchObject({
      pixels: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]),
    })
    await lease.release()
    await session.dispose()
  })

  it('decodes an MKXUNITYMESH triangle to model geometry', async () => {
    const session = await open('unity-mesh', await fixture('minimal.unitymesh'))
    expect(await inspect(session)).toMatchObject({
      format: 'unity-mesh',
      profile: 'MKXUNITYMESH/triangles',
      name: 'Mesh_Fixture',
      vertices: 3,
      indices: 3,
      triangles: 1,
      submeshes: 1,
      indexType: 'uint16',
    })
    const lease = await session.dataSource('common.view/model-scene-source', 1)
    const model = lease.value as ModelSceneSource
    expect(await model.info()).toMatchObject({
      scenes: 1,
      meshes: 1,
      primitives: 1,
      geometryAccess: 'decoded',
    })
    expect(await model.primitive?.('primitive-0', { maxBytes: 1024 })).toMatchObject({
      topology: 'triangles',
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
    })
    await lease.release()
    await session.dispose()
  })

  it('rejects inconsistent headers and enforces resource budgets', async () => {
    const bundle = await fixture('minimal.unityfs')
    const badBundle = bundle.slice()
    new DataView(badBundle.buffer).setBigUint64(30, BigInt(bundle.byteLength + 1), false)
    await expect(open('unityfs', badBundle)).rejects.toThrow(/bundle size/u)

    const assets = await fixture('minimal.unity.assets')
    const withTypeTree = assets.slice()
    withTypeTree[35] = 1
    await expect(open('unity-assets', withTypeTree)).rejects.toThrow(/type tree/u)
    await expect(open('unity-assets', assets, { ...budget, maxNodes: 0 })).rejects.toThrow(
      /maxNodes/u,
    )
    await expect(open('unity-ress', new Uint8Array())).rejects.toThrow(/empty/u)

    const texture = await fixture('minimal.unitytex')
    await expect(open('unity', texture.subarray(0, texture.byteLength - 1))).rejects.toThrow(
      /pixel bytes/u,
    )
    const mesh = await fixture('minimal.unitymesh')
    const badMesh = mesh.slice()
    new DataView(badMesh.buffer).setUint16(badMesh.byteLength - 2, 9, true)
    await expect(open('unity-mesh', badMesh)).rejects.toThrow(/out of range/u)
    await expect(open('unity-mesh', mesh, { ...budget, maxNodes: 2 })).rejects.toThrow(
      /header|maxNodes/u,
    )
  })
})
