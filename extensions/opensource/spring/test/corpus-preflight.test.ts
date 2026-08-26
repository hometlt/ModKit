import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type ContributionContext,
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
import { createCodec as createS3oCodec } from '../src/formats/spring-s3o/codec.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..')
const corpusRoot = process.env['MODKITX_BAR_ROOT']
const configured = typeof corpusRoot === 'string' && corpusRoot.length > 0
const manifestPath = configured
  ? join(corpusRoot, 'data', 'packages', '705fa44d676b3633ea970038d8c593a8.sdp')
  : ''
const candidatePath = 'objects3d/airbomb.s3o'
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
      throw new Error('S3O codec has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('S3O codec has no foreign service dependency')
    },
  },
}

interface RapidRecord {
  readonly path: string
  readonly md5: string
  readonly size: number
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}

function parseRapidRecords(bytes: Uint8Array): RapidRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const records: RapidRecord[] = []
  let cursor = 0
  while (cursor < bytes.byteLength) {
    const nameLength = bytes[cursor] ?? 0
    cursor += 1
    if (nameLength === 0 || cursor + nameLength + 24 > bytes.byteLength) {
      throw new TypeError('Spring rapid manifest record is truncated')
    }
    const path = new TextDecoder('ascii').decode(bytes.subarray(cursor, cursor + nameLength))
    cursor += nameLength
    const md5 = hex(bytes.subarray(cursor, cursor + 16))
    cursor += 16
    cursor += 4
    const size = view.getUint32(cursor, false)
    cursor += 4
    records.push({ path, md5, size })
  }
  return records
}

function inputFor(bytes: Uint8Array): AssetInput {
  const uri = 'memory://bar-rapid/objects3d/airbomb.s3o'
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(
      'content-hash.sha256:c208233aabfd58fa83237ddf69e56c0ac29fd44c1290fee11c198be1d8fe37c2',
    ),
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

describe.skipIf(!configured)('Beyond All Reason S3O live corpus', () => {
  it('opens airbomb.s3o directly from the rapid pool stream and materializes it', async () => {
    if (!existsSync(manifestPath)) {
      throw new Error('MODKITX_BAR_ROOT does not identify BAR data with the pinned rapid manifest')
    }
    const records = parseRapidRecords(gunzipSync(readFileSync(manifestPath)))
    expect(records.filter(record => record.path.endsWith('.s3o'))).toHaveLength(2_036)
    const candidate = records.find(record => record.path === candidatePath)
    expect(candidate).toEqual({
      path: candidatePath,
      md5: '3b2a9fb660e91f63d76afbfb1aa4c022',
      size: 19_189,
    })
    if (candidate === undefined) throw new Error('the pinned S3O rapid record is missing')
    const poolPath = join(
      corpusRoot ?? '',
      'data',
      'pool',
      candidate.md5.slice(0, 2),
      `${candidate.md5.slice(2)}.gz`,
    )
    if (!existsSync(poolPath)) throw new Error('the pinned S3O rapid pool blob is missing')
    const bytes = gunzipSync(readFileSync(poolPath))
    expect(bytes).toHaveLength(candidate.size)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'c208233aabfd58fa83237ddf69e56c0ac29fd44c1290fee11c198be1d8fe37c2',
    )

    const session = await createS3oCodec(context).open(inputFor(bytes), 'full', budget)
    try {
      const descriptor = await session.descriptor()
      expect(descriptor.identity.codecId).toBe('org.modkitx/spring-s3o')
      expect(descriptor.dataSources.map(item => item.contract)).not.toContain(
        'common.view/model-animation-source',
      )
      proves({
        contributionId: 'org.modkitx/spring-s3o',
        operation: 'inspect',
        note: 'real airbomb.s3o opens from the BAR rapid pool without a materialized corpus file',
      })
      const inspectOperation = descriptor.operations.find(item => item.id === 'view.inspect')
      if (inspectOperation === undefined) throw new Error('the S3O inspect operation is absent')
      const inspected = await session.operations().invoke(inspectOperation.handlerId, null)
      if (inspected.state !== 'ok' || inspected.output.kind !== 'json') {
        throw new Error('the S3O inspect operation did not return its summary')
      }
      const summary = inspected.output.value

      const modelLease = await session.dataSource('common.view/model-scene-source', 1)
      const model = modelLease.value as ModelSceneSource
      const info = await model.info()
      const projection = await drainModelProjection(model, { maxBytes: budget.maxScalarBytes })
      await modelLease.release()
      expect(info).toMatchObject({
        nodes: 1,
        meshes: 1,
        primitives: 1,
        textures: 2,
        animations: 0,
        geometryAccess: 'decoded',
      })
      expect(summary).toEqual({
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

      const refsLease = await session.dataSource('common.view/model-resource-refs-source', 1)
      const refs = refsLease.value as ModelResourceRefsSource
      const refsInfo = await refs.info()
      const refPage = await refs.references({ limit: 8 })
      await refsLease.release()
      expect(refsInfo.references).toBe(2)
      expect(refPage.items).toHaveLength(2)

      const receipt = receiptOf(descriptor)
      expect(receipt.form).toBe('portable')
      expect(receipt.companions).toEqual([])
      expect(receipt.planes.find(plane => plane.planeId === 'animation')).toMatchObject({
        state: 'lost',
        note: expect.stringMatching(/BOS\/COB|Lua/u),
      })
      expect(JSON.stringify(receipt)).not.toMatch(/file:\/\/|[A-Za-z]:[\\/]/u)
      proves({
        contributionId: 'org.modkitx/spring-s3o',
        operation: 'read',
        note: 'real S3O publishes stable piece hierarchy and texture refs while naming external animation',
      })

      const verdict = await materializeAndCompare(repoRoot, projection, {
        assetId: `bar/${candidatePath}`,
        sourceFormat: 's3o',
        subjectRevision: session.revision,
        assetClass: 'unit',
      })
      expect(verdict.byteStable).toBe(true)
      expect(verdict.exact).toBe(false)
      expect(verdict.bytes).toHaveLength(20_528)
      expect(verdict.receipt.diff).toHaveLength(6)
      expect(unexplainedDifferences(verdict)).toEqual([])
      proves({
        contributionId: 'org.modkitx/spring-s3o',
        operation: 'materialize',
        note: 'real S3O projection materializes byte-stably with every independently observed diff explained',
      })
      console.info(
        `[bar-live] ${candidatePath}: ${info.nodes} nodes, ${info.meshes} meshes, ` +
          `${info.primitives} primitives, ${refsInfo.references} texture refs; ` +
          `UVM ${verdict.bytes.byteLength} bytes, exact=${verdict.exact}, ` +
          `receipt=${verdict.receipt.diff.length}; summary=${JSON.stringify(summary)}`,
      )
    } finally {
      await session.dispose()
    }
  }, 300_000)
})
