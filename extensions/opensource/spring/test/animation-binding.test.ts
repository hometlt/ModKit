import { describe, expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetInput,
  type AssetSession,
  type ContributionContext,
  type ModelAnimationSource,
  type RelationGraphSource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
import { proves } from '@modkitx-x3/testkit'
import { createCodec as createUnitCodec } from '../src/formats/spring-unit/codec.js'

const budget: ResourceBudget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 32,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('Spring bound-unit codec has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('Spring bound-unit codec has no foreign service dependency')
    },
  },
}

function writeString(bytes: Uint8Array, offset: number, value: string): void {
  const encoded = new TextEncoder().encode(value)
  bytes.set(encoded, offset)
  bytes[offset + encoded.length] = 0
}

function syntheticS3o(piece = 'wing'): Uint8Array {
  const bytes = new Uint8Array(192)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('Spring unit\0'), 0)
  view.setInt32(12, 0, true)
  view.setFloat32(16, 1, true)
  view.setFloat32(20, 1, true)
  view.setInt32(36, 80, true)
  view.setInt32(80, 140, true)
  view.setInt32(84, 0, true)
  view.setInt32(88, 0, true)
  view.setInt32(92, 0, true)
  view.setInt32(96, 0, true)
  view.setInt32(100, 0, true)
  view.setInt32(104, 0, true)
  view.setInt32(108, 0, true)
  view.setInt32(112, 0, true)
  view.setInt32(116, 0, true)
  writeString(bytes, 140, piece)
  return bytes
}

function syntheticCob(script = 'Walk', piece = 'wing'): Uint8Array {
  const scriptBytes = new TextEncoder().encode(`${script}\0`)
  const pieceBytes = new TextEncoder().encode(`${piece}\0`)
  const strings = 56
  const bytes = new Uint8Array(strings + scriptBytes.length + pieceBytes.length)
  const view = new DataView(bytes.buffer)
  view.setInt32(0, 4, true)
  view.setInt32(4, 1, true)
  view.setInt32(8, 1, true)
  view.setInt32(12, 0, true)
  view.setInt32(16, 0, true)
  view.setInt32(20, 0, true)
  view.setInt32(24, 44, true)
  view.setInt32(28, 48, true)
  view.setInt32(32, 52, true)
  view.setInt32(36, 44, true)
  view.setInt32(40, 56, true)
  view.setInt32(44, 0, true)
  view.setInt32(48, strings, true)
  view.setInt32(52, strings + scriptBytes.length, true)
  bytes.set(scriptBytes, strings)
  bytes.set(pieceBytes, strings + scriptBytes.length)
  return bytes
}

