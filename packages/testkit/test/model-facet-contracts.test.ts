/**
 * The five optional model facet contracts, as published by real codecs (block 12, slice 12-1).
 *
 * Slice 11C0 declared `common.view/model-{resource-refs,skeleton,animation,collision,material}-
 * source@1` with shapes derived from what the block-9 codecs already computed ad hoc in their
 * `summary`. This file is the other half of that move: it asserts the codecs now publish those
 * facts *as contracts*, that the contracts carry the same numbers the sources do, that an absent
 * plane is absent rather than an empty page, and that one generic consumer reads all of them
 * through the same loop without a single format branch.
 *
 * It also covers the `ProjectionReceipt` half. Every migrated codec emits one at open, and it
 * arrives in the descriptor already in its portable form — a receipt that named the machine that
 * produced it would leak that machine into every copy of the descriptor.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  revisionId,
  toPortableProjectionReceipt,
  type ArtifactByteSource,
  type AssetInput,
  type AssetSession,
  type Codec,
  type ContributionContext,
  type ModelCollisionSource,
  type ModelMaterialSource,
  type ModelResourceRefsSource,
  type ModelSkeletonSource,
  type ProjectionReceipt,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
import { MODEL_FACET_CONTRACTS, readModelFacets } from '@modkitx-x3/ui/model'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const fixtureRoot = join(import.meta.dirname, 'fixtures')

const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 64,
  maxNodes: 200_000,
  maxScalarBytes: 10_000_000,
  maxDiagnostics: 100,
}

const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('facet fixtures have no service dependency')
    },
    async resolveUnknown() {
      throw new Error('facet fixtures have no foreign service dependency')
    },
  },
}

function inputFor(name: string, bytes: Uint8Array): AssetInput {
  const uri = `memory://model-facets/${name}`
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`content-hash.sha256:model-facets-${name}`),
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
      compositionFingerprint: `model-facets-${name}`,
    },
    bindingsFor: () => [],
    async openBinding() {
      return { value: source, release: async () => undefined }
    },
  } as unknown as AssetInput
}

const CODECS = {
  m3: 'extensions/blizzard/models/src/m3/codec.js',
  w3d: 'extensions/ea/models/src/westwood-w3d/codec.js',
  w3x: 'extensions/ea/models/src/sage-w3x/codec.js',
  vxl: 'extensions/ea/tiberian-sun/src/red-alert2-vxl/codec.js',
  obj: 'extensions/common/models/src/formats/obj/codec.js',
  uvm: 'extensions/common/models/src/formats/uvm/codec.js',
} as const

async function openCodec(
  format: keyof typeof CODECS,
  bytes: Uint8Array,
): Promise<{ session: AssetSession; contracts: readonly string[]; descriptor: DescriptorShape }> {
  const module = (await import(pathToFileURL(join(repoRoot, CODECS[format])).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  const session = await module.createCodec(context).open(inputFor(format, bytes), 'inspect', budget)
  const descriptor = (await session.descriptor()) as unknown as DescriptorShape
  return {
    session,
    contracts: descriptor.dataSources.map(item => item.contract),
    descriptor,
  }
}

interface DescriptorShape {
  readonly dataSources: readonly { readonly contract: string }[]
  readonly metadata: readonly {
    readonly id: string
    readonly entries: readonly { readonly key: string; readonly value: unknown }[]
  }[]
}

const receiptOf = (descriptor: DescriptorShape): Record<string, unknown> => {
  const group = descriptor.metadata.find(item => item.id === 'uv-projection-receipt')
  if (group === undefined) throw new Error('the descriptor carries no projection receipt')
  return group.entries[0]?.value as Record<string, unknown>
}

/** One record per page, so a facet whose cursor lied would return a different list than a bulk read. */
async function drain<T>(
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

// ---------------------------------------------------------------------------------------------
// fixtures rich enough to have the planes the minimal ones do not

/**
 * A W3X container with two sub-objects — one drawn, one a collision box — riding named bones of a
 * hierarchy the same document declares, plus a shader naming a texture.
 */
const RICH_W3X = `<?xml version="1.0" encoding="utf-8"?>
<AssetDeclaration xmlns="uri:ea.com:eala:asset">
  <W3DHierarchy id="TANK_SKL">
    <Pivot Name="ROOTTRANSFORM" Parent="-1" />
    <Pivot Name="TURRET" Parent="0" />
  </W3DHierarchy>
  <W3DContainer id="TANK" Hierarchy="TANK_SKL">
    <SubObject SubObjectID="HULL" BoneIndex="0"><Mesh>TANK.HULL</Mesh></SubObject>
    <SubObject SubObjectID="HITBOX" BoneIndex="1"><CollisionBox>TANK.HITBOX</CollisionBox></SubObject>
  </W3DContainer>
  <W3DMesh id="TANK.HULL">
    <Vertices>
      <V X="0" Y="0" Z="0" />
      <V X="1" Y="0" Z="0" />
      <V X="0" Y="1" Z="0" />
    </Vertices>
    <Normals>
      <N X="0" Y="0" Z="1" />
      <N X="0" Y="0" Z="1" />
      <N X="0" Y="0" Z="1" />
    </Normals>
    <Triangles>
      <T>
        <V>0</V>
        <V>1</V>
        <V>2</V>
      </T>
    </Triangles>
  </W3DMesh>
  <FXShader id="TANK.SHADER" ShaderName="Default.fx">
    <Texture Name="DiffuseTexture">
      <Value>TankDiffuse</Value>
    </Texture>
  </FXShader>
  <W3DAnimation id="TANK.IDLE" Hierarchy="TANK_SKL">
    <Channel Pivot="1" Type="XTranslation" />
  </W3DAnimation>
</AssetDeclaration>
`

/** An OBJ that names a material library and two materials, which is what the facet is made of. */
const RICH_OBJ = `# facet fixture
mtllib tank.mtl
v 0 0 0
v 1 0 0
v 0 1 0
usemtl hull
f 1 2 3
usemtl tracks
f 3 2 1
`

/**
 * A UVM document with two materials — one carrying a render-model contract, one plain — and a node
 * declaring two collision volumes. Built by editing the shipped minimal document and repacking it
 * with the materializer's own GLB packer, so the bytes stay a document the reader accepts.
 */
async function richUvm(): Promise<Uint8Array> {
  const { packUvmGlb } = (await import(
    pathToFileURL(
      join(repoRoot, 'extensions', 'common', 'uv-materializer', 'src', 'materializer.js'),
    ).href
  )) as { packUvmGlb(document: unknown, binary: Uint8Array): Uint8Array }
  const bytes = new Uint8Array(
    await readFile(join(fixtureRoot, 'mk2-synthetic', 'minimal.uvm.glb')),
  )
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonLength = view.getUint32(12, true)
  const json = new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))
  const binaryLength = view.getUint32(20 + jsonLength, true)
  const binary = bytes.slice(28 + jsonLength, 28 + jsonLength + binaryLength)
  const document = JSON.parse(json) as Record<string, unknown> & {
    extensionsUsed: string[]
    materials?: unknown[]
    nodes: Record<string, unknown>[]
    meshes?: unknown[]
  }
  document.extensionsUsed = [
    ...new Set([...document.extensionsUsed, 'UV_game_material', 'UV_game_collision']),
  ]
  document.materials = [
    {
      name: 'hull',
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0,
        roughnessFactor: 1,
      },
      extensions: {
        UV_game_material: {
          shader: 'lambert',
          params: { renderModel: { version: 1, standard: { shader: 'lambert' } } },
        },
      },
    },
    {
      name: 'tracks',
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0,
        roughnessFactor: 1,
      },
    },
  ]
  document.nodes[0] = {
    ...document.nodes[0],
    extensions: {
      UV_game_collision: {
        role: 'physics',
        shapes: [
          { kind: 'box', size: [2, 2, 2] },
          { kind: 'sphere', radius: 0.5 },
        ],
      },
    },
  }
  return packUvmGlb(document, binary)
}

