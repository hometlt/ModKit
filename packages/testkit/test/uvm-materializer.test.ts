/**
 * The UVM materializer conformance suite (block 11, slice 11C1, plan items 16, 18 and 19).
 *
 * The claims this file has to earn, in the words of the block-11 exit gate:
 *
 * - a live projection, materialized and reopened, gives **exact** `projectionSemanticHash`
 *   equality — no near-match, no "equal within losses";
 * - repeat export is byte-stable;
 * - what did not survive is enumerated in the `MaterializationReceipt`, and nothing is invented;
 * - the materializer passes the old validator as a differential oracle *and* the new spec package;
 * - optional rich facets do not become mandatory for a simple static model.
 *
 * Two oracles are used on purpose. The pinned `multiverse/specs` snapshot decides what the scope
 * and the canonical form are; the sealed legacy `@modkitx/world` implementation independently
 * recomputes the canonical digests. A single implementation agreeing with itself would prove only
 * that it is deterministic.
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'
import { CANCELLED_CODE } from '@modkitx-x3/core'
import {
  drainModelProjection,
  drainModelResourceClosure,
  loadUvTools,
  materializeAndCompare,
  unexplainedDifferences,
  type DrainedModelProjection,
} from '@modkitx-x3/testkit'
import {
  revisionId,
  type ArtifactByteSource,
  type ModelResourceRef,
  type ModelResourceRefsSource,
  type ModelSceneSource,
  type ResourceProvenanceRecord,
  type ResourceSessionPort,
} from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const fixtureDir = join(repoRoot, 'vendor', 'multiverse-specs', 'specs', 'model', 'fixtures')
const legacyOracle = join(
  repoRoot,
  '..',
  'references',
  'modkitmk2',
  'packages',
  'world',
  'dist',
  'index.js',
)

/** The workspace's own Ajv build: the engine the sealed validator used, at the version it used. */
const ajvBuild = join(
  repoRoot,
  'node_modules',
  '.pnpm',
  'ajv@8.20.0',
  'node_modules',
  'ajv',
  'dist',
  '2020.js',
)

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

/** Reads one pinned UVM/core fixture into the live projection its reader would publish. */
async function fixtureProjection(name: string): Promise<DrainedModelProjection> {
  const tools = await loadUvTools(repoRoot)
  const gltf = (await import(
    pathToFileURL(join(repoRoot, 'vendor', 'multiverse-specs', 'specs', 'tools', 'uvm-core.mjs'))
      .href
  )) as { readGltfFixture(path: string): { document: unknown; binary: Uint8Array } }
  const { document, binary } = gltf.readGltfFixture(join(fixtureDir, `${name}.uvm.gltf`))
  return tools.uvmCore.projectionFromUvmCore(document, binary)
}

/** A `ModelSceneSource` over a drained projection, so the harness drains a real paged source. */
function sourceOf(projection: DrainedModelProjection): ModelSceneSource {
  const page = <T>(items: readonly T[], request: { limit: number; cursor?: string }) => {
    const start = request.cursor === undefined ? 0 : Number(request.cursor)
    const slice = items.slice(start, start + request.limit)
    return start + slice.length < items.length
      ? { items: slice, nextCursor: String(start + slice.length) }
      : { items: slice }
  }
  const primitives = new Map((projection.primitives ?? []).map(item => [item.id, item]))
  const source: ModelSceneSource = {
    info: () => Promise.resolve(projection.info),
    nodes: request => Promise.resolve(page(projection.nodes, request)),
    meshes: request => Promise.resolve(page(projection.meshes, request)),
  }
  if (projection.primitives === undefined) return source
  return {
    ...source,
    primitive: primitiveId => {
      const primitive = primitives.get(primitiveId)
      if (primitive === undefined) throw new RangeError(`unknown primitive ${primitiveId}`)
      return Promise.resolve(primitive)
    },
  }
}

const materialize = async (name: string, projection: DrainedModelProjection) =>
  materializeAndCompare(repoRoot, projection, {
    assetId: `fixture/${name}`,
    sourceFormat: 'uvm',
    subjectRevision: 'provider-token:uvm-materializer-test',
  })

