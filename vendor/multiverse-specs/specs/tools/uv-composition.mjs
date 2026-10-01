/**
 * Reference composition: UVP layer ordering and UVD definition resolution.
 *
 * This is the executable form of the composition contract SPEC_UVP.md §2 and SPEC_UVD.md §4
 * declare. Like every tool in this seed it is dependency-free and replaceable: the vectors in
 * `../conformance/uvp-composition/` and `../conformance/uvd-resolution/` are the contract, this
 * file is one implementation of it.
 *
 * Every failure is a typed refusal `{ rule, message }` naming the members involved; the first
 * refusal of a stage stops that stage (composition is refused, not partially applied).
 */
import { canonicalBytes, uvpJsonArtifactDigest, uvpMediaArtifactDigest } from './uv-canonical-form.mjs'
import { uvwGltfImageReferences, uvwGltfOriginalReferences, uvwGltfMediaOutputReferences,
  uvwGltfRasterReferences } from './uvw-gltf.mjs'
import { uvwGltfPagedBufferReferences, verifyUvwGltfPagedArtifact } from './uvw-gltf-pages.mjs'
import { unpackStrictGlb, unpackBoundedGlb } from './gltf-container.mjs'
import { assertUvmCore } from './uvm-profile.mjs'
import { decodeUvb, encodeUvb, uvbIdentityDigest } from './uvb-binary.mjs'
import { verifyModule, verifyExecutableModuleProfile } from './uv-verify.mjs'
import { projectScenarioVariables } from './uv-scenario-variables.mjs'
import { verifyWorldInstanceSelections, projectWorldSpaces } from './uv-world-instances.mjs'

