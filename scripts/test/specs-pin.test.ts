import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  DATA_SOURCE_MATURITY,
  STANDARD_DATA_SOURCE_CONTRACTS,
  type ModelMesh,
  type ModelNode,
  type ModelPrimitive,
  type ModelSceneInfo,
  type ModelSceneSource,
  type Page,
  type PageRequest,
} from '@modkitx-x3/sdk'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const vendorRoot = join(repoRoot, 'vendor', 'multiverse-specs')
const specsRoot = join(vendorRoot, 'specs')
const pinScript = join(repoRoot, 'scripts', 'specs-pin.mjs')

const runPin = (args: readonly string[]) =>
  spawnSync(process.execPath, [pinScript, ...args], { encoding: 'utf8' })

const readJson = (relative: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(specsRoot, relative), 'utf8')) as Record<string, unknown>

/** The two reference implementations this test drives, as the snapshot publishes them. */
interface SpecTools {
  readonly 'uvm-core.mjs': {
    readGltfFixture(path: string): { document: unknown; binary: Uint8Array }
    projectionFromUvmCore(document: unknown, binary: Uint8Array): DecodedProjection
  }
  readonly 'model-interchange.mjs': {
    projectionSemanticHash(projection: unknown): string
  }
}

interface DecodedProjection {
  readonly info: ModelSceneInfo
  readonly nodes: readonly ModelNode[]
  readonly meshes: readonly ModelMesh[]
  readonly primitives: readonly ModelPrimitive[]
}

/**
 * Load a reference implementation out of the pinned snapshot.
 *
 * The snapshot is the only path into the specs: nothing here reaches into the sibling repository,
 * so the test proves what the pinned bytes say rather than what happens to be checked out next door.
 */
const loadSpecTool = async <K extends keyof SpecTools>(name: K): Promise<SpecTools[K]> =>
  (await import(pathToFileURL(join(specsRoot, 'tools', name)).href)) as SpecTools[K]

describe('multiverse/specs pin', () => {
  it('the committed snapshot matches the commit it claims', () => {
    const result = runPin(['--check'])
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('snapshot matches multiverse@')
  })

  it('goes red when the snapshot drifts from its pinned digests', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'specs-pin-'))
    const copy = join(scratch, 'multiverse-specs')
    cpSync(vendorRoot, copy, { recursive: true })

    const clean = runPin(['--check', '--vendor', copy])
    expect(clean.status).toBe(0)

    const drifted = join(copy, 'specs', 'README.md')
    writeFileSync(drifted, `${readFileSync(drifted, 'utf8')}\n`)
    const dirty = runPin(['--check', '--vendor', copy])
    expect(dirty.status).toBe(1)
    // The message has to say what to do, not merely that something differs: the snapshot is
    // generated, so the fix is always "edit upstream and re-pin", never "edit the copy".
    expect(dirty.stderr).toContain('pnpm specs:pin')
  })

  it('goes red when the snapshot carries a file the pin does not declare', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'specs-pin-'))
    const copy = join(scratch, 'multiverse-specs')
    cpSync(vendorRoot, copy, { recursive: true })
    writeFileSync(join(copy, 'specs', 'stray.json'), '{}\n')

    const result = runPin(['--check', '--vendor', copy])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('not declared by PIN.json')
  })
})