function closureSession(bytes: Uint8Array | undefined): {
  readonly port: ResourceSessionPort
  readonly releases: () => number
} {
  const records: ResourceProvenanceRecord[] = []
  const resourceRevision = revisionId('provider-token:uvm-resource')
  let releases = 0
  const port: ResourceSessionPort = {
    sessionId: 'uvm-resource-test',
    revision: revisionId('provider-token:uvm-session'),
    state: () => 'live',
    async resolve(requirement) {
      if (bytes === undefined) {
        const provenance = Object.freeze({
          requirementId: requirement.id,
          logicalId: requirement.logicalId,
          role: requirement.role,
          state: 'unresolved' as const,
          reason: 'not-found' as const,
          cached: false,
          scopes: Object.freeze([...requirement.scopes]),
        })
        records.push(provenance)
        return {
          state: 'unresolved',
          reason: 'not-found',
          diagnostic: {
            id: 'x3.host/resource-not-found',
            code: 'x3.host/resource-not-found',
            severity: 'information' as const,
            category: 'dependency' as const,
            message: 'missing test image',
          },
          provenance,
        }
      }
      const provenance = Object.freeze({
        requirementId: requirement.id,
        logicalId: requirement.logicalId,
        role: requirement.role,
        state: 'resolved' as const,
        revision: resourceRevision,
        bytes: BigInt(bytes.byteLength),
        cached: false,
        scopes: Object.freeze([...requirement.scopes]),
      })
      records.push(provenance)
      const value: ArtifactByteSource = {
        kind: 'bytes',
        ref: { id: requirement.id, uri: `memory://uvm/${requirement.id}` },
        revision: resourceRevision,
        size: BigInt(bytes.byteLength),
        read: async (offset, length) => bytes.slice(Number(offset), Number(offset) + length),
        async *stream() {
          yield bytes
        },
      }
      let released = false
      return {
        state: 'resolved',
        revision: resourceRevision,
        provenance,
        lease: {
          value,
          async release() {
            if (released) return
            released = true
            releases += 1
          },
        },
      }
    },
    provenance: () => Object.freeze([...records]),
    dispose: async () => undefined,
  }
  return { port, releases: () => releases }
}

function resourceSource(references: readonly ModelResourceRef[]): ModelResourceRefsSource {
  return {
    info: () =>
      Promise.resolve({
        references: references.length,
        bound: references.filter(reference => reference.provenance === 'companion').length,
        truncated: false,
      }),
    references: request => {
      const start = request.cursor === undefined ? 0 : Number(request.cursor)
      const items = references.slice(start, start + request.limit)
      return Promise.resolve({
        items,
        ...(start + items.length < references.length
          ? { nextCursor: String(start + items.length) }
          : {}),
      })
    },
  }
}

// ---------------------------------------------------------------------------------------------

