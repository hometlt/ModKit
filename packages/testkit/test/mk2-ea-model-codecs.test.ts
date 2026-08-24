import { existsSync } from 'node:fs'
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
  type ResourceBudget,
  type TreeDataSource,
} from '@modkitx-x3/sdk'

type CodecId = 'sage-w3x' | 'westwood-w3d'
const root = join(import.meta.dirname, '..', '..', '..')
const extension = join(root, 'extensions', 'ea', 'models')
const fixtures = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')
const realW3xPath = process.env.MODKITX_W3X_PATH?.trim()
const realW3dPath = process.env.MODKITX_W3D_PATH?.trim()
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
      throw new Error('EA model codecs have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('EA model codecs have no foreign service dependency')
    },
  },
}

function source(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://ea-models/${name}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:ea-models-${name}`),
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

async function open(id: CodecId, bytes: Uint8Array, resourceBudget = budget) {
  const module = (await import(pathToFileURL(join(extension, 'src', id, 'codec.js')).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  return module.createCodec(context).open(input(source(bytes, id)), 'inspect', resourceBudget)
}

async function fixture(name: string) {
  return new Uint8Array(await readFile(join(fixtures, name)))
}

async function inspect(session: Awaited<ReturnType<typeof open>>) {
  const result = await session.operations().invoke('inspect', null)
  if (result.state !== 'ok' || result.output.kind !== 'json') throw new Error('inspect failed')
  return result.output.value
}

describe('ported EA model codecs', () => {
  it('decodes a basis-converted W3X triangle with normals, UVs, material, and bounds', async () => {
    const session = await open('sage-w3x', await fixture('minimal.sage.w3x'))
    expect(await inspect(session)).toMatchObject({
      format: 'sage-w3x',
      elements: 7,
      containers: 1,
      declaredMeshes: 1,
      declaredHierarchies: 1,
      declaredAnimations: 1,
      decodedMeshes: 1,
      decodedVertices: 3,
      decodedTriangles: 1,
      textures: ['fixture.dds'],
      includes: ['shared.w3x'],
      geometryAccess: 'decoded',
    })
    const lease = await session.dataSource('common.view/model-scene-source', 1)
    const model = lease.value as ModelSceneSource
    expect(await model.info()).toMatchObject({
      scenes: 1,
      nodes: 1,
      meshes: 1,
      primitives: 1,
      materials: 1,
      textures: 1,
      animations: 1,
      bounds: { min: [0, 0, -1], max: [1, 0, 0] },
      geometryAccess: 'decoded',
    })
    const nodes = await model.nodes({ limit: 10 })
    expect(nodes.items).toMatchObject([{ id: 'w3x-root', meshIds: ['w3x-mesh-0'] }])
    const meshes = await model.meshes({ limit: 10 })
    expect(meshes.items).toMatchObject([
      { id: 'w3x-mesh-0', name: 'FixtureMesh', primitiveIds: ['w3x-primitive-0'] },
    ])
    if (model.primitive === undefined) throw new TypeError('W3X primitive access is missing')
    const primitive = await model.primitive('w3x-primitive-0', { maxBytes: 1_000 })
    expect(primitive).toMatchObject({
      topology: 'triangles',
      materialId: 'w3x-material-0',
      bounds: { min: [0, 0, -1], max: [1, 0, 0] },
    })
    expect([...primitive.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 0, -1])
    expect([...(primitive.indices ?? [])]).toEqual([0, 1, 2])
    expect([...(primitive.normals ?? [])]).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0])
    expect([...(primitive.textureCoordinates ?? [])]).toEqual([0, 1, 1, 1, 0, 0])
    await expect(model.primitive('w3x-primitive-0', { maxBytes: 1 })).rejects.toThrow(/maxBytes/u)
    await lease.release()
    await session.dispose()
  })

  it('decodes a basis-converted W3D triangle with normals, UVs, material, and bounds', async () => {
    const session = await open('westwood-w3d', await fixture('minimal.westwood.w3d'))
    expect(await inspect(session)).toMatchObject({
      format: 'westwood-w3d',
      rootChunks: 1,
      chunks: 12,
      decodedMeshes: 1,
      decodedVertices: 3,
      decodedTriangles: 1,
      textures: ['fixture.tga'],
      geometryAccess: 'decoded',
    })
    const modelLease = await session.dataSource('common.view/model-scene-source', 1)
    const model = modelLease.value as ModelSceneSource
    expect(await model.info()).toMatchObject({
      scenes: 1,
      nodes: 1,
      meshes: 1,
      primitives: 1,
      materials: 1,
      textures: 1,
      bounds: { min: [0, 0, -1], max: [1, 0, 0] },
      geometryAccess: 'decoded',
    })
    if (model.primitive === undefined) throw new TypeError('W3D primitive access is missing')
    const primitive = await model.primitive('w3d-primitive-0', { maxBytes: 1_000 })
    expect(primitive).toMatchObject({
      topology: 'triangles',
      materialId: 'w3d-material-0',
      bounds: { min: [0, 0, -1], max: [1, 0, 0] },
    })
    expect([...primitive.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 0, -1])
    expect([...(primitive.indices ?? [])]).toEqual([0, 1, 2])
    expect([...(primitive.normals ?? [])]).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0])
    expect([...(primitive.textureCoordinates ?? [])]).toEqual([0, 1, 1, 1, 0, 0])
    await expect(model.primitive('w3d-primitive-0', { maxBytes: 1 })).rejects.toThrow(/maxBytes/u)
    await modelLease.release()
    const lease = await session.dataSource('common.view/tree-data-source', 1)
    const tree = lease.value as TreeDataSource
    const roots = await tree.children(await tree.root(), { limit: 10 })
    const hierarchy = roots.items[0]
    if (hierarchy === undefined) throw new TypeError('W3D hierarchy root was not exposed')
    const children = await tree.children(hierarchy, { limit: 10 })
    expect(children.items).toHaveLength(6)
    await lease.release()
    await session.dispose()
  })

  it.skipIf(realW3xPath === undefined || !existsSync(realW3xPath))(
    realW3xPath === undefined
      ? 'MODKITX_W3X_PATH is not set'
      : 'decodes geometry from the configured real W3X model',
    async () => {
      if (realW3xPath === undefined) throw new TypeError('MODKITX_W3X_PATH is not set')
      console.info(`[w3x-live] source ${realW3xPath}`)
      const session = await open('sage-w3x', new Uint8Array(await readFile(realW3xPath)), {
        ...budget,
        maxInputBytes: 16_000_000n,
        maxNodes: 1_000_000,
        maxScalarBytes: 16_000_000,
      })
      const lease = await session.dataSource('common.view/model-scene-source', 1)
      try {
        const model = lease.value as ModelSceneSource
        const info = await model.info()
        expect(info.geometryAccess).toBe('decoded')
        expect(info.meshes).toBeGreaterThan(0)
        expect(info.primitives).toBeGreaterThan(0)
        const [mesh] = (await model.meshes({ limit: 1 })).items
        const primitiveId = mesh?.primitiveIds[0]
        if (primitiveId === undefined || model.primitive === undefined)
          throw new TypeError('real W3X exposed no primitive')
        const primitive = await model.primitive(primitiveId, { maxBytes: 16_000_000 })
        expect(primitive.positions.length).toBeGreaterThan(0)
        expect(primitive.indices?.length).toBeGreaterThan(0)
        if (primitive.indices === undefined) throw new TypeError('real W3X has no indices')
        let maxIndex = 0
        for (const value of primitive.indices) maxIndex = Math.max(maxIndex, value)
        expect(maxIndex).toBeLessThan(primitive.positions.length / 3)
        console.info(
          `[w3x-live] meshes ${info.meshes}, vertices ${primitive.positions.length / 3}, indices ${primitive.indices?.length ?? 0}`,
        )
      } finally {
        await lease.release()
        await session.dispose()
      }
    },
    30_000,
  )

  it.skipIf(realW3dPath === undefined || !existsSync(realW3dPath))(
    realW3dPath === undefined
      ? 'MODKITX_W3D_PATH is not set'
      : 'decodes geometry from the configured real W3D model',
    async () => {
      if (realW3dPath === undefined) throw new TypeError('MODKITX_W3D_PATH is not set')
      console.info(`[w3d-live] source ${realW3dPath}`)
      const session = await open('westwood-w3d', new Uint8Array(await readFile(realW3dPath)), {
        ...budget,
        maxInputBytes: 64_000_000n,
        maxNodes: 2_000_000,
        maxScalarBytes: 64_000_000,
      })
      const lease = await session.dataSource('common.view/model-scene-source', 1)
      try {
        const model = lease.value as ModelSceneSource
        const info = await model.info()
        expect(info.geometryAccess).toBe('decoded')
        expect(info.meshes).toBeGreaterThan(0)
        const [mesh] = (await model.meshes({ limit: 1 })).items
        const primitiveId = mesh?.primitiveIds[0]
        if (primitiveId === undefined || model.primitive === undefined)
          throw new TypeError('real W3D exposed no primitive')
        const primitive = await model.primitive(primitiveId, { maxBytes: 64_000_000 })
        expect(primitive.positions.length).toBeGreaterThan(0)
        expect(primitive.indices?.length).toBeGreaterThan(0)
        if (primitive.indices === undefined) throw new TypeError('real W3D has no indices')
        let maxIndex = 0
        for (const value of primitive.indices) maxIndex = Math.max(maxIndex, value)
        expect(maxIndex).toBeLessThan(primitive.positions.length / 3)
        console.info(
          `[w3d-live] meshes ${info.meshes}, vertices ${primitive.positions.length / 3}, indices ${primitive.indices.length}`,
        )
      } finally {
        await lease.release()
        await session.dispose()
      }
    },
    30_000,
  )

  it('rejects malformed XML, chunk overflows, and resource-budget overflow', async () => {
    const w3x = await fixture('minimal.sage.w3x')
    await expect(open('sage-w3x', w3x, { ...budget, maxNodes: 2 })).rejects.toThrow(/maxNodes/u)
    const malformed = new TextEncoder().encode('<AssetDeclaration><W3DMesh/></broken>')
    await expect(open('sage-w3x', malformed)).rejects.toThrow(/not closed/u)
    const badIndex = new TextEncoder().encode(
      new TextDecoder().decode(w3x).replace('<V>2</V>', '<V>9</V>'),
    )
    await expect(open('sage-w3x', badIndex)).rejects.toThrow(/invalid indices/u)

    const w3d = await fixture('minimal.westwood.w3d')
    await expect(open('westwood-w3d', w3d, { ...budget, maxDepth: 0 })).rejects.toThrow(/maxDepth/u)
    const corrupt = w3d.slice()
    new DataView(corrupt.buffer).setUint32(12, 0x7fffffff, true)
    await expect(open('westwood-w3d', corrupt)).rejects.toThrow(/outside/u)
  })
})
