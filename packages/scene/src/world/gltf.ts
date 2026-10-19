/**
 * A world as a glTF 2.0 binary (GLB) that an ordinary viewer opens: the visual fallback of a UVW
 * world (SPEC_UVW_GLTF "Remaining M2 work"), not the authoritative UVW graph.
 *
 * Owner and route. The scene is the one the CPU renderer draws (`worldHeadlessScene`): the world
 * plan's ground, water and every placed model, posed and skinned as the plan places them, with the
 * materials and decoded textures the world draws them with. Nothing is re-read or re-decided here;
 * this module only writes that scene as glTF meshes, materials, PNG images and nodes.
 *
 * Ground. The world blends terrain layers per fragment (splats, overlays, decals); glTF has no such
 * material. The blended ground is baked once: the same headless renderer draws the terrain
 * primitives from straight above, orthographically, with white ambient light and no directional
 * light (albedo times the ground's own vertex shading), into one `terrainTextureSize` image. The
 * ground meshes then carry planar UVs over the world's x/z extent; the overlay and decal layers that
 * the bake already holds are not written again. Vertical ground faces stretch the bake: SC2 cliff
 * walls are models and are unaffected. A masked cliff piece's ground copy (the terrain the world
 * shows where the rock's mask is clear) uses the same opaque ground bake behind the rock. Shared
 * plateau vertices stay fixed; other vertices move 0.001 world units inward to avoid coincident
 * surfaces. Faces fully covered by rock are omitted; visible vertical faces remain.
 *
 * Limits of this profile: one moment (clip time 0, the plan's poses); no animation, skins or
 * morph targets (geometry is baked); material programs (layered game shaders), team colour and
 * splat normal/specular detail fall back to the base colour texture; camera-facing effects,
 * lines (regions, gateways) and hidden primitives are omitted; units stay the world's.
 * The whole binary is held in memory; `maxBytes` refuses rather than truncates.
 */
import type {
  SceneRendererMaterial,
  SceneRendererPrimitive,
  SceneRendererScene,
  SceneRendererTexture,
} from '@modkit/sdk/renderer'
import { encodePng } from '@modkit/codec-kit/raster'
import { sha256Hex } from '@modkit/codec-kit/crypto/digest'
import { computeLayerColorCpu, type CpuLayerSample, type StandardLayerDefines } from '@modkit/codec-kit/model-math/standard-material-glsl'
import { renderHeadless } from '../render/headless.js'
import { sceneTexturePixels } from '../render/compressed-textures.js'
import { prepareSceneMaterialPrograms, sampleMaterialTexture } from '../render/materials.js'
import type { StandardMaterialProgram } from '../materials/index.js'
import { worldHeadlessScene } from './headless.js'
import type { WorldWebGlPlan, WorldWebGlSplatBatch } from './webgl.js'

export interface WorldGlbOptions {
  /** Edge of the baked ground image, 16..4096 pixels (the headless renderer's own ceiling). */
  readonly terrainTextureSize: number
  /** The largest binary to write; a larger world is refused. */
  readonly maxBytes: number
  readonly signal?: AbortSignal
}

export interface WorldGlbResult {
  readonly bytes: Uint8Array
  readonly stats: Readonly<{
    meshes: number
    triangles: number
    materials: number
    images: number
    omittedPrimitives: number
  }>
  readonly diagnostics: readonly Readonly<{ code: string; message: string; severity: 'information' | 'warning' }>[]
}

const FLOAT = 5126
const UNSIGNED_INT = 5125
const ARRAY_BUFFER = 34962
const ELEMENT_ARRAY_BUFFER = 34963
const REPEAT = 10497
const CLAMP = 33071
const NEAREST = 9728
const LINEAR = 9729
const TERRAIN_MATERIAL = 'world/terrain-baked'

/** Overlay and decal layers the bake holds; not written as geometry. */
const isTerrainLayer = (id: string) => id.startsWith('world/decal-') || id.startsWith('world/splat-overlay-')

/**
 * The world plan as a GLB. Ground is baked into one texture (see the module comment); models and
 * water keep their own materials. Deterministic for one plan and options.
 */
