import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type AssetSession,
  type Codec,
  type ContributionContext,
  type ModelAnimationSource,
  type ModelMaterialSource,
  type ModelResourceRefsSource,
  type ModelSceneSource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
import {
  drainModelProjection,
  materializeAndCompare,
  proves,
  unexplainedDifferences,
} from '@modkitx-x3/testkit'

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..')
const codecUrl = pathToFileURL(
  join(repoRoot, 'extensions', 'ea', 'emperor', 'src', 'emperor-xbf', 'codec.js'),
).href

const SAMPLE = 'atreides/infantry/AT_inf_H0.xbf'
const SAMPLE_BYTES = 283_963
const SAMPLE_SHA256 = '064f34f77402bbdc8145b5b26944835d59da966d17853ba1fff3275fd45bfb69'

const budget: ResourceBudget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 100_000_000,
  maxDiagnostics: 1000,
}

const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('the Emperor XBF codec has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('the Emperor XBF codec has no foreign service dependency')
    },
  },
}

function inputFor(bytes: Uint8Array, released?: { count: number }): AssetInput {
  const uri = 'memory://emperor-xbf/AT_inf_H0.xbf'
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:${SAMPLE_SHA256}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      signal?.throwIfAborted()
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
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
      compositionFingerprint: SAMPLE_SHA256,
    },
    bindingsFor: () => [],
    async openBinding() {
      return {
        value: source,
        async release() {
          if (released !== undefined) released.count += 1
        },
      }
    },
  } as unknown as AssetInput
}

async function codec(): Promise<Codec> {
  const module = (await import(codecUrl)) as {
    createCodec(context: ContributionContext): Codec
  }
  return module.createCodec(context)
}

async function open(
  bytes: Uint8Array,
  resourceBudget: ResourceBudget = budget,
  signal?: AbortSignal,
  released?: { count: number },
): Promise<AssetSession> {
  return (await codec()).open(inputFor(bytes, released), 'inspect', resourceBudget, signal)
}

async function pageAll<T>(
  read: (request: { limit: number; cursor?: string }) => Promise<{
    items: readonly T[]
    nextCursor?: string
  }>,
): Promise<readonly T[]> {
  const items: T[] = []
  let cursor: string | undefined
  do {
    const page = await read(cursor === undefined ? { limit: 1 } : { limit: 1, cursor })
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor !== undefined)
  return items
}

async function inspect(session: AssetSession): Promise<Record<string, unknown>> {
  const result = await session.operations().invoke('inspect', null)
  if (result.state !== 'ok' || result.output.kind !== 'json') throw new Error('inspect failed')
  return result.output.value as Record<string, unknown>
}

interface SyntheticNode {
  readonly name: string
  readonly children?: readonly SyntheticNode[]
  readonly faceIndices?: readonly [number, number, number]
}

function syntheticNode({ name, children = [], faceIndices }: SyntheticNode): Buffer {
  const hasTriangle = faceIndices !== undefined
  const nameBytes = Buffer.from(name, 'latin1')
  const header = Buffer.alloc(148)
  header.writeInt32LE(hasTriangle ? 3 : 0, 0)
  header.writeInt32LE(0, 4)
  header.writeInt32LE(hasTriangle ? 1 : 0, 8)
  header.writeInt32LE(children.length, 12)
  for (let index = 0; index < 16; index += 1)
    header.writeDoubleLE(index % 5 === 0 ? 1 : 0, 16 + index * 8)
  header.writeUInt32LE(nameBytes.byteLength, 144)

  const childBytes = children.map(syntheticNode)
  if (!hasTriangle) return Buffer.concat([header, nameBytes, ...childBytes])

  const vertices = Buffer.alloc(3 * 24)
  const positions = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ]
  for (let vertex = 0; vertex < 3; vertex += 1) {
    const offset = vertex * 24
    positions[vertex].forEach((value, axis) => vertices.writeFloatLE(value, offset + axis * 4))
    vertices.writeFloatLE(1, offset + 20)
  }
  const face = Buffer.alloc(44)
  faceIndices.forEach((value, corner) => face.writeInt32LE(value, corner * 4))
  face.writeInt32LE(0, 12)
  const uvs = [0, 0, 1, 0, 0, 1]
  uvs.forEach((value, index) => face.writeFloatLE(value, 20 + index * 4))
  return Buffer.concat([header, nameBytes, ...childBytes, vertices, face])
}

function syntheticXbf(root: SyntheticNode, fx = Buffer.alloc(0)): Uint8Array {
  const header = Buffer.alloc(8)
  header.writeInt32LE(1, 0)
  header.writeInt32LE(fx.byteLength, 4)
  const textures = Buffer.from('sample.tga\0', 'latin1')
  const textureSize = Buffer.alloc(4)
  textureSize.writeUInt32LE(textures.byteLength)
  const end = Buffer.alloc(4)
  end.writeInt32LE(-1)
  return new Uint8Array(
    Buffer.concat([header, fx, textureSize, textures, syntheticNode(root), end]),
  )
}

