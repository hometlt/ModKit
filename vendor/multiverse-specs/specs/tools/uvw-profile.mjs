/**
 * Reference implementation of the admitted UVW spatial cross-field rules.
 *
 * Normative text: ../world/SPEC_UVW.md, SPEC_UVW_PROFILE.md and SPEC_UVW_GLTF.md.
 * The JSON Schema says what shape a document has; this module
 * says the handful of things a schema cannot express: that a heightfield's sample grid matches the
 * dimensions it declares, that its extent fits the bounds the document states, that layer ids are
 * unique, and that the canonical layer order is the one on disk.
 *
 * Each rule is refused rather than repaired, for the same reason as UVT: padding a short sample row
 * silently produces different terrain, and re-sorting layers on read hides a converter that emits
 * them unordered — a document that round-trips only because the reader fixed it is not portable.
 *
 * Legacy candidate/profile and the opt-in glTF envelope share these geometry rules.
 * Passing them does not prove game-specific pathing parity or renderer support.
 *
 * Dependency-free by design: Node built-ins only.
 */

import { uvwDocumentGraph, uvwGltfGraph, UVW_GLTF_EXTENSION, UVW_GLTF_MARKER } from './uvw-gltf.mjs'
import { projectUvwMaterial } from './uvw-materials.mjs'
import { jcsStringify } from './uv-canonical-form.mjs'
import { assertUvpArtifactPath, resolveUvpResourceUri } from './uvp-resource-paths.mjs'
import { assertTerrainAtlas, assertDerivedCliffObject } from './uvw-terrain-atlas.ts'
import { assertUnlitLighting } from './uvw-unlit.ts'
import { assertUvwObjectPresentation, assertUvwCamera } from './uvm-presentation.ts'
import { assertUvwPlayers } from './uvw-players.ts'
import { assertUvwLattice } from './uvw-lattice.ts'

/** One violated rule, named by the id the vectors use. */
export class UvwRuleError extends TypeError {
  constructor(rule, message) {
    super(message)
    this.name = 'UvwRuleError'
    this.rule = rule
  }
}

const refuse = (rule, message) => {
  throw new UvwRuleError(rule, message)
}

const EPSILON = 1e-9

/**
 * Check every cross-field rule of the profile. Returns the document on success.
 *
 * Ordered deliberately: identity and ordering first, then per-layer geometry. A converter that got
 * the layer set wrong should hear that before it hears about a sample count.
 */
export function assertUvwProfile(document) {
  const source = document
  document = uvwDocumentGraph(document)
  if (source === document && document?.uv?.format !== 'UVW') {
    refuse('document-shape', 'a UVW document must carry uv.format "UVW"')
  }
  if (Array.isArray(document.spaces)) {
    if (document.spaces.length === 0 || !Array.isArray(document.connections)) {
      refuse('document-shape', 'a UVW profile must carry spaces and connections')
    }
    if (document.connections.length !== 0) {
      refuse('connections-reserved', 'UVW profile 1 reserves connections at zero entries')
    }
    const ids = document.spaces.map(space => space?.id)
    if (new Set(ids).size !== ids.length) {
      refuse('space-id-unique', 'space ids must be unique')
    }
    const sorted = [...ids].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    if (ids.join('\0') !== sorted.join('\0')) {
      refuse('space-order-canonical', 'spaces must be ordered by id in UTF-8 byte order')
    }
    for (const space of document.spaces) {
      if (space?.topology !== 'heightfield') {
        refuse('topology-not-admitted', 'UVW profile 1 admits only heightfield spaces')
      }
      assertUvwBody(space, true, source === document ? undefined : source)
    }
    assertUvwLattice(document.spaces, source === document ? document.uv?.version : '1.0')
    return source
  }
  assertUvwBody(document, false)
  assertUvwLattice([document], document.uv?.version)
  return source
}

/** Explicit migration of schema-valid profile v1. Geometry remains exact; materials need policy. */
export function createUvwGltfDocument(document, { materialPolicies = [] } = {}) {
  return buildUvwGltf(document, { materialPolicies }).document
}

/** Prepare a complete, deterministic resource mapping before package byte verification.
 * The result is not a publication receipt: the UVP compositor must close every artifact.
 */
export function prepareUvwGltfMigration(document, options) {
  return buildUvwGltf(document, { ...options, preserveSource: true })
}