export async function worldGlb(plan: WorldWebGlPlan, options: WorldGlbOptions): Promise<WorldGlbResult> {
  const { terrainTextureSize: size, maxBytes, signal } = options
  if (!Number.isSafeInteger(size) || size < 16 || size > 4096)
    throw new RangeError(`terrainTextureSize must be an integer from 16 to 4096, not ${size}`)
  const built = worldHeadlessScene(plan)
  const { scene, splats, water, terrain } = built
  // the material programs of the scene's materials, prepared as the headless renderer prepares them
  // (by the scene's own material and texture ids; a model scene's own program table is keyed by
  // ids local to its model)
  const programsById = prepareSceneMaterialPrograms(
    scene.materials ?? [],
    new Map((scene.textures ?? []).map(texture => [texture.id, texture])),
    scene.materialContext,
    [],
    signal,
  )
  const diagnostics: { code: string; message: string; severity: 'information' | 'warning' }[] = []
  for (const item of built.diagnostics)
    if (item.severity !== 'error') diagnostics.push({ code: item.code, message: item.message, severity: item.severity })
  const [minX, minY, minZ] = plan.bounds.minimum
  const [maxX, maxY, maxZ] = plan.bounds.maximum
  const spanX = Math.max(maxX - minX, Number.EPSILON)
  const spanZ = Math.max(maxZ - minZ, Number.EPSILON)
  const spanY = Math.max(maxY - minY, 1)

  // --- the ground bake: terrain primitives from straight above, albedo only
  const terrainPrimitives = scene.primitives.filter(primitive => terrain.has(primitive.id))
  let baked: Uint8Array | undefined
  let bakeWidth = 0
  let bakeHeight = 0
  if (terrainPrimitives.length > 0) {
    const scale = size / Math.max(spanX, spanZ)
    bakeWidth = Math.max(1, Math.round(spanX * scale))
    bakeHeight = Math.max(1, Math.round(spanZ * scale))
    // x → right, z → down (row 0 at minimum z), the highest surface nearest
    const viewProjection = new Float32Array([
      2 / spanX, 0, 0, 0,
      0, 0, -2 / spanY, 0,
      0, -2 / spanZ, 0, 0,
      -1 - (2 * minX) / spanX, 1 + (2 * minZ) / spanZ, 1 + (2 * minY) / spanY, 1,
    ])
    const bakeScene: SceneRendererScene = {
      primitives: terrainPrimitives.map(({ depthBias: _bias, ...primitive }) => primitive),
      ...(scene.materials === undefined ? {} : { materials: scene.materials }),
      ...(scene.textures === undefined ? {} : { textures: scene.textures }),
      lights: [],
      ambientLight: [1, 1, 1],
    }
    const frame = await renderHeadless(
      {
        scene: bakeScene,
        camera: { viewProjection },
        viewport: { width: bakeWidth, height: bakeHeight },
        outputKind: 'rgba8',
        clearColor: [0, 0, 0, 0],
        ...(signal === undefined ? {} : { signal }),
      },
      splats,
      water,
      terrain,
      undefined,
      new Set(terrainPrimitives.map(primitive => primitive.id).filter(isTerrainLayer)),
    )
    baked = frame.rgba
    fillUncovered(baked, bakeWidth, bakeHeight)
    for (let index = 3; index < baked.length; index += 4) baked[index] = 255
  }

  // --- glTF tables
  const chunks: Uint8Array[] = []
  let binaryLength = 0
  const bufferViews: Record<string, unknown>[] = []
  const accessors: Record<string, unknown>[] = []
  const append = (bytes: Uint8Array, target?: number): number => {
    const padding = (4 - (binaryLength % 4)) % 4
    if (padding > 0) {
      chunks.push(new Uint8Array(padding))
      binaryLength += padding
    }
    if (binaryLength + bytes.byteLength > maxBytes)
      throw new RangeError(`the world's glTF binary exceeds ${maxBytes} bytes`)
    chunks.push(bytes)
    bufferViews.push({
      buffer: 0,
      byteOffset: binaryLength,
      byteLength: bytes.byteLength,
      ...(target === undefined ? {} : { target }),
    })
    binaryLength += bytes.byteLength
    return bufferViews.length - 1
  }
  const floats = (values: Float32Array, type: 'VEC2' | 'VEC3' | 'VEC4', bounds = false): number => {
    const width = type === 'VEC2' ? 2 : type === 'VEC3' ? 3 : 4
    const view = append(new Uint8Array(values.buffer, values.byteOffset, values.byteLength).slice(), ARRAY_BUFFER)
    const accessor: Record<string, unknown> = {
      bufferView: view,
      componentType: FLOAT,
      count: values.length / width,
      type,
    }
    if (bounds) {
      const min = Array<number>(width).fill(Infinity)
      const max = Array<number>(width).fill(-Infinity)
      for (let index = 0; index < values.length; index++) {
        const value = values[index]!, channel = index % width
        if (value < min[channel]!) min[channel] = value
        if (value > max[channel]!) max[channel] = value
      }
      accessor['min'] = min
      accessor['max'] = max
    }
    accessors.push(accessor)
    return accessors.length - 1
  }
  const indexAccessor = (indices: Uint32Array): number => {
    const view = append(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength).slice(), ELEMENT_ARRAY_BUFFER)
    accessors.push({ bufferView: view, componentType: UNSIGNED_INT, count: indices.length, type: 'SCALAR' })
    return accessors.length - 1
  }

  const images: Record<string, unknown>[] = []
  const samplers: Record<string, unknown>[] = []
  const gltfTextures: Record<string, unknown>[] = []
  const materials: Record<string, unknown>[] = []
  const textureIndex = new Map<string, number>()
  const sceneTextures = new Map<string, SceneRendererTexture>(
    (scene.textures ?? []).map(texture => [texture.id, texture]),
  )
  // model scenes carry their own copies of shared textures: one image per distinct content
  const imageByContent = new Map<string, number>()
  const textureBySource = new Map<string, number>()
  const imageTexture = async (
    key: string,
    width: number,
    height: number,
    rgba: Uint8Array,
    sampler: Record<string, unknown>,
  ): Promise<number> => {
    signal?.throwIfAborted()
    const content = `${width}x${height}:${await sha256Hex(rgba)}`
    let image = imageByContent.get(content)
    if (image === undefined) {
      const view = append(await encodePng(width, height, rgba, signal))
      images.push({ bufferView: view, mimeType: 'image/png', name: key })
      image = images.length - 1
      imageByContent.set(content, image)
    }
    const samplerKey = JSON.stringify(sampler)
    let samplerIndex = samplers.findIndex(item => JSON.stringify(item) === samplerKey)
    if (samplerIndex < 0) {
      samplers.push(sampler)
      samplerIndex = samplers.length - 1
    }
    const sourceKey = `${String(image)}/${String(samplerIndex)}`
    let texture = textureBySource.get(sourceKey)
    if (texture === undefined) {
      gltfTextures.push({ source: image, sampler: samplerIndex })
      texture = gltfTextures.length - 1
      textureBySource.set(sourceKey, texture)
    }
    textureIndex.set(key, texture)
    return texture
  }
  const textureOf = async (id: string | undefined): Promise<number | undefined> => {
    if (id === undefined) return undefined
    const known = textureIndex.get(id)
    if (known !== undefined) return known
    const texture = sceneTextures.get(id)
    if (texture === undefined || (texture.dimension ?? '2d') !== '2d') return undefined
    let rgba: Uint8Array
    try {
      rgba = sceneTexturePixels(texture)
    } catch {
      return undefined
    }
    if (rgba.byteLength !== texture.width * texture.height * 4) return undefined
    const filter = texture.filter === 'nearest' ? NEAREST : LINEAR
    return imageTexture(id, texture.width, texture.height, rgba, {
      magFilter: filter,
      minFilter: filter,
      wrapS: texture.wrapU === 'clamp' ? CLAMP : REPEAT,
      wrapT: texture.wrapV === 'clamp' ? CLAMP : REPEAT,
    })
  }

  let unlitUsed = false
  let skippedLayers = 0
  const bakedSurfaces = new Map<string, Promise<number | undefined>>()
  const identities = new WeakMap<object, number>()
  let nextIdentity = 0
  const identityOf = (value: object): number => {
    let identity = identities.get(value)
    if (identity === undefined) identities.set(value, (identity = ++nextIdentity))
    return identity
  }
  /**
   * A model material the world draws with a layered program (SC2 M3): its colour and coverage baked
   * into the coverage layer's texture space (otherwise diffuse), with the program's blend.
   */
  const surfaces = new Map<string, Promise<ProgramSurface | undefined>>()
  const surfaceOf = (id: string | undefined): Promise<ProgramSurface | undefined> => {
    if (id === undefined) return Promise.resolve(undefined)
    let surface = surfaces.get(id)
    if (surface === undefined) {
      surface = programSurface(id)
      surfaces.set(id, surface)
    }
    return surface
  }
  const programSurface = async (id: string): Promise<ProgramSurface | undefined> => {
    const programs = programsById.get(id)
    const pass = programs?.passes[0]
    if (programs === undefined || pass === undefined) return undefined
    const layerOf = (slot: string) => pass.defines.layers.find(layer => layer.slot === slot)
    // Coverage must keep its full UV period: a diffuse layer tiled twice inside an untiled mask
    // cannot carry that mask in one repeating diffuse tile.
    const domain = (['alpha1', 'alpha2', 'diffuse'] as const)
      .map(layerOf)
      .find(layer => layer?.hasTexture === true && MESH_UV_SETS.has(layer.uvSource) &&
        invertAffine2(layerAffine(pass, layer)) !== undefined)
    if (domain === undefined) return undefined
    const sourceOf = (layer: StandardLayerDefines) => {
      const binding = pass.textures.find(item => item.slot === layer.slot)
      const texture = binding === undefined ? undefined : programs.textures.get(binding.resourceId)
      if (binding === undefined || texture === undefined || (texture.dimension ?? '2d') !== '2d') return undefined
      try {
        const rgba = sceneTexturePixels(texture)
        if (rgba.byteLength !== texture.width * texture.height * 4) return undefined
        const { compressed: _blocks, ...plain } = texture
        // a model's placed copies share their texels: the texel buffer is the identity
        return { binding, texture: { ...plain, rgba }, identity: identityOf(rgba) }
      } catch {
        return undefined
      }
    }
    const base = sourceOf(domain)
    if (base === undefined) return undefined
    const blended = pass.blend !== 'opaque' && pass.blend !== 'alpha-test'
    let coverageLost = false
    const contributing = (['diffuse', 'alpha1', 'alpha2'] as const).flatMap((slot): Contribution[] => {
      const layer = layerOf(slot)
      if (layer === undefined) return []
      if (!layer.hasTexture) return [{ layer, source: undefined }]
      // a layer read through another UV set cannot share the domain's texture space
      if (MESH_UV_SETS.get(layer.uvSource) !== MESH_UV_SETS.get(domain.uvSource)) {
        skippedLayers++
        if (slot !== 'diffuse') coverageLost = true
        return []
      }
      const source = layer === domain ? base : sourceOf(layer)
      if (source === undefined) {
        skippedLayers++
        if (slot !== 'diffuse') coverageLost = true
        return []
      }
      return [{ layer, source }]
    })
    // a see-through surface whose mask cannot be baked has no known coverage (smoke, foam): drawn
    // without it, it is a sheet over everything; it is left out instead
    if (blended && coverageLost) return OMITTED_SURFACE
    const key = JSON.stringify({
      layers: contributing.map(({ layer, source }) => ({
        ...layer,
        // resource ids are local to their model; the texture object is the identity
        texture: source === undefined ? null : source.identity,
        uniforms: LAYER_UNIFORMS.map(suffix => pass.uniforms[`u_${layer.slot}${suffix}`] ?? null),
      })),
      domain: domain.slot,
      team: pass.uniforms['u_teamColor'] ?? null,
    })
    let texture = bakedSurfaces.get(key)
    if (texture === undefined) {
      texture = (async () => {
        signal?.throwIfAborted()
        const inverse = invertAffine2(layerAffine(pass, domain)) ?? IDENTITY
        let width = base.texture.width, height = base.texture.height
        for (const { layer, source } of contributing) {
          if (source === undefined) continue
          const m = layerAffine(pass, layer)
          width = Math.max(width, Math.ceil(Math.hypot(
            (m[0] * inverse[0] + m[1] * inverse[2]) * source.texture.width,
            (m[2] * inverse[0] + m[3] * inverse[2]) * source.texture.height,
          )))
          height = Math.max(height, Math.ceil(Math.hypot(
            (m[0] * inverse[1] + m[1] * inverse[3]) * source.texture.width,
            (m[2] * inverse[1] + m[3] * inverse[3]) * source.texture.height,
          )))
        }
        width = Math.min(4096, width); height = Math.min(4096, height)
        const rgba = bakeProgramSurface(pass, domain, base.texture, contributing, width, height)
        const filter = base.texture.filter === 'nearest' ? NEAREST : LINEAR
        return imageTexture(`${id}#surface`, width, height, rgba, {
          magFilter: filter,
          minFilter: filter,
          wrapS: base.binding.wrapU === 'clamp' ? CLAMP : REPEAT,
          wrapT: base.binding.wrapV === 'clamp' ? CLAMP : REPEAT,
        })
      })()
      bakedSurfaces.set(key, texture)
    }
    const index = await texture
    if (index === undefined) return undefined
    const glowing = pass.blend === 'additive' || pass.blend === 'add-alpha' || pass.blend.startsWith('modulate')
    const unlit = pass.defines.unshaded || glowing
    if (unlit) unlitUsed = true
    const threshold = uniformOf(pass, 'u_alphaTestThreshold')
    const material = addMaterial({
      name: id,
      pbrMetallicRoughness: { baseColorTexture: { index }, metallicFactor: 0, roughnessFactor: 1 },
      ...(pass.blend === 'alpha-test'
        ? { alphaMode: 'MASK', alphaCutoff: threshold > 0 && threshold <= 1 ? threshold : 0.5 }
        : blended
          ? { alphaMode: 'BLEND' }
          : {}),
      ...(pass.twoSided ? { doubleSided: true } : {}),
      ...(unlit ? { extensions: { KHR_materials_unlit: {} } } : {}),
    })
    return Object.freeze({
      material,
      uvSet: MESH_UV_SETS.get(domain.uvSource)!,
      transform: layerAffine(pass, domain),
      vertexColors: pass.defines.usesVertexColor || pass.defines.usesVertexAlpha,
    })
  }

  const materialIndex = new Map<string, number>()
  // placed copies of one model carry equal materials: each distinct material is written once, as a
  // viewer compiles one shader per material
  const materialByContent = new Map<string, number>()
  const addMaterial = (entry: Record<string, unknown>): number => {
    const { name: _name, ...content } = entry
    const key = JSON.stringify(content)
    let index = materialByContent.get(key)
    if (index === undefined) {
      materials.push(entry)
      index = materials.length - 1
      materialByContent.set(key, index)
    }
    return index
  }
  const sceneMaterials = new Map<string, SceneRendererMaterial>(
    (scene.materials ?? []).map(material => [material.id, material]),
  )
  let missingTextures = 0
  const materialOf = async (id: string | undefined): Promise<number | undefined> => {
    if (id === undefined) return undefined
    const known = materialIndex.get(id)
    if (known !== undefined) return known
    let entry: Record<string, unknown>
    if (id === TERRAIN_MATERIAL) {
      const texture = await imageTexture(TERRAIN_MATERIAL, bakeWidth, bakeHeight, baked!, {
        magFilter: LINEAR,
        minFilter: LINEAR,
        wrapS: CLAMP,
        wrapT: CLAMP,
      })
      entry = {
        name: TERRAIN_MATERIAL,
        pbrMetallicRoughness: { baseColorTexture: { index: texture }, metallicFactor: 0, roughnessFactor: 1 },
        doubleSided: true,
      }
    } else {
      const material = sceneMaterials.get(id)
      if (material === undefined) return undefined
      const texture = await textureOf(material.baseColorTexture)
      if (material.baseColorTexture !== undefined && texture === undefined) missingTextures++
      const [r, g, b, a] = material.baseColor
      const unlit = material.shading === 'unlit' || material.simpleEffect !== undefined
      if (unlit) unlitUsed = true
      const alphaMode = material.alphaMode ?? 'opaque'
      entry = {
        name: id,
        pbrMetallicRoughness: {
          baseColorFactor: [clamp01(r), clamp01(g), clamp01(b), clamp01(a)],
          ...(texture === undefined ? {} : { baseColorTexture: { index: texture } }),
          metallicFactor: material.pbr?.metallic ?? 0,
          roughnessFactor: material.pbr?.roughness ?? 1,
        },
        ...(alphaMode === 'opaque' ? {} : { alphaMode: alphaMode === 'mask' ? 'MASK' : 'BLEND' }),
        ...(alphaMode === 'mask' ? { alphaCutoff: Math.min(1, material.alphaCutoff ?? 0.5) } : {}),
        ...(material.doubleSided === true ? { doubleSided: true } : {}),
        ...(unlit ? { extensions: { KHR_materials_unlit: {} } } : {}),
      }
    }
    const index = addMaterial(entry)
    materialIndex.set(id, index)
    return index
  }

  const meshes: Record<string, unknown>[] = []
  const nodes: Record<string, unknown>[] = []
  let triangles = 0
  let omitted = 0
  let reversed = 0
  let unknownCoverage = 0
  // One mesh per material: every primitive drawn with a material is merged into that material's
  // mesh, with its placement baked into the vertices, so a viewer loads as many draw objects and
  // shaders as there are distinct materials, not one per placed piece.
  const groups = new Map<string, MeshGroup>()
  const joinedGround = joinGroundRims(terrainPrimitives, id => splats.get(id)?.batch.maskTexture !== undefined)
  const groundAnchors = new Set<string>()
  for (const primitive of terrainPrimitives) {
    if (isTerrainLayer(primitive.id) || splats.get(primitive.id)?.batch.maskTexture !== undefined) continue
    const positions = (joinedGround.get(primitive.id) ?? placedPrimitive(primitive)).positions
    for (let index = 0; index < positions.length; index += 3) groundAnchors.add(groundSeamKey(positions, index))
  }
  for (const primitive of scene.primitives) {
    signal?.throwIfAborted()
    if (primitive.topology !== 'triangles' || primitive.hidden === true || isTerrainLayer(primitive.id)) {
      omitted++
      continue
    }
    // the blended ground takes the bake; terrain batches with a texture of their own (cliff pieces
    // the world draws with their terrain material) keep it, as the bake stretches on their walls
    const ground = terrain.has(primitive.id) && baked !== undefined && !primitive.id.startsWith('world/textured-')
    const mask = ground ? splats.get(primitive.id)?.batch : undefined
    const positioned = joinedGround.get(primitive.id) ?? placedPrimitive(primitive)
    const original = ground ? flatGroundNormals(positioned) : positioned
    const placed = mask?.maskTexture === undefined ? original : groundUnderRock(original, mask, groundAnchors)
    if (placed.positions.length < 9) continue
    const vertices = placed.positions.length / 3
    const normals = unitNormals(placed)
    let uv: Float32Array | undefined
    if (ground) {
      // planar UVs over the bake
      uv = new Float32Array(vertices * 2)
      for (let vertex = 0; vertex < vertices; vertex++) {
        uv[vertex * 2] = (placed.positions[vertex * 3]! - minX) / spanX
        uv[vertex * 2 + 1] = (placed.positions[vertex * 3 + 2]! - minZ) / spanZ
      }
    }
    const surface = ground ? undefined : await surfaceOf(primitive.materialId)
    if (surface === OMITTED_SURFACE) {
      unknownCoverage++
      continue
    }
    const coordinates =
      surface === undefined
        ? primitive.textureCoordinates
        : primitive.textureCoordinateSets?.find(set => set.set === surface.uvSet)?.coordinates ??
          (surface.uvSet === 0 ? primitive.textureCoordinates : undefined)
    if (!ground && coordinates !== undefined && coordinates.length === vertices * 2)
      uv = surface === undefined ? coordinates : transformedUvs(coordinates, surface.transform)
    const colors =
      !ground &&
      (surface === undefined || surface.vertexColors) &&
      primitive.colors !== undefined &&
      primitive.colors.length === vertices * 4
        ? primitive.colors.map(clamp01)
        : undefined
    const material = surface?.material ?? (await materialOf(ground ? TERRAIN_MATERIAL : primitive.materialId))
    const indices = frontFacing(placed, normals)
    if (indices !== placed.indices) reversed++
    const key = `${String(material)}|${normals === undefined ? 0 : 1}${uv === undefined ? 0 : 1}${colors === undefined ? 0 : 1}`
    let group = groups.get(key)
    if (group === undefined) {
      group = { material, names: [], positions: [], normals: [], uvs: [], colors: [], indices: [], vertices: 0, indexCount: 0 }
      groups.set(key, group)
    }
    group.names.push(primitive.id)
    group.positions.push(placed.positions)
    if (normals !== undefined) group.normals.push(normals)
    if (uv !== undefined) group.uvs.push(uv)
    if (colors !== undefined) group.colors.push(colors)
    const count = indices?.length ?? vertices - (vertices % 3)
    const offsetIndices = new Uint32Array(count)
    for (let index = 0; index < count; index++) offsetIndices[index] = (indices?.[index] ?? index) + group.vertices
    group.indices.push(offsetIndices)
    group.vertices += vertices
    group.indexCount += count
    triangles += count / 3
  }
  for (const group of groups.values()) {
    signal?.throwIfAborted()
    const attributes: Record<string, number> = { POSITION: floats(concatFloats(group.positions), 'VEC3', true) }
    if (group.normals.length > 0) attributes['NORMAL'] = floats(concatFloats(group.normals), 'VEC3')
    if (group.uvs.length > 0) attributes['TEXCOORD_0'] = floats(concatFloats(group.uvs), 'VEC2')
    if (group.colors.length > 0) attributes['COLOR_0'] = floats(concatFloats(group.colors), 'VEC4')
    const indices = new Uint32Array(group.indexCount)
    let at = 0
    for (const part of group.indices) {
      indices.set(part, at)
      at += part.length
    }
    const name =
      group.material === undefined
        ? 'untextured'
        : String((materials[group.material] as { name?: unknown } | undefined)?.name ?? `material-${String(group.material)}`)
    meshes.push({
      name,
      primitives: [
        {
          attributes,
          indices: indexAccessor(indices),
          ...(group.material === undefined ? {} : { material: group.material }),
          mode: 4,
        },
      ],
      extras: { pieces: group.names.length },
    })
    nodes.push({ name, mesh: meshes.length - 1 })
  }
  if (omitted > 0)
    diagnostics.push({
      code: 'x3.scene/world-gltf-primitives-omitted',
      message: `${omitted} primitives are not written: terrain layers held by the ground bake, lines or hidden geometry`,
      severity: 'information',
    })
  if (reversed > 0)
    diagnostics.push({
      code: 'x3.scene/world-gltf-winding-reversed',
      message: `${reversed} pieces hold triangles wound clockwise against their normals; those are reordered counter-clockwise, as glTF front faces are`,
      severity: 'information',
    })
  if (unknownCoverage > 0)
    diagnostics.push({
      code: 'x3.scene/world-gltf-coverage-unknown',
      message: `${unknownCoverage} see-through primitives are not written: their coverage mask reads another UV set or a missing texture`,
      severity: 'information',
    })
  if (skippedLayers > 0)
    diagnostics.push({
      code: 'x3.scene/world-gltf-layer-omitted',
      message: `${skippedLayers} material layers read through another UV set or a missing texture are not baked`,
      severity: 'information',
    })
  if (missingTextures > 0)
    diagnostics.push({
      code: 'x3.scene/world-gltf-texture-missing',
      message: `${missingTextures} materials name a texture that could not be written; they keep their base colour`,
      severity: 'warning',
    })

  const document = {
    asset: {
      version: '2.0',
      generator: 'Modkit world glTF (visual fallback)',
      extras: { units: 'world source units', upAxis: '+Y' },
    },
    ...(unlitUsed ? { extensionsUsed: ['KHR_materials_unlit'] } : {}),
    scene: 0,
    scenes: [{ name: 'world', nodes: nodes.map((_, index) => index) }],
    nodes,
    meshes,
    ...(materials.length === 0 ? {} : { materials }),
    ...(gltfTextures.length === 0 ? {} : { textures: gltfTextures, samplers, images }),
    accessors,
    bufferViews,
    buffers: [{ byteLength: binaryLength }],
  }
  const bytes = glbContainer(document, chunks, binaryLength)
  if (bytes.byteLength > maxBytes) throw new RangeError(`the world's glTF binary exceeds ${maxBytes} bytes`)
  return Object.freeze({
    bytes,
    stats: Object.freeze({
      meshes: meshes.length,
      triangles,
      materials: materials.length,
      images: images.length,
      omittedPrimitives: omitted,
    }),
    diagnostics: Object.freeze(diagnostics),
  })
}

