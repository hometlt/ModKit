/**
 * W3D hierarchy, HLOD binding, animation channels and texture companions.
 *
 * This is the slice that clears the one honest `poorer` row the parity corpus carried: the
 * canonical reader publishes an animation channel for the real `d_teslacoil_ch.w3d` and this one
 * published none. What made that worth fixing carefully rather than quickly is that every binding
 * here is a place where a plausible guess is available and wrong — a mesh and a pivot often share a
 * name, pivots are usually in parent order, and a texture reference usually resolves next door.
 * None of those are used: the mesh↔bone table comes from `HLOD_SUB_OBJECT`, parents come from
 * `parentIndex`, and texture names become exact companion patterns the host resolves or does not.
 *
 * Fixtures are assembled from the repository's own synthetic W3D by appending real chunks to it, so
 * the mesh under test is the mesh the other suites already decode.
 */

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
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
  type ModelAnimationSource,
  type ModelResourceRefsSource,
  type ModelSceneSource,
  type ModelSkeletonSource,
  type NamespaceEntrySource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const syntheticDir = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')
const meshFixture = join(syntheticDir, 'minimal.westwood.w3d')
/** Identities the synthetic mesh declares in its `MESH_HEADER3`. */
const MESH_NAME = 'TRI'
const MESH_CONTAINER = 'FIXTURE'
const MESH_TEXTURE = 'fixture.tga'

const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'w3d-structure', classes: ['read-source'] } as const
const budget: ResourceBudget = {
  maxInputBytes: 8_000_000n,
  maxDepth: 32,
  maxNodes: 200_000,
  maxScalarBytes: 8_000_000,
  maxDiagnostics: 100,
}

// ---------------------------------------------------------------------------------------------
// W3D chunk builders

const CHUNK_HIERARCHY = 0x100
const CHUNK_HIERARCHY_HEADER = 0x101
const CHUNK_PIVOTS = 0x102
const CHUNK_ANIMATION = 0x200
const CHUNK_ANIMATION_HEADER = 0x201
const CHUNK_ANIMATION_CHANNEL = 0x202
const CHUNK_COMPRESSED_ANIMATION = 0x280
const CHUNK_HLOD = 0x700
const CHUNK_HLOD_HEADER = 0x701
const CHUNK_HLOD_LOD_ARRAY = 0x702
const CHUNK_HLOD_SUB_OBJECT = 0x704

function chunk(type: number, payload: Uint8Array, hasChildren = false): Uint8Array {
  const out = new Uint8Array(8 + payload.byteLength)
  const view = new DataView(out.buffer)
  view.setUint32(0, type, true)
  view.setUint32(4, (payload.byteLength | (hasChildren ? 0x80000000 : 0)) >>> 0, true)
  out.set(payload, 8)
  return out
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const out = new Uint8Array(total)
  let cursor = 0
  for (const part of parts) {
    out.set(part, cursor)
    cursor += part.byteLength
  }
  return out
}

function fixed(text: string, length: number): Uint8Array {
  const out = new Uint8Array(length)
  out.set(new TextEncoder().encode(text).slice(0, length - 1))
  return out
}

interface Pivot {
  readonly name: string
  readonly parentIndex: number
}

function hierarchyChunk(name: string, pivots: readonly Pivot[]): Uint8Array {
  const header = new Uint8Array(36)
  const headerView = new DataView(header.buffer)
  headerView.setUint32(0, 0x40001, true)
  header.set(fixed(name, 16), 4)
  headerView.setUint32(20, pivots.length, true)
  // 60-byte pivot records: name[16], parentIndex, translation[3], euler[3], quaternion[4]
  const table = new Uint8Array(pivots.length * 60)
  const tableView = new DataView(table.buffer)
  pivots.forEach((pivot, index) => {
    const at = index * 60
    table.set(fixed(pivot.name, 16), at)
    tableView.setInt32(at + 16, pivot.parentIndex, true)
    tableView.setFloat32(at + 56, 1, true) // quaternion w
  })
  return chunk(
    CHUNK_HIERARCHY,
    concat([chunk(CHUNK_HIERARCHY_HEADER, header), chunk(CHUNK_PIVOTS, table)]),
    true,
  )
}

interface Channel {
  readonly pivot: number
  readonly firstFrame: number
  readonly lastFrame: number
  /** 0..2 select a translation axis, 3 an orientation quaternion. */
  readonly flags: number
  readonly vectorLen?: number
  /** Truncate the encoded channel to this many payload bytes, to model damage. */
  readonly truncateTo?: number
}