function buildUvwGltf(document, { materialPolicies = [], resourceMappings = [],
  rasterPolicies = [], sourcePath, targetPath, preserveSource = false } = {}) {
  if (document?.uv?.format !== 'UVW' || document.uv.version !== '1.0' || document.uv.status !== 'profile'
    || Object.keys(document.uv).some(key => !['format', 'version', 'status'].includes(key))
    || Object.keys(document).some(key => !['uv', 'spaces', 'connections', '$comment'].includes(key))
    || !Array.isArray(document.spaces))
    refuse('uvw-gltf-source', 'Migration requires an unmixed UVW spatial profile 1.0 document')
  try { jcsStringify(document) }
  catch { refuse('uvw-gltf-source', 'Migration requires a finite plain JSON source document') }
  assertUvwProfile(document)
  // Work on one private snapshot: source arrays and material records remain untouched on refusal.
  const spaces = structuredClone(document.spaces)
  if (!preserveSource && spaces.some(space => space.layers.some(layer => layer.weightRasters !== undefined)))
    refuse('uvw-gltf-layer', 'Raster weights require addressed resource and sampling policy migration')
  const resourceResult = preserveSource
    ? migrateResources(spaces, resourceMappings, sourcePath, targetPath)
    : { images: [], textures: [], samplers: [], bindingsBySpace: new Map(), countsBySpace: new Map(), inventory: [] }
  const materialResult = migrateMaterials(spaces, materialPolicies, resourceResult,
    preserveSource)
  const rasterResult = preserveSource ? migrateRasters(spaces, rasterPolicies) : []
  const visualKinds = new Set(['cliffs', 'objects', 'regions', 'gateways', 'lighting'])
  const visualLayers = spaces.flatMap((space, spaceIndex) => space.layers.flatMap((layer, layerIndex) =>
    visualKinds.has(layer.kind) ? [{ spaceId: space.id, layerId: layer.id, kind: layer.kind,
      sourcePointer: `/spaces/${spaceIndex}/layers/${layerIndex}` }] : []))
  const result = {
    asset: { version: '2.0', extras: { uv: { ...UVW_GLTF_MARKER } } },
    extensionsUsed: [UVW_GLTF_EXTENSION, ...materialResult.extensionsUsed].sort(),
    extensionsRequired: [UVW_GLTF_EXTENSION],
    extensions: { [UVW_GLTF_EXTENSION]: { schemaVersion: 1,
      spaces, connections: structuredClone(document.connections) } },
    ...(materialResult.materials.length ? { materials: materialResult.materials } : {}),
    ...(resourceResult.images.length ? { images: resourceResult.images } : {}),
    ...(resourceResult.textures.length ? { textures: resourceResult.textures } : {}),
    ...(resourceResult.samplers.length ? { samplers: resourceResult.samplers } : {}),
    ...(document.$comment === undefined ? {} : { extras: { sourceComment: document.$comment } }),
  }
  uvwGltfGraph(result)
  try { jcsStringify(result) }
  catch { refuse('uvw-gltf-result', 'Migration produced a non-JSON target') }
  return { document: result, inventory: resourceResult.inventory,
    materials: materialResult.mapping, rasters: rasterResult, visualLayers,
    scope: materialResult.partial || rasterResult.length || visualLayers.length ? 'preview' : 'prepared' }
}

function migrateRasters(spaces, policies) {
  if (!Array.isArray(policies)) refuse('uvw-gltf-raster-policy', 'Expected addressed raster policies')
  const address = (space, layer) => JSON.stringify([space, layer])
  const plans = new Map()
  for (const row of policies) {
    if (!row || typeof row.spaceId !== 'string' || typeof row.layerId !== 'string'
      || !row.sampling || Object.keys(row).some(key =>
        !['spaceId', 'layerId', 'sampling', 'inlinePreview'].includes(key)))
      refuse('uvw-gltf-raster-policy', 'Each policy must address one raster layer')
    const key = address(row.spaceId, row.layerId)
    if (plans.has(key)) refuse('uvw-gltf-raster-policy', `Duplicate policy ${key}`)
    plans.set(key, row)
  }
  const result = []
  for (const [spaceIndex, space] of spaces.entries()) for (const [layerIndex, layer] of space.layers.entries()) {
    if (layer.kind !== 'terrain-materials' || layer.weightRasters === undefined) continue
    const key = address(space.id, layer.id), plan = plans.get(key)
    if (!plan) refuse('uvw-gltf-raster-policy', `Missing sampling policy ${key}`)
    plans.delete(key)
    const { sampling, inlinePreview } = plan
    try { jcsStringify(plan) }
    catch { refuse('uvw-gltf-raster-policy', `Non-JSON sampling policy ${key}`) }
    if (layer.samples !== undefined) {
      if (!inlinePreview || Object.keys(inlinePreview).sort().join(',') !== 'maxAbsError,role'
        || inlinePreview.role !== 'assert-equivalent-preview'
        || !Number.isFinite(inlinePreview.maxAbsError)
        || inlinePreview.maxAbsError < 0 || inlinePreview.maxAbsError > 1 / 255
        || !Array.isArray(layer.samples) || layer.samples.length !== layer.rows
        || layer.samples.some(row => !Array.isArray(row) || row.length !== layer.columns
          || row.some(sample => !sample || Object.keys(sample).join(',') !== 'weights')))
        refuse('uvw-gltf-raster-authoring', 'Mixed inline/raster authorship needs a pure-weight preview equivalence policy')
      delete layer.samples
    } else if (inlinePreview !== undefined) {
      refuse('uvw-gltf-raster-authoring', 'Inline preview policy targets a source without inline samples')
    }
    layer.weightAuthoring = 'raster'
    layer.rasterSampling = structuredClone(sampling)
    result.push({ spaceId: space.id, layerId: layer.id,
      sourcePointer: `/spaces/${spaceIndex}/layers/${layerIndex}`, sampling: structuredClone(sampling),
      ...(inlinePreview === undefined ? {} : { inlinePreview: {
        role: inlinePreview.role, maxAbsError: inlinePreview.maxAbsError,
        sourcePointer: `/spaces/${spaceIndex}/layers/${layerIndex}/samples` } }) })
  }
  if (plans.size) refuse('uvw-gltf-raster-policy', 'A raster policy targets a missing layer')
  return result
}

