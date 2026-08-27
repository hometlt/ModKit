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

import { throwIfAborted } from '@modkitx-x3/core'

import type {
  MaterializationReceipt,
  ModelMesh,
  ModelNode,
  ModelPrimitive,
  ModelResourceRefsSource,
  ModelSceneInfo,
  ModelSceneSource,
  ModelSocketRef,
  Page,
  PageRequest,
  RevisionId,
  InputSearchScope,
  ResourceProvenanceRecord,
  ResourceSessionPort,
  SemanticScopeRef,
} from '@modkitx-x3/sdk'

/** The drained shape both the scope and the materializer consume. Paging never reaches a hash. */
export interface DrainedModelProjection {
  readonly info: ModelSceneInfo
  readonly nodes: readonly ModelNode[]
  readonly meshes: readonly ModelMesh[]
  readonly primitives?: readonly ModelPrimitive[]
  /** Optional independent socket facet carried by `UV_game_socket` node extensions. */
  readonly sockets?: readonly ModelSocketRef[]
  readonly resourceClosure?: ModelResourceClosure
  /** Live facets deliberately outside `model-interchange-v1`, carried into the receipt. */
  readonly excludedFacetIds?: readonly string[]
}

export interface ModelResourceClosureEntry {
  readonly role: 'buffer' | 'image' | 'companion'
  readonly logicalId: string
  readonly mediaHint: string | null
  readonly digest: string | null
}

export interface ModelResourceClosure {
  readonly mode: 'logical' | 'content-qualified'
  readonly entries: readonly ModelResourceClosureEntry[]
  /** Resolution failures are receipt evidence, deliberately outside the hashed closure value. */
  readonly unavailable?: readonly ResourceProvenanceRecord[]
}

export interface DrainedModelResourceClosure {
  readonly closure: ModelResourceClosure
  readonly provenance: readonly ResourceProvenanceRecord[]
  readonly unavailable: readonly ResourceProvenanceRecord[]
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
    resourceClosureFromUvmCore(
      document: unknown,
      options: { mode: ModelResourceClosure['mode']; digests?: Readonly<Record<string, string>> },
    ): ModelResourceClosure
  }
  readonly materializer: {
    materializeUvmCore(
      projection: unknown,
      request: unknown,
      options?: { digest?: (bytes: Uint8Array) => string },
    ): { bytes: Uint8Array; document: unknown; receipt: MaterializationReceipt }
  }
  readonly textureInterchange: {
    projectionSemanticHash(projection: unknown): string
    projectionFromSidecar(sidecar: unknown): UvtProjection
  }
  readonly uvtProfile: {
    assertUvtProfile(sidecar: unknown): unknown
  }
  readonly textureMaterializer: {
    materializeUvtCore(
      source: unknown,
      request: unknown,
      options?: { digest?: (bytes: Uint8Array) => string },
    ): {
      bytes: Uint8Array
      sidecar: UvtSidecar
      projection: UvtProjection
      receipt: MaterializationReceipt
      losses: readonly string[]
    }
  }
}

let cached: SpecTools | undefined