const emperorRoot = process.env.MODKITX_EMPEROR_ROOT

describe('Emperor XBF depth', () => {
  it.skipIf(emperorRoot === undefined)(
    `pins ${SAMPLE} and matches the sealed oracle through standard model facets`,
    async () => {
      if (emperorRoot === undefined) throw new Error('MODKITX_EMPEROR_ROOT is required')
      const bytes = new Uint8Array(await readFile(join(emperorRoot, ...SAMPLE.split('/'))))
      expect(bytes.byteLength).toBe(SAMPLE_BYTES)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(SAMPLE_SHA256)

      const session = await open(bytes)
      try {
        expect(await inspect(session)).toMatchObject({
          format: 'emperor-xbf',
          nodes: 9,
          meshes: 4,
          materials: 5,
          animations: 25,
          geometryAccess: 'decoded',
        })

        const modelLease = await session.dataSource('common.view/model-scene-source', 1)
        try {
          const model = modelLease.value as ModelSceneSource
          const projection = await drainModelProjection(model, { maxBytes: budget.maxScalarBytes })
          expect(projection.info).toMatchObject({
            nodes: 9,
            meshes: 4,
            primitives: 4,
            materials: 5,
            animations: 25,
            geometryAccess: 'decoded',
          })
          expect(projection.nodes[0]).toMatchObject({ name: '~~0root#' })
          expect(projection.nodes[0]?.childIds).toHaveLength(5)
          const vertices = projection.primitives?.reduce(
            (sum, primitive) => sum + primitive.positions.length / 3,
            0,
          )
          const indices = projection.primitives?.reduce(
            (sum, primitive) => sum + (primitive.indices?.length ?? 0),
            0,
          )
          expect(vertices).toBe(378)
          expect(indices).toBe(378)

          const verdict = await materializeAndCompare(repoRoot, projection, {
            assetId: 'emperor/atreides/infantry/AT_inf_H0',
            sourceFormat: 'emperor-xbf',
            subjectRevision: session.revision,
            assetClass: 'unit',
          })
          expect(verdict.byteStable).toBe(true)
          expect(unexplainedDifferences(verdict)).toEqual([])
        } finally {
          await modelLease.release()
        }

        const materialLease = await session.dataSource('common.view/model-material-source', 1)
        try {
          const materialSource = materialLease.value as ModelMaterialSource
          expect(await materialSource.info()).toEqual({ materials: 5 })
          expect(
            (await pageAll(request => materialSource.materials(request))).map(item => item.name),
          ).toEqual([
            'G_Infantry_256.tga',
            '5flash04.tga',
            '5flash03.tga',
            '5E2EE280#30 Particle',
            '5E2D5BE0#29 Particle',
          ])
        } finally {
          await materialLease.release()
        }

        const resourceLease = await session.dataSource('common.view/model-resource-refs-source', 1)
        try {
          const resourceSource = resourceLease.value as ModelResourceRefsSource
          const info = await resourceSource.info()
          expect(info.references).toBe(5)
          expect(info.bound).toBe(0)
          expect(info.truncated).toBe(false)
          expect(
            (await pageAll(request => resourceSource.references(request))).map(item => item.id),
          ).toEqual(['=G_Infantry_256.tga', '!5flash04.tga', '!5flash03.tga', '!sm', '!%shel'])
          await expect(resourceSource.references({ limit: 0 })).rejects.toThrow(/limit/u)
          const controller = new AbortController()
          controller.abort()
          await expect(resourceSource.references({ limit: 1 }, controller.signal)).rejects.toThrow(
            /cancel/u,
          )
        } finally {
          await resourceLease.release()
        }

        const animationLease = await session.dataSource('common.view/model-animation-source', 1)
        try {
          const animationSource = animationLease.value as ModelAnimationSource
          const clips = await pageAll(request => animationSource.clips(request))
          expect(await animationSource.info()).toMatchObject({ clips: 25, channelled: 25 })
          expect(clips).toHaveLength(25)
          expect(clips.every(clip => clip.channels.length > 0)).toBe(true)
          expect(clips.map(clip => clip.name)).toEqual([
            'Stationary',
            'Idle 0',
            'Idle 1',
            'Move Start',
            'Move Stop',
            'Move',
            'Turn Left',
            'Turn Right',
            'Fire 0',
            'Explode',
            'Blow Up 1',
            'Blow Up 2',
            'Shot 1',
            'Shot 2',
            'Burnt 1',
            'Run Over 1',
            'Gassed 1',
            'StandToLayDown',
            'LayDownToStand',
            'Lay Down',
            'Crawl',
            'Lay Down Fire',
            'Crouch',
            'CrouchFire',
            'Win',
          ])
        } finally {
          await animationLease.release()
        }

        const descriptor = (await session.descriptor()) as unknown as {
          metadata: readonly { id: string; entries: readonly { value: unknown }[] }[]
        }
        const receipt = descriptor.metadata.find(group => group.id === 'uv-projection-receipt')
          ?.entries[0]?.value
        expect(receipt).toMatchObject({
          form: 'portable',
          adapter: { id: 'org.modkitx/emperor-xbf', version: '1.0.0' },
          confidence: 'high',
        })
        expect(JSON.stringify(receipt)).not.toMatch(/file:\/\/|[A-Za-z]:[\\/]/u)

        proves({
          capabilityId: 'format/emperor-xbf/open-inspect',
          operation: 'inspect',
          note: 'retail AT_inf_H0.xbf matches the sealed 9/4/5/25 oracle and exposes decoded geometry',
        })
        proves({
          capabilityId: 'format/emperor-xbf/open-inspect',
          operation: 'read',
          note: 'generic model projection drains and materializes with every difference explained',
        })
      } finally {
        await session.dispose()
      }
    },
    120_000,
  )

  it('decodes a bounded synthetic hierarchy and triangle', async () => {
    const bytes = syntheticXbf({
      name: 'root',
      children: [{ name: 'mesh', faceIndices: [0, 1, 2] }],
    })
    const session = await open(bytes)
    try {
      expect(await inspect(session)).toMatchObject({
        nodes: 2,
        meshes: 1,
        primitives: 1,
        materials: 1,
        animations: 0,
        geometryAccess: 'decoded',
      })
      await expect(session.dataSource('common.view/model-animation-source', 1)).rejects.toThrow()

      const modelLease = await session.dataSource('common.view/model-scene-source', 1)
      try {
        const source = modelLease.value as ModelSceneSource
        const meshes = await source.meshes({ limit: 1 })
        const primitiveId = meshes.items[0]?.primitiveIds[0]
        if (primitiveId === undefined || source.primitive === undefined)
          throw new Error('synthetic XBF published no primitive')
        const primitive = await source.primitive(primitiveId, { maxBytes: 1_000_000 })
        const { renderHeadless } = (await import(
          pathToFileURL(
            join(repoRoot, 'extensions', 'common', 'rendering-3d', 'src', 'headless.js'),
          ).href
        )) as {
          renderHeadless(request: Record<string, unknown>): Promise<{
            statistics: { fragments: number }
          }>
        }
        const frame = await renderHeadless({
          scene: {
            materials: [{ id: 'surface', baseColor: [0.22, 0.68, 0.94, 1] }],
            primitives: [{ ...primitive, materialId: 'surface' }],
          },
          camera: {
            viewProjection: new Float32Array([
              1.6, 0, 0, 0, 0, 1.6, 0, 0, 0, 0, 1, 0, -0.8, -0.8, 0, 1,
            ]),
          },
          viewport: { width: 32, height: 32 },
          clearColor: [0.015, 0.02, 0.03, 0],
          outputKind: 'rgba8',
        })
        expect(frame.statistics.fragments).toBeGreaterThan(0)
      } finally {
        await modelLease.release()
      }
    } finally {
      await session.dispose()
    }
  })

  it('refuses malformed structure and invalid geometry instead of inventing a partial model', async () => {
    const valid = syntheticXbf({ name: 'mesh', faceIndices: [0, 1, 2] })
    await expect(open(valid.slice(0, valid.byteLength - 20))).rejects.toThrow(/outside|truncated/u)
    await expect(open(syntheticXbf({ name: 'mesh', faceIndices: [0, 1, 99] }))).rejects.toThrow(
      /missing vertex/u,
    )

    const malformedFx = Buffer.alloc(29)
    malformedFx[28] = 9
    await expect(open(syntheticXbf({ name: 'root' }, malformedFx))).rejects.toThrow(/FX marker 9/u)
  })

  it('enforces input, hierarchy, node and scalar budgets', async () => {
    const flat = syntheticXbf({ name: 'mesh', faceIndices: [0, 1, 2] })
    await expect(open(flat, { ...budget, maxInputBytes: 8n })).rejects.toThrow(/budget/u)
    await expect(open(flat, { ...budget, maxNodes: 2 })).rejects.toThrow(/maxNodes/u)
    await expect(open(flat, { ...budget, maxScalarBytes: 4 })).rejects.toThrow(/maxScalarBytes/u)
    const nested = syntheticXbf({ name: 'root', children: [{ name: 'child' }] })
    await expect(open(nested, { ...budget, maxDepth: 0 })).rejects.toThrow(/maxDepth/u)
  })

  it('honours cancellation and releases its source lease on teardown', async () => {
    const bytes = syntheticXbf({ name: 'mesh', faceIndices: [0, 1, 2] })
    const controller = new AbortController()
    controller.abort()
    await expect(open(bytes, budget, controller.signal)).rejects.toThrow(/cancel/u)

    const released = { count: 0 }
    const session = await open(bytes, budget, undefined, released)
    await session.dispose()
    expect(released.count).toBe(1)
  })
})