// ---------------------------------------------------------------------------------------------

describe('W3X publishes its container relations as facet contracts', () => {
  it('publishes references, bone bindings and collision volumes with matching counts', async () => {
    const { session, contracts } = await openCodec('w3x', new TextEncoder().encode(RICH_W3X))
    try {
      expect(contracts).toEqual(
        expect.arrayContaining([
          'common.view/model-resource-refs-source',
          'common.view/model-skeleton-source',
          'common.view/model-collision-source',
        ]),
      )
      // the animation plane is genuinely absent: the reader counts W3DAnimation blocks but decodes
      // no frame count, and `ModelAnimationClip` requires one
      expect(contracts).not.toContain('common.view/model-animation-source')

      const refsLease = await session.dataSource('common.view/model-resource-refs-source', 1)
      const refs = refsLease.value as ModelResourceRefsSource
      const references = await drain(request => refs.references(request))
      expect(await refs.info()).toEqual({ references: 2, bound: 0, truncated: false })
      expect(references).toEqual([
        { id: 'TankDiffuse', role: 'texture', provenance: 'reference-only' },
        // the skeleton the container names by id, published as the sidecar it is
        { id: 'TANK_SKL', role: 'sidecar', provenance: 'reference-only' },
      ])
      await refsLease.release()

      const skeletonLease = await session.dataSource('common.view/model-skeleton-source', 1)
      const skeleton = skeletonLease.value as ModelSkeletonSource
      expect(await skeleton.info()).toEqual({
        bindings: 2,
        named: 2,
        companionBound: 0,
        hierarchies: 1,
      })
      expect(await drain(request => skeleton.bindings(request))).toEqual([
        {
          partId: 'HULL',
          boneIndex: 0,
          boneName: 'ROOTTRANSFORM',
          provenance: 'direct',
          hierarchyId: 'TANK_SKL',
        },
        {
          partId: 'HITBOX',
          boneIndex: 1,
          boneName: 'TURRET',
          provenance: 'direct',
          hierarchyId: 'TANK_SKL',
        },
      ])
      await skeletonLease.release()

      const collisionLease = await session.dataSource('common.view/model-collision-source', 1)
      const collision = collisionLease.value as ModelCollisionSource
      expect(await collision.info()).toEqual({ volumes: 1, byKind: { mesh: 1 } })
      expect(await drain(request => collision.volumes(request))).toEqual([
        { id: 'HITBOX', kind: 'mesh', origin: 'mesh-role', meshId: 'TANK.HITBOX' },
      ])
      await collisionLease.release()
    } finally {
      await session.dispose()
    }
  })

  it('pages one record at a time and refuses an aborted read', async () => {
    const { session } = await openCodec('w3x', new TextEncoder().encode(RICH_W3X))
    try {
      const lease = await session.dataSource('common.view/model-skeleton-source', 1)
      const skeleton = lease.value as ModelSkeletonSource
      const bulk = await skeleton.bindings({ limit: 100 })
      expect(bulk.nextCursor).toBeUndefined()
      // one record per page and one page for all of them must be the same list, or the cursor lies
      expect(await drain(request => skeleton.bindings(request))).toEqual([...bulk.items])
      const first = await skeleton.bindings({ limit: 1 })
      expect(first.nextCursor).toBe('1')
      await expect(skeleton.bindings({ limit: 0 })).rejects.toThrow(TypeError)
      await expect(skeleton.bindings({ limit: 1, cursor: 'nonsense' })).rejects.toThrow(TypeError)
      const aborted = AbortSignal.abort()
      await expect(skeleton.info(aborted)).rejects.toThrow()
      await expect(skeleton.bindings({ limit: 1 }, aborted)).rejects.toThrow()
      await lease.release()
    } finally {
      await session.dispose()
    }
  })
})