function channelChunk(channel: Channel): Uint8Array {
  const vectorLen = channel.vectorLen ?? (channel.flags === 3 ? 4 : 1)
  const frames = channel.lastFrame - channel.firstFrame + 1
  const payload = new Uint8Array(12 + frames * vectorLen * 4)
  const view = new DataView(payload.buffer)
  view.setUint16(0, channel.firstFrame, true)
  view.setUint16(2, channel.lastFrame, true)
  view.setUint16(4, vectorLen, true)
  view.setUint16(6, channel.flags, true)
  view.setUint16(8, channel.pivot, true)
  for (let index = 0; index < frames * vectorLen; index += 1) {
    view.setFloat32(12 + index * 4, index * 0.5, true)
  }
  return chunk(
    CHUNK_ANIMATION_CHANNEL,
    channel.truncateTo === undefined ? payload : payload.slice(0, channel.truncateTo),
  )
}

function animationChunk(
  name: string,
  hierarchyName: string,
  frames: number,
  channels: readonly Channel[],
): Uint8Array {
  const header = new Uint8Array(44)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x40001, true)
  header.set(fixed(name, 16), 4)
  header.set(fixed(hierarchyName, 16), 20)
  view.setUint32(36, frames, true)
  view.setUint32(40, 30, true)
  return chunk(
    CHUNK_ANIMATION,
    concat([chunk(CHUNK_ANIMATION_HEADER, header), ...channels.map(channelChunk)]),
    true,
  )
}

function hlodChunk(
  name: string,
  hierarchyName: string,
  subObjects: readonly { readonly boneIndex: number; readonly name: string }[],
): Uint8Array {
  const header = new Uint8Array(40)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x10000, true)
  view.setUint32(4, 1, true)
  header.set(fixed(name, 16), 8)
  header.set(fixed(hierarchyName, 16), 24)
  const subs = subObjects.map(sub => {
    const payload = new Uint8Array(36)
    new DataView(payload.buffer).setUint32(0, sub.boneIndex, true)
    payload.set(fixed(sub.name, 32), 4)
    return chunk(CHUNK_HLOD_SUB_OBJECT, payload)
  })
  return chunk(
    CHUNK_HLOD,
    concat([chunk(CHUNK_HLOD_HEADER, header), chunk(CHUNK_HLOD_LOD_ARRAY, concat(subs), true)]),
    true,
  )
}

/** A compressed-animation chunk this reader deliberately does not decode. */
function compressedAnimationChunk(payloadBytes: number): Uint8Array {
  return chunk(CHUNK_COMPRESSED_ANIMATION, new Uint8Array(payloadBytes).fill(0x5a), false)
}

let meshBytes: Uint8Array | undefined

async function mesh(): Promise<Uint8Array> {
  meshBytes ??= new Uint8Array(await readFile(meshFixture))
  return meshBytes
}