/** M3 UV sources that read a mesh UV set, and the set they read (as material-sampling reads them). */
const MESH_UV_SETS: ReadonlyMap<number, number> = new Map([[0, 0], [6, 0], [1, 1], [9, 2], [10, 3]])
/** Uniforms that change one layer's sampled value, by suffix after `u_<slot>`. */
const LAYER_UNIFORMS = ['Color', 'Multiply', 'Add', 'AlphaFactor', 'UvAngle', 'UvOffset', 'UvTiling'] as const

/** u' = a·u + b·v + e, v' = c·u + d·v + f. */
type Affine = readonly [a: number, b: number, c: number, d: number, e: number, f: number]
const IDENTITY: Affine = [1, 0, 0, 1, 0, 0]

/** A layer the surface bake reads: textured with its binding, or a constant colour. */
type Contribution = Readonly<{
  layer: StandardLayerDefines
  source:
    | Readonly<{
        binding: { readonly resourceId: string; readonly wrapU: 'repeat' | 'clamp'; readonly wrapV: 'repeat' | 'clamp' }
        texture: SceneRendererTexture
        identity: number
      }>
    | undefined
}>

/** A blended program surface whose coverage cannot be baked: its primitives are not written. */
const OMITTED_SURFACE: ProgramSurface = Object.freeze({ material: -1, uvSet: 0, transform: IDENTITY, vertexColors: false })

