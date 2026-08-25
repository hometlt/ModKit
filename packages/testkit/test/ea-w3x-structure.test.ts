/**
 * SAGE W3X container relations, the skeleton include companion, and reference safety.
 *
 * W3X states more than most game formats, and the point of this suite is that the reader takes it
 * literally. A container names its skeleton by id and its bones by index; a sub-object says in the
 * element itself whether it is a `<Mesh>` or a `<CollisionBox>`. So render and collision are read,
 * not guessed — and a bone's *name*, which lives only in the other file, is published with
 * `companion` provenance rather than folded into this document's direct facts.
 *
 * The refusals matter as much: a reference is an asset id, never a path. A document that writes
 * `../../elsewhere` where an id belongs is rejected, because a model file may not widen the search
 * the host granted it.
 */

import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  createSubjectServices,
  openSubject,
  type Inventory,
} from '@modkitx-x3/host'
import { createPathSubjectOpener, loadExtensionDirectory } from '@modkitx-x3/host/node'
import {
  revisionId,
  type ArtifactByteSource,
  type AssetSession,
  type ModelCollisionSource,
  type ModelResourceRefsSource,
  type ModelSkeletonSource,
  type NamespaceEntrySource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
import {
  drainModelProjection,
  materializeAndCompare,
  unexplainedDifferences,
} from '@modkitx-x3/testkit'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'w3x-structure', classes: ['read-source'] } as const
const budget: ResourceBudget = {
  maxInputBytes: 32_000_000n,
  maxDepth: 32,
  maxNodes: 500_000,
  maxScalarBytes: 32_000_000,
  maxDiagnostics: 100,
}

// ---------------------------------------------------------------------------------------------
// documents

const HEAD =
  '<?xml version="1.0" encoding="UTF-8"?>\n' + '<AssetDeclaration xmlns="uri:ea.com:eala:asset">\n'
const TAIL = '</AssetDeclaration>\n'

interface SubObjectSpec {
  readonly id: string
  readonly boneIndex: number
  readonly kind: 'Mesh' | 'CollisionBox'
}

function container(id: string, hierarchyRef: string | undefined, subs: readonly SubObjectSpec[]) {
  const attribute = hierarchyRef === undefined ? '' : ` Hierarchy="${hierarchyRef}"`
  return (
    `\t<W3DContainer id="${id}"${attribute}>\n` +
    subs
      .map(
        sub =>
          `\t\t<SubObject SubObjectID="${sub.id}" BoneIndex="${sub.boneIndex}">\n` +
          `\t\t\t<RenderObject>\n\t\t\t\t<${sub.kind}>${id}.${sub.id}</${sub.kind}>\n\t\t\t</RenderObject>\n` +
          '\t\t</SubObject>\n',
      )
      .join('') +
    '\t</W3DContainer>\n'
  )
}

function hierarchy(
  id: string,
  pivots: readonly { readonly name: string; readonly parent: number }[],
) {
  return (
    `\t<W3DHierarchy id="${id}">\n` +
    pivots
      .map(
        pivot =>
          `\t\t<Pivot Name="${pivot.name}" Parent="${pivot.parent}">\n` +
          '\t\t\t<Translation X="0.0" Y="0.0" Z="0.0"/>\n\t\t</Pivot>\n',
      )
      .join('') +
    '\t</W3DHierarchy>\n'
  )
}

/** A minimal decodable mesh, so a document under test is a real model and not just a stub. */
function meshWithShader(
  id: string,
  textures: readonly { readonly slot: string; readonly value: string }[],
) {
  return (
    `\t<W3DMesh id="${id}" GeometryType="Normal">\n` +
    '\t\t<Vertices><V X="0" Y="0" Z="0"/><V X="1" Y="0" Z="0"/><V X="0" Y="1" Z="0"/></Vertices>\n' +
    '\t\t<Normals><N X="0" Y="0" Z="1"/><N X="0" Y="0" Z="1"/><N X="0" Y="0" Z="1"/></Normals>\n' +
    '\t\t<Triangles><T><V>0</V><V>1</V><V>2</V></T></Triangles>\n' +
    (textures.length === 0
      ? ''
      : '\t\t<FXShader ShaderName="Test.fx">\n\t\t\t<Constants>\n' +
        textures
          .map(
            texture =>
              `\t\t\t\t<Texture Name="${texture.slot}">\n\t\t\t\t\t<Value>${texture.value}</Value>\n\t\t\t\t</Texture>\n`,
          )
          .join('') +
        '\t\t\t</Constants>\n\t\t</FXShader>\n') +
    '\t</W3DMesh>\n'
  )
}