async function semanticDigest(domain, value) {
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) throw new TypeError('Web Crypto SHA-256 is required for UV composition')
  const bytes = canonicalBytes({ schemaVersion: 1, domain, value })
  const hash = new Uint8Array(await subtle.digest('SHA-256', bytes))
  return `sha256:${[...hash].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

const qualifiedDigest = /^sha256:[0-9a-f]{64}$/
const receiptRanks = ['base', 'official', 'map', 'mod']
const verifiedReceipts = new WeakSet()
const verifiedArtifacts = new WeakMap()
export const VERIFIED_MEDIA_LIMITS = Object.freeze({ artifactBytes: 64 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024, artifacts: 4096 })
export const VERIFIED_MODEL_LIMITS = Object.freeze({ artifactBytes: 16 * 1024 * 1024,
  totalBytes: 128 * 1024 * 1024, artifacts: 4096 })
const ownKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')

/** Semantic run identity of the ordered layer list, independent of container packing. */
export async function compositionHashForLayers(layers) {
  return semanticDigest('uv.composition/layers', layers)
}

/** Check the receipt's internal identity; artifact hashes still need the content-source verifier. */
export async function verifyCompositionReceipt(receipt) {
  const reject = (rule, message) => ({ refusal: { rule, message } })
  const keys = ['kind', 'schemaVersion', 'root', 'verdict', 'layers', 'requirements', 'compositionHash']
  if (!(ownKeys(receipt, keys) || (ownKeys(receipt, [...keys, '$comment']) && typeof receipt.$comment === 'string'))
    || receipt.kind !== 'uv.receipt/composition' || receipt.schemaVersion !== 1
    || receipt.verdict !== 'composed'
    || !ownKeys(receipt.root, ['id', 'version'])
    || typeof receipt.root.id !== 'string' || typeof receipt.root.version !== 'string'
    || !ownKeys(receipt.requirements, ['intrinsicsChecked', 'capabilitiesGranted'])
    || !Number.isSafeInteger(receipt.requirements.intrinsicsChecked)
    || receipt.requirements.intrinsicsChecked < 0
    || !Array.isArray(receipt.requirements.capabilitiesGranted)
    || receipt.requirements.capabilitiesGranted.some(cap => !['read', 'mutate', 'present', 'control', 'space-mutate'].includes(cap))
    || !Array.isArray(receipt.layers) || receipt.layers.length === 0)
    return reject('invalid-composition-receipt', 'Composition receipt shape is invalid or refused.')
  const seen = new Set()
  let previousRank = -1
  let rootCount = 0
  for (const layer of receipt.layers) {
    if (!ownKeys(layer, ['id', 'version', 'rank', 'contentDigest'])
      || typeof layer.id !== 'string' || !layer.id
      || typeof layer.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(layer.version)
      || !qualifiedDigest.test(layer.contentDigest)
      || !receiptRanks.includes(layer.rank) || seen.has(layer.id))
      return reject('invalid-composition-layer', 'A layer is malformed or repeated.')
    seen.add(layer.id)
    const rank = receiptRanks.indexOf(layer.rank)
    if (rank < previousRank) return reject('composition-layer-order', 'Layer ranks are not ordered.')
    previousRank = rank
    if (layer.id === receipt.root.id && layer.version === receipt.root.version) rootCount += 1
  }
  if (rootCount !== 1) return reject('composition-root', 'The root must occur exactly once in the layers.')
  if (receipt.compositionHash !== await compositionHashForLayers(receipt.layers))
    return reject('composition-hash-mismatch', 'compositionHash does not match the ordered layers.')
  return { compositionHash: receipt.compositionHash, layers: receipt.layers }
}

/** An internal integrity check is not proof that the named artifacts were read. Only receipts
 * issued by composeVerifiedReceipt in this process may authorize executable bindings.
 */
export async function verifyProducedCompositionReceipt(receipt) {
  if (receipt === null || typeof receipt !== 'object' || !verifiedReceipts.has(receipt))
    return { refusal: { rule: 'unverified-composition-receipt', message: 'Artifact digests were not verified by the compositor.' } }
  return verifyCompositionReceipt(receipt)
}

/** Return immutable format-owner documents captured by the same verified artifact reads.
 * Serialized receipts deliberately cannot recover this in-process provenance.
 */
export async function verifiedCompositionDocuments(receipt) {
  const checked = await verifyProducedCompositionReceipt(receipt)
  if (checked.refusal !== undefined) return checked
  const artifacts = verifiedArtifacts.get(receipt)
  return { documents: artifacts?.documents ?? [], contents: artifacts?.contents ?? [] }
}

/** Verified UVB bytes remain private to this receipt; every caller gets an independent copy. */
export async function verifiedCompositionBytecode(receipt) {
  const checked = await verifyProducedCompositionReceipt(receipt)
  if (checked.refusal !== undefined) return checked
  return { modules: (verifiedArtifacts.get(receipt)?.bytecode ?? []).map(entry => ({
    packageId: entry.packageId, path: entry.path, digest: entry.digest, bytes: entry.bytes.slice(),
  })) }
}

/** Captured raw media, bounded and independently hashed. Every caller gets private copies.
 * A digest-only witness for an unrelated legacy media entry is not exposed as verified bytes.
 */
export async function verifiedCompositionMedia(receipt) {
  const checked = await verifyProducedCompositionReceipt(receipt)
  if (checked.refusal !== undefined) return checked
  return { media: (verifiedArtifacts.get(receipt)?.media ?? []).map(entry => ({
    packageId: entry.packageId, path: entry.path, digest: entry.digest, bytes: entry.bytes.slice(),
  })) }
}

/** Optional raw-hash-proved UVM GLB witnesses, isolated from the caller and receipt JSON. */
export async function verifiedCompositionModels(receipt) {
  const checked = await verifyProducedCompositionReceipt(receipt)
  if (checked.refusal !== undefined) return checked
  return { models: (verifiedArtifacts.get(receipt)?.models ?? []).map(entry => ({
    packageId: entry.packageId, path: entry.path, digest: entry.digest,
    document: entry.document, bytes: entry.bytes.slice(),
  })) }
}

/** Chart-local initializers projected only from documents behind this verified receipt. */
export async function verifiedCompositionScenarioVariables(receipt) {
  const checked = await verifyProducedCompositionReceipt(receipt)
  if (checked.refusal !== undefined) return checked
  return { variables: verifiedArtifacts.get(receipt)?.scenarioVariables ?? [] }
}

/** Final match policy selected explicitly by the root before execution, never mutable State. */
export async function verifiedCompositionRuntimeRules(receipt) {
  const checked = await verifyProducedCompositionReceipt(receipt)
  if (checked.refusal !== undefined) return checked
  return { rules: verifiedArtifacts.get(receipt)?.runtimeRules }
}

/** Immutable addresses for the selected world instances; no caller-supplied geometry. */
export async function verifiedCompositionWorldSpaces(receipt) {
  const checked = await verifyProducedCompositionReceipt(receipt)
  if (checked.refusal !== undefined) return checked
  const artifacts = verifiedArtifacts.get(receipt)
  if (artifacts.worldSpaces === undefined) {
    const result = projectWorldSpaces(undefined, artifacts.documents)
    if (result.refusal !== undefined) return result
    artifacts.worldSpaces = result.spaces
  }
  return { spaces: artifacts.worldSpaces }
}

function freezeDocument(value) {
  if (value !== null && typeof value === 'object') {
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)
      throw new TypeError('Verified documents must be plain JSON objects')
    for (const child of Object.values(value)) freezeDocument(child)
    Object.freeze(value)
  }
  return value
}

/** Schema-valid UVP manifests only. The trusted format owner reads artifacts and supplies a
 * digest plus parsed UVD/UVW/UVS document or UVB bytes. The compositor independently verifies
 * the JSON digest or canonical UVB identity, and verifies UVB requirements before receipt.
 * Media with a byte witness uses raw SHA-256. UVW glTF image closure requires these witnesses;
 * UVM GLB may additionally supply bounded raw-hash-proved bytes; digest-only models retain
 * manifest identity but cannot prove sockets. No I/O here.
 */
export async function composeVerifiedReceipt(rootId, manifests, registry, granted, artifactDigest, signal) {
  const reject = (rule, message) => ({ refusal: { rule, message } })
  const capabilities = ['read', 'mutate', 'present', 'control', 'space-mutate']
  if (!Array.isArray(manifests) || !Array.isArray(registry?.intrinsics) || !Array.isArray(granted)
    || granted.some(cap => !capabilities.includes(cap)) || typeof artifactDigest !== 'function')
    return reject('verification-input-missing', 'Registry, grants and a canonical artifact digest owner are required.')
  let ownedManifests
  try { ownedManifests = structuredClone(manifests) }
  catch { return reject('invalid-package-content', 'Package manifests must be cloneable JSON.') }
  const grants = [...granted]
  const order = composePackages(rootId, ownedManifests, registry, grants)
  if (order.refusal !== undefined) return order
  const byId = new Map(ownedManifests.map(manifest => [manifest.id, manifest]))
  const root = byId.get(rootId)
  const worldSelection = verifyWorldInstanceSelections(rootId, order.layers.map(layer => byId.get(layer.id)))
  if (worldSelection.refusal !== undefined) return worldSelection
  let hasRules = false
  for (const layer of order.layers) {
    const manifest = byId.get(layer.id)
    if (!Object.hasOwn(manifest, 'runtimeRules')) continue
    hasRules = true
    const rules = manifest.runtimeRules
    if (!ownKeys(rules, ['schemaVersion', 'worldMutation']) || rules.schemaVersion !== 1
      || !['none', 'cell-blockers'].includes(rules.worldMutation))
      return reject('runtime-rules-invalid', `${layer.id} has unsupported or malformed immutable runtime rules.`)
  }
  if (hasRules && !Object.hasOwn(root, 'runtimeRules'))
    return reject('runtime-rules-root-required', 'The root must explicitly select complete match rules when a dependency declares them.')
  const runtimeRules = root.runtimeRules === undefined ? undefined : freezeDocument(root.runtimeRules)
  const layers = []
  const documents = []
  const bytecode = []
  const media = []
  const models = []
  const pagedWorlds = []
  let mediaBytes = 0
  let modelBytes = 0
  const verifiedContents = []
  let intrinsicsChecked = 0
  for (const layer of order.layers) {
    if (signal?.aborted) return reject('cancelled', 'Composition was cancelled.')
    const manifest = byId.get(layer.id)
    if (manifest === undefined || !Array.isArray(manifest.contents))
      return reject('invalid-package-content', `Package ${layer.id} has no verified content list.`)
    const contents = []
    if (new Set(manifest.contents.map(entry => entry?.path)).size !== manifest.contents.length)
      return reject('artifact-path-duplicate', `Package ${layer.id} repeats a logical artifact path.`)
    intrinsicsChecked += manifest.requires?.intrinsics?.length ?? 0
    for (const entry of manifest.contents) {
      if (signal?.aborted) return reject('cancelled', 'Composition was cancelled.')
      const content = Object.freeze({ ...entry })
      if (typeof content.path !== 'string' || typeof content.family !== 'string'
        || !qualifiedDigest.test(content.hash))
        return reject('invalid-package-content', `Package ${layer.id} has a malformed content entry.`)
      let witness
      try { witness = await artifactDigest({ packageId: layer.id, content, signal }) }
      catch { return reject('artifact-unavailable', `${layer.id}/${content.path} could not be verified.`) }
      if (signal?.aborted) return reject('cancelled', 'Composition was cancelled.')
      const reported = typeof witness === 'string' ? witness : witness?.digest
      let actual = reported
      if (content.family === 'uvw' && content.path.endsWith('.uvw.glb')) {
        if (typeof witness !== 'object' || witness === null || !(witness.bytes instanceof Uint8Array)
          || witness.document !== undefined)
          return reject('artifact-bytes-missing', `${layer.id}/${content.path} needs GLB bytes.`)
        try {
          const bytes = Uint8Array.from(witness.bytes)
          const { document, binary } = unpackStrictGlb(bytes)
          const verified = await verifyUvwGltfPagedArtifact(document, [binary])
          actual = verified.digest
          documents.push(Object.freeze({ packageId: layer.id, family: 'uvw',
            path: content.path, layer: content.layer, document: freezeDocument(verified.document),
            containerHash: await uvpMediaArtifactDigest(bytes) }))
        } catch (error) {
          return reject('world-glb-invalid', `${layer.id}/${content.path}: ${error.message}`)
        }
        if (reported !== actual)
          return reject('artifact-digest-mismatch', `${layer.id}/${content.path} GLB logical identity differs from its bytes.`)
      } else if (content.family === 'uvd' || content.family === 'uvw' || content.family === 'uvs') {
        if (typeof witness !== 'object' || witness === null || !('document' in witness))
        return reject('artifact-document-missing', `${layer.id}/${content.path} needs its parsed JSON witness.`)
        let document
        try {
          document = freezeDocument(structuredClone(witness.document))
          if (content.family === 'uvw' && document?.asset?.extras?.uv?.profile === 'space-graph-paged') {
            // Buffer closure is checked after all media in the package has been captured.
            pagedWorlds.push({ packageId: layer.id, path: content.path, document })
          } else actual = await uvpJsonArtifactDigest(content.family, document)
        } catch {
          return reject('artifact-document-invalid', `${layer.id}/${content.path} has no JCS JSON document.`)
        }
        if (reported !== actual)
          return reject('artifact-digest-mismatch', `${layer.id}/${content.path} witness digest differs from its document.`)
        documents.push(Object.freeze({ packageId: layer.id, family: content.family,
          path: content.path, layer: content.layer, document }))
      } else if (content.family === 'uvb') {
        if (typeof witness !== 'object' || witness === null || !(witness.bytes instanceof Uint8Array))
          return reject('artifact-bytes-missing', `${layer.id}/${content.path} needs its UVB binary witness.`)
        const bytes = Uint8Array.from(witness.bytes)
        let module
        try {
          module = decodeUvb(bytes)
          const canonical = encodeUvb(module)
          if (canonical.length !== bytes.length || canonical.some((byte, index) => byte !== bytes[index]))
            return reject('artifact-binary-noncanonical', `${layer.id}/${content.path} has noncanonical UVB bytes.`)
        } catch (error) {
          return reject('artifact-binary-invalid', `${layer.id}/${content.path}: ${error instanceof Error ? error.message : String(error)}`)
        }
        for (const requirement of module.requires.intrinsics) {
          if (!manifest.requires.intrinsics.includes(requirement))
            return reject('behavior-requirement-undeclared', `${layer.id}/${content.path} requires ${requirement} outside its UVP manifest.`)
        }
        let verification
        try { verification = verifyModule(module, registry, { granted: grants }) }
        catch (error) {
          return reject('behavior-verification-refused', `${layer.id}/${content.path}: ${error instanceof Error ? error.message : String(error)}`)
        }
        if (verification.refusal !== undefined)
          return reject('behavior-verification-refused', `${layer.id}/${content.path}: ${verification.refusal.rule}: ${verification.refusal.message}`)
        const profile = verifyExecutableModuleProfile(module)
        if (profile.refusal !== undefined)
          return reject(profile.refusal.rule, `${layer.id}/${content.path}: ${profile.refusal.message}`)
        actual = await uvbIdentityDigest(bytes)
        if (reported !== actual)
          return reject('artifact-digest-mismatch', `${layer.id}/${content.path} witness digest differs from its UVB bytes.`)
        bytecode.push({ packageId: layer.id, path: content.path, digest: actual, bytes })
      } else if (content.family === 'uvm' && witness?.bytes !== undefined) {
        if (!content.path.endsWith('.uvm.glb') || !(witness.bytes instanceof Uint8Array)
          || witness.document !== undefined)
          return reject('artifact-model-bytes', `${layer.id}/${content.path} needs UVM GLB bytes.`)
        if (!witness.bytes.byteLength || witness.bytes.byteLength > VERIFIED_MODEL_LIMITS.artifactBytes
          || modelBytes + witness.bytes.byteLength > VERIFIED_MODEL_LIMITS.totalBytes
          || models.length >= VERIFIED_MODEL_LIMITS.artifacts)
          return reject('artifact-model-budget', 'Verified models exceed the UVM byte budget.')
        const bytes = Uint8Array.from(witness.bytes)
        try {
          const parsed = unpackBoundedGlb(bytes)
          assertUvmCore(parsed.document)
          actual = await uvpMediaArtifactDigest(bytes)
          models.push({ packageId: layer.id, path: content.path, digest: actual,
            document: freezeDocument(parsed.document), bytes })
          modelBytes += bytes.byteLength
        } catch (error) {
          return reject('artifact-model-invalid', `${layer.id}/${content.path}: ${error.message}`)
        }
        if (reported !== actual)
          return reject('artifact-digest-mismatch', `${layer.id}/${content.path} UVM digest differs from its bytes.`)
      } else if (content.family === 'media' && witness?.bytes !== undefined) {
        if (!(witness.bytes instanceof Uint8Array) || witness.document !== undefined)
          return reject('artifact-bytes-invalid', `${layer.id}/${content.path} needs raw media bytes.`)
        if (!witness.bytes.byteLength || witness.bytes.byteLength > VERIFIED_MEDIA_LIMITS.artifactBytes
          || mediaBytes + witness.bytes.byteLength > VERIFIED_MEDIA_LIMITS.totalBytes
          || media.length >= VERIFIED_MEDIA_LIMITS.artifacts)
          return reject('artifact-media-budget', 'Verified media exceeds its nonempty artifact or composition budget.')
        const bytes = Uint8Array.from(witness.bytes)
        mediaBytes += bytes.byteLength
        try { actual = await uvpMediaArtifactDigest(bytes) }
        catch { return reject('artifact-bytes-invalid', `${layer.id}/${content.path} could not be hashed.`) }
        if (reported !== actual)
          return reject('artifact-digest-mismatch', `${layer.id}/${content.path} witness digest differs from its media bytes.`)
        media.push({ packageId: layer.id, path: content.path, digest: actual, bytes })
      } else if (typeof witness === 'object' && witness !== null && 'document' in witness) {
        return reject('artifact-document-invalid', `${layer.id}/${content.path} is not a UVD/UVW/UVS document.`)
      }
      if (actual !== content.hash)
        return reject('artifact-digest-mismatch', `${layer.id}/${content.path} differs from its canonical digest.`)
      contents.push({ family: content.family, path: content.path, hash: actual,
        ...(content.layer === undefined ? {} : { layer: content.layer }) })
      verifiedContents.push(Object.freeze({ packageId: layer.id, family: content.family,
        path: content.path, hash: actual }))
    }
    layers.push({ id: layer.id, version: manifest.version, rank: layer.rank,
      contentDigest: manifest.worldInstances !== undefined
        ? await semanticDigest('uvp/contents-and-world-instances@1', { contents,
          worldInstances: manifest.worldInstances,
          ...(manifest.runtimeRules === undefined ? {} : { runtimeRules: manifest.runtimeRules }) })
        : manifest.runtimeRules === undefined
        ? await semanticDigest('uvp/contents', contents)
        : await semanticDigest('uvp/contents-and-runtime-rules@1', { contents, runtimeRules: manifest.runtimeRules }) })
  }
  if (signal?.aborted) return reject('cancelled', 'Composition was cancelled.')
  const mediaByPath = new Map(media.map(entry => [JSON.stringify([entry.packageId, entry.path]), entry]))
  const contentByPath = new Map(verifiedContents.map(entry => [JSON.stringify([entry.packageId, entry.path]), entry]))
  for (const paged of pagedWorlds) {
    let verified
    try {
      const refs = uvwGltfPagedBufferReferences(paged.document, paged.path)
      const bytes = refs.map(ref => {
        const key = JSON.stringify([paged.packageId, ref.path])
        const artifact = mediaByPath.get(key)
        if (contentByPath.get(key)?.family !== 'media' || artifact?.bytes.byteLength !== ref.byteLength)
          throw new TypeError(`Missing exact buffer bytes for ${ref.path}`)
        return artifact.bytes
      })
      verified = await verifyUvwGltfPagedArtifact(paged.document, bytes)
    } catch (error) {
      return reject('world-page-unverified', `${paged.packageId}/${paged.path}: ${error.message}`)
    }
    const key = JSON.stringify([paged.packageId, paged.path])
    if (verified.digest !== contentByPath.get(key)?.hash)
      return reject('artifact-digest-mismatch', `${paged.packageId}/${paged.path} paged identity differs from its verified buffers.`)
    const index = documents.findIndex(entry => entry.packageId === paged.packageId
      && entry.path === paged.path)
    documents[index] = Object.freeze({ ...documents[index], document: freezeDocument(verified.document) })
  }
  const imageTypes = new Map()
  for (const entry of documents) {
    if (entry.family !== 'uvw' || entry.document === null || !Object.hasOwn(entry.document, 'asset')) continue
    let references
    try { references = uvwGltfImageReferences(entry.document, entry.path) }
    catch (error) { return reject('world-resource-reference', `${entry.packageId}/${entry.path}: ${error.message}`) }
    for (const reference of references) {
      const key = JSON.stringify([entry.packageId, reference.path])
      if (!mediaByPath.has(key))
        return reject('world-resource-unverified', `${entry.packageId}/${entry.path} image ${reference.imageIndex} needs verified media ${reference.path}.`)
      if (imageTypes.has(key) && imageTypes.get(key) !== reference.mimeType)
        return reject('world-resource-mime-conflict', `Conflicting image types for ${entry.packageId}/${reference.path}.`)
      const bytes = mediaByPath.get(key).bytes
      const signature = reference.mimeType === 'image/png'
        ? [137, 80, 78, 71, 13, 10, 26, 10]
        : [255, 216, 255]
      if (bytes.length < signature.length || signature.some((byte, index) => bytes[index] !== byte))
        return reject('world-resource-mime', `${entry.packageId}/${reference.path} bytes do not match ${reference.mimeType}.`)
      imageTypes.set(key, reference.mimeType)
    }
    let originals
    try { originals = uvwGltfOriginalReferences(entry.document) }
    catch (error) { return reject('world-resource-reference', `${entry.packageId}/${entry.path}: ${error.message}`) }
    for (const original of originals) {
      const key = JSON.stringify([entry.packageId, original.path])
      if (contentByPath.get(key)?.family !== original.family
        || (original.family === 'media' && !mediaByPath.has(key)))
        return reject('world-resource-unverified', `${entry.packageId}/${entry.path} original ${original.spaceId}/${original.layerId}/${original.resourceId} needs ${original.family} ${original.path}.`)
    }
    let outputs
    try { outputs = uvwGltfMediaOutputReferences(entry.document) }
    catch (error) { return reject('world-resource-reference', `${entry.packageId}/${entry.path}: ${error.message}`) }
    for (const output of outputs) {
      const key = JSON.stringify([entry.packageId, output.path])
      if (contentByPath.get(key)?.family !== 'media' || !mediaByPath.has(key))
        return reject('world-resource-unverified', `${entry.packageId}/${entry.path} output ${output.spaceId}/${output.layerId}/${output.resourceId}/${output.usage} needs verified media ${output.path}.`)
    }
    let rasterLayers
    try { rasterLayers = uvwGltfRasterReferences(entry.document) }
    catch (error) { return reject('world-raster-reference', `${entry.packageId}/${entry.path}: ${error.message}`) }
    for (const layer of rasterLayers) {
      const rasters = []
      for (const raster of layer.rasters) {
        const artifact = mediaByPath.get(JSON.stringify([entry.packageId, raster.path]))
        if (!artifact || contentByPath.get(JSON.stringify([entry.packageId, raster.path]))?.family !== 'media')
          return reject('world-raster-unverified', `${entry.packageId}/${raster.path} needs verified raw weight bytes.`)
        const expected = raster.width * raster.height * 4
        if (artifact.bytes.length !== expected)
          return reject('world-raster-length', `${entry.packageId}/${raster.path} needs ${expected} RGBA bytes.`)
        rasters.push(artifact.bytes)
      }
      if (layer.sampling.zeroSum.mode === 'refuse') {
        for (let pixel = 0, pixels = layer.rasters[0].width * layer.rasters[0].height; pixel < pixels; pixel++) {
          let sum = 0
          for (const [index, raster] of layer.rasters.entries())
            for (let channel = 0; channel < raster.materialIds.length; channel++)
              sum += rasters[index][pixel * 4 + channel]
          if (sum === 0)
            return reject('world-raster-zero-sum', `${entry.packageId}/${layer.spaceId}/${layer.layerId} has zero weights at texel ${pixel}.`)
        }
      }
    }
  }
  const scenario = projectScenarioVariables(documents.filter(entry => entry.family === 'uvs'))
  if (scenario.refusal !== undefined) return scenario
  const worldProjection = worldSelection.selection === undefined ? undefined
    : projectWorldSpaces(worldSelection.selection, documents)
  if (worldProjection?.refusal !== undefined) return worldProjection
  const receipt = {
    kind: 'uv.receipt/composition', schemaVersion: 1,
    root: { id: rootId, version: root.version }, verdict: 'composed', layers,
    requirements: { intrinsicsChecked,
      capabilitiesGranted: capabilities.filter(cap => grants.includes(cap)) },
    compositionHash: await compositionHashForLayers(layers),
  }
  const check = await verifyCompositionReceipt(receipt)
  if (check.refusal !== undefined) return check
  if (signal?.aborted) return reject('cancelled', 'Composition was cancelled.')
  Object.freeze(receipt.root)
  for (const layer of receipt.layers) Object.freeze(layer)
  Object.freeze(receipt.layers)
  Object.freeze(receipt.requirements.capabilitiesGranted)
  Object.freeze(receipt.requirements)
  Object.freeze(receipt)
  verifiedReceipts.add(receipt)
  verifiedArtifacts.set(receipt, { documents: Object.freeze(documents),
    bytecode: Object.freeze(bytecode), media: Object.freeze(media), models: Object.freeze(models),
    contents: Object.freeze(verifiedContents),
    runtimeRules,
    worldSpaces: worldProjection?.spaces,
    scenarioVariables: Object.freeze(scenario.variables.map(row => Object.freeze(row))) })
  return { receipt }
}

// --- minimal semver ------------------------------------------------------------------------------

const parseVersion = text => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text)
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

const compareVersions = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** `1.2.3` exact, `^1.2.3` same-major, `~1.2.3` same-minor. */
export function satisfies(version, range) {
  const flavor = range.startsWith('^') ? 'caret' : range.startsWith('~') ? 'tilde' : 'exact'
  const base = parseVersion(flavor === 'exact' ? range : range.slice(1))
  const actual = parseVersion(version)
  if (base === undefined || actual === undefined) return false
  if (flavor === 'exact') return compareVersions(actual, base) === 0
  if (compareVersions(actual, base) < 0) return false
  if (flavor === 'caret') {
    // conventional caret: 0.x.y pins the minor, 0.0.z pins the patch
    if (base[0] > 0) return actual[0] === base[0]
    if (base[1] > 0) return actual[0] === 0 && actual[1] === base[1]
    return compareVersions(actual, base) === 0
  }
  return actual[0] === base[0] && actual[1] === base[1]
}

// --- UVP composition -----------------------------------------------------------------------------

const RANK_ORDER = ['base', 'official', 'map', 'mod']

/**
 * Compose the package closure of `rootId` from `manifests` (already schema-valid UVP manifests).
 * Returns `{ layers }` — the ordered composition — or `{ refusal }`.
 *
 * The root package itself is the last layer of its own rank class: a map root composes after its
 * dependencies; its dependencies join at their declared ranks.
 */
export function composePackages(rootId, manifests, intrinsicRegistry, grantedCapabilities) {
  const byId = new Map()
  for (const manifest of manifests) {
    if (byId.has(manifest.id)) {
      return { refusal: { rule: 'duplicate-package', message: `package ${manifest.id} is provided twice` } }
    }
    byId.set(manifest.id, manifest)
  }
  const root = byId.get(rootId)
  if (root === undefined) {
    return { refusal: { rule: 'missing-package', message: `root package ${rootId} is not provided` } }
  }

  // walk the dependency closure, detect cycles, record each package's declared rank/order
  const entries = new Map() // id -> { rank, order }
  const state = new Map() // id -> 'visiting' | 'done'
  const stack = []
  const visit = id => {
    if (state.get(id) === 'done') return undefined
    if (state.get(id) === 'visiting') {
      const cycle = [...stack.slice(stack.indexOf(id)), id]
      return { rule: 'no-dependency-cycles', message: `dependency cycle: ${cycle.join(' -> ')}` }
    }
    state.set(id, 'visiting')
    stack.push(id)
    const manifest = byId.get(id)
    if (manifest === undefined) {
      return { rule: 'missing-package', message: `dependency ${id} is not provided` }
    }
    for (const dependency of manifest.dependencies ?? []) {
      const target = byId.get(dependency.id)
      if (target === undefined) {
        return { rule: 'missing-package', message: `dependency ${dependency.id} of ${id} is not provided` }
      }
      if (!satisfies(target.version, dependency.range)) {
        return {
          rule: 'version-unsatisfied',
          message: `${id} needs ${dependency.id} ${dependency.range}, provided ${target.version}`,
        }
      }
      const existing = entries.get(dependency.id)
      const declared = { rank: dependency.rank, order: dependency.order }
      if (existing !== undefined && existing.rank !== declared.rank) {
        return {
          rule: 'conflicting-rank',
          message: `${dependency.id} is declared at rank ${existing.rank} and rank ${declared.rank}`,
        }
      }
      if (
        existing !== undefined &&
        existing.order !== undefined &&
        declared.order !== undefined &&
        existing.order !== declared.order
      ) {
        return {
          rule: 'conflicting-order',
          message: `${dependency.id} is declared at order ${existing.order} and order ${declared.order}`,
        }
      }
      entries.set(dependency.id, existing ?? declared)
      const failure = visit(dependency.id)
      if (failure !== undefined) return failure
    }
    stack.pop()
    state.set(id, 'done')
    return undefined
  }
  const failure = visit(rootId)
  if (failure !== undefined) return { refusal: failure }

  // explicit order inside one rank: more than one entry sharing a rank needs distinct orders
  const byRank = new Map()
  for (const [id, entry] of entries) {
    const list = byRank.get(entry.rank) ?? []
    list.push({ id, order: entry.order })
    byRank.set(entry.rank, list)
  }
  for (const [rank, list] of byRank) {
    if (list.length < 2) continue
    const seen = new Set()
    for (const entry of list) {
      if (entry.order === undefined) {
        return {
          refusal: {
            rule: 'explicit-order-within-rank',
            message: `rank ${rank} holds ${list.map(e => e.id).join(', ')} and ${entry.id} declares no order`,
          },
        }
      }
      if (seen.has(entry.order)) {
        return {
          refusal: { rule: 'explicit-order-within-rank', message: `rank ${rank} repeats order ${entry.order}` },
        }
      }
      seen.add(entry.order)
    }
  }

  // requirements before content: every intrinsic id@version must exist in the registry
  if (intrinsicRegistry !== undefined) {
    const known = new Set(intrinsicRegistry.intrinsics.map(row => `${row.id}@${row.version}`))
    const missing = new Set()
    for (const id of [rootId, ...entries.keys()]) {
      for (const requirement of byId.get(id).requires?.intrinsics ?? []) {
        if (!known.has(requirement)) missing.add(`${requirement} (needed by ${id})`)
      }
    }
    if (missing.size > 0) {
      return {
        refusal: {
          rule: 'requirements-before-content',
          message: `unsatisfied intrinsic requirements: ${[...missing].sort().join('; ')}`,
        },
      }
    }
  }

  // capabilities before content: every requested class must be granted by the host/trust chain
  if (grantedCapabilities !== undefined) {
    const granted = new Set(grantedCapabilities)
    const denied = new Set()
    for (const id of [rootId, ...entries.keys()]) {
      for (const capability of byId.get(id).requires?.capabilities ?? []) {
        if (!granted.has(capability)) denied.add(`${capability} (requested by ${id})`)
      }
    }
    if (denied.size > 0) {
      return {
        refusal: {
          rule: 'capabilities-granted',
          message: `capabilities not granted: ${[...denied].sort().join('; ')}`,
        },
      }
    }
  }

  // the root joins the sort at its own kind's rank, after that rank's dependencies: a map root
  // composes over its map-rank dependencies but UNDER its mods — mods always win over the map.
  // A campaign root composes at the official rank (its shared rules sit under maps and mods);
  // libraries and game bases are base-rank roots.
  const rootRank =
    root.kind === 'mod' ? 'mod' : root.kind === 'map' ? 'map' : root.kind === 'campaign' ? 'official' : 'base'
  const layers = [
    ...[...entries.entries()].map(([id, entry]) => ({ id, rank: entry.rank, order: entry.order ?? 0 })),
    { id: rootId, rank: rootRank, order: Number.MAX_SAFE_INTEGER },
  ].sort(
    (a, b) =>
      RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank) ||
      a.order - b.order ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  return { layers: layers.map(({ id, rank }) => ({ id, rank })) }
}

// --- UVD resolution ------------------------------------------------------------------------------

/**
 * Resolve definitions across ordered layers.
 *
 * `layers`: ordered `{ id, documents }` where documents are schema-valid UVD documents
 * (kind-schema, definitions, overlay). Returns `{ definitions }` — a map
 * `fullId -> { kind, fields: { name: { value, provenance } } }` — or `{ refusal }`.
 * Provenance names the layer and document namespace that set the value, with
 * `via: 'parent <id>'` when inheritance supplied it.
 */
const isIntegerQuanta = value => Number.isInteger(value) || (typeof value === 'string' && /^-?\d+$/.test(value))

/** Value-against-field-spec check. Returns an error string or undefined. */
function typeError(spec, value) {
  switch (spec.type) {
    case 'bool':
      return typeof value === 'boolean' ? undefined : 'expects bool'
    case 'i64':
    case 'fixed64':
      return isIntegerQuanta(value) ? undefined : `expects ${spec.type} integer quanta`
    case 'f64':
      return typeof value === 'number' ? undefined : 'expects f64'
    case 'string':
    case 'strref':
      return typeof value === 'string' ? undefined : 'expects string'
    case 'enum':
      return spec.values.includes(value) ? undefined : `expects one of ${spec.values.join('|')}`
    case 'flags': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'expects a flag set object'
      for (const [name, on] of Object.entries(value)) {
        if (!spec.values.includes(name)) return `undeclared flag ${name}`
        if (typeof on !== 'boolean') return `flag ${name} expects bool`
      }
      return undefined
    }
    case 'ref':
      return typeof value === 'string' ? undefined : 'expects a reference id'
    case 'list': {
      if (!Array.isArray(value)) return 'expects list'
      for (const item of value) {
        const error = typeError({ ...spec, type: spec.itemType }, item)
        if (error !== undefined) return `list item ${error}`
      }
      return undefined
    }
    case 'record': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'expects record'
      for (const key of Object.keys(value)) {
        const field = spec.recordFields.find(f => f.name === key)
        if (field === undefined) return `undeclared record field ${key}`
        const error = typeError(field, value[key])
        if (error !== undefined) return `record field ${key} ${error}`
      }
      for (const field of spec.recordFields) {
        if (field.required === true && value[field.name] === undefined) return `missing required record field ${field.name}`
      }
      return undefined
    }
    default:
      return `unknown field type ${spec.type}`
  }
}

/**
 * Options:
 *   danglingReferences: 'refuse' (default) | 'diagnose' — a typed reference to a definition nobody
 *     ships refuses, or is kept with a `dangling-reference` diagnostic (what Modkit does on real
 *     catalogs, which do contain dead links);
 *   externalParents: 'refuse' (default) | 'truncate' — a parent outside the package closure refuses,
 *     or truncates the chain with a `parent-outside-closure` diagnostic (loose mods inherit from
 *     the base game).
 * Returns `{ definitions, diagnostics }` or `{ refusal }`.
 */
export function resolveDefinitions(layers, options = {}) {
  const danglingPolicy = options.danglingReferences ?? 'refuse'
  const parentPolicy = options.externalParents ?? 'refuse'
  const diagnostics = []
  const kinds = new Map() // kind -> field spec map
  const kindVersions = new Map() // kind -> declared version
  const defs = new Map() // fullId -> { kind, parent, own: Map(field -> {value, provenance}) }

  for (const layer of layers) {
    for (const document of layer.documents) {
      if (document.role === 'kind-schema') {
        for (const kind of document.kinds) {
          // a later layer redefining a kind is a named refusal, not a silent override: "a mod
          // extends a kind schema" is a real feature that needs its own amendment, not an accident
          if (kinds.has(kind.kind)) {
            return { refusal: { rule: 'duplicate-kind', message: `kind ${kind.kind} is declared twice (layer ${layer.id})` } }
          }
          const fields = new Map()
          for (const field of kind.fields) fields.set(field.name, field)
          kinds.set(kind.kind, fields)
          kindVersions.set(kind.kind, kind.version)
        }
      }
    }
  }

  const fieldSpec = (kind, name) => kinds.get(kind)?.get(name)

  for (const layer of layers) {
    for (const document of layer.documents) {
      if (document.role !== 'definitions') continue
      for (const definition of document.definitions) {
        const fullId = `${document.namespace}/${definition.kind}/${definition.name}`
        if (defs.has(fullId)) {
          if (document.upsert !== true) {
            return { refusal: { rule: 'duplicate-definition', message: `${fullId} is defined twice` } }
          }
          // upsert: the later document re-publishes the record whole; own fields are replaced.
          // (kind is part of the full id, so a kind change is a different definition, not a conflict)
        }
        if (!kinds.has(definition.kind)) {
          return { refusal: { rule: 'unknown-kind', message: `${fullId} uses undeclared kind ${definition.kind}` } }
        }
        if (definition.kindVersion !== kindVersions.get(definition.kind)) {
          return {
            refusal: {
              rule: 'kind-version-mismatch',
              message: `${fullId} targets kind ${definition.kind} version ${definition.kindVersion}, schema declares ${kindVersions.get(definition.kind)}`,
            },
          }
        }
        const own = new Map()
        for (const [name, value] of Object.entries(definition.fields)) {
          const spec = fieldSpec(definition.kind, name)
          if (spec === undefined) {
            return {
              refusal: { rule: 'fields-match-kind-schema', message: `${fullId} sets undeclared field ${name}` },
            }
          }
          const error = typeError(spec, value)
          if (error !== undefined) {
            return { refusal: { rule: 'type-mismatch', message: `${fullId}.${name} ${error}` } }
          }
          own.set(name, { value, provenance: { layer: layer.id, document: document.namespace } })
        }
        defs.set(fullId, { kind: definition.kind, parent: definition.parent, own })
      }
    }
  }

  // parent chains exist and do not cycle
  for (const [fullId, definition] of defs) {
    const seen = new Set([fullId])
    let cursor = definition.parent
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        return { refusal: { rule: 'no-parent-cycles', message: `parent cycle at ${cursor} (from ${fullId})` } }
      }
      seen.add(cursor)
      const parent = defs.get(cursor)
      if (parent === undefined) {
        if (parentPolicy === 'truncate') {
          diagnostics.push({ rule: 'parent-outside-closure', message: `${fullId} names parent ${cursor} outside the package closure; chain truncated` })
          // find the last definition in the chain that exists and cut its parent link
          let last = definition
          while (last.parent !== undefined && defs.has(last.parent)) last = defs.get(last.parent)
          last.parent = undefined
          break
        }
        return { refusal: { rule: 'missing-reference', message: `${fullId} names missing parent ${cursor}` } }
      }
      if (parent.kind !== definition.kind) {
        return { refusal: { rule: 'parent-kind-mismatch', message: `${fullId} inherits across kinds from ${cursor}` } }
      }
      cursor = parent.parent
    }
  }

  const inherited = (fullId, name) => {
    const spec = fieldSpec(defs.get(fullId).kind, name)
    if (spec?.type === 'flags') {
      // a flag set merges by name root-to-leaf; a tombstone restarts the set
      const chain = []
      for (let cursor = fullId; cursor !== undefined; cursor = defs.get(cursor).parent) chain.unshift(cursor)
      let flags = {}
      let provenance
      let seen = false
      for (const id of chain) {
        const entry = defs.get(id).own.get(name)
        if (entry === undefined) continue
        seen = true
        const via = id === fullId ? entry.provenance : { ...entry.provenance, via: `flags-chain through ${id}` }
        if (entry.removed === true) {
          flags = {}
          provenance = via
          continue
        }
        flags = { ...flags, ...entry.value }
        provenance = via
      }
      return seen ? { value: flags, provenance } : undefined
    }
    if (spec?.type === 'list' && spec.inherit === 'merge') {
      // keyed merge root-to-leaf: same key replaces, new keys append; a tombstone restarts
      const chain = []
      for (let cursor = fullId; cursor !== undefined; cursor = defs.get(cursor).parent) chain.unshift(cursor)
      let merged = []
      let provenance
      let seen = false
      for (const id of chain) {
        const entry = defs.get(id).own.get(name)
        if (entry === undefined) continue
        seen = true
        const via = id === fullId ? entry.provenance : { ...entry.provenance, via: `merge-chain through ${id}` }
        if (entry.removed === true) {
          merged = []
          provenance = via
          continue
        }
        for (const record of entry.value) {
          const index = merged.findIndex(existing => existing[spec.keyField] === record[spec.keyField])
          if (index >= 0) merged[index] = record
          else merged.push(record)
        }
        provenance = via
      }
      return seen ? { value: merged, provenance } : undefined
    }
    if (spec?.type === 'list' && spec.inherit === 'append') {
      // root-to-leaf concatenation; a tombstone in the chain restarts the list
      const chain = []
      for (let cursor = fullId; cursor !== undefined; cursor = defs.get(cursor).parent) chain.unshift(cursor)
      let list = []
      let provenance
      let seen = false
      for (const id of chain) {
        const entry = defs.get(id).own.get(name)
        if (entry === undefined) continue
        seen = true
        if (entry.removed === true) {
          list = []
          provenance = id === fullId ? entry.provenance : { ...entry.provenance, via: `parent ${id}` }
          continue
        }
        list = [...list, ...entry.value]
        provenance = id === fullId ? entry.provenance : { ...entry.provenance, via: `append-chain through ${id}` }
      }
      return seen ? { value: list, provenance } : undefined
    }
    let cursor = fullId
    while (cursor !== undefined) {
      const definition = defs.get(cursor)
      const entry = definition.own.get(name)
      if (entry !== undefined) {
        if (cursor === fullId) return entry
        // an ancestor's tombstone is inherited as absence, exactly like an ancestor's value
        return entry.removed === true
          ? { value: undefined, removed: true, provenance: { ...entry.provenance, via: `parent ${cursor}` } }
          : { value: entry.value, provenance: { ...entry.provenance, via: `parent ${cursor}` } }
      }
      cursor = definition.parent
    }
    return undefined
  }

  for (const layer of layers) {
    for (const document of layer.documents) {
      if (document.role !== 'overlay') continue
      for (const overlay of document.overlays) {
        const target = defs.get(overlay.target)
        if (target === undefined) {
          return { refusal: { rule: 'missing-reference', message: `overlay targets missing ${overlay.target}` } }
        }
        const spec = fieldSpec(target.kind, overlay.field)
        if (spec === undefined) {
          return {
            refusal: {
              rule: 'fields-match-kind-schema',
              message: `overlay sets undeclared field ${overlay.field} on ${overlay.target}`,
            },
          }
        }
        const provenance = { layer: layer.id, document: document.namespace }
        if (overlay.op === 'set') {
          const error = typeError(spec, overlay.value)
          if (error !== undefined) {
            return { refusal: { rule: 'type-mismatch', message: `overlay ${overlay.target}.${overlay.field} ${error}` } }
          }
          if (spec.type === 'flags') {
            // a partial flag object patches named flags; the own tail keeps the rest
            const own = target.own.get(overlay.field)
            const base = own === undefined || own.removed === true ? {} : own.value
            target.own.set(overlay.field, { value: { ...base, ...overlay.value }, provenance })
          } else {
            target.own.set(overlay.field, { value: overlay.value, provenance })
          }
        } else if (overlay.op === 'remove') {
          if (spec.required === true) {
            return {
              refusal: {
                rule: 'required-fields-survive-overlays',
                message: `overlay removes required field ${overlay.field} from ${overlay.target}`,
              },
            }
          }
          target.own.set(overlay.field, { value: undefined, removed: true, provenance })
        } else if (overlay.op === 'append') {
          if (spec.type !== 'list') {
            return {
              refusal: { rule: 'append-to-non-list', message: `overlay appends to non-list field ${overlay.field} on ${overlay.target}` },
            }
          }
          const itemError = typeError({ ...spec, type: spec.itemType }, overlay.value)
          if (itemError !== undefined) {
            return { refusal: { rule: 'type-mismatch', message: `overlay append ${overlay.target}.${overlay.field} list item ${itemError}` } }
          }
          // append-inherited lists own only their own tail: appending to the effective chain
          // would count the ancestors twice on the next resolution
          const base = spec.inherit === 'append' || spec.inherit === 'merge' ? target.own.get(overlay.field) : inherited(overlay.target, overlay.field)
          const list = base === undefined || base.removed === true ? [] : [...base.value]
          if (spec.inherit === 'merge') {
            // upsert by key inside the own tail; the chain merge applies the same rule upward
            const index = list.findIndex(existing => existing[spec.keyField] === overlay.value[spec.keyField])
            if (index >= 0) list[index] = overlay.value
            else list.push(overlay.value)
          } else {
            list.push(overlay.value)
          }
          target.own.set(overlay.field, { value: list, provenance })
        }
      }
    }
  }

  // Walk the declared UVD shape so nested records use the same identity and reference rules
  // as top-level fields. This is also the route for composite slot/part references.
  const bindSelf = (spec, value, localName) => {
    if (spec.type === 'string' || spec.type === 'strref' || spec.type === 'ref')
      return value.replaceAll('${self}', localName)
    if (spec.type === 'list')
      return value.map(item => bindSelf({ ...spec, type: spec.itemType }, item, localName))
    if (spec.type === 'record')
      return Object.fromEntries(Object.entries(value).map(([name, item]) => {
        const field = spec.recordFields.find(candidate => candidate.name === name)
        return [name, bindSelf(field, item, localName)]
      }))
    return value
  }
  const definitions = new Map()
  for (const [fullId, definition] of defs) {
    const localName = fullId.slice(fullId.lastIndexOf('/') + 1)
    const fields = {}
    for (const name of kinds.get(definition.kind).keys()) {
      const entry = inherited(fullId, name)
      if (entry === undefined || entry.removed === true) continue
      const spec = fieldSpec(definition.kind, name)
      const value = bindSelf(spec, entry.value, localName)
      fields[name] = { value, provenance: entry.provenance }
    }
    definitions.set(fullId, { kind: definition.kind, fields })
  }
  const checkRef = (fullId, name, target, refKind) => {
    if (defs.has(target)) {
      // a polymorphic reference names a closed set of kinds; the target must be one of them
      const kinds = Array.isArray(refKind) ? refKind : [refKind]
      if (refKind !== undefined && !kinds.includes(defs.get(target).kind)) {
        return { refusal: { rule: 'reference-kind-mismatch', message: fullId + '.' + name + ' names ' + target + ' of kind ' + defs.get(target).kind + ', expects ' + kinds.join('|') } }
      }
      return undefined
    }
    if (danglingPolicy === 'diagnose') {
      diagnostics.push({ rule: 'dangling-reference', message: `${fullId}.${name} names missing ${target}` })
      return undefined
    }
    return { refusal: { rule: 'missing-reference', message: `${fullId}.${name} names missing ${target}` } }
  }
  const checkValueRefs = (fullId, name, spec, value) => {
    if (spec.type === 'ref') return checkRef(fullId, name, value, spec.refKind)
    if (spec.type === 'list') {
      for (const [index, item] of value.entries()) {
        const failure = checkValueRefs(fullId, `${name}[${index}]`, { ...spec, type: spec.itemType }, item)
        if (failure !== undefined) return failure
      }
    } else if (spec.type === 'record') {
      for (const field of spec.recordFields) {
        if (value[field.name] === undefined) continue
        const failure = checkValueRefs(fullId, `${name}.${field.name}`, field, value[field.name])
        if (failure !== undefined) return failure
      }
    }
    return undefined
  }
  for (const [fullId, definition] of definitions) {
    for (const [name, entry] of Object.entries(definition.fields)) {
      const failure = checkValueRefs(fullId, name, fieldSpec(definition.kind, name), entry.value)
      if (failure !== undefined) return failure
    }
  }
  // Runtime meaning is declared by the same UVD kind-schema as every other field. Keep the
  // normalized views next to the resolved definitions; binders must not invent another catalog.
  const roleShapes = new Map([
    ['assembly.slots@1', [
      ['id', 'string'], ['capacity', 'i64'], ['accepts', 'list', 'ref'],
    ]],
    ['assembly.initial-parts@1', [
      ['id', 'string'], ['slot', 'string'], ['definition', 'ref'],
    ]],
    ['assembly.stat-effects@1', [
      ['id', 'string'], ['field', 'string'], ['delta', 'fixed64'],
    ]],
    ['assembly.grants@1', [
      ['id', 'string'], ['capability', 'ref'],
    ]],
    ['capability.counters@1', [
      ['id', 'string'], ['initial', 'i64'], ['minimum', 'i64'], ['maximum', 'i64'],
    ]],
  ])
  const roleFields = new Map()
  for (const [kind, fields] of kinds) {
    const roles = new Map()
    for (const spec of fields.values()) {
      if (spec.runtimeRole === undefined) continue
      if (spec.runtimeRole === 'movement.class@1' || spec.runtimeRole === 'movement.speed@1') {
        const valid = spec.runtimeRole === 'movement.class@1'
          ? spec.type === 'string'
          : spec.type === 'fixed64' && spec.unit === 'space-unit-per-tick'
        if (!valid || roles.has(spec.runtimeRole) || spec.presentation === true)
          return { refusal: { rule: 'movement-schema', message: `${kind}.${spec.name} has an invalid ${spec.runtimeRole} shape` } }
        roles.set(spec.runtimeRole, spec.name)
        continue
      }
      const shape = roleShapes.get(spec.runtimeRole)
      if (shape === undefined || roles.has(spec.runtimeRole)
        || spec.presentation === true || spec.type !== 'list' || spec.itemType !== 'record'
        || !Array.isArray(spec.recordFields) || spec.recordFields.length !== shape.length
        || shape.some(([name, type, itemType]) => {
          const child = spec.recordFields.find(field => field.name === name)
          return child?.type !== type || child.required !== true
            || (itemType !== undefined && child.itemType !== itemType)
            || ((type === 'ref' || itemType === 'ref') && child.refKind === undefined)
        }))
        return { refusal: { rule: 'assembly-schema', message: `${kind}.${spec.name} has an invalid ${spec.runtimeRole} shape` } }
      roles.set(spec.runtimeRole, spec.name)
    }
    if (roles.has('assembly.initial-parts@1') && !roles.has('assembly.slots@1'))
      return { refusal: { rule: 'assembly-schema', message: `${kind} declares initial parts without slots` } }
    if (roles.has('movement.class@1') !== roles.has('movement.speed@1'))
      return { refusal: { rule: 'movement-schema', message: `${kind} must declare movement class and speed together` } }
    roleFields.set(kind, roles)
  }
  const idEncoder = new TextEncoder()
  const stableId = value => typeof value === 'string' && value.length > 0
    && idEncoder.encode(value).length <= 128 && !value.includes('\0')
  const exactI64 = value => ((typeof value === 'number' && Number.isSafeInteger(value))
    || (typeof value === 'string' && /^-?\d+$/.test(value)))
    && BigInt(value) >= -(1n << 63n) && BigInt(value) <= (1n << 63n) - 1n
  const movements = new Map()
  for (const [fullId, definition] of definitions) {
    const roles = roleFields.get(definition.kind)
    const classField = roles.get('movement.class@1')
    if (classField === undefined) continue
    const speedField = roles.get('movement.speed@1')
    const classId = definition.fields[classField]?.value
    const speed = definition.fields[speedField]?.value
    if (classId === undefined && speed === undefined) continue
    if (!stableId(classId) || !exactI64(speed) || BigInt(speed) <= 0n)
      return { refusal: { rule: 'movement-profile', message: `${fullId} requires a valid traversal class and positive fixed64 speed` } }
    movements.set(fullId, { classId, speedField })
  }
  const capabilityCounters = new Map()
  for (const [fullId, definition] of definitions) {
    const role = roleFields.get(definition.kind).get('capability.counters@1')
    if (role === undefined) continue
    const counters = definition.fields[role]?.value ?? []
    if (counters.length > 4096)
      return { refusal: { rule: 'assembly-budget', message: `${fullId} exceeds 4096 capability counters` } }
    const ids = new Set()
    for (const counter of counters) {
      if (!stableId(counter.id) || ids.has(counter.id))
        return { refusal: { rule: 'capability-counter-id', message: `${fullId} repeats or invalidates counter ${counter.id}` } }
      ids.add(counter.id)
      if (![counter.initial, counter.minimum, counter.maximum].every(exactI64)
        || BigInt(counter.minimum) > BigInt(counter.initial)
        || BigInt(counter.initial) > BigInt(counter.maximum))
        return { refusal: { rule: 'capability-counter-range', message: `${fullId}.${counter.id} has an invalid initial/range` } }
    }
    capabilityCounters.set(fullId, counters)
  }
  const partGrants = new Map()
  for (const [fullId, definition] of definitions) {
    const role = roleFields.get(definition.kind).get('assembly.grants@1')
    if (role === undefined) continue
    const grants = definition.fields[role]?.value ?? []
    if (grants.length > 4096)
      return { refusal: { rule: 'assembly-budget', message: `${fullId} exceeds 4096 capability grants` } }
    const ids = new Set()
    for (const grant of grants) {
      if (!stableId(grant.id) || ids.has(grant.id))
        return { refusal: { rule: 'assembly-grant-id', message: `${fullId} repeats or invalidates grant ${grant.id}` } }
      ids.add(grant.id)
      if (!definitions.has(grant.capability))
        return { refusal: { rule: 'assembly-grant-reference', message: `${fullId}.${grant.id} names absent capability ${grant.capability}` } }
    }
    partGrants.set(fullId, grants)
  }
  const partEffects = new Map()
  for (const [fullId, definition] of definitions) {
    const role = roleFields.get(definition.kind).get('assembly.stat-effects@1')
    if (role === undefined) continue
    const effects = definition.fields[role]?.value ?? []
    if (effects.length > 4096)
      return { refusal: { rule: 'assembly-budget', message: `${fullId} exceeds 4096 part effects` } }
    const ids = new Set()
    for (const effect of effects) {
      if (!stableId(effect.id) || ids.has(effect.id) || !stableId(effect.field))
        return { refusal: { rule: 'assembly-effect-id', message: `${fullId} repeats or invalidates effect ${effect.id}` } }
      ids.add(effect.id)
      if (!((typeof effect.delta === 'number' && Number.isSafeInteger(effect.delta))
        || (typeof effect.delta === 'string' && /^-?\d+$/.test(effect.delta)))
        || BigInt(effect.delta) < -(1n << 63n) || BigInt(effect.delta) > (1n << 63n) - 1n)
        return { refusal: { rule: 'assembly-effect-delta', message: `${fullId}.${effect.id} is not fixed64` } }
    }
    partEffects.set(fullId, effects)
  }
  const assemblies = new Map()
  for (const [fullId, definition] of definitions) {
    const roles = roleFields.get(definition.kind)
    const slotsField = roles.get('assembly.slots@1')
    if (slotsField === undefined) continue
    const slots = definition.fields[slotsField]?.value ?? []
    const parts = definition.fields[roles.get('assembly.initial-parts@1')]?.value ?? []
    if (slots.length > 4096 || parts.length > 4096)
      return { refusal: { rule: 'assembly-budget', message: `${fullId} exceeds 4096 slots or initial parts` } }
    const bySlot = new Map(), partIds = new Set(), occupancy = new Map()
    for (const slot of slots) {
      const capacity = slot.capacity
      if (!stableId(slot.id) || bySlot.has(slot.id))
        return { refusal: { rule: 'assembly-duplicate-slot', message: `${fullId} repeats or invalidates slot ${slot.id}` } }
      if (!((typeof capacity === 'number' && Number.isSafeInteger(capacity))
        || (typeof capacity === 'string' && /^\d+$/.test(capacity)))
        || BigInt(capacity) > 4096n || BigInt(capacity) < 0n || slot.accepts.length > 4096
        || new Set(slot.accepts).size !== slot.accepts.length)
        return { refusal: { rule: 'assembly-capacity', message: `${fullId}.${slot.id} has invalid capacity or accepted parts` } }
      if (slot.accepts.some(address => !definitions.has(address)))
        return { refusal: { rule: 'assembly-dangling-part', message: `${fullId}.${slot.id} accepts an absent definition` } }
      for (const address of slot.accepts) {
        for (const effect of partEffects.get(address) ?? []) {
          if (fieldSpec(definition.kind, effect.field)?.type !== 'fixed64'
            || definition.fields[effect.field] === undefined)
            return { refusal: { rule: 'assembly-effect-target', message: `${fullId}.${slot.id} cannot apply ${address}.${effect.id} to ${effect.field}` } }
        }
      }
      bySlot.set(slot.id, slot)
    }
    for (const part of parts) {
      if (!stableId(part.id) || partIds.has(part.id))
        return { refusal: { rule: 'assembly-duplicate-part', message: `${fullId} repeats or invalidates part ${part.id}` } }
      partIds.add(part.id)
      const slot = bySlot.get(part.slot)
      if (slot === undefined)
        return { refusal: { rule: 'assembly-slot-unknown', message: `${fullId}.${part.id} names absent slot ${part.slot}` } }
      if (!definitions.has(part.definition) || !slot.accepts.includes(part.definition))
        return { refusal: { rule: 'assembly-incompatible-part', message: `${fullId}.${part.id} cannot install ${part.definition} in ${part.slot}` } }
      const count = (occupancy.get(part.slot) ?? 0) + 1
      if (BigInt(count) > BigInt(slot.capacity))
        return { refusal: { rule: 'assembly-capacity', message: `${fullId}.${part.slot} exceeds capacity` } }
      occupancy.set(part.slot, count)
    }
    assemblies.set(fullId, { slots, initialParts: parts })
  }
  return { definitions, diagnostics, assemblies, partEffects, partGrants, capabilityCounters, movements }
}
