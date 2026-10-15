/** glTF envelope and material joins. Spatial geometry remains owned by uvw-profile.mjs. */
import schema from '../world/schema/uvw.gltf.v1.schema.json' with { type: 'json' }
import { assertGltfMaterialReferences, gltfMaterialTextureInfos } from './gltf-materials.mjs'
import { assertUvpArtifactPath, resolveUvpResourceUri } from './uvp-resource-paths.mjs'
import { assertTerrainAtlas, assertTerrainBlend } from './uvw-terrain-atlas.ts'

export const UVW_GLTF_EXTENSION = schema.properties.extensions.required[0]
export const UVW_GLTF_MARKER = Object.freeze(schema.properties.asset.properties.extras.properties.uv.const)
export const UVW_GLTF_ARTIFACT_DOMAIN = 'uvp/artifact/uvw-gltf@1'
const spatialKinds = new Set(schema.$defs.spatialLayerKinds.enum)
const materialKinds = { 'terrain-materials': 'terrain', water: 'water' }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const keys = (value, required, optional = []) => object(value)
  && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key))
const refuse = (rule, message) => { throw new TypeError(`${rule}: ${message}`) }

/** Returns the original graph by reference, without normalizing, rounding or cloning its data.
 * This is a bounded envelope check, not full source JSON Schema or Khronos validation.
 */