function migrateResources(spaces, mappings, sourcePath, targetPath) {
  if (!Array.isArray(mappings)) refuse('uvw-gltf-resource-mapping', 'Expected addressed resource mappings')
  const address = (space, layer, id) => JSON.stringify([space, layer, id])
  const plans = new Map()
  for (const row of mappings) {
    if (!row || !['spaceId', 'layerId', 'resourceId'].every(key => typeof row[key] === 'string')
      || !Array.isArray(row.outputs)
      || Object.keys(row).some(key => !['spaceId', 'layerId', 'resourceId', 'originalPath', 'outputs'].includes(key)))
      refuse('uvw-gltf-resource-mapping', 'Each resource mapping needs one exact address and outputs')
    const key = address(row.spaceId, row.layerId, row.resourceId)
    if (plans.has(key)) refuse('uvw-gltf-resource-mapping', `Duplicate resource mapping ${key}`)
    plans.set(key, row)
  }
  const images = [], textures = [], samplers = [], inventory = [], bindingsBySpace = new Map(), countsBySpace = new Map()
  for (const space of spaces) for (const layer of space.layers) {
    if (layer.kind !== 'resources') continue
    if (sourcePath === undefined || targetPath === undefined)
      refuse('uvw-gltf-resource-mapping', 'Source and target package document paths are required')
    assertUvpArtifactPath(sourcePath); assertUvpArtifactPath(targetPath)
    if (!Array.isArray(layer.resources)) refuse('uvw-gltf-resource-mapping', 'Expected a resource inventory')
    const migrated = []
    for (const resource of layer.resources) {
      if (!resource || Object.keys(resource).some(key => !['id', 'kind', 'uri', 'digest'].includes(key))
        || !['media', 'uvm'].includes(resource.kind) || typeof resource.id !== 'string'
        || typeof resource.uri !== 'string'
        || (resource.digest !== undefined && !/^sha256:[0-9a-f]{64}$/.test(resource.digest)))
        refuse('uvw-gltf-resource-mapping', `Invalid original resource in ${layer.id}`)
      const counts = countsBySpace.get(space.id) ?? new Map()
      counts.set(resource.id, (counts.get(resource.id) ?? 0) + 1)
      countsBySpace.set(space.id, counts)
      const key = address(space.id, layer.id, resource.id), plan = plans.get(key)
      if (!plan) refuse('uvw-gltf-resource-mapping', `Missing resource mapping ${key}`)
      plans.delete(key)
      const originalPath = resolveUvpResourceUri(sourcePath, resource.uri)
      const targetOriginalPath = plan.originalPath ?? originalPath
      assertUvpArtifactPath(targetOriginalPath)
      const outputs = [], outputInventory = []
      if (plan.outputs.some(output => !output || typeof output.usage !== 'string'))
        refuse('uvw-gltf-resource-mapping', `Invalid output for ${key}`)
      for (const output of [...plan.outputs].sort((a, b) => a.usage < b.usage ? -1 : a.usage > b.usage ? 1 : 0)) {
        if (!output || Object.keys(output).some(key => !['usage', 'uri', 'mimeType', 'sampler', 'encoding'].includes(key))
          || typeof output.usage !== 'string' || !/^[a-z][a-z0-9-]*$/.test(output.usage)
          || typeof output.uri !== 'string')
          refuse('uvw-gltf-resource-mapping', `Invalid output for ${key}`)
        const path = resolveUvpResourceUri(targetPath, output.uri)
        if (output.encoding === 'rgba8-unorm') {
          if (output.usage !== 'weight-rgba8' || output.mimeType !== undefined
            || output.sampler !== undefined)
            refuse('uvw-gltf-resource-mapping', `Invalid raw weight output for ${key}`)
          outputs.push({ usage: output.usage, path, encoding: output.encoding })
          outputInventory.push({ usage: output.usage, family: 'media', path, encoding: output.encoding })
          continue
        }
        if (output.encoding !== undefined || output.usage === 'weight-rgba8'
          || !['image/png', 'image/jpeg'].includes(output.mimeType))
          refuse('uvw-gltf-resource-mapping', `Invalid image output for ${key}`)
        const image = images.push({ uri: output.uri, mimeType: output.mimeType }) - 1
        let sampler
        if (output.sampler !== undefined) {
          if (output.sampler === null || typeof output.sampler !== 'object' || Array.isArray(output.sampler))
            refuse('uvw-gltf-resource-mapping', `Invalid sampler for ${key}`)
          sampler = samplers.push(structuredClone(output.sampler)) - 1
        }
        const texture = textures.push({ source: image, ...(sampler === undefined ? {} : { sampler }) }) - 1
        outputs.push({ usage: output.usage, texture })
        outputInventory.push({ usage: output.usage, family: 'media', path, texture })
        const bindings = bindingsBySpace.get(space.id) ?? []
        bindings.push({ resourceId: resource.id, usage: output.usage, index: texture })
        bindingsBySpace.set(space.id, bindings)
      }
      migrated.push({ id: resource.id, original: { family: resource.kind, path: targetOriginalPath }, outputs })
      inventory.push({ source: { spaceId: space.id, layerId: layer.id, resourceId: resource.id },
        sourceUri: resource.uri, ...(resource.digest === undefined ? {} : { sourceDigest: resource.digest }),
        original: { family: resource.kind, path: targetOriginalPath }, outputs: outputInventory })
    }
    layer.resources = migrated
  }
  if (plans.size) refuse('uvw-gltf-resource-mapping', 'A resource mapping targets a missing resource')
  return { images, textures, samplers, bindingsBySpace, countsBySpace, inventory }
}

