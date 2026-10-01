/** Explicit migration of schema-valid UVW v1 material records to standard glTF materials.
 * Texture conversion, loading and publishing stay with the caller's existing resource owner.
 */
import worldSchema from '../world/schema/uvw.profile.v1.schema.json' with { type: 'json' }
import { jcsStringify } from './uv-canonical-form.mjs'
import { assertGltfMaterialReferences } from './gltf-materials.mjs'

const refuse = (rule, message) => { throw new TypeError(`${rule}: ${message}`) }
const finite = value => typeof value === 'number' && Number.isFinite(value)
const vector = (value, size) => Array.isArray(value) && value.length === size && value.every(finite)
const unit = value => finite(value) && value >= 0 && value <= 1

/** sourcePivot is explicit because the current SDK renderer and UVW text disagree. */
export function uvwUvTransformToGltf(transform, sourcePivot) {
  if (!transform || !vector(transform.offset, 2) || !vector(transform.scale, 2)
    || transform.scale.includes(0) || !finite(transform.rotation)
    || !['center', 'origin'].includes(sourcePivot))
    refuse('material-uv-policy', 'A finite legacy transform and explicit center/origin pivot are required')
  const { scale, rotation } = transform
  const offset = [...transform.offset]
  if (sourcePivot === 'center') {
    const c = Math.cos(rotation), s = Math.sin(rotation)
    offset[0] += 0.5 - (c * scale[0] - s * scale[1]) * 0.5
    offset[1] += 0.5 - (s * scale[0] + c * scale[1]) * 0.5
  }
  if (!offset.every(finite)) refuse('material-uv-overflow', 'Converted UV offset is not finite')
  return { offset, scale: [...scale], rotation }
}

/** Produces a material, extension declarations and retained v1 fields, never a second UVW wire form.
 * policy: explicit BRDF/alpha, UV origin, water color space and texture channel meaning.
 * resources: schema-valid glTF tables plus bindings {resourceId, usage, index, texCoord?}.
 */