export function uvwGltfGraph(document) {
  const extension = UVW_GLTF_EXTENSION
  if (!keys(document, ['asset', 'extensionsUsed', 'extensionsRequired', 'extensions'], ['extras', 'materials', 'images', 'textures', 'samplers'])
    || !keys(document.asset, ['version', 'extras']) || document.asset.version !== '2.0'
    || !keys(document.asset.extras, ['uv'])
    || !keys(document.asset.extras.uv, Object.keys(UVW_GLTF_MARKER))
    || Object.entries(UVW_GLTF_MARKER).some(([key, value]) => document.asset.extras.uv[key] !== value)
    || !keys(document.extensions, [extension])
    || !Array.isArray(document.extensionsRequired) || document.extensionsRequired.length !== 1
    || document.extensionsRequired[0] !== extension
    || !Array.isArray(document.extensionsUsed) || !document.extensionsUsed.includes(extension)
    || new Set(document.extensionsUsed).size !== document.extensionsUsed.length
    || document.extensionsUsed.some(name => !schema.properties.extensionsUsed.items.enum.includes(name))
    || (document.materials !== undefined && (!Array.isArray(document.materials) || !document.materials.length))
    || (document.extras !== undefined && (!keys(document.extras, ['sourceComment'])
      || typeof document.extras.sourceComment !== 'string')))
    refuse('uvw-gltf-envelope', 'Expected the UVW 1.0 space-graph glTF envelope with its required extension')
  const graph = document.extensions[extension]
  if (!keys(graph, ['schemaVersion', 'spaces', 'connections']) || graph.schemaVersion !== 1
    || !Array.isArray(graph.spaces) || !graph.spaces.length
    || !Array.isArray(graph.connections) || graph.connections.length)
    refuse('uvw-gltf-profile', 'Expected graph v1, nonempty spaces and no connections')
  assertGltfMaterialReferences(document)
  assertResourceTables(document)
  for (const material of document.materials ?? []) {
    if (Object.keys(material.extensions ?? {}).some(name => !['KHR_materials_specular', 'UV_game_material'].includes(name))
      || (material.extensions?.UV_game_material !== undefined
        && material.extensions.UV_game_material.shader !== 'uv.water.surface@1'))
      refuse('uvw-gltf-material', 'Only the standard specular and shared water material profiles are admitted here')
    for (const { info } of gltfMaterialTextureInfos(material)) {
      if (Object.keys(info.extensions ?? {}).some(name => name !== 'KHR_texture_transform')
        || (info.texCoord ?? 0) !== 0 || (info.extensions?.KHR_texture_transform?.texCoord ?? 0) !== 0)
        refuse('uvw-gltf-material', 'This terrain/water subset defines one UV set and the standard texture transform')
    }
  }
  for (const space of graph.spaces) {
    if (!object(space) || space.topology !== 'heightfield' || !Array.isArray(space.layers)
      || !space.layers.length || !space.layers.some(layer => layer?.kind === 'heightfield'))
      refuse('uvw-gltf-profile', 'The spatial subset needs a heightfield in every heightfield space')
    const terrainIds = new Map()
    const resourceIds = new Map()
    for (const resourceLayer of space.layers.filter(row => row?.kind === 'resources')) {
      assertResourcesLayer(document, resourceLayer)
      for (const resource of resourceLayer.resources) {
        const rows = resourceIds.get(resource.id) ?? []
        rows.push(resource)
        resourceIds.set(resource.id, rows)
      }
    }
    for (const layer of space.layers) {
      if (spatialKinds.has(layer?.kind)) continue
      if (layer?.kind === 'resources') continue
      const kind = Object.hasOwn(materialKinds, layer?.kind) ? materialKinds[layer.kind] : undefined
      if (!kind) refuse('uvw-gltf-layer', `Layer ${layer?.kind} needs its own glTF mapping; it cannot be dropped`)
      const layerShape = schema.$defs[kind === 'terrain' ? 'terrainMaterialsLayer' : 'waterLayer']
      if (!keys(layer, layerShape.required, Object.keys(layerShape.properties)))
        refuse('uvw-gltf-layer', `Layer ${layer.id} contains unsupported or missing fields`)
      if (layer.materials !== undefined && (!Array.isArray(layer.materials) || !layer.materials.length))
        refuse('uvw-gltf-material', 'A material catalog must be a nonempty array')
      const ids = new Set()
      const refShape = schema.$defs[`${kind}Material`]
      for (const ref of layer.materials ?? []) {
        if (!keys(ref, refShape.required, Object.keys(refShape.properties))
          || typeof ref.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(ref.id)
          || !Number.isSafeInteger(ref.material) || ref.material < 0
          || document.materials?.[ref.material] === undefined || ids.has(ref.id))
          refuse('uvw-gltf-material-reference', `Invalid, duplicate or unresolved material in ${layer.id}`)
        ids.add(ref.id)
        if (kind === 'terrain' && document.materials[ref.material].extensions?.UV_game_material !== undefined)
          refuse('uvw-gltf-material-reference', 'The water shader cannot be referenced by terrain material catalogs')
        if (kind === 'terrain') terrainIds.set(ref.id, (terrainIds.get(ref.id) ?? 0) + 1)
      }
      assertIdOrder([...ids], `material catalog ${layer.id}`)
      if (kind === 'terrain') {
        assertTerrainAtlas(layer, document)
        if (layer.samples !== undefined && layer.weightRasters === undefined)
          assertBlendGrid(layer, ids, space.bounds)
        else if (layer.samples === undefined && layer.weightRasters !== undefined)
          assertRasterGrid(layer, ids, resourceIds, space.bounds)
        else refuse('uvw-gltf-material-grid', 'Choose exactly one inline or raster weight authoring mode')
      }
    }
    // Legacy water without a local catalog may use a terrain ID. No implicit media/resource join.
    for (const layer of space.layers.filter(row => row.kind === 'water')) {
      const ids = layer.materials === undefined ? undefined : new Set(layer.materials.map(ref => ref.id))
      const zones = new Set()
      for (const zone of layer.zones) {
        if (zones.has(zone.id)) refuse('uvw-gltf-water-zone', `Duplicate zone ${zone.id}`)
        zones.add(zone.id)
        if (zone.minimum.some((value, axis) => value > zone.maximum[axis]))
          refuse('uvw-gltf-water-zone', `Inverted water zone ${zone.id}`)
        if (zone.materialId !== undefined && !(ids ? ids.has(zone.materialId) : terrainIds.get(zone.materialId) === 1))
          refuse('uvw-gltf-material-reference', `Unresolved or ambiguous water material ${zone.materialId}`)
      }
      assertIdOrder([...zones], `zones ${layer.id}`)
    }
  }
  return graph
}

function assertResourcesLayer(document, layer) {
  const shape = schema.$defs.resourcesLayer
  if (!keys(layer, shape.required, Object.keys(shape.properties)) || layer.schemaVersion !== 1
    || (layer.label !== undefined && typeof layer.label !== 'string')
    || !Array.isArray(layer.resources))
    refuse('uvw-gltf-resource', `Invalid resource layer ${layer.id}`)
  const ids = []
  for (const row of layer.resources) {
    if (!keys(row, ['id', 'original', 'outputs']) || typeof row.id !== 'string'
      || !/^[a-z][a-z0-9-]*$/.test(row.id)
      || !keys(row.original, ['family', 'path'])
      || !['media', 'uvm'].includes(row.original.family)
      || !Array.isArray(row.outputs))
      refuse('uvw-gltf-resource', `Invalid resource in ${layer.id}`)
    assertUvpArtifactPath(row.original.path)
    const usages = []
    for (const output of row.outputs) {
      if (!(keys(output, ['usage', 'texture']) || keys(output, ['usage', 'path', 'encoding']))
        || typeof output.usage !== 'string'
        || !/^[a-z][a-z0-9-]*$/.test(output.usage)
        || (output.texture === undefined
          ? output.usage !== 'weight-rgba8' || output.encoding !== 'rgba8-unorm'
            || typeof output.path !== 'string'
          : output.usage === 'weight-rgba8' || !Number.isSafeInteger(output.texture) || output.texture < 0
            || document.textures?.[output.texture] === undefined))
        refuse('uvw-gltf-resource', `Invalid resource output in ${layer.id}/${row.id}`)
      if (output.path !== undefined) assertUvpArtifactPath(output.path)
      usages.push(output.usage)
    }
    assertIdOrder(usages, `resource outputs ${layer.id}/${row.id}`)
    ids.push(row.id)
  }
  assertIdOrder(ids, `resources ${layer.id}`)
}

