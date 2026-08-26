import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'
import { artifactByteSourceFromRandomAccess, createVfsInputResolver } from '@modkitx-x3/host'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type ContributionContext,
  type DetectionResult,
  type ModelAnimationSource,
  type ModelResourceRefsSource,
  type ModelSceneSource,
  type RelationGraphSource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
import {
  drainModelProjection,
  materializeAndCompare,
  proves,
  unexplainedDifferences,
} from '@modkitx-x3/testkit'
import { VirtualFileSystem, type VfsMount } from '@modkitx-x3/vfs'
import { createRapidVfsProvider } from '@modkitx-x3/vfs/providers/rapid'
import { createCodec as createS3oCodec } from '../src/spring-s3o/codec.js'
import { createCodec as createUnitCodec } from '../src/spring-unit/codec.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..')
const corpusRoot = process.env['MODKITX_BAR_ROOT']
const configured = typeof corpusRoot === 'string' && corpusRoot.length > 0
const manifestPath = configured
  ? join(corpusRoot, 'data', 'packages', '705fa44d676b3633ea970038d8c593a8.sdp')
  : ''
const airbombPath = 'objects3d/airbomb.s3o'
const armpwPath = 'units/armbots/armpw.lua'
const budget: ResourceBudget = {
  maxInputBytes: 1_073_741_824n,
  maxDepth: 128,
  maxNodes: 1_000_000,
  maxScalarBytes: 256 * 1024 * 1024,
  maxDiagnostics: 200,
}
const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('Spring codecs have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('Spring codecs have no foreign service dependency')
    },
  },
}
const detection: DetectionResult = Object.freeze({
  codecId: 'org.modkitx/spring-unit-definition',
  confidence: 1,
  evidence: Object.freeze([]),
  requiredRanges: Object.freeze([]),
}) as DetectionResult

function rapidUri(): string {
  if (!existsSync(manifestPath)) {
    throw new Error('MODKITX_BAR_ROOT does not identify BAR data with the pinned rapid manifest')
  }
  return `rapid+${pathToFileURL(manifestPath).href}`
}

async function rapidMount(): Promise<{
  readonly vfs: VirtualFileSystem
  readonly mount: VfsMount
}> {
  const vfs = new VirtualFileSystem().registerProvider(createRapidVfsProvider())
  const mount = await vfs.openMount(rapidUri())
  return { vfs, mount }
}

async function sourceAt(
  mount: VfsMount,
  path: string,
): Promise<{
  readonly source: ArtifactByteSource
  readonly release: () => Promise<void>
}> {
  const node = await mount.stat(path)
  if (node?.kind !== 'file') throw new Error(`rapid fixture has no ${path}`)
  const random = await mount.open(path)
  try {
    const source = await artifactByteSourceFromRandomAccess(random, {
      ref: {
        id: `${mount.id}?vfs-path=${encodeURIComponent(node.path)}`,
        uri: `${mount.rootUri}?vfs-path=${encodeURIComponent(node.path)}`,
        parentIds: [mount.id],
      },
      revision: revisionId(node.revision ?? mount.revision),
    })
    return { source, release: async () => random.dispose() }
  } catch (error) {
    await random.dispose()
    throw error
  }
}

function singleInput(source: ArtifactByteSource): AssetInput {
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
    primaryBindingId: 'content',
    revisions: {
      topology: 'single',
      revision: source.revision,
      bindings: [{ bindingId: 'content', revision: source.revision }],
      compositionFingerprint: 'bar-airbomb-s3o',
    },
    bindingsFor: () => [],
    async openBinding() {
      return { value: source, release: async () => undefined }
    },
  }
}

interface Receipt {
  readonly form: string
  readonly companions: readonly unknown[]
  readonly planes: readonly {
    readonly planeId: string
    readonly state: string
    readonly note?: string
  }[]
}

function receiptOf(descriptor: unknown): Receipt {
  return (
    descriptor as {
      metadata: readonly { id: string; entries: readonly { value: unknown }[] }[]
    }
  ).metadata.find(group => group.id === 'uv-projection-receipt')?.entries[0]?.value as Receipt
}