function migrateMaterials(spaces, policies, resources, preserveSource) {
  if (!Array.isArray(policies)) refuse('uvw-gltf-material-policy', 'Expected material policies by space/layer/material ID')
  const remaining = new Map()
  const address = (space, layer, material) => JSON.stringify([space, layer, material])
  for (const row of policies) {
    if (!row || ![row.spaceId, row.layerId, row.materialId].every(value => typeof value === 'string')
      || Object.keys(row).some(key => !['spaceId', 'layerId', 'materialId', 'policy'].includes(key)))
      refuse('uvw-gltf-material-policy', 'Each policy must address one material')
    const key = address(row.spaceId, row.layerId, row.materialId)
    if (remaining.has(key)) refuse('uvw-gltf-material-policy', `Duplicate policy ${key}`)
    remaining.set(key, row.policy)
  }
  const materials = [], mapping = [], extensionsUsed = new Set()
  for (const [spaceIndex, space] of spaces.entries()) for (const [layerIndex, layer] of space.layers.entries()) {
    if (!['terrain-materials', 'water'].includes(layer.kind)) continue
    const kind = layer.kind === 'water' ? 'water' : 'terrain'
    const metadata = kind === 'water' ? ['classification', 'shorelineMode'] : ['classification', 'sourceIndex', 'atlas']
    const allowed = ['id', 'label', kind === 'water' ? 'color' : 'baseColorFactor', ...metadata]
    for (let i = 0; i < (layer.materials?.length ?? 0); i++) {
      const source = layer.materials[i]
      if (!preserveSource && Object.keys(source).some(key => !allowed.includes(key)))
        refuse('uvw-gltf-material-source', `Material ${source.id} needs texture or water-effect admission; no fields were dropped`)
      const key = address(space.id, layer.id, source.id)
      if (!remaining.has(key)) refuse('uvw-gltf-material-policy', `Missing policy ${key}`)
      const policy = remaining.get(key); remaining.delete(key)
      if (policy === null || typeof policy !== 'object' || Array.isArray(policy)
        || Object.keys(policy).some(field => !['metallicFactor', 'roughnessFactor', 'alphaMode',
          'alphaCutoff', 'doubleSided', 'waterColorSpace', 'sourceUvPivot', 'specularEncoding',
          'allowPartial', 'waterSurfaceProfile', 'waterSurfaceBlend'].includes(field)))
        refuse('uvw-gltf-material-policy', `Unsupported policy for ${key}`)
      try { jcsStringify(policy) }
      catch { refuse('uvw-gltf-material-policy', `Non-JSON policy for ${key}`) }
      // Classification and clipping stay in the world reference; the common projector owns color/PBR.
      const input = Object.fromEntries(Object.entries(source).filter(([key]) => !metadata.includes(key)))
      if (preserveSource) for (const [field, value] of Object.entries(source)) {
        const ids = field === 'causticsFrameResourceIds' ? value
          : field.endsWith('ResourceId') ? [value] : []
        if (!Array.isArray(ids) || ids.some(id => resources.countsBySpace.get(space.id)?.get(id) !== 1))
          refuse('uvw-gltf-resource-reference', `Material ${source.id}/${field} needs unique resources in ${space.id}`)
      }
      const projected = projectUvwMaterial(kind, input, policy,
        { bindings: resources.bindingsBySpace.get(space.id) ?? [],
          gltf: { images: resources.images, textures: resources.textures, samplers: resources.samplers } })
      // A successful material preview is not a complete world migration. In particular,
      // nonlinear sRGB conversion retains the exact source color in the projector.
      const unaccounted = Object.keys(projected.retained).filter(key => !['id', 'label'].includes(key))
      if (!preserveSource && (projected.fidelity !== 'material' || unaccounted.length))
        refuse('uvw-gltf-material-retained', `Material ${source.id} needs preservation of: ${unaccounted.join(', ')}`)
      layer.materials[i] = { id: source.id, material: materials.length,
        ...Object.fromEntries(metadata.filter(key => source[key] !== undefined).map(key => [key, source[key]])) }
      materials.push(projected.material)
      for (const extension of projected.extensionsUsed) if (extension !== UVW_GLTF_EXTENSION)
        extensionsUsed.add(extension)
      mapping.push({ source: { spaceId: space.id, layerId: layer.id, materialId: source.id },
        sourcePointer: `/spaces/${spaceIndex}/layers/${layerIndex}/materials/${i}`,
        targetMaterial: materials.length - 1, policy: structuredClone(policy),
        retained: unaccounted.map(field => ({
          sourcePointer: `/spaces/${spaceIndex}/layers/${layerIndex}/materials/${i}/${field}`,
          value: structuredClone(projected.retained[field]),
        })),
        fidelity: projected.fidelity })
    }
  }
  if (remaining.size) refuse('uvw-gltf-material-policy', 'A policy targets a missing material')
  return { materials, mapping, extensionsUsed: [...extensionsUsed],
    partial: mapping.some(row => row.fidelity !== 'material') }
}

/** Rebuild the legacy profile without deriving spatial facts from presentation floats. */
export function restoreUvwProfileDocument(document) {
  const graph = uvwGltfGraph(document)
  assertUvwProfile(document)
  if (['materials', 'images', 'textures', 'samplers'].some(key => document[key] !== undefined))
    refuse('uvw-gltf-restore-material', 'Legacy UVW cannot express all glTF material semantics; use an explicit reverse conversion')
  return structuredClone({ uv: { format: 'UVW', version: '1.0', status: 'profile' },
    spaces: graph.spaces, connections: graph.connections,
    ...(document.extras === undefined ? {} : { $comment: document.extras.sourceComment }),
  })
}