/** Admission and index bounds include unused table rows: hidden resources cannot evade closure. */
function assertResourceTables(document) {
  for (const [table, kind] of [['images', 'image'], ['textures', 'texture'], ['samplers', 'sampler']]) {
    const rows = document[table]
    if (rows === undefined) continue
    const shape = schema.$defs[kind]
    if (!Array.isArray(rows) || !rows.length || rows.length > schema.properties[table].maxItems)
      refuse('uvw-gltf-resource', `Invalid ${table} table size`)
    for (const row of rows) {
      if (!keys(row, shape.required ?? [], Object.keys(shape.properties))
        || (row.name !== undefined && typeof row.name !== 'string'))
        refuse('uvw-gltf-resource', `Unsupported ${kind} fields`)
      for (const [key, field] of Object.entries(shape.properties)) {
        if (row[key] !== undefined && field.enum && !field.enum.includes(row[key]))
          refuse('uvw-gltf-resource', `Unsupported ${kind}.${key}`)
      }
      if (kind === 'image' && (typeof row.uri !== 'string' || !row.uri
        || !new RegExp(shape.properties.uri.pattern).test(row.uri)))
        refuse('uvw-gltf-resource', 'An image needs a package-relative URI')
      if (kind === 'texture') for (const [key, target] of [['source', 'images'], ['sampler', 'samplers']]) {
        if (row[key] === undefined && key === 'sampler') continue
        if (!Number.isSafeInteger(row[key]) || row[key] < 0 || document[target]?.[row[key]] === undefined)
          refuse('uvw-gltf-resource', `Unresolved texture ${key}`)
      }
    }
  }
}

/** Pure package-local resource joins; the UVP compositor verifies their byte witnesses. */
export function uvwGltfImageReferences(document, documentPath) {
  uvwGltfGraph(document)
  return (document.images ?? []).map((image, imageIndex) => ({ imageIndex,
    path: resolveUvpResourceUri(documentPath, image.uri), mimeType: image.mimeType }))
}

/** Original references are closed by the same UVP package as the glTF images. */
export function uvwGltfOriginalReferences(document) {
  const graph = uvwGltfGraph(document)
  return graph.spaces.flatMap(space => space.layers.filter(layer => layer.kind === 'resources')
    .flatMap(layer => layer.resources.map(resource => ({ spaceId: space.id, layerId: layer.id,
      resourceId: resource.id, family: resource.original.family, path: resource.original.path }))))
}

export function uvwGltfMediaOutputReferences(document) {
  const graph = uvwGltfGraph(document)
  return graph.spaces.flatMap(space => space.layers.filter(layer => layer.kind === 'resources')
    .flatMap(layer => layer.resources.flatMap(resource => resource.outputs
      .filter(output => output.path !== undefined)
      .map(output => ({ spaceId: space.id, layerId: layer.id, resourceId: resource.id,
        usage: output.usage, path: output.path })))))
}

/** Raw, linear weight payloads, never glTF color textures. */
export function uvwGltfRasterReferences(document) {
  const graph = uvwGltfGraph(document)
  return graph.spaces.flatMap(space => space.layers.filter(layer => layer.kind === 'terrain-materials'
    && layer.weightAuthoring === 'raster').map(layer => ({
    spaceId: space.id, layerId: layer.id, sampling: layer.rasterSampling,
    rasters: layer.weightRasters.map(raster => {
      const resources = space.layers.filter(row => row.kind === 'resources')
        .flatMap(row => row.resources.filter(resource => resource.id === raster.resourceId))
      const output = resources[0].outputs.find(row => row.usage === 'weight-rgba8')
      return { resourceId: raster.resourceId, path: output.path,
        width: raster.width, height: raster.height, materialIds: raster.materialIds }
    }),
  })))
}

function assertIdOrder(ids, purpose) {
  if (ids.some((id, index) => index > 0 && ids[index - 1] >= id))
    refuse('uvw-gltf-material-order', `Expected unique canonical IDs in ${purpose}`)
}

