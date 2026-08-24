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
} from '@modkitx-x3/sdk'

const root = join(import.meta.dirname, '..', '..', '..')
const codecPath = join(
  root,
  'extensions',
  'ea',
  'tiberian-sun',
  'src',
  'red-alert2-vxl',
  'codec.js',
)
const fixturePath = join(import.meta.dirname, 'fixtures', 'mk2-synthetic', 'minimal.ra2.vxl')
const realVxlPath = process.env.MODKITX_VXL_PATH?.trim()
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
      throw new Error('VXL codec has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('VXL codec has no foreign service dependency')
    },
  },
}

function source(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://vxl/${name}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:vxl-${name}`),
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
      return { value, async release() {} }
    },
  }
}

async function open(bytes: Uint8Array, resourceBudget = budget) {
  const module = (await import(pathToFileURL(codecPath).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  return module
    .createCodec(context)
    .open(input(source(bytes, 'fixture.vxl')), 'inspect', resourceBudget)
}

async function inspect(session: Awaited<ReturnType<typeof open>>) {
  const result = await session.operations().invoke('inspect', null)
  if (result.state !== 'ok' || result.output.kind !== 'json') throw new Error('inspect failed')
  return result.output.value
}

describe('ported Red Alert 2 VXL codec', () => {
  it('decodes one packed voxel into a UVM-oriented surface mesh', async () => {
    const bytes = new Uint8Array(await readFile(fixturePath))
    const session = await open(bytes)
    expect(await inspect(session)).toMatchObject({
      format: 'red-alert2-vxl',
      bodyBytes: 13,
      voxels: 1,
      decodedMeshes: 1,
      decodedTriangles: 12,
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
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      geometryAccess: 'decoded',
    })
    expect((await model.nodes({ limit: 10 })).items).toMatchObject([
      { id: '0', meshIds: ['vxl-mesh-0-0'] },
    ])
    if (model.primitive === undefined) throw new TypeError('VXL primitive access is missing')
    const primitive = await model.primitive('vxl-primitive-0-0', { maxBytes: 10_000 })
    expect(primitive).toMatchObject({
      topology: 'triangles',
      materialId: 'vxl-material-42',
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    })
    expect(primitive.positions).toHaveLength(72)
    expect(primitive.normals).toHaveLength(72)
    expect(primitive.textureCoordinates).toHaveLength(48)
    expect(primitive.indices).toHaveLength(36)
    await expect(model.primitive('vxl-primitive-0-0', { maxBytes: 1 })).rejects.toThrow(/maxBytes/u)
    await lease.release()
    await session.dispose()
  })

  it.skipIf(realVxlPath === undefined || !existsSync(realVxlPath))(
    realVxlPath === undefined
      ? 'MODKITX_VXL_PATH is not set'
      : 'decodes geometry from the configured real VXL model',
    async () => {
      if (realVxlPath === undefined) throw new TypeError('MODKITX_VXL_PATH is not set')
      console.info(`[vxl-live] source ${realVxlPath}`)
      const session = await open(new Uint8Array(await readFile(realVxlPath)), {
        ...budget,
        maxInputBytes: 64_000_000n,
        maxNodes: 2_000_000,
        maxScalarBytes: 128_000_000,
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
          throw new TypeError('real VXL exposed no primitive')
        const primitive = await model.primitive(primitiveId, { maxBytes: 128_000_000 })
        expect(primitive.positions.length).toBeGreaterThan(0)
        expect(primitive.indices?.length).toBeGreaterThan(0)
        console.info(
          `[vxl-live] meshes ${info.meshes}, vertices ${primitive.positions.length / 3}, indices ${primitive.indices?.length ?? 0}`,
        )
      } finally {
        await lease.release()
        await session.dispose()
      }
    },
    30_000,
  )

  it('rejects malformed spans and decoded-byte budget overflow', async () => {
    const bytes = new Uint8Array(await readFile(fixturePath))
    const malformed = bytes.slice()
    new DataView(malformed.buffer).setInt32(802 + 28 + 13 + 8, 99, true)
    await expect(open(malformed)).rejects.toThrow(/span (?:offset|tables)/u)
    await expect(open(bytes, { ...budget, maxScalarBytes: 1 })).rejects.toThrow(/maxScalarBytes/u)
  })
})