interface ProgramSurface {
  readonly material: number
  /** The mesh UV set the baked texture is addressed by. */
  readonly uvSet: number
  /** The domain layer's UV transform, applied to that set per vertex. */
  readonly transform: Affine
  readonly vertexColors: boolean
}

function uniformOf(program: StandardMaterialProgram, name: string, index = 0, fallback = 0): number {
  const value = program.uniforms[name]
  return typeof value === 'number' ? value : (value?.[index] ?? fallback)
}

/**
 * A layer's UV transform as an affine map, the formula of the material shader (material-sampling
 * transformUv on a mesh UV source): rotate about the centre, move by the offset, tile about the centre.
 */
function layerAffine(program: StandardMaterialProgram, layer: StandardLayerDefines): Affine {
  if (!layer.hasUvTransform) return IDENTITY
  const prefix = `u_${layer.slot}`
  const angle = uniformOf(program, `${prefix}UvAngle`, 2)
  const c = Math.cos(angle), s = Math.sin(angle)
  const ou = uniformOf(program, `${prefix}UvOffset`, 0), ov = uniformOf(program, `${prefix}UvOffset`, 1)
  const tu = uniformOf(program, `${prefix}UvTiling`, 0, 1), tv = uniformOf(program, `${prefix}UvTiling`, 1, 1)
  return [c * tu, s * tu, -s * tv, c * tv, (-0.5 * c - 0.5 * s - ou) * tu + 0.5, (0.5 * s - 0.5 * c - ov) * tv + 0.5]
}