/** Material joins, without normalizing authored weights or creating another grid model. */
function assertBlendGrid(layer, ids, bounds) {
  const { rows, columns, samples, origin, cellSize } = layer
  if (!Number.isSafeInteger(rows) || rows < 2 || !Number.isSafeInteger(columns) || columns < 2
    || !Array.isArray(samples) || samples.length !== rows
    || samples.some(row => !Array.isArray(row) || row.length !== columns))
    refuse('uvw-gltf-material-grid', `Incomplete blend grid ${layer.id}`)
  if (!Number.isFinite(cellSize) || cellSize <= 0 || !Array.isArray(origin) || origin.length !== 3
    || origin.some(value => !Number.isFinite(value))
    || origin[0] < bounds.min[0] - 1e-9 || origin[2] < bounds.min[2] - 1e-9
    || origin[0] + (columns - 1) * cellSize > bounds.max[0] + 1e-9
    || origin[2] + (rows - 1) * cellSize > bounds.max[2] + 1e-9)
    refuse('uvw-gltf-material-grid', `Blend grid ${layer.id} lies outside its space`)
  for (const row of samples) for (const sample of row) {
    assertTerrainBlend(sample, ids, layer.id)
  }
}

function assertRasterGrid(layer, ids, resources, bounds) {
  const shape = schema.$defs.terrainMaterialsLayer.properties.rasterSampling.properties
  const sampling = layer.rasterSampling
  if (layer.weightAuthoring !== 'raster' || !sampling
    || !keys(sampling, Object.keys(shape))
    || sampling.coordinates !== 'material-grid-extent' || sampling.filter !== 'bilinear'
    || sampling.wrap !== 'clamp' || sampling.normalization !== 'sum'
    || !(keys(sampling.zeroSum, ['mode']) && sampling.zeroSum.mode === 'refuse'
      || keys(sampling.zeroSum, ['mode', 'materialId']) && sampling.zeroSum.mode === 'material'
        && ids.has(sampling.zeroSum.materialId)))
    refuse('uvw-gltf-raster-policy', `Invalid raster sampling policy in ${layer.id}`)
  const { rows, columns, origin, cellSize, weightRasters } = layer
  if (!Number.isSafeInteger(rows) || rows < 2 || !Number.isSafeInteger(columns) || columns < 2
    || !Number.isFinite(cellSize) || cellSize <= 0 || !Array.isArray(origin) || origin.length !== 3
    || origin.some(value => !Number.isFinite(value))
    || origin[0] < bounds.min[0] - 1e-9 || origin[2] < bounds.min[2] - 1e-9
    || origin[0] + (columns - 1) * cellSize > bounds.max[0] + 1e-9
    || origin[2] + (rows - 1) * cellSize > bounds.max[2] + 1e-9
    || !Array.isArray(weightRasters) || weightRasters.length < 1
    || weightRasters.length > schema.$defs.terrainMaterialsLayer.properties.weightRasters.maxItems)
    refuse('uvw-gltf-raster-grid', `Invalid raster grid ${layer.id}`)
  const materials = new Set(), rasterIds = new Set()
  for (const raster of weightRasters) {
    if (!raster || !keys(raster, ['resourceId', 'width', 'height', 'materialIds', 'encoding', 'normalization'])
      || !Number.isSafeInteger(raster.width) || raster.width < 1
      || !Number.isSafeInteger(raster.height) || raster.height < 1
      || raster.width * raster.height * 4 > 64 * 1024 * 1024
      || !Array.isArray(raster.materialIds) || raster.materialIds.length < 1 || raster.materialIds.length > 4
      || raster.encoding !== 'rgba8-unorm' || raster.normalization !== 'sum'
      || rasterIds.has(raster.resourceId))
      refuse('uvw-gltf-raster-grid', `Invalid raster metadata ${layer.id}`)
    rasterIds.add(raster.resourceId)
    if (raster.width !== weightRasters[0].width || raster.height !== weightRasters[0].height)
      refuse('uvw-gltf-raster-grid', `Raster dimensions differ in ${layer.id}`)
    for (const id of raster.materialIds) {
      if (!ids.has(id) || materials.has(id))
        refuse('uvw-gltf-raster-grid', `Invalid raster channel ${id}`)
      materials.add(id)
    }
    const candidates = resources.get(raster.resourceId) ?? []
    if (candidates.length !== 1 || candidates[0].outputs.filter(row =>
      row.usage === 'weight-rgba8' && row.path !== undefined).length !== 1)
      refuse('uvw-gltf-raster-resource', `Raster ${raster.resourceId} needs one raw weight output`)
  }
}

/** Legacy and glTF share the same spatial records; a mixed envelope never falls back to legacy. */
export function uvwDocumentGraph(document) {
  return object(document) && Object.hasOwn(document, 'asset') ? uvwGltfGraph(document) : document
}