function document(...parts: readonly string[]): Uint8Array {
  return new TextEncoder().encode(HEAD + parts.join('') + TAIL)
}

// ---------------------------------------------------------------------------------------------
// host wiring

const executionBackends = createExecutionBackendRegistry([
  {
    profile: 'trusted-in-process',
    supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
    async activate(context) {
      return {
        module: (await import(context.entrypoint.href)) as Record<string, unknown>,
        release: async () => undefined,
      }
    },
  },
])

let cached: Inventory | undefined

async function inventory(): Promise<Inventory> {
  if (cached !== undefined) return cached
  const inputs = await Promise.all(
    [
      ['ea', 'models'],
      ['ea', 'big'],
    ].map(async parts => ({
      ...(await loadExtensionDirectory(join(repoRoot, 'extensions', ...parts))),
      execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
    })),
  )
  cached = await buildInventory(inputs, createHostContributionContractRegistry())
  return cached
}

const temporaries: string[] = []

afterEach(async () => {
  while (temporaries.length > 0) {
    const directory = temporaries.pop()
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  }
})

interface W3xSummary {
  readonly containerRelations: readonly {
    readonly id: string
    readonly hierarchyRef: string | null
    readonly hierarchyProvenance: string
    readonly subObjects: number
  }[]
  readonly modelParts: readonly {
    readonly id: string
    readonly boneIndex: number
    readonly role: string
    readonly boneName: string | null
    readonly boneProvenance: string
  }[]
  readonly declaredPivots: readonly { readonly id: string; readonly pivots: number }[]
  readonly animationBlocks: readonly { readonly id: string; readonly channels: number }[]
  readonly textureReferences: readonly {
    readonly slot: string
    readonly value: string
    readonly provenance: string
  }[]
  readonly textureBindings: readonly { readonly bindingId: string }[]
  readonly collisionParts: readonly string[]
  readonly renderParts: readonly string[]
  readonly unknownElements: readonly { readonly name: string; readonly count: number }[]
}

async function openOnDisk(
  main: Uint8Array,
  extras: Readonly<Record<string, Uint8Array>> = {},
  name = 'model.w3x',
): Promise<{
  readonly summary: W3xSummary
  readonly diagnostics: readonly string[]
  readonly session: AssetSession
}> {
  const directory = await mkdtemp(join(tmpdir(), 'x3-w3x-'))
  temporaries.push(directory)
  await writeFile(join(directory, name), main)
  for (const [file, payload] of Object.entries(extras)) {
    await writeFile(join(directory, file), payload)
  }
  const subjects = createSubjectServices({
    inventory: await inventory(),
    target,
    executionBackends,
  })
  const open = createPathSubjectOpener({ subjects, roots: [directory], budget, grant })
  const { snapshot, session } = await open(join(directory, name))
  if (snapshot.state !== 'opened' || session === undefined) {
    throw new Error(JSON.stringify(snapshot.diagnostics))
  }
  const inspected = await session.operations().invoke('inspect', null)
  if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('inspect')
  return {
    summary: inspected.output.value as unknown as W3xSummary,
    diagnostics: snapshot.diagnostics.map(item => item.code),
    session,
  }
}

// ---------------------------------------------------------------------------------------------