describe.skipIf(!configured)('Beyond All Reason live rapid corpus', () => {
  it('opens airbomb.s3o through the public rapid VFS and keeps direct S3O static', async () => {
    const { vfs, mount } = await rapidMount()
    const opened = await sourceAt(mount, airbombPath)
    try {
      expect(opened.source.size).toBe(19_189n)
      const sourceBytes = await opened.source.read(0n, Number(opened.source.size))
      expect(createHash('sha256').update(sourceBytes).digest('hex')).toBe(
        'c208233aabfd58fa83237ddf69e56c0ac29fd44c1290fee11c198be1d8fe37c2',
      )
      const session = await createS3oCodec(context).open(singleInput(opened.source), 'full', budget)
      try {
        const descriptor = await session.descriptor()
        expect(descriptor.dataSources.map(item => item.contract)).not.toContain(
          'common.view/model-animation-source',
        )
        proves({
          contributionId: 'org.modkitx/spring-s3o',
          operation: 'inspect',
          note: 'real airbomb.s3o opens through the public rapid VFS and remains correctly static',
        })
        const inspectOperation = descriptor.operations.find(item => item.id === 'view.inspect')
        if (inspectOperation === undefined) throw new Error('the S3O inspect operation is absent')
        const inspected = await session.operations().invoke(inspectOperation.handlerId, null)
        if (inspected.state !== 'ok' || inspected.output.kind !== 'json') {
          throw new Error('the S3O inspect operation did not return its summary')
        }
        expect(inspected.output.value).toEqual({
          format: 'spring-s3o',
          meshes: 1,
          namedRemainder: ['spring-3do', 's3o-writing', 'external-bos-cob-lua-animation-binding'],
          pieces: 1,
          primitives: 1,
          textures: 2,
          triangles: 264,
          version: 0,
          vertices: 496,
        })

        const modelLease = await session.dataSource('common.view/model-scene-source', 1)
        const model = modelLease.value as ModelSceneSource
        const info = await model.info()
        const projection = await drainModelProjection(model, { maxBytes: budget.maxScalarBytes })
        await modelLease.release()
        expect(info).toMatchObject({ nodes: 1, meshes: 1, primitives: 1, animations: 0 })

        const refsLease = await session.dataSource('common.view/model-resource-refs-source', 1)
        const refs = refsLease.value as ModelResourceRefsSource
        expect((await refs.info()).references).toBe(2)
        await refsLease.release()

        const receipt = receiptOf(descriptor)
        expect(receipt.companions).toEqual([])
        expect(receipt.planes.find(plane => plane.planeId === 'animation')).toMatchObject({
          state: 'lost',
          note: expect.stringMatching(/BOS\/COB|Lua/u),
        })
        expect(JSON.stringify(receipt)).not.toMatch(/file:\/\/|[A-Za-z]:[\\/]/u)

        const verdict = await materializeAndCompare(repoRoot, projection, {
          assetId: `bar/${airbombPath}`,
          sourceFormat: 's3o',
          subjectRevision: session.revision,
          assetClass: 'unit',
        })
        expect(verdict.byteStable).toBe(true)
        expect(unexplainedDifferences(verdict)).toEqual([])
      } finally {
        await session.dispose()
      }
    } finally {
      await opened.release()
      await mount.dispose()
      await vfs.dispose()
    }
  }, 300_000)

  it('binds armpw Lua→S3O→COB/BOS through the host and publishes 2 honest clips', async () => {
    const { vfs, mount } = await rapidMount()
    const opened = await sourceAt(mount, armpwPath)
    try {
      expect(opened.source.size).toBe(3_125n)
      const unitBytes = await opened.source.read(0n, Number(opened.source.size))
      expect(createHash('sha256').update(unitBytes).digest('hex')).toBe(
        '7782d3ae394765dd56f39e41223c69f5f5dcf5339fa48be75c25172d58c848fe',
      )
      const codec = await createUnitCodec(context)
      const plan = await codec.planInput(opened.source, detection)
      expect(plan.requirements.map(item => ({ id: item.id, patterns: item.patterns }))).toEqual([
        { id: 'spring-object-model', patterns: ['objects3d/Units/ARMPW.s3o'] },
        { id: 'spring-unit-script', patterns: ['scripts/Units/ARMPW.cob'] },
        { id: 'spring-script-source', patterns: ['scripts/Units/ARMPW.bos'] },
      ])
      const resolve = createVfsInputResolver(
        { mount, primaryLogicalId: armpwPath, caseSensitivity: 'insensitive' },
        { limits: { maxEntries: 16, maxBindings: 4, maxProbes: 0, maxProbeBytes: 1 } },
      )
      const input = await resolve({ source: opened.source, plan, detection })
      const session = await codec.open(input, 'full', budget)
      try {
        const descriptor = await session.descriptor()
        expect(descriptor.dataSources.map(item => item.contract)).toEqual(
          expect.arrayContaining([
            'common.view/model-animation-source',
            'common.view/relation-graph-source',
          ]),
        )
        const inspectOperation = descriptor.operations.find(item => item.id === 'view.inspect')
        if (inspectOperation === undefined) throw new Error('the unit inspect operation is absent')
        const inspected = await session.operations().invoke(inspectOperation.handlerId, null)
        if (inspected.state !== 'ok' || inspected.output.kind !== 'json') {
          throw new Error('the unit inspect operation did not return its summary')
        }
        expect(inspected.output.value).toMatchObject({
          format: 'spring-unit-definition',
          objectName: 'Units/ARMPW.s3o',
          script: 'Units/ARMPW.cob',
          pieces: 19,
          cob: { state: 'resolved', scripts: 22, pieces: 19 },
          bos: { state: 'resolved', functions: 6, motionStatements: 1162 },
          animations: 2,
          channels: 73,
          boundPieces: 13,
          unsupportedChannels: 1,
        })

        const animationLease = await session.dataSource('common.view/model-animation-source', 1)
        const animation = animationLease.value as ModelAnimationSource
        const clips = (await animation.clips({ limit: 10 })).items
        expect(clips).toEqual([
          expect.objectContaining({ name: 'Walk', frames: 19, channels: expect.any(Array) }),
          expect.objectContaining({ name: 'DeathAnim', frames: 51, channels: expect.any(Array) }),
        ])
        expect(clips[0]?.channels).toHaveLength(30)
        expect(clips[1]?.channels).toHaveLength(43)
        const channels = clips.flatMap(clip => clip.channels)
        expect(new Set(channels.map(channel => channel.target)).size).toBe(13)
        expect(channels.every(channel => /^s3o-piece-\d+$/u.test(channel.target))).toBe(true)
        await animationLease.release()

        const graphLease = await session.dataSource('common.view/relation-graph-source', 1)
        const graph = graphLease.value as RelationGraphSource
        expect(await graph.summary()).toMatchObject({ completeness: 'complete' })
        expect((await graph.edges({ limit: 200 })).items).toEqual(
          expect.arrayContaining([
            { from: 'spring-unit', to: 'spring-model', role: 'objectName' },
            { from: 'spring-unit', to: 'spring-script', role: 'script' },
          ]),
        )
        await graphLease.release()

        const receipt = receiptOf(descriptor)
        expect(receipt.companions).toHaveLength(3)
        expect(receipt.planes.find(plane => plane.planeId === 'animation')).toMatchObject({
          state: 'normalized',
          note: expect.stringMatching(/no COB\/BOS\/Lua execution/u),
        })
        expect(JSON.stringify(receipt)).not.toMatch(/file:\/\/|[A-Za-z]:[\\/]/u)
        proves({
          contributionId: 'org.modkitx/spring-unit-definition',
          operation: 'read',
          note: 'real BAR armpw publishes 2 clips/73 channels/13 stable piece bindings through host-selected rapid companions',
        })
        console.info(
          `[bar-live] ${armpwPath}: 19 pieces, 22 COB scripts, 2 BOS clips, 73 channels, 13 bound pieces`,
        )
      } finally {
        await session.dispose()
      }
    } finally {
      await opened.release()
      await mount.dispose()
      await vfs.dispose()
    }
  }, 300_000)
})