/** The synthetic mesh with structural chunks appended after it. */
async function model(parts: readonly Uint8Array[]): Promise<Uint8Array> {
  return concat([await mesh(), ...parts])
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

/** The codec with no host around it, for assertions the host layer does not carry through. */
async function directCodecOpen(value: ArtifactByteSource, resourceBudget: ResourceBudget) {
  const module = (await import(
    pathToFileURL(join(repoRoot, 'extensions', 'ea', 'models', 'src', 'westwood-w3d', 'codec.js'))
      .href
  )) as { createCodec(context: unknown): import('@modkitx-x3/sdk').Codec }
  const codec = module.createCodec({
    budgets: resourceBudget,
    diagnostics: { report: () => undefined },
    contracts: {
      async resolve() {
        throw new Error('W3D has no service dependency')
      },
      async resolveUnknown() {
        throw new Error('W3D has no foreign service dependency')
      },
    },
  })
  return codec.open(
    {
      originKind: 'single',
      bindings: [
        {
          sourceKind: 'candidate',
          bindingId: 'content',
          role: 'content',
          ownership: 'owned',
          source: value.ref,
          revision: value.revision,
        },
      ],
      primaryBindingId: 'content',
      revisions: {
        topology: 'single',
        revision: value.revision,
        bindings: [{ bindingId: 'content', revision: value.revision }],
        compositionFingerprint: value.ref.id,
      },
      bindingsFor: () => [],
      async openBinding() {
        return { value, release: async () => undefined }
      },
    } as never,
    'inspect',
    resourceBudget,
  )
}

const temporaries: string[] = []

afterEach(async () => {
  while (temporaries.length > 0) {
    const directory = temporaries.pop()
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  }
})

interface W3dSummary {
  readonly hierarchy: {
    readonly name: string
    readonly pivots: readonly { readonly name: string; readonly parentIndex: number }[]
  } | null
  readonly animations: readonly {
    readonly name: string
    readonly hierarchyName: string
    readonly frames: number
    readonly channels: readonly { readonly pivot: number; readonly kind: string }[]
    readonly unsupportedChannels: number
  }[]
  readonly meshBindings: readonly {
    readonly mesh: string
    readonly binding: string
    readonly roles: { readonly render: boolean; readonly collision: boolean }
  }[]
  readonly collision: { readonly meshes: readonly string[]; readonly boxes: number }
  readonly preservedUnsupportedChunks: readonly { readonly preservedBytes: number }[]
  readonly textures: readonly string[]
  readonly textureBindings: readonly { readonly bindingId: string; readonly provenance: string }[]
}

async function openOnDisk(
  bytes: Uint8Array,
  extras: Readonly<Record<string, Uint8Array>> = {},
): Promise<{
  readonly summary: W3dSummary
  readonly model: ModelSceneSource
  readonly diagnostics: readonly string[]
  readonly session: AssetSession
}> {
  const directory = await mkdtemp(join(tmpdir(), 'x3-w3d-'))
  temporaries.push(directory)
  await writeFile(join(directory, 'model.w3d'), bytes)
  for (const [name, payload] of Object.entries(extras)) {
    await writeFile(join(directory, name), payload)
  }
  const subjects = createSubjectServices({
    inventory: await inventory(),
    target,
    executionBackends,
  })
  const open = createPathSubjectOpener({ subjects, roots: [directory], budget, grant })
  const { snapshot, session } = await open(join(directory, 'model.w3d'))
  if (snapshot.state !== 'opened' || session === undefined) {
    throw new Error(JSON.stringify(snapshot.diagnostics))
  }
  const inspected = await session.operations().invoke('inspect', null)
  if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('inspect')
  const lease = await session.dataSource('common.view/model-scene-source', 1)
  return {
    summary: inspected.output.value as unknown as W3dSummary,
    model: lease.value as ModelSceneSource,
    diagnostics: snapshot.diagnostics.map(item => item.code),
    session,
  }
}

// ---------------------------------------------------------------------------------------------

describe('W3D hierarchy and its explicit bindings', () => {
  it('reads several pivots and parents each by its own field, not by position', async () => {
    /*
     * The pivot order here is deliberately not the parent order: pivot 1's parent is 2, and 2's is
     * the root. A reader that assumed "previous entry is my parent" would build a chain and this
     * test would catch it.
     */
    const bytes = await model([
      hierarchyChunk('FIXTURE', [
        { name: 'ROOT', parentIndex: -1 },
        { name: 'HAND', parentIndex: 2 },
        { name: 'ARM', parentIndex: 0 },
      ]),
    ])
    const { summary, model: scene, session } = await openOnDisk(bytes)

    expect(summary.hierarchy?.name).toBe('FIXTURE')
    expect(summary.hierarchy?.pivots).toEqual([
      { index: 0, name: 'ROOT', parentIndex: -1 },
      { index: 1, name: 'HAND', parentIndex: 2 },
      { index: 2, name: 'ARM', parentIndex: 0 },
    ])
    expect(await scene.info()).toMatchObject({ nodes: 3 })
    const nodes = (await scene.nodes({ limit: 10 })).items
    expect(nodes.map(node => [node.name, node.childIds])).toEqual([
      ['ROOT', ['w3d-pivot-2']],
      ['HAND', []],
      ['ARM', ['w3d-pivot-1']],
    ])
    await session.dispose()
  })

  it('binds a mesh to a bone only because an HLOD sub-object names it', async () => {
    const bytes = await model([
      hierarchyChunk('FIXTURE', [
        { name: 'ROOT', parentIndex: -1 },
        { name: 'TRI', parentIndex: 0 },
      ]),
      hlodChunk('FIXTURE', 'FIXTURE', [{ boneIndex: 1, name: `${MESH_CONTAINER}.${MESH_NAME}` }]),
    ])
    const { summary, model: scene, session } = await openOnDisk(bytes)
    expect(summary.meshBindings[0]).toMatchObject({ binding: 'hlod' })
    const nodes = (await scene.nodes({ limit: 10 })).items
    expect(nodes[1]?.meshIds).toEqual(['w3d-mesh-0'])
    expect(nodes[0]?.meshIds).toEqual([])
    await session.dispose()
  })

  it('leaves a mesh unbound when the sub-object names something else', async () => {
    /*
     * The pivot is called `TRI` and so is the mesh — the exact coincidence a name-matching reader
     * would fall for. The HLOD table points at a different mesh, so nothing may be bound.
     */
    const bytes = await model([
      hierarchyChunk('FIXTURE', [
        { name: 'ROOT', parentIndex: -1 },
        { name: 'TRI', parentIndex: 0 },
      ]),
      hlodChunk('FIXTURE', 'FIXTURE', [{ boneIndex: 1, name: 'FIXTURE.SOMETHINGELSE' }]),
    ])
    const { model: scene, session } = await openOnDisk(bytes)
    const nodes = (await scene.nodes({ limit: 10 })).items
    // the mesh falls back to the hierarchy root, visibly unbound rather than attached by name
    expect(nodes[1]?.meshIds).toEqual([])
    expect(nodes[0]?.meshIds).toEqual(['w3d-mesh-0'])
    await session.dispose()
  })
})

describe('W3D animation channels', () => {
  it('decodes a supported translation channel and counts one animation', async () => {
    const bytes = await model([
      hierarchyChunk('FIXTURE', [
        { name: 'ROOT', parentIndex: -1 },
        { name: 'TRI', parentIndex: 0 },
      ]),
      animationChunk('SPIN', 'FIXTURE', 61, [{ pivot: 1, firstFrame: 1, lastFrame: 60, flags: 2 }]),
    ])
    const { summary, model: scene, session } = await openOnDisk(bytes)
    expect(await scene.info()).toMatchObject({ animations: 1 })
    expect(summary.animations).toEqual([
      {
        name: 'SPIN',
        hierarchyName: 'FIXTURE',
        frames: 61,
        frameRate: 30,
        channels: [{ pivot: 1, kind: 'translation', axis: 'z', firstFrame: 1, lastFrame: 60 }],
        unsupportedChannels: 0,
      },
    ])
    await session.dispose()
  })

  it('decodes an orientation channel as a rotation', async () => {
    const bytes = await model([
      hierarchyChunk('FIXTURE', [{ name: 'ROOT', parentIndex: -1 }]),
      animationChunk('TURN', 'FIXTURE', 5, [{ pivot: 0, firstFrame: 0, lastFrame: 4, flags: 3 }]),
    ])
    const { summary, session } = await openOnDisk(bytes)
    expect(summary.animations[0]?.channels).toEqual([
      { pivot: 0, kind: 'rotation', firstFrame: 0, lastFrame: 4 },
    ])
    await session.dispose()
  })

  it('refuses a channel whose declared length does not fit its payload', async () => {
    const bytes = await model([
      hierarchyChunk('FIXTURE', [{ name: 'ROOT', parentIndex: -1 }]),
      animationChunk('SHORT', 'FIXTURE', 61, [
        { pivot: 0, firstFrame: 1, lastFrame: 60, flags: 2, truncateTo: 40 },
      ]),
    ])
    const { summary, model: scene, session } = await openOnDisk(bytes)
    // the animation is still reported, with the channel counted as unsupported rather than guessed
    expect(summary.animations[0]).toMatchObject({ name: 'SHORT', unsupportedChannels: 1 })
    expect(summary.animations[0]?.channels).toEqual([])
    // and an animation with no decoded channel is not an animation that was read
    expect(await scene.info()).toMatchObject({ animations: 0 })
    await session.dispose()
  })

  it('refuses an unknown channel flag instead of inventing a meaning for it', async () => {
    const bytes = await model([
      hierarchyChunk('FIXTURE', [{ name: 'ROOT', parentIndex: -1 }]),
      animationChunk('WEIRD', 'FIXTURE', 3, [
        { pivot: 0, firstFrame: 0, lastFrame: 2, flags: 9, vectorLen: 1 },
      ]),
    ])
    const { summary, session } = await openOnDisk(bytes)
    expect(summary.animations[0]).toMatchObject({ unsupportedChannels: 1 })
    await session.dispose()
  })

  it('preserves a compressed-animation chunk it does not decode, and says so', async () => {
    /*
     * `COMPRESSED_ANIMATION` (0x280) appears nowhere in the corpus this repository can read, so it
     * is not implemented from the specification alone. What it must do is survive: the bytes stay
     * addressable and the reader states the size it left alone.
     */
    const bytes = await model([compressedAnimationChunk(128)])
    const { summary, model: scene, session } = await openOnDisk(bytes)
    expect(summary.preservedUnsupportedChunks).toEqual([
      expect.objectContaining({ type: 'compressed-animation', preservedBytes: 128 }),
    ])
    expect(await scene.info()).toMatchObject({ animations: 0, geometryAccess: 'decoded' })
    await session.dispose()
  })
})

describe('W3D texture companions', () => {
  it('declares the exact texture the model names and binds it from the sibling directory', async () => {
    const bytes = await model([])
    const { summary, session } = await openOnDisk(bytes, {
      [MESH_TEXTURE]: new Uint8Array([1, 2, 3, 4]),
    })
    expect(summary.textures).toEqual([MESH_TEXTURE])
    expect(summary.textureBindings).toEqual([expect.objectContaining({ provenance: 'companion' })])
    await session.dispose()
  })

  it('opens with the texture missing and reports it as unbound', async () => {
    const { summary, model: scene, session } = await openOnDisk(await model([]))
    expect(summary.textures).toEqual([MESH_TEXTURE])
    expect(summary.textureBindings).toEqual([])
    // the reference is still published — the model names a texture whether or not it is reachable
    expect(await scene.info()).toMatchObject({ textures: 1 })
    await session.dispose()
  })

  it('does not bind a differently named texture that happens to sit beside the model', async () => {
    const { summary, session } = await openOnDisk(await model([]), {
      'something-else.tga': new Uint8Array([9, 9]),
    })
    expect(summary.textureBindings).toEqual([])
    await session.dispose()
  })
})

describe('W3D inside a BIG namespace', () => {
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

  async function openInBig(
    entries: readonly { readonly path: string; readonly bytes: Uint8Array }[],
    entryPath: string,
  ) {
    const { openNestedSubject } = (await import(
      pathToFileURL(join(repoRoot, 'packages', 'host', 'src', 'nested-subject.js')).href
    )) as typeof import('../../host/src/nested-subject.js')
    const archive = buildBig(entries)
    const uri = 'memory://w3d-big/fixture.big'
    const source: ArtifactByteSource = Object.freeze({
      kind: 'bytes' as const,
      ref: { id: uri, uri },
      revision: revisionId('content-hash.sha256:w3d-big'),
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
    const lease = await opened.session.dataSource('common.view/namespace-entry-source', 1)
    const page = await (lease.value as NamespaceEntrySource).list('', { limit: 20 })
    const entry = page.items.find(item => item.path === entryPath)
    await lease.release()
    if (entry === undefined) throw new Error(`archive has no ${entryPath}`)
    const nested = await openNestedSubject({
      parent: opened.session,
      entryId: entry.id,
      inventory: inventoryValue,
      executionBackends,
      target,
      grant,
      budget,
    })
    return { opened, nested }
  }

  it('binds the texture out of the same archive through current-mount', async () => {
    const { opened, nested } = await openInBig(
      [
        { path: 'art/models/model.w3d', bytes: await model([]) },
        { path: 'art/textures/fixture.tga', bytes: new Uint8Array([7, 7, 7]) },
      ],
      'art/models/model.w3d',
    )
    try {
      if (nested.result.state !== 'opened') {
        throw new Error(JSON.stringify(nested.result.diagnostics).slice(0, 400))
      }
      expect(nested.result.selected.contributionId).toBe('org.modkitx/westwood-w3d')
      const inspected = await nested.result.session.operations().invoke('inspect', null)
      if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('inspect')
      const summary = inspected.output.value as unknown as W3dSummary
      // the texture lives in another folder of the same archive; the exact-name pattern finds it
      expect(summary.textureBindings).toEqual([
        expect.objectContaining({ provenance: 'companion' }),
      ])
      await nested.result.session.dispose()
    } finally {
      await opened.session.dispose()
    }
  })

  it('resolves the same texture through the post-open ResourceSessionPort (block 12 item 7)', async () => {
    /*
     * The port's second container, and the point of running it twice.
     *
     * Slice 11C0 proved the `ResourceSessionPort` against a CASC namespace, and one container
     * cannot tell you whether a port is container-independent or merely CASC-shaped. A BIG archive
     * is a different beast entirely — flat big-endian index, no CDN, no encoding table — and the
     * port is handed it through the same `createNamespaceCompanionOrigin` seam with the same
     * confinement, the same bounded prefix listing and the same coded outcomes.
     *
     * Unlike the SC2 case, this reference *does* resolve: the texture is in the archive. So this is
     * also the first end-to-end proof that the port resolves rather than only refusing well.
     */
    const { createNamespaceCompanionOrigin } = (await import(
      pathToFileURL(join(repoRoot, 'packages', 'host', 'src', 'namespace-origin.js')).href
    )) as typeof import('../../host/src/namespace-origin.js')
    const { createResourceSession } = (await import(
      pathToFileURL(join(repoRoot, 'packages', 'host', 'src', 'resource-session.js')).href
    )) as typeof import('../../host/src/resource-session.js')

    const { opened, nested } = await openInBig(
      [
        { path: 'art/models/model.w3d', bytes: await model([]) },
        { path: 'art/textures/fixture.tga', bytes: new Uint8Array([7, 7, 7]) },
      ],
      'art/models/model.w3d',
    )
    try {
      if (nested.result.state !== 'opened') {
        throw new Error(JSON.stringify(nested.result.diagnostics).slice(0, 400))
      }
      const refsLease = await nested.result.session.dataSource(
        'common.view/model-resource-refs-source',
        1,
      )
      const references = (
        await (refsLease.value as ModelResourceRefsSource).references({
          limit: 10,
        })
      ).items
      await refsLease.release()
      // the facet contract publishes the logical requirement; the port is what opens it
      expect(references.map(item => item.id)).toEqual([MESH_TEXTURE])

      const namespaceLease = await opened.session.dataSource(
        'common.view/namespace-entry-source',
        1,
      )
      const containerRevision = (await opened.session.descriptor()).revision
      const resources = createResourceSession({
        origin: createNamespaceCompanionOrigin({
          namespace: namespaceLease.value,
          primaryLogicalId: 'art/models/model.w3d',
          containerRevision,
          extract: async (entryId, signal) => {
            const payload = await opened.session
              .operations()
              .invoke('extract-entry', { entryId }, signal === undefined ? {} : { signal })
            if (payload.state !== 'ok' || payload.output.kind !== 'bytes') {
              throw new Error(`BIG extraction failed for ${entryId}`)
            }
            return payload.output.value
          },
        }),
        revision: containerRevision,
      })
      try {
        const first = await resources.resolve({
          id: 'texture-0',
          logicalId: references[0]?.id ?? MESH_TEXTURE,
          role: 'texture',
          scopes: ['current-mount', 'enclosing-container'],
        })
        if (first.state !== 'resolved') {
          throw new Error(`the port did not resolve the texture: ${first.reason}`)
        }
        expect(first.provenance).toMatchObject({
          requirementId: 'texture-0',
          role: 'texture',
          state: 'resolved',
          cached: false,
        })
        expect(first.revision).toBe(first.lease.value.revision)
        // the resource is the texture that is actually in the archive, three bytes and all
        expect(first.provenance.bytes).toBe(3n)
        await first.lease.release()

        // and the budget is spent once here too: the second ask is served from the session index
        const repeat = await resources.resolve({
          id: 'texture-0-again',
          logicalId: references[0]?.id ?? MESH_TEXTURE,
          role: 'texture',
          scopes: ['current-mount'],
        })
        expect(repeat.provenance.cached).toBe(true)
        if (repeat.state === 'resolved') await repeat.lease.release()
        expect(resources.provenance()).toHaveLength(2)
      } finally {
        try {
          await resources.dispose()
        } finally {
          await namespaceLease.release()
        }
      }
      await nested.result.session.dispose()
    } finally {
      await opened.session.dispose()
    }
  })

  it('refuses two archive entries that both answer the declared name', async () => {
    const { opened, nested } = await openInBig(
      [
        { path: 'art/models/model.w3d', bytes: await model([]) },
        { path: 'art/textures/fixture.tga', bytes: new Uint8Array([7]) },
        { path: 'art/other/fixture.tga', bytes: new Uint8Array([8]) },
      ],
      'art/models/model.w3d',
    )
    try {
      /*
       * `many` cardinality admits both, which is the honest outcome for a texture list: the model
       * named one file and the container holds two entries with that name in different folders.
       * Both are bound and the codec reports two, rather than the host silently choosing.
       */
      if (nested.result.state !== 'opened') {
        throw new Error(JSON.stringify(nested.result.diagnostics).slice(0, 400))
      }
      const inspected = await nested.result.session.operations().invoke('inspect', null)
      if (inspected.state !== 'ok' || inspected.output.kind !== 'json') throw new Error('inspect')
      const summary = inspected.output.value as unknown as W3dSummary
      expect(summary.textureBindings).toHaveLength(2)
      await nested.result.session.dispose()
    } finally {
      await opened.session.dispose()
    }
  })
})

describe('W3D malformed input', () => {
  it('refuses a chunk whose declared size runs past its parent', async () => {
    const bytes = await model([])
    const damaged = bytes.slice()
    // inflate the first chunk's size field well beyond the file
    new DataView(damaged.buffer).setUint32(4, 0x0000ffff, true)
    const directory = await mkdtemp(join(tmpdir(), 'x3-w3d-bad-'))
    temporaries.push(directory)
    await writeFile(join(directory, 'model.w3d'), damaged)
    const subjects = createSubjectServices({
      inventory: await inventory(),
      target,
      executionBackends,
    })
    const open = createPathSubjectOpener({ subjects, roots: [directory], budget, grant })
    const { snapshot } = await open(join(directory, 'model.w3d'))
    // it fails closed rather than decoding whatever happens to follow
    expect(snapshot.state).toBe('unresolved')
  })

  it('holds a deep chunk nest to the declared depth budget', async () => {
    let nested = chunk(CHUNK_HIERARCHY_HEADER, new Uint8Array(24))
    for (let depth = 0; depth < 40; depth += 1) nested = chunk(CHUNK_HIERARCHY, nested, true)
    const directory = await mkdtemp(join(tmpdir(), 'x3-w3d-deep-'))
    temporaries.push(directory)
    await writeFile(join(directory, 'model.w3d'), concat([await mesh(), nested]))
    const subjects = createSubjectServices({
      inventory: await inventory(),
      target,
      executionBackends,
    })
    const path = join(directory, 'model.w3d')
    const open = createPathSubjectOpener({
      subjects,
      roots: [directory],
      budget: { ...budget, maxDepth: 8 },
      grant,
    })
    // through the product path it simply fails closed, which is what a caller sees
    expect((await open(path)).snapshot.state).toBe('unresolved')

    /*
     * The *reason* is asserted at the reader itself, because nothing downstream carries it:
     * `openSubject` folds a thrown decoder error into a diagnostic whose `data.error` holds the
     * message, and the RPC snapshot keeps only code and message. Calling the codec directly is the
     * one place the budget refusal is legible — and it is worth pinning, because "failed closed"
     * and "failed closed *for the declared reason*" are different guarantees.
     */
    const bytes = concat([await mesh(), nested])
    const uri = 'memory://w3d-deep/model.w3d'
    const value: ArtifactByteSource = {
      kind: 'bytes',
      ref: { id: uri, uri },
      revision: revisionId('content-hash.sha256:w3d-deep'),
      size: BigInt(bytes.byteLength),
      async read(offset, length) {
        return bytes.slice(Number(offset), Number(offset) + length)
      },
      async *stream() {
        yield bytes
      },
    }
    await expect(directCodecOpen(value, { ...budget, maxDepth: 8 })).rejects.toThrow(/maxDepth/u)
  })
})

describe('W3D publishes its planes as facet contracts', () => {
  /**
   * The block-12 migration, checked against the same fixtures the ad hoc summary is checked against.
   *
   * The point of this block is that the *contract* now carries these facts. The summary keys are
   * still emitted for one slice so existing readouts keep working, but a consumer that reads the
   * facet must see the same hierarchy, the same channels and the same collision roles — otherwise
   * the migration moved the authority and lost the data on the way.
   */
  it('publishes skeleton bindings, an animation clip and both kinds of collision volume', async () => {
    const bytes = await model([
      hierarchyChunk('FIXTURE', [
        { name: 'ROOT', parentIndex: -1 },
        { name: 'TRI', parentIndex: 0 },
      ]),
      hlodChunk('FIXTURE', 'FIXTURE', [{ boneIndex: 1, name: `${MESH_CONTAINER}.${MESH_NAME}` }]),
      animationChunk('SPIN', 'FIXTURE', 61, [{ pivot: 1, firstFrame: 1, lastFrame: 60, flags: 2 }]),
    ])
    const { session } = await openOnDisk(bytes)
    const descriptor = (await session.descriptor()) as unknown as {
      readonly dataSources: readonly { readonly contract: string }[]
    }
    const contracts = descriptor.dataSources.map(item => item.contract)
    expect(contracts).toEqual(
      expect.arrayContaining([
        'common.view/model-resource-refs-source',
        'common.view/model-skeleton-source',
        'common.view/model-animation-source',
      ]),
    )

    const skeletonLease = await session.dataSource('common.view/model-skeleton-source', 1)
    const skeleton = skeletonLease.value as ModelSkeletonSource
    expect(await skeleton.info()).toEqual({
      bindings: 1,
      named: 1,
      companionBound: 0,
      hierarchies: 1,
    })
    expect((await skeleton.bindings({ limit: 10 })).items).toEqual([
      {
        partId: `${MESH_CONTAINER}.${MESH_NAME}`,
        boneIndex: 1,
        boneName: 'TRI',
        provenance: 'direct',
        hierarchyId: 'FIXTURE',
      },
    ])
    await skeletonLease.release()

    const animationLease = await session.dataSource('common.view/model-animation-source', 1)
    const animation = animationLease.value as ModelAnimationSource
    expect(await animation.info()).toEqual({ clips: 1, channelled: 1, companionBound: 0 })
    expect((await animation.clips({ limit: 10 })).items).toEqual([
      {
        id: 'w3d-animation-0',
        name: 'SPIN',
        kind: 'animation',
        provenance: 'direct',
        frames: 61,
        frameRate: 30,
        hierarchyId: 'FIXTURE',
        channels: [
          { target: 'pivot-1', kind: 'translation', axis: 'z', firstFrame: 1, lastFrame: 60 },
        ],
        unsupportedChannels: 0,
      },
    ])
    await animationLease.release()

    const refsLease = await session.dataSource('common.view/model-resource-refs-source', 1)
    const refs = refsLease.value as ModelResourceRefsSource
    // the texture requirement is `many`, so a name stays reference-only: this codec will not guess
    // which bound file answers which name by reading a resolved URI
    expect(await refs.info()).toEqual({ references: 1, bound: 0, truncated: false })
    expect((await refs.references({ limit: 10 })).items).toEqual([
      { id: MESH_TEXTURE, role: 'texture', provenance: 'reference-only' },
    ])
    await refsLease.release()
    await session.dispose()
  })

  it('states an undecoded compressed animation as a preserved plane in its receipt', async () => {
    const bytes = await model([compressedAnimationChunk(128)])
    const { session } = await openOnDisk(bytes)
    const descriptor = (await session.descriptor()) as unknown as {
      readonly metadata: readonly {
        readonly id: string
        readonly entries: readonly { readonly value: unknown }[]
      }[]
    }
    const receipt = descriptor.metadata.find(group => group.id === 'uv-projection-receipt')
      ?.entries[0]?.value as {
      readonly form: string
      readonly planes: readonly { readonly planeId: string; readonly state: string }[]
    }
    expect(receipt.form).toBe('portable')
    const byPlane = new Map(receipt.planes.map(plane => [plane.planeId, plane.state]))
    // 0x280 is not decoded, and the receipt says `preserved` rather than `lost` because the bytes
    // are still addressable through the byte-range source — the two are different statements
    expect(byPlane.get('compressed-animation')).toBe('preserved')
    expect(byPlane.get('skeleton')).toBe('lost')
    expect(byPlane.get('shaders-and-effects')).toBe('lost')
    expect(byPlane.get('geometry')).toBe('normalized')
    await session.dispose()
  })

  it('publishes no facet for a plane the file does not carry', async () => {
    const bytes = await model([])
    const { session } = await openOnDisk(bytes)
    const descriptor = (await session.descriptor()) as unknown as {
      readonly dataSources: readonly { readonly contract: string }[]
    }
    const contracts = descriptor.dataSources.map(item => item.contract)
    // no HLOD, no animation chunk, no collision bit — and therefore no empty sources pretending
    // those planes were read and found to hold nothing
    expect(contracts).not.toContain('common.view/model-skeleton-source')
    expect(contracts).not.toContain('common.view/model-animation-source')
    expect(contracts).not.toContain('common.view/model-collision-source')
    await session.dispose()
  })
})

describe('the configured real Westwood W3D model', () => {
  const realW3d = process.env['MODKITX_W3D_PATH']?.trim()
  const available = realW3d !== undefined && existsSync(realW3d)

  it.skipIf(!available)(
    'publishes hierarchy, an animation channel and its texture reference',
    async () => {
      if (realW3d === undefined) throw new TypeError('MODKITX_W3D_PATH is not set')
      const directory = await mkdtemp(join(tmpdir(), 'x3-w3d-real-'))
      temporaries.push(directory)
      const name = basename(realW3d)
      await cp(realW3d, join(directory, name))
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
      const summary = inspected.output.value as unknown as W3dSummary
      const lease = await session.dataSource('common.view/model-scene-source', 1)
      const info = await (lease.value as ModelSceneSource).info()

      /*
       * This is the assertion the parity `poorer` row was about: the canonical reader publishes one
       * animation for this file and this one published none. Counts are printed rather than pinned to
       * literals — the corpus belongs to the user and this repository does not ship it.
       */
      expect(info.animations).toBeGreaterThanOrEqual(1)
      expect(summary.hierarchy).not.toBeNull()
      expect(summary.hierarchy?.pivots.length).toBeGreaterThan(1)
      expect(summary.animations[0]?.channels.length).toBeGreaterThan(0)
      expect(summary.textures.length).toBeGreaterThan(0)
      // the sibling folder holds no texture, so the reference is published unbound — and that is the
      // correct outcome, not a failure: the file names a texture that ships elsewhere
      expect(summary.meshBindings.every(item => item.roles.render)).toBe(true)
      console.info(
        `[w3d-live] pivots ${summary.hierarchy?.pivots.length}, animations ${info.animations}, ` +
          `channels ${summary.animations[0]?.channels.length}, textures ${summary.textures.length}, ` +
          `collision meshes ${summary.collision.meshes.length}, boxes ${summary.collision.boxes}`,
      )
      await lease.release()
      await session.dispose()
    },
  )
})