describe('W3X container relations', () => {
  it('reads model parts with explicit bones and the role the document states', async () => {
    const bytes = document(
      container('TANK', 'TANK_SKL', [
        { id: 'HULL', boneIndex: 1, kind: 'Mesh' },
        { id: 'TURRET', boneIndex: 2, kind: 'Mesh' },
        { id: 'OBBOX', boneIndex: 0, kind: 'CollisionBox' },
      ]),
      meshWithShader('TANK.HULL', []),
    )
    const { summary, session } = await openOnDisk(bytes)

    expect(summary.containerRelations).toEqual([
      expect.objectContaining({ id: 'TANK', hierarchyRef: 'TANK_SKL', subObjects: 3 }),
    ])
    // the collision box is collision because the element says CollisionBox, not because of its name
    expect(summary.collisionParts).toEqual(['OBBOX'])
    expect(summary.renderParts).toEqual(['HULL', 'TURRET'])
    expect(summary.modelParts.map(part => [part.id, part.boneIndex])).toEqual([
      ['HULL', 1],
      ['TURRET', 2],
      ['OBBOX', 0],
    ])
    await session.dispose()
  })

  it('leaves a bone unnamed when no hierarchy is reachable, instead of borrowing the part id', async () => {
    /*
     * The sub-object is called `TURRET` and, in the skeleton that is not here, so is bone 2. A
     * reader that filled the gap from the part's own id would produce exactly the right answer for
     * exactly the wrong reason, and the wrong answer as soon as the two disagree.
     */
    const bytes = document(
      container('TANK', 'TANK_SKL', [{ id: 'TURRET', boneIndex: 2, kind: 'Mesh' }]),
      meshWithShader('TANK.TURRET', []),
    )
    const { summary, session } = await openOnDisk(bytes)
    expect(summary.modelParts[0]).toMatchObject({
      id: 'TURRET',
      boneName: null,
      boneProvenance: 'absent',
    })
    expect(summary.containerRelations[0]?.hierarchyProvenance).toBe('reference-only')
    await session.dispose()
  })

  it('names bones from the bound skeleton and marks them as companion facts', async () => {
    const bytes = document(
      container('TANK', 'TANK_SKL', [
        { id: 'HULL', boneIndex: 1, kind: 'Mesh' },
        { id: 'TURRET', boneIndex: 2, kind: 'Mesh' },
      ]),
      meshWithShader('TANK.HULL', []),
    )
    const skeleton = document(
      hierarchy('TANK_SKL', [
        { name: 'ROOTTRANSFORM', parent: -1 },
        { name: 'CHASSIS', parent: 0 },
        { name: 'GUNMOUNT', parent: 1 },
      ]),
    )
    const { summary, session } = await openOnDisk(bytes, { 'TANK_SKL.w3x': skeleton })

    expect(summary.containerRelations[0]?.hierarchyProvenance).toBe('companion')
    // the names come from the other file and say so; note they differ from the part ids on purpose
    expect(summary.modelParts.map(part => [part.id, part.boneName, part.boneProvenance])).toEqual([
      ['HULL', 'CHASSIS', 'companion'],
      ['TURRET', 'GUNMOUNT', 'companion'],
    ])
    await session.dispose()
  })

  it('reads a nested hierarchy from the document itself as a direct fact', async () => {
    const bytes = document(
      container('TANK', 'TANK_SKL', [{ id: 'HULL', boneIndex: 1, kind: 'Mesh' }]),
      hierarchy('TANK_SKL', [
        { name: 'ROOTTRANSFORM', parent: -1 },
        { name: 'CHASSIS', parent: 0 },
      ]),
      meshWithShader('TANK.HULL', []),
    )
    const { summary, session } = await openOnDisk(bytes)
    expect(summary.declaredPivots).toEqual([{ id: 'TANK_SKL', pivots: 2, provenance: 'direct' }])
    expect(summary.modelParts[0]).toMatchObject({ boneName: 'CHASSIS', boneProvenance: 'direct' })
    await session.dispose()
  })
})

describe('W3X references are ids, never paths', () => {
  it.each([
    ['a parent traversal', '../../elsewhere/TANK_SKL'],
    ['an absolute path', '/etc/TANK_SKL'],
    ['a windows path', 'C:\\models\\TANK_SKL'],
    ['a url', 'https://example.invalid/TANK_SKL'],
  ])('refuses a hierarchy reference that is %s', async (_label, reference) => {
    const bytes = document(
      container('TANK', reference, [{ id: 'HULL', boneIndex: 1, kind: 'Mesh' }]),
      meshWithShader('TANK.HULL', []),
    )
    const { summary, session } = await openOnDisk(bytes)
    // the reference is dropped rather than turned into a search, and the document still opens
    expect(summary.containerRelations[0]?.hierarchyRef).toBeNull()
    expect(summary.containerRelations[0]?.hierarchyProvenance).toBe('absent')
    await session.dispose()
  })

  it('refuses a texture reference that names a location', async () => {
    const bytes = document(
      meshWithShader('TANK.HULL', [{ slot: 'DiffuseTexture', value: '../../secrets/key' }]),
    )
    const { summary, session } = await openOnDisk(bytes)
    expect(summary.textureReferences).toEqual([])
    await session.dispose()
  })
})