function assertUvwBody(document, profile, gltf) {
  if (!profile && (Object.hasOwn(document, 'players') || Object.hasOwn(document, 'startPositions')))
    refuse('uvw-players-profile-only', 'player tables and starts require the spatial profile envelope')
  assertUvwPlayers(document)
  if (!profile && Object.hasOwn(document, 'camera'))
    refuse('uvw-camera-profile-only', 'game-view presets require the spatial profile envelope')
  assertUvwCamera(document.camera)
  const layers = document.layers
  if (!Array.isArray(layers) || layers.length === 0) {
    refuse('document-shape', 'a UVW document must carry at least one layer')
  }

  const ids = layers.map(layer => layer.id)
  const unique = new Set(ids)
  if (unique.size !== ids.length) {
    refuse(
      'layer-id-unique',
      'layer ids must be unique: a layer is identified by its id across pages, so two layers sharing one make paging ambiguous',
    )
  }
  const sorted = [...ids].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  if (ids.join('\0') !== sorted.join('\0')) {
    refuse(
      'layer-order-canonical',
      `layers must be ordered by id in UTF-8 byte order; found ${ids.join(', ')}`,
    )
  }

  const basis = document.basis
  if (basis?.unit === 'source-unit' && basis.metersPerUnit !== undefined) {
    refuse(
      'no-invented-scale',
      'unit "source-unit" means no metre factor was known; stating metersPerUnit anyway asserts a measurement nobody made',
    )
  }

  const traversalClasses = new Set()
  for (const layer of layers) {
    if (layer.kind === 'heightfield') assertHeightfield(layer, document.bounds)
    if (layer.kind === 'cliffs') assertCliffs(layer, document.bounds)
    if (layer.kind === 'objects') assertObjects(layer, layers)
    if (layer.kind === 'terrain-materials') assertTerrainAtlas(layer, gltf)
    if (layer.kind === 'regions') assertRegions(layer)
    if (layer.kind === 'gateways') assertGateways(layer)
    if (layer.kind === 'lighting') assertLighting(layer)
    if (layer.kind === 'navigation') assertNavigation(layer, document.bounds)
    if (layer.kind === 'traversal') {
      if (!profile)
        refuse('traversal-profile-only', 'portable traversal requires the UVW profile space envelope')
      if (traversalClasses.has(layer.classId))
        refuse('traversal-class-unique', `space repeats traversal class «${layer.classId}»`)
      traversalClasses.add(layer.classId)
      assertTraversal(layer, document.bounds, layers)
    }
  }
}

/** Exact authored cliff levels/mask; no generated ramp mesh is inferred. */
function assertCliffs(layer, bounds) {
  const allowed = ['schemaVersion', 'id', 'kind', 'label', 'columns', 'rows', 'cellSize',
    'origin', 'levels', 'authored']
  const { columns, rows, cellSize, origin, levels, authored } = layer
  if (Object.keys(layer).some(key => !allowed.includes(key)) || layer.schemaVersion !== 1
    || typeof layer.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(layer.id)
    || (layer.label !== undefined && typeof layer.label !== 'string')
    || !Number.isSafeInteger(columns) || columns < 2 || !Number.isSafeInteger(rows) || rows < 2
    || !Number.isFinite(cellSize) || cellSize <= 0 || !Array.isArray(origin)
    || origin.length !== 3 || origin.some(value => !Number.isFinite(value))
    || (bounds !== undefined && (origin[0] < bounds.min[0] - EPSILON
      || origin[2] < bounds.min[2] - EPSILON
      || origin[0] + (columns - 1) * cellSize > bounds.max[0] + EPSILON
      || origin[2] + (rows - 1) * cellSize > bounds.max[2] + EPSILON)))
    refuse('cliffs-geometry', `Invalid cliff grid ${layer.id}`)
  // Levels are authored integer classifications, not metre heights. The grid's reference
  // plane can sit below/above the terrain's vertical bounds; only its x/z footprint is bounded.
  if (!Array.isArray(levels) || !Array.isArray(authored)
    || levels.length !== rows || authored.length !== rows
    || levels.some(row => !Array.isArray(row) || row.length !== columns
      || row.some(value => !Number.isSafeInteger(value) || value < 0))
    || authored.some(row => !Array.isArray(row) || row.length !== columns
      || row.some(value => typeof value !== 'boolean')))
    refuse('cliffs-grid', `Incomplete or invalid cliff levels/mask ${layer.id}`)
}