describe('OBJ and UVM publish the material facet from two different shapes', () => {
  it('reads OBJ material names and its library reference', async () => {
    const { session, contracts } = await openCodec('obj', new TextEncoder().encode(RICH_OBJ))
    try {
      const materialLease = await session.dataSource('common.view/model-material-source', 1)
      const materials = materialLease.value as ModelMaterialSource
      // `libraries` is a count OBJ really has; `byContract` is absent because OBJ has no contracts
      expect(await materials.info()).toEqual({ materials: 2, libraries: 1 })
      expect(await drain(request => materials.materials(request))).toEqual([
        { id: 'hull', name: 'hull' },
        { id: 'tracks', name: 'tracks' },
      ])
      await materialLease.release()

      const refsLease = await session.dataSource('common.view/model-resource-refs-source', 1)
      const refs = refsLease.value as ModelResourceRefsSource
      expect(await drain(request => refs.references(request))).toEqual([
        { id: 'tank.mtl', role: 'sidecar', provenance: 'reference-only' },
      ])
      await refsLease.release()
      expect(contracts).not.toContain('common.view/model-collision-source')
    } finally {
      await session.dispose()
    }
  })

  it('reads UVM material contracts and declared collision volumes', async () => {
    const { session } = await openCodec('uvm', await richUvm())
    try {
      const materialLease = await session.dataSource('common.view/model-material-source', 1)
      const materials = materialLease.value as ModelMaterialSource
      /*
       * The two publishers exercise different halves of the same contract: OBJ fills `libraries`
       * and leaves `byContract` absent, UVM does the reverse. That is what makes the shape proved
       * generic rather than fitted to one source.
       */
      expect(await materials.info()).toEqual({
        materials: 2,
        byContract: { 'UV_game_material/standard': 1 },
      })
      expect(await drain(request => materials.materials(request))).toEqual([
        { id: 'material-0', name: 'hull', contracts: ['UV_game_material/standard'] },
        { id: 'material-1', name: 'tracks' },
      ])
      await materialLease.release()

      const collisionLease = await session.dataSource('common.view/model-collision-source', 1)
      const collision = collisionLease.value as ModelCollisionSource
      expect(await collision.info()).toEqual({ volumes: 2, byKind: { box: 1, sphere: 1 } })
      const volumes = await drain(request => collision.volumes(request))
      // `declared-volume`, where W3D and W3X publish `mesh-role` — both values of the enum have a
      // publisher, which is the second half of the §2.7 evidence for admitting this contract
      expect(volumes.map(volume => volume.origin)).toEqual(['declared-volume', 'declared-volume'])
      expect(volumes.map(volume => volume.types)).toEqual([['physics'], ['physics']])
      await collisionLease.release()
    } finally {
      await session.dispose()
    }
  })
})