describe('canonical case — exact semantic equality', () => {
  for (const name of ['uvm-core-triangle', 'uvm-core-rig']) {
    it(`${name}: live and materialized-then-reopened hash identically`, async () => {
      const projection = await fixtureProjection(name)
      const verdict = await materialize(name, projection)

      expect(verdict.exact).toBe(true)
      expect(verdict.liveHash).toBe(verdict.reopenedHash)
      // exactness is the claim, so the negative half matters as much: nothing differed at all
      expect(verdict.differingFacets).toEqual([])
      expect(verdict.facetPresenceDiff).toEqual([])
      expect(verdict.receipt.diff).toEqual([])
      expect(verdict.receipt.lostFacetIds).toEqual([])
      expect(verdict.receipt.excludedFacetIds).toEqual([])
    })

    it(`${name}: repeat export is byte-stable`, async () => {
      const projection = await fixtureProjection(name)
      const verdict = await materialize(name, projection)
      expect(verdict.byteStable).toBe(true)
      // and stable across a second, independent call through the harness, not just within one
      const again = await materialize(name, projection)
      expect(again.artifactDigest).toBe(verdict.artifactDigest)
      expect(sha256(again.bytes)).toBe(verdict.artifactDigest)
    })
  }

  it('drains a real paged source and reaches the same hash as the in-memory projection', async () => {
    const projection = await fixtureProjection('uvm-core-rig')
    const drained = await drainModelProjection(sourceOf(projection))
    const fromSource = await materialize('uvm-core-rig', drained)
    const fromMemory = await materialize('uvm-core-rig', projection)
    // one record per page, and the hash is unchanged: paging never reaches it
    expect(fromSource.liveHash).toBe(fromMemory.liveHash)
    expect(fromSource.exact).toBe(true)
  })

  it('writes UV_game_socket only for an exact existing scene-node join', async () => {
    const base = await fixtureProjection('uvm-core-triangle')
    const nodeId = base.nodes[0]?.id
    if (nodeId === undefined) throw new TypeError('triangle fixture has no node')
    const tools = await loadUvTools(repoRoot)
    const request = {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: 'provider-token:socket-materialization',
      options: { assetId: 'fixture/socket', sourceFormat: 'uvm' },
    }
    const written = tools.materializer.materializeUvmCore(
      {
        ...base,
        sockets: [
          {
            id: 'socket-hardpoint',
            nodeId,
            role: 'attach',
            sourceName: 'Ref_Hardpoint',
          },
        ],
      },
      request,
    )
    tools.uvmCore.assertUvmCore(written.document)
    const document = written.document as {
      extensionsUsed: readonly string[]
      nodes: readonly {
        extensions?: {
          UV_game_socket?: {
            role: string
            sourceName?: string
            extras?: { modkitx?: { id: string; nodeId: string } }
          }
        }
      }[]
    }
    expect(document.extensionsUsed).toContain('UV_game_socket')
    expect(document.nodes[0]?.extensions?.UV_game_socket).toEqual(
      expect.objectContaining({
        role: 'attach',
        sourceName: 'Ref_Hardpoint',
        extras: { modkitx: { id: 'socket-hardpoint', nodeId } },
      }),
    )
    expect(() =>
      tools.materializer.materializeUvmCore(
        {
          ...base,
          sockets: [{ id: 'missing', nodeId: 'bone/1', role: 'attach' }],
        },
        request,
      ),
    ).toThrow('targets absent node')
  })

  it('resolves image identity through ResourceSessionPort and reopens an exact resource closure', async () => {
    const base = await fixtureProjection('uvm-core-triangle')
    const source = resourceSource([
      { id: 'Assets/Textures/Hull.dds', role: 'texture', provenance: 'reference-only' },
    ])
    const resources = closureSession(new Uint8Array([0x44, 0x44, 0x53, 0x20]))
    const resolved = await drainModelResourceClosure(source, resources.port, {
      mode: 'content-qualified',
      maxBytes: 4n,
    })
    expect(resolved.unavailable).toEqual([])
    expect(resolved.provenance).toHaveLength(1)
    expect(resolved.closure.entries).toEqual([
      {
        role: 'image',
        logicalId: 'Assets/Textures/Hull.dds',
        mediaHint: 'image/vnd-ms.dds',
        digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      },
    ])
    expect(resources.releases()).toBe(1)

    const verdict = await materialize('resource-closure', {
      ...base,
      info: { ...base.info, textures: 1 },
      resourceClosure: resolved.closure,
    })
    expect(verdict.exact).toBe(true)
    expect(verdict.differingFacets).toEqual([])
    expect(verdict.facetPresenceDiff).toEqual([])
    expect(verdict.receipt.diff).toEqual([])
  })

  it('does not fabricate closure identity for an unresolved resource', async () => {
    const base = await fixtureProjection('uvm-core-triangle')
    const source = resourceSource([
      { id: 'Assets/Textures/Missing.dds', role: 'texture', provenance: 'reference-only' },
    ])
    const resolved = await drainModelResourceClosure(source, closureSession(undefined).port)
    expect(resolved.closure.entries).toEqual([])
    expect(resolved.unavailable).toHaveLength(1)
    const verdict = await materialize('resource-unavailable', {
      ...base,
      info: { ...base.info, textures: 1 },
      resourceClosure: resolved.closure,
    })
    expect(verdict.exact).toBe(false)
    expect(verdict.receipt.lostFacetIds).toContain('uv.model/resource-closure@1')
    expect(verdict.receipt.diff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ facetId: 'uv.model/resource-closure@1' }),
        expect.objectContaining({ facetId: 'uv.model/structure@1', path: '/textures' }),
      ]),
    )
    expect(unexplainedDifferences(verdict)).toEqual([])
  })

  it('bounds resource paging and propagates cancellation before resolution', async () => {
    const source = resourceSource([
      { id: 'Assets/Textures/A.dds', role: 'texture', provenance: 'reference-only' },
    ])
    const controller = new AbortController()
    controller.abort()
    await expect(
      drainModelResourceClosure(source, closureSession(new Uint8Array(1)).port, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: CANCELLED_CODE })

    const cyclic = {
      info: () => Promise.resolve({ references: 1, bound: 0, truncated: false }),
      references: () =>
        Promise.resolve({
          items: [],
          nextCursor: 'same',
        }),
    }
    await expect(
      drainModelResourceClosure(cyclic, closureSession(new Uint8Array(1)).port),
    ).rejects.toThrow('cursor repeated')
  })
})