/** Check authored instances and component links against the one space-local resource catalog. */
function assertObjects(layer, layers) {
  const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value)
  const keys = (value, required, optional = []) => value !== null && typeof value === 'object'
    && !Array.isArray(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key))
  const vector = (value, size) => Array.isArray(value) && value.length === size
    && value.every(item => typeof item === 'number' && Number.isFinite(item))
  const quaternion = value => vector(value, 4)
    && Math.abs(value.reduce((sum, item) => sum + item * item, 0) - 1) <= 1e-6
  const ordered = values => values.every((value, index) => index === 0 || values[index - 1] < value)
  if (!keys(layer, ['schemaVersion', 'id', 'kind', 'instances'], ['label'])
    || layer.schemaVersion !== 1 || !id(layer.id)
    || (layer.label !== undefined && typeof layer.label !== 'string')
    || !Array.isArray(layer.instances))
    refuse('objects-layer', `Invalid objects layer ${layer.id}`)
  const catalog = new Map()
  for (const resourceLayer of layers.filter(row => row?.kind === 'resources'))
    for (const resource of resourceLayer.resources ?? []) {
      const rows = catalog.get(resource.id) ?? []
      rows.push(resource.kind ?? resource.original?.family)
      catalog.set(resource.id, rows)
    }
  const instances = []
  for (const instance of layer.instances) {
    if (!keys(instance, ['id', 'objectKind', 'position', 'rotation', 'scale', 'resourceIds'],
      ['modelComponents', 'typeId', 'player', 'variation', 'name', 'derivedFrom', 'presentationTint', 'presentationAnimation', 'latticeCoverage'])
      || !id(instance.id)
      || !['unit', 'structure', 'feature', 'doodad', 'point', 'camera'].includes(instance.objectKind)
      || !vector(instance.position, 3) || !quaternion(instance.rotation)
      || !vector(instance.scale, 3) || instance.scale.some(value => value === 0)
      || !Array.isArray(instance.resourceIds) || !instance.resourceIds.every(id)
      || !ordered(instance.resourceIds)
      || (instance.typeId !== undefined && typeof instance.typeId !== 'string')
      || (instance.player !== undefined && !Number.isSafeInteger(instance.player))
      || (instance.variation !== undefined
        && (!Number.isSafeInteger(instance.variation) || instance.variation < 0))
      || (instance.name !== undefined && typeof instance.name !== 'string'))
      refuse('objects-instance', 'Invalid transform, ordering or metadata in an object instance')
    assertDerivedCliffObject(instance)
    assertUvwObjectPresentation(instance)
    instances.push(instance.id)
    for (const resourceId of instance.resourceIds)
      if (catalog.get(resourceId)?.length !== 1)
        refuse('objects-resource', `Object ${instance.id} needs one resource ${resourceId} in its space`)
    if (instance.modelComponents === undefined) continue
    if (!Array.isArray(instance.modelComponents))
      refuse('objects-component', `Object ${instance.id} has invalid model components`)
    const components = new Map(), children = new Map(), pending = new Map()
    for (const component of instance.modelComponents) {
      if (!keys(component, ['id', 'resourceId'], ['parentId', 'parentSocketId', 'rotation'])
        || !id(component.id) || components.has(component.id)
        || !id(component.resourceId) || !instance.resourceIds.includes(component.resourceId)
        || catalog.get(component.resourceId)?.[0] !== 'uvm'
        || (component.parentId === undefined) !== (component.parentSocketId === undefined)
        || (component.parentId !== undefined
          && (!id(component.parentId) || !id(component.parentSocketId)))
        || (component.rotation !== undefined && !quaternion(component.rotation)))
        refuse('objects-component', `Invalid model component of ${instance.id}`)
      components.set(component.id, component)
      pending.set(component.id, component.parentId === undefined ? 0 : 1)
      if (component.parentId !== undefined) {
        const next = children.get(component.parentId) ?? []
        next.push(component.id); children.set(component.parentId, next)
      }
    }
    for (const component of components.values())
      if (component.parentId !== undefined && !components.has(component.parentId))
        refuse('objects-component', `Missing parent of component ${component.id}`)
    const queue = [...pending].filter(([, degree]) => degree === 0).map(([key]) => key)
    let visited = 0
    for (let index = 0; index < queue.length; index++) {
      const parent = queue[index]; visited++
      for (const child of children.get(parent) ?? []) {
        pending.set(child, pending.get(child) - 1)
        if (pending.get(child) === 0) queue.push(child)
      }
    }
    if (visited !== components.size) refuse('objects-component-cycle', `Object ${instance.id} has a component cycle`)
  }
  if (!ordered(instances)) refuse('objects-order', `Object IDs are not unique and ordered in ${layer.id}`)
}

function assertVisualLayer(layer, kind, required, optional = []) {
  const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value)
  if (layer === null || typeof layer !== 'object' || Array.isArray(layer)
    || !required.every(key => Object.hasOwn(layer, key))
    || Object.keys(layer).some(key => !required.includes(key) && !optional.includes(key))
    || layer.schemaVersion !== 1 || layer.kind !== kind || !id(layer.id)
    || (layer.label !== undefined && typeof layer.label !== 'string'))
    refuse(`${kind}-layer`, `Invalid ${kind} layer`)
  return id
}

function assertRegions(layer) {
  const id = assertVisualLayer(layer, 'regions', ['schemaVersion', 'id', 'kind', 'regions'], ['label'])
  const vec2 = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
  if (!Array.isArray(layer.regions)) refuse('regions-shape', 'Expected region records')
  const ids = []
  for (const region of layer.regions) {
    if (!region || !id(region.id) || typeof region.name !== 'string'
      || (region.color !== undefined && typeof region.color !== 'string')
      || Object.keys(region).some(key => !['id', 'name', 'color', 'shapes'].includes(key))
      || !Array.isArray(region.shapes))
      refuse('regions-shape', 'Invalid region record')
    ids.push(region.id)
    for (const shape of region.shapes) {
      if (!shape || typeof shape !== 'object' || Array.isArray(shape))
        refuse('regions-shape', `Invalid shape of ${region.id}`)
      const keys = Object.keys(shape).sort().join(',')
      if (shape.kind === 'circle' && keys === 'center,kind,radius'
        && vec2(shape.center) && Number.isFinite(shape.radius) && shape.radius > 0) continue
      if (shape.kind === 'rectangle' && keys === 'kind,maximum,minimum'
        && vec2(shape.minimum) && vec2(shape.maximum)
        && shape.minimum.every((value, axis) => value <= shape.maximum[axis])) continue
      if (shape.kind === 'polygon' && keys === 'kind,points'
        && Array.isArray(shape.points) && shape.points.length >= 3
        && shape.points.every(vec2)) continue
      refuse('regions-shape', `Invalid shape of ${region.id}`)
    }
  }
  if (ids.some((value, index) => index && ids[index - 1] >= value))
    refuse('regions-order', 'Region IDs must be unique and ordered')
}

function assertGateways(layer) {
  const id = assertVisualLayer(layer, 'gateways', ['schemaVersion', 'id', 'kind', 'segments'], ['label'])
  const vec2 = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
  if (!Array.isArray(layer.segments)) refuse('gateways-segment', 'Expected gateway segments')
  const ids = []
  for (const segment of layer.segments) {
    if (!segment || Object.keys(segment).sort().join(',') !== 'end,id,start'
      || !id(segment.id) || !vec2(segment.start) || !vec2(segment.end)
      || segment.start.every((value, axis) => value === segment.end[axis]))
      refuse('gateways-segment', 'Invalid gateway segment')
    ids.push(segment.id)
  }
  if (ids.some((value, index) => index && ids[index - 1] >= value))
    refuse('gateways-order', 'Gateway IDs must be unique and ordered')
}