const applyAffine = (m: Affine, u: number, v: number): [number, number] => [
  m[0] * u + m[1] * v + m[4],
  m[2] * u + m[3] * v + m[5],
]

function invertAffine2(m: Affine): Affine | undefined {
  const det = m[0] * m[3] - m[1] * m[2]
  if (!(Math.abs(det) > 1e-12)) return undefined
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det
  return [a, b, c, d, -(a * m[4] + b * m[5]), -(c * m[4] + d * m[5])]
}

function transformedUvs(coordinates: Float32Array, transform: Affine): Float32Array {
  if (transform === IDENTITY) return coordinates
  const out = new Float32Array(coordinates.length)
  for (let index = 0; index < coordinates.length; index += 2) {
    const [u, v] = applyAffine(transform, coordinates[index]!, coordinates[index + 1]!)
    out[index] = u
    out[index + 1] = v
  }
  return out
}

/**
 * One RGBA8 image in the domain layer's texture space: the program's diffuse colour and its coverage
 * (diffuse alpha × alpha1 × alpha2), each layer through the shared M3 layer pipeline
 * (computeLayerColorCpu: channel select, team colour, invert, multiply, add, alpha factor, clamp).
 * Other layers are sampled at the same mesh UV through their own transforms; lighting, specular,
 * emissive, normals, fresnel and environment are not part of a base colour.
 */