describe('honest loss — what the profile could not carry', () => {
  it('does not invent textures to make a count match', async () => {
    const projection = await fixtureProjection('uvm-core-textured')
    const verdict = await materialize('uvm-core-textured', projection)

    // the hashes differ, and that is the correct outcome rather than a failure of the materializer
    expect(verdict.exact).toBe(false)
    expect(verdict.differingFacets).toEqual(['uv.model/structure@1'])
    const structure = verdict.receipt.diff.find(entry => entry.path === '/textures')
    expect(structure).toMatchObject({
      facetId: 'uv.model/structure@1',
      change: 'value-differs',
    })
    expect(structure?.note).toContain('inventing data')
    // every difference the harness found independently is accounted for by the receipt
    expect(unexplainedDifferences(verdict)).toEqual([])
  })

  it('renumbers a source whose ids are not positional, and says so per plane', async () => {
    const projection = await fixtureProjection('uvm-core-rig')
    // an M3-shaped projection: the ids name what the format called things, not glTF indices
    const foreign: DrainedModelProjection = {
      info: projection.info,
      nodes: projection.nodes.map((node, index) => ({
        ...node,
        id: index === 0 ? 'model' : `division-0-region-${index - 1}`,
        childIds: node.childIds.map(child =>
          child === 'node-0' ? 'model' : `division-0-region-${Number(child.slice(5)) - 1}`,
        ),
        meshIds: node.meshIds.map(mesh => `region-${mesh.slice(5)}`),
      })),
      meshes: projection.meshes.map(mesh => ({ ...mesh, id: `region-${mesh.id.slice(5)}` })),
      ...(projection.primitives === undefined ? {} : { primitives: projection.primitives }),
    }
    const verdict = await materializeAndCompare(repoRoot, foreign, {
      assetId: 'fixture/foreign-ids',
      sourceFormat: 'm3',
      subjectRevision: 'provider-token:foreign',
    })

    expect(verdict.exact).toBe(false)
    const planes = verdict.receipt.diff.map(entry => entry.facetId)
    expect(planes).toContain('uv.model/hierarchy@1')
    expect(planes).toContain('uv.model/mesh-index@1')
    expect(unexplainedDifferences(verdict)).toEqual([])
    // the loss is named in the artifact's own provenance too, not only in the receipt
    const tools = await loadUvTools(repoRoot)
    const document = tools.uvmCore.unpackGlb(verdict.bytes).document as {
      extensions: { UV_provenance: { lost: readonly string[] } }
    }
    expect(document.extensions.UV_provenance.lost.join(' ')).toContain('renumbered')
  })

  it('reports a metadata-only source as an excluded geometry facet, not as empty geometry', async () => {
    const projection = await fixtureProjection('uvm-core-triangle')
    const metadataOnly: DrainedModelProjection = {
      info: { ...projection.info, geometryAccess: 'metadata-only', primitives: 0 },
      nodes: projection.nodes,
      meshes: projection.meshes.map(mesh => ({ ...mesh, primitiveIds: [] })),
    }
    const verdict = await materializeAndCompare(repoRoot, metadataOnly, {
      assetId: 'fixture/metadata-only',
      sourceFormat: 'm3',
      subjectRevision: 'provider-token:metadata-only',
    })
    expect(verdict.receipt.excludedFacetIds).toContain('uv.model/geometry@1')
    expect(unexplainedDifferences(verdict)).toEqual([])
  })
})