function assertLighting(layer) {
  const id = assertVisualLayer(layer, 'lighting',
    ['schemaVersion', 'id', 'kind', 'ambientColor', 'ambientIntensity', 'directional'],
    ['label', 'toneMapping', 'terrain', 'model', 'unlitColor'])
  try { assertUnlitLighting(layer) }
  catch (error) { refuse('lighting-value', error.message) }
  const vec3 = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
  const color = value => vec3(value) && value.every(item => item >= 0 && item <= 1)
  const numeric = (value, keys) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== keys.length || !keys.every(key => Number.isFinite(value[key])))
      refuse('lighting-value', 'Invalid numeric lighting settings')
  }
  if (layer.terrain !== undefined)
    numeric(layer.terrain, ['specularExponent', 'diffuseMultiplier', 'specularMultiplier'])
  if (layer.toneMapping !== undefined) {
    const tone = layer.toneMapping
    if (!tone || typeof tone !== 'object' || Array.isArray(tone)
      || Object.keys(tone).some(key => !['operator', 'exposure', 'whitePoint', 'contrast',
        'correctGamma', 'colorization', 'ambientOcclusion'].includes(key))
      || !['reinhard', 'exponential', 'logarithmic', 'linear', 'filmic'].includes(tone.operator)
      || !['exposure', 'whitePoint', 'contrast'].every(key => Number.isFinite(tone[key]) && tone[key] > 0)
      || (tone.correctGamma !== undefined && typeof tone.correctGamma !== 'boolean'))
      refuse('lighting-value', 'Invalid tone mapping settings')
    if (tone.colorization !== undefined)
      numeric(tone.colorization, ['inputLow', 'inputHigh', 'inputGamma', 'outputLow', 'outputHigh',
        'brightness', 'contrast', 'hue', 'saturation', 'lightness', 'blend'])
    if (tone.ambientOcclusion !== undefined)
      numeric(tone.ambientOcclusion, ['radius', 'noOcclusion', 'fullOcclusion', 'power'])
  }
  if (!color(layer.ambientColor) || !Number.isFinite(layer.ambientIntensity)
    || layer.ambientIntensity < 0 || !Array.isArray(layer.directional))
    refuse('lighting-value', 'Invalid ambient lighting')
  const ids = []
  for (const light of layer.directional) {
    if (!light || Object.keys(light).some(key => !['color', 'direction', 'id', 'intensity',
      'specularColor', 'specularIntensity', 'useAmbientOcclusion'].includes(key))
      || !id(light.id) || !vec3(light.direction) || !light.direction.some(value => value !== 0)
      || !color(light.color) || !Number.isFinite(light.intensity) || light.intensity <= 0
      || (light.specularColor !== undefined && !vec3(light.specularColor))
      || (light.specularIntensity !== undefined && !Number.isFinite(light.specularIntensity))
      || (light.useAmbientOcclusion !== undefined && typeof light.useAmbientOcclusion !== 'boolean'))
      refuse('lighting-value', 'Invalid directional lighting')
    ids.push(light.id)
  }
  if (ids.some((value, index) => index && ids[index - 1] >= value))
    refuse('lighting-order', 'Directional light IDs must be unique and ordered')
}

/** Portable static adjacency, independent of publisher-native pathing bits. */
function assertTraversal(layer, bounds, layers) {
  const { id, classId, columns, rows, cellSize, origin, walkable, exits } = layer
  if (layer.schemaVersion !== 1 || !/^[a-z][a-z0-9-]*$/.test(classId ?? '')
    || !Number.isSafeInteger(columns) || columns < 1
    || !Number.isSafeInteger(rows) || rows < 1
    || !Number.isFinite(cellSize) || cellSize <= 0
    || !Array.isArray(origin) || origin.length !== 3
    || origin.some(value => !Number.isFinite(value)))
    refuse('traversal-grid-geometry', `traversal layer «${id}» has invalid geometry or class`)
  if (!Array.isArray(walkable) || !Array.isArray(exits)
    || walkable.length !== rows || exits.length !== rows
    || walkable.some(row => !Array.isArray(row) || row.length !== columns)
    || exits.some(row => !Array.isArray(row) || row.length !== columns))
    refuse('sample-grid-matches', `traversal layer «${id}» has an incomplete cell grid`)
  if (bounds !== undefined && (origin[0] < bounds.min[0] - EPSILON
    || origin[1] < bounds.min[1] - EPSILON || origin[1] > bounds.max[1] + EPSILON
    || origin[2] < bounds.min[2] - EPSILON
    || origin[0] + columns * cellSize > bounds.max[0] + EPSILON
    || origin[2] + rows * cellSize > bounds.max[2] + EPSILON))
    refuse('layer-within-bounds', `traversal layer «${id}» extends beyond its space`)
  if (layer.surfaceLayerId !== undefined) {
    const surface = layers.find(candidate => candidate.id === layer.surfaceLayerId)
    if (surface?.kind !== 'heightfield')
      refuse('traversal-surface-reference', `traversal layer «${id}» needs a heightfield in the same space`)
    const minimumX = origin[0] + cellSize / 2, minimumZ = origin[2] + cellSize / 2
    const maximumX = origin[0] + (columns - 0.5) * cellSize
    const maximumZ = origin[2] + (rows - 0.5) * cellSize
    if (minimumX < surface.origin[0] - EPSILON || minimumZ < surface.origin[2] - EPSILON
      || maximumX > surface.origin[0] + (surface.columns - 1) * surface.cellSize + EPSILON
      || maximumZ > surface.origin[2] + (surface.rows - 1) * surface.cellSize + EPSILON)
      refuse('traversal-surface-coverage', `heightfield «${surface.id}» misses traversal cell centres`)
  }
  const directions = [[1, 0, 1], [-1, 0, 2], [0, 1, 4], [0, -1, 8]]
  for (let z = 0; z < rows; z++) for (let x = 0; x < columns; x++) {
    const passable = walkable[z][x], mask = exits[z][x]
    if (typeof passable !== 'boolean' || !Number.isSafeInteger(mask) || mask < 0 || mask > 15)
      refuse('traversal-cell-valid', `traversal layer «${id}» has invalid cell ${x},${z}`)
    if (!passable && mask !== 0)
      refuse('traversal-edge-valid', `blocked cell ${x},${z} in «${id}» has outgoing edges`)
    for (const [dx, dz, bit] of directions) if ((mask & bit) !== 0) {
      const nx = x + dx, nz = z + dz
      if (nx < 0 || nx >= columns || nz < 0 || nz >= rows || walkable[nz][nx] !== true)
        refuse('traversal-edge-valid', `edge from ${x},${z} in «${id}» leaves its passable grid`)
    }
  }
}

