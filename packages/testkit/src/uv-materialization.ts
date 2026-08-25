/**
 * The UVM materialization conformance harness (block 11, slice 11C1, plan items 16 and 18).
 *
 * One reusable routine that answers the question the block-11 exit gate asks: does a live faceted
 * model projection, materialized into UVM and reopened, carry the same semantics — and where it
 * does not, is the difference fully enumerated rather than glossed over?
 *
 * It lives in the testkit rather than inside one test file on purpose. Block 17 runs the same
 * harness against Spring/Recoil S3O and Warzone PIE projections, and a harness that had to be
 * copied to be reused would have drifted by then.
 *
 * **Where the truth comes from.** The scope, the canonical form and the artifact reader are the
 * pinned `multiverse/specs` snapshot under `vendor/multiverse-specs/` — never the sibling
 * repository, and never a second copy of the rules inside X3. The materializer under test is the
 * `uv-materializer` extension. Two independent implementations meeting on committed data is what
 * makes the comparison worth anything.
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type {
  MaterializationReceipt,
  ModelMesh,
  ModelNode,
  ModelPrimitive,
  ModelSceneInfo,
  ModelSceneSource,
  Page,
  PageRequest,
  RevisionId,
  SemanticScopeRef,
} from '@modkitx-x3/sdk'

/** The drained shape both the scope and the materializer consume. Paging never reaches a hash. */
export interface DrainedModelProjection {
  readonly info: ModelSceneInfo
  readonly nodes: readonly ModelNode[]
  readonly meshes: readonly ModelMesh[]
  readonly primitives?: readonly ModelPrimitive[]
}

export interface UvMaterializationVerdict {
  /** `projectionSemanticHash(model-interchange-v1)` of the live projection. */
  readonly liveHash: string
  /** The same hash of the projection reopened from the materialized artifact. */
  readonly reopenedHash: string
  /** True only when the two are byte-for-byte the same digest. There is no near-match. */
  readonly exact: boolean
  /** Digest of the produced bytes, and proof that materializing twice produced them again. */
  readonly artifactDigest: string
  readonly byteStable: boolean
  readonly bytes: Uint8Array
  readonly receipt: MaterializationReceipt
  /** Facet keys whose values actually differ, derived independently of the receipt. */
  readonly differingFacets: readonly string[]
  /** Facet keys present in one projection and absent in the other. */
  readonly facetPresenceDiff: readonly string[]
}

interface SpecTools {
  readonly modelInterchange: {
    projectionSemanticHash(projection: unknown): string
    buildFacetBundle(projection: unknown): {
      facets: readonly (readonly [string, unknown])[]
      absentFacets: readonly string[]
    }
  }
  readonly uvmCore: {
    unpackGlb(bytes: Uint8Array): { document: unknown; binary: Uint8Array }
    projectionFromUvmCore(document: unknown, binary: Uint8Array): DrainedModelProjection
    assertUvmCore(document: unknown): unknown
  }
  readonly materializer: {
    materializeUvmCore(
      projection: unknown,
      request: unknown,
      options?: { digest?: (bytes: Uint8Array) => string },
    ): { bytes: Uint8Array; document: unknown; receipt: MaterializationReceipt }
  }
}

let cached: SpecTools | undefined

/** Loads the pinned reference implementations and the materializer under test. */
export async function loadUvTools(repoRoot: string): Promise<SpecTools> {
  if (cached !== undefined) return cached
  const specTool = (name: string): string =>
    pathToFileURL(join(repoRoot, 'vendor', 'multiverse-specs', 'specs', 'tools', name)).href
  const modelInterchange = (await import(
    specTool('model-interchange.mjs')
  )) as SpecTools['modelInterchange']
  const uvmCore = (await import(specTool('uvm-core.mjs'))) as SpecTools['uvmCore']
  const materializer = (await import(
    pathToFileURL(
      join(repoRoot, 'extensions', 'common', 'uv-materializer', 'src', 'materializer.js'),
    ).href
  )) as SpecTools['materializer']
  cached = { modelInterchange, uvmCore, materializer }
  return cached
}

export const MODEL_INTERCHANGE_V1: SemanticScopeRef = Object.freeze({
  scopeId: 'model-interchange-v1',
  version: '1.0.0',
})

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

/**
 * Drain a live `ModelSceneSource` one record per page.
 *
 * One record per page deliberately: if paging order could reach the hash, a single-item drain and a
 * bulk drain would disagree, and the whole comparison would be measuring the page size.
 */