describe('every migrated model codec emits a portable projection receipt', () => {
  it.each([
    { format: 'm3', fixture: join(fixtureRoot, 'models', 'triangle.m3') },
    { format: 'w3d', fixture: join(fixtureRoot, 'mk2-synthetic', 'minimal.westwood.w3d') },
    { format: 'w3x', fixture: join(fixtureRoot, 'mk2-synthetic', 'minimal.sage.w3x') },
    { format: 'vxl', fixture: join(fixtureRoot, 'mk2-synthetic', 'minimal.ra2.vxl') },
    { format: 'obj', fixture: join(fixtureRoot, 'mk2-synthetic', 'minimal.obj') },
    { format: 'uvm', fixture: join(fixtureRoot, 'mk2-synthetic', 'minimal.uvm.glb') },
  ] as const)('$format states its basis, its planes and its evidence', async entry => {
    const bytes = new Uint8Array(await readFile(entry.fixture))
    const { session, descriptor } = await openCodec(entry.format, bytes)
    try {
      const receipt = receiptOf(descriptor) as {
        form: string
        sourceUri?: unknown
        sourceIdentity: { kind: string }
        basis: Record<string, unknown>
        planes: readonly { planeId: string; state: string }[]
        evidence: readonly { kind: string }[]
        confidence: string
        subjectRevision: string
      }
      expect(receipt.form).toBe('portable')
      expect(receipt.sourceUri).toBeUndefined()
      expect(receipt.sourceIdentity.kind).toBe('redacted')
      expect(receipt.subjectRevision).toBe(`content-hash.sha256:model-facets-${entry.format}`)
      expect(receipt.basis['handedness']).toBe('right')
      expect(['x', 'y', 'z']).toContain(receipt.basis['upAxis'])
      // a receipt made only of what the format says about itself is a claim; every one of these
      // has at least one thing the reader actually observed
      expect(receipt.evidence.some(item => item.kind === 'observed')).toBe(true)
      expect(receipt.planes.length).toBeGreaterThan(1)
      for (const plane of receipt.planes) {
        expect(['normalized', 'preserved', 'inferred', 'lost']).toContain(plane.state)
      }
      // the geometry plane says whether a conversion happened; the four codecs that rotate axes
      // say `normalized`, the three that copy them say `preserved`
      const geometry = receipt.planes.find(plane => plane.planeId === 'geometry')
      expect(geometry?.state).toBe(
        entry.format === 'm3' || entry.format === 'obj' || entry.format === 'uvm'
          ? 'preserved'
          : 'normalized',
      )
      expect(['exact', 'high', 'partial', 'heuristic']).toContain(receipt.confidence)
      // nothing in the receipt may look like a machine-local path
      expect(JSON.stringify(receipt)).not.toMatch(/file:\/\/|[A-Za-z]:[\\/]/u)
    } finally {
      await session.dispose()
    }
  })

  it('drops an ambient URI on the way to the portable form', async () => {
    const { createProjectionReceipt, projectionReceiptMetadataGroup } = (await import(
      pathToFileURL(join(repoRoot, 'extensions', 'codec-kit', 'codec-kit', 'src', 'index.js')).href
    )) as {
      createProjectionReceipt(input: unknown): ProjectionReceipt
      projectionReceiptMetadataGroup(
        receipt: ProjectionReceipt,
        identity: { kind: 'opaque'; token: string },
      ): { entries: readonly { value: unknown }[] }
    }
    const local = createProjectionReceipt({
      adapter: { id: 'org.example/leaky', version: '1.0.0' },
      subjectRevision: revisionId('content-hash.sha256:leaky'),
      companions: [],
      basis: { handedness: 'right', upAxis: 'y', forwardAxis: '-z', unit: 'source-unit' },
      planes: [{ planeId: 'geometry', state: 'preserved' }],
      evidence: [{ kind: 'observed', statement: 'read', bytesRead: 2n ** 60n }],
      confidence: 'exact',
      sourceUri: 'file:///C:/Apps/StarCraft%20II/artifact1.m3',
    })
    expect(local.form).toBe('local')
    expect(local.sourceUri).toBe('file:///C:/Apps/StarCraft%20II/artifact1.m3')
    const group = projectionReceiptMetadataGroup(local, { kind: 'opaque', token: 'corpus-1' })
    const published = group.entries[0]?.value as Record<string, unknown>
    expect(published['form']).toBe('portable')
    expect(published['sourceUri']).toBeUndefined()
    expect(published['sourceIdentity']).toEqual({ kind: 'opaque', token: 'corpus-1' })
    // a byte count past 2^53 survives as a decimal string rather than being rounded by JSON
    expect(JSON.stringify(published)).toContain('"1152921504606846976"')
    expect(
      toPortableProjectionReceipt(local, { kind: 'redacted', reason: 'x' }).sourceUri,
    ).toBeUndefined()
  })

  it('refuses a receipt with no plane, no evidence or an invented plane state', async () => {
    const { createProjectionReceipt } = (await import(
      pathToFileURL(join(repoRoot, 'extensions', 'codec-kit', 'codec-kit', 'src', 'index.js')).href
    )) as { createProjectionReceipt(input: unknown): ProjectionReceipt }
    const base = {
      adapter: { id: 'org.example/thing', version: '1.0.0' },
      subjectRevision: revisionId('content-hash.sha256:thing'),
      companions: [],
      basis: { handedness: 'right', upAxis: 'y', forwardAxis: '-z', unit: 'source-unit' },
      planes: [{ planeId: 'geometry', state: 'preserved' }],
      evidence: [{ kind: 'observed', statement: 'read' }],
      confidence: 'exact',
    }
    expect(() => createProjectionReceipt({ ...base, planes: [] })).toThrow(TypeError)
    expect(() => createProjectionReceipt({ ...base, evidence: [] })).toThrow(TypeError)
    expect(() =>
      createProjectionReceipt({ ...base, planes: [{ planeId: 'geometry', state: 'mostly-fine' }] }),
    ).toThrow(TypeError)
    expect(() => createProjectionReceipt({ ...base, confidence: 'probably' })).toThrow(TypeError)
  })
})