describe('W3X texture companions', () => {
  it('declares the exact texture ids the shader names and binds what exists', async () => {
    const bytes = document(
      meshWithShader('TANK.HULL', [
        { slot: 'DiffuseTexture', value: 'TankDiffuse' },
        { slot: 'NormalMap', value: 'TankNormal' },
      ]),
    )
    const { summary, session } = await openOnDisk(bytes, {
      'TankDiffuse.dds': new Uint8Array([1, 2, 3]),
      // the normal map is absent: a reference without a file is still a reference
    })
    expect(summary.textureReferences.map(item => item.value)).toEqual(['TankDiffuse', 'TankNormal'])
    expect(summary.textureBindings).toHaveLength(1)
    await session.dispose()
  })

  it('opens with no textures present at all', async () => {
    const bytes = document(
      meshWithShader('TANK.HULL', [{ slot: 'DiffuseTexture', value: 'Missing' }]),
    )
    const { summary, session } = await openOnDisk(bytes)
    expect(summary.textureReferences[0]).toMatchObject({ provenance: 'reference-only' })
    expect(summary.textureBindings).toEqual([])
    await session.dispose()
  })
})

describe('W3X unknown elements', () => {
  it('reports tags it does not decode instead of dropping them silently', async () => {
    const bytes = document(
      meshWithShader('TANK.HULL', []),
      '\t<W3DSomethingNew Version="3"><Inner/></W3DSomethingNew>\n',
    )
    const { summary, session } = await openOnDisk(bytes)
    expect(summary.unknownElements).toEqual(
      expect.arrayContaining([
        { name: 'W3DSomethingNew', count: 1 },
        { name: 'Inner', count: 1 },
      ]),
    )
    await session.dispose()
  })
})

describe('W3X inside a BIG namespace', () => {
  function buildBig(entries: readonly { readonly path: string; readonly bytes: Uint8Array }[]) {
    const encoder = new TextEncoder()
    const named = entries.map(entry => ({ ...entry, name: encoder.encode(entry.path) }))
    const indexBytes = named.reduce((total, e) => total + 8 + e.name.byteLength + 1, 0)
    const dataOffset = 16 + indexBytes
    const total = named.reduce((size, e) => size + e.bytes.byteLength, dataOffset)
    const archive = new Uint8Array(total)
    const view = new DataView(archive.buffer)
    archive.set(encoder.encode('BIG4'), 0)
    view.setUint32(4, total, true)
    view.setUint32(8, named.length, false)
    view.setUint32(12, dataOffset, false)
    let cursor = 16
    let payload = dataOffset
    for (const entry of named) {
      view.setUint32(cursor, payload, false)
      view.setUint32(cursor + 4, entry.bytes.byteLength, false)
      cursor += 8
      archive.set(entry.name, cursor)
      cursor += entry.name.byteLength
      archive[cursor] = 0
      cursor += 1
      archive.set(entry.bytes, payload)
      payload += entry.bytes.byteLength
    }
    return archive
  }

  it('binds the skeleton out of the same archive through current-mount', async () => {
    const { openNestedSubject } = (await import(
      pathToFileURL(join(repoRoot, 'packages', 'host', 'src', 'nested-subject.js')).href
    )) as typeof import('../../host/src/nested-subject.js')

    const model = document(
      container('TANK', 'TANK_SKL', [{ id: 'HULL', boneIndex: 1, kind: 'Mesh' }]),
      meshWithShader('TANK.HULL', []),
    )
    const skeleton = document(
      hierarchy('TANK_SKL', [
        { name: 'ROOTTRANSFORM', parent: -1 },
        { name: 'CHASSIS', parent: 0 },
      ]),
    )
    const archive = buildBig([
      { path: 'art/models/tank.w3x', bytes: model },
      { path: 'art/skeletons/TANK_SKL.w3x', bytes: skeleton },
    ])
    const uri = 'memory://w3x-big/fixture.big'
    const source: ArtifactByteSource = Object.freeze({
      kind: 'bytes' as const,
      ref: { id: uri, uri },
      revision: revisionId('content-hash.sha256:w3x-big'),
      size: BigInt(archive.byteLength),
      async read(offset: bigint, length: number) {
        return archive.slice(Number(offset), Number(offset) + length)
      },
      async *stream() {
        yield archive
      },
    })
    const inventoryValue = await inventory()
    const opened = await openSubject({
      inventory: inventoryValue,
      source,
      path: 'fixture.big',
      intent: 'full',
      target,
      grant,
      budget,
      executionBackends,
    })
    if (opened.state !== 'opened') throw new Error('the BIG fixture did not open')
    try {
      const lease = await opened.session.dataSource('common.view/namespace-entry-source', 1)
      const page = await (lease.value as NamespaceEntrySource).list('', { limit: 20 })
      const entry = page.items.find(item => item.path === 'art/models/tank.w3x')
      await lease.release()
      if (entry === undefined) throw new Error('archive has no W3X entry')
      const nested = await openNestedSubject({
        parent: opened.session,
        entryId: entry.id,
        inventory: inventoryValue,
        executionBackends,
        target,
        grant,
        budget,
      })
      if (nested.result.state !== 'opened') {
        throw new Error(JSON.stringify(nested.result.diagnostics).slice(0, 400))
      }
      expect(nested.result.selected.contributionId).toBe('org.modkitx/sage-w3x')
      const inspected = await nested.result.session.operations().invoke('inspect', null)
      if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('inspect')
      const summary = inspected.output.value as unknown as W3xSummary
      // the skeleton sits in another folder of the same archive; the exact id-derived name finds it
      expect(summary.containerRelations[0]?.hierarchyProvenance).toBe('companion')
      expect(summary.modelParts[0]).toMatchObject({
        boneName: 'CHASSIS',
        boneProvenance: 'companion',
      })
      await nested.result.session.dispose()
    } finally {
      await opened.session.dispose()
    }
  })
})