function bakeProgramSurface(
  pass: StandardMaterialProgram,
  domain: StandardLayerDefines,
  domainTexture: SceneRendererTexture,
  contributing: readonly Contribution[],
  width: number,
  height: number,
): Uint8Array {
  const pixels = domainTexture.rgba
  const toMesh = invertAffine2(layerAffine(pass, domain)) ?? IDENTITY
  const team = [0, 1, 2].map(index => uniformOf(pass, 'u_teamColor', index, 1)) as [number, number, number]
  const plans = contributing.map(({ layer, source }) => {
    const prefix = `u_${layer.slot}`
    const constant = [0, 1, 2, 3].map(index => uniformOf(pass, `${prefix}Color`, index, 1)) as [
      number,
      number,
      number,
      number,
    ]
    const sample: Omit<CpuLayerSample, 'texel'> = {
      channels: layer.channels,
      op: layer.op,
      teamColorMode: layer.teamColorMode,
      invert: layer.invert,
      clampResult: layer.clampResult,
      ...(layer.hasColorMultiply ? { colorMultiply: uniformOf(pass, `${prefix}Multiply`, 0, 1) } : {}),
      ...(layer.hasColorAdd ? { colorAdd: uniformOf(pass, `${prefix}Add`) } : {}),
      ...(layer.hasAlphaFactor ? { alphaFactor: uniformOf(pass, `${prefix}AlphaFactor`, 0, 1) } : {}),
    }
    return { layer, source, constant, sample, transform: layerAffine(pass, layer) }
  })
  type Plan = (typeof plans)[number]
  const diffuse = plans.find(plan => plan.layer.slot === 'diffuse')
  const masks = plans.filter(plan => plan.layer.slot === 'alpha1' || plan.layer.slot === 'alpha2')
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const [mu, mv] = applyAffine(toMesh, (x + 0.5) / width, (y + 0.5) / height)
      const value = (plan: Plan) => {
        let texel: [number, number, number, number]
        if (plan.source === undefined) texel = plan.constant
        else if (plan.layer === domain && width === domainTexture.width && height === domainTexture.height)
          texel = [pixels[offset]! / 255, pixels[offset + 1]! / 255, pixels[offset + 2]! / 255, pixels[offset + 3]! / 255]
        else {
          const [u, v] = applyAffine(plan.transform, mu, mv)
          const sampled = sampleMaterialTexture(plan.source.texture, u, v, plan.source.binding.wrapU, plan.source.binding.wrapV)
          texel = [sampled[0] ?? 0, sampled[1] ?? 0, sampled[2] ?? 0, sampled[3] ?? 1]
        }
        return computeLayerColorCpu({ ...plan.sample, texel }, team)
      }
      const color = diffuse === undefined ? [0, 0, 0, 1] : value(diffuse)
      let alpha = color[3]!
      for (const mask of masks) alpha *= value(mask)[3]
      out[offset] = Math.round(clamp01(color[0]!) * 255)
      out[offset + 1] = Math.round(clamp01(color[1]!) * 255)
      out[offset + 2] = Math.round(clamp01(color[2]!) * 255)
      out[offset + 3] = Math.round(clamp01(alpha) * 255)
    }
  }
  return out
}

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0)

/** Unit normals, or none when absent or of the wrong length; zero vectors point up. */
function unitNormals(primitive: SceneRendererPrimitive): Float32Array | undefined {
  const source = primitive.normals
  if (source === undefined || source.length !== primitive.positions.length) return undefined
  const normals = new Float32Array(source.length)
  for (let index = 0; index < source.length; index += 3) {
    const x = source[index]!, y = source[index + 1]!, z = source[index + 2]!
    const length = Math.hypot(x, y, z)
    if (!(length > 1e-12) || !Number.isFinite(length)) normals[index + 1] = 1
    else {
      normals[index] = x / length
      normals[index + 1] = y / length
      normals[index + 2] = z / length
    }
  }
  return normals
}

/**
 * Triangle indices with glTF's counter-clockwise front faces. The world wires some batches clockwise
 * (it draws ground double-sided) and one flattened batch can hold mirrored and plain instances, so
 * each triangle facing against its own vertex normals has its last two corners swapped. Without
 * normals, or when every triangle agrees, the primitive's own indices stay (none for a plain list).
 */