describe('one generic consumer reads every publisher the same way', () => {
  /**
   * The §2.7 "generic consumer" evidence, executed rather than asserted in prose.
   *
   * `readModelFacets` is the shipped model stage's own facet loop. It is handed two subjects from
   * two unrelated families — a SAGE XML container and a Wavefront OBJ — and produces a readout for
   * each without being told which is which. The stage has no format branch to fall back on: what it
   * shows is exactly what the descriptor published.
   */
  const slotFor = (contracts: readonly string[]): unknown => ({
    slotId: 'test:model',
    kind: 'primary',
    contributionId: 'org.modkitx.testkit/model',
    extensionId: 'org.modkitx.testkit',
    priority: 100,
    bindings: contracts.map(contract => ({ bindingId: `facet:${contract}`, contract, major: 1 })),
  })

  it('renders facet counts for a W3X and an OBJ through one code path', async () => {
    const leases: { release(): Promise<void> }[] = []
    const scope = {
      lease<T>(value: T): T {
        leases.push(value as unknown as { release(): Promise<void> })
        return value
      },
    }
    const readouts: Record<string, readonly string[]> = {}
    for (const [format, bytes] of [
      ['w3x', new TextEncoder().encode(RICH_W3X)],
      ['obj', new TextEncoder().encode(RICH_OBJ)],
    ] as const) {
      const { session, contracts } = await openCodec(format, bytes)
      // the slot binds only what this descriptor published — an optional source is optional
      const bound = MODEL_FACET_CONTRACTS.filter(contract => contracts.includes(contract))
      const sources = {
        async get(binding: { contract: string; major?: number }) {
          return session.dataSource(binding.contract as never, binding.major ?? 1)
        },
      }
      readouts[format] = await readModelFacets(sources as never, slotFor(bound) as never, scope)
      await session.dispose()
    }
    expect(readouts['w3x']).toEqual(['2 resources', '2 bones', '1 collision'])
    expect(readouts['obj']).toEqual(['1 resources', '2 materials'])
    expect(leases.length).toBe(5)
  })

  it('says nothing at all for a subject that publishes no facet', async () => {
    const bytes = new Uint8Array(
      await readFile(join(fixtureRoot, 'mk2-synthetic', 'minimal.ra2.vxl')),
    )
    const { session, contracts } = await openCodec('vxl', bytes)
    // a VXL with no HVA bound has no animation plane to publish, and the stage prints no "0 clips"
    expect(contracts).not.toContain('common.view/model-animation-source')
    const readout = await readModelFacets(
      {
        async get() {
          throw new Error('nothing is bound')
        },
      } as never,
      slotFor([]) as never,
      { lease: value => value },
    )
    expect(readout).toEqual([])
    await session.dispose()
  })
})