describe('the configured real SAGE W3X model', () => {
  const realW3x = process.env['MODKITX_W3X_PATH']?.trim()
  const available = realW3x !== undefined && existsSync(realW3x)

  it.skipIf(!available)('reads the shipped mesh and its shader texture references', async () => {
    if (realW3x === undefined) throw new TypeError('MODKITX_W3X_PATH is not set')
    const directory = await mkdtemp(join(tmpdir(), 'x3-w3x-real-'))
    temporaries.push(directory)
    const name = basename(realW3x)
    await cp(realW3x, join(directory, name))
    // the whole authored set travels together: the container names the skeleton, the meshes name
    // textures, and all of them are siblings in the shipped folder
    const folder = dirname(realW3x)
    for (const sibling of ['GUPREDTANK_SKN.w3x', 'GUPREDTANK_SKL.w3x']) {
      if (existsSync(join(folder, sibling)))
        await cp(join(folder, sibling), join(directory, sibling))
    }
    const subjects = createSubjectServices({
      inventory: await inventory(),
      target,
      executionBackends,
    })
    const open = createPathSubjectOpener({ subjects, roots: [directory], budget, grant })

    const mesh = await open(join(directory, name))
    if (mesh.snapshot.state !== 'opened' || mesh.session === undefined) {
      throw new Error(JSON.stringify(mesh.snapshot.diagnostics))
    }
    const meshInspected = await mesh.session.operations().invoke('inspect', null)
    if (meshInspected.state !== 'ok' || meshInspected.output.kind !== 'json') throw new Error('x')
    const meshSummary = meshInspected.output.value as unknown as W3xSummary
    expect(meshSummary.textureReferences.length).toBeGreaterThan(0)
    console.info(
      `[w3x-live] mesh textures ${meshSummary.textureReferences.map(item => item.slot).join(', ')}`,
    )
    await mesh.session.dispose()

    if (!existsSync(join(directory, 'GUPREDTANK_SKN.w3x'))) return
    const containerOpen = await open(join(directory, 'GUPREDTANK_SKN.w3x'))
    if (containerOpen.snapshot.state !== 'opened' || containerOpen.session === undefined) {
      throw new Error(JSON.stringify(containerOpen.snapshot.diagnostics))
    }
    const inspected = await containerOpen.session.operations().invoke('inspect', null)
    if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('inspect')
    const summary = inspected.output.value as unknown as W3xSummary
    /*
     * The end-to-end case this slice exists for: the shipped container references a skeleton by id,
     * the host resolves it as a sibling, and the bone names arrive from that file marked as
     * companion facts. The collision box is collision because the document says so.
     */
    expect(summary.containerRelations[0]?.hierarchyProvenance).toBe('companion')
    expect(summary.collisionParts.length).toBeGreaterThan(0)
    expect(summary.renderParts.length).toBeGreaterThan(0)
    expect(summary.modelParts.some(part => part.boneProvenance === 'companion')).toBe(true)
    console.info(
      `[w3x-live] parts ${summary.modelParts.length}, render ${summary.renderParts.length}, ` +
        `collision ${summary.collisionParts.length}, bones from companion ` +
        `${summary.modelParts.filter(part => part.boneProvenance === 'companion').length}`,
    )

    /*
     * Slice 11C1: the shipped container's live projection, materialized through the one
     * materializer. W3X names its parts after what the format calls them, so the artifact binding
     * renumbers them and the hashes differ honestly. What the gate requires is that every
     * difference carry a receipt entry, and the harness derives the differences itself rather than
     * believing the receipt.
     */
    /*
     * Block 12 slice 12-1: the same facts the summary carries, read through the facet contracts
     * that are now their authority. The numbers are printed rather than pinned — the corpus belongs
     * to the user and this repository does not ship it — but the *shape* is asserted: bone names
     * that arrived from the bound sidecar must be marked `companion` in the contract too, or the
     * migration moved the authority and dropped the provenance on the way.
     */
    const skeletonLease = await containerOpen.session.dataSource(
      'common.view/model-skeleton-source',
      1,
    )
    const skeleton = skeletonLease.value as ModelSkeletonSource
    const skeletonInfo = await skeleton.info()
    expect(skeletonInfo.bindings).toBeGreaterThan(0)
    expect(skeletonInfo.companionBound).toBeGreaterThan(0)
    expect(skeletonInfo.companionBound).toBe(
      summary.modelParts.filter(part => part.boneProvenance === 'companion').length,
    )
    await skeletonLease.release()

    const collisionLease = await containerOpen.session.dataSource(
      'common.view/model-collision-source',
      1,
    )
    const collision = collisionLease.value as ModelCollisionSource
    const collisionInfo = await collision.info()
    expect(collisionInfo.volumes).toBe(summary.collisionParts.length)
    await collisionLease.release()

    const refsLease = await containerOpen.session.dataSource(
      'common.view/model-resource-refs-source',
      1,
    )
    const refs = refsLease.value as ModelResourceRefsSource
    const refsInfo = await refs.info()
    // the skeleton sidecar is a `zero-or-one` requirement, so *that* reference is attributable
    expect(refsInfo.bound).toBeGreaterThan(0)
    await refsLease.release()

    const receipt = (
      (await containerOpen.session.descriptor()) as unknown as {
        readonly metadata: readonly {
          readonly id: string
          readonly entries: readonly { readonly value: unknown }[]
        }[]
      }
    ).metadata.find(group => group.id === 'uv-projection-receipt')?.entries[0]?.value as {
      readonly form: string
      readonly confidence: string
      readonly planes: readonly { readonly planeId: string; readonly state: string }[]
      readonly companions: readonly { readonly requirementId: string; readonly state: string }[]
    }
    expect(receipt.form).toBe('portable')
    expect(receipt.companions.find(item => item.requirementId === 'hierarchy')?.state).toBe('bound')
    expect(JSON.stringify(receipt)).not.toMatch(/file:\/\/|[A-Za-z]:[\\/]/u)
    console.info(
      `[w3x-live] facets: refs ${refsInfo.references} (bound ${refsInfo.bound}), ` +
        `bones ${skeletonInfo.bindings} (named ${skeletonInfo.named}, companion ` +
        `${skeletonInfo.companionBound}), collision ${collisionInfo.volumes}; receipt planes ` +
        `${receipt.planes.map(plane => `${plane.planeId}=${plane.state}`).join(', ')}, ` +
        `confidence ${receipt.confidence}`,
    )

    const modelLease = await containerOpen.session.dataSource('common.view/model-scene-source', 1)
    try {
      const drained = await drainModelProjection(modelLease.value, {
        maxBytes: budget.maxScalarBytes,
      })
      const verdict = await materializeAndCompare(repoRoot, drained, {
        assetId: 'sage/GUPREDTANK_SKN',
        sourceFormat: 'w3x',
        subjectRevision: containerOpen.session.revision,
        assetClass: 'unit',
      })
      expect(verdict.byteStable).toBe(true)
      expect(unexplainedDifferences(verdict)).toEqual([])
      console.info(
        `[w3x-live] materialized ${verdict.bytes.byteLength} bytes, exact=${verdict.exact}, ` +
          `receipt entries=${verdict.receipt.diff.length}`,
      )
    } finally {
      await modelLease.release()
    }
    await containerOpen.session.dispose()
  })
})