function frontFacing(primitive: SceneRendererPrimitive, normals: Float32Array | undefined): Uint32Array | undefined {
  const own = primitive.indices
  const positions = primitive.positions
  if (normals === undefined) return own
  const count = own?.length ?? positions.length / 3
  let swapped: Uint32Array | undefined
  for (let corner = 0; corner + 2 < count; corner += 3) {
    const a = own?.[corner] ?? corner, b = own?.[corner + 1] ?? corner + 1, c = own?.[corner + 2] ?? corner + 2
    const ux = positions[b * 3]! - positions[a * 3]!, uy = positions[b * 3 + 1]! - positions[a * 3 + 1]!, uz = positions[b * 3 + 2]! - positions[a * 3 + 2]!
    const vx = positions[c * 3]! - positions[a * 3]!, vy = positions[c * 3 + 1]! - positions[a * 3 + 1]!, vz = positions[c * 3 + 2]! - positions[a * 3 + 2]!
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const dot = nx * (normals[a * 3]! + normals[b * 3]! + normals[c * 3]!) +
      ny * (normals[a * 3 + 1]! + normals[b * 3 + 1]! + normals[c * 3 + 1]!) +
      nz * (normals[a * 3 + 2]! + normals[b * 3 + 2]! + normals[c * 3 + 2]!)
    if (dot >= 0) continue
    if (swapped === undefined) {
      swapped = new Uint32Array(count - (count % 3))
      for (let index = 0; index < swapped.length; index++) swapped[index] = own?.[index] ?? index
    }
    swapped[corner + 1] = c
    swapped[corner + 2] = b
  }
  return swapped ?? own
}

/** The primitives of one material, merged into one mesh. */
interface MeshGroup {
  readonly material: number | undefined
  readonly names: string[]
  readonly positions: Float32Array[]
  readonly normals: Float32Array[]
  readonly uvs: Float32Array[]
  readonly colors: Float32Array[]
  readonly indices: Uint32Array[]
  vertices: number
  indexCount: number
}