/** Native navigation flags have no portable passability meaning, but the grid itself must be
 * complete and spatially bound before a game adapter may publish a traversal mapping.
 */
function assertNavigation(layer, bounds) {
  const { id, columns, rows, cellSize, origin, samples } = layer
  if (!Number.isSafeInteger(columns) || columns < 1 || !Number.isSafeInteger(rows) || rows < 1
    || !Array.isArray(samples) || samples.length !== rows
    || samples.some(row => !Array.isArray(row) || row.length !== columns)) {
    refuse('sample-grid-matches', `navigation layer «${id}» has an incomplete flags grid`)
  }
  for (const row of samples) for (const flags of row) {
    if (!Number.isSafeInteger(flags) || flags < 0)
      refuse('navigation-flags-valid', `navigation layer «${id}» carries invalid native flags`)
  }
  if (!Number.isFinite(cellSize) || cellSize <= 0
    || !Array.isArray(origin) || origin.length !== 3
    || origin.some(value => !Number.isFinite(value))) {
    refuse('navigation-grid-geometry', `navigation layer «${id}» has invalid grid geometry`)
  }
  if (bounds !== undefined) {
    const maxX = origin[0] + (columns - 1) * cellSize
    const maxZ = origin[2] + (rows - 1) * cellSize
    if (origin[0] < bounds.min[0] - EPSILON || maxX > bounds.max[0] + EPSILON
      || origin[2] < bounds.min[2] - EPSILON || maxZ > bounds.max[2] + EPSILON) {
      refuse('layer-within-bounds', `navigation layer «${id}» extends beyond its space`)
    }
  }
}

/** The geometry rules of the one facet this profile defines. */
function assertHeightfield(layer, bounds) {
  const { id, columns, rows, cellSize, origin, samples } = layer
  if (samples.length !== rows) {
    refuse(
      'sample-grid-matches',
      `layer «${id}» declares ${rows} rows and carries ${samples.length}: samples are counts of samples, not of cells`,
    )
  }
  for (const [index, row] of samples.entries()) {
    if (row.length !== columns) {
      refuse(
        'sample-grid-matches',
        `layer «${id}» row ${index} carries ${row.length} samples, declared ${columns}`,
      )
    }
    for (const value of row) {
      if (!Number.isFinite(value)) {
        refuse(
          'samples-finite',
          `layer «${id}» carries a non-finite elevation; absence of ground is noDataValue, not NaN`,
        )
      }
    }
  }
  if (layer.noDataValue !== undefined && !Number.isFinite(layer.noDataValue)) {
    refuse('samples-finite', `layer «${id}» declares a non-finite noDataValue`)
  }

  /*
   * Extent. A grid of N samples spaced `cellSize` apart spans (N - 1) * cellSize, not N * cellSize;
   * getting this wrong makes terrain one cell too wide and shows up as a seam rather than an error.
   */
  const width = (columns - 1) * cellSize
  const depth = (rows - 1) * cellSize
  const maxX = origin[0] + width
  const maxZ = origin[2] + depth
  if (bounds !== undefined) {
    if (origin[0] < bounds.min[0] - EPSILON || maxX > bounds.max[0] + EPSILON) {
      refuse(
        'layer-within-bounds',
        `layer «${id}» spans x ${origin[0]}..${maxX}, outside the document bounds ${bounds.min[0]}..${bounds.max[0]}`,
      )
    }
    if (origin[2] < bounds.min[2] - EPSILON || maxZ > bounds.max[2] + EPSILON) {
      refuse(
        'layer-within-bounds',
        `layer «${id}» spans z ${origin[2]}..${maxZ}, outside the document bounds ${bounds.min[2]}..${bounds.max[2]}`,
      )
    }
  }
}

/** Elevation extent of a heightfield, ignoring no-data samples. Undefined when every sample is no-data. */
export function heightfieldElevationRange(layer) {
  let min
  let max
  for (const row of layer.samples) {
    for (const value of row) {
      if (layer.noDataValue !== undefined && value === layer.noDataValue) continue
      min = min === undefined || value < min ? value : min
      max = max === undefined || value > max ? value : max
    }
  }
  return min === undefined ? undefined : { min, max }
}
