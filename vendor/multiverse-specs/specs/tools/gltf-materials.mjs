/** Shared reference checks for schema-valid glTF materials. No image reads or renderer. */
import gameSchema from '../model/schema/uvm.material.schema.json' with { type: 'json' }
import { assertGltfShadowFlags } from './gltf-material-flags.ts'
import { assertUvmTeamColor, assertUvmTexturePresentation, assertUvmTeamColorAnimations } from './uvm-presentation.ts'

const reject = (rule, message) => { throw new TypeError(`${rule}: ${message}`) }
const finite = value => typeof value === 'number' && Number.isFinite(value)
const vector = (value, length, nonzero = false) => Array.isArray(value) && value.length === length
  && value.every(item => finite(item) && (!nonzero || item !== 0))

function assertWaterSurface(game) {
  const shape = gameSchema.$defs.waterSurfaceParams
  const params = game.params
  if (!Array.isArray(game.layers)
    || Object.keys(game).some(key => !['shader', 'layers', 'params'].includes(key))
    || params === null
    || typeof params !== 'object' || Array.isArray(params)
    || Object.keys(params).some(key => !Object.hasOwn(shape.properties, key))
    || params.schemaVersion !== 1
    || JSON.stringify(params.inputs) !== JSON.stringify(shape.properties.inputs.const)
    || params.surfaceCoordinateSystem !== 'world-xz' || params.timeDomain !== 'presentation-seconds'
    || (params.surfaceUvScale !== undefined && !vector(params.surfaceUvScale, 4, true))
    || (params.surfaceScroll !== undefined && !vector(params.surfaceScroll, 4))
    || ['colorFalloff', 'specularity', 'specularScale', 'causticsFalloff'].some(key =>
      params[key] !== undefined && (!finite(params[key]) || params[key] < 0))
    || (params.reflectivityPower !== undefined && (!finite(params.reflectivityPower) || params.reflectivityPower <= 0))
    || (params.receiveShadows !== undefined && typeof params.receiveShadows !== 'boolean'))
    reject('material-water-profile', 'Invalid closed uv.water.surface@1 parameters')
  const slots = []
  const waterFields = new Set(Object.keys(gameSchema.$defs.waterSurfaceLayer.allOf[1].properties))
  for (const layer of game.layers) {
    if (layer === null || typeof layer !== 'object' || Array.isArray(layer)
      || Object.keys(layer).some(key => !waterFields.has(key))
      || !['diffuse', 'layer1', 'normal', 'caustics'].includes(layer.slot)
      || !Number.isSafeInteger(layer.texture) || layer.texture < 0
      || (layer.channelPacking !== undefined && (layer.slot !== 'normal' || layer.channelPacking !== 'rg-ba-xy'))
      || (layer.slot === 'normal' && layer.channelPacking !== 'rg-ba-xy')
      || (layer.slot === 'caustics' && (!Array.isArray(layer.frames) || !layer.frames.length))
      || (layer.slot !== 'caustics' && layer.frames !== undefined)
      || (layer.slot === 'layer1' && !['blend', 'modulate', 'add'].includes(layer.op))
      || (layer.slot !== 'layer1' && layer.op !== undefined)
      || (layer.slot !== 'caustics' && layer.tiling !== undefined)
      || (layer.frames !== undefined && (!finite(layer.framesPerSecond) || layer.framesPerSecond < 0
        || layer.frames.length > 256 || layer.timeDomain !== 'presentation-seconds'))
      || (layer.tiling !== undefined && !vector(layer.tiling, 2, true)))
      reject('material-water-profile', 'Invalid water layer stack')
    slots.push(layer.slot)
  }
  if (new Set(slots).size !== slots.length
    || slots.some((slot, index) => index > 0 && ['diffuse', 'layer1', 'normal', 'caustics'].indexOf(slot)
      < ['diffuse', 'layer1', 'normal', 'caustics'].indexOf(slots[index - 1])))
    reject('material-water-profile', 'Water layers must be unique and in surface, normal, caustics order')
}