/** Loads the pinned reference implementations and the materializers under test. */
export async function loadUvTools(repoRoot: string): Promise<SpecTools> {
  if (cached !== undefined) return cached
  const specTool = (name: string): string =>
    pathToFileURL(join(repoRoot, 'vendor', 'multiverse-specs', 'specs', 'tools', name)).href
  const extensionModule = (name: string): string =>
    pathToFileURL(join(repoRoot, 'extensions', 'common', 'uv-materializer', 'src', name)).href
  const modelInterchange = (await import(
    specTool('model-interchange.mjs')
  )) as SpecTools['modelInterchange']
  const uvmCore = (await import(specTool('uvm-core.mjs'))) as SpecTools['uvmCore']
  const textureInterchange = (await import(
    specTool('texture-interchange.mjs')
  )) as SpecTools['textureInterchange']
  const uvtProfile = (await import(specTool('uvt-profile.mjs'))) as SpecTools['uvtProfile']
  const materializer = (await import(
    extensionModule('materializer.js')
  )) as SpecTools['materializer']
  const textureMaterializer = (await import(
    extensionModule('texture-materializer.js')
  )) as SpecTools['textureMaterializer']
  cached = {
    modelInterchange,
    uvmCore,
    materializer,
    textureInterchange,
    uvtProfile,
    textureMaterializer,
  }
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

function imageMediaHint(logicalId: string): string | null {
  const extension = /\.([^.\/\\]+)$/u.exec(logicalId)?.[1]?.toLowerCase()
  if (extension === 'dds') return 'image/vnd-ms.dds'
  if (extension === 'tga') return 'image/x-tga'
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  return null
}

/**
 * Resolve a drained model resource facet through the host-owned post-open port and bind it to the
 * frozen scope's resource-closure shape. Logical mode still performs every resolution: content
 * identity does not reach the hash, but success, failure, revision and byte provenance remain
 * inspectable and no caller is tempted to construct an ambient URI merely because no digest is
 * required.
 */
export async function drainModelResourceClosure(
  source: ModelResourceRefsSource,
  session: ResourceSessionPort,
  options: {
    readonly mode?: ModelResourceClosure['mode']
    readonly scopes?: readonly InputSearchScope[]
    readonly signal?: AbortSignal
    readonly maxReferences?: number
    readonly maxBytes?: bigint
  } = {},
): Promise<DrainedModelResourceClosure> {
  const entries: ModelResourceClosureEntry[] = []
  const unavailable: ResourceProvenanceRecord[] = []
  const seenReferences = new Set<string>()
  const seenCursors = new Set<string>()
  const maxReferences = options.maxReferences ?? 4096
  const maxBytes = options.maxBytes ?? 256n * 1024n * 1024n
  let bytesRead = 0n
  const provenanceStart = session.provenance().length
  let cursor: string | undefined
  let index = 0
  do {
    throwIfAborted(options.signal)
    if (cursor !== undefined) {
      if (seenCursors.has(cursor)) throw new RangeError('model resource paging cursor repeated')
      seenCursors.add(cursor)
    }
    const page = await source.references(
      cursor === undefined ? { limit: 32 } : { limit: 32, cursor },
      options.signal,
    )
    for (const reference of page.items) {
      if (index >= maxReferences)
        throw new RangeError('model resource closure exceeds maxReferences')
      const closureRole = reference.role === 'texture' ? 'image' : 'companion'
      const key = `${closureRole}\0${reference.id}`
      if (seenReferences.has(key)) {
        throw new TypeError(`model resource source repeats ${closureRole} «${reference.id}»`)
      }
      seenReferences.add(key)
      const resolution = await session.resolve(
        {
          id: `model-resource-${provenanceStart + index}`,
          logicalId: reference.id,
          role: reference.role,
          scopes: options.scopes ?? ['workspace-dependency-layer'],
        },
        options.signal,
      )
      if (resolution.state === 'unresolved') {
        unavailable.push(resolution.provenance)
        index += 1
        continue
      }
      try {
        if (resolution.lease.value.kind !== 'bytes') {
          throw new TypeError(`model resource «${reference.id}» did not resolve to bytes`)
        }
        let digest: string | null = null
        if ((options.mode ?? 'logical') === 'content-qualified') {
          const size = resolution.lease.value.size
          if (size === undefined || size > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new RangeError(`model resource «${reference.id}» has no bounded readable size`)
          }
          if (bytesRead + size > maxBytes) {
            throw new RangeError('model resource closure exceeds maxBytes')
          }
          const bytes = await resolution.lease.value.read(0n, Number(size), options.signal)
          if (BigInt(bytes.byteLength) !== size) {
            throw new TypeError(`model resource «${reference.id}» returned a short read`)
          }
          bytesRead += size
          digest = sha256(bytes)
        }
        entries.push({
          role: closureRole,
          logicalId: reference.id,
          mediaHint: reference.role === 'texture' ? imageMediaHint(reference.id) : null,
          digest,
        })
      } finally {
        await resolution.lease.release()
      }
      index += 1
    }
    cursor = page.nextCursor
  } while (cursor !== undefined)
  return {
    closure: {
      mode: options.mode ?? 'logical',
      entries: Object.freeze(entries),
      ...(unavailable.length === 0 ? {} : { unavailable: Object.freeze(unavailable) }),
    },
    provenance: session.provenance().slice(provenanceStart),
    unavailable: Object.freeze(unavailable),
  }
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
  const reopenedWithClosure: DrainedModelProjection =
    projection.resourceClosure === undefined
      ? reopened
      : {
          ...reopened,
          resourceClosure: tools.uvmCore.resourceClosureFromUvmCore(unpacked.document, {
            mode: projection.resourceClosure.mode,
            digests: Object.fromEntries(
              projection.resourceClosure.entries.flatMap(entry =>
                entry.digest === null ? [] : [[entry.logicalId, entry.digest]],
              ),
            ),
          }),
        }

  const liveHash = tools.modelInterchange.projectionSemanticHash(projection)
  const reopenedHash = tools.modelInterchange.projectionSemanticHash(reopenedWithClosure)

  const liveBundle = tools.modelInterchange.buildFacetBundle(projection)
  const reopenedBundle = tools.modelInterchange.buildFacetBundle(reopenedWithClosure)
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

// ---------------------------------------------------------------------------------------------
// UVT (block 12, slice 12-1)

export const TEXTURE_INTERCHANGE_V1: SemanticScopeRef = Object.freeze({
  scopeId: 'texture-interchange-v1',
  version: '1.0.0',
})

/** The `.uvt.json` sidecar shape, as the pinned UVT/core 1.0 schema fixes it. */
export interface UvtSidecar {
  readonly uv: { readonly format: 'UVT'; readonly version: '1.0'; readonly profile: 'core' }
  readonly ktx2: {
    readonly vkFormat: number
    readonly pixelWidth: number
    readonly pixelHeight: number
    readonly pixelDepth: number
    readonly layerCount: number
    readonly faceCount: number
    readonly levelCount: number
    readonly supercompressionScheme: number
  }
  readonly color: {
    readonly transferFunction: 'linear' | 'srgb'
    readonly primaries: 'bt709' | 'unspecified'
    readonly premultipliedAlpha: boolean
  }
  readonly alphaMode: 'opaque' | 'straight' | 'premultiplied'
  readonly orientation: 'rd' | 'ru'
  readonly swizzle?: string
  readonly sampler: Readonly<Record<string, string>>
  readonly atlas?: unknown
}

/** The `texture-interchange-v1` projection: the sidecar's blocks, in the scope's own shape. */
export interface UvtProjection {
  readonly container: Readonly<Record<string, number>>
  readonly color: Readonly<Record<string, unknown>>
  readonly sampler: Readonly<Record<string, string>>
  readonly atlas?: unknown
}

/**
 * What a KTX 2.0 container actually says about itself.
 *
 * Parsed here rather than by the materializer on purpose. The whole point of the profile's
 * mandatory mapping table (SPEC_UVT §1) is that the sidecar can be checked against the container;
 * checking it with the writer's own view of the bytes would prove nothing. So this is a second,
 * independent reader — deliberately small, deliberately not shared with the module under test.
 */
export interface Ktx2ContainerFacts {
  readonly vkFormat: number
  readonly typeSize: number
  readonly pixelWidth: number
  readonly pixelHeight: number
  readonly pixelDepth: number
  readonly layerCount: number
  readonly faceCount: number
  readonly levelCount: number
  readonly supercompressionScheme: number
  /** From the Data Format Descriptor, not from the sidecar. */
  readonly transferFunction: 'linear' | 'srgb' | 'other'
  readonly primaries: 'bt709' | 'unspecified' | 'other'
  readonly premultipliedAlpha: boolean
  /** From the key/value data. */
  readonly keyValues: Readonly<Record<string, string>>
  readonly levelBytes: Uint8Array
}

const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]

export function readKtx2Container(bytes: Uint8Array): Ktx2ContainerFacts {
  if (!KTX2_IDENTIFIER.every((value, index) => bytes[index] === value)) {
    throw new TypeError('the artifact does not start with the KTX 2.0 identifier')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u32 = (offset: number): number => view.getUint32(offset, true)
  const levelCount = u32(40)
  if (levelCount < 1) throw new TypeError('a KTX2 container must declare at least one level')
  const dfdOffset = u32(48)
  const kvdOffset = u32(56)
  const kvdLength = u32(60)

  // --- the Data Format Descriptor's basic block ---------------------------------------------
  const word2 = u32(dfdOffset + 12)
  const transferValue = (word2 >>> 16) & 0xff
  const primariesValue = (word2 >>> 8) & 0xff
  const flags = (word2 >>> 24) & 0xff

  // --- key/value data ------------------------------------------------------------------------
  const keyValues: Record<string, string> = {}
  const decoder = new TextDecoder()
  let cursor = kvdOffset
  const end = kvdOffset + kvdLength
  while (cursor + 4 <= end) {
    const length = u32(cursor)
    if (length === 0) break
    const entry = bytes.subarray(cursor + 4, cursor + 4 + length)
    const separator = entry.indexOf(0)
    if (separator < 0) throw new TypeError('a KTX2 key/value entry has no NUL-terminated key')
    const key = decoder.decode(entry.subarray(0, separator))
    const rawValue = entry.subarray(separator + 1)
    const valueEnd = rawValue.indexOf(0)
    keyValues[key] = decoder.decode(valueEnd < 0 ? rawValue : rawValue.subarray(0, valueEnd))
    cursor += 4 + length
    cursor += (4 - (cursor % 4)) % 4
  }

  const levelOffset = Number(view.getBigUint64(80, true))
  const levelLength = Number(view.getBigUint64(88, true))
  return {
    vkFormat: u32(12),
    typeSize: u32(16),
    pixelWidth: u32(20),
    pixelHeight: u32(24),
    pixelDepth: u32(28),
    layerCount: u32(32),
    faceCount: u32(36),
    levelCount,
    supercompressionScheme: u32(44),
    transferFunction: transferValue === 2 ? 'srgb' : transferValue === 1 ? 'linear' : 'other',
    primaries: primariesValue === 1 ? 'bt709' : primariesValue === 0 ? 'unspecified' : 'other',
    premultipliedAlpha: (flags & 1) !== 0,
    keyValues: Object.freeze(keyValues),
    levelBytes: bytes.slice(levelOffset, levelOffset + levelLength),
  }
}

export interface UvtMaterializationVerdict {
  /** `projectionSemanticHash(texture-interchange-v1)` of the live projection. */
  readonly liveHash: string
  /** The same hash of the projection rebuilt from the reopened container and its sidecar. */
  readonly reopenedHash: string
  readonly exact: boolean
  readonly artifactDigest: string
  readonly byteStable: boolean
  readonly bytes: Uint8Array
  readonly sidecar: UvtSidecar
  readonly container: Ktx2ContainerFacts
  readonly receipt: MaterializationReceipt
  readonly losses: readonly string[]
  /**
   * Rows of SPEC_UVT §1's mandatory mapping table where the sidecar and the container disagree.
   * Empty is the only passing answer: the profile calls a disagreement a defect, not a preference.
   */
  readonly mappingViolations: readonly string[]
}

/** Every row of the mandatory mapping table, checked against a container this harness re-read. */
function mappingViolations(sidecar: UvtSidecar, container: Ktx2ContainerFacts): readonly string[] {
  const problems: string[] = []
  const compare = (field: string, sidecarValue: unknown, containerValue: unknown): void => {
    if (sidecarValue !== containerValue) {
      problems.push(
        `${field}: sidecar ${String(sidecarValue)}, container ${String(containerValue)}`,
      )
    }
  }
  compare('ktx2.vkFormat', sidecar.ktx2.vkFormat, container.vkFormat)
  compare('ktx2.pixelWidth', sidecar.ktx2.pixelWidth, container.pixelWidth)
  compare('ktx2.pixelHeight', sidecar.ktx2.pixelHeight, container.pixelHeight)
  compare('ktx2.pixelDepth', sidecar.ktx2.pixelDepth, container.pixelDepth)
  compare('ktx2.layerCount', sidecar.ktx2.layerCount, container.layerCount)
  compare('ktx2.faceCount', sidecar.ktx2.faceCount, container.faceCount)
  compare('ktx2.levelCount', sidecar.ktx2.levelCount, container.levelCount)
  compare(
    'ktx2.supercompressionScheme',
    sidecar.ktx2.supercompressionScheme,
    container.supercompressionScheme,
  )
  compare('color.transferFunction', sidecar.color.transferFunction, container.transferFunction)
  compare('color.primaries', sidecar.color.primaries, container.primaries)
  compare(
    'color.premultipliedAlpha',
    sidecar.color.premultipliedAlpha,
    container.premultipliedAlpha,
  )
  compare('orientation', sidecar.orientation, container.keyValues['KTXorientation'])
  if (sidecar.swizzle !== undefined) {
    compare('swizzle', sidecar.swizzle, container.keyValues['KTXswizzle'])
  }
  return problems
}

/**
 * Materialize a decoded raster region into UVT, read the container back, and report the verdict.
 *
 * Three independent things are checked and none of them is the materializer checking itself: the
 * pinned `assertUvtProfile` accepts the sidecar, a second reader in this file re-reads the
 * container and every row of the mandatory mapping table is compared against it, and the pinned
 * `texture-interchange-v1` tool hashes the live projection and the reopened one.
 */
export async function materializeTextureAndCompare(
  repoRoot: string,
  source: {
    readonly info: Readonly<Record<string, unknown>>
    readonly region: {
      readonly width: number
      readonly height: number
      readonly rowStride: number
      readonly pixelFormat: string
      readonly pixels: Uint8Array
    }
    readonly sampler?: Readonly<Record<string, string>>
    readonly atlas?: unknown
  },
  options: {
    readonly assetId: string
    readonly subjectRevision: RevisionId | string
  },
): Promise<UvtMaterializationVerdict> {
  const tools = await loadUvTools(repoRoot)
  const request = {
    scope: TEXTURE_INTERCHANGE_V1,
    profile: 'UVT/core@1.0',
    subjectRevision: options.subjectRevision,
    options: { assetId: options.assetId },
  }
  const first = tools.textureMaterializer.materializeUvtCore(source, request, { digest: sha256 })
  const second = tools.textureMaterializer.materializeUvtCore(source, request, { digest: sha256 })
  const byteStable =
    first.bytes.byteLength === second.bytes.byteLength &&
    first.bytes.every((value, index) => value === second.bytes[index])

  // the sidecar must satisfy the pinned profile's own cross-field rules before anything else
  tools.uvtProfile.assertUvtProfile(first.sidecar)
  const container = readKtx2Container(first.bytes)

  const liveHash = tools.textureInterchange.projectionSemanticHash(first.projection)
  /*
   * The reopened projection is rebuilt from the container's own header and DFD, with the two
   * members the container has no place for — the sampler and the atlas — taken from the sidecar.
   * That split is the profile's, not a convenience: SPEC_UVT §1 says the sidecar's ktx2 block is a
   * copy of container values and everything else is UV-level semantics the container cannot hold.
   */
  const reopened: UvtProjection = {
    container: {
      vkFormat: container.vkFormat,
      pixelWidth: container.pixelWidth,
      pixelHeight: container.pixelHeight,
      pixelDepth: container.pixelDepth,
      layerCount: container.layerCount,
      faceCount: container.faceCount,
      levelCount: container.levelCount,
      supercompressionScheme: container.supercompressionScheme,
    },
    color: {
      transferFunction: container.transferFunction,
      primaries: container.primaries,
      premultipliedAlpha: container.premultipliedAlpha,
      alphaMode: first.sidecar.alphaMode,
      orientation: container.keyValues['KTXorientation'],
      swizzle: container.keyValues['KTXswizzle'] ?? null,
    },
    sampler: first.sidecar.sampler,
    ...(first.sidecar.atlas === undefined ? {} : { atlas: first.sidecar.atlas }),
  }
  const reopenedHash = tools.textureInterchange.projectionSemanticHash(reopened)

  return {
    liveHash,
    reopenedHash,
    exact: liveHash === reopenedHash,
    artifactDigest: first.receipt.artifactDigest ?? sha256(first.bytes),
    byteStable,
    bytes: first.bytes,
    sidecar: first.sidecar,
    container,
    receipt: first.receipt,
    losses: first.losses,
    mappingViolations: mappingViolations(first.sidecar, container),
  }
}