export function projectUvwMaterial(kind, source, policy, resources = {}) {
  if (!['terrain', 'water'].includes(kind) || source === null || typeof source !== 'object'
    || Array.isArray(source) || typeof source.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(source.id))
    refuse('material-source', 'A typed UVW v1 material with a local ID is required')
  const known = worldSchema.$defs[`${kind}Material`].properties
  if (Object.keys(source).some(key => !Object.hasOwn(known, key)))
    refuse('material-source-field', 'Unknown or mixed legacy/glTF fields cannot be dropped')
  // Refuse non-JSON input before any projection. Neither source nor policy is mutated.
  try { jcsStringify(source) } catch { refuse('material-source', 'Source must be finite JSON') }
  if (!policy || !unit(policy.metallicFactor) || !unit(policy.roughnessFactor)
    || !['OPAQUE', 'MASK', 'BLEND'].includes(policy.alphaMode)
    || (policy.alphaCutoff !== undefined && (!finite(policy.alphaCutoff) || policy.alphaCutoff < 0))
    || (policy.doubleSided !== undefined && typeof policy.doubleSided !== 'boolean')
    || (policy.allowPartial !== undefined && typeof policy.allowPartial !== 'boolean'))
    refuse('material-pbr-policy', 'Explicit metallicFactor, roughnessFactor and alphaMode are required')
  if ((policy.waterSurfaceProfile !== undefined && kind !== 'water')
    || (policy.waterSurfaceBlend !== undefined && policy.waterSurfaceProfile === undefined))
    refuse('material-water-policy', 'Water surface policy must target a water material')
  if (kind === 'water' && source.causticsFrameResourceIds !== undefined
    && (!Array.isArray(source.causticsFrameResourceIds) || !source.causticsFrameResourceIds.length
      || source.causticsFrameResourceIds.some(id => typeof id !== 'string' || !id)
      || (source.causticsResourceId !== undefined
        && source.causticsResourceId !== source.causticsFrameResourceIds[0])))
    refuse('material-water-policy', 'The caustics fallback must name the first ordered frame')
  const retained = structuredClone(source)
  const pbr = { metallicFactor: policy.metallicFactor, roughnessFactor: policy.roughnessFactor }
  const material = { ...(source.label === undefined ? {} : { name: source.label }),
    pbrMetallicRoughness: pbr, alphaMode: policy.alphaMode,
    ...(policy.alphaCutoff === undefined ? {} : { alphaCutoff: policy.alphaCutoff }),
    ...(policy.doubleSided === undefined ? {} : { doubleSided: policy.doubleSided }) }
  const resourceExtensions = resources.gltf?.extensionsUsed ?? []
  if (!Array.isArray(resourceExtensions) || resourceExtensions.some(name => typeof name !== 'string' || !name))
    refuse('material-tables', 'Resource extension declarations must be an array of names')
  const used = new Set(resourceExtensions), resolvedTextures = []
  const transform = source.uvTransform === undefined ? undefined
    : uvwUvTransformToGltf(source.uvTransform, policy.sourceUvPivot)
  const texture = (resourceId, usage) => {
    if (typeof resourceId !== 'string' || !Array.isArray(resources.bindings))
      refuse('material-texture-binding', 'Explicit texture bindings are required')
    const matches = resources.bindings.filter(row => row?.resourceId === resourceId && row.usage === usage)
    if (matches.length !== 1) refuse('material-texture-binding', `${resourceId}/${usage} needs exactly one binding`)
    const row = matches[0]
    const info = { index: row.index, ...(row.texCoord === undefined ? {} : { texCoord: row.texCoord }) }
    if (transform !== undefined) {
      info.extensions = { KHR_texture_transform: structuredClone(transform) }
      used.add('KHR_texture_transform')
    }
    resolvedTextures.push({ resourceId, usage, index: row.index })
    return info
  }
  if (kind === 'terrain' && source.baseColorFactor !== undefined) {
    if (!vector(source.baseColorFactor, 4) || !source.baseColorFactor.every(unit))
      refuse('material-color', 'baseColorFactor must be four linear unit-range values')
    pbr.baseColorFactor = [...source.baseColorFactor]
    delete retained.baseColorFactor
  }
  if (kind === 'water') {
    if (!vector(source.color, 4) || !source.color.every(unit)
      || !['linear', 'srgb'].includes(policy.waterColorSpace))
      refuse('material-color-policy', 'Water needs straight RGBA and an explicit linear/srgb source space')
    pbr.baseColorFactor = source.color.map((value, channel) => channel === 3 || policy.waterColorSpace === 'linear'
      ? value : value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    // Keep native color for exact source round-trip when the transfer function is nonlinear.
    if (policy.waterColorSpace === 'linear') delete retained.color
  }
  if (source.baseColorResourceId !== undefined) {
    pbr.baseColorTexture = texture(source.baseColorResourceId, 'base-color-srgb')
    delete retained.baseColorResourceId
  }
  if (source.normalResourceId !== undefined && kind === 'terrain') {
    material.normalTexture = texture(source.normalResourceId, 'normal-linear-rgb')
    delete retained.normalResourceId
  }
  if (source.specularResourceId !== undefined) {
    if (!['strength-alpha', 'color-srgb-rgb'].includes(policy.specularEncoding))
      refuse('material-specular-policy', 'Specular strength alpha and color RGB are distinct encodings')
    const slot = policy.specularEncoding === 'strength-alpha' ? 'specularTexture' : 'specularColorTexture'
    material.extensions = { KHR_materials_specular: {
      [slot]: texture(source.specularResourceId, `specular-${policy.specularEncoding}`) } }
    used.add('KHR_materials_specular')
    delete retained.specularResourceId
  }
  if (kind === 'water' && policy.waterSurfaceProfile !== undefined) {
    if (policy.waterSurfaceProfile !== 'uv.water.surface@1'
      || (source.secondaryColorResourceId !== undefined && source.baseColorResourceId === undefined)
      || (source.baseColorResourceId !== undefined
        && !['blend', 'modulate', 'add'].includes(policy.waterSurfaceBlend))
      || (source.baseColorResourceId === undefined && policy.waterSurfaceBlend !== undefined))
      refuse('material-water-policy', 'Water needs an explicit surface profile, blend and ordered caustics')
    const layers = [], params = { schemaVersion: 1,
      inputs: ['world-position', 'water-depth', 'shadow'],
      surfaceCoordinateSystem: 'world-xz', timeDomain: 'presentation-seconds' }
    if (source.baseColorResourceId !== undefined) {
      const base = pbr.baseColorTexture.index
      layers.push({ slot: 'diffuse', texture: base })
      const secondary = source.secondaryColorResourceId === undefined ? base
        : texture(source.secondaryColorResourceId, 'secondary-color-srgb').index
      layers.push({ slot: 'layer1', texture: secondary, op: policy.waterSurfaceBlend })
      delete retained.baseColorResourceId
      delete retained.secondaryColorResourceId
    }
    if (source.normalResourceId !== undefined) {
      layers.push({ slot: 'normal', texture: texture(source.normalResourceId, 'wave-normal-rg-ba-xy').index,
        channelPacking: 'rg-ba-xy' })
      delete retained.normalResourceId
    }
    const frames = source.causticsFrameResourceIds ?? (source.causticsResourceId === undefined
      ? [] : [source.causticsResourceId])
    if (frames.length) {
      const indices = frames.map(id => texture(id, 'caustics-linear-rgb').index)
      layers.push({ slot: 'caustics', texture: indices[0], frames: indices,
        framesPerSecond: source.causticsFramesPerSecond ?? 0, timeDomain: 'presentation-seconds',
        ...(source.causticsScale === undefined ? {} : { tiling: structuredClone(source.causticsScale) }) })
      delete retained.causticsResourceId
      delete retained.causticsFrameResourceIds
      delete retained.causticsFramesPerSecond
      delete retained.causticsScale
    } else if (source.causticsFramesPerSecond !== undefined || source.causticsScale !== undefined
      || source.causticsFalloff !== undefined) {
      refuse('material-water-policy', 'Caustics parameters require at least one frame')
    }
    for (const [field, target] of [['uvScale', 'surfaceUvScale'], ['scroll', 'surfaceScroll'],
      ['colorFalloff', 'colorFalloff'], ['specularity', 'specularity'],
      ['specularScale', 'specularScale'], ['reflectivityPower', 'reflectivityPower'],
      ['causticsFalloff', 'causticsFalloff'], ['receiveShadows', 'receiveShadows']]) {
      if (source[field] === undefined) continue
      params[target] = structuredClone(source[field])
      delete retained[field]
    }
    material.extensions = { ...material.extensions, UV_game_material: {
      shader: 'uv.water.surface@1', layers, params } }
    used.add('UV_game_material')
  }
  const waterFields = kind !== 'water' ? [] : Object.keys(source).filter(key =>
    !['id', 'label', 'color', 'baseColorResourceId'].includes(key))
  if (waterFields.length && policy.allowPartial !== true && policy.waterSurfaceProfile === undefined)
    refuse('material-water-semantics', `Water fields need a water extension: ${waterFields.join(', ')}`)
  const extensionsUsed = [...used].sort()
  assertGltfMaterialReferences({ ...resources.gltf, materials: [material], extensionsUsed })
  return { profile: 'uv/gltf-material-projection@1', sourceId: source.id, material, extensionsUsed,
    resolvedTextures, retained,
    fidelity: waterFields.length ? 'preview' : 'material',
    diagnostics: (policy.waterSurfaceProfile === undefined ? waterFields : []).map(field => ({ rule: 'material-field-retained', field,
      message: 'Preserved for the water extension; not implemented by the glTF material.' })) }
}