export function* gltfMaterialTextureInfos(material) {
  const pbr = material.pbrMetallicRoughness ?? {}
  const specular = material.extensions?.KHR_materials_specular ?? {}
  const team = material.extensions?.UV_game_material_team_color ?? {}
  for (const [slot, info] of Object.entries({
    baseColorTexture: pbr.baseColorTexture, metallicRoughnessTexture: pbr.metallicRoughnessTexture,
    normalTexture: material.normalTexture, occlusionTexture: material.occlusionTexture,
    emissiveTexture: material.emissiveTexture, specularTexture: specular.specularTexture,
    specularColorTexture: specular.specularColorTexture,
    teamMaskTexture: team.maskTexture, teamSecondaryMaskTexture: team.secondaryMaskTexture,
    teamGlowMaskTexture: team.glow?.maskTexture,
  })) if (info !== undefined) yield { slot, info }
}

/** Only checks known material joins; geometry, image bytes and extension admission have owners. */
export function assertGltfMaterialReferences(document) {
  const { materials = [], textures = [], images = [], samplers = [], extensionsUsed = [] } = document
  if (![materials, textures, images, samplers, extensionsUsed].every(Array.isArray))
    reject('material-tables', 'glTF material resource tables must be arrays')
  const at = (rows, index, purpose) => {
    if (!Number.isSafeInteger(index) || index < 0 || rows[index] === undefined || rows[index] === null)
      reject('material-reference', `Missing ${purpose} ${index}`)
    return rows[index]
  }
  const extension = name => {
    if (!extensionsUsed.includes(name)) reject('material-extension-undeclared', name)
  }
  for (const texture of textures) {
    for (const name of Object.keys(texture.extensions ?? {})) extension(name)
    assertUvmTexturePresentation(texture.extensions)
  }
  for (const material of materials) {
    if (material === null || typeof material !== 'object' || Array.isArray(material))
      reject('material-shape', 'A material must be an object')
    for (const name of Object.keys(material.extensions ?? {})) extension(name)
    assertUvmTeamColor(material.extensions?.UV_game_material_team_color, material.pbrMetallicRoughness?.baseColorTexture)
    if (material.extensions?.KHR_materials_specular !== undefined) {
      extension('KHR_materials_specular')
      if (material.extensions.KHR_materials_unlit !== undefined
        || material.extensions.KHR_materials_pbrSpecularGlossiness !== undefined)
        reject('material-extension-conflict', 'Specular cannot combine with unlit or specular-glossiness')
    }
    for (const { info } of gltfMaterialTextureInfos(material)) {
      if (info === null || typeof info !== 'object') reject('material-shape', 'Invalid textureInfo')
      const texture = at(textures, info.index, 'texture')
      // Check declared image references without choosing or decoding a texture format.
      const sources = texture.source === undefined ? [] : [texture.source]
      for (const name of Object.keys(texture.extensions ?? {})) extension(name)
      for (const name of ['KHR_texture_basisu', 'EXT_texture_webp'])
        if (texture.extensions?.[name] !== undefined) sources.push(texture.extensions[name]?.source)
      if (!sources.length) reject('material-reference', 'Texture has no admitted image source')
      for (const source of sources) at(images, source, 'image')
      if (texture.sampler !== undefined) at(samplers, texture.sampler, 'sampler')
      const transform = info.extensions?.KHR_texture_transform
      for (const name of Object.keys(info.extensions ?? {})) extension(name)
      for (const texCoord of [info.texCoord, transform?.texCoord])
        if (texCoord !== undefined && (!Number.isSafeInteger(texCoord) || texCoord < 0))
          reject('material-reference', 'Invalid texture coordinate set')
    }
    const game = material.extensions?.UV_game_material
    if (game !== undefined) {
      assertGltfShadowFlags(game)
      if (game.shader === 'uv.water.surface@1') assertWaterSurface(game)
      const layers = [...(game.layers ?? []), ...(game.passes ?? []).flatMap(pass => pass.layers ?? [])]
      for (const layer of layers) {
        if (layer.frames !== undefined && (!Array.isArray(layer.frames) || !layer.frames.length
          || (layer.texture !== undefined && layer.texture !== layer.frames[0])))
          reject('material-reference', 'A flipbook needs ordered frames and its first frame as the fallback texture')
        for (const index of [...(layer.texture === undefined ? [] : [layer.texture]), ...(layer.frames ?? [])]) {
          const texture = at(textures, index, 'game material texture')
          at(images, texture.source, 'game material image')
          if (texture.sampler !== undefined) at(samplers, texture.sampler, 'game material sampler')
        }
      }
    }
  }
  assertUvmTeamColorAnimations(document)
  return document
}