function source(name: string, bytes: Uint8Array): ArtifactByteSource {
  const uri = `memory://spring-unit/${name}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:${name.replace(/[^a-z0-9-]/giu, '-')}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      signal?.throwIfAborted()
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream(_range, signal) {
      signal?.throwIfAborted()
      yield bytes
    },
  }
}

function inputFor(options: {
  readonly unit?: Uint8Array
  readonly model?: Uint8Array
  readonly cob?: Uint8Array
  readonly bos?: Uint8Array
}): AssetInput {
  const sources = new Map([
    [
      'content',
      source(
        'units-test-lua',
        options.unit ??
          new TextEncoder().encode(
            'return { objectName = "Units/Test.s3o", script = "Units/Test.cob" }',
          ),
      ),
    ],
    [
      'spring-object-model#model',
      source('objects3d-units-test-s3o', options.model ?? syntheticS3o()),
    ],
    ...(options.cob === undefined
      ? []
      : ([['spring-unit-script#cob', source('scripts-units-test-cob', options.cob)]] as const)),
    ...(options.bos === undefined
      ? []
      : ([['spring-script-source#bos', source('scripts-units-test-bos', options.bos)]] as const)),
  ])
  const primary = sources.get('content')
  if (primary === undefined) throw new Error('unit source missing')
  const requirements = [
    ['spring-object-model#model', 'spring-object-model', 'object-model'],
    ...(options.cob === undefined
      ? []
      : ([['spring-unit-script#cob', 'spring-unit-script', 'unit-script']] as const)),
    ...(options.bos === undefined
      ? []
      : ([['spring-script-source#bos', 'spring-script-source', 'script-source']] as const)),
  ] as const
  const bindings = [
    {
      sourceKind: 'candidate' as const,
      bindingId: 'content',
      role: 'unit-definition',
      ownership: 'owned' as const,
      source: primary.ref,
      revision: primary.revision,
    },
    ...requirements.map(([bindingId, requirementId, role]) => {
      const value = sources.get(bindingId)
      if (value === undefined) throw new Error(`source ${bindingId} missing`)
      return {
        sourceKind: 'requirement' as const,
        bindingId,
        requirementId,
        role,
        ownership: 'companion' as const,
        source: value.ref,
        revision: value.revision,
      }
    }),
  ]
  return {
    originKind: 'bundle',
    bindings: bindings as AssetInput['bindings'],
    primaryBindingId: 'content',
    revisions: {
      topology: 'bundle',
      revision: primary.revision,
      bindings: bindings.map(binding => ({
        bindingId: binding.bindingId,
        revision: binding.revision,
      })),
      compositionFingerprint: 'spring-unit-fixture',
    },
    bindingsFor(requirementId) {
      return bindings.filter(
        binding => binding.sourceKind === 'requirement' && binding.requirementId === requirementId,
      ) as ReturnType<AssetInput['bindingsFor']>
    },
    async openBinding(bindingId) {
      const value = sources.get(bindingId)
      if (value === undefined) throw new Error(`binding ${bindingId} missing`)
      return { value, release: async () => undefined }
    },
  }
}

async function open(
  options: Parameters<typeof inputFor>[0],
  limits: ResourceBudget = budget,
  signal?: AbortSignal,
): Promise<AssetSession> {
  return (await createUnitCodec(context)).open(inputFor(options), 'full', limits, signal)
}

describe('Spring external animation binding', () => {
  it('publishes only static BOS tracks proven through COB names and stable S3O piece ids', async () => {
    const bos = new TextEncoder().encode(`
piece wing;
Walk() {
  if (TRUE) { //Frame:2
    turn wing to x-axis <10> speed <5>;
    move wing to y-axis [2] speed [1];
  }
  if (TRUE) { //Frame:4
    turn wing to x-axis <20> speed <5>;
  }
}`)
    const session = await open({ cob: syntheticCob(), bos })
    try {
      const descriptor = await session.descriptor()
      expect(descriptor.dataSources.map(item => item.contract)).toEqual(
        expect.arrayContaining([
          'common.view/model-animation-source',
          'common.view/relation-graph-source',
        ]),
      )
      const animationLease = await session.dataSource('common.view/model-animation-source', 1)
      const animation = animationLease.value as ModelAnimationSource
      expect(await animation.info()).toEqual({ clips: 1, channelled: 1, companionBound: 1 })
      expect((await animation.clips({ limit: 10 })).items).toEqual([
        expect.objectContaining({
          id: 'bos-walk',
          name: 'Walk',
          provenance: 'companion',
          frames: 5,
          channels: [
            {
              target: 's3o-piece-80',
              kind: 'rotation',
              axis: 'x',
              firstFrame: 2,
              lastFrame: 4,
            },
            {
              target: 's3o-piece-80',
              kind: 'translation',
              axis: 'y',
              firstFrame: 2,
              lastFrame: 2,
            },
          ],
        }),
      ])
      await animationLease.release()

      const graphLease = await session.dataSource('common.view/relation-graph-source', 1)
      const graph = graphLease.value as RelationGraphSource
      const edges = await graph.edges({ limit: 100 })
      expect(edges.items).toEqual(
        expect.arrayContaining([
          { from: 'spring-unit', to: 'spring-model', role: 'objectName' },
          { from: 'spring-unit', to: 'spring-script', role: 'script' },
          { from: 'bos-walk', to: 's3o-piece-80', role: 'rotation:x' },
        ]),
      )
      await graphLease.release()
      proves({
        contributionId: 'org.modkitx/spring-unit-definition',
        operation: 'read',
        note: 'BOS Frame markers bind through COB tables to stable S3O piece ids without execution',
      })
    } finally {
      await session.dispose()
    }
  })

  it('withholds animation for absent, broken or unbound scripts and fails budgets/cancellation closed', async () => {
    const noScript = await open({})
    expect((await noScript.descriptor()).dataSources.map(item => item.contract)).not.toContain(
      'common.view/model-animation-source',
    )
    await noScript.dispose()

    const bos = new TextEncoder().encode(
      'piece ghost; Walk() { if (TRUE) { //Frame:2\n turn ghost to x-axis <1>; } }',
    )
    const broken = await open({ cob: Uint8Array.from([1, 2, 3]), bos })
    const brokenDescriptor = await broken.descriptor()
    expect(brokenDescriptor.dataSources.map(item => item.contract)).not.toContain(
      'common.view/model-animation-source',
    )
    expect(brokenDescriptor.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'x3.spring/spring-unit-script-unreadable' }),
      ]),
    )
    await broken.dispose()

    const unbound = await open({ cob: syntheticCob('Walk', 'ghost'), bos })
    expect((await unbound.descriptor()).dataSources.map(item => item.contract)).not.toContain(
      'common.view/model-animation-source',
    )
    await unbound.dispose()

    await expect(
      open({ cob: syntheticCob(), bos: new Uint8Array(64) }, { ...budget, maxScalarBytes: 32 }),
    ).rejects.toThrow(/maxScalarBytes/u)
    const controller = new AbortController()
    controller.abort()
    await expect(open({ cob: syntheticCob(), bos }, budget, controller.signal)).rejects.toThrow(
      /abort|cancel/iu,
    )
    proves({
      contributionId: 'org.modkitx/spring-unit-definition',
      operation: 'validate',
      note: 'missing/broken scripts, nonexistent pieces, budgets and cancellation never fabricate animation',
    })
  })
})