function concatFloats(parts: readonly Float32Array[]): Float32Array {
  if (parts.length === 1) return parts[0]!
  let length = 0
  for (const part of parts) length += part.length
  const out = new Float32Array(length)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/**
 * A primitive with its placement baked into its vertices: positions through its column-major
 * transform, normals through the transform's linear part (renormalised afterwards; the placements a
 * world draws are rotations and scales). Without a transform the primitive itself.
 */
function placedPrimitive(primitive: SceneRendererPrimitive): SceneRendererPrimitive {
  const m = primitive.transform
  if (m === undefined || isIdentity(m)) return primitive
  const source = primitive.positions
  const positions = new Float32Array(source.length)
  for (let index = 0; index < source.length; index += 3) {
    const x = source[index]!, y = source[index + 1]!, z = source[index + 2]!
    positions[index] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
    positions[index + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!
    positions[index + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
  }
  let normals: Float32Array | undefined
  if (primitive.normals !== undefined) {
    // the inverse transpose of the linear part, by cofactors (the determinant only scales, and the
    // normals are renormalised): right for non-uniform scales and mirrors as well
    // M = [[a, d, g], [b, e, h], [c, f, i]] (column-major m); normal' = cofactor(M) · normal / det(M)
    const a = m[0]!, b = m[1]!, c = m[2]!, d = m[4]!, e = m[5]!, f = m[6]!, g = m[8]!, h = m[9]!, i = m[10]!
    const c00 = e * i - h * f, c01 = h * c - b * i, c02 = b * f - e * c
    const c10 = g * f - d * i, c11 = a * i - g * c, c12 = d * c - a * f
    const c20 = d * h - g * e, c21 = g * b - a * h, c22 = a * e - d * b
    const sign = a * c00 + d * c01 + g * c02 < 0 ? -1 : 1
    const input = primitive.normals
    normals = new Float32Array(input.length)
    for (let index = 0; index < input.length; index += 3) {
      const x = input[index]!, y = input[index + 1]!, z = input[index + 2]!
      normals[index] = sign * (c00 * x + c01 * y + c02 * z)
      normals[index + 1] = sign * (c10 * x + c11 * y + c12 * z)
      normals[index + 2] = sign * (c20 * x + c21 * y + c22 * z)
    }
  }
  const { transform: _transform, ...rest } = primitive
  return { ...rest, positions, ...(normals === undefined ? {} : { normals }) }
}

/** Shared plateau vertices are identified at the world renderer's small seam tolerance. */
const groundSeamKey = (positions: Float32Array, index: number): string =>
  [0, 1, 2].map(axis => Math.round(positions[index + axis]! * 10_000)).join(':')

/** Undo small rendering offsets where height-field vertices meet a cliff's ground copy. */
function joinGroundRims(
  primitives: readonly SceneRendererPrimitive[],
  masked: (id: string) => boolean,
): ReadonlyMap<string, SceneRendererPrimitive> {
  const key = (p: Float32Array, i: number) => `${Math.round(p[i]! * 10_000)}:${Math.round(p[i + 2]! * 10_000)}`
  const heights = new Map<string, Set<number>>()
  for (const primitive of primitives) {
    if (!masked(primitive.id)) continue
    const placed = placedPrimitive(primitive), p = placed.positions, n = unitNormals(placed)
    for (let i = 0; i < p.length; i += 3) {
      if ((n?.[i + 1] ?? 0) < 0.5) continue
      const at = key(p, i)
      let values = heights.get(at)
      if (values === undefined) heights.set(at, values = new Set())
      values.add(p[i + 1]!)
    }
  }
  const joined = new Map<string, SceneRendererPrimitive>()
  for (const primitive of primitives) {
    if (masked(primitive.id) || isTerrainLayer(primitive.id) || primitive.id.startsWith('world/textured-')) continue
    const placed = placedPrimitive(primitive), p = placed.positions.slice()
    for (let i = 0; i < p.length; i += 3) {
      // World ground presentation separates fills by up to 0.02; preserve distinct elevations.
      let distance = 0.021, height = p[i + 1]!
      for (const candidate of heights.get(key(p, i)) ?? []) {
        const delta = Math.abs(candidate - p[i + 1]!)
        if (delta < distance) { distance = delta; height = candidate }
      }
      p[i + 1] = height
    }
    joined.set(primitive.id, { ...placed, positions: p })
  }
  return joined
}

/** Unindexed world ground draws shade horizontal faces alike, without borrowed cliff bevels. */
function flatGroundNormals(primitive: SceneRendererPrimitive): SceneRendererPrimitive {
  const normals = unitNormals(primitive)
  if (normals === undefined) return primitive
  const p = primitive.positions
  for (let from = 0; from + 8 < p.length; from += 9) {
    const u = [0, 1, 2].map(axis => p[from + 3 + axis]! - p[from + axis]!)
    const v = [0, 1, 2].map(axis => p[from + 6 + axis]! - p[from + axis]!)
    const nx = u[1]! * v[2]! - u[2]! * v[1]!, ny = u[2]! * v[0]! - u[0]! * v[2]!, nz = u[0]! * v[1]! - u[1]! * v[0]!
    const length = Math.hypot(nx, ny, nz)
    if (length > 0 && Math.abs(ny) >= 0.999999 * length)
      for (let corner = 0; corner < 3; corner++) normals.set([0, 1, 0], from + corner * 3)
  }
  return { ...primitive, normals }
}

/**
 * Opaque terrain behind an alpha-tested rock. A small inward bias avoids coincident surfaces;
 * shared plateau vertices stay fixed, so no open seam is introduced. Keeping the common opaque
 * bake avoids filtering unrelated triangle-chart masks in ordinary glTF viewers. Only faces whose
 * entire filtered UV rectangle is covered by rock may be dropped; slope never decides coverage.
 */
function groundUnderRock(
  primitive: SceneRendererPrimitive,
  batch: WorldWebGlSplatBatch,
  anchors: ReadonlySet<string>,
): SceneRendererPrimitive {
  const source = primitive.positions, normals = unitNormals(primitive)
  const mask = batch.maskTexture!, uv = batch.maskTextureCoordinates!
  const pixels = sceneTexturePixels(mask), channel = Math.max(0, Math.min(3, batch.maskChannel ?? 3))
  // Include bilinear neighbours; repeated rectangles never need more than one image period.
  const canShowGround = (vertices: readonly number[]) => {
    const range = (axis: number, size: number, wrap: 'repeat' | 'clamp') => {
      const values = vertices.map(vertex => uv[vertex * 2 + axis]! * size - 0.5)
      let first = Math.floor(Math.min(...values)), last = Math.ceil(Math.max(...values))
      if (wrap === 'clamp') {
        first = Math.max(0, Math.min(size - 1, first)); last = Math.max(0, Math.min(size - 1, last))
      }
      return [first, Math.min(size, last - first + 1)] as const
    }
    const [x, columns] = range(0, mask.width, mask.wrapU ?? 'repeat')
    const [y, rows] = range(1, mask.height, mask.wrapV ?? 'repeat')
    // Culling is optional: a broad repeated mask must not scan a whole large image per face.
    if (columns * rows > 4096) return true
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const u = ((x + column) % mask.width + mask.width) % mask.width
      const v = ((y + row) % mask.height + mask.height) % mask.height
      if (pixels[(v * mask.width + u) * 4 + channel]! < 128) return true
    }
    return false
  }
  const count = primitive.indices?.length ?? source.length / 3, kept: number[] = []
  for (let corner = 0; corner + 2 < count; corner += 3) {
    const vertices = [0, 1, 2].map(offset => primitive.indices?.[corner + offset] ?? corner + offset)
    if (!canShowGround(vertices)) continue
    kept.push(...vertices)
  }
  const positions = new Float32Array(kept.length * 3)
  const copiedNormals = normals === undefined ? undefined : new Float32Array(kept.length * 3)
  for (const [index, vertex] of kept.entries()) {
    const from = vertex * 3, bias = anchors.has(groundSeamKey(source, from)) ? 0 : 0.001
    for (let axis = 0; axis < 3; axis++) {
      const normal = normals?.[from + axis] ?? (axis === 1 ? 1 : 0)
      positions[index * 3 + axis] = source[from + axis]! - bias * normal
      if (copiedNormals !== undefined) copiedNormals[index * 3 + axis] = normal
    }
  }
  return { id: primitive.id, topology: 'triangles', positions,
    ...(copiedNormals === undefined ? {} : { normals: copiedNormals }) }
}

/**
 * Texels of the ground bake that no ground covered (alpha 0) take the colour of the nearest covered
 * texel, breadth first: bilinear filtering at a covered edge and a ground copy seen where the rock
 * is cleared then read ground colour, not the clear black.
 */
function fillUncovered(rgba: Uint8Array, width: number, height: number): void {
  const total = width * height
  const queue = new Uint32Array(total)
  let head = 0,
    tail = 0
  for (let texel = 0; texel < total; texel++) if (rgba[texel * 4 + 3]! > 0) queue[tail++] = texel
  if (tail === 0 || tail === total) return
  while (head < tail) {
    const texel = queue[head++]!
    const x = texel % width,
      y = (texel - x) / width
    for (const next of [x > 0 ? texel - 1 : -1, x + 1 < width ? texel + 1 : -1, y > 0 ? texel - width : -1, y + 1 < height ? texel + width : -1]) {
      if (next < 0 || rgba[next * 4 + 3]! > 0) continue
      rgba.copyWithin(next * 4, texel * 4, texel * 4 + 3)
      rgba[next * 4 + 3] = 1
      queue[tail++] = next
    }
  }
}

function isIdentity(matrix: Float32Array): boolean {
  for (let index = 0; index < 16; index++)
    if (matrix[index] !== (index % 5 === 0 ? 1 : 0)) return false
  return true
}

/** GLB 2: header, JSON chunk padded with spaces, BIN chunk padded with zeros. */
function glbContainer(document: unknown, chunks: readonly Uint8Array[], binaryLength: number): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(document))
  const jsonLength = json.byteLength + ((4 - (json.byteLength % 4)) % 4)
  const binLength = binaryLength + ((4 - (binaryLength % 4)) % 4)
  const total = 12 + 8 + jsonLength + (binLength > 0 ? 8 + binLength : 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, jsonLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  out.set(json, 20)
  out.fill(0x20, 20 + json.byteLength, 20 + jsonLength)
  if (binLength > 0) {
    let offset = 20 + jsonLength
    view.setUint32(offset, binLength, true)
    view.setUint32(offset + 4, 0x004e4942, true)
    offset += 8
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.byteLength
    }
  }
  return out
}