describe('optional facets stay optional', () => {
  it('a simple static model needs neither materials, textures, animations nor bounds', async () => {
    const projection = await fixtureProjection('uvm-core-triangle')
    const bare: DrainedModelProjection = {
      info: {
        scenes: 1,
        nodes: projection.nodes.length,
        meshes: projection.meshes.length,
        primitives: projection.primitives?.length ?? 0,
        materials: 0,
        textures: 0,
        animations: 0,
        geometryAccess: 'decoded',
      },
      nodes: projection.nodes,
      meshes: projection.meshes,
      ...(projection.primitives === undefined
        ? {}
        : {
            primitives: projection.primitives.map(primitive => {
              const bare: Record<string, unknown> = { ...primitive }
              delete bare['materialId']
              return bare as unknown as (typeof projection.primitives)[number]
            }),
          }),
    }
    const verdict = await materializeAndCompare(repoRoot, bare, {
      assetId: 'fixture/bare',
      sourceFormat: 'obj',
      subjectRevision: 'provider-token:bare',
    })
    // zero materials, zero textures, zero animations: none of them is required to materialize
    expect(verdict.receipt.lostFacetIds).toEqual([])
    expect(verdict.receipt.excludedFacetIds).toEqual([])
    /*
     * The one difference is bounds, and it is a property of the artifact binding rather than of
     * this model: a reopened UVM derives bounds from decoded geometry, so a source that published
     * none gains the facet. The receipt names it, and nothing else differs.
     */
    expect(verdict.facetPresenceDiff).toEqual(['uv.model/bounds@1'])
    expect(verdict.differingFacets).toEqual([])
    expect(verdict.receipt.diff).toEqual([
      {
        facetId: 'uv.model/bounds@1',
        change: 'absent-in-live',
        note: expect.stringContaining('derives bounds'),
      },
    ])
    expect(unexplainedDifferences(verdict)).toEqual([])
  })

  it('refuses a projection that contradicts itself rather than materializing a half-truth', async () => {
    const projection = await fixtureProjection('uvm-core-triangle')
    const tools = await loadUvTools(repoRoot)
    const contradiction = {
      info: { ...projection.info, geometryAccess: 'metadata-only' as const },
      nodes: projection.nodes,
      meshes: projection.meshes,
      primitives: projection.primitives,
    }
    expect(() =>
      tools.materializer.materializeUvmCore(contradiction, {
        scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
        profile: 'UVM/core@1.0',
        subjectRevision: 'provider-token:x',
        options: { assetId: 'x', sourceFormat: 'x' },
      }),
    ).toThrow(/metadata-only/u)
  })

  it('refuses to guess an identity or a source format', async () => {
    const projection = await fixtureProjection('uvm-core-triangle')
    const tools = await loadUvTools(repoRoot)
    const request = {
      scope: { scopeId: 'model-interchange-v1', version: '1.0.0' },
      profile: 'UVM/core@1.0',
      subjectRevision: 'provider-token:x',
    }
    expect(() => tools.materializer.materializeUvmCore(projection, request)).toThrow(/assetId/u)
    expect(() =>
      tools.materializer.materializeUvmCore(projection, {
        ...request,
        options: { assetId: 'x' },
      }),
    ).toThrow(/sourceFormat/u)
  })
})