export async function drainModelProjection(
  source: ModelSceneSource,
  options: { readonly maxBytes?: number } = {},
): Promise<DrainedModelProjection> {
  const info = await source.info()
  const drain = async <T>(read: (request: PageRequest) => Promise<Page<T>>): Promise<T[]> => {
    const items: T[] = []
    let cursor: string | undefined
    do {
      const page: Page<T> = await read(cursor === undefined ? { limit: 1 } : { limit: 1, cursor })
      items.push(...page.items)
      cursor = page.nextCursor
    } while (cursor !== undefined)
    return items
  }
  const nodes = await drain<ModelNode>(request => source.nodes(request))
  const meshes = await drain<ModelMesh>(request => source.meshes(request))
  if (info.geometryAccess !== 'decoded' || source.primitive === undefined) {
    return { info, nodes, meshes }
  }
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024
  const primitives: ModelPrimitive[] = []
  for (const mesh of meshes) {
    for (const primitiveId of mesh.primitiveIds) {
      primitives.push(await source.primitive(primitiveId, { maxBytes }))
    }
  }
  return { info, nodes, meshes, primitives }
}

/**
 * Materialize a drained projection, reopen it, and report the verdict.
 *
 * Nothing here decides whether a difference is acceptable — it reports what is, including the
 * facets that actually differ, computed from the two projections rather than read out of the
 * receipt. A receipt that agrees with an independently derived diff is evidence; a receipt checked
 * against itself is decoration.
 */
export async function materializeAndCompare(
  repoRoot: string,
  projection: DrainedModelProjection,
  options: {
    readonly assetId: string
    readonly sourceFormat: string
    readonly subjectRevision: RevisionId | string
    readonly assetClass?: string
  },
): Promise<UvMaterializationVerdict> {
  const tools = await loadUvTools(repoRoot)
  const request = {
    scope: MODEL_INTERCHANGE_V1,
    profile: 'UVM/core@1.0',
    subjectRevision: options.subjectRevision,
    options: {
      assetId: options.assetId,
      sourceFormat: options.sourceFormat,
      ...(options.assetClass === undefined ? {} : { assetClass: options.assetClass }),
    },
  }
  const first = tools.materializer.materializeUvmCore(projection, request, { digest: sha256 })
  const second = tools.materializer.materializeUvmCore(projection, request, { digest: sha256 })
  const byteStable =
    first.bytes.byteLength === second.bytes.byteLength &&
    first.bytes.every((value, index) => value === second.bytes[index])

  // the produced bytes must satisfy the profile before anything is compared against them
  const unpacked = tools.uvmCore.unpackGlb(first.bytes)
  tools.uvmCore.assertUvmCore(unpacked.document)
  const reopened = tools.uvmCore.projectionFromUvmCore(unpacked.document, unpacked.binary)

  const liveHash = tools.modelInterchange.projectionSemanticHash(projection)
  const reopenedHash = tools.modelInterchange.projectionSemanticHash(reopened)

  const liveBundle = tools.modelInterchange.buildFacetBundle(projection)
  const reopenedBundle = tools.modelInterchange.buildFacetBundle(reopened)
  const reopenedByKey = new Map(reopenedBundle.facets.map(entry => [entry[0], entry[1]]))
  const differingFacets: string[] = []
  const facetPresenceDiff: string[] = []
  for (const [key, value] of liveBundle.facets) {
    if (!reopenedByKey.has(key)) {
      facetPresenceDiff.push(key)
      continue
    }
    if (JSON.stringify(value) !== JSON.stringify(reopenedByKey.get(key))) differingFacets.push(key)
  }
  for (const [key] of reopenedBundle.facets) {
    if (!liveBundle.facets.some(entry => entry[0] === key)) facetPresenceDiff.push(key)
  }

  return {
    liveHash,
    reopenedHash,
    exact: liveHash === reopenedHash,
    artifactDigest: first.receipt.artifactDigest ?? sha256(first.bytes),
    byteStable,
    bytes: first.bytes,
    receipt: first.receipt,
    differingFacets,
    facetPresenceDiff,
  }
}

/**
 * Assert the receipt accounts for every facet that actually differs.
 *
 * This is the rule that makes `MaterializationReceipt` worth carrying: an unexplained difference is
 * a defect, and a receipt naming a difference that did not happen is noise. Returns the facets that
 * differ without a receipt entry — empty means the receipt is complete.
 */
export function unexplainedDifferences(verdict: UvMaterializationVerdict): readonly string[] {
  const explained = new Set<string>([
    ...verdict.receipt.diff.map(entry => entry.facetId),
    ...verdict.receipt.lostFacetIds,
    ...verdict.receipt.excludedFacetIds,
  ])
  return [...verdict.differingFacets, ...verdict.facetPresenceDiff].filter(
    facet => !explained.has(facet),
  )
}