describe('model-interchange-v1 against the X3 model contract', () => {
  const descriptor = readJson('semantic-scopes/model-interchange-v1.json')
  const bindings = descriptor.bindings as { liveBaseContract: Record<string, unknown> }
  const base = bindings.liveBaseContract

  it('binds the admitted data-source contract this build actually publishes', () => {
    // A descriptor that names a contract the SDK does not carry, or one that is still a
    // publisher-candidate, would be a paper scope. Both halves are checked, not assumed.
    expect(STANDARD_DATA_SOURCE_CONTRACTS).toContain(base.contract as string)
    expect(DATA_SOURCE_MATURITY['common.view/model-scene-source']).toBe('admitted')
    expect(base.maturity).toBe('admitted')
    expect(base.major).toBe(1)
  })

  it('binds every facet to a contract this build actually publishes', () => {
    const facets = descriptor.facets as readonly {
      facetId: string
      binding: { live: { contract: string | null } }
    }[]
    // Slice 11C0's second half gave the closure facet the live binding it was missing: the model
    // publishes logical requirements through the resource-refs facet and the host's post-open
    // `ResourceSessionPort` opens them.
    const closure = facets.find(facet => facet.facetId === 'uv.model/resource-closure')
    expect(closure?.binding.live.contract).toBe('common.view/model-resource-refs-source')
    for (const facet of facets) {
      const contract = facet.binding.live.contract
      // a paper scope is one whose facets name contracts nothing publishes; every one must resolve
      expect(contract, facet.facetId).not.toBeNull()
      expect(STANDARD_DATA_SOURCE_CONTRACTS, facet.facetId).toContain(contract)
    }
  })

  it('records the binding as an amendment rather than a silent in-place edit', () => {
    const amendments = descriptor.amendments as readonly { hashImpact: string; change: string }[]
    expect(amendments.length).toBeGreaterThan(0)
    // an amendment may only ever be a change that moves no hash; anything else is a version bump
    for (const amendment of amendments) expect(amendment.hashImpact).toBe('none')
    // and the version therefore did not move: the pinned vectors keep comparing against 1.0.0
    expect(descriptor.version).toBe('1.0.0')
  })

  it('reproduces the pinned hash from a real ModelSceneSource, paging included', async () => {
    const uvm = await loadSpecTool('uvm-core.mjs')
    const scope = await loadSpecTool('model-interchange.mjs')
    const vectors = readJson('conformance/model-interchange-v1/vectors.json')
    const expected = (vectors.vectors as readonly { id: string; hash: string }[]).find(
      vector => vector.id === 'rig/base',
    )
    expect(expected).toBeDefined()

    const fixture = join(specsRoot, 'model', 'fixtures', 'uvm-core-rig.uvm.gltf')
    const { document, binary } = uvm.readGltfFixture(fixture)
    const decoded = uvm.projectionFromUvmCore(document, binary)

    // A `ModelSceneSource`, typed by the SDK — so the members the descriptor names have to exist on
    // the published contract for this file to compile at all, and paging has to be real for the
    // drain below to terminate.
    const page = <T>(items: readonly T[], request: PageRequest): Page<T> => {
      const start = request.cursor === undefined ? 0 : Number(request.cursor)
      const slice = items.slice(start, start + request.limit)
      return start + slice.length < items.length
        ? { items: slice, nextCursor: String(start + slice.length) }
        : { items: slice }
    }
    const primitives = new Map(decoded.primitives.map(primitive => [primitive.id, primitive]))
    const source: ModelSceneSource = {
      info: () => Promise.resolve(decoded.info),
      nodes: request => Promise.resolve(page(decoded.nodes, request)),
      meshes: request => Promise.resolve(page(decoded.meshes, request)),
      primitive: primitiveId => {
        const primitive = primitives.get(primitiveId)
        if (primitive === undefined) throw new RangeError(`unknown primitive ${primitiveId}`)
        return Promise.resolve(primitive)
      },
    }

    // Drain one record at a time: if paging order could reach the hash, this would not match.
    const drain = async <T>(
      read: (request: PageRequest) => Promise<Page<T>>,
    ): Promise<readonly T[]> => {
      const collected: T[] = []
      let cursor: string | undefined
      do {
        const result: Page<T> = await read(
          cursor === undefined ? { limit: 1 } : { limit: 1, cursor },
        )
        collected.push(...result.items)
        cursor = result.nextCursor
      } while (cursor !== undefined)
      return collected
    }

    const info = await source.info()
    const nodes = await drain<ModelNode>(request => source.nodes(request))
    const meshes = await drain<ModelMesh>(request => source.meshes(request))
    const drainedPrimitives = await Promise.all(
      meshes.flatMap(mesh =>
        mesh.primitiveIds.map(id => source.primitive?.(id, { maxBytes: 1_000_000 })),
      ),
    )

    const hash = scope.projectionSemanticHash({
      info,
      nodes,
      meshes,
      primitives: drainedPrimitives,
    })
    expect(hash).toBe(expected?.hash)
  })
})