describe('two oracles', () => {
  it('the produced artifact satisfies the pinned UVM/core profile', async () => {
    const projection = await fixtureProjection('uvm-core-rig')
    const verdict = await materialize('uvm-core-rig', projection)
    const tools = await loadUvTools(repoRoot)
    // `assertUvmCore` is the profile gate of the pinned specs: markers, required extensions,
    // no required UV_ extension, non-empty identity
    expect(() =>
      tools.uvmCore.assertUvmCore(tools.uvmCore.unpackGlb(verdict.bytes).document),
    ).not.toThrow()
  })

  it.skipIf(!existsSync(ajvBuild))(
    'the old validator’s own UVM check accepts the materialized artifact',
    async () => {
      /*
       * What `multiverse-validate.ts` actually validated of a UVM document was one subtree:
       * `#/extensions/UV_asset` against `uvm.asset.schema.json`, with Ajv 2020 under
       * `{ allErrors, strict: false, validateFormats: false }`. That is a narrow check, and
       * running exactly it — same engine, same options, same schema — is what makes "passes the
       * old validator" a fact rather than a paraphrase.
       */
      const projection = await fixtureProjection('uvm-core-rig')
      const verdict = await materialize('uvm-core-rig', projection)
      const tools = await loadUvTools(repoRoot)
      const document = tools.uvmCore.unpackGlb(verdict.bytes).document as {
        extensions: Record<string, unknown>
      }
      const { default: Ajv2020 } = (await import(pathToFileURL(ajvBuild).href)) as {
        default: new (options: unknown) => {
          addSchema(schema: unknown): void
          getSchema(id: string): ((value: unknown) => boolean) | undefined
        }
      }
      const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })
      const schemaDir = join(repoRoot, 'vendor', 'multiverse-specs', 'specs', 'model', 'schema')
      for (const name of readdirSync(schemaDir).sort()) {
        if (name.endsWith('.schema.json')) {
          ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, name), 'utf8')))
        }
      }
      for (const [extension, schema] of [
        ['UV_asset', 'https://modkitx.org/uvm/1.0/uvm.asset.schema.json'],
        ['UV_provenance', 'https://modkitx.org/uvm/1.0/uvm.provenance.schema.json'],
      ] as const) {
        const validate = ajv.getSchema(schema)
        expect(validate, schema).toBeDefined()
        expect(validate?.(document.extensions[extension]), extension).toBe(true)
      }
    },
  )

  it.skipIf(!existsSync(legacyOracle))(
    'the sealed legacy canonical implementation reproduces the scope hash digit for digit',
    async () => {
      const projection = await fixtureProjection('uvm-core-rig')
      const verdict = await materialize('uvm-core-rig', projection)
      const oracle = (await import(pathToFileURL(legacyOracle).href)) as {
        canonicalBytes(value: unknown): Uint8Array
        sha256Hex(bytes: Uint8Array): string
      }
      const tools = await loadUvTools(repoRoot)
      const unpacked = tools.uvmCore.unpackGlb(verdict.bytes)
      const reopened = tools.uvmCore.projectionFromUvmCore(unpacked.document, unpacked.binary)

      /*
       * The scope's hash envelope, recomputed by the *other* implementation of the canonical form.
       * If the two ever disagreed, one of them would have redefined the encoding, and every digest
       * either has ever produced would be worthless — so this is the check that keeps the
       * differential oracle of block 11 meaningful.
       */
      const bundle = tools.modelInterchange.buildFacetBundle(reopened)
      const envelope = {
        schemaVersion: 1,
        domain: 'uv.semantic-scope/model-interchange-v1',
        value: {
          scope: { id: 'model-interchange-v1', version: '1.0.0' },
          facets: bundle.facets.map(entry => [entry[0], entry[1]]),
          absentFacets: [...bundle.absentFacets],
        },
      }
      expect(`sha256:${oracle.sha256Hex(oracle.canonicalBytes(envelope))}`).toBe(
        verdict.reopenedHash,
      )
    },
  )
})
