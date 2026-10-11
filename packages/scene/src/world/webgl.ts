import {
  Box3,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Sphere,
  Vector2,
  Vector3,
} from 'three'
import type {
  MapModelComponentPlacement,
  MapTerrainMaterialDefinition,
  MapTerrainMaterialSample,
  MapTerrainWeightRaster,
  MapWaterMaterialDefinition,
  WorldSceneItem,
  WorldSceneModelResult,
  WorldSceneObjectItem,
  WorldSceneTerrainItem,
  WorldToneMapping,
  WorldTerrainLighting,
  WorldShadowRange,
  WorldHeightFog,
  MapWorldCamera,
} from '@modkit/sdk/maps'
import { transformTerrainUv, type MapTerrainUvTransform } from '@modkit/sdk/maps'
import type {
  ModelMaterialRef,
  SceneRendererMaterial,
  SceneRendererPrimitive,
  SceneRendererTexture,
} from '@modkit/sdk'
import { boundsOf } from '@modkit/codec-kit/model/bounds'
import { invertAffine, linearStretch } from '@modkit/codec-kit/model-math/transform'
import {
  TEAM_COLOR_BLENDS,
  TEAM_COLOR_GLSL,
  TEAM_MASK_GLSL,
  TEAM_RAMP_MAX,
  teamColorChannel,
  type TeamMaskRule,
} from '@modkit/codec-kit/model-math/color-remap'
import { teamMaskRule } from '../render/team-color.js'
import { WORLD_SHADOW_GLSL } from '../render/world-shadow.js'
import { createModelSceneSampler, modelMaterialTeamColor } from '../model/index.js'
import type { ModelSceneSkin } from '../model/sampler.js'
import {
  decomposeMatrix4,
  invertQuat,
  multiplyQuat,
  quaternionFromRotationMatrix,
} from '../model/billboard-math.js'
import { createUvmEffectSource, type UvmEffectSource } from '../uvm/effect-source.js'
import { TERRAIN_RECEIVER_ID } from '../uvm/projectors.js'
import {
  createUvmProjectorFrameCache,
  projectedSplatLayer,
  type UvmProjectorFrameCache,
} from '../uvm/projectors.js'
import {
  materialCanInstance,
  materialWebGlDraws,
  type MaterialInstances,
  type MaterialSceneLight,
  type MaterialSequenceDraw,
} from '../render/material-webgl.js'
import type { StandardMaterialProgram } from '../materials/index.js'
import { primitiveTint, primitiveVertexTints } from '../render/tint.js'
import { mergeMaterialDraws, primitiveVertexPlacements } from '../render/vertex-placements.js'
import {
  materialPosedPrimitive,
  materialSkinBounds,
  materialSkinCenter,
  materialSkinOf,
} from '../render/material-skin.js'
import {
  materialIsSolid,
  sameMaterialGeometry,
  sceneMaterialDraws,
  type MaterialDraw,
} from '../render/material-draws.js'
import { materialMirrors, materialModelMatrix } from '../render/material-geometry.js'
import {
  createSceneMaterialProgramSampler,
  sampleSceneMaterialPrograms,
  type SceneMaterialContext,
  type SceneMaterialProgramSampler,
  type SceneMaterialPrograms,
} from '../render/materials.js'
import { applyTextureFilter } from '../render/texture-filtering.js'
import {
  sceneTextureByteLength,
  sceneTexturePixels,
  uploadCompressedTexture,
  uploadCompressedTextureArray,
} from '../render/compressed-textures.js'
import { uniformLocation } from '../materials/webgl.js'
import { invertMaterialFrame } from '../materials/frame.js'
import { textureNormalFormat } from '../materials/normal-maps.js'
import { DEFAULT_SCENE_ENVIRONMENT } from '../materials/environment.js'
import { createWorldToneMapper } from './tone-mapping.js'
import { transparentOrderLevels } from './transparent-order.js'

export interface WorldWebGlInput {
  readonly items: readonly WorldSceneItem[]
  readonly models?: ReadonlyMap<string, WorldSceneModelResult>
  /** Material catalog and host-decoded raster resources for terrain shading. */
  readonly terrainMaterials?: readonly MapTerrainMaterialDefinition[]
  readonly terrainWeightRasters?: readonly MapTerrainWeightRaster[]
  readonly terrainTextures?: ReadonlyMap<string, SceneRendererTexture>
  readonly waterMaterials?: readonly MapWaterMaterialDefinition[]
  readonly selectedObjectId?: number
  readonly previewPosition?: Readonly<{ x: number; y: number; z: number }>
  readonly camera?: WorldWebGlCamera
  /** Per-object playback time so repeated instances do not share mutable animation state. */
  readonly animationTimes?: ReadonlyMap<number, number>
  /** Explicit source/player colours. Missing entries retain the standalone material default. */
  readonly teamColors?: ReadonlyMap<number, readonly [number, number, number]>
  /** Player slots' own shades for indexed team-colour ramps (MapPlayer.colorRamp). */
  readonly teamRamps?: ReadonlyMap<number, readonly (readonly [number, number, number])[]>
  /** Global initial-world clock used by actor animations and scrolling water surfaces. */
  readonly timeSeconds?: number
  /**
   * Draw a marker for each map point and camera, which have no model: start locations, sound
   * emitters, no-fly zones (SC2 `ObjectPoint`). The game draws nothing there, so a world view shows
   * them only when asked, as the editor does; a selected one is always marked.
   */
  readonly editorMarkers?: boolean
  /** Render one directional-light depth map and apply it to world lighting. */
  readonly shadows?: boolean
  /** Requested square depth-map size; bounded by WebGL2 limits and 4096. */
  readonly shadowMapSize?: number
}

export interface WorldWebGlCamera {
  readonly azimuth: number
  readonly elevation: number
  readonly zoom: number
  readonly target: readonly [number, number, number]
  /**
   * `perspective` (MW6): the eye stands where a lens of `fieldOfView` frames the height the
   * orthographic view shows at the target at this zoom, the view reaches `far`, and the elevation may
   * look up (below 0). Absent or `orthographic`: the orbit camera of a map editor.
   */
  readonly projection?: 'orthographic' | 'perspective'
  /** Vertical field of view of a perspective camera, radians (default 60°). */
  readonly fieldOfView?: number
  /** How far a perspective camera draws, in world units (the game's draw distance); absent, ten
   * frame radii beyond the target. */
  readonly far?: number
  /**
   * What `target` and `zoom` are measured in; absent, the plan's own (WorldWebGlStats.frame). A
   * viewer pins the frame it showed before its world moves to another part (MW5), so the view stays.
   */
  readonly frame?: WorldWebGlFrame
}

/** The point a camera's target offsets and the radius its zoom divides: a plan's middle and 0.65 of
 * its diagonal (at least 1). */
export interface WorldWebGlFrame {
  readonly center: readonly [number, number, number]
  readonly radius: number
}

export interface WorldWebGlCameraFrame {
  readonly viewProjection: Float32Array
  readonly viewMatrix: Float32Array
  readonly eyePosition: readonly [number, number, number]
}

export const DEFAULT_WORLD_WEBGL_CAMERA: WorldWebGlCamera = Object.freeze({
  azimuth: (3 * Math.PI) / 4,
  elevation: 0.52,
  zoom: 1,
  target: Object.freeze([0, 0, 0] as const),
})

export interface WorldWebGlStats {
  readonly terrainTriangles: number
  readonly terrainTexturedTriangles: number
  readonly terrainSplatFallbackCells: number
  /** Triangles of decal tiles drawn over the ground. */
  readonly terrainDecalTriangles: number
  readonly waterPolygons: number
  readonly cliffEdges: number
  readonly cliffTriangles: number
  readonly objectInstances: number
  /**
   * Objects with a model primitive drawn by a material program (the shared GPU path), and objects
   * with a model triangle written to the plan's batches (the CPU fallback); an object of both counts
   * in each.
   */
  readonly programObjects: number
  readonly fallbackObjects: number
  readonly modelTriangles: number
  readonly navigationSamples: number
  readonly gatewaySegments: number
  readonly regionShapes: number
  readonly diagnosticPlaceholders: number
  readonly shadowCasterTriangles: number
  readonly shadowMapSize: number
  /** The plan's own camera frame (WorldWebGlCamera.frame). */
  readonly frame: WorldWebGlFrame
}

/** Observable retained-resource counters used by the UI and performance receipts. */
export interface WorldWebGlRendererStats {
  readonly frames: number
  readonly programCompilations: number
  /** Actual material draw submissions, including shadow passes and retired material leases. */
  readonly materialDrawCalls: number
  readonly shadowTargetAllocations: number
  readonly shadowTargetReuses: number
  readonly worldPlanBuilds: number
  readonly worldPlanReuses: number
  /**
   * Over the plans this renderer made, cumulative: objects kept from the plan before (their
   * contribution reused), objects built again, and model samples (poses) made. A still object is
   * kept; an animated one is built each frame, its pose shared with the instances at its clock.
   */
  readonly worldObjectsKept: number
  readonly worldObjectsBuilt: number
  readonly worldPosedSamples: number
  /**
   * Of the kept objects, cumulative: those a plan left in the pose they had, as the view it was drawn
   * with could see none of their poses nor their shadows (WorldPosingView); and the plans made again
   * because a view came to see one.
   */
  readonly worldObjectsUnposed: number
  readonly worldPlanViewRebuilds: number
  /** Updates that retained ground/cliff preparation and rebuilt only the dynamic sections. */
  readonly worldPlanDynamicUpdates: number
  readonly worldPlanDynamicUpdateSamples: number
  readonly worldPlanDynamicUpdateP50Milliseconds?: number
  readonly worldPlanDynamicUpdateP95Milliseconds?: number
  readonly worldPlanBuildSamples: number
  readonly worldPlanBuildP50Milliseconds?: number
  readonly worldPlanBuildP95Milliseconds?: number
  readonly animationSeekSamples: number
  readonly animationSeekP50Milliseconds?: number
  readonly animationSeekP95Milliseconds?: number
  readonly geometryUploads: number
  readonly geometryCacheHits: number
  readonly geometryDisposals: number
  readonly geometryEntries: number
  readonly geometryBytesRetained: number
  readonly materialBufferEntries: number
  readonly materialBufferBytesRetained: number
  readonly materialVertexArrayEntries: number
  /**
   * Vertex arrays and buffers the material path made, cumulative: a frame whose models and
   * geometry stay makes none (moving placements and sorted indices reuse their vertex arrays).
   */
  readonly materialVertexArraysCreated: number
  readonly materialBuffersCreated: number
  /**
   * Placements the material draws submitted, cumulative: an instanced draw counts its instances.
   * Over materialDrawCalls, how many placements a draw carries.
   */
  readonly materialPlacementsDrawn: number
  readonly textureUploads: number
  readonly textureCacheHits: number
  readonly textureDisposals: number
  readonly textureEntries: number
  readonly textureBytesRetained: number
  /** CPU typed-array storage retained by the immutable canonical draw/picking plan. */
  readonly worldPlanBytesRetained: number
  /** Observable DEPTH_COMPONENT24 allocation, conservatively charged as four bytes per texel. */
  readonly shadowTargetBytesRetained: number
  /** Known buffer/texture/depth bytes; WebGL does not expose driver shader/program allocations. */
  readonly knownGpuBytesRetained: number
  readonly gpuProgramBytesObservable: false
  readonly cpuFrameSamples: number
  readonly cpuFrameP50Milliseconds?: number
  readonly cpuFrameP95Milliseconds?: number
  readonly gpuTimerSupported: boolean
  readonly gpuFrameSamples: number
  readonly gpuFrameP50Milliseconds?: number
  readonly gpuFrameP95Milliseconds?: number
  readonly disposed: boolean
}

/**
 * A canvas-bound renderer keeps immutable shader programs and its depth target across redraws.
 * Callers own the lifetime and must dispose it when the viewer closes.
 */
export interface WorldWebGlRenderer {
  draw(input: WorldWebGlInput): WorldWebGlStats
  pick(input: WorldWebGlInput, screen: WorldWebGlPickScreen): WorldWebGlPick | undefined
  stats(): WorldWebGlRendererStats
  dispose(): void
}

interface MutableBatch {
  readonly positions: number[]
  readonly normals: number[]
  readonly colors: number[]
}

interface MutableTexturedBatch extends MutableBatch {
  readonly overlayAlpha?: MapTerrainMaterialDefinition['overlayAlpha']
  readonly textureCoordinates: number[]
  readonly secondaryTextureCoordinates?: number[]
  /**
   * The base texture is an atlas of tiles in this grid (MapTerrainMaterialDefinition.atlas); the
   * secondary coordinates are then the cell's grid coordinates, by which the shader keeps each
   * sample inside its tile at the mip level it reads.
   */
  readonly atlas?: AtlasGrid
  readonly texture: NonNullable<
    Extract<WorldSceneModelResult, { state: 'converted' }>['textures']
  >[number]
  readonly normalTexture?: NonNullable<
    Extract<WorldSceneModelResult, { state: 'converted' }>['textures']
  >[number]
  readonly secondaryTexture?: NonNullable<
    Extract<WorldSceneModelResult, { state: 'converted' }>['textures']
  >[number]
  /** How normalTexture spells the normal (normalSwizzleOf); absent is plain RGB. */
  readonly normalSwizzle?: number
  /** A terrain decal tile's specular map (MapTerrainMaterialDefinition.specularResource). */
  readonly specularTexture?: SceneRendererTexture
  readonly specularGloss?: boolean
  /** Water shaded per pixel by its detail waves (MapWaterDetailWaves). */
  readonly waterDetail?: WorldWebGlWaterDetail
  readonly alphaCutoff?: number
  readonly castShadows?: boolean
  readonly receiveShadows?: boolean
  /** Drawn without the scene light: the surface as it is (ModelMaterialRef.unlit). */
  readonly unlit?: boolean
  /** Among transparent draws, a higher priority draws later (ModelMaterialRef.priority). */
  readonly priority?: number
  /** The team colour of a model material the shared path does not draw. */
  readonly team?: WorldBatchTeamColor
}

/**
 * A model batch's `UV_game_material_team_color` as the world shader applies it (codec-kit
 * TEAM_COLOR_GLSL): its mask (on the secondary unit, which model batches leave free) weighs the
 * object's team colour into the albedo; without a mask the whole material takes it.
 */
export interface WorldBatchTeamColor {
  readonly mask?: SceneRendererTexture
  /** Mask channel 0-3, or 4 for one weight per channel. */
  readonly channel: number
  /** TEAM_COLOR_BLENDS index. */
  readonly blend: number
  readonly strength: number
  readonly color: readonly [number, number, number]
  /** How the mask weighs it: data channel, key or indexed ramp (TEAM_MASK_GLSL). */
  readonly rule: TeamMaskRule
  /** The colour is the object's tint, which then tints nothing else of the material. */
  readonly objectTint?: true
}

/** What of a team colour separates one batch from another. */
function worldTeamKey(team: WorldBatchTeamColor | undefined): string {
  if (team === undefined) return ''
  const rule = team.rule
  return [
    team.mask?.id ?? 'whole',
    team.channel,
    team.blend,
    team.strength,
    team.color.join(','),
    rule.mode,
    rule.thresholds?.join(',') ?? '',
    rule.intensity ?? '',
    rule.shades?.map(shade => shade.join(',')).join(';') ?? '',
    rule.first ?? '',
    rule.scale ?? '',
    rule.tintRgb === true ? 'tint' : '',
  ].join(':')
}

interface MutableSplatBatch extends MutableBatch {
  /** A cliff piece's surface drawn as terrain where this texture's alpha (its blend mask) is clear. */
  readonly maskTexture?: SceneRendererTexture
  readonly maskTextureCoordinates?: number[]
  /** Which texel channel holds the mask: 0-2 colour, 3 alpha. */
  readonly maskChannel?: number
  readonly specularTextures?: readonly (SceneRendererTexture | undefined)[]
  /** The specular maps hold a gloss in red (MapTerrainMaterialDefinition.specularEncoding). */
  readonly specularGloss?: boolean
  readonly textureCoordinates: readonly number[][]
  readonly textureWeights0: number[]
  readonly textureWeights1: number[]
  readonly textures: readonly SceneRendererTexture[]
  /** Layer-aligned tangent-space normals; an absent entry is the flat [0,0,1] normal. */
  readonly normalTextures: readonly (SceneRendererTexture | undefined)[]
  /** Layer-aligned normalSwizzleOf: 1 X in alpha and Y in green (DXN), 2 Y against v. */
  readonly normalSwizzles: readonly number[]
  /** Layer-aligned colour each layer's texture is multiplied by (baseColorFactor); absent is white. */
  readonly layerColors?: readonly (readonly [number, number, number])[]
  readonly weightTextures?: readonly SceneRendererTexture[]
  readonly weightTextureCoordinates?: number[]
}

export interface WorldWebGlBatch {
  readonly positions: Float32Array
  readonly normals: Float32Array
  readonly colors: Float32Array
}

export interface WorldWebGlShadowControlledBatch extends WorldWebGlBatch {
  readonly castShadows: boolean
  readonly receiveShadows: boolean
}

export interface WorldWebGlTexturedBatch extends WorldWebGlBatch {
  readonly overlayAlpha?: MapTerrainMaterialDefinition['overlayAlpha']
  readonly textureCoordinates: Float32Array
  readonly secondaryTextureCoordinates?: Float32Array
  readonly atlas?: AtlasGrid
  readonly texture: MutableTexturedBatch['texture']
  readonly normalTexture?: MutableTexturedBatch['normalTexture']
  readonly normalSwizzle?: number
  readonly specularTexture?: SceneRendererTexture
  readonly specularGloss?: boolean
  readonly waterDetail?: WorldWebGlWaterDetail
  readonly secondaryTexture?: MutableTexturedBatch['secondaryTexture']
  /** Zero/absent is solid coverage; a positive value discards lower-alpha texels in all passes. */
  readonly alphaCutoff?: number
  readonly castShadows?: boolean
  readonly receiveShadows?: boolean
  /** Drawn without the scene light: the surface as it is (ModelMaterialRef.unlit). */
  readonly unlit?: boolean
  /** Among transparent draws, a higher priority draws later (ModelMaterialRef.priority). */
  readonly priority?: number
  readonly team?: WorldBatchTeamColor
}

export interface WorldWebGlTransparentTexturedBatch extends WorldWebGlTexturedBatch {
  readonly blendMode: 'blend' | 'additive'
  readonly receiveShadows: boolean
  /**
   * The splat layer of the projector decals this batch holds (projectedSplatLayer): such a batch is
   * part of the ground and draws in the splat pass (worldSplatEntries), not in depth order.
   */
  readonly splatLayer?: number
}

/**
 * A back-to-front run of one transparent source batch: `range` selects its sorted triangles from a
 * per-orientation index list, so the batch's vertex buffers stay uploaded across camera changes.
 */
export interface WorldWebGlTransparentRange {
  readonly indices: Uint32Array
  /** Offset into `indices` (index count, not bytes). */
  readonly first: number
  readonly count: number
  /** Mean projection of the run's triangles on the camera direction (larger is nearer). */
  readonly depth: number
}

export type WorldWebGlTransparentDraw =
  | Readonly<{
      kind: 'untextured'
      blendMode: 'blend'
      receiveShadows: false
      batch: WorldWebGlBatch
      range: WorldWebGlTransparentRange
    }>
  | Readonly<{
      kind: 'textured'
      blendMode: 'blend' | 'additive'
      receiveShadows: boolean
      batch: WorldWebGlTexturedBatch
      range: WorldWebGlTransparentRange
    }>

export interface WorldWebGlSplatBatch extends WorldWebGlBatch {
  /**
   * Cliff surfaces drawn as terrain only where this texture's alpha is below one half: SC2 shows the
   * ground through a cliff piece by its terrain blend mask (TerrainAlphaMask), per pixel.
   */
  readonly maskTexture?: SceneRendererTexture
  readonly maskTextureCoordinates?: Float32Array
  /** Which texel channel holds the mask: 0-2 colour, 3 alpha. */
  readonly maskChannel?: number
  readonly specularTextures?: readonly (SceneRendererTexture | undefined)[]
  readonly specularGloss?: boolean
  readonly textureCoordinates: readonly Float32Array[]
  readonly textureWeights0: Float32Array
  readonly textureWeights1: Float32Array
  readonly textures: readonly SceneRendererTexture[]
  readonly normalTextures: readonly (SceneRendererTexture | undefined)[]
  readonly normalSwizzles: readonly number[]
  readonly layerColors?: readonly (readonly [number, number, number])[]
  readonly weightTextures?: readonly SceneRendererTexture[]
  readonly weightTextureCoordinates?: Float32Array
}

/**
 * One water material's zones as flat planes at their elevation. A renderer that can read the opaque
 * scene's depth draws these instead of the terrain-clipped water triangles: the depth under each
 * pixel is measured to whatever the scene drew there (cliff meshes included), so shorelines follow
 * the rendered ground rather than steps of the height grid, and submerged rock is covered.
 */
export interface WorldWebGlWaterPlane {
  /** Zone rectangles as triangles; the vertex colour is the material colour at depth zero. */
  readonly batch: WorldWebGlBatch
  readonly colorFalloff: number
  readonly receiveShadows: boolean
  readonly caustics?: WorldWebGlWaterCaustics
  readonly waves?: WorldWebGlWaterWaves
}

/**
 * The surface's wave normals (SC2 Water.fx WaterNormal): one image holding two normals (red/green and
 * blue/alpha), sampled at the map position times `tiling`, moved by `scroll` (two pairs, UV per
 * second); they light the surface and its key-light highlight (`specularity`, `specularScale`).
 */
export interface WorldWebGlWaterWaves {
  readonly texture: SceneRendererTexture
  readonly tiling: readonly [number, number]
  readonly scroll: readonly [number, number, number, number]
  readonly specularity: number
  readonly specularScale: number
}

/** A water material's detail waves (MapWaterDetailWaves) with their images resolved. */
export interface WorldWebGlWaterDetail {
  readonly color: readonly [number, number, number]
  readonly normals: readonly [SceneRendererTexture, SceneRendererTexture]
  readonly foam?: readonly [SceneRendererTexture, SceneRendererTexture]
  readonly sampleScroll: readonly number[]
  readonly upScale: number
  readonly depthRange: number
}

const waterDetailCache = new WeakMap<object, WorldWebGlWaterDetail>()

/** The detail waves of a water material whose normal images arrived; one object while nothing changes. */
function waterDetailOf(
  material: MapWaterMaterialDefinition | undefined,
  textures: WorldWebGlInput['terrainTextures'],
): WorldWebGlWaterDetail | undefined {
  const detail = material?.detailWaves
  if (material === undefined || detail === undefined || material.compositing === 'multiply') return undefined
  const normals = detail.normalResourceIds.map(resourceId => textures?.get(resourceId))
  if (normals[0] === undefined || normals[1] === undefined) return undefined
  const foam = (detail.foamResourceIds ?? []).map(resourceId => textures?.get(resourceId))
  const cached = waterDetailCache.get(material)
  if (
    cached !== undefined &&
    cached.normals[0] === normals[0] &&
    cached.normals[1] === normals[1] &&
    cached.foam?.[0] === foam[0] &&
    cached.foam?.[1] === foam[1]
  )
    return cached
  const resolved = Object.freeze({
    color: Object.freeze([material.color[0], material.color[1], material.color[2]] as const),
    normals: Object.freeze([normals[0], normals[1]] as const),
    ...(foam[0] === undefined || foam[1] === undefined
      ? {}
      : { foam: Object.freeze([foam[0], foam[1]] as const) }),
    sampleScroll: Object.freeze([...detail.sampleScroll]),
    upScale: detail.upScale,
    depthRange: detail.depthRange,
  })
  waterDetailCache.set(material, resolved)
  return resolved
}

const waterWavesCache = new WeakMap<object, WorldWebGlWaterWaves>()

/** The wave normals of a water material whose image has arrived; one object while nothing changes. */
function waterWavesOf(
  material: NonNullable<WorldWebGlInput['waterMaterials']>[number] | undefined,
  textures: WorldWebGlInput['terrainTextures'],
): WorldWebGlWaterWaves | undefined {
  if (material?.normalResourceId === undefined) return undefined
  const texture = textures?.get(material.normalResourceId)
  if (texture === undefined) return undefined
  const cached = waterWavesCache.get(material)
  if (cached?.texture === texture) return cached
  const scale = material.uvScale ?? [0.125, 0.125]
  const scroll = material.scroll ?? [0, 0, 0, 0]
  const waves = Object.freeze({
    texture,
    tiling: Object.freeze([scale[0], scale[1]] as const),
    scroll: Object.freeze([scroll[0], scroll[1], scroll[2] ?? 0, scroll[3] ?? 0] as const),
    specularity: material.specularity ?? 0,
    specularScale: material.specularScale ?? 0,
  })
  waterWavesCache.set(material, waves)
  return waves
}

/**
 * Light the water throws on the bottom (SC2 Water.fx): the flip-book frame of the moment, sampled at
 * the bottom's map position times `scale`, shadowed like the surface and stronger with depth as
 * saturate(falloff × depth).
 */
export interface WorldWebGlWaterCaustics {
  readonly frames: readonly SceneRendererTexture[]
  readonly scale: readonly [number, number]
  readonly falloff: number
  readonly framesPerSecond: number
}

const waterCausticsCache = new WeakMap<object, WorldWebGlWaterCaustics>()

/** The caustics of a water material whose frames have arrived; one object while nothing changes. */
function waterCausticsOf(
  material: NonNullable<WorldWebGlInput['waterMaterials']>[number] | undefined,
  textures: WorldWebGlInput['terrainTextures'],
): WorldWebGlWaterCaustics | undefined {
  if (material?.causticsFalloff === undefined || material.causticsScale === undefined) return undefined
  const ids =
    material.causticsFrameResourceIds ??
    (material.causticsResourceId === undefined ? [] : [material.causticsResourceId])
  const frames = ids.flatMap(id => {
    const texture = textures?.get(id)
    return texture === undefined ? [] : [texture]
  })
  if (frames.length === 0) return undefined
  const cached = waterCausticsCache.get(material)
  if (
    cached !== undefined &&
    cached.frames.length === frames.length &&
    cached.frames.every((frame, index) => frame === frames[index])
  )
    return cached
  const caustics = Object.freeze({
    frames: Object.freeze(frames),
    scale: material.causticsScale,
    falloff: material.causticsFalloff,
    framesPerSecond: material.causticsFramesPerSecond ?? 0,
  })
  waterCausticsCache.set(material, caustics)
  return caustics
}

export interface WorldWebGlPlan {
  /** Visible water surface depth for screen-space effects, isolated from model transparency. */
  readonly waterSurfaceDepth: Float32Array
  /** Untextured terrain-clipped water as zone planes, for renderers that read the scene depth. */
  readonly waterPlanes: readonly WorldWebGlWaterPlane[]
  /** The first this many triangles of `transparentTriangles` are the water the planes replace. */
  readonly transparentWaterTriangles: number
  readonly opaqueTriangles: WorldWebGlBatch
  /** Height-field cells cut from the drawn ground under cliff pieces: shadow casters only. */
  readonly terrainShadowCasters: Float32Array
  /** Opaque model triangles separated only when a material disables casting or receiving. */
  readonly shadowControlledOpaqueTriangles: readonly WorldWebGlShadowControlledBatch[]
  /** Native/UVM materials rendered by the same compiler as the standalone model viewer. */
  readonly modelMaterialScenes: readonly WorldWebGlModelMaterialScene[]
  /** Live UVM effects per placed model; simulated per frame because sprites face the camera. */
  readonly modelEffects: readonly WorldWebGlModelEffectInstance[]
  readonly texturedTriangles: readonly WorldWebGlTexturedBatch[]
  readonly transparentTexturedTriangles: readonly WorldWebGlTransparentTexturedBatch[]
  /** Exact per-cell normalized blends for up to eight decoded terrain material layers. */
  readonly splatTriangles: readonly WorldWebGlSplatBatch[]
  /**
   * Weight-raster groups past the first eight layers, blended over `splatTriangles` with the share
   * of the weights their layers hold: together they draw the blend of every layer.
   */
  readonly splatOverlayTriangles: readonly WorldWebGlSplatBatch[]
  /** Terrain decal tiles blended over the ground with their alpha (MapTerrainMaterialSample.decal). */
  readonly terrainDecalTriangles: readonly WorldWebGlTexturedBatch[]
  /** Water whose unlit colour multiplies the ground under it (`compositing: 'multiply'`). */
  readonly multipliedWaterTriangles: readonly WorldWebGlTexturedBatch[]
  readonly transparentTriangles: WorldWebGlBatch
  readonly lines: WorldWebGlBatch
  readonly points: WorldWebGlBatch
  readonly picking: Readonly<{
    terrainTriangles: Float32Array
    objects: readonly Readonly<{
      objectId: number
      center: readonly [number, number, number]
      triangles: Float32Array
      /** Shared model geometry; triangles are transformed only after a bounds hit. */
      primitives?: readonly WorldWebGlPickPrimitive[]
      placeholder: boolean
    }>[]
  }>
  readonly bounds: Readonly<{
    minimum: readonly [number, number, number]
    maximum: readonly [number, number, number]
  }>
  readonly light: Readonly<{
    toneMapping?: WorldToneMapping
    terrain?: WorldTerrainLighting
    /** Shadows only this far from the eye that frames the view (see WorldShadowRange). */
    shadowRange?: WorldShadowRange
    /** Height fog, applied in the tone-mapping pass from worldFogEye. */
    fog?: WorldHeightFog
    specularColor?: readonly [number, number, number]
    specularIntensity?: number
    useAmbientOcclusion?: boolean
    ambient: readonly [number, number, number]
    ambientIntensity: number
    direction: readonly [number, number, number]
    color: readonly [number, number, number]
    intensity: number
    /**
     * Every directional past the first. A map's light rig is a set (SC2 ships Key, Fill and Back),
     * and only the first one casts the shadow map; the rest are plain diffuse terms.
     */
    fills: readonly Readonly<{
      direction: readonly [number, number, number]
      color: readonly [number, number, number]
      intensity: number
      specularColor?: readonly [number, number, number]
      specularIntensity?: number
      useAmbientOcclusion?: boolean
    }>[]
  }>
  readonly stats: WorldWebGlStats
}

interface WorldWebGlPickPrimitive {
  readonly primitive: SceneRendererPrimitive
  /** World bounds of the vertices it references, computed when first read. */
  readonly minimum: readonly [number, number, number]
  readonly maximum: readonly [number, number, number]
  /**
   * A box holding those bounds (min xyz, max xyz): the corners of the referenced vertices' own
   * bounds, transformed and widened past rounding. Instances share the own bounds of their model's
   * vertex arrays, so this costs eight corners, not a pass over the vertices.
   */
  readonly envelope: Float64Array
}

export interface WorldWebGlModelEffectInstance {
  readonly source: UvmEffectSource
  /** Model-to-world transform of the placed component. */
  readonly transform: Float32Array
  readonly time: number
  readonly materials: readonly SceneRendererMaterial[]
  readonly textures: readonly SceneRendererTexture[]
  readonly context: SceneMaterialContext
}

const effectSources = new WeakMap<Uint8Array, Map<number | undefined, UvmEffectSource | null>>()
interface WorldEffectFrame {
  readonly frame: ReturnType<UvmEffectSource['frame']>
  readonly programs: ReadonlyMap<string, SceneMaterialPrograms>
}

/**
 * Simulated effect frames of one source by clock, team colour and orientation: the frames the
 * current pass used and those of the previous pass at the same camera. One model's instances can
 * need more keys than any fixed limit (each orientation is its own key), and clearing a full map in
 * the middle of a pass made every instance simulate again on every frame, even when neither clock
 * nor view had changed. Tail, trail and ribbon geometry also follows the camera position, which the
 * key leaves out, so frames pass to the next pass only when its camera is the same (a selection
 * click or a loading tick at a still camera).
 */
interface WorldEffectFrames {
  pass: number
  camera: string
  current: Map<string, WorldEffectFrame>
  previous: Map<string, WorldEffectFrame>
  /** The reach of the source's geometry by clock in this pass (see worldEffectReach). */
  reach: Map<number, Float64Array | null>
}

/**
 * Where an effect's geometry at one clock can lie in model space, at any orientation of its
 * instance: the box of one frame's geometry (min xyz, max xyz) widened by twice its diagonal; null
 * when the frame has none. Sprites and ribbons turn to the view, but their particles, travel and
 * sizes do not: every sprite stands on a point inside that box, and none reaches further from it than
 * its travel plus its width, each at most the diagonal. Nothing in an effect's geometry depends on
 * the camera's distance.
 */
function worldEffectReach(frame: ReturnType<UvmEffectSource['frame']>): Float64Array | null {
  const box = Float64Array.of(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity)
  for (const primitive of frame.primitives) {
    const { positions } = primitive
    const matrix = primitive.transform ?? IDENTITY_COMPONENT_TRANSFORM
    for (let at = 0; at + 2 < positions.length; at += 3) {
      const x = positions[at]!,
        y = positions[at + 1]!,
        z = positions[at + 2]!
      for (let axis = 0; axis < 3; axis++) {
        const value =
          matrix[axis]! * x + matrix[axis + 4]! * y + matrix[axis + 8]! * z + matrix[axis + 12]!
        if (value < box[axis]!) box[axis] = value
        if (value > box[axis + 3]!) box[axis + 3] = value
      }
    }
  }
  if (!(box[0]! <= box[3]!)) return null
  const margin = 2 * Math.hypot(box[3]! - box[0]!, box[4]! - box[1]!, box[5]! - box[2]!)
  for (let axis = 0; axis < 3; axis++) {
    box[axis] = box[axis]! - margin
    box[axis + 3] = box[axis + 3]! + margin
  }
  return box
}

/**
 * Whether a model-space box placed by `transform` lies wholly outside the view of `viewProjection`:
 * all its corners beyond one clip plane (x, y or depth). Linear in homogeneous coordinates, so it
 * holds for corners behind the camera too; a NaN never culls.
 */
function worldBoxOutsideView(
  box: Float64Array,
  transform: Float32Array,
  viewProjection: Float32Array,
): boolean {
  const matrix = multiplyComponentTransforms(viewProjection, transform)
  let outside = 0b111111
  for (let corner = 0; corner < 8 && outside !== 0; corner++) {
    const x = box[corner & 1 ? 3 : 0]!,
      y = box[corner & 2 ? 4 : 1]!,
      z = box[corner & 4 ? 5 : 2]!
    const clip = (row: number) =>
      matrix[row]! * x + matrix[row + 4]! * y + matrix[row + 8]! * z + matrix[row + 12]!
    const cx = clip(0),
      cy = clip(1),
      cz = clip(2),
      cw = clip(3)
    let planes = 0
    if (cx < -cw) planes |= 1
    if (cx > cw) planes |= 2
    if (cy < -cw) planes |= 4
    if (cy > cw) planes |= 8
    if (cz < -cw) planes |= 16
    if (cz > cw) planes |= 32
    outside &= planes
  }
  return outside !== 0
}

const effectFrames = new WeakMap<UvmEffectSource, WorldEffectFrames>()
let effectPass = 0
const effectDrawPlans = new WeakMap<
  WorldWebGlPlan,
  {
    cameraKey: string
    draws: ReturnType<typeof worldModelEffectDraws>
  }
>()

/** One parsed effect source per converted model; models without effects (or unreadable) cache null. */
function uvmEffectSource(bytes: Uint8Array, sequenceIndex?: number): UvmEffectSource | undefined {
  let sequences = effectSources.get(bytes)
  if (sequences === undefined) effectSources.set(bytes, (sequences = new Map()))
  let source = sequences.get(sequenceIndex)
  if (source === undefined) {
    try {
      source = createUvmEffectSource(bytes, sequenceIndex) ?? null
    } catch {
      source = null
    }
    sequences.set(sequenceIndex, source)
  }
  return source ?? undefined
}

/**
 * Transparent material draws for every live effect at this camera. Sprite and ribbon geometry is
 * built in model space against the model-local view and then placed with the instance transform.
 * An instance whose geometry cannot reach into the view (worldEffectReach) is neither built nor
 * drawn: it covers no pixel.
 */
export function worldModelEffectDraws(
  plan: WorldWebGlPlan,
  camera: WorldWebGlCameraFrame,
): readonly Readonly<{
  scene: WorldWebGlModelMaterialScene
  draw: MaterialDraw & { readonly program: NonNullable<MaterialDraw['program']> }
  merge: boolean
}>[] {
  const cameraKey = `${camera.viewMatrix.join(',')}|${camera.viewProjection.join(',')}`
  const previous = effectDrawPlans.get(plan)
  if (previous?.cameraKey === cameraKey) return previous.draws
  effectPass += 1
  const draws: Array<{
    scene: WorldWebGlModelMaterialScene
    draw: MaterialDraw & { readonly program: NonNullable<MaterialDraw['program']> }
    merge: boolean
  }> = []
  for (const effect of plan.modelEffects) {
    // Simulate one full clip before the current phase so plumes are already developed at load.
    // ponytail: cost grows with clip length per instance per frame; cache emitter state per clock.
    const period = effect.source.clipSeconds
    const time = period === undefined || period <= 0 ? effect.time : period + (effect.time % period)
    try {
      let frames = effectFrames.get(effect.source)
      if (frames === undefined)
        effectFrames.set(
          effect.source,
          (frames = {
            pass: effectPass,
            camera: cameraKey,
            current: new Map(),
            previous: new Map(),
            reach: new Map(),
          }),
        )
      else if (frames.pass !== effectPass) {
        frames.previous = frames.camera === cameraKey ? frames.current : new Map()
        frames.current = new Map()
        frames.reach = new Map()
        frames.pass = effectPass
        frames.camera = cameraKey
      }
      const reach = frames.reach.get(time)
      if (
        reach === null ||
        (reach !== undefined && worldBoxOutsideView(reach, effect.transform, camera.viewProjection))
      )
        continue
      const localView = multiplyComponentTransforms(camera.viewMatrix, effect.transform)
      // Instances of one model at the same clock and orientation build identical local sprites
      // (billboard axes depend only on the view rotation), so simulate once per key.
      // ponytail: ignores the camera position used by tail/trail sprites under perspective.
      const key = [
        time,
        effect.context.teamColor?.join(',') ?? '',
        effect.context.teamColorIntensity ?? '',
        Array.from(localView.subarray(0, 11), value => value.toFixed(4)).join(','),
      ].join('|')
      let cached = frames.current.get(key) ?? frames.previous.get(key)
      if (cached !== undefined) frames.current.set(key, cached)
      else {
        // The pass: copies at other random start phases step simulations of their own.
        const frame = effect.source.frame(time, effect.materials, localView, effectPass)
        // Stable program objects keep the GPU leases across frames that reuse this entry.
        const programs = effectMaterialPrograms(frame.materials, effect.textures, {
          ...effect.context,
          time,
          sequenceTime: time,
        })
        frames.current.set(key, (cached = { frame, programs }))
      }
      const { frame, programs } = cached
      // The first instance at a clock measures the reach its copies are culled by. A frame's content
      // does not depend on the view, so a clock without geometry has none for any turn of a copy:
      // the copies at it build nothing.
      if (reach === undefined) {
        const measured = worldEffectReach(frame)
        frames.reach.set(time, measured)
        if (
          measured === null ||
          worldBoxOutsideView(measured, effect.transform, camera.viewProjection)
        )
          continue
      }
      if (frame.primitives.length === 0) continue
      const primitives = frame.primitives.map(primitive => ({
        ...primitive,
        transform: multiplyComponentTransforms(
          effect.transform,
          primitive.transform === undefined
            ? IDENTITY_COMPONENT_TRANSFORM
            : Float32Array.from(primitive.transform),
        ),
      }))
      const scene = Object.freeze({
        primitives,
        shadowPrimitives: [],
        materials: frame.materials,
        programs,
        textures: effect.textures,
      })
      for (const draw of sceneMaterialDraws(
        primitives,
        frame.materials,
        programs,
        camera.viewProjection,
        [],
        1,
      ))
        // ponytail: simple single-texture effects (no render-material program) are not drawn here.
        if (draw.program !== undefined && draw.depthOnly !== true)
          draws.push({ scene, draw: { ...draw, program: draw.program }, merge: true })
    } catch {
      // An unsupported effect must not stop the map from rendering.
    }
  }
  effectDrawPlans.set(plan, { cameraKey, draws })
  return draws
}

/**
 * Program samplers of effect materials, per material and texture list, with the programs each
 * sampled lately per moment (see effectProgramMoment). An effect source hands out one material
 * object per emitter for all its frames (see createUvmEffectFrame), so each is snapshotted and
 * compiled once; the instances of a model at one moment draw with the same program objects, which
 * lets the transparent pass draw their sprites together (see packWorldWebGlTransparentDraws).
 */
interface EffectProgramSampler {
  readonly sampler: SceneMaterialProgramSampler
  readonly moments: Map<string, ReadonlyMap<string, SceneMaterialPrograms>>
}
const effectProgramSamplers = new WeakMap<
  SceneRendererMaterial,
  WeakMap<readonly SceneRendererTexture[], EffectProgramSampler>
>()
/** Moments kept per sampler: a frame meets eight start phases of a clip per team colour. */
const MAX_EFFECT_PROGRAM_MOMENTS = 64

/**
 * What of a material context an effect program's values depend on: the clock only through a track
 * (see effectMaterialFollowsTime), so every start phase of a clip draws with one program.
 */
function effectProgramMoment(context: SceneMaterialContext, followsTime: boolean): string {
  return [
    followsTime ? context.time : '',
    followsTime ? context.sequenceTime : '',
    context.sequenceIndex,
    context.teamColor?.join(','),
    context.teamColorIntensity,
    context.ambient?.join(','),
    worldGroupId(context.environment),
    context.sceneLighting,
    context.terrainTiling?.join(','),
  ].join('|')
}

/** The programs of an effect frame's materials at one moment, as prepareSceneMaterialPrograms. */
function effectMaterialPrograms(
  materials: readonly SceneRendererMaterial[],
  textures: readonly SceneRendererTexture[],
  context: SceneMaterialContext,
): ReadonlyMap<string, SceneMaterialPrograms> {
  const programs = new Map<string, SceneMaterialPrograms>()
  for (const material of materials) {
    const moment = effectProgramMoment(context, effectMaterialFollowsTime(material))
    let byTextures = effectProgramSamplers.get(material)
    if (byTextures === undefined) effectProgramSamplers.set(material, (byTextures = new WeakMap()))
    let sampler = byTextures.get(textures)
    if (sampler === undefined)
      byTextures.set(
        textures,
        (sampler = {
          sampler: createSceneMaterialProgramSampler(
            [material],
            new Map(textures.map(texture => [texture.id, texture])),
          ),
          moments: new Map(),
        }),
      )
    let sampled = sampler.moments.get(moment)
    if (sampled === undefined) {
      if (sampler.moments.size >= MAX_EFFECT_PROGRAM_MOMENTS) sampler.moments.clear()
      sampler.moments.set(moment, (sampled = sampler.sampler.sample(context, [])))
    }
    for (const [id, program] of sampled) programs.set(id, program)
  }
  return programs
}

export interface WorldWebGlModelMaterialScene {
  readonly primitives: readonly SceneRendererPrimitive[]
  readonly shadowPrimitives: readonly SceneRendererPrimitive[]
  readonly materials: readonly SceneRendererMaterial[]
  readonly programs: ReadonlyMap<string, SceneMaterialPrograms>
  readonly textures: readonly SceneRendererTexture[]
}

const batch = (): MutableBatch => ({ positions: [], normals: [], colors: [] })

/**
 * The clip an object plays of a model, kept per model result and object: a plan asks for it several
 * times per object, and an animated map builds a plan every frame for ~10 000 objects.
 */
const selectedWorldModelAnimations = new WeakMap<
  object,
  WeakMap<WorldSceneObjectItem, ReturnType<typeof selectWorldModelAnimation> | null>
>()

/** Actor animation properties select a named sequence, not the first clip with keyframes. */
export function worldModelAnimation(
  result: Extract<WorldSceneModelResult, { state: 'converted' }>,
  item: WorldSceneObjectItem,
) {
  let byItem = selectedWorldModelAnimations.get(result)
  if (byItem === undefined) selectedWorldModelAnimations.set(result, (byItem = new WeakMap()))
  const cached = byItem.get(item)
  if (cached !== undefined) return cached ?? undefined
  const clip = selectWorldModelAnimation(result, item)
  byItem.set(item, clip ?? null)
  return clip
}

function selectWorldModelAnimation(
  result: Extract<WorldSceneModelResult, { state: 'converted' }>,
  item: WorldSceneObjectItem,
) {
  const requested = [
    item.presentationAnimation?.name ?? 'Stand',
    ...(item.presentationAnimation?.groups ?? []),
  ]
    .join(' ')
    .toLowerCase()
  // An SC2 sequence name is a set of animation properties: a request for "Work" plays "Stand Work"
  // (InvisibleWalkablePlatform8x8 hides itself in it), the clip holding every requested property
  // with the fewest others; the first such clip when several tie.
  const wanted = requested.split(/\s+/u).filter(Boolean)
  let best: NonNullable<typeof result.animations>[number] | undefined
  let extra = Number.POSITIVE_INFINITY
  for (const clip of result.animations ?? []) {
    const properties = new Set((clip.name ?? '').toLowerCase().split(/\s+/u).filter(Boolean))
    if (!wanted.every(property => properties.has(property))) continue
    const others = properties.size - new Set(wanted).size
    if (others < extra) {
      best = clip
      extra = others
    }
  }
  return (
    best ??
    (item.presentationAnimation === undefined
      ? result.animations?.find(clip => clip.kind === 'animation' && clip.channels.length > 0)
      : undefined)
  )
}

/** Start phases a `randomStart` clip is spread over: copies still share samples and programs in groups. */
const RANDOM_START_PHASES = 8

/**
 * The object's clip time. A looping `randomStart` clip (SC2 `RandomStartOffset`) is offset by a
 * phase stable per object; `durationSeconds` is the selected clip's length, omitted where only
 * a change of time matters. An explicit per-object time is played as given.
 */
function worldObjectTime(
  input: WorldWebGlInput,
  item: WorldSceneObjectItem,
  hasSelectedAnimation: boolean,
  durationSeconds?: number,
): number {
  const explicit = input.animationTimes?.get(item.objectId)
  const time =
    (explicit ??
      (item.presentationAnimation !== undefined || hasSelectedAnimation
        ? (input.timeSeconds ?? 0)
        : 0)) * (item.presentationAnimation?.speed ?? 1)
  if (
    explicit !== undefined ||
    !item.presentationAnimation?.randomStart ||
    !item.presentationAnimation.loop ||
    !durationSeconds
  )
    return time
  return time + ((stringHash(item.id) % RANDOM_START_PHASES) / RANDOM_START_PHASES) * durationSeconds
}

/**
 * What worldObjectTime reads of an object, apart from the input's clocks: objects with the same
 * formula are at the same time whenever neither has a time of its own (animationTimes).
 */
function worldObjectClockFormula(
  item: WorldSceneObjectItem,
  hasSelectedAnimation: boolean,
  durationSeconds?: number,
): string {
  const animation = item.presentationAnimation
  const phase =
    animation?.randomStart && animation.loop && durationSeconds
      ? stringHash(item.id) % RANDOM_START_PHASES
      : ''
  return [
    animation !== undefined || hasSelectedAnimation,
    animation?.speed ?? 1,
    durationSeconds ?? '',
    phase,
  ].join('|')
}

function stringHash(text: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function colorHash(value: string | number): readonly [number, number, number, number] {
  const hue = (stringHash(String(value)) % 360) / 60
  const chroma = 0.34
  const component = chroma * (1 - Math.abs((hue % 2) - 1))
  const sector = Math.floor(hue)
  const [red, green, blue] =
    sector === 0
      ? [chroma, component, 0]
      : sector === 1
        ? [component, chroma, 0]
        : sector === 2
          ? [0, chroma, component]
          : sector === 3
            ? [0, component, chroma]
            : sector === 4
              ? [component, 0, chroma]
              : [chroma, 0, component]
  return [red + 0.28, green + 0.28, blue + 0.28, 1]
}

function terrainPosition(item: WorldSceneTerrainItem): readonly [number, number, number] {
  if (item.presentationUvwPosition !== undefined)
    return [
      item.presentationUvwPosition.x,
      item.presentationUvwPosition.y,
      item.presentationUvwPosition.z,
    ]
  if (item.uvwPosition !== undefined)
    return [item.uvwPosition.x, item.uvwPosition.y, item.uvwPosition.z]
  if (item.mapNativePosition !== undefined)
    return [item.mapNativePosition.x, item.mapNativePosition.z, item.mapNativePosition.y]
  return [item.x, item.heightBase + item.heightAdjustment, item.y]
}

function objectPosition(
  item: WorldSceneObjectItem,
  input: WorldWebGlInput,
): readonly [number, number, number] {
  const preview = item.objectId === input.selectedObjectId ? input.previewPosition : undefined
  if (preview !== undefined) return [preview.x, preview.z, preview.y]
  if (item.uvwPosition !== undefined)
    return [item.uvwPosition.x, item.uvwPosition.y, item.uvwPosition.z]
  // a position without its height (Westwood's 2D placements) stands where its terrain puts it
  const position = item.mapNativePresentationPosition ?? item.position
  return [position.x, position.z, position.y]
}

function faceNormal(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
): readonly [number, number, number] {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const
  const normal = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ] as const
  const length = Math.hypot(...normal)
  return length < 1e-12 ? [0, 1, 0] : [normal[0] / length, normal[1] / length, normal[2] / length]
}

function pushVertex(
  target: MutableBatch,
  position: readonly [number, number, number],
  normal: readonly [number, number, number],
  color: readonly [number, number, number, number],
) {
  target.positions.push(...position)
  target.normals.push(...normal)
  target.colors.push(...color)
}

type WorldColor = readonly [number, number, number, number]
/** One color for a triangle, or one per corner (a primitive's COLOR_0). */
type TriangleColor = WorldColor | readonly [WorldColor, WorldColor, WorldColor]

function cornerColor(color: TriangleColor, corner: number): WorldColor {
  return typeof color[0] === 'number' ? (color as WorldColor) : (color as readonly WorldColor[])[corner]!
}

function pushTriangle(
  target: MutableBatch,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  color: TriangleColor,
  normals?: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ],
) {
  const normal = faceNormal(a, b, c)
  pushVertex(target, a, normals?.[0] ?? normal, cornerColor(color, 0))
  pushVertex(target, b, normals?.[1] ?? normal, cornerColor(color, 1))
  pushVertex(target, c, normals?.[2] ?? normal, cornerColor(color, 2))
}

function pushTexturedTriangle(
  target: MutableTexturedBatch,
  vertices: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ],
  textureCoordinates: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ],
  color: TriangleColor,
  normals?: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ],
) {
  const normal = faceNormal(vertices[0], vertices[1], vertices[2])
  for (let index = 0; index < 3; index += 1) {
    pushVertex(target, vertices[index]!, normals?.[index] ?? normal, cornerColor(color, index))
    target.textureCoordinates.push(...textureCoordinates[index]!)
  }
}

type WaterGroundVertex = readonly [number, number, number]

function clipWaterPolygon(
  source: readonly WaterGroundVertex[],
  distance: (vertex: WaterGroundVertex) => number,
): WaterGroundVertex[] {
  const output: WaterGroundVertex[] = []
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index]!
    const next = source[(index + 1) % source.length]!
    const currentDistance = distance(current)
    const nextDistance = distance(next)
    if (currentDistance >= 0) output.push(current)
    if (currentDistance >= 0 !== nextDistance >= 0) {
      const amount = currentDistance / (currentDistance - nextDistance)
      output.push([
        current[0] + (next[0] - current[0]) * amount,
        current[1] + (next[1] - current[1]) * amount,
        current[2] + (next[2] - current[2]) * amount,
      ])
    }
  }
  return output
}

function clippedWaterGroundPolygon(
  triangle: readonly [WaterGroundVertex, WaterGroundVertex, WaterGroundVertex],
  minimum: Readonly<{ x: number; z: number }>,
  maximum: Readonly<{ x: number; z: number }>,
  elevation: number,
): readonly WaterGroundVertex[] {
  let polygon: WaterGroundVertex[] = [...triangle]
  for (const distance of [
    (vertex: WaterGroundVertex) => vertex[0] - minimum.x,
    (vertex: WaterGroundVertex) => maximum.x - vertex[0],
    (vertex: WaterGroundVertex) => vertex[2] - minimum.z,
    (vertex: WaterGroundVertex) => maximum.z - vertex[2],
    // Only a hair under the surface: Amphion's ponds are dips of 0.1-0.3 in a flat that sits 0.09
    // above the water, and a 0.05 margin clipped them away entirely.
    (vertex: WaterGroundVertex) => elevation - 0.005 - vertex[1],
  ]) {
    polygon = clipWaterPolygon(polygon, distance)
    if (polygon.length < 3) return []
  }
  return polygon
}

interface WorldWaterGround {
  /** Terrain cells bucketed by their UVW corner, so a zone clips only the cells under it. */
  readonly buckets: Map<string, WorldSceneTerrainItem[]>
  /** Clipped ground triangles (x, y, z per corner) of each zone box and elevation. */
  readonly zones: Map<string, Float64Array>
}

/**
 * Ground under each water zone clipped to it, kept per terrain preparation: the clip reads only the
 * terrain and the zone's box and elevation, so a plan for another clock, selection or water
 * material reuses it (Amphion: ~70 ms a plan, and a plan is built for every animation frame).
 */
const worldWaterGround = new WeakMap<object, WorldWaterGround>()

function clippedWaterGround(
  preparation: Readonly<{
    terrain: readonly WorldSceneTerrainItem[]
    terrainByCell: ReadonlyMap<string, WorldSceneTerrainItem>
  }>,
  minimum: Readonly<{ x: number; z: number }>,
  maximum: Readonly<{ x: number; z: number }>,
  elevation: number,
): Float64Array {
  let ground = worldWaterGround.get(preparation)
  if (ground === undefined) {
    const buckets = new Map<string, WorldSceneTerrainItem[]>()
    for (const cell of preparation.terrain) {
      const [x, , z] = terrainPosition(cell)
      const key = `${Math.floor(x / WATER_BUCKET_SIZE)}:${Math.floor(z / WATER_BUCKET_SIZE)}`
      const bucket = buckets.get(key)
      if (bucket === undefined) buckets.set(key, [cell])
      else bucket.push(cell)
    }
    worldWaterGround.set(preparation, (ground = { buckets, zones: new Map() }))
  }
  const key = `${minimum.x}:${minimum.z}:${maximum.x}:${maximum.z}:${elevation}`
  const cached = ground.zones.get(key)
  if (cached !== undefined) return cached
  const { terrainByCell } = preparation
  const values: number[] = []
  // A cell reaches one sample past its corner in either direction, so widen by that margin.
  const bucket = (value: number) => Math.floor(value / WATER_BUCKET_SIZE)
  for (
    let bx = bucket(minimum.x - WATER_CELL_MARGIN);
    bx <= bucket(maximum.x + WATER_CELL_MARGIN);
    bx += 1
  )
    for (
      let bz = bucket(minimum.z - WATER_CELL_MARGIN);
      bz <= bucket(maximum.z + WATER_CELL_MARGIN);
      bz += 1
    )
      for (const cell of ground.buckets.get(`${bx}:${bz}`) ?? []) {
        const east = terrainByCell.get(`${cell.x + 1}:${cell.y}`)
        const south = terrainByCell.get(`${cell.x}:${cell.y + 1}`)
        const southEast = terrainByCell.get(`${cell.x + 1}:${cell.y + 1}`)
        if (east === undefined || south === undefined || southEast === undefined) continue
        const a = terrainPosition(cell)
        const b = terrainPosition(east)
        const c = terrainPosition(southEast)
        const d = terrainPosition(south)
        for (const triangle of [
          [a, c, b],
          [a, d, c],
        ] as const) {
          if (
            Math.max(...triangle.map(vertex => vertex[0])) < minimum.x ||
            Math.min(...triangle.map(vertex => vertex[0])) > maximum.x ||
            Math.max(...triangle.map(vertex => vertex[2])) < minimum.z ||
            Math.min(...triangle.map(vertex => vertex[2])) > maximum.z
          )
            continue
          const polygon = clippedWaterGroundPolygon(triangle, minimum, maximum, elevation)
          for (let index = 1; index + 1 < polygon.length; index += 1)
            values.push(...polygon[0]!, ...polygon[index]!, ...polygon[index + 1]!)
        }
      }
  const triangles = Float64Array.from(values)
  ground.zones.set(key, triangles)
  return triangles
}

/** A water zone's writes: its plane (untextured water) and its surface triangles. */
interface WorldWaterZone {
  readonly texture: MutableTexturedBatch['texture'] | undefined
  readonly secondaryTexture: MutableTexturedBatch['texture'] | undefined
  /** The clock of scrolling texture coordinates; undefined when they do not move. */
  readonly time: number | undefined
  readonly plane: WorldBatchWrite | undefined
  readonly triangles: WorldBatchWrite
  readonly emitted: boolean
  readonly detail: WorldWebGlWaterDetail | undefined
}

/**
 * Water zones by terrain preparation, material and box: the same zone writes the same triangles
 * into every plan until the terrain, the material or (for scrolling textures) the clock changes.
 */
const worldWaterZones = new WeakMap<object, WeakMap<object, Map<string, WorldWaterZone>>>()
const NO_WATER_MATERIAL = Object.freeze({})

function worldWaterZone(
  preparation: Parameters<typeof clippedWaterGround>[0],
  material: MapWaterMaterialDefinition | undefined,
  texture: MutableTexturedBatch['texture'] | undefined,
  secondaryTexture: MutableTexturedBatch['texture'] | undefined,
  minimum: Readonly<{ x: number; z: number }>,
  maximum: Readonly<{ x: number; z: number }>,
  elevation: number,
  timeSeconds: number,
  detail?: WorldWebGlWaterDetail,
): WorldWaterZone {
  let byMaterial = worldWaterZones.get(preparation)
  if (byMaterial === undefined) worldWaterZones.set(preparation, (byMaterial = new WeakMap()))
  let zones = byMaterial.get(material ?? NO_WATER_MATERIAL)
  if (zones === undefined) byMaterial.set(material ?? NO_WATER_MATERIAL, (zones = new Map()))
  const key = `${minimum.x}:${minimum.z}:${maximum.x}:${maximum.z}:${elevation}`
  const textured = material !== undefined && texture !== undefined
  const time =
    textured && (material.scroll ?? []).some(value => value !== 0) ? timeSeconds : undefined
  const cached = zones.get(key)
  if (
    cached !== undefined &&
    cached.texture === texture &&
    cached.secondaryTexture === secondaryTexture &&
    cached.time === time &&
    cached.detail === detail
  )
    return cached
  let plane: WorldBatchWrite | undefined
  if (!textured) {
    // The same zone as a plane at its elevation, for a renderer that measures the depth under the
    // water against the drawn scene instead of the height grid (see WorldWebGlWaterPlane).
    const written = batch()
    const color = material?.color ?? WATER_DEFAULT_COLOR
    const a = [minimum.x, elevation, minimum.z] as const
    const b = [maximum.x, elevation, minimum.z] as const
    const c = [maximum.x, elevation, maximum.z] as const
    const d = [minimum.x, elevation, maximum.z] as const
    for (const vertex of [a, c, b, a, d, c])
      pushVertex(written, vertex, WATER_SURFACE_NORMAL, color)
    plane = written
  }
  let triangles: MutableBatch
  let push: (ground: readonly [WaterGroundVertex, WaterGroundVertex, WaterGroundVertex]) => void
  const pointAt = terrainPointAt(preparation)
  const occlusionAt =
    material?.occludedLikeTerrain === true
      ? (x: number, z: number) => pointAt(x, z)?.occlusion ?? 1
      : () => 1
  if (material !== undefined && texture !== undefined) {
    const surface = material
    const target: MutableTexturedBatch = {
      ...batch(),
      textureCoordinates: [],
      ...(secondaryTexture === undefined ? {} : { secondaryTextureCoordinates: [] }),
      texture,
    }
    triangles = target
    const detailVertices =
      detail === undefined ? undefined : { depthRange: detail.depthRange, pointAt }
    push = ground =>
      pushTexturedWaterTriangle(
        target,
        ground,
        elevation,
        surface,
        timeSeconds,
        occlusionAt,
        detailVertices,
      )
  } else {
    const target = batch()
    triangles = target
    push = ground => pushWaterTriangle(target, ground, elevation, material, occlusionAt)
  }
  let emitted = false
  if (material?.shorelineMode === 'terrain-clipped' && preparation.terrain.length > 0) {
    const ground = clippedWaterGround(preparation, minimum, maximum, elevation)
    for (let offset = 0; offset < ground.length; offset += 9) {
      push([
        [ground[offset]!, ground[offset + 1]!, ground[offset + 2]!],
        [ground[offset + 3]!, ground[offset + 4]!, ground[offset + 5]!],
        [ground[offset + 6]!, ground[offset + 7]!, ground[offset + 8]!],
      ])
      emitted = true
    }
  } else {
    const a = [minimum.x, elevation - 1, minimum.z] as const
    const b = [maximum.x, elevation - 1, minimum.z] as const
    const c = [maximum.x, elevation - 1, maximum.z] as const
    const d = [minimum.x, elevation - 1, maximum.z] as const
    push([a, c, b])
    push([a, d, c])
    emitted = true
  }
  const zone = Object.freeze({ texture, secondaryTexture, time, plane, triangles, emitted, detail })
  zones.set(key, zone)
  return zone
}

function waterVertexColor(
  material: MapWaterMaterialDefinition | undefined,
  elevation: number,
  groundHeight: number,
): readonly [number, number, number, number] {
  const color = material?.color ?? WATER_DEFAULT_COLOR
  const depth = Math.max(0, elevation - groundHeight)
  // `CWater.State.ColorFallOff` is a rate per unit of depth (MK2 and the stock value 0.1). Read as
  // the depth to full colour, Amphion's resolved 0.1 made its sea opaque Avernus green past 0.3
  // deep, where the editor shows the sand through a teal sea and the ponds as a purple wash.
  const saturation = 1 - Math.exp(-depth * (material?.colorFalloff ?? WATER_COLOR_FALLOFF))
  // Shorelines fade over the last few centimetres of depth, not half a unit: maps flood wide flats
  // that sit barely under the surface (Amphion's sea floor is 0.1-0.25 below it), and a long ramp
  // left them almost transparent and speckled along the clipped edge.
  const shore = Math.min(1, depth / WATER_SHORE_FADE)
  return [
    color[0] * (1 - 0.35 * saturation),
    color[1] * (1 - 0.35 * saturation),
    color[2] * (1 - 0.35 * saturation),
    (color[3] + (1 - color[3]) * saturation) * shore,
  ]
}

/** The colour darkened by the ground's occlusion at a vertex (occludedLikeTerrain). */
function occludedWaterColor(
  color: readonly [number, number, number, number],
  occlusion: number,
): readonly [number, number, number, number] {
  return occlusion === 1
    ? color
    : [color[0] * occlusion, color[1] * occlusion, color[2] * occlusion, color[3]]
}

function pushWaterTriangle(
  target: MutableBatch,
  ground: readonly [WaterGroundVertex, WaterGroundVertex, WaterGroundVertex],
  elevation: number,
  material: MapWaterMaterialDefinition | undefined,
  occlusionAt: (x: number, z: number) => number,
) {
  const vertices = ground.map(vertex => [vertex[0], elevation, vertex[2]] as const)
  // A water surface is horizontal by construction, and clipping leaves its winding arbitrary, so the
  // normal is stated rather than derived — a derived one pointed down and left water ambient-only.
  const normal = WATER_SURFACE_NORMAL
  for (let index = 0; index < 3; index += 1)
    pushVertex(
      target,
      vertices[index]!,
      normal,
      occludedWaterColor(
        waterVertexColor(material, elevation, ground[index]![1]),
        occlusionAt(ground[index]![0], ground[index]![2]),
      ),
    )
}

/**
 * The terrain point at an exact world (x, z): its drawn height and ambient occlusion. A water surface
 * takes them at the corners it shares with the height grid (occludedLikeTerrain, detail waves).
 */
const worldTerrainPoints = new WeakMap<
  object,
  ReadonlyMap<string, Readonly<{ height: number; occlusion: number }>>
>()

function terrainPointAt(
  preparation: Readonly<{ terrain: readonly WorldSceneTerrainItem[] }>,
): (x: number, z: number) => Readonly<{ height: number; occlusion: number }> | undefined {
  let byPosition = worldTerrainPoints.get(preparation)
  if (byPosition === undefined) {
    const built = new Map<string, Readonly<{ height: number; occlusion: number }>>()
    for (const cell of preparation.terrain) {
      const [x, y, z] = terrainPosition(cell)
      built.set(`${x}:${z}`, { height: y, occlusion: cell.ambientOcclusion ?? 1 })
    }
    worldTerrainPoints.set(preparation, (byPosition = built))
  }
  const known = byPosition
  return (x, z) => known.get(`${x}:${z}`)
}

/**
 * A detail-wave water vertex's colour: the ground's occlusion in RGB, and in alpha the depth term
 * of terrain_water_high.vert, 1 - (clamp(depth / range, -1, 1) / 2 + 1/2), from the water depth
 * over the drawn ground at the vertex.
 */
function detailWaterColor(
  elevation: number,
  ground: number,
  occlusion: number,
  depthRange: number,
): readonly [number, number, number, number] {
  const depth = Math.min(1, Math.max(-1, (elevation - ground) / depthRange))
  return [occlusion, occlusion, occlusion, 1 - (depth * 0.5 + 0.5)]
}

function pushTexturedWaterTriangle(
  target: MutableTexturedBatch,
  ground: readonly [WaterGroundVertex, WaterGroundVertex, WaterGroundVertex],
  elevation: number,
  material: MapWaterMaterialDefinition,
  time: number,
  occlusionAt: (x: number, z: number) => number,
  detail?: Readonly<{
    depthRange: number
    pointAt: ReturnType<typeof terrainPointAt>
  }>,
) {
  const vertices = ground.map(vertex => [vertex[0], elevation, vertex[2]] as const)
  // A water surface is horizontal by construction, and clipping leaves its winding arbitrary, so the
  // normal is stated rather than derived — a derived one pointed down and left water ambient-only.
  const normal = WATER_SURFACE_NORMAL
  const scale = material.uvScale ?? [0.125, 0.125]
  const scroll = material.scroll ?? [0, 0]
  for (let index = 0; index < 3; index += 1) {
    const source = ground[index]!
    pushVertex(
      target,
      vertices[index]!,
      normal,
      detail !== undefined
        ? detailWaterColor(
            elevation,
            detail.pointAt(source[0], source[2])?.height ?? source[1],
            occlusionAt(source[0], source[2]),
            detail.depthRange,
          )
        : occludedWaterColor(
            material.compositing === 'multiply'
              ? [material.color[0], material.color[1], material.color[2], 1]
              : waterVertexColor(material, elevation, source[1]),
            occlusionAt(source[0], source[2]),
          ),
    )
    target.textureCoordinates.push(
      source[0] * scale[0] + scroll[0] * time,
      source[2] * scale[1] + scroll[1] * time,
    )
    target.secondaryTextureCoordinates?.push(
      source[0] * (scale[2] ?? scale[0]) + (scroll[2] ?? 0) * time,
      source[2] * (scale[3] ?? scale[1]) + (scroll[3] ?? 0) * time,
    )
  }
}

function pushSplatTriangle(
  target: MutableSplatBatch,
  vertices: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ],
  textureCoordinates: readonly (readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ])[],
  weights: readonly number[],
  normals?: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ],
  occlusion?: readonly number[],
) {
  const normal = faceNormal(vertices[0], vertices[1], vertices[2])
  for (let vertex = 0; vertex < 3; vertex += 1) {
    pushVertex(target, vertices[vertex]!, normals?.[vertex] ?? normal, [
      1,
      1,
      1,
      occlusion?.[vertex] ?? 1,
    ])
    for (let texture = 0; texture < target.textures.length; texture += 1)
      target.textureCoordinates[texture]!.push(...textureCoordinates[texture]![vertex]!)
    target.textureWeights0.push(weights[0] ?? 0, weights[1] ?? 0, weights[2] ?? 0, weights[3] ?? 0)
    target.textureWeights1.push(weights[4] ?? 0, weights[5] ?? 0, weights[6] ?? 0, weights[7] ?? 0)
  }
}

/**
 * Weight rasters the exact raster splat draws: two per draw (eight layers), each later draw blended
 * over the first, up to 64 layers; past that the cells fall back to their own weights.
 */
export const WORLD_MAX_TERRAIN_WEIGHT_RASTERS = 16

/** Neutral stand-in for a splat layer whose base-color texture did not resolve. */
const MISSING_TERRAIN_LAYER_TEXTURE: SceneRendererTexture = Object.freeze({
  id: 'modkit.world/missing-terrain-layer',
  width: 1,
  height: 1,
  rgba: Uint8Array.of(128, 128, 128, 255),
})

/** A layer that is its baseColorFactor alone: glTF's colour without a texture. */
const WHITE_TERRAIN_LAYER_TEXTURE: SceneRendererTexture = Object.freeze({
  id: 'modkit.world/white-terrain-layer',
  width: 1,
  height: 1,
  rgba: Uint8Array.of(255, 255, 255, 255),
})

/** The colour a blended terrain layer's texture is multiplied by: glTF baseColorFactor RGB. */
function terrainLayerColor(
  definition: MapTerrainMaterialDefinition | undefined,
): readonly [number, number, number] {
  const factor = definition?.baseColorFactor
  return factor === undefined ? [1, 1, 1] : [factor[0], factor[1], factor[2]]
}

/** A terrain material's normalEncoding as the shader's swizzle: 0 RGB, 1 DXN, 2 Y against v. */
function normalSwizzleOf(encoding: MapTerrainMaterialDefinition['normalEncoding']): number {
  return encoding === 'xy-in-alpha-green' ? 1 : encoding === 'rgb-inverted-y' ? 2 : 0
}

/** The sdk's centre rule (MapTerrainUvTransform); no transform leaves the coordinate as it is. */
function transformedTerrainUv(
  uv: readonly [number, number],
  transform: MapTerrainUvTransform | undefined,
): readonly [number, number] {
  return transform === undefined ? uv : transformTerrainUv(uv, transform)
}

/**
 * Terrain UV at a cell corner. A sample's placement is cell-local (tile rotation/flip, or corner
 * UVs); a material transform acts in continuous terrain cell units (world tiling), so repeats cross
 * cell borders without seams. Integer cell offsets are invisible to repeat-wrapped tiles.
 */
function terrainSurfaceUv(
  cell: Readonly<{ x: number; y: number }>,
  local: readonly [number, number],
  sample: Pick<MapTerrainMaterialSample, 'uvTransform' | 'cornerUv'> | undefined,
  materialTransform: Parameters<typeof transformedTerrainUv>[1],
): readonly [number, number] {
  const corners = sample?.cornerUv
  const [x, y] = local
  const inCell =
    corners === undefined
      ? transformedTerrainUv(local, sample?.uvTransform)
      : ([0, 1] as const).map(
          axis =>
            (1 - x) * (1 - y) * corners[0][axis] +
            x * (1 - y) * corners[1][axis] +
            x * y * corners[2][axis] +
            (1 - x) * y * corners[3][axis],
        )
  return transformedTerrainUv([cell.x + inCell[0]!, cell.y + inCell[1]!], materialTransform)
}

interface AtlasGrid {
  readonly columns: number
  readonly rows: number
}

/** An atlas material's tile grid: `rows` rows, as many square-tile columns as the texture's aspect. */
function atlasGrid(rows: number, texture: SceneRendererTexture): AtlasGrid {
  return Object.freeze({
    columns: Math.max(1, Math.round((rows * texture.width) / texture.height)),
    rows,
  })
}

/** The cell grid coordinates of a triangle's corners, on an atlas batch's secondary unit. */
function pushCellCoordinates(
  target: MutableTexturedBatch,
  cell: Readonly<{ x: number; y: number }>,
  locals: readonly (readonly [number, number])[],
) {
  for (const local of locals)
    target.secondaryTextureCoordinates?.push(cell.x + local[0], cell.y + local[1])
}

/**
 * A cell corner in a tile of an atlas material (MapTerrainMaterialSample.layers): square tiles in
 * `rows` rows and as many columns as the texture's aspect gives, the cell's top (local y = 1) on
 * the tile's top row. Half a texel inside the tile, so filtering at the full level does not reach
 * its neighbour; at smaller levels the shader keeps the sample inside (atlasGrid).
 */
function atlasTileUv(
  local: readonly [number, number],
  atlas: NonNullable<MapTerrainMaterialDefinition['atlas']>,
  texture: SceneRendererTexture,
  tile: Readonly<{ column: number; row: number }>,
): readonly [number, number] {
  const { rows } = atlas
  const { columns } = atlasGrid(rows, texture)
  // the tile's top row on the cell edge `tileTop` names
  const down = atlas.tileTop === 'local-y-0' ? local[1] : 1 - local[1]
  const inside = (value: number, start: number, size: number, texels: number) =>
    Math.min(Math.max(value, start / size + 0.5 / texels), (start + 1) / size - 0.5 / texels)
  return [
    inside((tile.column + local[0]) / columns, tile.column, columns, texture.width),
    inside((tile.row + down) / rows, tile.row, rows, texture.height),
  ]
}

function pushLine(
  target: MutableBatch,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  color: readonly [number, number, number, number],
) {
  pushVertex(target, a, [0, 1, 0], color)
  pushVertex(target, b, [0, 1, 0], color)
}

function transformedPrimitiveVertex(
  primitive: SceneRendererPrimitive,
  index: number,
): readonly [number, number, number] {
  const x = primitive.positions[index * 3] ?? 0
  const y = primitive.positions[index * 3 + 1] ?? 0
  const z = primitive.positions[index * 3 + 2] ?? 0
  const transform = primitive.transform
  if (transform === undefined) return [x, y, z]
  return [
    transform[0]! * x + transform[4]! * y + transform[8]! * z + transform[12]!,
    transform[1]! * x + transform[5]! * y + transform[9]! * z + transform[13]!,
    transform[2]! * x + transform[6]! * y + transform[10]! * z + transform[14]!,
  ]
}

const IDENTITY_COMPONENT_TRANSFORM = new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
])

function componentLocalTransform(component: MapModelComponentPlacement): Float32Array {
  const [x, y, z, w] = component.rotation ?? [0, 0, 0, 1]
  const xx = x * x,
    yy = y * y,
    zz = z * z
  const xy = x * y,
    xz = x * z,
    yz = y * z
  const wx = w * x,
    wy = w * y,
    wz = w * z
  return new Float32Array([
    1 - 2 * (yy + zz),
    2 * (xy + wz),
    2 * (xz - wy),
    0,
    2 * (xy - wz),
    1 - 2 * (xx + zz),
    2 * (yz + wx),
    0,
    2 * (xz + wy),
    2 * (yz - wx),
    1 - 2 * (xx + yy),
    0,
    0,
    0,
    0,
    1,
  ])
}

function multiplyComponentTransforms(left: Float32Array, right: Float32Array): Float32Array {
  const result = new Float32Array(16)
  for (let column = 0; column < 4; column += 1)
    for (let row = 0; row < 4; row += 1)
      result[column * 4 + row] =
        left[row]! * right[column * 4]! +
        left[4 + row]! * right[column * 4 + 1]! +
        left[8 + row]! * right[column * 4 + 2]! +
        left[12 + row]! * right[column * 4 + 3]!
  return result
}

function transformedComponentVertex(
  point: readonly [number, number, number],
  transform: Float32Array,
): readonly [number, number, number] {
  const [x, y, z] = point
  return [
    transform[0]! * x + transform[4]! * y + transform[8]! * z + transform[12]!,
    transform[1]! * x + transform[5]! * y + transform[9]! * z + transform[13]!,
    transform[2]! * x + transform[6]! * y + transform[10]! * z + transform[14]!,
  ]
}

function rotateQuaternion(
  point: readonly [number, number, number],
  rotation: readonly [number, number, number, number],
): readonly [number, number, number] {
  const [x, y, z] = point
  const [qx, qy, qz, qw] = rotation
  const ix = qw * x + qy * z - qz * y
  const iy = qw * y + qz * x - qx * z
  const iz = qw * z + qx * y - qy * x
  const iw = -qx * x - qy * y - qz * z
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ]
}

/**
 * A primitive's own vertex normal in the world, through its node transform and the object's scale and
 * rotation (scale divides, as the inverse transpose does for an axis-aligned scale). Undefined without
 * normals or for a degenerate one.
 */
function instanceNormal(
  primitive: SceneRendererPrimitive,
  index: number,
  item: WorldSceneObjectItem,
): readonly [number, number, number] | undefined {
  const normals = primitive.normals
  if (normals === undefined) return undefined
  let x = normals[index * 3] ?? 0
  let y = normals[index * 3 + 1] ?? 0
  let z = normals[index * 3 + 2] ?? 0
  const transform = primitive.transform
  if (transform !== undefined)
    [x, y, z] = [
      transform[0]! * x + transform[4]! * y + transform[8]! * z,
      transform[1]! * x + transform[5]! * y + transform[9]! * z,
      transform[2]! * x + transform[6]! * y + transform[10]! * z,
    ]
  const scale = item.uvwScale ?? item.scale ?? { x: 1, y: 1, z: 1 }
  const rotated = instanceVertex([x / scale.x, y / scale.y, z / scale.z], { ...item, uvwScale: { x: 1, y: 1, z: 1 } }, [0, 0, 0])
  const length = Math.hypot(rotated[0], rotated[1], rotated[2])
  return length > 1e-9 && Number.isFinite(length)
    ? [rotated[0] / length, rotated[1] / length, rotated[2] / length]
    : undefined
}

/**
 * The turn of an object the world places without its UVW rotation (2D Westwood placements, a world
 * with no UVW transform), in radians about +Y: its drawn rotation in its native unit and sense
 * (MapPlacedObject.nativeRotationUnit, nativeRotationSense — clockwise seen from above turns the
 * other way), radians when it names no unit.
 */
function objectYaw(item: WorldSceneObjectItem): number {
  const value = item.presentationRotation ?? item.rotation ?? 0
  const radians =
    item.nativeRotationUnit === 'degrees'
      ? (value * Math.PI) / 180
      : item.nativeRotationUnit === 'uint16-turn'
        ? (value * Math.PI * 2) / 65_536
        : value
  return item.nativeRotationSense === 'clockwise' ? -radians : radians
}

function instanceVertex(
  point: readonly [number, number, number],
  item: WorldSceneObjectItem,
  translation: readonly [number, number, number],
): readonly [number, number, number] {
  const scale = item.uvwScale ?? item.scale ?? { x: 1, y: 1, z: 1 }
  const scaled: readonly [number, number, number] = [
    point[0] * scale.x,
    point[1] * scale.y,
    point[2] * scale.z,
  ]
  let rotated: readonly [number, number, number]
  if (item.uvwRotation !== undefined) rotated = rotateQuaternion(scaled, item.uvwRotation)
  else {
    // a right-handed turn about +Y, as worldObjectTransform turns the same object
    const yaw = objectYaw(item)
    const cosine = Math.cos(yaw)
    const sine = Math.sin(yaw)
    rotated = [
      cosine * scaled[0] + sine * scaled[2],
      scaled[1],
      cosine * scaled[2] - sine * scaled[0],
    ]
  }
  return [translation[0] + rotated[0], translation[1] + rotated[1], translation[2] + rotated[2]]
}

function primitiveTriangles(
  primitive: SceneRendererPrimitive,
): readonly (readonly [number, number, number])[] {
  const source =
    primitive.indices ??
    Uint32Array.from({ length: Math.floor(primitive.positions.length / 3) }, (_, index) => index)
  const triangles: [number, number, number][] = []
  if (primitive.topology === 'triangles') {
    for (let index = 0; index + 2 < source.length; index += 3)
      triangles.push([source[index]!, source[index + 1]!, source[index + 2]!])
  } else if (primitive.topology === 'triangle-strip') {
    for (let index = 0; index + 2 < source.length; index += 1)
      triangles.push(
        index % 2 === 0
          ? [source[index]!, source[index + 1]!, source[index + 2]!]
          : [source[index + 1]!, source[index]!, source[index + 2]!],
      )
  } else if (primitive.topology === 'triangle-fan') {
    for (let index = 1; index + 1 < source.length; index += 1)
      triangles.push([source[0]!, source[index]!, source[index + 1]!])
  }
  return triangles
}

const terrainProjectionIds = new WeakMap<object, ReadonlySet<string>>()
const NO_TERRAIN_PROJECTION: ReadonlySet<string> = new Set()

/**
 * Materials of a model that show the terrain on its surface instead of a colour of their own
 * (`renderModel.presentation` 'terrain-projection', SC2 TER_): they draw with the ground.
 */
function terrainProjectionMaterialIds(
  model: WorldSceneModelResult | undefined,
): ReadonlySet<string> {
  if (model?.state !== 'converted') return NO_TERRAIN_PROJECTION
  let ids = terrainProjectionIds.get(model)
  if (ids === undefined) {
    ids = new Set(
      (model.materials ?? [])
        .filter(
          material =>
            record(material.shader?.parameters?.['renderModel'])?.['presentation'] ===
            'terrain-projection',
        )
        .map(material => material.id),
    )
    terrainProjectionIds.set(model, ids.size === 0 ? NO_TERRAIN_PROJECTION : ids)
  }
  return ids
}

/**
 * The terrain blend mask of a cliff piece's material: its `alpha1` layer (SC2's TerrainAlphaMask)
 * with that layer's texture, texel channel, UV set and UV transform. Where the mask is clear the game
 * draws the terrain through the piece, where it is set the rock. Undefined for a material without a
 * decoded mask texture.
 */
function cliffMaskLayer(
  result: WorldModelSample['result'],
  materialId: string | undefined,
):
  | Readonly<{
      texture: SceneRendererTexture
      channel: number
      uvSource: number
      transform: (u: number, v: number) => readonly [number, number]
    }>
  | undefined {
  const material = (result.materials ?? []).find(candidate => candidate.id === materialId)
  const standard = record(record(material?.shader?.parameters?.['renderModel'])?.['standard'])
  const layer = record(record(standard?.['layers'])?.['alpha1'])
  const path = typeof layer?.['texturePath'] === 'string' ? layer['texturePath'] : undefined
  const texture = (result.textures ?? []).find(candidate => candidate.id === path)
  const channels = typeof layer?.['channels'] === 'number' ? layer['channels'] : 1
  if (texture?.rgba === undefined || texture.width <= 0 || texture.height <= 0 || channels === 0)
    return undefined
  const values = (name: string, fallback: readonly number[]) => {
    const value = record(layer?.[name])?.['value']
    return Array.isArray(value) && value.every(item => typeof item === 'number')
      ? (value as readonly number[])
      : fallback
  }
  const tiling = values('uvTiling', [1, 1])
  const offset = values('uvOffset', [0, 0])
  const angle = values('uvAngle', [0, 0, 0])[2] ?? 0
  const cos = Math.cos(angle),
    sin = Math.sin(angle)
  return Object.freeze({
    texture,
    // M3 colour channels: 1 RGBA and 2 AAAA read alpha, 3/4/5 read one colour channel.
    channel: channels === 3 ? 0 : channels === 4 ? 1 : channels === 5 ? 2 : 3,
    uvSource: typeof layer?.['uvSource'] === 'number' ? layer['uvSource'] : 0,
    // The material's layer transform, as the shader: rotate about the centre, move by the offset,
    // then tile about the centre.
    transform: (u: number, v: number) => {
      const cu = u - 0.5,
        cv = v - 0.5
      return [
        (cos * cu + sin * cv - offset[0]!) * tiling[0]! + 0.5,
        (-sin * cu + cos * cv - offset[1]!) * tiling[1]! + 0.5,
      ] as const
    },
  })
}

/** The mask UVs of one primitive, in the layer's own UV set. */
function cliffMaskCoordinates(
  primitive: SceneRendererPrimitive,
  uvSource: number,
): Float32Array | undefined {
  return (
    primitive.textureCoordinateSets?.find(candidate => candidate.set === uvSource)?.coordinates ??
    (uvSource === 0 ? primitive.textureCoordinates : undefined)
  )
}

/**
 * Unique vertices that the triangles of an indexed primitive reference, by index array and
 * topology: skinned geometry gets new positions every frame but keeps its index array.
 */
const referencedVertices = new WeakMap<object, Map<string, readonly number[]>>()

/** The referenced vertices of a primitive, or their count when they are simply the first ones. */
function referencedVertexIndices(source: SceneRendererPrimitive): readonly number[] | number {
  const indices = source.indices
  const count = indices?.length ?? Math.floor(source.positions.length / 3)
  const used =
    primitiveTriangleCount(source) === 0
      ? 0
      : source.topology === 'triangles'
        ? Math.floor(count / 3) * 3
        : count
  if (indices === undefined) return used
  let byTopology = referencedVertices.get(indices)
  if (byTopology === undefined) referencedVertices.set(indices, (byTopology = new Map()))
  let list = byTopology.get(source.topology)
  if (list === undefined) {
    list = [...new Set(Array.from({ length: used }, (_, index) => indices[index] ?? index))]
    byTopology.set(source.topology, list)
  }
  return list
}

function primitiveTriangleCount(primitive: SceneRendererPrimitive): number {
  const count = primitive.indices?.length ?? Math.floor(primitive.positions.length / 3)
  return primitive.topology === 'triangles'
    ? Math.floor(count / 3)
    : primitive.topology === 'triangle-strip' || primitive.topology === 'triangle-fan'
      ? Math.max(0, count - 2)
      : 0
}

interface WorldPickBounds {
  readonly source: SceneRendererPrimitive
  readonly transform: Float32Array | undefined
  readonly minimum: readonly [number, number, number]
  readonly maximum: readonly [number, number, number]
}

// The last bounds of each object's primitive slot: a rebuilt object whose geometry and placement did
// not change (only its clock moved) reuses them instead of transforming every vertex again.
const lastPickBounds = new WeakMap<object, Map<string, WorldPickBounds>>()

function sameOptionalMatrix(
  left: ArrayLike<number> | undefined,
  right: ArrayLike<number> | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false
  return true
}

/**
 * Own-space bounds (min xyz, max xyz) of the vertices a primitive references, by its positions array
 * and referenced list (a count, or the list kept for its index array). The placed instances of one
 * sampled model share its arrays: on Amphion ~1 000 animated primitives a frame have ~100 of them.
 */
const referencedOwnBounds = new WeakMap<object, Map<readonly number[] | number, Float64Array>>()

function referencedBoundsOf(
  positions: Float32Array,
  referenced: readonly number[] | number,
): Float64Array {
  let byList = referencedOwnBounds.get(positions)
  if (byList === undefined) referencedOwnBounds.set(positions, (byList = new Map()))
  let bounds = byList.get(referenced)
  if (bounds === undefined) {
    const count = typeof referenced === 'number' ? referenced : referenced.length
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity
    for (let at = 0; at < count; at++) {
      const offset = (typeof referenced === 'number' ? at : referenced[at]!) * 3
      // The coordinates sharedPickPrimitive reads; a NaN stays NaN in the bounds.
      const x = positions[offset] ?? 0,
        y = positions[offset + 1] ?? 0,
        z = positions[offset + 2] ?? 0
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      minZ = Math.min(minZ, z)
      maxZ = Math.max(maxZ, z)
    }
    bounds = Float64Array.of(minX, minY, minZ, maxX, maxY, maxZ)
    byList.set(referenced, bounds)
  }
  return bounds
}

/**
 * A box holding every vertex of an own-space box as sharedPickPrimitive transforms it (min xyz, max
 * xyz). An affine map takes a box's extremes at its corners; a vertex inside can land a few ulps past
 * them in floating point, at most ~1e-15 of the terms' magnitude, so each side widens by 1e-12 of it.
 * Non-finite bounds or a non-finite matrix give a non-finite box.
 */
function transformedEnvelope(own: Float64Array, transform: Float32Array | undefined): Float64Array {
  if (transform === undefined) return own
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity,
    reachX = 0,
    reachY = 0,
    reachZ = 0
  for (let corner = 0; corner < 8; corner++) {
    const x = own[corner & 1 ? 3 : 0]!,
      y = own[corner & 2 ? 4 : 1]!,
      z = own[corner & 4 ? 5 : 2]!
    const tx = transform[0]! * x + transform[4]! * y + transform[8]! * z + transform[12]!
    const ty = transform[1]! * x + transform[5]! * y + transform[9]! * z + transform[13]!
    const tz = transform[2]! * x + transform[6]! * y + transform[10]! * z + transform[14]!
    minX = Math.min(minX, tx)
    maxX = Math.max(maxX, tx)
    minY = Math.min(minY, ty)
    maxY = Math.max(maxY, ty)
    minZ = Math.min(minZ, tz)
    maxZ = Math.max(maxZ, tz)
    reachX = Math.max(
      reachX,
      Math.abs(transform[0]! * x) +
        Math.abs(transform[4]! * y) +
        Math.abs(transform[8]! * z) +
        Math.abs(transform[12]!),
    )
    reachY = Math.max(
      reachY,
      Math.abs(transform[1]! * x) +
        Math.abs(transform[5]! * y) +
        Math.abs(transform[9]! * z) +
        Math.abs(transform[13]!),
    )
    reachZ = Math.max(
      reachZ,
      Math.abs(transform[2]! * x) +
        Math.abs(transform[6]! * y) +
        Math.abs(transform[10]! * z) +
        Math.abs(transform[14]!),
    )
  }
  return Float64Array.of(
    minX - reachX * 1e-12,
    minY - reachY * 1e-12,
    minZ - reachZ * 1e-12,
    maxX + reachX * 1e-12,
    maxY + reachY * 1e-12,
    maxZ + reachZ * 1e-12,
  )
}

/**
 * Pick entry of a placed primitive: its world bounding box over the vertices it references, computed
 * when first read (a pick, or plan bounds its envelope reaches past). With an `owner` and `slot` the
 * bounds are kept for the next plan while the source geometry and the placement matrix stay the same.
 */
function sharedPickPrimitive(
  source: SceneRendererPrimitive,
  primitive: SceneRendererPrimitive,
  owner?: object,
  slot?: string,
): WorldWebGlPickPrimitive {
  if (materialSkinOf(primitive) !== undefined) {
    // A skin posed on the GPU: its entry poses it on the CPU when first read (a pick, the bounds).
    let posed: WorldWebGlPickPrimitive | undefined
    const entry = () =>
      (posed ??= sharedPickPrimitive(
        worldPosedPrimitive(source),
        materialPosedPrimitive(primitive),
        owner,
        slot,
      ))
    return Object.freeze({
      get primitive() {
        return entry().primitive
      },
      get minimum() {
        return entry().minimum
      },
      get maximum() {
        return entry().maximum
      },
      get envelope() {
        return entry().envelope
      },
    })
  }
  const referenced = referencedVertexIndices(source)
  // The same envelope whether the bounds are kept or computed: a kept plan equals a fresh one.
  const envelope = transformedEnvelope(
    referencedBoundsOf(primitive.positions, referenced),
    primitive.transform,
  )
  const slots = owner === undefined ? undefined : lastPickBounds.get(owner)
  const last = slot === undefined ? undefined : slots?.get(slot)
  if (
    last !== undefined &&
    last.source === source &&
    sameOptionalMatrix(last.transform, primitive.transform)
  )
    return Object.freeze({ primitive, minimum: last.minimum, maximum: last.maximum, envelope })
  let bounds: WorldPickBounds | undefined
  const exact = () => (bounds ??= sharedPickBounds(source, primitive, referenced, owner, slot))
  return Object.freeze({
    primitive,
    get minimum() {
      return exact().minimum
    },
    get maximum() {
      return exact().maximum
    },
    envelope,
  })
}

/** The exact world bounds of a placed primitive's referenced vertices, kept for its owner's slot. */
function sharedPickBounds(
  source: SceneRendererPrimitive,
  primitive: SceneRendererPrimitive,
  referenced: readonly number[] | number,
  owner: object | undefined,
  slot: string | undefined,
): WorldPickBounds {
  // Animated instances get new geometry every frame: this loop runs per vertex, so it keeps to
  // locals (the same arithmetic as transformedPrimitiveVertex).
  const count = typeof referenced === 'number' ? referenced : referenced.length
  const positions = primitive.positions
  const transform = primitive.transform
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity
  for (let at = 0; at < count; at++) {
    const index = typeof referenced === 'number' ? at : referenced[at]!
    let x = positions[index * 3] ?? 0,
      y = positions[index * 3 + 1] ?? 0,
      z = positions[index * 3 + 2] ?? 0
    if (transform !== undefined) {
      const tx = transform[0]! * x + transform[4]! * y + transform[8]! * z + transform[12]!
      const ty = transform[1]! * x + transform[5]! * y + transform[9]! * z + transform[13]!
      z = transform[2]! * x + transform[6]! * y + transform[10]! * z + transform[14]!
      x = tx
      y = ty
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
      throw new TypeError('world WebGL plan contains a non-finite model coordinate')
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  const bounds = Object.freeze({
    source,
    transform:
      primitive.transform === undefined ? undefined : Float32Array.from(primitive.transform),
    minimum: Object.freeze([minX, minY, minZ] as const),
    maximum: Object.freeze([maxX, maxY, maxZ] as const),
  })
  if (owner !== undefined && slot !== undefined) {
    let known = lastPickBounds.get(owner)
    if (known === undefined) lastPickBounds.set(owner, (known = new Map()))
    known.set(slot, bounds)
  }
  return bounds
}

function frozenBatch(source: MutableBatch): WorldWebGlBatch {
  return Object.freeze({
    positions: Float32Array.from(source.positions),
    normals: Float32Array.from(source.normals),
    colors: Float32Array.from(source.colors),
  })
}

function frozenTexturedBatch(source: MutableTexturedBatch): WorldWebGlTexturedBatch {
  return Object.freeze({
    ...frozenBatch(source),
    textureCoordinates: Float32Array.from(source.textureCoordinates),
    ...(source.secondaryTextureCoordinates === undefined
      ? {}
      : { secondaryTextureCoordinates: Float32Array.from(source.secondaryTextureCoordinates) }),
    texture: source.texture,
    ...(source.overlayAlpha === undefined ? {} : { overlayAlpha: source.overlayAlpha }),
    ...(source.atlas === undefined ? {} : { atlas: source.atlas }),
    ...(source.normalTexture === undefined ? {} : { normalTexture: source.normalTexture }),
    ...(source.normalSwizzle === undefined ? {} : { normalSwizzle: source.normalSwizzle }),
    ...(source.specularTexture === undefined ? {} : { specularTexture: source.specularTexture }),
    ...(source.specularGloss === undefined ? {} : { specularGloss: source.specularGloss }),
    ...(source.waterDetail === undefined ? {} : { waterDetail: source.waterDetail }),
    ...(source.secondaryTexture === undefined ? {} : { secondaryTexture: source.secondaryTexture }),
    ...(source.alphaCutoff === undefined ? {} : { alphaCutoff: source.alphaCutoff }),
    ...(source.castShadows === undefined ? {} : { castShadows: source.castShadows }),
    ...(source.receiveShadows === undefined ? {} : { receiveShadows: source.receiveShadows }),
    ...(source.unlit === undefined ? {} : { unlit: source.unlit }),
    ...(source.priority === undefined ? {} : { priority: source.priority }),
    ...(source.team === undefined ? {} : { team: source.team }),
  })
}

function frozenSplatBatch(source: MutableSplatBatch): WorldWebGlSplatBatch {
  return Object.freeze({
    ...frozenBatch(source),
    textureCoordinates: Object.freeze(
      source.textureCoordinates.map(coordinates => Float32Array.from(coordinates)),
    ),
    textureWeights0: Float32Array.from(source.textureWeights0),
    textureWeights1: Float32Array.from(source.textureWeights1),
    textures: Object.freeze([...source.textures]),
    normalTextures: Object.freeze([...source.normalTextures]),
    ...(source.specularTextures === undefined
      ? {}
      : { specularTextures: Object.freeze([...source.specularTextures]) }),
    ...(source.specularGloss === undefined ? {} : { specularGloss: source.specularGloss }),
    normalSwizzles: Object.freeze([...source.normalSwizzles]),
    ...(source.layerColors === undefined
      ? {}
      : {
          layerColors: Object.freeze(
            source.layerColors.map(color => Object.freeze([color[0], color[1], color[2]] as const)),
          ),
        }),
    ...(source.weightTextures === undefined
      ? {}
      : { weightTextures: Object.freeze([...source.weightTextures]) }),
    ...(source.weightTextureCoordinates === undefined
      ? {}
      : { weightTextureCoordinates: Float32Array.from(source.weightTextureCoordinates) }),
    ...(source.maskTexture === undefined || source.maskTextureCoordinates === undefined
      ? {}
      : {
          maskTexture: source.maskTexture,
          maskTextureCoordinates: Float32Array.from(source.maskTextureCoordinates),
          maskChannel: source.maskChannel ?? 3,
        }),
  })
}

const BASE_COLOR_SLOTS = new Set(['diffuse', 'basecolor', 'albedo', 'color', 'colour', 'mapkd'])
const NORMAL_SLOTS = new Set(['normal', 'normalmap', 'mapnormal', 'mapbump', 'bump'])
const materialSlot = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/gu, '')
/** A model result's textures by id (its resource ids), once per texture list. */
const texturesById = new WeakMap<
  readonly SceneRendererTexture[],
  ReadonlyMap<string, SceneRendererTexture>
>()

/**
 * The team colour a fallback batch of a model material draws (modelMaterialTeamColor), in the
 * object's colour; undefined when the material has none or the object has none (intensity 0).
 */
function worldBatchTeamColor(
  material: ModelMaterialRef | undefined,
  textures: readonly SceneRendererTexture[] | undefined,
  uvSource: number,
  color: readonly [number, number, number] | undefined,
  intensity: number | undefined,
  objectTint?: readonly [number, number, number],
  teamRamp?: readonly (readonly [number, number, number])[],
): WorldBatchTeamColor | undefined {
  if (material === undefined || intensity === 0) return undefined
  const list = textures ?? []
  let byId = texturesById.get(list)
  if (byId === undefined)
    texturesById.set(list, (byId = new Map(list.map(texture => [texture.id, texture]))))
  const team = modelMaterialTeamColor(material, byId, uvSource)
  if (team === undefined) return undefined
  const rule = teamMaskRule(team, teamRamp === undefined ? undefined : { teamRamp })
  if (rule === undefined) return undefined
  const mask = team.mask === 'whole' ? undefined : byId.get(team.mask.texture)
  const tinted = team.source === 'object-tint'
  return Object.freeze({
    ...(mask === undefined ? {} : { mask }),
    channel: team.mask === 'whole' ? 4 : ['r', 'g', 'b', 'a', 'rgb'].indexOf(team.mask.channel),
    blend: TEAM_COLOR_BLENDS.indexOf(team.blend),
    strength: team.strength ?? 1,
    color: (tinted ? objectTint : color) ?? team.defaultColor ?? ([1, 1, 1] as const),
    rule,
    ...(tinted ? { objectTint: true as const } : {}),
  })
}

type ShaderParameters = NonNullable<ModelMaterialRef['shader']>['parameters']
type JsonRecord = { readonly [key: string]: ShaderParameters[string] }
const record = (value: unknown): JsonRecord | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined

/**
 * Materials as this world presents them.
 *
 * A composite material (`renderModel.composite`, SC2 CMP_) layers standard passes and has no
 * program of its own, so it drew opaque with whatever base texture it listed (Amphion's sewer water
 * effect became a black plane). Its first pass is a standard material and stands in for it.
 *
 * A cliff piece's blend material uses alpha as a terrain blend mask, not transparency: its floor and
 * top are alpha 0 and the terrain is drawn there, and rock edges fade into the ground. Drawn blended
 * the rock read as translucent, so cliff pieces are drawn alpha-tested instead.
 */
function presentationMaterials(
  item: WorldSceneObjectItem,
  refs: readonly ModelMaterialRef[],
): readonly ModelMaterialRef[] {
  const cliff = item.derivedFrom === 'cliffs'
  return refs.map(ref => {
    const parameters = ref.shader?.parameters
    const renderModel = record(parameters?.['renderModel'])
    const passes = record(renderModel?.['composite'])?.['passes']
    const firstPass = record(record(Array.isArray(passes) ? passes[0] : undefined)?.['material'])
    let standard = record(renderModel?.['standard'])
    let out = ref
    if (firstPass !== undefined && ref.shader !== undefined) {
      standard = firstPass
      const blend = typeof firstPass['blendMode'] === 'number' ? firstPass['blendMode'] : 0
      const { composite: _composite, ...surfaceModel } = renderModel ?? {}
      void _composite
      const animatedComposite = Object.values(record(firstPass['layers']) ?? {}).some(raw => {
        const layer = record(raw)
        return ['colorAdd', 'colorMultiply', 'uvOffset', 'uvAngle', 'uvTiling'].some(key =>
          Array.isArray(record(layer?.[key])?.['sequenceTracks']),
        )
      })
      out = {
        ...ref,
        ...(blend === 0 ? {} : { alphaMode: 'blend' as const }),
        shader: {
          ...ref.shader,
          parameters: {
            ...parameters,
            // Animated water/effect composites need the complete sequence vocabulary. Static
            // legacy composites keep the established textured fallback until every CMP_ family
            // has material parity; compiling those today turns authored transparent areas black.
            renderModel: animatedComposite ? { ...surfaceModel, standard } : { standard },
          },
        },
      }
    }
    if (cliff && standard !== undefined && out.shader !== undefined) {
      // Keep the render model's version and surface fields: without them the program is refused
      // and the piece falls back to the plain textured path, which reads the atlas by raw UV (no
      // uvTiling/uvOffset: black rock texels) and draws back faces.
      const { composite: _cliffComposite, ...surface } = renderModel ?? {}
      void _cliffComposite
      out = {
        ...out,
        alphaMode: 'mask' as const,
        alphaCutoff: 0.5,
        shader: {
          ...out.shader,
          parameters: {
            ...out.shader.parameters,
            renderModel: {
              ...surface,
              standard: { ...standard, blendMode: 0, alphaTestThreshold: 0.5 },
            },
          },
        },
      }
    }
    return out
  })
}

/**
 * Layers a glTF program does not carry: the material keeps its fallback (gltf-program.ts). The
 * normal map in every spelling the fallback draws it by (NORMAL_SLOTS).
 */
const GLTF_UNCARRIED_SLOTS = new Set([...NORMAL_SLOTS, 'emissive', 'occlusion'])

/**
 * A model material of the glTF path as the scene draws it (materials/gltf-program.ts): its base
 * colour factor and texture, metallic-roughness factors (absent: a rough dielectric, as the model
 * contract says) and texture, emissive colour, coverage, sides, draw order and team colour
 * (modelMaterialTeamColor, at the base colour's UVs), with the UV set its textures read. Undefined
 * for a material the glTF programs do not carry, which keeps the fallback path: a program of its
 * own, unlit, a normal, emissive or occlusion texture, a metallic-roughness texture on another UV
 * set than the base colour's, or neither a factor nor a texture (the fallback marks those with a
 * stand-in hue).
 *
 * One UV set per material, as the UVM route draws (uvm/render.ts) and the fallback reads (the base
 * colour's): the program reads it as its first coordinates (worldUvSetPrimitive), and a team mask
 * on another set is not drawn, as neither draws it.
 */
function worldGltfSceneMaterial(
  ref: ModelMaterialRef,
  byId: ReadonlyMap<string, SceneRendererTexture>,
): Readonly<{ material: SceneRendererMaterial; uvSet: number }> | undefined {
  if (ref.shader !== undefined || ref.unlit === true) return undefined
  const layers = (ref.layers ?? []).filter(layer => layer.resourceId !== undefined)
  if (layers.some(layer => GLTF_UNCARRIED_SLOTS.has(materialSlot(layer.slot)))) return undefined
  const layerOf = (slots: ReadonlySet<string>) =>
    layers.find(candidate => slots.has(materialSlot(candidate.slot)))
  const baseLayer = layerOf(BASE_COLOR_SLOTS)
  const metallicRoughnessLayer = layerOf(GLTF_METALLIC_ROUGHNESS_SLOTS)
  const uvSet = baseLayer?.uvSource ?? metallicRoughnessLayer?.uvSource ?? 0
  if ((metallicRoughnessLayer?.uvSource ?? uvSet) !== uvSet) return undefined
  const base = baseLayer === undefined ? undefined : byId.get(baseLayer.resourceId!)
  if (ref.baseColorFactor === undefined && base === undefined) return undefined
  // coverage as the fallback reads it (alpha mode, cutoff, native blend); an adding blend is its own
  const coverage = modelMaterialCoverage(ref)
  if (ref.blendMode === 'additive' || ref.blendMode === 'add-alpha') return undefined
  const metallicRoughness =
    metallicRoughnessLayer === undefined ? undefined : byId.get(metallicRoughnessLayer.resourceId!)
  const team = modelMaterialTeamColor(ref, byId, uvSet)
  const bindings = layers.flatMap(layer => {
    const texture = byId.get(layer.resourceId!)
    return texture === undefined ? [] : [{ resourceId: layer.resourceId!, textureId: texture.id }]
  })
  const material: SceneRendererMaterial = Object.freeze({
    id: ref.id,
    baseColor: ref.baseColorFactor ?? ([1, 1, 1, 1] as const),
    ...(base === undefined ? {} : { baseColorTexture: base.id }),
    shading: 'pbr' as const,
    pbr: Object.freeze({
      metallic: ref.metallicFactor ?? 0,
      roughness: ref.roughnessFactor ?? 1,
      ...(metallicRoughness === undefined ? {} : { metallicRoughnessTexture: metallicRoughness.id }),
      ...(ref.emissiveFactor === undefined ? {} : { emissive: ref.emissiveFactor }),
    }),
    alphaMode: coverage.mode,
    ...(coverage.mode === 'mask' ? { alphaCutoff: coverage.cutoff } : {}),
    ...(ref.doubleSided === true ? { doubleSided: true } : {}),
    ...(ref.depthWrite === undefined ? {} : { depthWrite: ref.depthWrite }),
    ...(ref.priority === undefined ? {} : { priority: ref.priority }),
    ...(team === undefined ? {} : { teamColor: team }),
    ...(bindings.length === 0 ? {} : { textureBindings: Object.freeze(bindings) }),
  })
  return Object.freeze({ material, uvSet })
}

/**
 * A placed primitive of a material whose glTF program reads UV set `uvSet` (worldGltfSceneMaterial):
 * that set as its only coordinates, the first set the program and the base routes read, as the UVM
 * route does (the GPU path and the CPU sampler take a numbered set 0 before `textureCoordinates`);
 * without the set, no coordinates, as the fallback draws such a primitive untextured.
 */
function worldUvSetPrimitive<P extends SceneRendererPrimitive>(primitive: P, uvSet: number | undefined): P {
  if (uvSet === undefined) return primitive
  const coordinates = primitive.textureCoordinateSets?.find(set => set.set === uvSet)?.coordinates
  const { textureCoordinates, textureCoordinateSets, ...rest } = primitive
  void textureCoordinates
  void textureCoordinateSets
  return (coordinates === undefined ? rest : { ...rest, textureCoordinates: coordinates }) as P
}

const GLTF_METALLIC_ROUGHNESS_SLOTS = new Set(['metallicroughness'])

function worldModelSceneMaterials(
  refs: readonly ModelMaterialRef[],
  textures: readonly SceneRendererTexture[],
): Readonly<{
  materials: readonly SceneRendererMaterial[]
  textures: readonly SceneRendererTexture[]
  /** The UV set a material's glTF program reads, where it is not the first (worldUvSetPrimitive). */
  uvSets: ReadonlyMap<string, number>
}> {
  const byId = new Map(textures.map(texture => [texture.id, texture]))
  const used = new Map<string, SceneRendererTexture>()
  const uvSets = new Map<string, number>()
  const materials = refs.map((ref): SceneRendererMaterial => {
    const gltf = worldGltfSceneMaterial(ref, byId)
    if (gltf !== undefined) {
      for (const binding of gltf.material.textureBindings ?? [])
        used.set(binding.textureId, byId.get(binding.textureId)!)
      if (gltf.uvSet !== 0) uvSets.set(ref.id, gltf.uvSet)
      return gltf.material
    }
    const baseLayer = ref.layers?.find(
      layer => BASE_COLOR_SLOTS.has(materialSlot(layer.slot)) && layer.resourceId !== undefined,
    )
    const baseTexture =
      baseLayer?.resourceId === undefined ? undefined : byId.get(baseLayer.resourceId)
    const bindings: { resourceId: string; textureId: string }[] = []
    const bound = new Set<string>()
    for (const layer of ref.layers ?? []) {
      if (layer.resourceId === undefined || bound.has(layer.resourceId)) continue
      const texture = byId.get(layer.resourceId)
      if (texture === undefined) continue
      bound.add(layer.resourceId)
      used.set(texture.id, texture)
      bindings.push({ resourceId: layer.resourceId, textureId: texture.id })
    }
    return Object.freeze({
      id: ref.id,
      baseColor: baseTexture === undefined ? colorHash(ref.id) : ([0.78, 0.8, 0.84, 1] as const),
      ...(baseTexture === undefined ? {} : { baseColorTexture: baseTexture.id }),
      shading: 'lambert' as const,
      ...(ref.alphaMode === undefined ? {} : { alphaMode: ref.alphaMode }),
      ...(ref.alphaCutoff === undefined ? {} : { alphaCutoff: ref.alphaCutoff }),
      ...(ref.shader === undefined ? {} : { shader: ref.shader }),
      ...(bindings.length === 0 ? {} : { textureBindings: Object.freeze(bindings) }),
    })
  })
  return Object.freeze({
    materials: Object.freeze(materials),
    textures: Object.freeze([...used.values()]),
    uvSets,
  })
}

function worldObjectTransform(
  item: WorldSceneObjectItem,
  translation: readonly [number, number, number],
): Float32Array {
  const scale = item.uvwScale ?? item.scale ?? { x: 1, y: 1, z: 1 }
  const rotation =
    item.uvwRotation === undefined
      ? componentLocalTransform({
          id: 'world-object',
          resourceId: 'world-object',
          rotation: [0, Math.sin(objectYaw(item) / 2), 0, Math.cos(objectYaw(item) / 2)],
        })
      : componentLocalTransform({
          id: 'world-object',
          resourceId: 'world-object',
          rotation: item.uvwRotation,
        })
  for (const row of [0, 1, 2]) {
    rotation[row] = (rotation[row] ?? 0) * scale.x
    rotation[4 + row] = (rotation[4 + row] ?? 0) * scale.y
    rotation[8 + row] = (rotation[8 + row] ?? 0) * scale.z
  }
  rotation[12] = translation[0]
  rotation[13] = translation[1]
  rotation[14] = translation[2]
  return rotation
}

/** The instance tint of a placed model: its authored tint, times the selection highlight. */
function worldObjectTint(
  item: WorldSceneObjectItem,
  selectedObjectId: number | undefined,
): readonly [number, number, number, number] | undefined {
  const selected = item.objectId === selectedObjectId
  if (item.presentationTint === undefined && !selected) return undefined
  const [red, green, blue] = item.presentationTint ?? [1, 1, 1]
  return selected ? [red, green * 0.82, blue * 0.12, 1] : [red, green, blue, 1]
}

function modelMaterialCoverage(material: ModelMaterialRef | undefined): Readonly<{
  mode: 'opaque' | 'mask' | 'blend'
  cutoff: number
}> {
  let cutoff = material?.alphaCutoff
  const renderModel = material?.shader?.parameters['renderModel']
  if (renderModel !== null && typeof renderModel === 'object' && !Array.isArray(renderModel)) {
    const standard = (renderModel as Readonly<Record<string, unknown>>)['standard']
    if (standard !== null && typeof standard === 'object' && !Array.isArray(standard)) {
      const threshold = (standard as Readonly<Record<string, unknown>>)['alphaTestThreshold']
      if (cutoff === undefined && typeof threshold === 'number') cutoff = threshold
    }
  }
  if (cutoff !== undefined && (!Number.isFinite(cutoff) || cutoff < 0))
    throw new TypeError(`world material ${material?.id ?? '(unknown)'} has invalid alpha cutoff`)
  const nativeBlend = material?.blendMode
  const blended =
    nativeBlend === 'blend' || nativeBlend === 'additive' || nativeBlend === 'add-alpha'
  const mode =
    material?.alphaMode === 'mask' ||
    (material?.alphaMode === undefined && (cutoff ?? 0) > 0 && !blended)
      ? 'mask'
      : material?.alphaMode === 'blend' || blended
        ? 'blend'
        : 'opaque'
  return Object.freeze({ mode, cutoff: mode === 'mask' ? (cutoff ?? 0.5) : 0 })
}

type ModelMaterialShadowPolicy = Readonly<{ castShadows: boolean; receiveShadows: boolean }>

const DEFAULT_SHADOW_POLICY: ModelMaterialShadowPolicy = Object.freeze({
  castShadows: true,
  receiveShadows: true,
})
/** Materials are immutable model results: their policy is read once, not per primitive and plan. */
const materialShadowPolicies = new WeakMap<ModelMaterialRef, ModelMaterialShadowPolicy>()

function modelMaterialShadowPolicy(
  material: ModelMaterialRef | undefined,
): ModelMaterialShadowPolicy {
  if (material === undefined) return DEFAULT_SHADOW_POLICY
  let policy = materialShadowPolicies.get(material)
  if (policy === undefined) {
    const flags = new Set(material.flagNames ?? [])
    policy = Object.freeze({
      castShadows: material.castShadows ?? !flags.has('no-shadows-cast'),
      receiveShadows: material.receiveShadows ?? !flags.has('no-shadows-receive'),
    })
    materialShadowPolicies.set(material, policy)
  }
  return policy
}

/** A model's materials by id (the first of each id, as `find` would), once per material list. */
const materialsById = new WeakMap<
  readonly ModelMaterialRef[],
  ReadonlyMap<unknown, ModelMaterialRef>
>()

function modelMaterialById(
  materials: readonly ModelMaterialRef[],
  id: string | undefined,
): ModelMaterialRef | undefined {
  let byId = materialsById.get(materials)
  if (byId === undefined) {
    const map = new Map<unknown, ModelMaterialRef>()
    for (const material of materials) if (!map.has(material.id)) map.set(material.id, material)
    materialsById.set(materials, (byId = map))
  }
  return byId.get(id)
}

/**
 * The model resources an object places, in order and without repeats, and the components that
 * place them: once per item, not per plan.
 */
const worldObjectResources = new WeakMap<
  WorldSceneObjectItem,
  Readonly<{
    keyed: readonly string[]
    components: readonly MapModelComponentPlacement[]
  }>
>()

/** Every model resource an object places, without repeats: its own, its list and its components'. */
export function worldObjectModelResources(item: WorldSceneObjectItem): readonly string[] {
  return worldObjectResourcesOf(item).keyed
}

function worldObjectResourcesOf(item: WorldSceneObjectItem) {
  let resources = worldObjectResources.get(item)
  if (resources === undefined) {
    const resourceIds = [
      ...new Set([
        ...(item.resourceId === undefined ? [] : [item.resourceId]),
        ...(item.resourceIds ?? []),
      ]),
    ]
    resources = Object.freeze({
      keyed: Object.freeze([
        ...new Set([
          ...(item.resourceId === undefined ? [] : [item.resourceId]),
          ...(item.resourceIds ?? []),
          ...(item.modelComponents ?? []).map(component => component.resourceId),
        ]),
      ]),
      components:
        item.modelComponents ??
        Object.freeze(
          resourceIds.map((resourceId, index) =>
            Object.freeze({ id: `implicit-${String(index)}`, resourceId }),
          ),
        ),
    })
    worldObjectResources.set(item, resources)
  }
  return resources
}

function finitePlan(plan: readonly WorldBatchWrite[]) {
  for (const item of plan) {
    for (const values of [item.positions, item.normals, item.colors]) {
      for (const value of values) if (!Number.isFinite(value)) return false
    }
  }
  return true
}

type WorldModelSample = Readonly<{
  result: Extract<WorldSceneModelResult, { state: 'converted' }>
  primitives: readonly SceneRendererPrimitive[]
  nodeTransforms: ReadonlyMap<string, Float32Array>
}>

const worldModelSceneSamplers = new WeakMap<
  WorldModelSample['result'],
  Map<string, ReturnType<typeof createModelSceneSampler>>
>()

/**
 * The scene sampler of one model and clip. Building it (rig, skin deformers, clip tracks) cost more
 * than sampling it; every sample returns new arrays, so one sampler serves every clock and plan.
 */
function worldModelSceneSampler(
  result: WorldModelSample['result'],
  clip: NonNullable<Parameters<typeof createModelSceneSampler>[1]>['clip'],
): ReturnType<typeof createModelSceneSampler> {
  let samplers = worldModelSceneSamplers.get(result)
  if (samplers === undefined) worldModelSceneSamplers.set(result, (samplers = new Map()))
  const key = clip?.id ?? ''
  let sampler = samplers.get(key)
  if (sampler === undefined) {
    sampler = createModelSceneSampler(
      {
        nodes: result.nodes ?? [],
        meshes: result.meshes,
        primitives: result.primitives,
        ...(result.skeleton === undefined ? {} : { skeleton: result.skeleton }),
      },
      {
        ...(clip === undefined ? {} : { clip }),
        maxBytes: 64 * 1024 * 1024,
        // Skins keep their bind-pose arrays (and GPU buffers) and take each pose in the vertex
        // stage; what the plan reads on the CPU is posed there (worldPosedPrimitive).
        skinning: 'gpu',
      },
    )
    samplers.set(key, sampler)
  }
  return sampler
}

const staticModelSamples = new WeakMap<WorldModelSample['result'], Map<string, WorldModelSample>>()

/** Models with a camera-facing node (`ModelNode.billboard`): their pose follows the camera's turn. */
const cameraFacingWorldModels = new WeakMap<WorldModelSample['result'], boolean>()

function worldModelFacesCamera(result: WorldModelSample['result']): boolean {
  let faces = cameraFacingWorldModels.get(result)
  if (faces === undefined)
    cameraFacingWorldModels.set(
      result,
      (faces = (result.nodes ?? []).some(node => node.billboard !== undefined)),
    )
  return faces
}

/** Whether any model of the input faces the camera: only then does the camera's turn enter its plan. */
const cameraFacingWorldInputs = new WeakMap<ReadonlyMap<string, WorldSceneModelResult>, boolean>()

function worldInputFacesCamera(input: WorldWebGlInput): boolean {
  if (input.models === undefined) return false
  let faces = cameraFacingWorldInputs.get(input.models)
  if (faces === undefined)
    cameraFacingWorldInputs.set(
      input.models,
      (faces = [...input.models.values()].some(
        result => result.state === 'converted' && worldModelFacesCamera(result),
      )),
    )
  return faces
}

/** What of the orbit camera a camera-facing node follows: its turn, not its target or zoom. */
function worldCameraTurnKey(requested: WorldWebGlCamera | undefined): string {
  const view = cameraState(requested)
  return `${view.azimuth}|${view.elevation}`
}

/**
 * The camera an object's camera-facing nodes turn to, in its model's frame (`ModelSceneCamera`): the
 * orbit camera's turn as cameraFor places it (looking at the target from the azimuth and elevation,
 * +Y up), and an eye far along its view, which is where an orthographic camera looks from.
 * ponytail: the object's own rotation only; a component's rotation within the object is left out.
 */
function worldModelCamera(input: WorldWebGlInput, item: WorldSceneObjectItem) {
  const view = cameraState(input.camera)
  const horizontal = Math.cos(view.elevation)
  const z = [
    Math.cos(view.azimuth) * horizontal,
    Math.sin(view.elevation),
    Math.sin(view.azimuth) * horizontal,
  ] as const
  // x = up × z; the elevation stays short of a right angle, so it never vanishes
  const length = Math.hypot(z[0], z[2])
  const x = [z[2] / length, 0, -z[0] / length] as const
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
  const toModel = invertQuat(decomposeMatrix4(worldObjectTransform(item, [0, 0, 0])).rotation)
  const eye = rotateQuaternion([z[0] * 1e4, z[1] * 1e4, z[2] * 1e4], toModel)
  return Object.freeze({
    rotation: multiplyQuat(toModel, quaternionFromRotationMatrix([...x, ...y, ...z])),
    position: eye,
  })
}

/**
 * Each model at rest: sampled without a clip at time zero. An object whose geometry follows the
 * clock frames the plan by its models at rest, so the camera and the shadow map hold still while it
 * moves.
 */
const restWorldModelSamples = new WeakMap<WorldModelSample['result'], WorldModelSample>()

function restWorldModelSample(result: WorldModelSample['result']): WorldModelSample {
  let sample = restWorldModelSamples.get(result)
  if (sample === undefined) {
    const sampled =
      (result.nodes?.length ?? 0) === 0
        ? { primitives: result.primitives, nodeTransforms: new Map<string, Float32Array>() }
        : worldModelSceneSampler(result, undefined).sample(0)
    sample = Object.freeze({
      result,
      primitives: Object.freeze(sampled.primitives.map(worldPosedPrimitive)),
      nodeTransforms: sampled.nodeTransforms,
    })
    restWorldModelSamples.set(result, sample)
  }
  return sample
}

/**
 * An animated object's primitives at rest, placed, per component: what frames the plan while its
 * models move (restPrimitives). They follow only the rest sample, where the component stands and
 * which materials draw nothing, so an object rebuilt for its clock takes the same ones again.
 */
const worldRestPickPrimitives = new WeakMap<
  WorldSceneObjectItem,
  Map<
    string,
    Readonly<{
      sample: WorldModelSample
      placement: Float32Array
      hidden: string
      primitives: readonly WorldWebGlPickPrimitive[]
    }>
  >
>()

/**
 * A sampled primitive as it stands, for the plan's work on the CPU: a skin posed on the GPU
 * (ModelSceneSkin) is posed on the CPU once for it, any other primitive is itself.
 */
const worldPosedPrimitives = new WeakMap<SceneRendererPrimitive, SceneRendererPrimitive>()

/**
 * A primitive whose vertices at or below its object's origin (object-local y ≤ 0) reach `stretch`
 * world units lower (MapPlacedObject.presentationFoundationStretch): `component` places the model in
 * its object, `instance` the object's model in the world. The same primitive without a stretch.
 */
function foundationStretched<T extends SceneRendererPrimitive>(
  primitive: T,
  component: Float32Array,
  instance: Float32Array,
  stretch: number | undefined,
): T {
  if (stretch === undefined || !(stretch > 0)) return primitive
  const own = 'transform' in primitive ? primitive.transform : undefined
  const local = multiplyComponentTransforms(component, own ?? IDENTITY_COMPONENT_TRANSFORM)
  let inverse: number[]
  try {
    inverse = invertAffine(
      Array.from(multiplyComponentTransforms(instance, own ?? IDENTITY_COMPONENT_TRANSFORM)),
    )
  } catch {
    return primitive
  }
  // world down by `stretch`, in the primitive's own coordinates
  const down = [inverse[4]! * -stretch, inverse[5]! * -stretch, inverse[6]! * -stretch] as const
  const source = primitive.positions
  const positions = Float32Array.from(source)
  for (let index = 0; index + 2 < source.length; index += 3) {
    const x = source[index]!
    const y = source[index + 1]!
    const z = source[index + 2]!
    if (local[1]! * x + local[5]! * y + local[9]! * z + local[13]! > 1e-6) continue
    positions[index] = x + down[0]
    positions[index + 1] = y + down[1]
    positions[index + 2] = z + down[2]
  }
  return Object.freeze({ ...primitive, positions })
}

function worldPosedPrimitive<T extends SceneRendererPrimitive>(primitive: T): T {
  if (materialSkinOf(primitive) === undefined) return primitive
  let posed = worldPosedPrimitives.get(primitive)
  if (posed === undefined)
    worldPosedPrimitives.set(primitive, (posed = materialPosedPrimitive(primitive)))
  return posed as T
}

/**
 * A model sample with its skins posed on the CPU, for the plan's readers of vertices (cliff
 * pieces, terrain projections): the same sample when it has none, and one posed copy per sample
 * otherwise, so caches keyed by its primitives keep their keys.
 */
const worldPosedSamples = new WeakMap<WorldModelSample, WorldModelSample>()

function worldPosedSample<T extends WorldModelSample | undefined>(sample: T): T {
  if (sample === undefined || !sample.primitives.some(primitive => materialSkinOf(primitive)))
    return sample
  let posed = worldPosedSamples.get(sample)
  if (posed === undefined)
    worldPosedSamples.set(
      sample,
      (posed = Object.freeze({
        ...sample,
        primitives: Object.freeze(sample.primitives.map(worldPosedPrimitive)),
      })),
    )
  return posed as T
}

/**
 * Where each of an object's components sits in the object: a root turned by its own rotation, a
 * child on its parent's socket as the parent's model is sampled. A component whose parent model or
 * socket is missing gets no transform.
 */
function worldComponentTransforms(
  components: readonly MapModelComponentPlacement[],
  sampleOf: (resourceId: string) => WorldModelSample | undefined,
): Map<string, Float32Array> {
  const componentTransforms = new Map<string, Float32Array>()
  const pending = [...components]
  for (let pass = 0; pass < components.length && pending.length > 0; pass += 1) {
    let progressed = false
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const component = pending[index]!
      const localTransform = componentLocalTransform(component)
      if (component.parentId === undefined) {
        componentTransforms.set(
          component.id,
          component.rotation === undefined ? IDENTITY_COMPONENT_TRANSFORM : localTransform,
        )
      } else {
        const parentTransform = componentTransforms.get(component.parentId)
        const parent = components.find(candidate => candidate.id === component.parentId)
        const parentSample = parent === undefined ? undefined : sampleOf(parent.resourceId)
        const socket = parentSample?.result.sockets?.find(
          candidate => candidate.id === component.parentSocketId,
        )
        const socketTransform =
          socket === undefined ? undefined : parentSample?.nodeTransforms.get(socket.nodeId)
        if (parentTransform === undefined || socketTransform === undefined) continue
        componentTransforms.set(
          component.id,
          multiplyComponentTransforms(
            multiplyComponentTransforms(parentTransform, socketTransform),
            localTransform,
          ),
        )
      }
      pending.splice(index, 1)
      progressed = true
    }
    if (!progressed) break
  }
  return componentTransforms
}

type WorldModelPrograms = Readonly<{
  presented: readonly ModelMaterialRef[]
  scene: ReturnType<typeof worldModelSceneMaterials>
  programs: ReadonlyMap<string, SceneMaterialPrograms>
}>

/** A plan's programs of clock-following materials, per template key and then per clock. */
type WorldPlanPrograms = Map<string, Map<number, WorldModelPrograms>>

/** A kept scene's programs at the object's moment in another plan (see WorldStaticObject). */
type WorldSceneResampler = (
  input: WorldWebGlInput,
  planPrograms: WorldPlanPrograms,
) => ReadonlyMap<string, SceneMaterialPrograms>

// Resamplers live as long as their kept object, past the plan that made them: they are made here,
// not in the plan builder, whose frame (writes, terrain preparation) a closure there would hold.

/** The programs of a kept model scene at another moment: its object's clock at that input. */
function worldModelSceneResampler(
  result: WorldModelSample['result'],
  item: WorldSceneObjectItem,
  templateKey: string,
  animated: boolean,
  durationSeconds: number | undefined,
): WorldSceneResampler {
  return (next, nextPrograms) =>
    worldObjectModelPrograms(
      result,
      item,
      templateKey,
      worldObjectTime(next, item, animated, durationSeconds),
      () => worldObjectMaterialMoment(next, item, result).materialContext,
      nextPrograms,
    ).programs
}

/** The programs of a kept projected (decal) scene at another moment, sampled from its materials. */
function worldProjectorSceneResampler(
  materials: readonly SceneRendererMaterial[],
  textures: readonly SceneRendererTexture[],
  item: WorldSceneObjectItem,
  result: WorldModelSample['result'],
): WorldSceneResampler {
  let sampler: SceneMaterialProgramSampler | undefined
  return next => {
    try {
      sampler ??= createSceneMaterialProgramSampler(
        materials,
        new Map(textures.map(texture => [texture.id, texture])),
      )
      const { materialContext: context } = worldObjectMaterialMoment(next, item, result)
      return sampler.sample(context, [])
    } catch {
      // As in the build: unsupported projector materials stay apart from the map.
      return new Map()
    }
  }
}

/** Where and when an object samples one model's materials: its clip, clock and team colour. */
function worldObjectMaterialMoment(
  input: WorldWebGlInput,
  item: WorldSceneObjectItem,
  result: WorldModelSample['result'],
) {
  const selectedAnimation = worldModelAnimation(result, item)
  const time = worldObjectTime(
    input,
    item,
    selectedAnimation !== undefined,
    selectedAnimation?.durationSeconds,
  )
  const sequenceTime =
    selectedAnimation?.durationSeconds &&
    (item.presentationAnimation?.loop ?? selectedAnimation.looping)
      ? time % selectedAnimation.durationSeconds
      : time
  const teamColor =
    item.presentationTeamColor ??
    (item.player === undefined ? undefined : input.teamColors?.get(item.player))
  const terrainTiling = worldTerrainTiling(input)
  const materialContext: SceneMaterialContext = {
    time,
    sequenceTime,
    ...(selectedAnimation?.sequenceIndex === undefined
      ? {}
      : { sequenceIndex: selectedAnimation.sequenceIndex }),
    sceneLighting: true,
    ...(teamColor === undefined ? {} : { teamColor }),
    ...(item.presentationTeamColorIntensity === undefined
      ? {}
      : { teamColorIntensity: item.presentationTeamColorIntensity }),
    ...(terrainTiling === undefined ? {} : { terrainTiling }),
  }
  return { selectedAnimation, time, teamColor, materialContext }
}

type WorldTerrainTiling = readonly [number, number, number, number]
const worldTerrainTilings = new WeakMap<
  readonly MapTerrainMaterialDefinition[],
  Readonly<{ items: readonly WorldSceneItem[]; tiling: WorldTerrainTiling | undefined }>
>()

/**
 * The ground's texture tiling, as world-planar UV sources of model materials read it (see
 * SceneMaterialContext): an M3 lava or wet-floor plane repeats with the terrain it lies on, not once
 * per world unit (Tokyo_Rooftops' lava drew twelve times too fine). The terrain materials' one
 * transform, taken from terrain cells to the world plane the materials map (x, -z) by fitting two
 * terrain samples. Undefined without terrain materials, when their transforms differ or turn the
 * texture (Warzone 2100's transposed tiles), which a frequency and offset cannot spell.
 */
export function worldTerrainTiling(
  input: Pick<WorldWebGlInput, 'items' | 'terrainMaterials'>,
): WorldTerrainTiling | undefined {
  const materials = input.terrainMaterials
  if (materials === undefined || materials.length === 0) return undefined
  const known = worldTerrainTilings.get(materials)
  if (known?.items === input.items) return known.tiling
  const tiling = fitWorldTerrainTiling(input.items, materials)
  worldTerrainTilings.set(materials, { items: input.items, tiling })
  return tiling
}

const IDENTITY_TERRAIN_UV = Object.freeze({
  offset: [0, 0] as const,
  scale: [1, 1] as const,
  rotation: 0,
})

function fitWorldTerrainTiling(
  items: readonly WorldSceneItem[],
  materials: readonly MapTerrainMaterialDefinition[],
): WorldTerrainTiling | undefined {
  const transform = materials[0]?.uvTransform ?? IDENTITY_TERRAIN_UV
  for (const material of materials) {
    const other = material.uvTransform ?? IDENTITY_TERRAIN_UV
    if (
      other.rotation !== 0 ||
      other.scale[0] !== transform.scale[0] ||
      other.scale[1] !== transform.scale[1] ||
      other.offset[0] !== transform.offset[0] ||
      other.offset[1] !== transform.offset[1]
    )
      return undefined
  }
  // Plane coordinate = a * cell + b along each axis, from one sample and one further along it.
  let origin: WorldSceneTerrainItem | undefined
  let alongX: WorldSceneTerrainItem | undefined
  let alongY: WorldSceneTerrainItem | undefined
  for (const item of items) {
    if (item.facet !== 'terrain') continue
    if (origin === undefined) origin = item
    else if (alongX === undefined && item.x !== origin.x) alongX = item
    else if (alongY === undefined && item.y !== origin.y) alongY = item
    if (alongX !== undefined && alongY !== undefined) break
  }
  if (origin === undefined || alongX === undefined || alongY === undefined) return undefined
  const plane = (item: WorldSceneTerrainItem) => {
    const position = terrainPosition(item)
    return [position[0], -position[2]] as const
  }
  const start = plane(origin),
    onX = plane(alongX),
    onY = plane(alongY)
  const ax = (onX[0] - start[0]) / (alongX.x - origin.x),
    ay = (onY[1] - start[1]) / (alongY.y - origin.y)
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || ax === 0 || ay === 0) return undefined
  const bx = start[0] - ax * origin.x,
    by = start[1] - ay * origin.y
  // Unrotated, the centre rule is terrain u = o0 + s0 * cell x with o0 its value at cell 0, the
  // shader's u = X * t0 + t2; terrain v = o1 + s1 * cell y, the shader's v = 1 - (Y * t1 + t3).
  const [s0, s1] = transform.scale,
    [o0, o1] = transformTerrainUv([0, 0], transform)
  const tiling = [s0 / ax, -s1 / ay, o0 - (s0 * bx) / ax, 1 - o1 + (s1 * by) / ay] as const
  return tiling.every(Number.isFinite) ? Object.freeze(tiling) : undefined
}

/**
 * An object's programs for one model component at its moment. Same model, clock and team
 * presentation → same materials and programs (one GPU lease each), shared within the plan.
 * Materials without animation tracks do not follow the clock: their programs outlive the frame,
 * so an animated map keeps its GPU leases instead of preparing ~550 programs every frame.
 */
function worldObjectModelPrograms(
  result: WorldModelSample['result'],
  item: WorldSceneObjectItem,
  templateKey: string,
  time: number,
  context: () => SceneMaterialContext,
  planPrograms: WorldPlanPrograms,
): WorldModelPrograms {
  let byClock: Map<number, WorldModelPrograms> | undefined
  let retained: Map<string, WorldModelPrograms> | undefined
  let cachedMaterials: WorldModelPrograms | undefined
  if (worldMaterialsFollowTime(result)) {
    byClock = planPrograms.get(templateKey)
    if (byClock === undefined) planPrograms.set(templateKey, (byClock = new Map()))
    cachedMaterials = byClock.get(time)
  } else {
    retained = retainedWorldModelPrograms(result)
    cachedMaterials = retained.get(templateKey)
  }
  if (cachedMaterials === undefined) {
    const template = worldModelProgramTemplate(result, templateKey, item)
    let sampled: ReadonlyMap<string, SceneMaterialPrograms> = new Map()
    try {
      if (template.sampler !== undefined) sampled = template.sampler.sample(context(), [])
    } catch {
      // As above: an unsupported sample keeps the model's fallback.
      sampled = new Map()
    }
    cachedMaterials = Object.freeze({
      presented: template.presented,
      scene: template.scene,
      programs: sampled,
    })
    retained?.set(templateKey, cachedMaterials)
    byClock?.set(time, cachedMaterials)
  }
  return cachedMaterials
}

/** The presentation an object's programs for one model component are kept under. */
function worldObjectProgramTemplateKey(
  item: WorldSceneObjectItem,
  resourceId: string,
  moment: ReturnType<typeof worldObjectMaterialMoment>,
): string {
  const animation = moment.selectedAnimation?.id ?? ''
  const { teamColor } = moment
  const { terrainTiling } = moment.materialContext
  let byResource = worldObjectTemplateKeys.get(item)
  const known = byResource?.get(resourceId)
  if (
    known !== undefined &&
    known.animation === animation &&
    known.teamColor === teamColor &&
    known.terrainTiling === terrainTiling
  )
    return known.key
  const key = [
    resourceId,
    animation,
    teamColor?.join(',') ?? '',
    item.presentationTeamColorIntensity ?? '',
    item.derivedFrom === 'cliffs' ? 'cliffs' : '',
    terrainTiling?.join(',') ?? '',
  ].join('\u0000')
  if (byResource === undefined) worldObjectTemplateKeys.set(item, (byResource = new Map()))
  byResource.set(resourceId, Object.freeze({ animation, teamColor, terrainTiling, key }))
  return key
}

/**
 * Each object's last program template key per model, with what it was written from: the object's
 * team colour and the ground's tiling stay the same objects from frame to frame (the input's, as
 * worldStaticObjectKey takes them, and worldTerrainTiling's per input), and the rest is the object's
 * own.
 */
const worldObjectTemplateKeys = new WeakMap<
  WorldSceneObjectItem,
  Map<
    string,
    Readonly<{
      animation: string
      teamColor: unknown
      terrainTiling: unknown
      key: string
    }>
  >
>()

/**
 * The clocks at which an object samples its clock-following materials, one per model: the time
 * itself for one such model (most objects), which spares writing a number as text per object.
 */
function worldObjectMaterialClock(
  item: WorldSceneObjectItem,
  input: WorldWebGlInput,
): number | string {
  let clock: number | string = ''
  let models = 0
  for (const resourceId of worldObjectResourcesOf(item).keyed) {
    const result = input.models?.get(resourceId)
    if (result?.state !== 'converted' || !worldMaterialsFollowTime(result)) continue
    const selected = worldModelAnimation(result, item)
    const time = worldObjectTime(input, item, selected !== undefined, selected?.durationSeconds)
    models += 1
    clock = models === 1 ? time : `${clock}\u0000${time}`
  }
  return clock
}

/**
 * Whether two passes differ only in what a kept draw takes from the pass it stands for (see
 * WorldCurrentPrograms): uniform values, and the world-to-material frame and environment of the
 * frame uniforms. Shader, pipeline state, texture bindings, geometry preparation and the uniforms'
 * names and sizes are the same.
 */
function samePassLayout(left: StandardMaterialProgram, right: StandardMaterialProgram): boolean {
  if (
    left.key !== right.key ||
    left.vertexSource !== right.vertexSource ||
    left.fragmentSource !== right.fragmentSource ||
    left.blend !== right.blend ||
    left.depthPrepass !== right.depthPrepass ||
    left.priority !== right.priority ||
    left.twoSided !== right.twoSided ||
    left.normalMapSpace !== right.normalMapSpace ||
    left.tangentGeneration?.texCoord !== right.tangentGeneration?.texCoord ||
    left.textures.length !== right.textures.length
  )
    return false
  for (let index = 0; index < left.textures.length; index++) {
    const one = left.textures[index]!,
      other = right.textures[index]!
    if (
      one.slot !== other.slot ||
      one.resourceId !== other.resourceId ||
      one.uniform !== other.uniform ||
      one.wrapU !== other.wrapU ||
      one.wrapV !== other.wrapV ||
      one.dimension !== other.dimension
    )
      return false
  }
  const names = Object.keys(left.uniforms)
  if (names.length !== Object.keys(right.uniforms).length) return false
  for (const name of names) {
    const one = left.uniforms[name],
      other = right.uniforms[name]
    if (
      other === undefined ||
      (typeof one === 'number'
        ? typeof other !== 'number'
        : typeof other === 'number' || one!.length !== other.length)
    )
      return false
  }
  return true
}

/**
 * Whether programs sampled at another moment keep the layout of a kept scene's programs: the same
 * materials with the same bound textures, and passes of the same layout (samePassLayout).
 */
const programLayoutMatches = new WeakMap<
  ReadonlyMap<string, SceneMaterialPrograms>,
  Readonly<{ kept: ReadonlyMap<string, SceneMaterialPrograms>; same: boolean }>
>()
function sameProgramLayout(
  kept: ReadonlyMap<string, SceneMaterialPrograms>,
  now: ReadonlyMap<string, SceneMaterialPrograms>,
): boolean {
  const known = programLayoutMatches.get(now)
  if (known?.kept === kept) return known.same
  let same = kept.size === now.size
  for (const [id, entry] of kept) {
    if (!same) break
    const other = now.get(id)
    same =
      other !== undefined &&
      other.passes.length === entry.passes.length &&
      other.textures.size === entry.textures.size &&
      [...entry.textures].every(
        ([resource, texture]) => other.textures.get(resource) === texture,
      ) &&
      entry.passes.every((pass, index) => samePassLayout(pass, other.passes[index]!))
  }
  programLayoutMatches.set(now, Object.freeze({ kept, same }))
  return same
}

/**
 * What the programs and skins of kept scenes stand for in one plan (see keptWorldObjectScenes and
 * keptWorldObjectPose). A kept scene keeps the programs it was built with, and with them its draws,
 * instanced groups and GPU leases; each of its passes stands for the pass of the programs sampled
 * at the plan's clock, whose uniform values it draws with (`passes`, for MaterialSequencePrograms),
 * and its draws group with the draws of those programs as a new scene's would (`materials` and
 * `passes`).
 */
interface WorldCurrentPrograms {
  readonly passes: Map<StandardMaterialProgram, StandardMaterialProgram>
  readonly materials: Map<SceneMaterialPrograms, SceneMaterialPrograms>
  /**
   * Whether the kept objects of a cohort (WorldStaticObject.cohort) keep their scenes in this plan:
   * its members sample the same programs at the same moment, so the first one decides for all.
   */
  readonly cohorts: Map<string, boolean>
  /**
   * The skins of kept scenes whose models were sampled again at the plan's clock, each with the
   * skin of the new sample: the pose it draws in (MaterialInstances.palettes, worldWebGlPosedScene)
   * while its scene keeps its primitives, draws and groups.
   */
  readonly skins: Map<ModelSceneSkin, ModelSceneSkin>
  /**
   * The transforms of kept scenes' primitives whose objects moved in place since they were built,
   * each with the transform it draws with in this plan (WorldKeptPose.placed): the scene keeps its
   * primitives, draws and groups (worldWebGlPosedScene, groupWorldMaterialDraws).
   */
  readonly transforms: Map<Float32Array, Float32Array>
}

const worldCurrentPrograms = new WeakMap<WorldWebGlPlan, WorldCurrentPrograms>()

/**
 * The programs a plan's material scene draws with at the plan's clock: its own, or, for a scene
 * kept from an earlier plan while its materials play, the programs its programs stand for.
 */
export function worldWebGlScenePrograms(
  plan: WorldWebGlPlan,
  scene: WorldWebGlModelMaterialScene,
): ReadonlyMap<string, SceneMaterialPrograms> {
  const current = worldCurrentPrograms.get(plan)
  if (current === undefined) return scene.programs
  return new Map(
    [...scene.programs].map(([id, entry]) => [id, current.materials.get(entry) ?? entry] as const),
  )
}

/** Each plan's material scenes in the poses it draws them in (worldWebGlPosedScene). */
const worldPosedScenes = new WeakMap<
  WorldWebGlPlan,
  Map<WorldWebGlModelMaterialScene, WorldWebGlModelMaterialScene>
>()

/**
 * A plan's material scene in the poses it draws at the plan's clock: its own, or, for a scene kept
 * from an earlier plan while its models move its skins or its object moved in place, the same scene
 * whose primitives take the skins and transforms theirs stand for in this plan
 * (WorldCurrentPrograms.skins, transforms). Its programs stay its own (worldWebGlScenePrograms).
 */
export function worldWebGlPosedScene(
  plan: WorldWebGlPlan,
  scene: WorldWebGlModelMaterialScene,
): WorldWebGlModelMaterialScene {
  const current = worldCurrentPrograms.get(plan)
  const skins = current?.skins
  const transforms = current?.transforms
  if (
    (skins === undefined || skins.size === 0) &&
    (transforms === undefined || transforms.size === 0)
  )
    return scene
  let posedScenes = worldPosedScenes.get(plan)
  const known = posedScenes?.get(scene)
  if (known !== undefined) return known
  // A shadow primitive is one of the scene's primitives: posed as the same object.
  const posedPrimitives = new Map<SceneRendererPrimitive, SceneRendererPrimitive>()
  let moved = false
  const pose = (primitive: SceneRendererPrimitive) => {
    let posed = posedPrimitives.get(primitive)
    if (posed === undefined) {
      const skin = materialSkinOf(primitive)
      const now = skin === undefined ? undefined : skins?.get(skin)
      const placed =
        primitive.transform === undefined ? undefined : transforms?.get(primitive.transform)
      if (now !== undefined || placed !== undefined) moved = true
      posed =
        now === undefined && placed === undefined
          ? primitive
          : Object.freeze({
              ...primitive,
              ...(now === undefined ? {} : { skin: now }),
              ...(placed === undefined ? {} : { transform: placed }),
            })
      posedPrimitives.set(primitive, posed)
    }
    return posed
  }
  const primitives = scene.primitives.map(pose)
  const shadowPrimitives = scene.shadowPrimitives.map(pose)
  let made = scene
  if (moved) {
    made = Object.freeze({
      ...scene,
      primitives: Object.freeze(primitives),
      shadowPrimitives: Object.freeze(shadowPrimitives),
    })
    const shadowless = worldShadowlessMaterials.get(scene)
    if (shadowless !== undefined) worldShadowlessMaterials.set(made, shadowless)
  }
  if (posedScenes === undefined) worldPosedScenes.set(plan, (posedScenes = new Map()))
  posedScenes.set(scene, made)
  return made
}

/**
 * A kept object's scenes in this plan. Once the clock its materials follow has moved, the scenes
 * stay as kept and stand for the programs sampled at the new moment (see WorldCurrentPrograms).
 * Undefined when those programs changed layout, since the kept scenes were split by it, or when
 * another kept object with the same programs stands for others in this plan (its clock differs):
 * the object is then built anew, with programs of its own.
 */
function keptWorldObjectScenes(
  item: WorldSceneObjectItem,
  kept: WorldStaticObject,
  input: WorldWebGlInput,
  planPrograms: WorldPlanPrograms,
  current: WorldCurrentPrograms,
): readonly WorldWebGlModelMaterialScene[] | undefined {
  if (kept.resamplers === undefined) return kept.scenes
  // An object played at a time of its own is not its cohort's moment.
  const cohort =
    kept.cohort !== undefined && input.animationTimes?.has(item.objectId) !== true
      ? kept.cohort
      : undefined
  if (cohort !== undefined) {
    const keeps = current.cohorts.get(cohort)
    if (keeps !== undefined) return keeps ? kept.scenes : undefined
  }
  const scenes = keptWorldObjectResampledScenes(
    item,
    kept,
    kept.resamplers,
    input,
    planPrograms,
    current,
  )
  if (cohort !== undefined) current.cohorts.set(cohort, scenes !== undefined)
  return scenes
}

function keptWorldObjectResampledScenes(
  item: WorldSceneObjectItem,
  kept: WorldStaticObject,
  resamplers: readonly (WorldSceneResampler | undefined)[],
  input: WorldWebGlInput,
  planPrograms: WorldPlanPrograms,
  current: WorldCurrentPrograms,
  /**
   * The pairs that the objects before it in a block taken whole stand for (takeKeptBlock): this
   * object's pairs join them instead of the plan's programs, which take them all once every object
   * of the block keeps its scenes.
   */
  pending?: [SceneMaterialPrograms, SceneMaterialPrograms][],
): readonly WorldWebGlModelMaterialScene[] | undefined {
  // At its own clock a kept scene stands for its own programs.
  const moved = worldObjectMaterialClock(item, input) !== kept.materialClock
  // Objects kept with the same programs mostly stand for the same ones: only new pairs are added.
  let added: [SceneMaterialPrograms, SceneMaterialPrograms][] | undefined
  for (const [index, scene] of kept.scenes.entries()) {
    const resample = resamplers[index]
    if (resample === undefined) continue
    const programs = moved ? resample(input, planPrograms) : scene.programs
    if (programs !== scene.programs && !sameProgramLayout(scene.programs, programs))
      return undefined
    for (const [id, entry] of scene.programs) {
      const now = programs.get(id)!
      const standing =
        current.materials.get(entry) ??
        pending?.find(pair => pair[0] === entry)?.[1] ??
        added?.find(pair => pair[0] === entry)?.[1]
      if (standing === now) continue
      if (standing !== undefined) return undefined
      ;(added ??= []).push([entry, now])
    }
  }
  if (pending !== undefined) for (const pair of added ?? []) pending.push(pair)
  else standForPrograms(current, added ?? [])
  return kept.scenes
}

/** Lets the transforms where a moved kept object stands now stand for its scenes' (WorldKeptPose.placed). */
function standForPlacements(current: WorldCurrentPrograms, pose: WorldKeptPose | undefined): void {
  for (const [kept, now] of pose?.placed ?? []) current.transforms.set(kept, now)
}

/** Lets each pair's second skin stand for its first in the plan (keptWorldObjectPose). */
function standForSkins(
  current: WorldCurrentPrograms,
  pairs: readonly (readonly [ModelSceneSkin, ModelSceneSkin])[],
): void {
  for (const [kept, now] of pairs) current.skins.set(kept, now)
}

/**
 * How a kept object whose models move its geometry takes another clock (keptWorldObjectPose): its
 * models are sampled again, and while each new sample is the kept one in another pose of its skins
 * the object keeps its scenes, whose skins stand for the new ones (WorldCurrentPrograms.skins).
 */
interface WorldKeptPose {
  /** Each model of the object that moves its geometry, once: its clip, the time and the sample. */
  readonly models: readonly Readonly<{
    resourceId: string
    animation: ReturnType<typeof worldModelAnimation>
    time: number
    sample: WorldModelSample
  }>[]
  /** Where each component hung from a socket was placed: a socket may move with the clock. */
  readonly sockets: readonly Readonly<{ id: string; transform: Float32Array | undefined }>[]
  /**
   * Per primitive of the kept pick mesh: the skinned primitive it poses (its model in `models`, its
   * index in the model's sample, the scene's placed primitive and its pick slot), or undefined for
   * one without a skin, which stays as it is.
   */
  readonly picks: readonly (
    | Readonly<{
        model: number
        index: number
        instance: SceneRendererPrimitive
        slot: string
      }>
    | undefined
  )[]
  /**
   * False when a primitive drew by the fallback, posed on the CPU into the shared batches: the object
   * is kept only while the models' times stay.
   */
  readonly posable: boolean
  /**
   * Where the object stood (worldObjectTransform) and its tint (worldObjectTint) at the build. A
   * caller may move or shade an item in place, keeping its identity for its clock to pose it (the
   * RTS preview's units): its scenes, picks and effects hold the old ones, so it is built anew.
   */
  readonly placement: Float32Array
  readonly tint: readonly [number, number, number, number] | undefined
  /**
   * How the placement enters the object's scenes, effects and picks, for it to be placed anew where
   * it moves (movedWorldObject); undefined where the placement enters more (projectors, writes to
   * the shared batches, a stretched foundation, a cliff piece): such an object is built anew.
   */
  readonly placing?: WorldKeptPlacing
  /**
   * For an object moved in place since its scenes were built: each scene primitive's transform as
   * built to the one where the object stands now (WorldCurrentPrograms.transforms).
   */
  readonly placed?: ReadonlyMap<Float32Array, Float32Array>
}

/**
 * What a kept object's placement P enters (WorldKeptPose.placing): each material scene's primitive i
 * stands at P × component × own(i), each live effect at P × its component, each pick primitive is
 * its source placed as its scene primitive, and each component framed at rest (its models move its
 * geometry) is framed by its model at rest placed at P × its transform at rest.
 */
interface WorldKeptPlacing {
  readonly scenes: readonly Readonly<{
    component: Float32Array
    primitives: readonly (Float32Array | undefined)[]
  }>[]
  readonly effects: readonly Float32Array[]
  readonly picks: readonly Readonly<{
    source: SceneRendererPrimitive
    scene: number
    index: number
    slot: string
  }>[]
  readonly rest:
    | readonly Readonly<{
        id: string
        result: Extract<WorldSceneModelResult, { state: 'converted' }>
        programs: ReadonlyMap<string, SceneMaterialPrograms>
        transform: Float32Array
      }>[]
    | undefined
}

/**
 * A kept object moved in place (the RTS preview moves its units in their items) as a fresh build at
 * the new placement would make it from the same samples: its scenes as they are, their primitives'
 * transforms standing for the new ones (WorldKeptPose.placed, from the build's placing, so the same
 * arithmetic as a build), its live effects, picks and pick mesh placed anew. The object itself when
 * it stands where it was built or last moved to; undefined when it cannot move so (no placing) or
 * its tint changed with it: it is then built anew.
 */
function movedWorldObject(
  item: WorldSceneObjectItem,
  kept: WorldStaticObject,
  input: WorldWebGlInput,
): WorldStaticObject | undefined {
  const pose = kept.pose
  const placing = pose?.placing
  if (pose === undefined || placing === undefined) return undefined
  const translation = objectPosition(item, input)
  const placement = worldObjectTransform(item, translation)
  if (sameOptionalMatrix(pose.placement, placement)) return kept
  if (!sameOptionalMatrix(pose.tint, worldObjectTint(item, input.selectedObjectId)))
    return undefined
  // each scene primitive where it stands now, by its transform as built
  const placed = new Map<Float32Array, Float32Array>()
  const instances = new Map<SceneRendererPrimitive, SceneRendererPrimitive>()
  const instanceOf = (primitive: SceneRendererPrimitive) => {
    let instance = instances.get(primitive)
    if (instance === undefined)
      instances.set(
        primitive,
        (instance = Object.freeze({ ...primitive, transform: placed.get(primitive.transform!)! })),
      )
    return instance
  }
  for (const [index, scene] of kept.scenes.entries()) {
    const { component, primitives } = placing.scenes[index]!
    const instanceTransform = multiplyComponentTransforms(placement, component)
    for (const [at, primitive] of scene.primitives.entries())
      placed.set(
        primitive.transform!,
        multiplyComponentTransforms(
          instanceTransform,
          primitives[at] ?? IDENTITY_COMPONENT_TRANSFORM,
        ),
      )
  }
  // each pick primitive's scene primitive where it stands now (pose.picks follow the same order)
  const pickInstances = placing.picks.map(({ scene, index }) =>
    instanceOf(kept.scenes[scene]!.primitives[index]!),
  )
  const pickPrimitives = placing.picks.map(({ source, slot }, at) =>
    sharedPickPrimitive(source, pickInstances[at]!, item, slot),
  )
  const restPrimitives =
    placing.rest === undefined
      ? undefined
      : placing.rest.flatMap(({ id, result, programs, transform }) =>
          worldRestPickPrimitivesOf(
            item,
            id,
            result,
            programs,
            multiplyComponentTransforms(placement, transform),
          ),
        )
  return Object.freeze({
    ...kept,
    effects: Object.freeze(
      kept.effects.map((effect, index) =>
        Object.freeze({
          ...effect,
          transform: multiplyComponentTransforms(placement, placing.effects[index]!),
        }),
      ),
    ),
    pickMesh: worldObjectPickMesh(
      item.objectId,
      translation,
      [],
      pickPrimitives,
      false,
      [],
      restPrimitives ?? pickPrimitives,
    ),
    pose: Object.freeze({
      ...pose,
      picks: Object.freeze(
        pose.picks.map((pick, at) =>
          pick === undefined ? undefined : Object.freeze({ ...pick, instance: pickInstances[at]! }),
        ),
      ),
      placement,
      placed,
    }),
  })
}

/**
 * A component's model at rest placed for picking's bounds (WorldObjectPickMesh: an object whose
 * models move its geometry is framed by them at rest): the primitives the object draws (no material
 * without color passes, no empty ones). Kept per object and component while the rest sample, the
 * materials without passes and the placement stay.
 */
function worldRestPickPrimitivesOf(
  item: WorldSceneObjectItem,
  componentId: string,
  result: Extract<WorldSceneModelResult, { state: 'converted' }>,
  programs: ReadonlyMap<string, SceneMaterialPrograms>,
  restInstanceTransform: Float32Array,
): readonly WorldWebGlPickPrimitive[] {
  const rest = restWorldModelSample(result)
  // The materials without color passes, whose primitives the object does not draw.
  let hidden = ''
  for (const [id, prepared] of programs) if (prepared.passes.length === 0) hidden += `${id}\u0000`
  let placedAtRest = worldRestPickPrimitives.get(item)
  const known = placedAtRest?.get(componentId)
  if (
    known !== undefined &&
    known.sample === rest &&
    known.hidden === hidden &&
    sameOptionalMatrix(known.placement, restInstanceTransform)
  )
    return known.primitives
  const placed: WorldWebGlPickPrimitive[] = []
  let restIndex = -1
  for (const primitive of rest.primitives) {
    restIndex += 1
    // The primitives the object draws: no material without color passes, no empty ones.
    const prepared = programs.get(primitive.materialId ?? '')
    if (prepared !== undefined && prepared.passes.length === 0) continue
    if (primitiveTriangleCount(primitive) === 0) continue
    const primitiveTransform = 'transform' in primitive ? primitive.transform : undefined
    placed.push(
      sharedPickPrimitive(
        primitive,
        {
          ...primitive,
          transform: multiplyComponentTransforms(
            restInstanceTransform,
            primitiveTransform ?? IDENTITY_COMPONENT_TRANSFORM,
          ),
        },
        item,
        `rest\u0000${componentId}\u0000${String(restIndex)}`,
      ),
    )
  }
  if (placedAtRest === undefined) worldRestPickPrimitives.set(item, (placedAtRest = new Map()))
  placedAtRest.set(
    componentId,
    Object.freeze({
      sample: rest,
      placement: restInstanceTransform,
      hidden,
      primitives: Object.freeze(placed),
    }),
  )
  return placed
}

/**
 * The view a plan is drawn with, as the plan may leave poses to it (createWorldWebGlPlan's `view`):
 * the six planes of its camera, normalized, inside where n·p + d >= 0; when the plan casts shadows,
 * the direction the key light travels and, when known, the planes of its depth map's box (outside
 * it a caster writes no depth and a surface reads no shadow); and how far beyond what casts it a
 * shadow-map lookup reads, in world units. A sphere widened by that margin and beyond one plane of
 * the view, swept along the light as far as the depth map goes (or not at all, beyond the depth
 * map), adds no pixel to the view: nothing it holds is drawn there, and no surface drawn there reads
 * its shadow.
 */
export interface WorldPosingView {
  readonly planes: Float64Array
  readonly light:
    | Readonly<{ direction: readonly [number, number, number]; planes: Float64Array | undefined }>
    | undefined
  readonly margin: number
}

/** The planes of a view-projection (Gribb and Hartmann: the clip rows w ± x, w ± y, w ± z). */
function worldClipPlanes(viewProjection: Float32Array): Float64Array {
  const planes = new Float64Array(24)
  const row = (index: number, column: number) => viewProjection[column * 4 + index]!
  for (let plane = 0; plane < 6; plane++) {
    const axis = plane >> 1
    const sign = plane & 1 ? -1 : 1
    const a = row(3, 0) + sign * row(axis, 0)
    const b = row(3, 1) + sign * row(axis, 1)
    const c = row(3, 2) + sign * row(axis, 2)
    const d = row(3, 3) + sign * row(axis, 3)
    const length = Math.hypot(a, b, c)
    // a plane that does not resolve holds everything inside
    if (length > 0) planes.set([a / length, b / length, c / length, d / length], plane * 4)
    else planes.set([0, 0, 0, 1], plane * 4)
  }
  return planes
}

/**
 * A posing view (WorldPosingView) of a camera's view-projection, a margin in world units and, when
 * the plan casts shadows, the key light: the direction it travels and its depth map's
 * view-projection (without one, a shadow is swept on without end).
 */
export function worldPosingView(
  viewProjection: Float32Array,
  margin: number,
  light?: Readonly<{ direction: readonly number[]; viewProjection?: Float32Array }>,
): WorldPosingView {
  const direction = light?.direction
  const travel =
    direction === undefined ? 0 : Math.hypot(direction[0]!, direction[1]!, direction[2]!)
  return Object.freeze({
    planes: worldClipPlanes(viewProjection),
    light:
      direction === undefined || !(travel > 0)
        ? undefined
        : Object.freeze({
            direction: Object.freeze([
              direction[0]! / travel,
              direction[1]! / travel,
              direction[2]! / travel,
            ] as const),
            planes:
              light?.viewProjection === undefined
                ? undefined
                : worldClipPlanes(light.viewProjection),
          }),
    margin,
  })
}

/**
 * The view a renderer draws a plan with, `width` by `height` into a drawing buffer of `buffer`
 * (WorldPosingView): its scene camera; when the input casts shadows, the key light and the box of
 * the depth map the shadow pass draws (worldShadowLightView); and a margin of three texels of that
 * map at the coarsest it can be (at least 2048 texels, or what the input asks, less), which also
 * covers the rounding of a draw. Undefined for a size no camera takes.
 */
function worldPlanPosingView(
  plan: WorldWebGlPlan,
  input: WorldWebGlInput,
  width: number,
  height: number,
  buffer: Readonly<{ width: number; height: number }>,
): WorldPosingView | undefined {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height))
    return undefined
  const { camera } = cameraFor(plan, width, height, input.camera)
  const viewProjection = Float32Array.from(
    camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).elements,
  )
  const requested = input.shadowMapSize ?? 2_048
  const size = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 2_048) : 2_048
  // the depth map's aspect is the drawing buffer's; one it does not report takes the view's
  const bufferShape = buffer.width > 0 && buffer.height > 0
  const light = worldShadowLightView(
    plan,
    input,
    bufferShape ? buffer.width : width,
    bufferShape ? buffer.height : height,
  )
  if (!(light.radius > 0) || !Number.isFinite(light.radius)) return undefined
  return worldPosingView(
    viewProjection,
    (6 * light.radius) / size,
    input.shadows === true
      ? { direction: plan.light.direction, viewProjection: light.viewProjection }
      : undefined,
  )
}

/** Whether a view sees no part of a sphere (x, y, z, radius) nor of its shadow (WorldPosingView). */
function worldSphereUnseen(view: WorldPosingView, sphere: ArrayLike<number>, at = 0): boolean {
  const x = sphere[at]!
  const y = sphere[at + 1]!
  const z = sphere[at + 2]!
  const reach = sphere[at + 3]! + view.margin
  // a reach that does not resolve sees everything
  if (!(reach >= 0)) return false
  const { planes, light } = view
  // How far along the light its shadow can fall: until the sphere has left the depth map's box,
  // nothing (-1) when it lies beyond the box, and nothing (0) when there is no shadow.
  let sweep = 0
  if (light !== undefined) {
    sweep = Number.POSITIVE_INFINITY
    const box = light.planes
    const [lx, ly, lz] = light.direction
    for (let plane = 0; box !== undefined && plane < 24; plane += 4) {
      const distance = box[plane]! * x + box[plane + 1]! * y + box[plane + 2]! * z + box[plane + 3]!
      if (distance < -reach) {
        sweep = -1
        break
      }
      const toward = box[plane]! * lx + box[plane + 1]! * ly + box[plane + 2]! * lz
      if (toward < 0) sweep = Math.min(sweep, (distance + reach) / -toward)
    }
  }
  for (let plane = 0; plane < 24; plane += 4) {
    const nx = planes[plane]!
    const ny = planes[plane + 1]!
    const nz = planes[plane + 2]!
    const distance = nx * x + ny * y + nz * z + planes[plane + 3]!
    if (distance >= -reach) continue
    if (sweep <= 0) return true
    // swept along the light as far as its shadow falls, the sphere stays beyond the plane
    const [lx, ly, lz] = light!.direction
    const toward = nx * lx + ny * ly + nz * lz
    if (toward <= 0 || distance + sweep * toward < -reach) return true
  }
  return false
}

/** The spheres of the objects a plan left unposed (createWorldWebGlPlan): x, y, z and radius each. */
const worldUnposedSpheres = new WeakMap<WorldWebGlPlan, Float64Array>()

/**
 * Whether a view sees an object a plan left unposed: then the plan is made again with that view. An
 * unknown view (undefined) is taken to see them all.
 */
function worldPlanUnposedSeen(plan: WorldWebGlPlan, view: WorldPosingView | undefined): boolean {
  const spheres = worldUnposedSpheres.get(plan)
  if (spheres === undefined) return false
  if (view === undefined) return true
  for (let at = 0; at < spheres.length; at += 4)
    if (!worldSphereUnseen(view, spheres, at)) return true
  return false
}

/**
 * Where any pose of a kept object reaches (WorldKeptPose): its models' bounds (the scene sampler's
 * spheres, held by one about the first's center) placed by its placement, the radius stretched by
 * it, with a margin for the float32 arithmetic of placing them. Undefined for an object whose
 * components the item places (their own transforms, sockets that move with the clock), one that
 * drew by the fallback, or a model whose samples the bounds do not hold.
 */
const worldKeptPoseSpheres = new WeakMap<WorldKeptPose, Float64Array | null>()
function worldKeptPoseSphere(
  item: WorldSceneObjectItem,
  pose: WorldKeptPose,
): Float64Array | undefined {
  let sphere = worldKeptPoseSpheres.get(pose)
  if (sphere === undefined) {
    sphere = null
    if (item.modelComponents === undefined && pose.sockets.length === 0 && pose.posable) {
      let center: readonly [number, number, number] | undefined
      let radius: number | undefined = 0
      for (const { sample, animation } of pose.models) {
        const clip = animation?.kind === 'animation' ? animation : undefined
        const bounds = worldModelSceneSampler(sample.result, clip).bounds()
        if (bounds === undefined) {
          radius = undefined
          break
        }
        center ??= bounds.center
        const [x, y, z] = bounds.center
        radius = Math.max(
          radius,
          Math.hypot(x - center[0], y - center[1], z - center[2]) + bounds.radius,
        )
      }
      if (center !== undefined && radius !== undefined) {
        const [x, y, z] = center
        const m = pose.placement
        const placed = [0, 1, 2].map(
          row => m[row]! * x + m[4 + row]! * y + m[8 + row]! * z + m[12 + row]!,
        )
        const stretched = radius * linearStretch(m)
        sphere = Float64Array.of(
          placed[0]!,
          placed[1]!,
          placed[2]!,
          stretched + 1e-5 * (stretched + Math.hypot(placed[0]!, placed[1]!, placed[2]!)),
        )
      }
    }
    worldKeptPoseSpheres.set(pose, sphere)
  }
  return sphere ?? undefined
}

/**
 * The samples a plan took of kept samples' models at another time (keptWorldObjectPose): objects
 * kept with one sample, at one time now, take the same new sample.
 */
type WorldResampled = Map<
  WorldModelSample,
  Readonly<{ time: number; now: WorldModelSample | undefined }>
>

/**
 * A kept object's pick mesh in this plan when its models move its geometry (WorldStaticObject.pose):
 * the kept mesh while each model's time stays. At another time the model is sampled again, the skins
 * of the kept scenes stand for the new sample's skins (added to `pairs`, which may hold the pairs of
 * the objects before it in a block), and the pick primitives are posed at the new samples. An object
 * `unseen` says the plan's view cannot see in any pose keeps its scenes and pick mesh as they are:
 * whatever pose they hold stays out of that view.
 * Undefined when the item was moved, turned or shaded in place since the build, when a new sample
 * differs from the kept one in more than its skins' poses (another visibility, a moving node or
 * socket), when a skin already stands for another pose in this plan, or when the object drew by the
 * fallback: the object is then built anew.
 */
function keptWorldObjectPose(
  item: WorldSceneObjectItem,
  kept: WorldStaticObject,
  pose: WorldKeptPose,
  input: WorldWebGlInput,
  sample: (resourceId: string, item: WorldSceneObjectItem) => WorldModelSample | undefined,
  resampled: WorldResampled,
  current: WorldCurrentPrograms,
  pairs: [ModelSceneSkin, ModelSceneSkin][],
  unseen?: (item: WorldSceneObjectItem, pose: WorldKeptPose) => boolean,
): WorldObjectPickMesh | undefined {
  if (
    !sameOptionalMatrix(pose.placement, worldObjectTransform(item, objectPosition(item, input))) ||
    !sameOptionalMatrix(pose.tint, worldObjectTint(item, input.selectedObjectId))
  )
    return undefined
  // Each model's sample at this clock: the kept one while its time stays.
  let samples: WorldModelSample[] | undefined
  for (let at = 0; at < pose.models.length; at++) {
    const model = pose.models[at]!
    const time = worldModelSampleTime(input, item, model.animation)
    if (time === model.time) {
      samples?.push(model.sample)
      continue
    }
    if (!pose.posable) return undefined
    // Out of the view's sight in any pose, the object keeps the pose it has (see `unseen`).
    if (samples === undefined && unseen?.(item, pose) === true) return kept.pickMesh
    samples ??= pose.models.slice(0, at).map(entry => entry.sample)
    const known = resampled.get(model.sample)
    let now = known?.now
    if (known?.time !== time) {
      now = sample(model.resourceId, item)
      resampled.set(model.sample, Object.freeze({ time, now }))
    }
    if (now === undefined || !sameWorldPosedSample(model.sample, now)) return undefined
    samples.push(now)
  }
  if (samples === undefined) return kept.pickMesh
  if (pose.sockets.length > 0) {
    const placed = worldComponentTransforms(worldObjectResourcesOf(item).components, resourceId =>
      sample(resourceId, item),
    )
    for (const socket of pose.sockets)
      if (!sameOptionalMatrix(socket.transform, placed.get(socket.id))) return undefined
  }
  for (let at = 0; at < pose.models.length; at++) {
    const keptSample = pose.models[at]!.sample
    const now = samples[at]!
    if (now === keptSample) continue
    for (let index = 0; index < keptSample.primitives.length; index++) {
      const skin = materialSkinOf(keptSample.primitives[index]!)
      if (skin === undefined) continue
      const nowSkin = materialSkinOf(now.primitives[index]!)!
      const standing = current.skins.get(skin) ?? pairs.find(pair => pair[0] === skin)?.[1]
      if (standing === nowSkin) continue
      if (standing !== undefined) return undefined
      pairs.push([skin, nowSkin])
    }
  }
  return worldPosedPickMesh(item, kept.pickMesh, pose, samples)
}

/**
 * A kept object's pick mesh with its skinned primitives posed at new samples (keptWorldObjectPose),
 * framed as the kept one (at rest). Its pick primitives are made when first read, as a pick or the
 * plan's reader asks for them.
 */
function worldPosedPickMesh(
  item: WorldSceneObjectItem,
  kept: WorldObjectPickMesh,
  pose: WorldKeptPose,
  samples: readonly WorldModelSample[],
): WorldObjectPickMesh {
  let primitives: readonly WorldWebGlPickPrimitive[] | undefined
  const posed = () =>
    (primitives ??= Object.freeze(
      kept.primitives.map((entry, at) => {
        const pick = pose.picks[at]
        if (pick === undefined) return entry
        const now = samples[pick.model]!
        if (now === pose.models[pick.model]!.sample) return entry
        const source = now.primitives[pick.index]!
        return sharedPickPrimitive(
          source,
          Object.freeze({ ...pick.instance, skin: materialSkinOf(source) }),
          item,
          pick.slot,
        )
      }),
    ))
  const { pick } = kept
  return {
    objectId: kept.objectId,
    center: kept.center,
    triangles: kept.triangles,
    get primitives() {
      return posed()
    },
    placeholder: kept.placeholder,
    get bounds() {
      return kept.bounds
    },
    envelope: kept.envelope,
    pick: Object.freeze({
      objectId: pick.objectId,
      center: pick.center,
      triangles: pick.triangles,
      get primitives() {
        return posed()
      },
      placeholder: pick.placeholder,
    }),
  }
}

/** Whether a model's new sample is a kept one in another pose of its skins, per pair once. */
const worldPosedSampleMatches = new WeakMap<WorldModelSample, WeakMap<WorldModelSample, boolean>>()
function sameWorldPosedSample(kept: WorldModelSample, now: WorldModelSample): boolean {
  if (kept === now) return true
  let byKept = worldPosedSampleMatches.get(now)
  const known = byKept?.get(kept)
  if (known !== undefined) return known
  let same = kept.result === now.result && kept.primitives.length === now.primitives.length
  for (let index = 0; same && index < kept.primitives.length; index++)
    same = sameWorldPosedPrimitive(kept.primitives[index]!, now.primitives[index]!)
  if (byKept === undefined) worldPosedSampleMatches.set(now, (byKept = new WeakMap()))
  byKept.set(kept, same)
  return same
}

/**
 * Whether a primitive of a new sample is a kept one in another pose: the same fields holding the same
 * objects, but for the skin, whose pose may differ (sameSkinBesidesPose), and the transform, which
 * each sample makes anew (a skin's frame), here with the same values.
 */
function sameWorldPosedPrimitive(
  kept: SceneRendererPrimitive,
  now: SceneRendererPrimitive,
): boolean {
  if (kept === now) return true
  const keys = Object.keys(kept)
  if (keys.length !== Object.keys(now).length) return false
  for (const key of keys) {
    if (!Object.hasOwn(now, key)) return false
    const one: unknown = (kept as unknown as Record<string, unknown>)[key]
    const other: unknown = (now as unknown as Record<string, unknown>)[key]
    if (one === other) continue
    if (key === 'transform') {
      if (!sameOptionalMatrix(one as Float32Array | undefined, other as Float32Array | undefined))
        return false
    } else if (
      key !== 'skin' ||
      !sameSkinBesidesPose(one as ModelSceneSkin, other as ModelSceneSkin)
    )
      return false
  }
  return true
}

/**
 * Whether two skins bind the same vertices to the same slots and weights: the same fields holding the
 * same objects, but for the pose, its palette of as many slots and its pose on the CPU.
 */
function sameSkinBesidesPose(kept: ModelSceneSkin, now: ModelSceneSkin): boolean {
  const keys = Object.keys(kept)
  if (keys.length !== Object.keys(now).length) return false
  for (const key of keys) {
    if (!Object.hasOwn(now, key)) return false
    if (key === 'palette') {
      if (kept.palette.length !== now.palette.length) return false
    } else if (
      key !== 'deformed' &&
      (kept as unknown as Record<string, unknown>)[key] !==
        (now as unknown as Record<string, unknown>)[key]
    )
      return false
  }
  return true
}

/** Lets each pair's second programs stand for its first in the plan (keptWorldObjectResampledScenes). */
function standForPrograms(
  current: WorldCurrentPrograms,
  pairs: readonly (readonly [SceneMaterialPrograms, SceneMaterialPrograms])[],
): void {
  for (const [entry, now] of pairs) {
    current.materials.set(entry, now)
    entry.passes.forEach((pass, index) => current.passes.set(pass, now.passes[index]!))
  }
}

// Programs of clock-independent materials, per converted model and presentation key. Bounded by the
// model's presentation variants (animation, team color, cliff use); released with the model result.
const retainedModelPrograms = new WeakMap<
  WorldModelSample['result'],
  Map<string, WorldModelPrograms>
>()

function retainedWorldModelPrograms(
  result: WorldModelSample['result'],
): Map<string, WorldModelPrograms> {
  let programs = retainedModelPrograms.get(result)
  if (programs === undefined) retainedModelPrograms.set(result, (programs = new Map()))
  return programs
}

interface WorldModelProgramTemplate {
  readonly presented: WorldModelPrograms['presented']
  readonly scene: WorldModelPrograms['scene']
  /** Undefined when the materials are malformed or unsupported: the model keeps its fallback. */
  readonly sampler: SceneMaterialProgramSampler | undefined
}

const retainedModelProgramTemplates = new WeakMap<
  WorldModelSample['result'],
  Map<string, WorldModelProgramTemplate>
>()

/**
 * The clock-independent part of a model's material programs for one presentation (animation,
 * team colour, cliff): presented materials, their scene materials and the compiled program sampler.
 * A playing model samples it per clock instead of snapshotting and compiling its materials again.
 */
function worldModelProgramTemplate(
  result: WorldModelSample['result'],
  key: string,
  item: WorldSceneObjectItem,
): WorldModelProgramTemplate {
  let templates = retainedModelProgramTemplates.get(result)
  if (templates === undefined) retainedModelProgramTemplates.set(result, (templates = new Map()))
  let template = templates.get(key)
  if (template === undefined) {
    const presented = presentationMaterials(item, result.materials ?? [])
    const scene = worldModelSceneMaterials(presented, result.textures ?? [])
    let sampler: SceneMaterialProgramSampler | undefined
    try {
      sampler = createSceneMaterialProgramSampler(
        scene.materials,
        new Map(scene.textures.map(texture => [texture.id, texture])),
        undefined,
        { gltfPrograms: true },
      )
    } catch {
      // A malformed or unsupported game-material vocabulary must retain the existing visible
      // fallback instead of making the whole map fail to render.
      sampler = undefined
    }
    template = Object.freeze({ presented, scene, sampler })
    templates.set(key, template)
  }
  return template
}

/** A kept object's cohort (WorldStaticObject.cohort), from its resampled scenes' terms. */
function worldObjectCohort(
  item: WorldSceneObjectItem,
  input: WorldWebGlInput,
  scenes: readonly WorldWebGlModelMaterialScene[],
  resamplers: ReadonlyMap<WorldWebGlModelMaterialScene, WorldSceneResampler>,
  terms: ReadonlyMap<WorldWebGlModelMaterialScene, string>,
): { cohort?: string } {
  if (input.animationTimes?.has(item.objectId) === true) return {}
  const parts: (number | string)[] = [worldObjectMaterialClock(item, input)]
  for (const scene of scenes) {
    if (!resamplers.has(scene)) continue
    const term = terms.get(scene)
    if (term === undefined) return {}
    parts.push(term)
  }
  return { cohort: parts.join('\u0002') }
}

/** What an object added to a plan, and the inputs it was built from. */
interface WorldStaticObject {
  readonly key: readonly unknown[]
  readonly scenes: readonly WorldWebGlModelMaterialScene[]
  /**
   * For an object whose clock reaches only its materials: the moment its scenes' programs were
   * sampled at (worldObjectMaterialClock) and, per scene, how to sample them at another moment.
   */
  readonly materialClock?: number | string
  readonly resamplers?: readonly (WorldSceneResampler | undefined)[]
  /**
   * The kept objects that stand or fall together in a plan (see WorldCurrentPrograms.cohorts): the
   * same programs in each resampled scene, sampled for the same presentation and clock formula
   * (worldObjectClockFormula) from the same build moment. Undefined for an object with another kind
   * of resampler or with a time of its own at its build.
   */
  readonly cohort?: string
  readonly effects: readonly WorldWebGlModelEffectInstance[]
  /** The model each of `effects` comes from: a kept instance takes that model's clock. */
  readonly effectResources: readonly string[]
  /** Triangles the object wrote to the plan's shared batches (projector decals, fallback), in order. */
  readonly batchWrites: readonly WorldObjectBatchWrite[]
  readonly pickMesh: WorldObjectPickMesh
  readonly modelTriangles: number
  readonly shadowTriangles: number
  /** The paths its model primitives took (WorldWebGlStats.programObjects, fallbackObjects). */
  readonly byProgram: boolean
  readonly byFallback: boolean
  /**
   * For an object whose models move its geometry while its key leaves their clock out
   * (worldModelPosedByClock): what it was built from, to follow another clock (keptWorldObjectPose).
   */
  readonly pose?: WorldKeptPose
  /**
   * Set when the plan framed the object by its models at rest, as they move its geometry: its batch
   * writes stay out of the plan's bounds (clockWrites), kept or built.
   */
  readonly atRest?: true
}

interface WorldObjectPickMesh {
  readonly objectId: number
  readonly center: readonly [number, number, number]
  readonly triangles: number[]
  readonly primitives: readonly WorldWebGlPickPrimitive[]
  readonly placeholder: boolean
  /**
   * The box the plan frames the object by (min xyz, max xyz): its triangles and primitives, or its
   * models at rest when its geometry follows the clock; null when it has neither. Computed when first
   * read: the plan reads them only where `envelope` reaches past its bounds so far.
   */
  readonly bounds: readonly number[] | null
  /** A box holding `bounds` from its primitives' envelopes; null when it has neither. */
  readonly envelope: readonly number[] | null
  /** The plan's pick entry; a retained object keeps its entry across plans. */
  readonly pick: WorldWebGlPlan['picking']['objects'][number]
}

/**
 * The triangles one contributor adds to a shared plan batch: a water zone, a projector decal or a
 * primitive the fallback path draws. A plan assembles each shared batch from its writes in order,
 * and a batch whose writes are exactly the previous plan's (retained objects and the water cache
 * hand in the same write objects) takes the previous frozen batch as it is: no copy, no upload, and
 * its transparent order stays sorted.
 */
interface WorldBatchWrite {
  readonly positions: readonly number[]
  readonly normals: readonly number[]
  readonly colors: readonly number[]
  readonly textureCoordinates?: readonly number[]
  readonly secondaryTextureCoordinates?: readonly number[]
}

type WorldControlledBatch = MutableBatch & {
  readonly castShadows: boolean
  readonly receiveShadows: boolean
}
type WorldTransparentTexturedBatch = MutableTexturedBatch & {
  readonly blendMode: 'blend' | 'additive'
  readonly receiveShadows: boolean
  readonly splatLayer?: number
}

/**
 * A retained object's write and the shared batch it goes to. `target` is the batch as the write's
 * first plan created it: a plan that has no batch under `key` yet adds that one. Shared batches
 * only describe the batch (texture, blending, shadows); their triangles are the writes.
 */
type WorldObjectBatchWrite =
  | { readonly collection: 'opaque'; readonly write: WorldBatchWrite }
  /** Untextured blended triangles, drawn with the water after it. */
  | { readonly collection: 'transparent'; readonly write: WorldBatchWrite }
  | {
      readonly collection: 'controlled'
      readonly key: string
      readonly target: WorldControlledBatch
      readonly write: WorldBatchWrite
    }
  | {
      readonly collection: 'textured'
      readonly key: string
      readonly target: MutableTexturedBatch
      readonly write: WorldBatchWrite
    }
  | {
      readonly collection: 'transparentTextured'
      readonly key: string
      readonly target: WorldTransparentTexturedBatch
      readonly write: WorldBatchWrite
    }

/** Writes whose coordinates (and texture coordinates) a plan has already checked. */
const checkedWorldWrites = new WeakSet<WorldBatchWrite>()

/**
 * Bounds of a pick mesh's triangles and primitives (minimum xyz, maximum xyz), or null when it has
 * neither. Taken when the mesh is built; a retained object carries them with its mesh.
 */
/**
 * An object's pick entry, its framing box computed when first read. Made here and not in the plan
 * builder: a kept object outlives its plan, and a getter made in the builder would hold the
 * builder's whole frame (every write of it, its terrain preparation) alive with it.
 */
function worldObjectPickMesh(
  objectId: number,
  center: readonly [number, number, number],
  triangles: number[],
  primitives: WorldWebGlPickPrimitive[],
  placeholder: boolean,
  framingTriangles: readonly number[],
  framingPrimitives: readonly WorldWebGlPickPrimitive[],
): WorldObjectPickMesh {
  let bounds: readonly number[] | null | undefined
  return {
    objectId,
    center,
    triangles,
    primitives,
    placeholder,
    get bounds() {
      return (bounds ??= pickMeshBoundsOf(framingTriangles, framingPrimitives))
    },
    envelope: pickMeshEnvelopeOf(framingTriangles, framingPrimitives),
    pick: Object.freeze({
      objectId,
      center,
      triangles: Float32Array.from(triangles),
      primitives: Object.freeze(primitives),
      placeholder,
    }),
  }
}

function pickMeshBoundsOf(
  triangles: readonly number[],
  primitives: readonly WorldWebGlPickPrimitive[],
): readonly number[] | null {
  if (triangles.length === 0 && primitives.length === 0) return null
  let [minX, minY, minZ, maxX, maxY, maxZ] = boundsOfPositions(triangles) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  for (const primitive of primitives) {
    minX = Math.min(minX, primitive.minimum[0])
    maxX = Math.max(maxX, primitive.maximum[0])
    minY = Math.min(minY, primitive.minimum[1])
    maxY = Math.max(maxY, primitive.maximum[1])
    minZ = Math.min(minZ, primitive.minimum[2])
    maxZ = Math.max(maxZ, primitive.maximum[2])
  }
  return Object.freeze([minX, minY, minZ, maxX, maxY, maxZ])
}

/** A box holding pickMeshBoundsOf: the triangles' bounds and the primitives' envelopes. */
function pickMeshEnvelopeOf(
  triangles: readonly number[],
  primitives: readonly WorldWebGlPickPrimitive[],
): readonly number[] | null {
  if (triangles.length === 0 && primitives.length === 0) return null
  let [minX, minY, minZ, maxX, maxY, maxZ] = boundsOfPositions(triangles) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  for (const { envelope } of primitives) {
    minX = Math.min(minX, envelope[0]!)
    maxX = Math.max(maxX, envelope[3]!)
    minY = Math.min(minY, envelope[1]!)
    maxY = Math.max(maxY, envelope[4]!)
    minZ = Math.min(minZ, envelope[2]!)
    maxZ = Math.max(maxZ, envelope[5]!)
  }
  return Object.freeze([minX, minY, minZ, maxX, maxY, maxZ])
}

/** Bounds of a positions array (minimum xyz, maximum xyz); kept for writes and pick meshes. */
const worldPositionBounds = new WeakMap<readonly number[], readonly number[]>()

function positionBounds(positions: readonly number[]): readonly number[] {
  let bounds = worldPositionBounds.get(positions)
  if (bounds === undefined)
    worldPositionBounds.set(positions, (bounds = boundsOfPositions(positions)))
  return bounds
}

function boundsOfPositions(positions: readonly number[]): readonly number[] {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity
  for (let offset = 0; offset < positions.length; offset += 3) {
    minX = Math.min(minX, positions[offset]!)
    maxX = Math.max(maxX, positions[offset]!)
    minY = Math.min(minY, positions[offset + 1]!)
    maxY = Math.max(maxY, positions[offset + 1]!)
    minZ = Math.min(minZ, positions[offset + 2]!)
    maxZ = Math.max(maxZ, positions[offset + 2]!)
  }
  return Object.freeze([minX, minY, minZ, maxX, maxY, maxZ])
}

/** Concatenates one attribute of a batch's writes, as `Float32Array.from` would convert them. */
function writtenAttribute(
  writes: readonly WorldBatchWrite[],
  attribute: 'positions' | 'normals' | 'colors' | 'textureCoordinates' | 'secondaryTextureCoordinates',
): Float32Array {
  let length = 0
  for (const write of writes) length += write[attribute]?.length ?? 0
  const result = new Float32Array(length)
  let offset = 0
  for (const write of writes) {
    const values = write[attribute]
    if (values === undefined) continue
    result.set(values, offset)
    offset += values.length
  }
  return result
}

function writtenBatch(writes: readonly WorldBatchWrite[]): WorldWebGlBatch {
  return Object.freeze({
    positions: writtenAttribute(writes, 'positions'),
    normals: writtenAttribute(writes, 'normals'),
    colors: writtenAttribute(writes, 'colors'),
  })
}

function writtenTexturedBatch(
  template: MutableTexturedBatch,
  writes: readonly WorldBatchWrite[],
): WorldWebGlTexturedBatch {
  return Object.freeze({
    ...writtenBatch(writes),
    textureCoordinates: writtenAttribute(writes, 'textureCoordinates'),
    ...(template.secondaryTextureCoordinates === undefined
      ? {}
      : { secondaryTextureCoordinates: writtenAttribute(writes, 'secondaryTextureCoordinates') }),
    texture: template.texture,
    ...(template.normalTexture === undefined ? {} : { normalTexture: template.normalTexture }),
    ...(template.normalSwizzle === undefined ? {} : { normalSwizzle: template.normalSwizzle }),
    ...(template.secondaryTexture === undefined
      ? {}
      : { secondaryTexture: template.secondaryTexture }),
    ...(template.waterDetail === undefined ? {} : { waterDetail: template.waterDetail }),
    ...(template.alphaCutoff === undefined ? {} : { alphaCutoff: template.alphaCutoff }),
    ...(template.castShadows === undefined ? {} : { castShadows: template.castShadows }),
    ...(template.receiveShadows === undefined ? {} : { receiveShadows: template.receiveShadows }),
    ...(template.unlit === undefined ? {} : { unlit: template.unlit }),
    ...(template.priority === undefined ? {} : { priority: template.priority }),
    ...(template.team === undefined ? {} : { team: template.team }),
  })
}

/**
 * Decals an object projected, per component, when its effect source projects the same at every
 * clock: an object rebuilt each frame for its particles keeps them instead of projecting again.
 * The programs are kept too while the model's materials do not follow the clock.
 */
const worldObjectProjections = new WeakMap<
  WorldSceneObjectItem,
  Map<
    string,
    Readonly<{
      source: UvmEffectSource
      materials: readonly SceneRendererMaterial[]
      ground: unknown
      transform: Float32Array
      projected: ReturnType<UvmEffectSource['project']>
      programs?: ReadonlyMap<string, SceneMaterialPrograms>
    }>
  >
>()

/**
 * One placement's projectors between plans, per component: what they clipped and made at its last
 * frame (UvmProjectorFrameCache), and the program sampler of the materials they made. A projector
 * on a node the clip moves projects again every frame, mostly into the same material objects: their
 * sampler, with its compiled shader sources, stays while they do, and samples each frame's moment.
 */
interface WorldProjectorSlot {
  readonly frames: UvmProjectorFrameCache
  programs?: Readonly<{
    materials: readonly SceneRendererMaterial[]
    textures: readonly SceneRendererTexture[]
    sampler: SceneMaterialProgramSampler
  }>
}
const worldProjectorSlots = new WeakMap<WorldSceneObjectItem, Map<string, WorldProjectorSlot>>()

function worldProjectorSlot(item: WorldSceneObjectItem, componentId: string): WorldProjectorSlot {
  let slots = worldProjectorSlots.get(item)
  if (slots === undefined) worldProjectorSlots.set(item, (slots = new Map()))
  let slot = slots.get(componentId)
  if (slot === undefined)
    slots.set(componentId, (slot = { frames: createUvmProjectorFrameCache() }))
  return slot
}

/**
 * A placement's decals, or none when its projectors outgrow their clipping budget: as with an
 * unsupported projector material, the object loses its decals, not the map its world (one decal on
 * Fear and Faith LE ran past the receiver work budget and left the whole world undrawn).
 */
function worldObjectProjection(
  project: () => ReturnType<UvmEffectSource['project']>,
): ReturnType<UvmEffectSource['project']> {
  try {
    return project()
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return { primitives: [], materials: [] }
  }
}

/** prepareSceneMaterialPrograms through the slot's sampler while the materials are the same. */
function worldProjectorPrograms(
  slot: WorldProjectorSlot,
  materials: readonly SceneRendererMaterial[],
  textures: readonly SceneRendererTexture[],
  context: SceneMaterialContext,
): ReadonlyMap<string, SceneMaterialPrograms> {
  let kept = slot.programs
  if (
    kept === undefined ||
    kept.textures !== textures ||
    kept.materials.length !== materials.length ||
    kept.materials.some((material, index) => material !== materials[index])
  ) {
    delete slot.programs
    kept = Object.freeze({
      materials: [...materials],
      textures,
      sampler: createSceneMaterialProgramSampler(
        materials,
        new Map(textures.map(texture => [texture.id, texture])),
      ),
    })
    slot.programs = kept
  }
  return sampleSceneMaterialPrograms(kept.sampler, context, [])
}

/**
 * Each object's projector writes of its last build. An object with live effects is rebuilt at
 * every clock, but its decals usually come out the same: it then hands in the previous write
 * objects, so the shared decal batches are kept (see WorldBatchWrite).
 */
const lastProjectorWrites = new WeakMap<
  WorldSceneObjectItem,
  readonly { readonly key: string; readonly write: WorldBatchWrite }[]
>()

function sameNumbers(left: readonly number[] | undefined, right: readonly number[] | undefined) {
  if (left === right) return true
  if (left === undefined || right === undefined || left.length !== right.length) return false
  for (let index = 0; index < left.length; index++)
    if (!Object.is(left[index], right[index])) return false
  return true
}

function sameWriteContent(left: WorldBatchWrite, right: WorldBatchWrite): boolean {
  return (
    sameNumbers(left.positions, right.positions) &&
    sameNumbers(left.normals, right.normals) &&
    sameNumbers(left.colors, right.colors) &&
    sameNumbers(left.textureCoordinates, right.textureCoordinates) &&
    sameNumbers(left.secondaryTextureCoordinates, right.secondaryTextureCoordinates)
  )
}

const sameWrites = (left: readonly unknown[], right: readonly unknown[]) =>
  left.length === right.length && left.every((value, index) => value === right[index])

/** What a shared batch looks like apart from its triangles: equal ones draw the same way. */
function sameBatchTemplate(left: object, right: object): boolean {
  const a = left as Partial<WorldTransparentTexturedBatch & WorldControlledBatch>
  const b = right as Partial<WorldTransparentTexturedBatch & WorldControlledBatch>
  return (
    a.texture === b.texture &&
    a.normalTexture === b.normalTexture &&
    a.secondaryTexture === b.secondaryTexture &&
    (a.secondaryTextureCoordinates === undefined) ===
      (b.secondaryTextureCoordinates === undefined) &&
    a.alphaCutoff === b.alphaCutoff &&
    a.castShadows === b.castShadows &&
    a.receiveShadows === b.receiveShadows &&
    a.blendMode === b.blendMode &&
    (left as { colorFalloff?: number }).colorFalloff ===
      (right as { colorFalloff?: number }).colorFalloff &&
    (left as { caustics?: WorldWebGlWaterCaustics }).caustics ===
      (right as { caustics?: WorldWebGlWaterCaustics }).caustics &&
    (left as { waves?: WorldWebGlWaterWaves }).waves === (right as { waves?: WorldWebGlWaterWaves }).waves &&
    a.waterDetail === b.waterDetail
  )
}

/** The shared batches of a plan with their writes, for the next plan to take unchanged ones. */
interface WorldPlanBatches {
  readonly batches: ReadonlyMap<
    string,
    { readonly template: object; readonly writes: readonly WorldBatchWrite[]; readonly frozen: unknown }
  >
  readonly water: readonly WorldBatchWrite[]
  readonly waterSurfaceDepth: Float32Array
  readonly opaque: Readonly<{
    staticBatch: WorldWebGlBatch
    dynamicBatch: WorldWebGlBatch
    batch: WorldWebGlBatch
  }>
}

const worldPlanBatches = new WeakMap<WorldWebGlPlan, WorldPlanBatches>()

/**
 * What making a plan took (WorldWebGlRendererStats.worldObjectsKept and the counters beside it):
 * kept beside the plan, not in it, since a plan made from an earlier one equals one made fresh.
 */
const worldPlanWork = new WeakMap<
  WorldWebGlPlan,
  Readonly<{
    keptObjects: number
    builtObjects: number
    posedSamples: number
    unposedObjects: number
  }>
>()

/** The water surface an ambient-occlusion pass measures depth against: visible water triangles. */
function worldWaterSurfaceDepth(writes: readonly WorldBatchWrite[]): Float32Array {
  const positions: number[] = []
  for (const source of writes) {
    for (let offset = 0; offset < source.positions.length; offset += 9) {
      const color = (offset / 3) * 4
      if (
        Math.max(
          source.colors[color + 3]!,
          source.colors[color + 7]!,
          source.colors[color + 11]!,
        ) <= 0.01
      )
        continue
      positions.push(...source.positions.slice(offset, offset + 9))
    }
  }
  return Float32Array.from(positions)
}

/**
 * An object adds the same scenes, effects and pick mesh to every plan built from the same inputs
 * (see `worldStaticObjectKey`): an animated map re-samples only the objects whose clock moved
 * instead of placing, bounding and grouping all of them every frame.
 */
const retainedStaticObjects = new WeakMap<WorldSceneObjectItem, WorldStaticObject>()

/**
 * WORLD_KEPT_BLOCK consecutive objects of a plan that it kept as they were (retainedStaticObjects),
 * each by the key it was retained with (not one built for this frame: a camera turn, say). The plan
 * that follows, built from the same inputs but the clock, takes such a block whole: it samples the
 * playing materials as each object would (once per cohort), gives each effect the new time, and
 * takes the scenes, decal writes, pick meshes and counts as they are, instead of keying and looking
 * up each object again. The result is the same plan.
 */
interface WorldKeptBlock {
  readonly items: readonly WorldSceneObjectItem[]
  readonly scenes: readonly WorldWebGlModelMaterialScene[]
  /** Each retained effect with its object and model, in order (keptWorldObjectEffect). */
  readonly effects: readonly Readonly<{
    item: WorldSceneObjectItem
    effect: WorldWebGlModelEffectInstance
    resourceId: string
  }>[]
  readonly batchWrites: readonly WorldObjectBatchWrite[]
  readonly pickMeshes: readonly WorldObjectPickMesh[]
  /**
   * The box holding the pick meshes' envelopes (null when none has one), and whether each envelope
   * is finite: then a box inside the plan bounds so far means every envelope is, and the block
   * leaves them as they are.
   */
  readonly envelope: readonly number[] | null
  readonly finite: boolean
  /**
   * The objects whose materials play, in order, as keptWorldObjectScenes samples them: a cohort's
   * first object decides for the cohort, an object with no cohort (or a time of its own) for itself.
   */
  readonly samples: readonly Readonly<{
    cohort: string | undefined
    item: WorldSceneObjectItem
    kept: WorldStaticObject
  }>[]
  /** The objects whose models move their geometry (WorldStaticObject.pose), with their offsets. */
  readonly poses: readonly Readonly<{
    offset: number
    item: WorldSceneObjectItem
    kept: WorldStaticObject
  }>[]
  /** The batch writes of its objects framed at rest, which the plan's bounds leave out. */
  readonly clockWrites: readonly WorldBatchWrite[]
  readonly modelTriangles: number
  readonly shadowTriangles: number
  readonly programObjects: number
  readonly fallbackObjects: number
}

/** Objects per kept block, counted from the first of the plan's objects (see WorldKeptBlock). */
const WORLD_KEPT_BLOCK = 32

/** A plan's kept blocks by their index, for the plan built from it. */
const worldKeptBlocks = new WeakMap<WorldWebGlPlan, readonly (WorldKeptBlock | undefined)[]>()

/**
 * Plans built so far, and each plan's count when it was built. Retained objects stand as the plan
 * built last left them: another plan built since (another viewer's) may have rebuilt them, so only
 * the plan built right after a plan takes its kept blocks.
 */
let worldPlansBuilt = 0
const worldPlanSerials = new WeakMap<WorldWebGlPlan, number>()

/**
 * The material ids of a model scene whose materials take no shadow of the world
 * (modelMaterialShadowPolicy): their draws say so (MaterialDraw.receiveShadows). Kept and resampled
 * scenes are the same objects, so the entry lasts as long as the scene.
 */
const worldShadowlessMaterials = new WeakMap<WorldWebGlModelMaterialScene, ReadonlySet<string>>()

/** A world draw of a model scene, saying when its material takes no shadow. */
function worldSceneDraw<T extends MaterialDraw>(scene: WorldWebGlModelMaterialScene, draw: T): T {
  const shadowless = worldShadowlessMaterials.get(scene)
  return shadowless !== undefined && shadowless.has(draw.primitive.materialId ?? '')
    ? { ...draw, receiveShadows: false }
    : draw
}

/**
 * A terrain preparation as kept objects name it in their keys. An object the caller still holds
 * keeps its entry after it leaves the list (a unit out of view, a hidden facet); the entry must
 * not keep the preparation alive with it: that is the terrain of a past frame, tens of megabytes.
 */
const worldPreparationTokens = new WeakMap<object, object>()
function worldPreparationToken(preparation: unknown): unknown {
  if (preparation === null || typeof preparation !== 'object') return preparation
  let token = worldPreparationTokens.get(preparation)
  if (token === undefined) worldPreparationTokens.set(preparation, (token = Object.freeze({})))
  return token
}

/**
 * Everything an object's contribution depends on: the terrain preparation (cliff lifting, projector
 * ground), its team colour, and each model result with the clock the object samples it at (its
 * geometry, materials, effects and projectors follow only that clock). The selected object
 * (tinted, possibly moved by a preview) is never retained.
 */
function worldStaticObjectKey(
  item: WorldSceneObjectItem,
  input: WorldWebGlInput,
  preparation: unknown,
  models: number,
): readonly unknown[] | undefined {
  if (item.objectId === input.selectedObjectId) return undefined
  const teamColor =
    item.presentationTeamColor ??
    (item.player === undefined ? undefined : input.teamColors?.get(item.player))
  const keyed = worldObjectResourcesOf(item).keyed
  const known = worldStaticObjectKeys.get(item)
  const preparationToken = worldPreparationToken(preparation)
  if (
    known !== undefined &&
    known.preparation === preparationToken &&
    known.teamColor === teamColor
  ) {
    // One generation reads the same result for every resource id (worldModelGenerations).
    if (known.models === models) return known.key
    if (
      keyed.every((resourceId, index) => input.models?.get(resourceId) === known.results[index])
    ) {
      worldStaticObjectKeys.set(item, Object.freeze({ ...known, models }))
      return known.key
    }
  }
  const key: unknown[] = [preparationToken, teamColor?.join(',') ?? '']
  const results: unknown[] = []
  let timed = false
  for (const resourceId of keyed) {
    const result = input.models?.get(resourceId)
    results.push(result)
    key.push(resourceId, result)
    // A camera-facing node turns with the camera (worldModelCamera): kept while the camera's turn is.
    if (result?.state === 'converted' && worldModelFacesCamera(result)) {
      key.push(worldCameraTurnKey(input.camera))
      timed = true
    }
    // Materials and live effects alone follow the clock through the kept object (its resamplers,
    // keptWorldObjectEffect), and so does a model the kept object samples again (its pose).
    if (result?.state !== 'converted' || !worldObjectFollowsTime(result, item)) continue
    if (worldModelPosedByClock(result, item)) continue
    const selected = worldModelAnimation(result, item)
    key.push(worldObjectTime(input, item, selected !== undefined, selected?.durationSeconds))
    timed = true
  }
  if (timed) worldStaticObjectKeys.delete(item)
  else
    worldStaticObjectKeys.set(
      item,
      Object.freeze({ preparation: preparationToken, teamColor, results, key, models }),
    )
  return key
}

/**
 * The key of an object that no clock enters, while its inputs stay the same objects: most objects
 * keep it from frame to frame, and it was built again for each of them every frame.
 */
const worldStaticObjectKeys = new WeakMap<
  WorldSceneObjectItem,
  Readonly<{
    preparation: unknown
    teamColor: unknown
    results: readonly unknown[]
    key: readonly unknown[]
    models: number
  }>
>()

/**
 * Whether more than the materials and live effects of a model's contribution to an object follows
 * the object's clock: sampled geometry (keyed TRS or visibility) or decals whose projection does. A
 * clip that moves neither (an empty Stand, a material-only sequence, a still blob shadow, a still
 * model with particles) leaves the object's geometry the same at every clock, so it is kept while
 * the map animates; material tracks only have its programs sampled again (keptWorldObjectScenes),
 * and live effects, simulated when drawn, only take the new clock (keptWorldObjectEffect).
 */
function worldObjectFollowsTime(
  result: WorldModelSample['result'],
  item: WorldSceneObjectItem,
): boolean {
  return (
    worldModelHasAnimatedGeometry(result, item) || worldModelProjectionsFollowTime(result, item)
  )
}

/** Whether a model's decals, as an object samples the model, move with the object's clock. */
function worldModelProjectionsFollowTime(
  result: WorldModelSample['result'],
  item: WorldSceneObjectItem,
): boolean {
  const source =
    result.uvmBytes === undefined
      ? undefined
      : uvmEffectSource(result.uvmBytes, worldModelAnimation(result, item)?.sequenceIndex)
  return source !== undefined && source.projectionsFollowTime
}

/**
 * Whether a model that moves an object's geometry with the clock is sampled again by the kept
 * object at another clock (WorldStaticObject.pose), the clock left out of its key: not a cliff piece
 * (posed on the CPU onto the ground), a stretched foundation (its positions written per sample), a
 * model facing the camera (posed by the camera's turn as well), nor one whose decals follow the
 * clock.
 */
function worldModelPosedByClock(
  result: WorldModelSample['result'],
  item: WorldSceneObjectItem,
): boolean {
  return (
    item.derivedFrom !== 'cliffs' &&
    !((item.presentationFoundationStretch ?? 0) > 0) &&
    worldModelHasAnimatedGeometry(result, item) &&
    !worldModelFacesCamera(result) &&
    !worldModelProjectionsFollowTime(result, item)
  )
}

/** The time an object samples one of its models at (sampleSharedModel): a looping clip's in one loop. */
function worldModelSampleTime(
  input: WorldWebGlInput,
  item: WorldSceneObjectItem,
  selected: ReturnType<typeof worldModelAnimation>,
): number {
  const clock = worldObjectTime(input, item, selected !== undefined, selected?.durationSeconds)
  return selected?.durationSeconds && (item.presentationAnimation?.loop ?? selected.looping)
    ? clock % selected.durationSeconds
    : clock
}

/**
 * A kept object's live effect instance at the object's clock in this plan: what the build would
 * place (the same source, transform, materials and textures) with the time and material context of
 * the model it comes from.
 */
function keptWorldObjectEffect(
  item: WorldSceneObjectItem,
  effect: WorldWebGlModelEffectInstance,
  resourceId: string,
  input: WorldWebGlInput,
): WorldWebGlModelEffectInstance {
  const result = input.models?.get(resourceId)
  if (result?.state !== 'converted') return effect
  const { time, materialContext } = worldObjectMaterialMoment(input, item, result)
  if (time === effect.time) return effect
  return Object.freeze({ ...effect, time, context: materialContext })
}

const sameWorldStaticObjectKey = (left: readonly unknown[], right: readonly unknown[]) =>
  left === right ||
  (left.length === right.length && left.every((value, index) => value === right[index]))

const materialsFollowingTime = new WeakMap<WorldModelSample['result'], boolean>()

/**
 * Whether any material of a model carries an animation track. Material programs sample their
 * parameters at the clock only through tracks (`track`, `sequenceTracks`); without them the
 * prepared programs are the same at every time and can be kept across frames.
 */
function worldMaterialsFollowTime(result: WorldModelSample['result']): boolean {
  let follows = materialsFollowingTime.get(result)
  if (follows === undefined)
    materialsFollowingTime.set(result, (follows = carriesMaterialTrack(result.materials ?? [])))
  return follows
}

const effectMaterialsFollowingTime = new WeakMap<SceneRendererMaterial, boolean>()

/** Whether an effect emitter's material carries an animation track (see worldMaterialsFollowTime). */
function effectMaterialFollowsTime(material: SceneRendererMaterial): boolean {
  let follows = effectMaterialsFollowingTime.get(material)
  if (follows === undefined)
    effectMaterialsFollowingTime.set(material, (follows = carriesMaterialTrack(material)))
  return follows
}

/** Whether materials (or one material) name a `track` or `sequenceTracks` anywhere. */
function carriesMaterialTrack(materials: unknown): boolean {
  const pending: unknown[] = [materials]
  while (pending.length > 0) {
    const value = pending.pop()
    if (value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) continue
    if (Array.isArray(value)) {
      pending.push(...value)
      continue
    }
    for (const [key, entry] of Object.entries(value)) {
      if ((key === 'track' || key === 'sequenceTracks') && entry !== undefined && entry !== null)
        return true
      pending.push(entry)
    }
  }
  return false
}

const animatedWorldModelGeometry = new WeakMap<object, WeakMap<WorldSceneObjectItem, boolean>>()

function worldModelHasAnimatedGeometry(
  result: WorldModelSample['result'],
  item: WorldSceneObjectItem,
): boolean {
  let byItem = animatedWorldModelGeometry.get(result)
  if (byItem === undefined) animatedWorldModelGeometry.set(result, (byItem = new WeakMap()))
  let animated = byItem.get(item)
  if (animated === undefined) byItem.set(item, (animated = selectAnimatedGeometry(result, item)))
  return animated
}

function selectAnimatedGeometry(
  result: WorldModelSample['result'],
  item: WorldSceneObjectItem,
): boolean {
  const clip = worldModelAnimation(result, item)
  // Match createModelSceneSampler: only keyed TRS, visibility and morph weights (a vertex
  // animation) affect sampled primitives. Empty Stand clips and material-only sequences must not
  // invalidate the terrain every frame.
  return (
    (result.nodes?.length ?? 0) > 0 &&
    clip?.kind === 'animation' &&
    clip.channels.some(
      channel =>
        ['translation', 'rotation', 'scale', 'visibility', 'weights'].includes(channel.kind) &&
        (channel.samples?.length ?? 0) > 0,
    )
  )
}

// Separate scope: the retained lifter owns only the terrain lookup, never mutable build batches.
function createCliffPrimitiveLifter(
  terrain: readonly WorldSceneTerrainItem[],
  terrainByCell: ReadonlyMap<string, WorldSceneTerrainItem>,
  terrainMinimumX: number,
  terrainMinimumY: number,
) {
  // Height-grid coordinates of a world point, read off where the terrain places its first cell.
  const gridOrigin = terrainByCell.get(`${terrainMinimumX}:${terrainMinimumY}`)
  const gridEast = terrainByCell.get(`${terrainMinimumX + 1}:${terrainMinimumY}`)
  const gridSouth = terrainByCell.get(`${terrainMinimumX}:${terrainMinimumY + 1}`)
  const gridOf = (point: readonly [number, number, number]): readonly [number, number] => {
    if (gridOrigin === undefined || gridEast === undefined || gridSouth === undefined)
      return [point[0], point[2]]
    const origin = terrainPosition(gridOrigin)
    const east = terrainPosition(gridEast)
    const south = terrainPosition(gridSouth)
    const dx = point[0] - origin[0]
    const dz = point[2] - origin[2]
    const ex = [east[0] - origin[0], east[2] - origin[2]]
    const ey = [south[0] - origin[0], south[2] - origin[2]]
    return [
      terrainMinimumX + (dx * ex[0]! + dz * ex[1]!) / (ex[0]! * ex[0]! + ex[1]! * ex[1]!),
      terrainMinimumY + (dx * ey[0]! + dz * ey[1]!) / (ey[0]! * ey[0]! + ey[1]! * ey[1]!),
    ]
  }
  /**
   * How far the terrain's painted base height (`heightBase`, the raise/lower brush) lies from the
   * map's standard height, in world units, at a world point. A terrain vertex's height is that base
   * plus its cliff level's offset (`heightAdjustment`). Cliff meshes are authored at their level's
   * standard height, and the engine moves every mesh vertex by this offset, so a cliff on a shore
   * the map lowered by 3 stands 3 lower, with the ground around it. Amphion lowers a third of its
   * vertices, most of the coast by 1.5 to 3; drawn at standard height, those rocks stood above the
   * ground as black lumps.
   *
   * The host passes that offset per vertex (`baseOffset`, from the terrain's standard height). A
   * map may repaint most of its ground: Highland lies two below its standard height everywhere.
   * Without `baseOffset` the standard base is taken as the most common `heightBase` (untouched
   * ground; on Amphion 19 400 of 31 329 vertices sit exactly there), with world units per base step
   * from two vertices of one cliff level with different bases; on Highland that lifted every cliff
   * two above its ground.
   */
  const baseHeight = (() => {
    const counts = new Map<number, number>()
    const spread = new Map<number, { low: WorldSceneTerrainItem; high: WorldSceneTerrainItem }>()
    for (const item of terrain) {
      counts.set(item.heightBase, (counts.get(item.heightBase) ?? 0) + 1)
      const range = spread.get(item.heightAdjustment)
      if (range === undefined) spread.set(item.heightAdjustment, { low: item, high: item })
      else if (item.heightBase < range.low.heightBase) range.low = item
      else if (item.heightBase > range.high.heightBase) range.high = item
    }
    let reference = 0
    let referenceCount = -1
    for (const [value, count] of counts)
      if (count > referenceCount) {
        reference = value
        referenceCount = count
      }
    let step = 0
    let widest = 0
    for (const { low, high } of spread.values()) {
      const width = high.heightBase - low.heightBase
      if (width <= widest) continue
      widest = width
      step = (terrainPosition(high)[1] - terrainPosition(low)[1]) / width
    }
    return { reference, step }
  })()
  const vertexBaseOffset = (vertex: WorldSceneTerrainItem) =>
    vertex.baseOffset ?? (vertex.heightBase - baseHeight.reference) * baseHeight.step
  const authoredBaseOffsets = terrain.some(vertex => vertex.baseOffset !== undefined)
  /**
   * A cliff piece's primitives, stretched onto the painted base height of the ground they join. A
   * wall spans two levels, and the ground at its foot and at its top can each be lowered or raised
   * by a different amount, so the offset is chosen by HEIGHT, not by position: every mesh vertex
   * takes the offset of the footprint's height-field vertices at the level just below it and the
   * level just above it (the nearest of each), interpolated by where it sits between those two
   * standard heights. The wall's foot follows the low ground and its cap the plateau. (Interpolating
   * by position instead sank Amphion's plateau walls: their face stands between the two vertex rows,
   * so the cap took half of the shore's drop and went under the plateau.)
   *
   * The move is made in the primitive's own space (the inverse of its world transform applied to a
   * world-up offset), so the transform, normals and tangents stay as authored. Primitives that do not
   * move are returned as-is and keep their shared GPU buffers.
   */
  /**
   * Per-vertex base offsets of one placed piece, before seams are joined (see `offsetAt`), with the
   * world point each vertex stands on at standard height. Undefined when nothing moves.
   */
  const computeCliffOffsets = <P extends { readonly positions: Float32Array }>(
    primitives: readonly P[],
    instanceTransform: Float32Array,
  ) => {
    if (!authoredBaseOffsets && baseHeight.step === 0) return undefined
    const prepared = primitives.map(primitive => {
      const own =
        'transform' in primitive && primitive.transform instanceof Float32Array
          ? primitive.transform
          : IDENTITY_COMPONENT_TRANSFORM
      return { primitive, m: multiplyComponentTransforms(instanceTransform, own) }
    })
    // The footprint: every height-field vertex inside the piece's horizontal bounds, with its height
    // as if its base were standard and its own base offset.
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const { primitive, m } of prepared) {
      const source = primitive.positions
      for (let index = 0; index + 2 < source.length; index += 3) {
        const x = source[index]!
        const y = source[index + 1]!
        const z = source[index + 2]!
        const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
        const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
        minX = Math.min(minX, wx)
        maxX = Math.max(maxX, wx)
        minZ = Math.min(minZ, wz)
        maxZ = Math.max(maxZ, wz)
      }
    }
    if (!Number.isFinite(minX)) return undefined
    const corners = [gridOf([minX, 0, minZ]), gridOf([maxX, 0, maxZ])]
    const footprint: { x: number; z: number; standard: number; offset: number }[] = []
    for (
      let gy = Math.round(Math.min(corners[0]![1], corners[1]![1]));
      gy <= Math.round(Math.max(corners[0]![1], corners[1]![1]));
      gy += 1
    )
      for (
        let gx = Math.round(Math.min(corners[0]![0], corners[1]![0]));
        gx <= Math.round(Math.max(corners[0]![0], corners[1]![0]));
        gx += 1
      ) {
        const vertex = terrainByCell.get(`${gx}:${gy}`)
        if (vertex === undefined) continue
        const at = terrainPosition(vertex)
        const offset = vertexBaseOffset(vertex)
        footprint.push({ x: at[0], z: at[2], standard: at[1] - offset, offset })
      }
    if (footprint.length === 0) return undefined
    const LEVEL_TOLERANCE = 0.05
    const nearest = (candidates: readonly (typeof footprint)[number][], x: number, z: number) => {
      let best = candidates[0]!
      let bestDistance = Infinity
      for (const candidate of candidates) {
        const distance = (candidate.x - x) ** 2 + (candidate.z - z) ** 2
        if (distance < bestDistance) {
          bestDistance = distance
          best = candidate
        }
      }
      return best
    }
    const offsetAt = (x: number, y: number, z: number) => {
      let below: number | undefined
      let above: number | undefined
      for (const entry of footprint) {
        if (
          entry.standard <= y + LEVEL_TOLERANCE &&
          (below === undefined || entry.standard > below)
        )
          below = entry.standard
        if (
          entry.standard >= y - LEVEL_TOLERANCE &&
          (above === undefined || entry.standard < above)
        )
          above = entry.standard
      }
      const low = below ?? above!
      const high = above ?? below!
      const lowEntry = nearest(
        footprint.filter(entry => Math.abs(entry.standard - low) <= LEVEL_TOLERANCE),
        x,
        z,
      )
      if (high - low <= LEVEL_TOLERANCE) return lowEntry.offset
      const highEntry = nearest(
        footprint.filter(entry => Math.abs(entry.standard - high) <= LEVEL_TOLERANCE),
        x,
        z,
      )
      const t = Math.min(1, Math.max(0, (y - low) / (high - low)))
      return lowEntry.offset + (highEntry.offset - lowEntry.offset) * t
    }
    const pieces = prepared.map(({ primitive, m }) => {
      const source = primitive.positions
      const offsets = new Float32Array(source.length / 3)
      const keys: string[] = []
      for (let index = 0; index + 2 < source.length; index += 3) {
        const x = source[index]!
        const y = source[index + 1]!
        const z = source[index + 2]!
        const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
        const wy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!
        const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
        offsets[index / 3] = offsetAt(wx, wy, wz)
        keys.push(cliffSeamKey(wx, wy, wz))
      }
      return { primitive, m, offsets, keys }
    })
    return pieces
  }
  // Offsets pooled by the world point a vertex stands on. Pieces that meet share their edge
  // vertices, but each piece picks its offsets from its own footprint, so neighbours could lift one
  // shared vertex by different amounts: Amphion's natural coast tore at 94 such seams, the worst by
  // two units (holes through which the background showed as black wedges). A point registered by
  // several pieces takes their mean, so neighbours stay joined; a lone point keeps its own offset.
  const seams = new Map<string, { sum: number; count: number }>()
  const cliffSeamKey = (x: number, y: number, z: number) =>
    `${Math.round(x * 128)}:${Math.round(y * 128)}:${Math.round(z * 128)}`
  const offsetsCache = new WeakMap<
    object,
    Map<string, ReturnType<typeof computeCliffOffsets>>
  >()
  const cachedOffsets = <P extends { readonly positions: Float32Array }>(
    primitives: readonly P[],
    instanceTransform: Float32Array,
  ) => {
    let instances = offsetsCache.get(primitives)
    if (instances === undefined) offsetsCache.set(primitives, (instances = new Map()))
    const key = instanceTransform.join(',')
    if (!instances.has(key)) instances.set(key, computeCliffOffsets(primitives, instanceTransform))
    return instances.get(key)
  }
  /** Record a placed piece's vertices before any piece is lifted, so its seams are joined. */
  const registerCliffPiece = <P extends { readonly positions: Float32Array }>(
    primitives: readonly P[],
    instanceTransform: Float32Array,
  ): void => {
    const pieces = cachedOffsets(primitives, instanceTransform)
    if (pieces === undefined) return
    for (const { offsets, keys } of pieces)
      keys.forEach((key, vertex) => {
        const seam = seams.get(key)
        if (seam === undefined) seams.set(key, { sum: offsets[vertex]!, count: 1 })
        else {
          seam.sum += offsets[vertex]!
          seam.count += 1
        }
      })
  }
  const computeLiftedCliffPrimitives = <P extends { readonly positions: Float32Array }>(
    primitives: readonly P[],
    instanceTransform: Float32Array,
  ): readonly P[] => {
    const pieces = cachedOffsets(primitives, instanceTransform)
    if (pieces === undefined) return primitives
    // The offsets cache holds the pieces of `primitives` itself, in order.
    return pieces.map(({ m, offsets, keys }, index): P => {
      const primitive = primitives[index]!
      const det =
        m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) +
        m[1]! * (m[6]! * m[8]! - m[4]! * m[10]!) +
        m[2]! * (m[4]! * m[9]! - m[5]! * m[8]!)
      if (Math.abs(det) < 1e-12) return primitive
      // Column 1 of the inverse 3x3: the local vector that the transform maps onto world +Y.
      const upX = (m[6]! * m[8]! - m[4]! * m[10]!) / det
      const upY = (m[10]! * m[0]! - m[8]! * m[2]!) / det
      const upZ = (m[2]! * m[4]! - m[0]! * m[6]!) / det
      const source = primitive.positions
      const positions = new Float32Array(source.length)
      let moved = false
      for (let index = 0; index + 2 < source.length; index += 3) {
        const seam = seams.get(keys[index / 3]!)
        const offset =
          seam !== undefined && seam.count > 1 ? seam.sum / seam.count : offsets[index / 3]!
        if (offset !== 0) moved = true
        positions[index] = source[index]! + upX * offset
        positions[index + 1] = source[index + 1]! + upY * offset
        positions[index + 2] = source[index + 2]! + upZ * offset
      }
      return moved ? { ...primitive, positions } : primitive
    })
  }
  // Scoped to this ground revision. Static samples keep the same input arrays across frames;
  // animated samples have weak keys, so old poses are not retained by this cache.
  const lifted = new WeakMap<object, Map<string, readonly { readonly positions: Float32Array }[]>>()
  const liftedCliffPrimitives = <P extends { readonly positions: Float32Array }>(
    primitives: readonly P[],
    instanceTransform: Float32Array,
  ): readonly P[] => {
    let instances = lifted.get(primitives)
    if (instances === undefined) lifted.set(primitives, (instances = new Map()))
    const key = instanceTransform.join(',')
    let result = instances.get(key)
    if (result === undefined) {
      result = computeLiftedCliffPrimitives(primitives, instanceTransform)
      instances.set(key, result)
    }
    return result as readonly P[]
  }
  return { gridOf, liftedCliffPrimitives, registerCliffPiece }
}

/** A world point to 1/128 unit: vertices of neighbouring pieces meeting there share one key. */
function cliffPointKey(x: number, y: number, z: number): string {
  return `${Math.round(x * 128)}:${Math.round(y * 128)}:${Math.round(z * 128)}`
}

/** Frozen ground preparation shared across animated frames; water and actors are rebuilt below. */
function prepareWorldStaticTerrain(
  input: WorldWebGlInput,
  sampleSharedModel: (
    resourceId: string,
    item: WorldSceneObjectItem,
  ) => WorldModelSample | undefined,
) {
  const opaque = batch(),
    lines = batch(),
    points = batch()
  const textured = new Map<string, MutableTexturedBatch>()
  const splat = new Map<string, MutableSplatBatch>()
  /** Weight-raster groups after the first, blended over it (see `splatOverlayTriangles`). */
  const splatOverlays = new Map<string, MutableSplatBatch>()
  /** Tiles over the ground (upper tileset layers, then decals), one batch per depth and texture. */
  const decals = new Map<string, MutableTexturedBatch>()
  const decalDepths = new Map<string, number>()
  const terrainPickTriangles: number[] = []
  const terrain = input.items.filter(
    (item): item is WorldSceneTerrainItem => item.facet === 'terrain',
  )
  const terrainByCell = new Map(terrain.map(item => [`${item.x}:${item.y}`, item]))
  let lowHeight = Infinity,
    highHeight = -Infinity
  for (const item of terrain) {
    const height = terrainPosition(item)[1]
    lowHeight = Math.min(lowHeight, height)
    highHeight = Math.max(highHeight, height)
  }
  // Progressive lattice surface: per-vertex interpolation makes ramp slopes continuous.
  const heightColor = (height: number): readonly [number, number, number, number] => {
    const t =
      highHeight > lowHeight
        ? Math.min(1, Math.max(0, (height - lowHeight) / (highHeight - lowHeight)))
        : 0.5
    return [0.06 + t * 0.69, 0.13 + t * 0.69, 0.21 + t * 0.41, 1]
  }
  const materialByCell = new Map(
    input.items
      .filter(item => item.facet === 'terrain-materials')
      .map(item => [`${item.x}:${item.y}`, item]),
  )
  let terrainTriangles = 0
  let terrainTexturedTriangles = 0
  let terrainSplatFallbackCells = 0
  let terrainDecalTriangles = 0
  const terrainMinimumX = Math.min(...terrain.map(item => item.x))
  const terrainMaximumX = Math.max(...terrain.map(item => item.x))
  const terrainMinimumY = Math.min(...terrain.map(item => item.y))
  const terrainMaximumY = Math.max(...terrain.map(item => item.y))
  /**
   * The exact raster splat, two weight rasters (eight layers) per draw. The first group is the
   * ground; each later one blends over it with the share of the weights its layers hold, so with
   * weights normalized over every raster the result is the blend of all layers.
   */
  const rasterSplatGroup = (rasters: readonly MapTerrainWeightRaster[]) => {
    const definitions = rasters.flatMap(raster =>
      raster.materialIds.map(materialId =>
        input.terrainMaterials?.find(material => material.materialId === materialId),
      ),
    )
    const weightTextures = rasters.map(raster => input.terrainTextures?.get(raster.resourceId))
    if (
      definitions.length > 8 ||
      !definitions.every(definition => definition !== undefined) ||
      !weightTextures.every(
        (texture, index) =>
          texture !== undefined &&
          texture.width === rasters[index]!.width &&
          texture.height === rasters[index]!.height,
      )
    )
      return undefined
    const resolved = definitions as readonly MapTerrainMaterialDefinition[]
    return Object.freeze({
      definitions: resolved,
      // One unresolved layer must not drop per-pixel blending for the whole map; a layer that
      // declares only a colour is that colour (glTF baseColorFactor without a texture).
      textures: resolved.map(definition =>
        definition.baseColorResourceId === undefined
          ? definition.baseColorFactor === undefined
            ? MISSING_TERRAIN_LAYER_TEXTURE
            : WHITE_TERRAIN_LAYER_TEXTURE
          : (input.terrainTextures?.get(definition.baseColorResourceId) ??
            MISSING_TERRAIN_LAYER_TEXTURE),
      ),
      layerColors: resolved.map(terrainLayerColor),
      normalTextures: resolved.map(definition =>
        definition.normalResourceId === undefined
          ? undefined
          : input.terrainTextures?.get(definition.normalResourceId),
      ),
      specularTextures: resolved.map(definition =>
        definition.specularResourceId === undefined
          ? undefined
          : input.terrainTextures?.get(definition.specularResourceId),
      ),
      normalSwizzles: resolved.map(definition => normalSwizzleOf(definition.normalEncoding)),
      specularGloss: resolved.some(definition => definition.specularEncoding === 'gloss'),
      weightTextures: weightTextures as readonly SceneRendererTexture[],
    })
  }
  type RasterSplatGroup = NonNullable<ReturnType<typeof rasterSplatGroup>>
  const weightRasters = input.terrainWeightRasters ?? []
  const rasterGroups =
    weightRasters.length > 0 &&
    weightRasters.length <= WORLD_MAX_TERRAIN_WEIGHT_RASTERS &&
    terrainMaximumX > terrainMinimumX &&
    terrainMaximumY > terrainMinimumY
      ? Array.from({ length: Math.ceil(weightRasters.length / 2) }, (_, index) =>
          rasterSplatGroup(weightRasters.slice(index * 2, index * 2 + 2)),
        )
      : []
  const exactRasterSplat = rasterGroups.every(group => group !== undefined)
    ? rasterGroups[0]
    : undefined
  const rasterSplatOverlays =
    exactRasterSplat === undefined ? [] : (rasterGroups.slice(1) as readonly RasterSplatGroup[])
  const rasterSplatGroupKey = (prefix: string, group: RasterSplatGroup) =>
    [
      prefix,
      group.textures.map(candidate => candidate.id).join(String.fromCharCode(0)),
      group.normalTextures.map(candidate => candidate?.id ?? '').join(String.fromCharCode(0)),
      group.weightTextures.map(candidate => candidate.id).join(String.fromCharCode(0)),
      group.layerColors.map(color => color.join(',')).join(';'),
    ].join(String.fromCharCode(0))
  /** The one batch that draws the exact raster splat: the height field and the cliff tiles share it. */
  const rasterSplatKey =
    exactRasterSplat === undefined
      ? undefined
      : rasterSplatGroupKey('terrain-raster-splat', exactRasterSplat)
  const newRasterSplatBatch = (
    group: RasterSplatGroup,
    mask?: Readonly<{ texture: SceneRendererTexture; channel: number }>,
  ): MutableSplatBatch => ({
    ...(mask === undefined
      ? {}
      : { maskTexture: mask.texture, maskTextureCoordinates: [], maskChannel: mask.channel }),
    ...batch(),
    textureCoordinates: group.textures.map(() => []),
    textureWeights0: [],
    textureWeights1: [],
    textures: group.textures,
    normalTextures: group.normalTextures,
    specularTextures: group.specularTextures,
    specularGloss: group.specularGloss,
    normalSwizzles: group.normalSwizzles,
    layerColors: group.layerColors,
    weightTextures: group.weightTextures,
    weightTextureCoordinates: [],
  })
  const rasterSplatBatch = (
    key = rasterSplatKey!,
    mask?: Readonly<{ texture: SceneRendererTexture; channel: number }>,
  ): MutableSplatBatch => {
    const existing = splat.get(key)
    if (existing !== undefined) return existing
    const target = newRasterSplatBatch(exactRasterSplat!, mask)
    splat.set(key, target)
    return target
  }
  const rasterOverlayBatch = (group: RasterSplatGroup): MutableSplatBatch => {
    const key = rasterSplatGroupKey('terrain-raster-splat-overlay', group)
    const target = splatOverlays.get(key) ?? newRasterSplatBatch(group)
    splatOverlays.set(key, target)
    return target
  }
  const rasterUv = (x: number, y: number): readonly [number, number] => [
    (x - terrainMinimumX) / (terrainMaximumX - terrainMinimumX),
    (y - terrainMinimumY) / (terrainMaximumY - terrainMinimumY),
  ]
  const terrainAoAt = (x: number, y: number): number => {
    const gx = Math.floor(x),
      gy = Math.floor(y),
      fx = x - gx,
      fy = y - gy
    const at = (dx: number, dy: number) =>
      terrainByCell.get(`${gx + dx}:${gy + dy}`)?.ambientOcclusion ?? 1
    return (
      at(0, 0) * (1 - fx) * (1 - fy) +
      at(1, 0) * fx * (1 - fy) +
      at(1, 1) * fx * fy +
      at(0, 1) * (1 - fx) * fy
    )
  }
  const { gridOf, liftedCliffPrimitives, registerCliffPiece } = createCliffPrimitiveLifter(
    terrain,
    terrainByCell,
    terrainMinimumX,
    terrainMinimumY,
  )
  // Every placed piece registers its vertices before any piece is lifted, so shared seam vertices
  // get one offset (see `registerCliffPiece`).
  for (const item of input.items) {
    if (item.facet !== 'objects' || item.derivedFrom !== 'cliffs' || item.resourceId === undefined)
      continue
    const sampled = sampleSharedModel(item.resourceId, item)
    if (sampled === undefined) continue
    registerCliffPiece(sampled.primitives, worldObjectTransform(item, objectPosition(item, input)))
  }
  type CliffTriangle = readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ]
  interface CliffPlate {
    readonly vertices: CliffTriangle
    readonly normal: readonly [number, number, number]
  }
  /**
   * The surface one resolved cliff piece draws, in world space. A cliff mesh models its whole
   * footprint, but only the wall face is opaque: its floor, top and ramp strip are transparent where
   * SC2 shows the terrain's own texture through them. The height field under a piece is redundant
   * (a wall piece's corners are the tile's corners by construction) and its one-unit slope would rise
   * through the transparent floor and bury the face, so every cell the piece covers is cut and the
   * piece's up-facing surface is drawn as terrain instead, textured by world position. Height-field
   * vertices on the boundary of a cut region are snapped onto that surface, so ramp slopes and shore
   * cells join their pieces instead of leaving a step.
   */
  interface CliffFill {
    readonly ramp: boolean
    /** The piece shows the ground through its blend mask; its plates are not drawn as terrain. */
    readonly masked: boolean
    readonly minX: number
    readonly maxX: number
    readonly minZ: number
    readonly maxZ: number
    /** Up-facing surface, drawn as terrain and snapped to. */
    readonly plates: readonly CliffPlate[]
    /** Everything but vertical faces: what a ramp piece's footprint is measured from. */
    readonly cover: readonly CliffPlate[]
  }
  /**
   * Height of a piece's surface over a point. Natural rock overhangs, so several plates can stack
   * over one point: with `near` given, the one closest to that height wins (the floor under a rock
   * lip for a low-ground vertex, the top for a plateau vertex), otherwise the highest.
   */
  const plateHeightAt = (plates: readonly CliffPlate[], x: number, z: number, near?: number) => {
    let best: number | undefined
    for (const plate of plates) {
      const [a, b, c] = plate.vertices
      const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2])
      if (Math.abs(d) < 1e-12) continue
      const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d
      const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d
      const w = 1 - u - v
      if (u < -1e-3 || v < -1e-3 || w < -1e-3) continue
      const height = u * a[1] + v * b[1] + w * c[1]
      if (
        best === undefined ||
        (near === undefined ? height > best : Math.abs(height - near) < Math.abs(best - near))
      )
        best = height
    }
    return best
  }
  const cliffFills: CliffFill[] = []
  const cliffReceiverTriangles: number[] = []
  /** Cliff floor triangles that lie on the height field: projector receivers as the ground itself. */
  const cliffGroundTriangles: number[] = []
  /**
   * Whether a world point lies on the height field as its vertices place it (before pieces cut it):
   * within a tenth of a unit of the bilinear height of its cell. A ramp's strip follows the field;
   * the rails and rims of cliff pieces stand above it.
   */
  const onHeightField = (point: readonly [number, number, number]) => {
    const [gx, gy] = gridOf(point)
    const x = Math.floor(gx),
      y = Math.floor(gy)
    const heights = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].map(([dx, dy]) => {
      const vertex = terrainByCell.get(`${x + dx!}:${y + dy!}`)
      return vertex === undefined ? undefined : terrainPosition(vertex)[1]
    })
    if (heights.some(height => height === undefined)) return false
    const [h00, h10, h01, h11] = heights as number[]
    const fx = gx - x,
      fy = gy - y
    const field =
      (h00! * (1 - fx) + h10! * fx) * (1 - fy) + (h01! * (1 - fx) + h11! * fx) * fy
    return Math.abs(point[1] - field) <= 0.1
  }
  /** Masked-ground corners standing on a height-field vertex; see where their normals are joined. */
  const footprintEdgeVertices: {
    readonly key: string
    readonly height: number
    readonly target: MutableSplatBatch
    readonly index: number
  }[] = []
  if (exactRasterSplat !== undefined)
    for (const item of input.items) {
      if (
        item.facet !== 'objects' ||
        item.derivedFrom !== 'cliffs' ||
        item.resourceId === undefined
      )
        continue
      const sampled = sampleSharedModel(item.resourceId, item)
      if (sampled === undefined) continue
      const translation = objectPosition(item, input)
      const ramp = /:ramp-[0-9]+$/u.test(item.id)
      const raw: CliffPlate[] = []
      const cover: CliffPlate[] = []
      let masked = false
      for (const primitive of liftedCliffPrimitives(
        sampled.primitives,
        worldObjectTransform(item, translation),
      )) {
        // A piece whose material has a terrain blend mask shows the ground through its own surface,
        // per pixel, where the mask is clear (SC2 TerrainAlphaMask): every face, steep rims and
        // wall feet included, is drawn once more as terrain and kept only where the rock is
        // alpha-tested away. Plates standing in for that ground left holes wherever a clear face
        // was not a plate, and painted ground over rock wherever a plate was masked.
        const layer = cliffMaskLayer(sampled.result, primitive.materialId)
        const maskUvs =
          layer === undefined ? undefined : cliffMaskCoordinates(primitive, layer.uvSource)
        const maskTarget =
          layer === undefined || maskUvs === undefined
            ? undefined
            : rasterSplatBatch(
                [rasterSplatKey!, 'mask', layer.texture.id, String(layer.channel)].join(
                  String.fromCharCode(0),
                ),
                layer,
              )
        if (maskTarget !== undefined) masked = true
        for (const triangle of primitiveTriangles(primitive)) {
          const vertices = triangle.map(index =>
            instanceVertex(transformedPrimitiveVertex(primitive, index), item, translation),
          ) as unknown as CliffTriangle
          let normal = faceNormal(vertices[0], vertices[1], vertices[2])
          const flipped = normal[1] < 0
          const upward: CliffTriangle = flipped ? [vertices[0], vertices[2], vertices[1]] : vertices
          if (flipped) normal = [-normal[0], -normal[1], -normal[2]]
          if (maskTarget !== undefined) {
            const order = flipped ? [0, 2, 1] : [0, 1, 2]
            const grid = upward.map(gridOf) as [
              readonly [number, number],
              readonly [number, number],
              readonly [number, number],
            ]
            const firstVertex = maskTarget.positions.length / 3
            pushSplatTriangle(
              maskTarget,
              upward,
              exactRasterSplat!.definitions.map(
                definition =>
                  grid.map(point =>
                    terrainSurfaceUv(
                      { x: Math.floor(point[0]), y: Math.floor(point[1]) },
                      [point[0] - Math.floor(point[0]), point[1] - Math.floor(point[1])],
                      undefined,
                      definition.uvTransform,
                    ),
                  ) as [readonly [number, number], readonly [number, number], readonly [number, number]],
              ),
              [],
              // The mesh's own normals, as PSTerrainDoodad lights the ground on a cliff: face normals
              // showed every facet of the rock through the ground.
              order.map(corner => instanceNormal(primitive, triangle[corner]!, item) ?? normal) as unknown as CliffTriangle,
              grid.map(([x, y]) => terrainAoAt(x, y)),
            )
            maskTarget.weightTextureCoordinates!.push(
              ...grid.map(point => rasterUv(point[0], point[1])).flat(),
            )
            grid.forEach(([gx, gy], corner) => {
              const x = Math.round(gx)
              const y = Math.round(gy)
              if (Math.abs(gx - x) > 1e-3 || Math.abs(gy - y) > 1e-3) return
              footprintEdgeVertices.push({
                key: `${x}:${y}`,
                height: upward[corner]![1],
                target: maskTarget,
                index: firstVertex + corner,
              })
            })
            for (const corner of order) {
              const index = triangle[corner]!
              maskTarget.maskTextureCoordinates!.push(
                ...layer!.transform(maskUvs![index * 2]!, maskUvs![index * 2 + 1]!),
              )
            }
            terrainTexturedTriangles += 1
            terrainTriangles += 1
          }
          if (normal[1] < 0.05) continue
          cover.push({ vertices: upward, normal })
          if (normal[1] >= 0.5) {
            raw.push({ vertices: upward, normal })
            // Splats land on a cliff piece's floor as on the ground (SC2 cliff materials accept splats):
            // a platform's rim is cliff geometry, and decals there were hidden beneath it. Where the
            // floor lies on the height field (a ramp's strip) it is the ground a terrain bake reaches.
            ;(upward.every(vertex => onHeightField(vertex))
              ? cliffGroundTriangles
              : cliffReceiverTriangles
            ).push(...upward.flat())
          }
        }
      }
      if (raw.length === 0) continue
      let minX = Infinity
      let maxX = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity
      for (const plate of raw)
        for (const vertex of plate.vertices) {
          minX = Math.min(minX, vertex[0])
          maxX = Math.max(maxX, vertex[0])
          minZ = Math.min(minZ, vertex[2])
          maxZ = Math.max(maxZ, vertex[2])
        }
      // Inside its footprint the fill sits a hair under a made wall so its opaque cap wins, and a
      // hair OVER natural rock: SC2 blends a natural cliff's top into the terrain, so its up-facing
      // crest reads as ground and only the faces below read as rock. Ramp pieces sit a hair lower
      // again, under the wall tiles they overlap. On the footprint's edge the fill meets the
      // neighbouring height-field cell exactly, or a hairline crack shows.
      // ponytail: natural rock is told apart by its mesh family name; every shipped natural set is
      // `CliffNatural*`. Sample the mesh alpha instead if a set breaks the naming.
      const natural = /:CliffNatural/u.test(item.typeId ?? '')
      const onEdge = (x: number, z: number) =>
        Math.abs(x - minX) < 0.02 ||
        Math.abs(x - maxX) < 0.02 ||
        Math.abs(z - minZ) < 0.02 ||
        Math.abs(z - maxZ) < 0.02
      const offset = ramp ? 0.02 : natural ? -0.01 : 0.01
      // A made wall's up-facing surface also includes its cap rail, which stands above the ground and
      // is part of the wall, not terrain. Its edge vertices would sit exactly on the fill (see
      // `onEdge`) and the terrain won the depth tie, painting the cap with ground texture. Only plates
      // lying at the height of the ground around the piece (its floor and the plateau top) are fill.
      const grounds: number[] = []
      if (!ramp && !natural) {
        const low = gridOf([minX, 0, minZ])
        const high = gridOf([maxX, 0, maxZ])
        for (
          let gy = Math.round(Math.min(low[1], high[1]));
          gy <= Math.round(Math.max(low[1], high[1]));
          gy += 1
        )
          for (
            let gx = Math.round(Math.min(low[0], high[0]));
            gx <= Math.round(Math.max(low[0], high[0]));
            gx += 1
          ) {
            const vertex = terrainByCell.get(`${gx}:${gy}`)
            if (vertex !== undefined) grounds.push(terrainPosition(vertex)[1])
          }
      }
      const fillSource =
        grounds.length === 0
          ? raw
          : raw.filter(plate =>
              plate.vertices.every(vertex =>
                grounds.some(ground => Math.abs(ground - vertex[1]) < 0.05),
              ),
            )
      const plates = fillSource.map(plate => ({
        normal: plate.normal,
        vertices: plate.vertices.map(
          vertex =>
            [
              vertex[0],
              vertex[1] - (onEdge(vertex[0], vertex[2]) ? 0 : offset),
              vertex[2],
            ] as const,
        ) as unknown as CliffTriangle,
      }))
      cliffFills.push({ ramp, masked, minX, maxX, minZ, maxZ, plates, cover })
    }
  // Height-field cells a piece's surface covers entirely (they are cut), and the height every
  // height-field vertex under a piece's surface is snapped to.
  const cutCells = new Set<string>()
  const vertexOverride = new Map<string, number>()
  for (const fill of cliffFills) {
    const low = gridOf([fill.minX, 0, fill.minZ])
    const high = gridOf([fill.maxX, 0, fill.maxZ])
    const x0 = Math.floor(Math.min(low[0], high[0]) - 1e-3)
    const x1 = Math.ceil(Math.max(low[0], high[0]) + 1e-3)
    const y0 = Math.floor(Math.min(low[1], high[1]) - 1e-3)
    const y1 = Math.ceil(Math.max(low[1], high[1]) + 1e-3)
    for (let y = y0; y <= y1; y += 1)
      for (let x = x0; x <= x1; x += 1) {
        const vertex = terrainByCell.get(`${x}:${y}`)
        if (vertex === undefined) continue
        const at = terrainPosition(vertex)
        const height = plateHeightAt(fill.plates, at[0], at[2], at[1])
        if (height === undefined) continue
        const key = `${x}:${y}`
        const previous = vertexOverride.get(key)
        if (previous === undefined || Math.abs(height - at[1]) < Math.abs(previous - at[1]))
          vertexOverride.set(key, height)
      }
    for (let y = y0; y < y1; y += 1)
      for (let x = x0; x < x1; x += 1) {
        const corners = [
          terrainByCell.get(`${x}:${y}`),
          terrainByCell.get(`${x + 1}:${y}`),
          terrainByCell.get(`${x + 1}:${y + 1}`),
          terrainByCell.get(`${x}:${y + 1}`),
        ]
        if (corners.some(corner => corner === undefined)) continue
        const at = corners.map(corner => terrainPosition(corner!))
        const centre = [
          at.reduce((sum, point) => sum + point[0], 0) / 4,
          at.reduce((sum, point) => sum + point[2], 0) / 4,
        ] as const
        // The corners are tested a little inside the cell: a footprint edge runs exactly through them.
        // A wall piece is a full 2x2 tile by design, so its bounds decide; a ramp piece is a diagonal
        // band inside its bounds, so its surface (steep faces included, since natural rock has no
        // up-facing surface right at its face) decides.
        const probes = [
          centre,
          ...at.map(point => [
            point[0] + (centre[0] - point[0]) * 0.05,
            point[2] + (centre[1] - point[2]) * 0.05,
          ]),
        ]
        const covered = fill.ramp
          ? probes.every(probe => plateHeightAt(fill.cover, probe[0]!, probe[1]!) !== undefined)
          : probes.every(
              probe =>
                probe[0]! >= fill.minX - 1e-3 &&
                probe[0]! <= fill.maxX + 1e-3 &&
                probe[1]! >= fill.minZ - 1e-3 &&
                probe[1]! <= fill.maxZ + 1e-3,
            )
        if (covered) cutCells.add(`${x}:${y}`)
      }
  }
  for (const fill of cliffFills) {
    if (fill.masked) continue
    const target = rasterSplatBatch()
    for (const plate of fill.plates) {
      const grid = plate.vertices.map(gridOf) as [
        readonly [number, number],
        readonly [number, number],
        readonly [number, number],
      ]
      const coordinates = exactRasterSplat!.definitions.map(
        definition =>
          grid.map(point =>
            terrainSurfaceUv(
              { x: Math.floor(point[0]), y: Math.floor(point[1]) },
              [point[0] - Math.floor(point[0]), point[1] - Math.floor(point[1])],
              undefined,
              definition.uvTransform,
            ),
          ) as [readonly [number, number], readonly [number, number], readonly [number, number]],
      )
      pushSplatTriangle(
        target,
        plate.vertices,
        coordinates,
        [],
        [plate.normal, plate.normal, plate.normal],
        grid.map(([x, y]) => terrainAoAt(x, y)),
      )
      target.weightTextureCoordinates!.push(
        ...grid.map(point => rasterUv(point[0], point[1])).flat(),
      )
      terrainTexturedTriangles += 1
      terrainTriangles += 1
    }
  }
  // Ground a model shows on its own surface (renderModel.presentation 'terrain-projection', SC2 TER_ drawn
  // by PSTerrainDoodad): the torn skirt of a geyser or mineral field takes the terrain textures by map
  // position and the mesh's own shape, so the ground seems to break open around it.
  if (exactRasterSplat !== undefined)
    for (const item of input.items) {
      if (
        item.facet !== 'objects' ||
        item.derivedFrom === 'cliffs' ||
        item.resourceId === undefined
      )
        continue
      const ids = terrainProjectionMaterialIds(input.models?.get(item.resourceId))
      if (ids.size === 0) continue
      const sampled = sampleSharedModel(item.resourceId, item)
      if (sampled === undefined) continue
      const translation = objectPosition(item, input)
      const target = rasterSplatBatch()
      for (const primitive of sampled.primitives) {
        if (primitive.materialId === undefined || !ids.has(primitive.materialId)) continue
        for (const triangle of primitiveTriangles(primitive)) {
          const vertices = triangle.map(index =>
            instanceVertex(transformedPrimitiveVertex(primitive, index), item, translation),
          ) as unknown as CliffTriangle
          let normal = faceNormal(vertices[0], vertices[1], vertices[2])
          if (!Number.isFinite(normal[0] + normal[1] + normal[2])) continue
          if (normal[1] < 0) normal = [-normal[0], -normal[1], -normal[2]]
          const grid = vertices.map(gridOf) as [
            readonly [number, number],
            readonly [number, number],
            readonly [number, number],
          ]
          pushSplatTriangle(
            target,
            vertices,
            exactRasterSplat.definitions.map(
              definition =>
                grid.map(point =>
                  terrainSurfaceUv(
                    { x: Math.floor(point[0]), y: Math.floor(point[1]) },
                    [point[0] - Math.floor(point[0]), point[1] - Math.floor(point[1])],
                    undefined,
                    definition.uvTransform,
                  ),
                ) as [
                  readonly [number, number],
                  readonly [number, number],
                  readonly [number, number],
                ],
            ),
            [],
            triangle.map(index => instanceNormal(primitive, index, item) ?? normal) as unknown as CliffTriangle,
            grid.map(([x, y]) => terrainAoAt(x, y)),
          )
          target.weightTextureCoordinates!.push(
            ...grid.map(point => rasterUv(point[0], point[1])).flat(),
          )
          terrainTexturedTriangles += 1
          terrainTriangles += 1
        }
      }
    }
  /** A height-field vertex, snapped onto a cliff piece's surface where one covers it. */
  const snappedTerrainPosition = (
    item: WorldSceneTerrainItem,
  ): readonly [number, number, number] => {
    const position = terrainPosition(item)
    const override = vertexOverride.get(`${item.x}:${item.y}`)
    return override === undefined ? position : [position[0], override, position[2]]
  }
  /**
   * One flat piece of a terrain cell: its four corners, their local coordinates inside the cell and
   * the diagonal it is cut along.
   */
  interface TerrainPatch {
    readonly positions: readonly [
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number],
    ]
    readonly locals: readonly [
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
    ]
    readonly split: typeof SPLIT_AC | typeof SPLIT_BD
    /** A flat plate under a cliff piece, or a joint: lit with a fixed normal, not the height field's. */
    readonly quadrant: boolean
    /** Set on a vertical skirt, whose corners take this normal instead of the height field's. */
    readonly normal?: readonly [number, number, number]
  }
  interface DrawnTerrainCell {
    readonly item: WorldSceneTerrainItem
    readonly patches: readonly TerrainPatch[]
  }
  const drawnCells = new Map<string, DrawnTerrainCell>()
  /**
   * One normal per height vertex, summed from the faces meeting there.
   *
   * Terrain was flat-shaded, so every cell triangle carried its own face normal and the seams
   * between them read as hard diagonal bands — easy to mistake for a texture transition. Summing
   * face normals keeps quadrants flat while slopes shade continuously, as SC2 lights terrain.
   */
  const vertexNormals = new Map<string, [number, number, number]>()
  const addVertexNormal = (key: string, normal: readonly [number, number, number]) => {
    const accumulated = vertexNormals.get(key)
    if (accumulated === undefined) vertexNormals.set(key, [normal[0], normal[1], normal[2]])
    else {
      accumulated[0] += normal[0]
      accumulated[1] += normal[1]
      accumulated[2] += normal[2]
    }
  }
  // Cells cut from the drawn ground under cliff pieces still cast. SC2's height field is whole: it
  // climbs every cliff and throws the cliff's shadow (its natural cliff meshes are no-shadows-cast for
  // that reason). Without these cells the casting ground ended a cliff's width short of the edge and
  // an east-facing coast threw almost nothing onto the beach below, only the rim doodads did.
  const cutShadowCasters: number[] = []
  for (const item of terrain) {
    const east = terrainByCell.get(`${item.x + 1}:${item.y}`)
    const south = terrainByCell.get(`${item.x}:${item.y + 1}`)
    const southEast = terrainByCell.get(`${item.x + 1}:${item.y + 1}`)
    if (east === undefined || south === undefined || southEast === undefined) continue
    const corners = [item, east, southEast, south].map(
      snappedTerrainPosition,
    ) as unknown as TerrainPatch['positions']
    if (cutCells.has(`${item.x}:${item.y}`)) {
      const [a, b, c, d] = [item, east, southEast, south].map(terrainPosition)
      cutShadowCasters.push(...a!, ...b!, ...c!, ...a!, ...c!, ...d!)
      continue
    }
    // A hole the map punched in its ground (the space around Lockdown's platform) shows what is
    // below: nothing is drawn and nothing casts.
    if (item.presentationCellHidden === true) continue
    const cornerKeys = [
      `${item.x}:${item.y}`,
      `${item.x + 1}:${item.y}`,
      `${item.x + 1}:${item.y + 1}`,
      `${item.x}:${item.y + 1}`,
    ]
    // Cut along the diagonal with the smaller height difference, so 45° cliff and ramp edges in
    // either direction stay straight instead of zig-zagging across fixed-diagonal cells; a layer
    // whose coverage singles out one corner cuts it off (MapTerrainMaterialSample.layers).
    const split =
      cornerAlphaSplit(materialByCell.get(`${item.x}:${item.y}`)) ??
      (Math.abs(corners[0][1] - corners[2][1]) <= Math.abs(corners[1][1] - corners[3][1])
        ? SPLIT_AC
        : SPLIT_BD)
    drawnCells.set(`${item.x}:${item.y}`, {
      item,
      patches: [
        {
          positions: corners,
          locals: [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
          split,
          quadrant: false,
        },
      ],
    })
    for (const triangle of split) {
      const normal = faceNormal(corners[triangle[0]]!, corners[triangle[1]]!, corners[triangle[2]]!)
      for (const corner of triangle) addVertexNormal(cornerKeys[corner]!, normal)
    }
  }
  // Where a masked piece's floor or top meets the drawn ground at a height-field vertex, both take one
  // normal: the mean of the ground's and the mesh's. The vertex's own normal is summed from the drawn
  // cells alone (those under the piece are cut), so on a shore falling away from a tile it leaned the
  // whole slope while the floor beside it kept the mesh's upright normal. The light broke along the
  // tile's edge and every tile read as a lighter rectangle, on the ground and through the water.
  // Two cliff pieces meeting on a tile edge carry their own normals along it (each mesh is authored for
  // its own tile), so the ground seen through them lit differently on either side of the edge: a hairline
  // step at every masked tile seam. Up-facing masked vertices standing on one point take the mean of
  // their normals first, as the pieces' lifted positions are pooled (see `registerCliffPiece`).
  {
    const pooled = new Map<string, { sum: [number, number, number]; members: [number[], number][] }>()
    for (const target of splat.values()) {
      if (target.maskTexture === undefined) continue
      const { positions, normals } = target
      for (let index = 0; index * 3 < positions.length; index += 1) {
        if (normals[index * 3 + 1]! < 0.5) continue
        const key = cliffPointKey(positions[index * 3]!, positions[index * 3 + 1]!, positions[index * 3 + 2]!)
        let entry = pooled.get(key)
        if (entry === undefined) pooled.set(key, (entry = { sum: [0, 0, 0], members: [] }))
        entry.sum[0] += normals[index * 3]!
        entry.sum[1] += normals[index * 3 + 1]!
        entry.sum[2] += normals[index * 3 + 2]!
        entry.members.push([normals, index])
      }
    }
    for (const { sum, members } of pooled.values()) {
      if (members.length < 2) continue
      const length = Math.hypot(sum[0], sum[1], sum[2])
      for (const [normals, index] of members) {
        normals[index * 3] = sum[0] / length
        normals[index * 3 + 1] = sum[1] / length
        normals[index * 3 + 2] = sum[2] / length
      }
    }
  }
  {
    const meshNormals = new Map<string, [number, number, number]>()
    const edges = footprintEdgeVertices.filter(({ key, height, target, index }) => {
      const vertex = terrainByCell.get(key)
      if (vertex === undefined || !vertexNormals.has(key)) return false
      // A wall's foot or a rim standing on the vertex keeps its own normal.
      if (target.normals[index * 3 + 1]! < 0.5) return false
      if (Math.abs(snappedTerrainPosition(vertex)[1] - height) > 0.05) return false
      const sum = meshNormals.get(key) ?? [0, 0, 0]
      sum[0] += target.normals[index * 3]!
      sum[1] += target.normals[index * 3 + 1]!
      sum[2] += target.normals[index * 3 + 2]!
      meshNormals.set(key, sum)
      return true
    })
    const unit = (value: readonly [number, number, number]): [number, number, number] => {
      const length = Math.hypot(value[0], value[1], value[2])
      return [value[0] / length, value[1] / length, value[2] / length]
    }
    for (const [key, mesh] of meshNormals) {
      const ground = unit(vertexNormals.get(key)!)
      const floor = unit(mesh)
      vertexNormals.set(key, unit([ground[0] + floor[0], ground[1] + floor[1], ground[2] + floor[2]]))
    }
    for (const { key, target, index } of edges) {
      const shared = vertexNormals.get(key)!
      target.normals[index * 3] = shared[0]
      target.normals[index * 3 + 1] = shared[1]
      target.normals[index * 3 + 2] = shared[2]
    }
  }
  const vertexNormal = (x: number, y: number): readonly [number, number, number] => {
    const summed = vertexNormals.get(`${String(x)}:${String(y)}`)
    if (summed === undefined) return [0, 1, 0]
    const length = Math.hypot(summed[0], summed[1], summed[2])
    return length < 1e-6 ? [0, 1, 0] : [summed[0] / length, summed[1] / length, summed[2] / length]
  }
  for (const item of terrain) {
    const cell = drawnCells.get(`${item.x}:${item.y}`)
    const east = terrainByCell.get(`${item.x + 1}:${item.y}`)
    const south = terrainByCell.get(`${item.x}:${item.y + 1}`)
    const southEast = terrainByCell.get(`${item.x + 1}:${item.y + 1}`)
    if (cell === undefined || east === undefined || south === undefined || southEast === undefined)
      continue
    for (const patch of cell.patches) {
      const tri = <T>(values: readonly [T, T, T, T], index: 0 | 1) =>
        patch.split[index].map(corner => values[corner]!) as [T, T, T]
      const cornerNormals = (
        patch.normal !== undefined
          ? [patch.normal, patch.normal, patch.normal, patch.normal]
          : patch.quadrant
            ? [
                [0, 1, 0],
                [0, 1, 0],
                [0, 1, 0],
                [0, 1, 0],
              ]
            : [
                vertexNormal(item.x, item.y),
                vertexNormal(item.x + 1, item.y),
                vertexNormal(item.x + 1, item.y + 1),
                vertexNormal(item.x, item.y + 1),
              ]
      ) as readonly [
        readonly [number, number, number],
        readonly [number, number, number],
        readonly [number, number, number],
        readonly [number, number, number],
      ]
      const quad = patch.positions
      const cornerAo = patch.locals.map(([x, y]) => terrainAoAt(item.x + x, item.y + y)) as [
        number,
        number,
        number,
        number,
      ]
      const materialSample = materialByCell.get(`${item.x}:${item.y}`)
      /**
       * A tile over the ground drawn below, same triangles, its alpha blending; lit as the ground is,
       * with its own normal and specular maps, the ground's AO in colour alpha and its coverage at
       * the corners in colour red. `depth` orders the batches: a cell's upper tileset layers (`layers`
       * after the first) in their order, then the decal.
       */
      const drawOverlay = (
        materialId: string,
        depth: number,
        uvAt: (
          local: readonly [number, number],
          definition: MapTerrainMaterialDefinition,
          texture: SceneRendererTexture,
        ) => readonly [number, number],
        atlasLayer = false,
        cornerAlpha?: readonly [number, number, number, number],
      ) => {
        const definition = input.terrainMaterials?.find(
          candidate => candidate.materialId === materialId,
        )
        const texture =
          definition?.baseColorResourceId === undefined
            ? undefined
            : input.terrainTextures?.get(definition.baseColorResourceId)
        if (texture === undefined) return
        const normalTexture =
          definition?.normalResourceId === undefined
            ? undefined
            : input.terrainTextures?.get(definition.normalResourceId)
        const specularTexture =
          definition?.specularResourceId === undefined
            ? undefined
            : input.terrainTextures?.get(definition.specularResourceId)
        const atlas =
          atlasLayer && definition?.atlas !== undefined
            ? atlasGrid(definition.atlas.rows, texture)
            : undefined
        const key = [
          depth,
          texture.id,
          normalTexture?.id ?? '',
          specularTexture?.id ?? '',
          atlas === undefined ? '' : 'atlas',
          definition?.overlayAlpha ?? 'texture',
        ].join(String.fromCharCode(0))
        decalDepths.set(key, depth)
        const target = decals.get(key) ?? {
          ...batch(),
          textureCoordinates: [],
          texture,
          ...(definition?.overlayAlpha === undefined ? {} : { overlayAlpha: definition.overlayAlpha }),
          ...(atlas === undefined ? {} : { atlas, secondaryTextureCoordinates: [] }),
          ...(normalTexture === undefined
            ? {}
            : { normalTexture, normalSwizzle: normalSwizzleOf(definition!.normalEncoding) }),
          ...(specularTexture === undefined
            ? {}
            : { specularTexture, specularGloss: definition!.specularEncoding === 'gloss' }),
        }
        decals.set(key, target)
        const uvs = patch.locals.map(local => uvAt(local, definition!, texture)) as [
          readonly [number, number],
          readonly [number, number],
          readonly [number, number],
          readonly [number, number],
        ]
        const aoColors = patch.locals.map(([x, y], corner) => [
          cornerAlpha === undefined
            ? 1
            : (1 - x) * (1 - y) * cornerAlpha[0] +
              x * (1 - y) * cornerAlpha[1] +
              x * y * cornerAlpha[2] +
              (1 - x) * y * cornerAlpha[3],
          1,
          1,
          cornerAo[corner]!,
        ]) as unknown as [WorldColor, WorldColor, WorldColor, WorldColor]
        for (const index of [0, 1] as const) {
          pushTexturedTriangle(
            target,
            tri(quad, index),
            tri(uvs, index),
            tri(aoColors, index),
            tri(cornerNormals, index),
          )
          pushCellCoordinates(target, item, tri(patch.locals, index))
        }
        terrainDecalTriangles += 2
      }
      const groundLayer = materialSample?.layers?.[0]
      const drawUpperLayers = () =>
        materialSample?.layers
          ?.slice(1)
          .forEach((layer, index) =>
            drawOverlay(
              layer.materialId,
              index + 1,
              (local, definition, texture) =>
                definition.atlas === undefined
                  ? terrainSurfaceUv(item, local, undefined, definition.uvTransform)
                  : atlasTileUv(local, definition.atlas, texture, layer.tile),
              true,
              layer.cornerAlpha,
            ),
          )
      const drawDecal = () => {
        const decal = materialSample?.decal
        if (decal === undefined) return
        drawOverlay(decal.materialId, Number.MAX_SAFE_INTEGER, (local, definition) =>
          terrainSurfaceUv(item, local, decal, definition.uvTransform),
        )
      }
      if (exactRasterSplat !== undefined) {
        const [uvA, uvB, uvC, uvD] = patch.locals.map(local =>
          rasterUv(item.x + local[0], item.y + local[1]),
        ) as [
          readonly [number, number],
          readonly [number, number],
          readonly [number, number],
          readonly [number, number],
        ]
        const pushRasterCell = (target: MutableSplatBatch, group: RasterSplatGroup) => {
          const coordinates = group.definitions.map(definition => {
            const [layerA, layerB, layerC, layerD] = patch.locals.map(local =>
              terrainSurfaceUv(item, local, undefined, definition.uvTransform),
            ) as [
              readonly [number, number],
              readonly [number, number],
              readonly [number, number],
              readonly [number, number],
            ]
            return {
              first: tri([layerA, layerB, layerC, layerD], 0),
              second: tri([layerA, layerB, layerC, layerD], 1),
            }
          })
          pushSplatTriangle(
            target,
            tri(quad, 0),
            coordinates.map(candidate => candidate.first),
            [],
            tri(cornerNormals, 0),
            tri(cornerAo, 0),
          )
          target.weightTextureCoordinates!.push(...tri([uvA, uvB, uvC, uvD], 0).flat())
          pushSplatTriangle(
            target,
            tri(quad, 1),
            coordinates.map(candidate => candidate.second),
            [],
            tri(cornerNormals, 1),
            tri(cornerAo, 1),
          )
          target.weightTextureCoordinates!.push(...tri([uvA, uvB, uvC, uvD], 1).flat())
        }
        pushRasterCell(rasterSplatBatch(), exactRasterSplat)
        for (const overlay of rasterSplatOverlays) pushRasterCell(rasterOverlayBatch(overlay), overlay)
        drawDecal()
        terrainPickTriangles.push(...tri(quad, 0).flat(), ...tri(quad, 1).flat())
        terrainTexturedTriangles += 2
        terrainTriangles += 2
        continue
      }
      const declaredWeights =
        (groundLayer === undefined
          ? undefined
          : [{ materialId: groundLayer.materialId, weight: 1 }]) ??
        materialSample?.weights?.filter(weight => weight.weight > 0) ??
        input.terrainMaterials
          ?.filter(material => material.sourceIndex === materialSample?.textureIndex)
          .map(material => ({ materialId: material.materialId, weight: 1 })) ??
        []
      const dominantMaterialId =
        declaredWeights.slice().sort((left, right) => right.weight - left.weight)[0]?.materialId ??
        input.terrainMaterials?.find(
          material => material.sourceIndex === materialSample?.textureIndex,
        )?.materialId
      const material = input.terrainMaterials?.find(
        candidate => candidate.materialId === dominantMaterialId,
      )
      const texture =
        material?.baseColorResourceId === undefined
          ? undefined
          : input.terrainTextures?.get(material.baseColorResourceId)
      const normalTexture =
        material?.normalResourceId === undefined
          ? undefined
          : input.terrainTextures?.get(material.normalResourceId)
      // glTF baseColorFactor: multiplies the texture, or is the colour without one; never transparent
      const factor = material?.baseColorFactor
      const color =
        factor === undefined ? ([1, 1, 1, 1] as const) : ([factor[0], factor[1], factor[2], 1] as const)
      const resolvedSplat = declaredWeights.flatMap(weight => {
        const definition = input.terrainMaterials?.find(
          candidate => candidate.materialId === weight.materialId,
        )
        const resolvedTexture =
          definition?.baseColorResourceId === undefined
            ? undefined
            : input.terrainTextures?.get(definition.baseColorResourceId)
        return definition === undefined || resolvedTexture === undefined
          ? []
          : [{ definition, texture: resolvedTexture, weight: weight.weight }]
      })
      if (
        declaredWeights.length > 1 &&
        (declaredWeights.length > 8 || resolvedSplat.length !== declaredWeights.length)
      )
        terrainSplatFallbackCells += 1
      if (
        declaredWeights.length > 1 &&
        declaredWeights.length <= 8 &&
        resolvedSplat.length === declaredWeights.length
      ) {
        const textures = resolvedSplat.map(layer => layer.texture)
        const normalTextures = resolvedSplat.map(layer =>
          layer.definition.normalResourceId === undefined
            ? undefined
            : input.terrainTextures?.get(layer.definition.normalResourceId),
        )
        const layerColors = resolvedSplat.map(layer => terrainLayerColor(layer.definition))
        const key = `terrain-splat\u0000${textures
          .map(candidate => candidate.id)
          .join(
            '\u0000',
          )}\u0000${normalTextures.map(candidate => candidate?.id ?? '').join('\u0000')}\u0000${layerColors
          .map(color => color.join(','))
          .join(';')}`
        const target = splat.get(key) ?? {
          ...batch(),
          textureCoordinates: textures.map(() => []),
          textureWeights0: [],
          textureWeights1: [],
          textures,
          normalTextures,
          specularTextures: resolvedSplat.map(layer =>
            layer.definition.specularResourceId === undefined
              ? undefined
              : input.terrainTextures?.get(layer.definition.specularResourceId),
          ),
          normalSwizzles: resolvedSplat.map(layer => normalSwizzleOf(layer.definition.normalEncoding)),
          layerColors,
          specularGloss: resolvedSplat.some(layer => layer.definition.specularEncoding === 'gloss'),
        }
        splat.set(key, target)
        const coordinates = resolvedSplat.map(layer => {
          const transform = (uv: readonly [number, number]) =>
            terrainSurfaceUv(item, uv, materialSample, layer.definition.uvTransform)
          const [uvA, uvB, uvC, uvD] = patch.locals.map(transform) as [
            readonly [number, number],
            readonly [number, number],
            readonly [number, number],
            readonly [number, number],
          ]
          return { first: tri([uvA, uvB, uvC, uvD], 0), second: tri([uvA, uvB, uvC, uvD], 1) }
        })
        const weights = resolvedSplat.map(layer => layer.weight)
        pushSplatTriangle(
          target,
          tri(quad, 0),
          coordinates.map(candidate => candidate.first),
          weights,
          tri(cornerNormals, 0),
          tri(cornerAo, 0),
        )
        pushSplatTriangle(
          target,
          tri(quad, 1),
          coordinates.map(candidate => candidate.second),
          weights,
          tri(cornerNormals, 1),
          tri(cornerAo, 1),
        )
        terrainTexturedTriangles += 2
      } else if (texture === undefined) {
        for (const index of [0, 1] as const) {
          const vertices = tri(quad, index),
            normals = tri(cornerNormals, index)
          for (const corner of [0, 1, 2] as const)
            pushVertex(
              opaque,
              vertices[corner],
              normals[corner],
              factor === undefined ? heightColor(vertices[corner][1]) : color,
            )
        }
      } else {
        const atlas =
          groundLayer !== undefined && material?.atlas !== undefined
            ? atlasGrid(material.atlas.rows, texture)
            : undefined
        const key = [
          'terrain',
          texture.id,
          normalTexture?.id ?? '',
          atlas === undefined ? '' : 'atlas',
        ].join(String.fromCharCode(0))
        const target = textured.get(key) ?? {
          ...batch(),
          textureCoordinates: [],
          texture,
          ...(normalTexture === undefined ? {} : { normalTexture }),
          ...(atlas === undefined ? {} : { atlas, secondaryTextureCoordinates: [] }),
        }
        textured.set(key, target)
        const uv = (local: readonly [number, number]) =>
          groundLayer !== undefined && material?.atlas !== undefined
            ? atlasTileUv(
                materialSample?.cornerUv === undefined
                  ? local
                  : terrainSurfaceUv({ x: 0, y: 0 }, local, materialSample, undefined),
                material.atlas,
                texture,
                groundLayer.tile,
              )
            : terrainSurfaceUv(item, local, materialSample, material?.uvTransform)
        const [uvA, uvB, uvC, uvD] = patch.locals.map(uv) as [
          readonly [number, number],
          readonly [number, number],
          readonly [number, number],
          readonly [number, number],
        ]
        pushTexturedTriangle(
          target,
          tri(quad, 0),
          tri([uvA, uvB, uvC, uvD], 0),
          color,
          tri(cornerNormals, 0),
        )
        pushCellCoordinates(target, item, tri(patch.locals, 0))
        pushTexturedTriangle(
          target,
          tri(quad, 1),
          tri([uvA, uvB, uvC, uvD], 1),
          color,
          tri(cornerNormals, 1),
        )
        pushCellCoordinates(target, item, tri(patch.locals, 1))
        terrainTexturedTriangles += 2
      }
      drawUpperLayers()
      drawDecal()
      terrainPickTriangles.push(...tri(quad, 0).flat(), ...tri(quad, 1).flat())
      terrainTriangles += 2
    }
  }
  if (terrainTriangles === 0) {
    for (const item of terrain) {
      const position = terrainPosition(item)
      pushVertex(points, position, [0, 1, 0], heightColor(position[1]))
    }
  }

  let cliffEdges = 0
  let cliffTriangles = 0
  // Progressive acquisition: only suppress a skirt where a resolved cliff actually covers it.
  // A declared resource (or the first loaded piece elsewhere) does not replace the whole map.
  const resolvedCliffBounds: { minimum: number[]; maximum: number[] }[] = []
  const cliffObjects = input.items.filter(
    (item): item is WorldSceneObjectItem & { readonly resourceId: string } =>
      item.facet === 'objects' && item.derivedFrom === 'cliffs' && item.resourceId !== undefined,
  )
  let resolvedCliffObjects = 0
  for (const item of cliffObjects) {
    const sampled = sampleSharedModel(item.resourceId, item)
    if (sampled === undefined) continue
    resolvedCliffObjects += 1
    const transform = worldObjectTransform(item, objectPosition(item, input))
    const minimum = [Infinity, Infinity, Infinity],
      maximum = [-Infinity, -Infinity, -Infinity]
    for (const primitive of sampled.primitives) {
      if (primitiveTriangleCount(primitive) === 0) continue
      const entry = sharedPickPrimitive(primitive, {
        ...primitive,
        transform: multiplyComponentTransforms(
          transform,
          primitive.transform ?? IDENTITY_COMPONENT_TRANSFORM,
        ),
      })
      for (const axis of [0, 1, 2] as const) {
        minimum[axis] = Math.min(minimum[axis]!, entry.minimum[axis])
        maximum[axis] = Math.max(maximum[axis]!, entry.maximum[axis])
      }
    }
    if (Number.isFinite(minimum[0])) resolvedCliffBounds.push({ minimum, maximum })
  }
  const allCliffModelsResolved =
    cliffObjects.length > 0 && resolvedCliffObjects === cliffObjects.length
  const cliffs = input.items.filter(item => item.facet === 'cliffs')
  const cliffByCell = new Map(cliffs.map(item => [`${item.x}:${item.y}`, item]))
  for (const item of cliffs) {
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ] as const) {
      const neighbor = cliffByCell.get(`${item.x + dx}:${item.y + dy}`)
      if (neighbor === undefined || neighbor.level === item.level) continue
      // A ramp rises between two levels over several samples, and its ground is the terrain itself:
      // a skirt on each of its steps drew a grid of dark lines over Highland's ramps.
      if (item.ramp === true || neighbor.ramp === true) continue
      const a = terrainByCell.get(`${item.x}:${item.y}`)
      const b = terrainByCell.get(`${item.x + dx}:${item.y + dy}`)
      if (a === undefined || b === undefined) continue
      const alongX = dy === 0 ? 0 : 1
      const alongY = dx === 0 ? 0 : 1
      const c = terrainByCell.get(`${item.x + alongX}:${item.y + alongY}`)
      const d = terrainByCell.get(`${item.x + dx + alongX}:${item.y + dy + alongY}`)
      if (c === undefined || d === undefined) continue
      const positionA = terrainPosition(a)
      const positionB = terrainPosition(b)
      const positionC = terrainPosition(c)
      const positionD = terrainPosition(d)
      if (
        Math.abs(positionA[1] - positionB[1]) <= Number.EPSILON &&
        Math.abs(positionC[1] - positionD[1]) <= Number.EPSILON
      )
        continue
      const sideA0 = [
        (positionA[0] + positionB[0]) / 2,
        positionA[1],
        (positionA[2] + positionB[2]) / 2,
      ] as const
      const sideB0 = [sideA0[0], positionB[1], sideA0[2]] as const
      const sideA1 = [
        (positionC[0] + positionD[0]) / 2,
        positionC[1],
        (positionC[2] + positionD[2]) / 2,
      ] as const
      const sideB1 = [sideA1[0], positionD[1], sideA1[2]] as const
      if (
        allCliffModelsResolved ||
        resolvedCliffBounds.some(bounds =>
          [sideA0, sideA1].every(
            vertex =>
              vertex[0] >= bounds.minimum[0]! - 1e-4 &&
              vertex[0] <= bounds.maximum[0]! + 1e-4 &&
              vertex[2] >= bounds.minimum[2]! - 1e-4 &&
              vertex[2] <= bounds.maximum[2]! + 1e-4,
          ),
        )
      )
        continue
      pushLine(lines, terrainPosition(a), terrainPosition(b), [0.18, 0.1, 0.05, 1])
      cliffEdges += 1
      const color = [0.27, 0.16, 0.09, 1] as const
      pushTriangle(opaque, sideA0, sideA1, sideB1, color)
      pushTriangle(opaque, sideA0, sideB1, sideB0, color)
      terrainPickTriangles.push(...sideA0, ...sideA1, ...sideB1, ...sideA0, ...sideB1, ...sideB0)
      cliffTriangles += 2
    }
  }

  let gatewaySegments = 0
  for (const item of input.items.filter(item => item.facet === 'gateways')) {
    const start = item.uvwStart ?? { x: item.x1, y: 0, z: item.y1 }
    const end = item.uvwEnd ?? { x: item.x2, y: 0, z: item.y2 }
    const terrainElevation = (x: number, z: number) => {
      const match = terrain.find(candidate => {
        const position = terrainPosition(candidate)
        return position[0] === x && position[2] === z
      })
      return match === undefined ? 0 : terrainPosition(match)[1]
    }
    pushLine(
      lines,
      [start.x, terrainElevation(start.x, start.z) + 0.5, start.z],
      [end.x, terrainElevation(end.x, end.z) + 0.5, end.z],
      [0.12, 0.95, 0.9, 1],
    )
    gatewaySegments += 1
  }

  if (
    !finitePlan([
      opaque,
      lines,
      points,
      ...textured.values(),
      ...splat.values(),
      ...splatOverlays.values(),
      ...decals.values(),
    ])
  )
    throw new TypeError('world WebGL plan contains a non-finite coordinate')
  for (const item of [...textured.values(), ...decals.values()])
    if (!item.textureCoordinates.every(Number.isFinite))
      throw new TypeError('world WebGL plan contains a non-finite texture coordinate')
  for (const item of [...splat.values(), ...splatOverlays.values()]) {
    if (
      item.textureCoordinates.some(coordinates => !coordinates.every(Number.isFinite)) ||
      !item.textureWeights0.every(Number.isFinite) ||
      !item.textureWeights1.every(Number.isFinite) ||
      (item.weightTextureCoordinates !== undefined &&
        !item.weightTextureCoordinates.every(Number.isFinite))
    )
      throw new TypeError('world WebGL splat plan contains a non-finite texture value')
  }

  const minimum: [number, number, number] = [Infinity, Infinity, Infinity]
  const maximum: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  let hasPositions = false
  for (const item of [opaque, lines, points, ...textured.values(), ...splat.values()]) {
    if (item.positions.length > 0) hasPositions = true
    for (let offset = 0; offset < item.positions.length; offset += 3)
      for (const axis of [0, 1, 2] as const) {
        minimum[axis] = Math.min(minimum[axis], item.positions[offset + axis]!)
        maximum[axis] = Math.max(maximum[axis], item.positions[offset + axis]!)
      }
  }
  return {
    terrain,
    terrainByCell,
    liftedCliffPrimitives,
    minimum,
    maximum,
    hasPositions,
    opaqueTriangles: frozenBatch(opaque),
    texturedTriangles: Object.freeze([...textured.values()].map(frozenTexturedBatch)),
    splatTriangles: Object.freeze([...splat.values()].map(frozenSplatBatch)),
    splatOverlayTriangles: Object.freeze([...splatOverlays.values()].map(frozenSplatBatch)),
    // bottom to top: a stable sort keeps one depth's batches in the order the cells made them
    decalTriangles: Object.freeze(
      [...decals]
        .sort(([left], [right]) => decalDepths.get(left)! - decalDepths.get(right)!)
        .map(([, item]) => frozenTexturedBatch(item)),
    ),
    lines: frozenBatch(lines),
    points: frozenBatch(points),
    terrainTriangles: Float32Array.from(terrainPickTriangles),
    /**
     * What projectors land on: the terrain, and apart from it the floors of cliff pieces (a terrain
     * bake lies on the terrain at any depth, on the floors only inside its box).
     */
    projectorReceivers: Float32Array.from([...terrainPickTriangles, ...cliffGroundTriangles]),
    projectorCliffReceivers: Float32Array.from(cliffReceiverTriangles),
    terrainShadowCasters: Float32Array.from(cutShadowCasters),
    shadowCasterTriangles:
      (cutShadowCasters.length +
        opaque.positions.length +
        [...textured.values(), ...splat.values()].reduce(
          (sum, item) => sum + item.positions.length,
          0,
        )) /
      9,
    stats: {
      terrainTriangles,
      terrainTexturedTriangles,
      terrainSplatFallbackCells,
      terrainDecalTriangles,
      cliffEdges,
      cliffTriangles,
      gatewaySegments,
    },
  }
}

/**
 * The items of each facet, grouped in one pass: a plan takes its predecessor's grouping while its
 * list holds the same items, element by element (scanning all ~72 000 items once per facet took
 * several milliseconds of every plan). A unit entering the list keeps the terrain preparation (see
 * worldStaticItems), not the grouping.
 */
const worldPlanFacets = new WeakMap<WorldWebGlPlan, ReadonlyMap<string, readonly WorldSceneItem[]>>()

function worldFacetGroups(
  input: WorldWebGlInput,
  previousInput: WorldWebGlInput | undefined,
  previousPlan: WorldWebGlPlan | undefined,
): ReadonlyMap<string, readonly WorldSceneItem[]> {
  const previous = previousPlan === undefined ? undefined : worldPlanFacets.get(previousPlan)
  if (
    previous !== undefined &&
    previousInput !== undefined &&
    ((worldInputsCompared?.previous === previousInput && worldInputsCompared.input === input) ||
      sameArrayIdentity(previousInput.items, input.items))
  )
    return previous
  const grouped = new Map<string, WorldSceneItem[]>()
  for (const item of input.items) {
    const list = grouped.get(item.facet)
    if (list === undefined) grouped.set(item.facet, [item])
    else list.push(item)
  }
  return grouped
}

function worldFacetItems<F extends WorldSceneItem['facet']>(
  facets: ReadonlyMap<string, readonly WorldSceneItem[]>,
  facet: F,
): readonly Extract<WorldSceneItem, { facet: F }>[] {
  return (facets.get(facet) ?? []) as readonly Extract<WorldSceneItem, { facet: F }>[]
}

const worldStaticPreparations = new WeakMap<
  WorldWebGlPlan,
  {
    input: WorldWebGlInput
    preparation: ReturnType<typeof prepareWorldStaticTerrain>
    /** See worldModelGenerations. */
    models: number
  }
>()

/**
 * A plan's models generation: the previous plan's while every model result is the same object
 * (the input's map equals, entry by entry, the one the previous plan snapshot), a new number
 * otherwise. Plans of one generation read the same result for every resource id, so an object key
 * built in one of them holds in all of them (worldStaticObjectKey).
 */
let worldModelGenerations = 0

function appendFrozenWorldBatch(
  staticBatch: WorldWebGlBatch,
  dynamicBatch: WorldWebGlBatch,
): WorldWebGlBatch {
  if (dynamicBatch.positions.length === 0) return staticBatch
  if (staticBatch.positions.length === 0) return dynamicBatch
  const append = (left: Float32Array, right: Float32Array) => {
    const result = new Float32Array(left.length + right.length)
    result.set(left)
    result.set(right, left.length)
    return result
  }
  return Object.freeze({
    positions: append(staticBatch.positions, dynamicBatch.positions),
    normals: append(staticBatch.normals, dynamicBatch.normals),
    colors: append(staticBatch.colors, dynamicBatch.colors),
  })
}

function appendWorldBatch(
  staticBatch: WorldWebGlBatch,
  dynamicBatch: MutableBatch,
): WorldWebGlBatch {
  if (dynamicBatch.positions.length === 0) return staticBatch
  if (staticBatch.positions.length === 0) return frozenBatch(dynamicBatch)
  const append = (left: Float32Array, right: readonly number[]) => {
    const result = new Float32Array(left.length + right.length)
    result.set(left)
    result.set(right, left.length)
    return result
  }
  return Object.freeze({
    positions: append(staticBatch.positions, dynamicBatch.positions),
    normals: append(staticBatch.normals, dynamicBatch.normals),
    colors: append(staticBatch.colors, dynamicBatch.colors),
  })
}

/** Builds a renderer-ready, game-neutral 3D scene without requiring a browser or GPU. */
export function createWorldWebGlPlan(
  input: WorldWebGlInput,
  previousPlan?: WorldWebGlPlan,
  /**
   * The view the plan is drawn with (a renderer's): a kept object it cannot see in any pose keeps
   * the pose it has. Without it every kept object takes its pose at the plan's clock.
   */
  view?: WorldPosingView,
): WorldWebGlPlan {
  // Only the plan built right after the previous one takes its kept blocks (worldPlanSerials).
  const previousBuiltLast =
    previousPlan !== undefined && worldPlanSerials.get(previousPlan) === worldPlansBuilt
  worldPlansBuilt += 1
  // Shared batches: `opaque`, `transparent` and the maps' entries only describe a batch; its
  // triangles are the writes journaled to it (see WorldBatchWrite). Lines and points are built here.
  const opaque = batch()
  const modelMaterialScenes: WorldWebGlModelMaterialScene[] = []
  const modelEffects: WorldWebGlModelEffectInstance[] = []
  let modelMaterialShadowTriangles = 0
  const shadowControlledOpaque = new Map<string, WorldControlledBatch>()
  const transparent = batch()
  const lines = batch()
  const points = batch()
  const textured = new Map<string, MutableTexturedBatch>()
  const transparentTextured = new Map<string, WorldTransparentTexturedBatch>()
  /** Water that multiplies the ground under it, drawn after the terrain (see `multipliedWaterTriangles`). */
  const multipliedWater = new Map<string, MutableTexturedBatch>()
  const batchWrites = new Map<object, WorldBatchWrite[]>()
  const journal = (target: object, write: WorldBatchWrite) => {
    const writes = batchWrites.get(target)
    if (writes === undefined) batchWrites.set(target, [write])
    else writes.push(write)
  }
  const writesOf = (target: object): readonly WorldBatchWrite[] => batchWrites.get(target) ?? []
  const texturedTargets = () => [...textured.values(), ...transparentTextured.values()]
  const journalObjectWrite = (entry: WorldObjectBatchWrite) => {
    if (entry.collection === 'opaque') return journal(opaque, entry.write)
    if (entry.collection === 'transparent') return journal(transparent, entry.write)
    if (entry.collection === 'controlled') {
      const target = shadowControlledOpaque.get(entry.key) ?? entry.target
      shadowControlledOpaque.set(entry.key, target)
      return journal(target, entry.write)
    }
    if (entry.collection === 'textured') {
      const target = textured.get(entry.key) ?? entry.target
      textured.set(entry.key, target)
      return journal(target, entry.write)
    }
    const target = transparentTextured.get(entry.key) ?? entry.target
    transparentTextured.set(entry.key, target)
    return journal(target, entry.write)
  }
  const objectPickMeshes: WorldObjectPickMesh[] = []
  // Writes of the objects framed at rest: they move with the clock, so the plan bounds skip them.
  const clockWrites = new Set<WorldBatchWrite>()
  const planSamples = new Map<
    string,
    Readonly<{
      result: Extract<WorldSceneModelResult, { state: 'converted' }>
      primitives: readonly SceneRendererPrimitive[]
      nodeTransforms: ReadonlyMap<string, Float32Array>
    }>
  >()
  // Instances of one model at the same clock share the sampled (skinned) primitives, so their
  // prepared geometry and GPU buffers are shared too.
  const sampleSharedModel = (resourceId: string, item: WorldSceneObjectItem) => {
    const result = input.models?.get(resourceId)
    if (result?.state !== 'converted') return undefined
    const selected = worldModelAnimation(result, item)
    const camera = worldModelFacesCamera(result) ? worldModelCamera(input, item) : undefined
    const staticGeometry = camera === undefined && !worldModelHasAnimatedGeometry(result, item)
    const staticKey = selected?.id ?? ''
    const previousStatic = staticGeometry
      ? staticModelSamples.get(result)?.get(staticKey)
      : undefined
    if (previousStatic !== undefined) return previousStatic
    const time = worldModelSampleTime(input, item, selected)
    // instances turned alike see the camera alike
    const sharedKey =
      `${resourceId}\u0000${selected?.id ?? ''}\u0000${time}` +
      (camera === undefined ? '' : `\u0000${camera.rotation.join(',')}`)
    const shared = planSamples.get(sharedKey)
    if (shared !== undefined) return shared
    const clip = selected?.kind === 'animation' ? selected : undefined
    const sample =
      (result.nodes?.length ?? 0) === 0
        ? { primitives: result.primitives, nodeTransforms: new Map<string, Float32Array>() }
        : worldModelSceneSampler(result, clip).sample(time, undefined, camera)
    const current = {
      result,
      // A skin whose pose does not follow the clock is posed on the CPU once for every frame to
      // draw: posed on the GPU, it would be posed again by every draw of every frame.
      primitives:
        staticGeometry && sample.primitives.some(primitive => materialSkinOf(primitive))
          ? Object.freeze(sample.primitives.map(worldPosedPrimitive))
          : sample.primitives,
      nodeTransforms: sample.nodeTransforms,
    }
    planSamples.set(sharedKey, current)
    if (staticGeometry) {
      let samples = staticModelSamples.get(result)
      if (samples === undefined) staticModelSamples.set(result, (samples = new Map()))
      samples.set(staticKey, current)
    }
    return current
  }
  const previous =
    previousPlan === undefined ? undefined : worldStaticPreparations.get(previousPlan)
  const models =
    previous !== undefined && sameWorldMap(previous.input.models, input.models)
      ? previous.models
      : ++worldModelGenerations
  const preparation =
    previous !== undefined && sameWorldStaticInput(previous.input, input)
      ? previous.preparation
      : prepareWorldStaticTerrain(input, (resourceId, item) =>
          worldPosedSample(sampleSharedModel(resourceId, item)),
        )
  const { terrain, liftedCliffPrimitives } = preparation
  const facets = worldFacetGroups(input, previous?.input, previousPlan)
  const timeSeconds = input.timeSeconds ?? 0
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0)
    throw new TypeError('world WebGL timeSeconds must be finite and nonnegative')
  let waterPolygons = 0
  const waterPlaneBatches = new Map<
    string,
    {
      readonly batch: MutableBatch
      readonly colorFalloff: number
      readonly receiveShadows: boolean
      readonly caustics?: WorldWebGlWaterCaustics
      readonly waves?: WorldWebGlWaterWaves
    }
  >()
  for (const item of worldFacetItems(facets, 'water')) {
    const minimum = item.uvwMinimum ?? { x: item.minimum.x, z: item.minimum.y }
    const maximum = item.uvwMaximum ?? { x: item.maximum.x, z: item.maximum.y }
    const elevation = item.uvwElevation ?? item.elevation
    if (elevation === undefined) continue
    const material = input.waterMaterials?.find(
      candidate => candidate.materialId === item.materialId,
    )
    const texture =
      material?.baseColorResourceId === undefined
        ? undefined
        : input.terrainTextures?.get(material.baseColorResourceId)
    const secondaryTexture =
      texture === undefined
        ? undefined
        : material?.secondaryColorResourceId === undefined
          ? texture
          : input.terrainTextures?.get(material.secondaryColorResourceId)
    const detail = texture === undefined ? undefined : waterDetailOf(material, input.terrainTextures)
    const texturedTarget =
      material === undefined || texture === undefined
        ? undefined
        : material.compositing === 'multiply'
          ? (() => {
              const key = `water\u0000${material.materialId}\u0000${texture.id}\u0000${secondaryTexture?.id ?? ''}`
              const current = multipliedWater.get(key) ?? {
                ...batch(),
                textureCoordinates: [],
                ...(secondaryTexture === undefined ? {} : { secondaryTextureCoordinates: [] }),
                texture,
                ...(secondaryTexture === undefined ? {} : { secondaryTexture }),
              }
              multipliedWater.set(key, current)
              return current
            })()
        : (() => {
            const key = `water\u0000${material.materialId}\u0000${texture.id}\u0000${secondaryTexture?.id ?? ''}\u0000${detail === undefined ? '' : detail.normals.map(item => item.id).join(',')}`
            const previous = transparentTextured.get(key)
            if (previous !== undefined) return previous
            const current = {
              ...batch(),
              textureCoordinates: [],
              ...(secondaryTexture === undefined ? {} : { secondaryTextureCoordinates: [] }),
              texture,
              ...(secondaryTexture === undefined ? {} : { secondaryTexture }),
              ...(detail === undefined ? {} : { waterDetail: detail }),
              blendMode: 'blend' as const,
              receiveShadows: material.receiveShadows ?? false,
            }
            transparentTextured.set(key, current)
            return current
          })()
    const zone = worldWaterZone(
      preparation,
      material,
      texture,
      secondaryTexture,
      minimum,
      maximum,
      elevation,
      timeSeconds,
      detail,
    )
    if (zone.plane !== undefined) {
      const key = material?.materialId ?? ''
      const caustics = waterCausticsOf(material, input.terrainTextures)
      const waves = waterWavesOf(material, input.terrainTextures)
      const plane = waterPlaneBatches.get(key) ?? {
        batch: batch(),
        colorFalloff: material?.colorFalloff ?? WATER_COLOR_FALLOFF,
        receiveShadows: material?.receiveShadows ?? false,
        ...(caustics === undefined ? {} : { caustics }),
        ...(waves === undefined ? {} : { waves }),
      }
      waterPlaneBatches.set(key, plane)
      journal(plane, zone.plane)
    }
    journal(texturedTarget ?? transparent, zone.triangles)
    if (!zone.emitted && material?.shorelineMode === 'terrain-clipped') continue
    waterPolygons += 1
  }
  // Nothing but water has entered the untextured transparent batch yet.
  const transparentWaterTriangles =
    writesOf(transparent).reduce((sum, write) => sum + write.positions.length, 0) / 9

  // Capture before models append their transparent geometry: particles must not become AO surfaces.
  const previousBatches =
    previousPlan === undefined ? undefined : worldPlanBatches.get(previousPlan)
  const waterWrites = [transparent, ...transparentTextured.values(), ...multipliedWater.values()].flatMap(
    writesOf,
  )
  const waterSurfaceDepth =
    previousBatches !== undefined && sameWrites(previousBatches.water, waterWrites)
      ? previousBatches.waterSurfaceDepth
      : worldWaterSurfaceDepth(waterWrites)

  const objects = worldFacetItems(facets, 'objects')
  const projectorGround = preparation.projectorReceivers
  const projectorCliffs = preparation.projectorCliffReceivers
  let modelTriangles = 0
  let diagnosticPlaceholders = 0
  let programObjects = 0,
    fallbackObjects = 0,
    keptObjects = 0
  const planPrograms: WorldPlanPrograms = new Map()
  const currentPrograms: WorldCurrentPrograms = {
    passes: new Map(),
    materials: new Map(),
    cohorts: new Map(),
    skins: new Map(),
    transforms: new Map(),
  }
  const resampled: WorldResampled = new Map()
  // Kept objects the view cannot see in any pose (WorldPosingView) keep the pose they have, their
  // spheres noted for the renderer to make the plan again once a view sees one.
  const unposed: number[] = []
  const unseen =
    view === undefined
      ? undefined
      : (item: WorldSceneObjectItem, pose: WorldKeptPose): boolean => {
          const sphere = worldKeptPoseSphere(item, pose)
          if (sphere === undefined || !worldSphereUnseen(view, sphere)) return false
          unposed.push(sphere[0]!, sphere[1]!, sphere[2]!, sphere[3]!)
          return true
        }
  // Projector decals batch by splat layer, blend and texture: a layer draws as one part of the ground.
  // An additive decal (Purifier_City_Decals: orange lines on black) adds its colour; blended over the
  // ground, its opaque black texels painted a black slab across Old Sun Temple's ramp.
  const projectorBatchKey = (
    texture: MutableTexturedBatch['texture'],
    layer: number | undefined,
    blendMode: 'blend' | 'additive',
    normal: WorldProjectorNormal | undefined,
  ) =>
    `projector:${layer ?? ''}:${blendMode === 'additive' ? 'add:' : ''}${texture.id}` +
    (normal === undefined ? '' : `|normal:${normal.swizzle}:${normal.texture.id}`)
  const projectorBatch = (
    texture: MutableTexturedBatch['texture'],
    layer: number | undefined,
    blendMode: 'blend' | 'additive',
    normal: WorldProjectorNormal | undefined,
  ) => {
    const key = projectorBatchKey(texture, layer, blendMode, normal)
    const target = transparentTextured.get(key) ?? {
      ...batch(),
      textureCoordinates: [],
      texture,
      blendMode,
      castShadows: false,
      receiveShadows: false,
      ...(layer === undefined ? {} : { splatLayer: layer }),
      ...(normal === undefined
        ? {}
        : { normalTexture: normal.texture, normalSwizzle: normal.swizzle }),
    }
    transparentTextured.set(key, target)
    return target
  }
  // The previous plan's kept blocks stand for their objects while every input of the objects' keys
  // but the clock is the same (worldStaticObjectKey): the models, the terrain preparation, the team
  // colours and the selection; and the objects that play at a time of their own, which sample their
  // materials apart from their cohort (keptWorldObjectScenes).
  const replayBlocks =
    previousBuiltLast &&
    previous !== undefined &&
    models === previous.models &&
    preparation === previous.preparation &&
    input.selectedObjectId === previous.input.selectedObjectId &&
    sameWorldMap(previous.input.teamColors, input.teamColors) &&
    sameMapKeys(previous.input.animationTimes, input.animationTimes)
      ? worldKeptBlocks.get(previousPlan!)
      : undefined
  const keptBlocks: (WorldKeptBlock | undefined)[] = []
  /** The pick meshes of each block taken whole: its first index and one past its last. */
  const keptSegments: {
    readonly first: number
    readonly end: number
    readonly block: WorldKeptBlock
  }[] = []
  /** The block being made object by object, and which of its objects it could stand for. */
  let block:
    | {
        readonly start: number
        readonly length: number
        readonly items: WorldSceneObjectItem[]
        readonly records: WorldStaticObject[]
        readonly scenes: number
        readonly pickMeshes: number
      }
    | undefined
  // A block whose every object took the kept path whole is handed to the next plan.
  const finishKeptBlock = () => {
    if (block === undefined || block.records.length !== block.length) return
    const { start, items, records, scenes, pickMeshes: firstMesh } = block
    const effects: WorldKeptBlock['effects'][number][] = []
    const writes: WorldObjectBatchWrite[] = []
    const samples: WorldKeptBlock['samples'][number][] = []
    const poses: WorldKeptBlock['poses'][number][] = []
    const restWrites: WorldBatchWrite[] = []
    let triangles = 0,
      shadowed = 0,
      byProgram = 0,
      byFallback = 0
    records.forEach((record, offset) => {
      const item = items[offset]!
      record.effects.forEach((effect, index) =>
        effects.push(Object.freeze({ item, effect, resourceId: record.effectResources[index]! })),
      )
      for (const write of record.batchWrites) writes.push(write)
      if (record.pose !== undefined) poses.push(Object.freeze({ offset, item, kept: record }))
      if (record.atRest === true)
        for (const entry of record.batchWrites) restWrites.push(entry.write)
      if (record.resamplers !== undefined) {
        const cohort =
          record.cohort !== undefined && input.animationTimes?.has(item.objectId) !== true
            ? record.cohort
            : undefined
        if (cohort === undefined || !samples.some(entry => entry.cohort === cohort))
          samples.push(Object.freeze({ cohort, item, kept: record }))
      }
      triangles += record.modelTriangles
      shadowed += record.shadowTriangles
      if (record.byProgram) byProgram += 1
      if (record.byFallback) byFallback += 1
    })
    const pickMeshes = objectPickMeshes.slice(firstMesh)
    let envelope: number[] | null = null
    let finite = true
    for (const mesh of pickMeshes) {
      const box = mesh.envelope
      if (box === null) continue
      if (!Number.isFinite(box[3]! - box[0]! + box[4]! - box[1]! + box[5]! - box[2]!))
        finite = false
      if (envelope === null) envelope = [...box]
      else
        for (let axis = 0; axis < 3; axis += 1) {
          envelope[axis] = Math.min(envelope[axis]!, box[axis]!)
          envelope[axis + 3] = Math.max(envelope[axis + 3]!, box[axis + 3]!)
        }
    }
    keptBlocks[start / WORLD_KEPT_BLOCK] = Object.freeze({
      items: Object.freeze(items),
      scenes: Object.freeze(modelMaterialScenes.slice(scenes)),
      effects: Object.freeze(effects),
      batchWrites: Object.freeze(writes),
      pickMeshes: Object.freeze(pickMeshes),
      envelope: envelope === null ? null : Object.freeze(envelope),
      finite,
      samples: Object.freeze(samples),
      poses: Object.freeze(poses),
      clockWrites: Object.freeze(restWrites),
      modelTriangles: triangles,
      shadowTriangles: shadowed,
      programObjects: byProgram,
      fallbackObjects: byFallback,
    })
  }
  // The previous plan's block at `start`, taken whole when it holds the same objects and each of them
  // keeps its scenes at this clock: what each of its objects would add, in the same order. Its
  // objects decide as each would (keptWorldObjectScenes), but the plan's programs take what they
  // decided only once all of them keep: a block not taken leaves the plan as it was, to be made
  // object by object. Returns how many objects it took.
  const takeKeptBlock = (start: number): number => {
    const kept = replayBlocks?.[start / WORLD_KEPT_BLOCK]
    if (kept === undefined) return 0
    const { items } = kept
    if (items.length !== Math.min(WORLD_KEPT_BLOCK, objects.length - start)) return 0
    for (let offset = 0; offset < items.length; offset += 1)
      if (objects[start + offset] !== items[offset]) return 0
    const pending: [SceneMaterialPrograms, SceneMaterialPrograms][] = []
    const decided = new Map<string, true>()
    for (const { cohort, item, kept: deciding } of kept.samples) {
      if (cohort !== undefined) {
        const keeps = decided.get(cohort) ?? currentPrograms.cohorts.get(cohort)
        if (keeps === false) return 0
        if (keeps !== undefined) continue
      }
      const scenes = keptWorldObjectResampledScenes(
        item,
        deciding,
        deciding.resamplers!,
        input,
        planPrograms,
        currentPrograms,
        pending,
      )
      if (scenes === undefined) return 0
      if (cohort !== undefined) decided.set(cohort, true)
    }
    // Its objects whose models move: posed at this clock, or the block is not taken.
    const skinPairs: [ModelSceneSkin, ModelSceneSkin][] = []
    let meshes = kept.pickMeshes
    if (kept.poses.length > 0) {
      const posed = [...kept.pickMeshes]
      for (const { offset, item, kept: record } of kept.poses) {
        const mesh = keptWorldObjectPose(
          item,
          record,
          record.pose!,
          input,
          sampleSharedModel,
          resampled,
          currentPrograms,
          skinPairs,
          unseen,
        )
        if (mesh === undefined) return 0
        posed[offset] = mesh
      }
      meshes = posed
    }
    standForPrograms(currentPrograms, pending)
    standForSkins(currentPrograms, skinPairs)
    for (const { kept: record } of kept.poses) standForPlacements(currentPrograms, record.pose)
    for (const cohort of decided.keys()) currentPrograms.cohorts.set(cohort, true)
    for (const scene of kept.scenes) modelMaterialScenes.push(scene)
    for (const { item, effect, resourceId } of kept.effects)
      modelEffects.push(keptWorldObjectEffect(item, effect, resourceId, input))
    for (const entry of kept.batchWrites) journalObjectWrite(entry)
    for (const write of kept.clockWrites) clockWrites.add(write)
    const firstMesh = objectPickMeshes.length
    for (const mesh of meshes) objectPickMeshes.push(mesh)
    keptSegments.push({ first: firstMesh, end: objectPickMeshes.length, block: kept })
    modelTriangles += kept.modelTriangles
    modelMaterialShadowTriangles += kept.shadowTriangles
    keptObjects += items.length
    programObjects += kept.programObjects
    fallbackObjects += kept.fallbackObjects
    keptBlocks[start / WORLD_KEPT_BLOCK] = kept
    return items.length
  }
  for (let index = 0; index < objects.length; index += 1) {
    if (index % WORLD_KEPT_BLOCK === 0) {
      finishKeptBlock()
      block = undefined
      const taken = takeKeptBlock(index)
      if (taken > 0) {
        index += taken - 1
        continue
      }
      block = {
        start: index,
        length: Math.min(WORLD_KEPT_BLOCK, objects.length - index),
        items: [],
        records: [],
        scenes: modelMaterialScenes.length,
        pickMeshes: objectPickMeshes.length,
      }
    }
    const item = objects[index]!
    const staticKey = worldStaticObjectKey(item, input, preparation, models)
    const retainedAsBuilt = staticKey === undefined ? undefined : retainedStaticObjects.get(item)
    // An object moved in place since keeps its scenes, placed anew (movedWorldObject).
    const retainedObject =
      retainedAsBuilt?.pose?.placing === undefined ||
      !sameWorldStaticObjectKey(retainedAsBuilt.key, staticKey!)
        ? retainedAsBuilt
        : (movedWorldObject(item, retainedAsBuilt, input) ?? retainedAsBuilt)
    // An object whose models move its geometry takes their poses at this clock with its scenes.
    const posePairs: [ModelSceneSkin, ModelSceneSkin][] | undefined =
      retainedObject?.pose === undefined ? undefined : []
    const keptPickMesh =
      retainedObject === undefined || !sameWorldStaticObjectKey(retainedObject.key, staticKey!)
        ? undefined
        : retainedObject.pose === undefined
          ? retainedObject.pickMesh
          : keptWorldObjectPose(
              item,
              retainedObject,
              retainedObject.pose,
              input,
              sampleSharedModel,
              resampled,
              currentPrograms,
              posePairs!,
              unseen,
            )
    const keptScenes =
      keptPickMesh === undefined
        ? undefined
        : keptWorldObjectScenes(item, retainedObject!, input, planPrograms, currentPrograms)
    if (retainedObject !== undefined && keptScenes !== undefined) {
      if (posePairs !== undefined) standForSkins(currentPrograms, posePairs)
      standForPlacements(currentPrograms, retainedObject.pose)
      if (retainedObject !== retainedAsBuilt) retainedStaticObjects.set(item, retainedObject)
      // Kept by the key it was retained with: its block can stand for it in the next plan.
      if (block !== undefined && retainedObject.key === staticKey) {
        block.items.push(item)
        block.records.push(retainedObject)
      }
      for (const scene of keptScenes) modelMaterialScenes.push(scene)
      for (const [index, effect] of retainedObject.effects.entries())
        modelEffects.push(
          keptWorldObjectEffect(item, effect, retainedObject.effectResources[index]!, input),
        )
      for (const entry of retainedObject.batchWrites) journalObjectWrite(entry)
      if (retainedObject.atRest === true)
        for (const entry of retainedObject.batchWrites) clockWrites.add(entry.write)
      objectPickMeshes.push(keptPickMesh!)
      modelTriangles += retainedObject.modelTriangles
      modelMaterialShadowTriangles += retainedObject.shadowTriangles
      keptObjects += 1
      if (retainedObject.byProgram) programObjects += 1
      if (retainedObject.byFallback) fallbackObjects += 1
      continue
    }
    const scenesBefore = modelMaterialScenes.length
    const sceneResamplers = new Map<WorldWebGlModelMaterialScene, WorldSceneResampler>()
    // Per resampled scene, what its programs at another moment depend on (see WorldStaticObject.cohort).
    const sceneCohortTerms = new Map<WorldWebGlModelMaterialScene, string>()
    const effectsBefore = modelEffects.length
    const effectResources: string[] = []
    const objectBatchWrites: WorldObjectBatchWrite[] = []
    const previousProjectorWrites = lastProjectorWrites.get(item)
    const projectorWrites: { readonly key: string; readonly write: WorldBatchWrite }[] = []
    const trianglesBefore = modelTriangles
    const shadowTrianglesBefore = modelMaterialShadowTriangles
    // Cleared by anything that writes into the plan's shared batches instead of its own scenes.
    let retainable = staticKey !== undefined
    const translation = objectPosition(item, input)
    const pickTriangles: number[] = []
    const pickPrimitives: WorldWebGlPickPrimitive[] = []
    const { components, keyed } = worldObjectResourcesOf(item)
    // What an object whose key leaves out its models' clock was built from (WorldStaticObject.pose).
    const posed =
      staticKey !== undefined &&
      keyed.some(resourceId => {
        const result = input.models?.get(resourceId)
        return result?.state === 'converted' && worldModelPosedByClock(result, item)
      })
    const poseModels: WorldKeptPose['models'][number][] | undefined = posed ? [] : undefined
    const posePicks: WorldKeptPose['picks'][number][] | undefined = posed ? [] : undefined
    const samples = new Map<
      string,
      Readonly<{
        result: Extract<WorldSceneModelResult, { state: 'converted' }>
        primitives: readonly SceneRendererPrimitive[]
        nodeTransforms: ReadonlyMap<string, Float32Array>
      }>
    >()
    const sampleFor = (resourceId: string) => {
      const previous = samples.get(resourceId)
      if (previous !== undefined) return previous
      // A cliff piece is lifted onto the ground on the CPU (liftedCliffPrimitives): posed there.
      const current =
        item.derivedFrom === 'cliffs'
          ? worldPosedSample(sampleSharedModel(resourceId, item))
          : sampleSharedModel(resourceId, item)
      if (current !== undefined) samples.set(resourceId, current)
      return current
    }
    const componentTransforms = worldComponentTransforms(components, sampleFor)
    // An object whose models move their geometry frames the plan by its models at rest.
    const restTransforms = components.some(component => {
      const result = input.models?.get(component.resourceId)
      return result?.state === 'converted' && worldModelHasAnimatedGeometry(result, item)
    })
      ? worldComponentTransforms(components, resourceId => {
          const result = input.models?.get(resourceId)
          return result?.state === 'converted' ? restWorldModelSample(result) : undefined
        })
      : undefined
    const restPrimitives: WorldWebGlPickPrimitive[] = []
    // What the placement enters (WorldKeptPose.placing), while nothing but those depends on it.
    let placeable =
      item.derivedFrom !== 'cliffs' && !((item.presentationFoundationStretch ?? 0) > 0)
    const placingScenes: WorldKeptPlacing['scenes'][number][] = []
    const placingEffects: Float32Array[] = []
    const placingPicks: WorldKeptPlacing['picks'][number][] = []
    const placingRest: NonNullable<WorldKeptPlacing['rest']>[number][] = []
    let rendered = false
    let resolved = false
    let byProgram = false,
      byFallback = false
    for (const component of components) {
      const sampled = sampleFor(component.resourceId)
      if (sampled === undefined) continue
      const { result } = sampled
      const componentTransform = componentTransforms.get(component.id)
      // A child whose parent model is not loaded cannot be placed: it resolves nothing, so the object
      // keeps its placeholder instead of vanishing.
      if (componentTransform === undefined) continue
      resolved = true
      // The model's sample, when it moves the object's geometry, for the kept object to follow it.
      let poseModel = -1
      if (poseModels !== undefined && worldModelHasAnimatedGeometry(result, item)) {
        poseModel = poseModels.findIndex(model => model.resourceId === component.resourceId)
        if (poseModel < 0) {
          const animation = worldModelAnimation(result, item)
          poseModel =
            poseModels.push(
              Object.freeze({
                resourceId: component.resourceId,
                animation,
                time: worldModelSampleTime(input, item, animation),
                sample: sampled,
              }),
            ) - 1
        }
      }
      // Cliff meshes follow the painted base height (see `baseOffsetAt`).
      const primitives: typeof sampled.primitives =
        item.derivedFrom === 'cliffs'
          ? (liftedCliffPrimitives(
              sampled.primitives,
              multiplyComponentTransforms(
                worldObjectTransform(item, translation),
                componentTransform,
              ),
            ) as typeof sampled.primitives)
          : sampled.primitives
      const moment = worldObjectMaterialMoment(input, item, result)
      const { selectedAnimation, time, materialContext } = moment
      const templateKey = worldObjectProgramTemplateKey(item, component.resourceId, moment)
      const { presented, scene, programs } = worldObjectModelPrograms(
        result,
        item,
        templateKey,
        time,
        () => materialContext,
        planPrograms,
      )
      const materialsFollowTime = worldMaterialsFollowTime(result)
      const objectTint = worldObjectTint(item, input.selectedObjectId)
      const materialPrimitives: SceneRendererPrimitive[] = []
      // each material primitive's own transform, under the component's
      const ownTransforms: (Float32Array | undefined)[] = []
      const materialShadowPrimitives: SceneRendererPrimitive[] = []
      const shadowlessMaterials = new Set<string>()
      const instanceTransform = multiplyComponentTransforms(
        worldObjectTransform(item, translation),
        componentTransform,
      )
      const restTransform = restTransforms?.get(component.id)
      if (restTransform !== undefined) {
        restPrimitives.push(
          ...worldRestPickPrimitivesOf(
            item,
            component.id,
            result,
            programs,
            multiplyComponentTransforms(worldObjectTransform(item, translation), restTransform),
          ),
        )
        placingRest.push(
          Object.freeze({ id: component.id, result, programs, transform: restTransform }),
        )
      }
      let primitiveIndex = -1
      for (const sampledPrimitive of primitives) {
        primitiveIndex += 1
        const drawn = foundationStretched(
          sampledPrimitive,
          componentTransform,
          instanceTransform,
          item.presentationFoundationStretch,
        )
        const prepared = programs.get(drawn.materialId ?? '')
        // Only the shared path draws a skin posed on the GPU; the fallback writes its triangles.
        const primitive: typeof drawn = prepared === undefined ? worldPosedPrimitive(drawn) : drawn
        const material = modelMaterialById(presented, primitive.materialId)
        const shadowPolicy = modelMaterialShadowPolicy(material)
        // A prepared material without color passes (distortion, terrain projection) draws nothing;
        // only an unprepared material takes the textured fallback below.
        if (prepared !== undefined && prepared.passes.length === 0) continue
        const sharedMaterial = prepared !== undefined
        const castsSharedMaterialShadow =
          sharedMaterial && shadowPolicy.castShadows && prepared.passes.some(materialIsSolid)
        if (sharedMaterial) {
          const primitiveTransform = 'transform' in primitive ? primitive.transform : undefined
          const instancePrimitive = Object.freeze({
            ...worldUvSetPrimitive(primitive, scene.uvSets.get(primitive.materialId ?? '')),
            transform: multiplyComponentTransforms(
              instanceTransform,
              primitiveTransform ?? IDENTITY_COMPONENT_TRANSFORM,
            ),
            ...(objectTint === undefined ? {} : { tint: objectTint }),
          })
          materialPrimitives.push(instancePrimitive)
          ownTransforms.push(primitiveTransform)
          if (castsSharedMaterialShadow) materialShadowPrimitives.push(instancePrimitive)
          if (!shadowPolicy.receiveShadows && primitive.materialId !== undefined)
            shadowlessMaterials.add(primitive.materialId)
          const count = primitiveTriangleCount(primitive)
          if (count > 0) {
            const slot = `${component.id}\u0000${String(primitiveIndex)}`
            pickPrimitives.push(sharedPickPrimitive(primitive, instancePrimitive, item, slot))
            placingPicks.push(
              Object.freeze({
                source: primitive,
                scene: placingScenes.length,
                index: materialPrimitives.length - 1,
                slot,
              }),
            )
            posePicks?.push(
              poseModel >= 0 && materialSkinOf(primitive) !== undefined
                ? Object.freeze({
                    model: poseModel,
                    index: primitiveIndex,
                    instance: instancePrimitive,
                    slot,
                  })
                : undefined,
            )
            if (castsSharedMaterialShadow) modelMaterialShadowTriangles += count
            modelTriangles += count
            rendered = true
            byProgram = true
          }
          continue
        }
        // The fallback writes shared batches; the writes are kept with the object (see WorldBatchWrite).
        const layer = material?.layers?.find(candidate =>
          BASE_COLOR_SLOTS.has(materialSlot(candidate.slot)),
        )
        const normalLayer = material?.layers?.find(candidate =>
          NORMAL_SLOTS.has(materialSlot(candidate.slot)),
        )
        const texture =
          layer?.resourceId === undefined
            ? undefined
            : result.textures?.find(candidate => candidate.id === layer.resourceId)
        const requestedUv = layer?.uvSource ?? 0
        const team = worldBatchTeamColor(
          material,
          result.textures,
          requestedUv,
          moment.teamColor,
          materialContext.teamColorIntensity,
          item.presentationTint,
          item.player === undefined ? undefined : input.teamRamps?.get(item.player),
        )
        const coverage = modelMaterialCoverage(material)
        const blendMode =
          coverage.mode !== 'blend'
            ? undefined
            : // the world's adding blend is SrcAlpha, One: add-alpha's (UV_game_material)
              material?.blendMode === 'additive' || material?.blendMode === 'add-alpha'
              ? ('additive' as const)
              : ('blend' as const)
        const normalTexture =
          normalLayer?.resourceId === undefined || (normalLayer.uvSource ?? 0) !== requestedUv
            ? undefined
            : result.textures?.find(candidate => candidate.id === normalLayer.resourceId)
        const textureCoordinates =
          primitive.textureCoordinateSets?.find(candidate => candidate.set === requestedUv)
            ?.coordinates ?? (requestedUv === 0 ? primitive.textureCoordinates : undefined)
        // As glTF: baseColorFactor × COLOR_0 × the object's tint (× the texture, in the shader). A
        // primitive with none of factor, texture and COLOR_0 keeps a stand-in hue per material.
        const factor: WorldColor =
          material?.baseColorFactor ??
          (texture === undefined && primitive.colors === undefined
            ? colorHash(primitive.materialId ?? item.kind)
            : [1, 1, 1, 1])
        const unlit = material?.unlit === true
        const priority = blendMode === undefined ? 0 : (material?.priority ?? 0)
        // an object-tint team colour takes the tint: it does not tint the material again
        const tint = team?.objectTint === true ? [1, 1, 1] : (item.presentationTint ?? [1, 1, 1])
        // without a texture to weigh, a `whole` team colour is the colour itself
        const albedo: WorldColor =
          team !== undefined && team.mask === undefined && texture === undefined
            ? [
                ...([0, 1, 2].map(channel =>
                  teamColorChannel(
                    factor[channel]!,
                    1,
                    team.color[channel]!,
                    TEAM_COLOR_BLENDS[team.blend]!,
                    team.strength,
                  ),
                ) as [number, number, number]),
                factor[3],
              ]
            : factor
        const base: WorldColor = [
          albedo[0] * tint[0],
          albedo[1] * tint[1],
          albedo[2] * tint[2],
          albedo[3],
        ]
        const vertexColors = primitive.colors
        const colorAt = (index: number): WorldColor =>
          vertexColors === undefined || vertexColors.length < (index + 1) * 4
            ? base
            : [
                base[0] * vertexColors[index * 4]!,
                base[1] * vertexColors[index * 4 + 1]!,
                base[2] * vertexColors[index * 4 + 2]!,
                base[3] * vertexColors[index * 4 + 3]!,
              ]
        const selectedColor =
          item.objectId === input.selectedObjectId ? ([1, 0.82, 0.12, 1] as const) : undefined
        const triangleColor = (triangle: readonly number[]): TriangleColor =>
          selectedColor ??
          (vertexColors === undefined
            ? base
            : [colorAt(triangle[0]!), colorAt(triangle[1]!), colorAt(triangle[2]!)])
        // Every triangle of the primitive writes the same batch: find or add it at the first one.
        let written: WorldObjectBatchWrite | undefined
        let texturedWrite: MutableTexturedBatch | undefined
        let plainWrite: MutableBatch | undefined
        for (const triangle of primitiveTriangles(primitive)) {
          const vertices = triangle.map(index =>
            instanceVertex(
              transformedComponentVertex(
                transformedPrimitiveVertex(primitive, index),
                componentTransform,
              ),
              item,
              translation,
            ),
          ) as unknown as readonly [
            readonly [number, number, number],
            readonly [number, number, number],
            readonly [number, number, number],
          ]
          if (
            texture !== undefined &&
            textureCoordinates !== undefined &&
            textureCoordinates.length >= (primitive.positions.length / 3) * 2
          ) {
            if (texturedWrite === undefined) {
              const teamKey = worldTeamKey(team)
              const key = `${result.sourceKey}\u0000${texture.id}\u0000${normalTexture?.id ?? ''}\u0000${blendMode ?? 'opaque'}\u0000${String(coverage.cutoff)}\u0000${String(shadowPolicy.castShadows)}\u0000${String(shadowPolicy.receiveShadows)}\u0000${String(unlit)}\u0000${String(priority)}\u0000${teamKey}`
              const collection = blendMode === undefined ? textured : transparentTextured
              const target = collection.get(key) ?? {
                ...batch(),
                textureCoordinates: [],
                texture,
                ...(normalTexture === undefined ? {} : { normalTexture }),
                ...(blendMode === undefined ? {} : { blendMode }),
                castShadows: shadowPolicy.castShadows,
                receiveShadows: shadowPolicy.receiveShadows,
                ...(coverage.cutoff === 0 ? {} : { alphaCutoff: coverage.cutoff }),
                ...(unlit ? { unlit } : {}),
                ...(priority === 0 ? {} : { priority }),
                ...(team === undefined ? {} : { team }),
              }
              collection.set(key, target as WorldTransparentTexturedBatch)
              texturedWrite = { ...batch(), textureCoordinates: [], texture }
              written =
                blendMode === undefined
                  ? { collection: 'textured', key, target, write: texturedWrite }
                  : {
                      collection: 'transparentTextured',
                      key,
                      target: target as WorldTransparentTexturedBatch,
                      write: texturedWrite,
                    }
            }
            pushTexturedTriangle(
              texturedWrite,
              vertices,
              triangle.map(index => [
                textureCoordinates[index * 2] ?? 0,
                textureCoordinates[index * 2 + 1] ?? 0,
              ]) as unknown as readonly [
                readonly [number, number],
                readonly [number, number],
                readonly [number, number],
              ],
              triangleColor(triangle),
            )
          } else if (blendMode !== undefined) {
            // a see-through material without a texture (a Roblox part of transparency 0.75) blends
            // its vertex alpha, as a textured one does
            if (plainWrite === undefined) {
              plainWrite = batch()
              written = { collection: 'transparent', write: plainWrite }
            }
            pushTriangle(plainWrite, vertices[0], vertices[1], vertices[2], triangleColor(triangle))
          } else if (shadowPolicy.castShadows && shadowPolicy.receiveShadows) {
            if (plainWrite === undefined) {
              plainWrite = batch()
              written = { collection: 'opaque', write: plainWrite }
            }
            pushTriangle(plainWrite, vertices[0], vertices[1], vertices[2], triangleColor(triangle))
          } else {
            if (plainWrite === undefined) {
              const key = `${String(shadowPolicy.castShadows)}:${String(shadowPolicy.receiveShadows)}`
              const target = shadowControlledOpaque.get(key) ?? {
                ...batch(),
                castShadows: shadowPolicy.castShadows,
                receiveShadows: shadowPolicy.receiveShadows,
              }
              shadowControlledOpaque.set(key, target)
              plainWrite = batch()
              written = { collection: 'controlled', key, target, write: plainWrite }
            }
            pushTriangle(plainWrite, vertices[0], vertices[1], vertices[2], triangleColor(triangle))
          }
          for (const vertex of vertices) pickTriangles.push(vertex[0], vertex[1], vertex[2])
          modelTriangles += 1
          rendered = true
          byFallback = true
        }
        if (written !== undefined) {
          journalObjectWrite(written)
          objectBatchWrites.push(written)
        }
      }
      const effectSource =
        result.uvmBytes === undefined
          ? undefined
          : uvmEffectSource(result.uvmBytes, selectedAnimation?.sequenceIndex)
      if (effectSource?.hasProjectors && scene.materials.length > 0) {
        // the projection follows the placement
        placeable = false
        const receiverTransform = Float32Array.from(
          invertMaterialFrame(Array.from(instanceTransform)),
        )
        const still = !effectSource.projectionsFollowTime
        let projections = worldObjectProjections.get(item)
        const kept = still ? projections?.get(component.id) : undefined
        const reuse =
          kept !== undefined &&
          kept.source === effectSource &&
          kept.materials === scene.materials &&
          kept.ground === projectorGround &&
          sameOptionalMatrix(kept.transform, receiverTransform)
        const slot = worldProjectorSlot(item, component.id)
        const projected = reuse
          ? kept.projected
          : worldObjectProjection(() =>
              effectSource.project(
                time,
                scene.materials,
                [
                  {
                    id: TERRAIN_RECEIVER_ID,
                    topology: 'triangles',
                    positions: projectorGround,
                    transform: receiverTransform,
                  },
                  ...(projectorCliffs.length === 0
                    ? []
                    : [
                        {
                          id: 'world-cliff-floor-receiver',
                          topology: 'triangles' as const,
                          positions: projectorCliffs,
                          transform: receiverTransform,
                        },
                      ]),
                ],
                slot.frames,
              ),
            )
        let projectedPrograms: ReadonlyMap<string, SceneMaterialPrograms> = new Map()
        if (reuse && kept.programs !== undefined) projectedPrograms = kept.programs
        else
          try {
            projectedPrograms = worldProjectorPrograms(
              slot,
              projected.materials,
              scene.textures,
              materialContext,
            )
          } catch {
            // Unsupported projector materials remain isolated from the rest of the map.
          }
        if (still && !reuse) {
          if (projections === undefined) worldObjectProjections.set(item, (projections = new Map()))
          projections.set(
            component.id,
            Object.freeze({
              source: effectSource,
              materials: scene.materials,
              ground: projectorGround,
              transform: receiverTransform,
              projected,
              ...(worldMaterialsFollowTime(result) ? {} : { programs: projectedPrograms }),
            }),
          )
        }
        const projectedMaterialPrimitives: SceneRendererPrimitive[] = []
        for (const primitive of projected.primitives) {
          const material = projected.materials.find(
            candidate => candidate.id === primitive.materialId,
          )
          if (material !== undefined && material.simpleEffect === undefined) {
            if (projectedPrograms.has(material.id))
              projectedMaterialPrimitives.push(
                Object.freeze({
                  ...primitive,
                  transform: multiplyComponentTransforms(
                    instanceTransform,
                    primitive.transform ?? IDENTITY_COMPONENT_TRANSFORM,
                  ),
                }),
              )
            continue
          }
          const resource = material?.simpleEffect?.textureResource
          const textureId = material?.textureBindings?.find(
            binding => binding.resourceId === resource,
          )?.textureId
          const texture = scene.textures.find(candidate => candidate.id === textureId)
          if (!texture || !primitive.textureCoordinates) continue
          const layer = worldProjectorSplatLayer(primitive, material)
          const blend = material?.simpleEffect?.blend
          const blendMode = blend === 'additive' || blend === 'add-alpha' ? 'additive' : 'blend'
          const normal = worldProjectorNormal(material, scene.textures)
          const target = projectorBatch(texture, layer, blendMode, normal)
          const write: MutableTexturedBatch = { ...batch(), textureCoordinates: [], texture }
          for (const triangle of primitiveTriangles(primitive)) {
            const vertices = triangle.map(index => {
              const p = transformedComponentVertex(
                transformedPrimitiveVertex(primitive, index),
                instanceTransform,
              )
              return [p[0], p[1] + 0.005, p[2]] as const
            })
            pushTexturedTriangle(
              write,
              vertices as unknown as Parameters<typeof pushTexturedTriangle>[1],
              triangle.map(index => [
                primitive.textureCoordinates![index * 2]!,
                primitive.textureCoordinates![index * 2 + 1]!,
              ]) as unknown as Parameters<typeof pushTexturedTriangle>[2],
              [1, 1, 1, material?.baseColor?.[3] ?? 1],
            )
          }
          const key = projectorBatchKey(texture, layer, blendMode, normal)
          const previous = previousProjectorWrites?.[projectorWrites.length]
          const kept =
            previous !== undefined && previous.key === key && sameWriteContent(previous.write, write)
              ? previous.write
              : write
          projectorWrites.push({ key, write: kept })
          journal(target, kept)
          objectBatchWrites.push({ collection: 'transparentTextured', key, target, write: kept })
        }
        if (projectedMaterialPrimitives.length > 0) {
          const projectedScene = Object.freeze({
            primitives: Object.freeze(projectedMaterialPrimitives),
            shadowPrimitives: Object.freeze([]),
            materials: projected.materials,
            programs: projectedPrograms,
            textures: scene.textures,
          })
          modelMaterialScenes.push(projectedScene)
          worldSplatSceneLayers.set(
            projectedScene,
            new Map(
              projectedMaterialPrimitives.map(primitive => [
                primitive.id,
                worldProjectorSplatLayer(
                  primitive,
                  projected.materials.find(candidate => candidate.id === primitive.materialId),
                ),
              ]),
            ),
          )
          if (materialsFollowTime)
            sceneResamplers.set(
              projectedScene,
              worldProjectorSceneResampler(projected.materials, scene.textures, item, result),
            )
        }
      }
      // Decals are projected above; only particles and ribbons are drawn per frame from here.
      if (effectSource?.liveEffects === true) {
        effectResources.push(component.resourceId)
        placingEffects.push(componentTransform)
        modelEffects.push(
          Object.freeze({
            source: effectSource,
            transform: instanceTransform,
            time,
            materials: scene.materials,
            textures: scene.textures,
            context: materialContext,
          }),
        )
      }
      if (materialPrimitives.length > 0) {
        const materialScene = Object.freeze({
          primitives: Object.freeze(materialPrimitives),
          shadowPrimitives: Object.freeze(materialShadowPrimitives),
          materials: scene.materials,
          programs,
          textures: scene.textures,
        })
        if (shadowlessMaterials.size > 0) worldShadowlessMaterials.set(materialScene, shadowlessMaterials)
        modelMaterialScenes.push(materialScene)
        placingScenes.push(
          Object.freeze({
            component: componentTransform,
            primitives: Object.freeze(ownTransforms),
          }),
        )
        // The presentation (clip, team colour) is in the kept object's key: only the time moves.
        if (materialsFollowTime) {
          sceneCohortTerms.set(
            materialScene,
            [
              worldGroupId(programs),
              templateKey,
              worldObjectClockFormula(
                item,
                selectedAnimation !== undefined,
                selectedAnimation?.durationSeconds,
              ),
            ].join('\u0001'),
          )
          sceneResamplers.set(
            materialScene,
            worldModelSceneResampler(
              result,
              item,
              templateKey,
              selectedAnimation !== undefined,
              selectedAnimation?.durationSeconds,
            ),
          )
        }
      }
    }
    // A cliff piece whose code ships no mesh (ramp interiors) is the terrain's own slope: nothing to
    // mark.
    // An explicitly empty composition draws nothing of its own (a module inside its base's model).
    if (
      !rendered &&
      !resolved &&
      item.derivedFrom !== 'cliffs' &&
      !(item.modelComponents !== undefined && item.modelComponents.length === 0)
    ) {
      const selected = item.objectId === input.selectedObjectId
      // A point or camera has no model by design: marked only on request (editorMarkers). It is not
      // retained either way, so the next plan follows the request.
      if (selected || input.editorMarkers === true || (item.kind !== 'point' && item.kind !== 'camera')) {
        pushVertex(points, translation, [0, 1, 0], selected ? [1, 0.9, 0.1, 1] : colorHash(item.kind))
        diagnosticPlaceholders += 1
      }
      retainable = false
    }
    lastProjectorWrites.set(item, projectorWrites)
    if (!pickTriangles.every(Number.isFinite))
      throw new TypeError('world WebGL plan contains a non-finite model coordinate')
    const framingTriangles = restTransforms === undefined ? pickTriangles : []
    const framingPrimitives = restTransforms === undefined ? pickPrimitives : restPrimitives
    if (restTransforms !== undefined)
      for (const entry of objectBatchWrites) clockWrites.add(entry.write)
    const pickMesh = worldObjectPickMesh(
      item.objectId,
      translation,
      pickTriangles,
      pickPrimitives,
      !resolved,
      framingTriangles,
      framingPrimitives,
    )
    objectPickMeshes.push(pickMesh)
    if (byProgram) programObjects += 1
    if (byFallback) fallbackObjects += 1
    if (retainable && staticKey !== undefined)
      retainedStaticObjects.set(
        item,
        Object.freeze({
          key: staticKey,
          scenes: Object.freeze(modelMaterialScenes.slice(scenesBefore)),
          ...(sceneResamplers.size === 0
            ? {}
            : {
                materialClock: worldObjectMaterialClock(item, input),
                resamplers: Object.freeze(
                  modelMaterialScenes.slice(scenesBefore).map(scene => sceneResamplers.get(scene)),
                ),
                ...worldObjectCohort(
                  item,
                  input,
                  modelMaterialScenes.slice(scenesBefore),
                  sceneResamplers,
                  sceneCohortTerms,
                ),
              }),
          effects: Object.freeze(modelEffects.slice(effectsBefore)),
          effectResources: Object.freeze(effectResources),
          batchWrites: Object.freeze(objectBatchWrites),
          pickMesh,
          modelTriangles: modelTriangles - trianglesBefore,
          shadowTriangles: modelMaterialShadowTriangles - shadowTrianglesBefore,
          byProgram,
          byFallback,
          ...(poseModels === undefined || posePicks === undefined
            ? {}
            : {
                pose: Object.freeze({
                  models: Object.freeze(poseModels),
                  sockets: Object.freeze(
                    components
                      .filter(component => component.parentId !== undefined)
                      .map(component =>
                        Object.freeze({
                          id: component.id,
                          transform: componentTransforms.get(component.id),
                        }),
                      ),
                  ),
                  picks: Object.freeze(posePicks),
                  posable: !byFallback,
                  placement: worldObjectTransform(item, translation),
                  tint: worldObjectTint(item, input.selectedObjectId),
                  ...(placeable && !byFallback && objectBatchWrites.length === 0
                    ? {
                        placing: Object.freeze({
                          scenes: Object.freeze(placingScenes),
                          effects: Object.freeze(placingEffects),
                          picks: Object.freeze(placingPicks),
                          rest:
                            restTransforms === undefined ? undefined : Object.freeze(placingRest),
                        }),
                      }
                    : {}),
                }),
              }),
          ...(restTransforms === undefined ? {} : { atRest: true as const }),
        }),
      )
  }
  finishKeptBlock()

  let navigationSamples = 0
  for (const item of worldFacetItems(facets, 'navigation')) {
    if (item.flags === 0) continue
    const position =
      item.uvwPosition === undefined
        ? ([item.x, 0, item.y] as const)
        : ([item.uvwPosition.x, item.uvwPosition.y, item.uvwPosition.z] as const)
    pushVertex(points, position, [0, 1, 0], [0.88, 0.15, 0.12, 0.7])
    navigationSamples += 1
  }

  let regionShapes = 0
  for (const item of worldFacetItems(facets, 'regions')) {
    const shapes = item.uvwShapes ?? item.shapes
    for (const shape of shapes) {
      const color = [1, 0.75, 0.12, 1] as const
      if (shape.center !== undefined && shape.radius !== undefined) {
        for (let segment = 0; segment < 32; segment += 1) {
          const start = (segment / 32) * Math.PI * 2
          const end = ((segment + 1) / 32) * Math.PI * 2
          pushLine(
            lines,
            [
              shape.center.x + Math.cos(start) * shape.radius,
              0,
              shape.center.y + Math.sin(start) * shape.radius,
            ],
            [
              shape.center.x + Math.cos(end) * shape.radius,
              0,
              shape.center.y + Math.sin(end) * shape.radius,
            ],
            color,
          )
        }
        regionShapes += 1
      } else if (shape.minimum !== undefined && shape.maximum !== undefined) {
        const corners = [
          [shape.minimum.x, 0, shape.minimum.y],
          [shape.maximum.x, 0, shape.minimum.y],
          [shape.maximum.x, 0, shape.maximum.y],
          [shape.minimum.x, 0, shape.maximum.y],
        ] as const
        for (let index = 0; index < corners.length; index += 1)
          pushLine(lines, corners[index]!, corners[(index + 1) % corners.length]!, color)
        regionShapes += 1
      } else if ((shape.points?.length ?? 0) > 1) {
        const shapePoints = shape.points ?? []
        for (let index = 0; index < shapePoints.length; index += 1) {
          const start = shapePoints[index]!
          const end = shapePoints[(index + 1) % shapePoints.length]!
          pushLine(lines, [start.x, 0, start.y], [end.x, 0, end.y], color)
        }
        regionShapes += 1
      }
    }
  }

  // Writes are checked once: a retained object's or water zone's writes were checked by the plan
  // that made them (an unchecked one, left by a plan that threw, is checked again here).
  const texturedWrites = [...textured.values(), ...transparentTextured.values()]
    .flatMap(writesOf)
    .filter(write => !checkedWorldWrites.has(write))
  const uncheckedWrites = [opaque, transparent]
    .flatMap(writesOf)
    .filter(write => !checkedWorldWrites.has(write))
    .concat(texturedWrites)
  if (!finitePlan([lines, points, ...uncheckedWrites]))
    throw new TypeError('world WebGL plan contains a non-finite coordinate')
  for (const write of texturedWrites)
    if (!(write.textureCoordinates ?? []).every(Number.isFinite))
      throw new TypeError('world WebGL plan contains a non-finite texture coordinate')
  for (const write of uncheckedWrites) checkedWorldWrites.add(write)
  const positionSets: readonly (readonly number[])[] = [
    lines.positions,
    points.positions,
    ...[opaque, transparent, ...shadowControlledOpaque.values(), ...texturedTargets()]
      .flatMap(writesOf)
      .filter(write => !clockWrites.has(write))
      .map(write => write.positions),
  ]
  const minimum: [number, number, number] = [...preparation.minimum]
  const maximum: [number, number, number] = [...preparation.maximum]
  let hasPositions = preparation.hasPositions
  for (const positions of positionSets) {
    if (positions.length > 0) hasPositions = true
    const bounds = positionBounds(positions)
    for (const axis of [0, 1, 2] as const) {
      minimum[axis] = Math.min(minimum[axis], bounds[axis]!)
      maximum[axis] = Math.max(maximum[axis], bounds[axis + 3]!)
    }
  }
  const insideBounds = (envelope: readonly number[]) =>
    envelope[0]! >= minimum[0] &&
    envelope[1]! >= minimum[1] &&
    envelope[2]! >= minimum[2] &&
    envelope[3]! <= maximum[0] &&
    envelope[4]! <= maximum[1] &&
    envelope[5]! <= maximum[2]
  let segment = 0
  for (let index = 0; index < objectPickMeshes.length; index += 1) {
    // A block taken whole: when the box holding its finite envelopes lies inside the bounds so far,
    // every one of them does, and each would leave the bounds as they are.
    const kept = keptSegments[segment]
    if (kept?.first === index) {
      segment += 1
      const { envelope, finite } = kept.block
      if (envelope === null) {
        index = kept.end - 1
        continue
      }
      hasPositions = true
      if (finite && insideBounds(envelope)) {
        index = kept.end - 1
        continue
      }
    }
    const mesh = objectPickMeshes[index]!
    const envelope = mesh.envelope
    if (envelope === null) continue
    hasPositions = true
    // An object inside the bounds so far leaves them as they are, whatever its exact bounds: only
    // an envelope that reaches past them (or is not finite) needs the pass over its vertices.
    if (
      insideBounds(envelope) &&
      Number.isFinite(
        envelope[3]! - envelope[0]! + envelope[4]! - envelope[1]! + envelope[5]! - envelope[2]!,
      )
    )
      continue
    const bounds = mesh.bounds!
    minimum[0] = Math.min(minimum[0], bounds[0]!)
    minimum[1] = Math.min(minimum[1], bounds[1]!)
    minimum[2] = Math.min(minimum[2], bounds[2]!)
    maximum[0] = Math.max(maximum[0], bounds[3]!)
    maximum[1] = Math.max(maximum[1], bounds[4]!)
    maximum[2] = Math.max(maximum[2], bounds[5]!)
  }
  if (!hasPositions) {
    minimum.fill(-0.5)
    maximum.fill(0.5)
  }
  const lighting = worldFacetItems(facets, 'lighting')[0]
  // an unlit world (tiles shaded in their pixels): each texel times unlitColor, no light, no highlight
  const unlit = lighting?.model === 'unlit'
  const directional = unlit ? undefined : lighting?.directional[0]
  const ambient: readonly [number, number, number] = unlit
    ? (lighting?.unlitColor ?? [1, 1, 1])
    : (lighting?.ambientColor ?? [1, 1, 1])
  const stated = directional?.direction
  // a direction in the map's native axes (x east, y south, z up) turns as its positions do
  const direction: readonly [number, number, number] =
    stated === undefined
      ? [-0.45, -1, -0.35]
      : lighting?.coordinateSpaceId === 'map-native'
        ? [stated[0], stated[2], stated[1]]
        : stated
  const lightColor: readonly [number, number, number] = directional?.color ?? [1, 0.97, 0.9]
  // Each shared batch from its writes, or the previous plan's batch when its writes are the same.
  const currentBatches = new Map<
    string,
    { readonly template: object; readonly writes: readonly WorldBatchWrite[]; readonly frozen: unknown }
  >()
  const frozenWrites = <T>(name: string, template: object, build: (writes: readonly WorldBatchWrite[]) => T): T => {
    const writes = writesOf(template)
    const previous = previousBatches?.batches.get(name)
    const frozen =
      previous !== undefined &&
      sameWrites(previous.writes, writes) &&
      sameBatchTemplate(previous.template, template)
        ? (previous.frozen as T)
        : build(writes)
    currentBatches.set(name, { template, writes, frozen })
    return frozen
  }
  const dynamicOpaque = frozenWrites('opaque', opaque, writtenBatch)
  const previousOpaque = previousBatches?.opaque
  const opaqueTriangles =
    previousOpaque !== undefined &&
    previousOpaque.staticBatch === preparation.opaqueTriangles &&
    previousOpaque.dynamicBatch === dynamicOpaque
      ? previousOpaque.batch
      : appendFrozenWorldBatch(preparation.opaqueTriangles, dynamicOpaque)
  const waterPlanes = [...waterPlaneBatches].map(([key, plane]) =>
    frozenWrites(`plane\u0000${key}`, plane, writes =>
      Object.freeze({
        batch: writtenBatch(writes),
        colorFalloff: plane.colorFalloff,
        receiveShadows: plane.receiveShadows,
        ...(plane.caustics === undefined ? {} : { caustics: plane.caustics }),
        ...(plane.waves === undefined ? {} : { waves: plane.waves }),
      }),
    ),
  )
  const controlledTriangles = [...shadowControlledOpaque].map(([key, item]) =>
    frozenWrites(`controlled\u0000${key}`, item, writes =>
      Object.freeze({
        ...writtenBatch(writes),
        castShadows: item.castShadows,
        receiveShadows: item.receiveShadows,
      }),
    ),
  )
  const dynamicTextured = [...textured].map(([key, item]) =>
    frozenWrites(`textured\u0000${key}`, item, writes => writtenTexturedBatch(item, writes)),
  )
  const transparentTexturedTriangles = [...transparentTextured].map(([key, item]) =>
    frozenWrites(`transparentTextured\u0000${key}`, item, writes =>
      Object.freeze({
        ...writtenTexturedBatch(item, writes),
        blendMode: item.blendMode,
        receiveShadows: item.receiveShadows,
        ...(item.splatLayer === undefined ? {} : { splatLayer: item.splatLayer }),
      }),
    ),
  )
  const multipliedWaterTriangles = [...multipliedWater].map(([key, item]) =>
    frozenWrites(`multipliedWater\u0000${key}`, item, writes => writtenTexturedBatch(item, writes)),
  )
  const transparentTriangles = frozenWrites('transparent', transparent, writtenBatch)
  const shadowCasterTriangles =
    preparation.shadowCasterTriangles +
    modelMaterialShadowTriangles +
    (dynamicOpaque.positions.length +
      controlledTriangles.reduce(
        (sum, item) => sum + (item.castShadows ? item.positions.length : 0),
        0,
      ) +
      dynamicTextured.reduce(
        (sum, item) => sum + (item.castShadows === false ? 0 : item.positions.length),
        0,
      )) /
      9
  const plan: WorldWebGlPlan = Object.freeze({
    opaqueTriangles,
    terrainShadowCasters: preparation.terrainShadowCasters,
    waterSurfaceDepth,
    waterPlanes: Object.freeze(waterPlanes),
    transparentWaterTriangles,
    modelMaterialScenes: Object.freeze(modelMaterialScenes),
    modelEffects: Object.freeze(modelEffects),
    shadowControlledOpaqueTriangles: Object.freeze(controlledTriangles),
    texturedTriangles: Object.freeze([...preparation.texturedTriangles, ...dynamicTextured]),
    transparentTexturedTriangles: Object.freeze(transparentTexturedTriangles),
    splatTriangles: preparation.splatTriangles,
    splatOverlayTriangles: preparation.splatOverlayTriangles,
    terrainDecalTriangles: preparation.decalTriangles,
    multipliedWaterTriangles: Object.freeze(multipliedWaterTriangles),
    transparentTriangles,
    lines: appendWorldBatch(preparation.lines, lines),
    points: appendWorldBatch(preparation.points, points),
    picking: Object.freeze({
      terrainTriangles: preparation.terrainTriangles,
      objects: Object.freeze(objectPickMeshes.map(item => item.pick)),
    }),
    bounds: Object.freeze({ minimum: Object.freeze(minimum), maximum: Object.freeze(maximum) }),
    light: Object.freeze({
      ...(lighting?.toneMapping === undefined ? {} : { toneMapping: lighting.toneMapping }),
      ...(lighting?.terrain === undefined || unlit ? {} : { terrain: lighting.terrain }),
      ...(lighting?.shadowRange === undefined ? {} : { shadowRange: lighting.shadowRange }),
      ...(lighting?.fog === undefined ? {} : { fog: lighting.fog }),
      specularColor: directional?.specularColor ?? lightColor,
      specularIntensity: unlit
        ? 0
        : (directional?.specularIntensity ?? directional?.intensity ?? 0.9),
      useAmbientOcclusion: !unlit && (directional?.useAmbientOcclusion ?? true),
      ambient,
      ambientIntensity: unlit ? 1 : (lighting?.ambientIntensity ?? 0.36),
      direction,
      color: lightColor,
      intensity: unlit ? 0 : (directional?.intensity ?? 0.9),
      fills: Object.freeze(
        (unlit ? [] : (lighting?.directional ?? [])).slice(1, 1 + MAXIMUM_FILL_LIGHTS).map(light =>
          Object.freeze({
            direction: light.direction,
            color: light.color,
            intensity: light.intensity,
            specularColor: light.specularColor ?? light.color,
            specularIntensity: light.specularIntensity ?? light.intensity,
            useAmbientOcclusion: light.useAmbientOcclusion ?? true,
          }),
        ),
      ),
    }),
    stats: Object.freeze({
      terrainTriangles: preparation.stats.terrainTriangles,
      terrainTexturedTriangles: preparation.stats.terrainTexturedTriangles,
      terrainSplatFallbackCells: preparation.stats.terrainSplatFallbackCells,
      terrainDecalTriangles: preparation.stats.terrainDecalTriangles,
      waterPolygons,
      cliffEdges: preparation.stats.cliffEdges,
      cliffTriangles: preparation.stats.cliffTriangles,
      objectInstances: objects.length,
      programObjects,
      fallbackObjects,
      modelTriangles,
      navigationSamples,
      gatewaySegments: preparation.stats.gatewaySegments,
      regionShapes,
      diagnosticPlaceholders,
      shadowCasterTriangles,
      shadowMapSize: 0,
      frame: worldPlanFrame(minimum, maximum),
    }),
  })
  worldStaticPreparations.set(plan, {
    input: snapshotWorldPlanInput(input),
    preparation,
    models,
  })
  if (
    currentPrograms.materials.size > 0 ||
    currentPrograms.skins.size > 0 ||
    currentPrograms.transforms.size > 0
  )
    worldCurrentPrograms.set(plan, currentPrograms)
  worldPlanFacets.set(plan, facets)
  worldKeptBlocks.set(plan, keptBlocks)
  worldPlanSerials.set(plan, worldPlansBuilt)
  worldPlanWork.set(
    plan,
    Object.freeze({
      keptObjects,
      builtObjects: objects.length - keptObjects,
      posedSamples: planSamples.size,
      unposedObjects: unposed.length / 4,
    }),
  )
  if (unposed.length > 0) worldUnposedSpheres.set(plan, Float64Array.from(unposed))
  worldPlanBatches.set(plan, {
    batches: currentBatches,
    water: waterWrites,
    waterSurfaceDepth,
    opaque: Object.freeze({
      staticBatch: preparation.opaqueTriangles,
      dynamicBatch: dynamicOpaque,
      batch: opaqueTriangles,
    }),
  })
  // The same transparent batches sort the same way: the next frame keeps the sorted runs.
  const previousTransparentDraws =
    previousPlan === undefined ? undefined : transparentDrawPlans.get(previousPlan)
  if (
    previousTransparentDraws !== undefined &&
    previousPlan!.transparentTriangles === transparentTriangles &&
    previousPlan!.transparentWaterTriangles === transparentWaterTriangles &&
    sameWrites(previousPlan!.transparentTexturedTriangles, transparentTexturedTriangles)
  )
    transparentDrawPlans.set(plan, previousTransparentDraws)
  return plan
}

const VERTEX_SHADER = `#version 300 es
in vec3 position;
in vec3 normal;
in vec4 color;
in vec2 uv;
in vec2 secondaryUv;
in vec4 textureWeights0;
in vec4 textureWeights1;
in vec2 splatUv0;
in vec2 splatUv1;
in vec2 splatUv2;
in vec2 splatUv3;
in vec2 splatUv4;
in vec2 splatUv5;
in vec2 splatUv6;
in vec2 splatUv7;
in vec2 splatWeightUv;
uniform mat4 viewProjection;
uniform mat4 shadowViewProjection;
uniform float pointSize;
out vec3 worldNormal;
out vec3 worldPosition;
out vec4 vertexColor;
// centroid: an edge pixel under MSAA reads inside its triangle, not past it into the next
// atlas tile or texture edge
centroid out vec2 textureCoordinate;
out vec2 secondaryTextureCoordinate;
out vec4 splatWeights0;
out vec4 splatWeights1;
out vec2 splatTextureCoordinates[8];
out vec2 splatWeightTextureCoordinate;
out vec4 shadowPosition;
void main() {
  worldNormal = normal;
  worldPosition = position;
  vertexColor = color;
  textureCoordinate = uv;
  secondaryTextureCoordinate = secondaryUv;
  splatWeights0 = textureWeights0;
  splatWeights1 = textureWeights1;
  splatTextureCoordinates[0] = splatUv0;
  splatTextureCoordinates[1] = splatUv1;
  splatTextureCoordinates[2] = splatUv2;
  splatTextureCoordinates[3] = splatUv3;
  splatTextureCoordinates[4] = splatUv4;
  splatTextureCoordinates[5] = splatUv5;
  splatTextureCoordinates[6] = splatUv6;
  splatTextureCoordinates[7] = splatUv7;
  splatWeightTextureCoordinate = splatWeightUv;
  shadowPosition = shadowViewProjection * vec4(position, 1.0);
  gl_Position = viewProjection * vec4(position, 1.0);
  gl_PointSize = pointSize;
}`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec3 worldNormal;
in vec3 worldPosition;
in vec4 vertexColor;
centroid in vec2 textureCoordinate;
in vec2 secondaryTextureCoordinate;
in vec4 splatWeights0;
in vec4 splatWeights1;
in vec2 splatTextureCoordinates[8];
in vec2 splatWeightTextureCoordinate;
in vec4 shadowPosition;
uniform vec3 ambientColor;
uniform float ambientIntensity;
uniform vec3 lightDirection;
uniform vec3 lightColor;
uniform float lightIntensity;
uniform vec3 eyePosition;
uniform vec3 lightSpecularRadiance;
uniform vec3 terrainLighting;
uniform float keyUsesVertexAo;
uniform float fillUsesVertexAo0;
uniform float fillUsesVertexAo1;
uniform float terrainSpecularTextured;
uniform sampler2DArray terrainSpecularMaps;
// The specular maps hold a gloss in red (MapTerrainMaterialDefinition.specularEncoding 'gloss').
uniform float terrainSpecularGloss;
// A decal tile over the ground, lit as the ground is: AO in colour alpha, the terrain diffuse and
// specular, its own normal map and a specular map of its own.
uniform float terrainDecal;
uniform float terrainDecalCoverageOnly;
uniform float terrainDecalSpecularTextured;
uniform sampler2D terrainDecalSpecularMap;
// How normalMap spells the normal: 0 RGB, 1 X in alpha and Y in green (DXN), 2 RGB with Y against v.
uniform float normalSwizzle;
// Detail-wave water (MapWaterDetailWaves): normalMap holds the first normal image, the base and
// second colour maps the glitter; vertex colour is the ground's occlusion and the depth term.
uniform float waterDetailMode;
uniform sampler2D waterDetailNormal1;
uniform sampler2D waterDetailFoam0;
uniform sampler2D waterDetailFoam1;
uniform float waterDetailFoamed;
uniform vec3 waterDetailColor;
uniform vec4 waterDetailScroll0;
uniform vec4 waterDetailScroll1;
uniform float waterDetailUpScale;
// One uniform per fill light rather than arrays: read through ANGLE/D3D11, a uniform array indexed
// anywhere but by a literal in main() contributed nothing, silently.
uniform vec3 fillLightDirection0;
uniform vec3 fillLightRadiance0;
uniform vec3 fillLightDirection1;
uniform vec3 fillLightRadiance1;
uniform float textured;
uniform float normalTextured;
uniform float secondaryTextured;
uniform float splatTextured;
uniform float rasterSplatTextured;
uniform float terrainWeightMapCount;
// A later weight-raster group over the first: alpha is the share of the weights its layers hold.
uniform float terrainWeightOverlay;
// The surface colour as it is, no light: water that multiplies the ground under it.
uniform float unlitSurface;
// UV_game_material_team_color of a model batch: 0 none, 1 whole, 2 weighed by the mask on the
// secondary unit at the base UVs; mask channel 0-3, or 4 per channel
uniform float teamColorMode;
uniform float teamMaskChannel;
uniform float teamBlend;
uniform float teamStrength;
uniform vec3 teamColor;
// how the mask weighs it (TEAM_MASK_GLSL): 0 its data channel, 1 a key, 2 an indexed ramp
uniform float teamMaskMode;
uniform vec3 teamKey;
uniform float teamKeyIntensity;
uniform vec3 teamRamp[${TEAM_RAMP_MAX}];
uniform float teamRampCount;
uniform float teamRampFirst;
uniform float teamRampScale;
uniform float teamTintRgb;
uniform sampler2D baseColorMap;
// The base map is an atlas of tiles in this grid, columns and rows (MapTerrainMaterialDefinition.atlas);
// 0 when it is none. The secondary coordinate is then the cell's grid coordinate.
uniform vec2 atlasGrid;
uniform float alphaCutoff;
uniform sampler2D normalMap;
uniform sampler2D secondaryColorMap;
uniform sampler2DArray terrainMaps;
uniform sampler2DArray terrainNormalMaps;
uniform sampler2D terrainWeightMaps[2];
// Each blended layer's baseColorFactor RGB; indexed by literals only (ANGLE, see the fill lights).
uniform vec4 terrainLayerColor[8];
uniform vec4 terrainNormalMask0;
uniform vec4 terrainNormalMask1;
uniform vec4 terrainNormalSwizzle0;
uniform vec4 terrainNormalSwizzle1;
uniform vec4 terrainClampU0;
uniform vec4 terrainClampU1;
uniform vec4 terrainClampV0;
uniform vec4 terrainClampV1;
uniform sampler2D shadowMap;
uniform float shadowEnabled;
uniform float shadowReceiver;
uniform vec2 shadowTexelSize;
// Shadows end this far (0: nowhere) from the perspective eye that frames the view.
uniform vec3 shadowRangeEye;
uniform float shadowRangeDistance;
// Water drawn as its zone's plane: the opaque scene's depth (a copy) gives the water depth under
// each pixel. x = world units along the view ray per unit of window depth (orthographic far - near),
// y = the vertical share of that ray.
uniform float waterDepthMode;
uniform sampler2D sceneDepthMap;
uniform vec2 waterDepthScale;
uniform float waterFalloff;
uniform float waterShoreFade;
// near, far, and 1 for a perspective camera: its window depth is not linear along the ray.
uniform vec3 waterDepthLens;
// World units along the view ray between two window depths.
float waterAlongRay(float sceneDepth, float fragmentDepth) {
  if (waterDepthLens.z < 0.5) return (sceneDepth - fragmentDepth) * waterDepthScale.x;
  float lensNear = waterDepthLens.x;
  float lensFar = waterDepthLens.y;
  return lensNear * lensFar / (lensFar - sceneDepth * (lensFar - lensNear)) -
    lensNear * lensFar / (lensFar - fragmentDepth * (lensFar - lensNear));
}
uniform float causticsMode;
uniform sampler2D causticsMap;
uniform vec2 causticsScale;
uniform float causticsFalloff;
uniform vec3 waterViewForward;
uniform float waterWavesMode;
uniform sampler2D waterNormalMap;
uniform vec2 waterWaveTiling;
uniform vec4 waterWaveScroll;
uniform vec2 waterSpecular;
uniform float waterTime;
// A cliff surface drawn as terrain: kept only where its blend mask (secondaryColorMap, channel
// picked by the selector) is clear, the complement of the rock's alpha test.
uniform float cliffMaskMode;
uniform vec4 cliffMaskSelector;
out vec4 outColor;
${TEAM_COLOR_GLSL}
${TEAM_MASK_GLSL}
// The base colour; for an atlas, from inside the sample's tile at the level it reads. The level comes
// from the cell coordinate (the atlas coordinate jumps between tiles at a cell edge), it stops where a
// tile is one texel, and the sample stays half a texel of the coarser level read inside the tile: a far
// view mixes no neighbouring tile in.
vec4 baseColorSample(vec2 uv) {
  if (atlasGrid.x <= 0.0) return texture(baseColorMap, uv);
  vec2 size = vec2(textureSize(baseColorMap, 0));
  vec2 tileTexels = size / atlasGrid;
  vec2 dx = dFdx(secondaryTextureCoordinate) * tileTexels;
  vec2 dy = dFdy(secondaryTextureCoordinate) * tileTexels;
  float lod = clamp(
    0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1e-8)),
    0.0,
    log2(max(min(tileTexels.x, tileTexels.y), 1.0))
  );
  vec2 tile = floor(uv * atlasGrid);
  vec2 inset = 0.5 * exp2(ceil(lod)) / size;
  vec2 inside = clamp(uv, tile / atlasGrid + inset, (tile + 1.0) / atlasGrid - inset);
  return textureLod(baseColorMap, inside, lod);
}
float layerValue(vec4 first, vec4 second, int layer) {
  return layer < 4 ? first[layer] : second[layer - 4];
}
vec2 terrainLayerUv(int layer, vec2 uv) {
  vec2 clampMask = vec2(
    layerValue(terrainClampU0, terrainClampU1, layer),
    layerValue(terrainClampV0, terrainClampV1, layer)
  );
  return mix(fract(uv), clamp(uv, vec2(0.0), vec2(1.0)), clampMask);
}
vec4 terrainLayerSample(sampler2DArray maps, int layer, vec2 authoredUv) {
  // Mip selection uses the continuous coordinates; gradients of fract(uv) would pick the smallest
  // mip along every repeated-tile seam.
  return textureGrad(
    maps,
    vec3(terrainLayerUv(layer, authoredUv), float(layer)),
    dFdx(authoredUv),
    dFdy(authoredUv)
  );
}
vec3 terrainLayerNormal(vec3 baseNormal, int layer, vec2 authoredUv) {
  if (layerValue(terrainNormalMask0, terrainNormalMask1, layer) < 0.5) return baseNormal;
  vec3 positionDx = dFdx(worldPosition);
  vec3 positionDy = dFdy(worldPosition);
  // Derivatives use the continuous authored coordinates; differentiating fract(uv) would create
  // false tangent discontinuities at every repeated-tile seam.
  vec2 uvDx = dFdx(authoredUv);
  vec2 uvDy = dFdy(authoredUv);
  float determinant = uvDx.x * uvDy.y - uvDx.y * uvDy.x;
  if (abs(determinant) <= 0.000001) return baseNormal;
  vec3 tangent = normalize((positionDx * uvDy.y - positionDy * uvDx.y) / determinant);
  vec3 bitangent = normalize((-positionDx * uvDy.x + positionDy * uvDx.x) / determinant);
  vec4 normalSample = terrainLayerSample(terrainNormalMaps, layer, authoredUv);
  vec3 mappedNormal;
  float swizzle = layerValue(terrainNormalSwizzle0, terrainNormalSwizzle1, layer);
  if (swizzle > 0.5 && swizzle < 1.5) {
    // DXN-swizzled: X in alpha, Y in green, Z rebuilt — Shaders/TerrainBlend.fx UnSwizzleNormals.
    vec2 mappedXy = 2.0 * vec2(normalSample.w, normalSample.y) - 1.0;
    mappedNormal = vec3(mappedXy, sqrt(max(0.0, 1.0 - dot(mappedXy, mappedXy))));
  } else {
    mappedNormal = normalSample.xyz * 2.0 - 1.0;
    // A map that remaps to about zero (a grey height map, say) would have its noise amplified into
    // a per-triangle normal by the normalize below — a lattice over flat ground.
    if (dot(mappedNormal, mappedNormal) < 0.04) return baseNormal;
    if (swizzle > 1.5) mappedNormal.y = -mappedNormal.y;
  }
  return normalize(tangent * mappedNormal.x + bitangent * mappedNormal.y + baseNormal * mappedNormal.z);
}
${WORLD_SHADOW_GLSL}
float directionalShadow(vec3 resolvedNormal) {
  if (shadowEnabled < 0.5 || shadowReceiver < 0.5) return 1.0;
  return modkitWorldShadow(
    shadowMap,
    shadowPosition,
    worldPosition,
    max(0.0, dot(normalize(resolvedNormal), normalize(-lightDirection))),
    shadowTexelSize,
    shadowRangeEye,
    shadowRangeDistance
  );
}
/**
 * Warzone 2100 terrain_water_high.frag on the two scrolling UV sets. Its normal images are read as
 * (x, y up, z) = (r, b, g) in the engine's world, which is this world's axes; the first pair is
 * blended by reoriented normal mapping (selfshadow.com, "Blending in Detail").
 */
vec4 detailWater() {
  vec2 uv1 = textureCoordinate;
  vec2 uv2 = secondaryTextureCoordinate;
  vec3 s1 = texture(normalMap, uv1 + waterDetailScroll0.xy * waterTime).rgb;
  vec3 s2 = texture(waterDetailNormal1, uv2 + waterDetailScroll0.zw * waterTime).rgb;
  vec3 s3 = texture(normalMap, uv1 + waterDetailScroll1.xy * waterTime).rgb;
  vec3 s4 = texture(waterDetailNormal1, uv2 + waterDetailScroll1.zw * waterTime).rgb;
  vec3 n1 = vec3(s1.r * 2.0 - 1.0, s1.b * 2.0, s1.g * 2.0 - 1.0);
  vec3 n2 = vec3(1.0 - 2.0 * s2.r, 2.0 * s2.b - 1.0, 1.0 - 2.0 * s2.g);
  vec3 n3 = vec3(s3.r, s3.b, s3.g) * 2.0 - 1.0;
  vec3 n4 = vec3(s4.r, s4.b, s4.g) * 2.0 - 1.0;
  vec3 blended = normalize(n1 * dot(n1, n2) - n2 * n1.y);
  vec3 n = mix(blended, mix(n3, n4, 0.5), 0.5);
  n = normalize(vec3(n.x, n.y * waterDetailUpScale, n.z));
  float depthTerm = vertexColor.a;
  float shore = mix(depthTerm * 0.1, depthTerm, 0.5);
  float glitter = texture(baseColorMap, uv1).r * texture(secondaryColorMap, uv2).r;
  float foam = waterDetailFoamed > 0.5
    ? texture(waterDetailFoam0, uv1).r * texture(waterDetailFoam1, uv2).r
    : 0.0;
  foam = clamp((foam + pow(length(n.xz), 2.5) * 1000.0) * shore * shore, 0.0, 0.2);
  vec3 key = normalize(-lightDirection);
  vec3 eye = normalize(eyePosition - worldPosition);
  vec3 halfway = normalize(key + eye);
  float diffuse = max(dot(n, key), 0.0);
  diffuse = min(diffuse, directionalShadow(n) * diffuse);
  float blinn = clamp(pow(max(dot(n, halfway), 0.0), 128.0), 0.0, 1.0);
  float mirror = pow(max(dot(reflect(-key, n), halfway), 0.0), 14.0);
  float fresnel = pow(1.0 - dot(eye, halfway), 10.0) * 1000.0;
  float fresnelAlpha = clamp(pow(max(1.0 - eye.y, 0.0), 0.8), 0.15, 0.5);
  vec3 color = ambientColor * ambientIntensity * foam
    + lightColor * lightIntensity * diffuse * waterDetailColor + glitter * glitter * 0.5
    + lightSpecularRadiance * (blinn + mirror) * 0.5 * diffuse;
  color = mix(color, (color + vec3(1.0, 0.8, 0.63)) * 0.5, fresnel);
  return vec4(color * vertexColor.rgb, (0.15 + 0.35 + fresnelAlpha) * (1.0 - depthTerm));
}
/** Radiance already carries intensity; a zero direction means "no such light". */
vec3 fillLight(vec3 resolvedNormal, vec3 direction, vec3 radiance) {
  if (dot(direction, direction) <= 0.0) return vec3(0.0);
  return radiance * max(0.0, dot(resolvedNormal, normalize(-direction)));
}
void main() {
  if (waterDetailMode > 0.5) {
    outColor = detailWater();
    return;
  }
  vec3 resolvedNormal = normalize(worldNormal);
  if (waterWavesMode > 0.5) {
    // SC2 Water.fx WaterNormal: two normals of one image at the map position times the tiling (v
    // flipped), each moved by its scroll pair; x/y of the first in red/green, of the second in
    // blue/alpha. Tangent space is the map's (x east, y north, z up); the world's y is up, z south.
    vec2 waveUv = vec2(worldPosition.x, -worldPosition.z) * waterWaveTiling;
    waveUv.y = 1.0 - waveUv.y;
    vec2 wave0 = texture(waterNormalMap, waveUv + waterWaveScroll.xy * waterTime).xy * 2.0 - 1.0;
    vec2 wave1 = texture(waterNormalMap, waveUv + waterWaveScroll.zw * waterTime).zw * 2.0 - 1.0;
    vec3 waves = vec3(wave0, sqrt(max(0.0, 1.0 - dot(wave0, wave0)))) + vec3(wave1, sqrt(max(0.0, 1.0 - dot(wave1, wave1))));
    // Smaller at the shore: the game leans it back to straight up by saturate(depth).
    float waveDepth = waterAlongRay(texelFetch(sceneDepthMap, ivec2(gl_FragCoord.xy), 0).r, gl_FragCoord.z);
    resolvedNormal = normalize(mix(vec3(0.0, 1.0, 0.0), normalize(vec3(waves.x, waves.z, -waves.y)), clamp(waveDepth, 0.0, 1.0)));
  }
  if (normalTextured > 0.5) {
    vec3 positionDx = dFdx(worldPosition);
    vec3 positionDy = dFdy(worldPosition);
    vec2 uvDx = dFdx(textureCoordinate);
    vec2 uvDy = dFdy(textureCoordinate);
    float determinant = uvDx.x * uvDy.y - uvDx.y * uvDy.x;
    if (abs(determinant) > 0.000001) {
      vec3 tangent = normalize((positionDx * uvDy.y - positionDy * uvDx.y) / determinant);
      vec3 bitangent = normalize((-positionDx * uvDy.x + positionDy * uvDx.x) / determinant);
      vec4 normalSample = texture(normalMap, textureCoordinate);
      vec3 mappedNormal = normalSample.xyz * 2.0 - 1.0;
      if (normalSwizzle > 0.5 && normalSwizzle < 1.5) {
        vec2 mappedXy = 2.0 * vec2(normalSample.w, normalSample.y) - 1.0;
        mappedNormal = vec3(mappedXy, sqrt(max(0.0, 1.0 - dot(mappedXy, mappedXy))));
      } else if (normalSwizzle > 1.5) {
        mappedNormal.y = -mappedNormal.y;
      }
      if (dot(mappedNormal, mappedNormal) >= 0.04) {
        resolvedNormal = normalize(
          tangent * mappedNormal.x + bitangent * mappedNormal.y + resolvedNormal * mappedNormal.z
        );
      }
    }
  }
  vec4 resolvedSplatWeights0 = splatWeights0;
  vec4 resolvedSplatWeights1 = splatWeights1;
  float rasterCoverage = 1.0;
  if (splatTextured > 0.5) {
    if (rasterSplatTextured > 0.5) {
      resolvedSplatWeights0 = texture(terrainWeightMaps[0], splatWeightTextureCoordinate);
      resolvedSplatWeights1 = terrainWeightMapCount > 1.5
        ? texture(terrainWeightMaps[1], splatWeightTextureCoordinate)
        : vec4(0.0);
      float totalWeight = dot(resolvedSplatWeights0, vec4(1.0)) + dot(resolvedSplatWeights1, vec4(1.0));
      rasterCoverage = totalWeight;
      if (totalWeight > 0.000001) {
        resolvedSplatWeights0 /= totalWeight;
        resolvedSplatWeights1 /= totalWeight;
      } else {
        resolvedSplatWeights0 = vec4(1.0, 0.0, 0.0, 0.0);
        resolvedSplatWeights1 = vec4(0.0);
      }
    }
    vec3 mixedNormal = vec3(0.0);
    mixedNormal += terrainLayerNormal(resolvedNormal, 0, splatTextureCoordinates[0]) * resolvedSplatWeights0.x;
    mixedNormal += terrainLayerNormal(resolvedNormal, 1, splatTextureCoordinates[1]) * resolvedSplatWeights0.y;
    mixedNormal += terrainLayerNormal(resolvedNormal, 2, splatTextureCoordinates[2]) * resolvedSplatWeights0.z;
    mixedNormal += terrainLayerNormal(resolvedNormal, 3, splatTextureCoordinates[3]) * resolvedSplatWeights0.w;
    mixedNormal += terrainLayerNormal(resolvedNormal, 4, splatTextureCoordinates[4]) * resolvedSplatWeights1.x;
    mixedNormal += terrainLayerNormal(resolvedNormal, 5, splatTextureCoordinates[5]) * resolvedSplatWeights1.y;
    mixedNormal += terrainLayerNormal(resolvedNormal, 6, splatTextureCoordinates[6]) * resolvedSplatWeights1.z;
    mixedNormal += terrainLayerNormal(resolvedNormal, 7, splatTextureCoordinates[7]) * resolvedSplatWeights1.w;
    if (length(mixedNormal) > 0.000001) resolvedNormal = normalize(mixedNormal);
  }
  float diffuse = max(0.0, dot(resolvedNormal, normalize(-lightDirection)));
  float shadow = directionalShadow(resolvedNormal);
  bool terrainSurface = splatTextured > 0.5 || terrainDecal > 0.5;
  float ao = terrainSurface ? vertexColor.a : 1.0;
  float diffuseScale = terrainSurface ? terrainLighting.y : 1.0;
  vec3 lighting = ambientColor * ambientIntensity * ao + lightColor * lightIntensity * diffuse * shadow * diffuseScale * mix(1.0, ao, keyUsesVertexAo);
  // Fill and back lights: diffuse only. The depth map belongs to the key light, and SC2's rig casts
  // one shadow too. Unrolled with constant indices: indexing these uniform arrays by a loop variable
  // silently contributed nothing through ANGLE/D3D11, while constant indices read them correctly.
  lighting += fillLight(resolvedNormal, fillLightDirection0, fillLightRadiance0) * diffuseScale * mix(1.0, ao, fillUsesVertexAo0);
  lighting += fillLight(resolvedNormal, fillLightDirection1, fillLightRadiance1) * diffuseScale * mix(1.0, ao, fillUsesVertexAo1);
  vec4 surface = vertexColor;
  float terrainSpecular = 0.0;
  // A terrain surface's colour alpha is its AO; a decal's red is its coverage at the cell's corners,
  // multiplied by texture alpha unless the publisher specifies coverage alone.
  if (terrainDecal > 0.5) surface = vec4(1.0, 1.0, 1.0, vertexColor.r);
  else if (terrainSurface) surface.a = 1.0;
  if (textured > 0.5) surface *= baseColorSample(textureCoordinate);
  if (terrainDecal > 0.5 && terrainDecalCoverageOnly > 0.5) surface.a = vertexColor.r;
  if (teamColorMode > 0.5) {
    vec3 teamMask = vec3(1.0);
    vec3 team = teamColor;
    if (teamColorMode > 1.5)
      teamMask = modkitTeamMask(secondaryColorMap, textureCoordinate, teamMaskMode, teamMaskChannel,
        teamKey, teamKeyIntensity, teamRamp, teamRampCount, teamRampFirst, teamRampScale, teamTintRgb, team);
    surface.rgb = modkitTeamColor(surface.rgb, teamMask, team, int(teamBlend + 0.5), teamStrength);
  }
  if (secondaryTextured > 0.5) {
    float secondarySurface = texture(secondaryColorMap, secondaryTextureCoordinate).r;
    surface.rgb *= secondarySurface;
  }
  if (splatTextured > 0.5) {
    vec4 mixedSurface = vec4(0.0);
    // glTF baseColorFactor multiplies each layer's colour; its alpha (SC2 specular) stays as read.
    mixedSurface += terrainLayerSample(terrainMaps, 0, splatTextureCoordinates[0]) * vec4(terrainLayerColor[0].rgb, 1.0) * resolvedSplatWeights0.x;
    mixedSurface += terrainLayerSample(terrainMaps, 1, splatTextureCoordinates[1]) * vec4(terrainLayerColor[1].rgb, 1.0) * resolvedSplatWeights0.y;
    mixedSurface += terrainLayerSample(terrainMaps, 2, splatTextureCoordinates[2]) * vec4(terrainLayerColor[2].rgb, 1.0) * resolvedSplatWeights0.z;
    mixedSurface += terrainLayerSample(terrainMaps, 3, splatTextureCoordinates[3]) * vec4(terrainLayerColor[3].rgb, 1.0) * resolvedSplatWeights0.w;
    mixedSurface += terrainLayerSample(terrainMaps, 4, splatTextureCoordinates[4]) * vec4(terrainLayerColor[4].rgb, 1.0) * resolvedSplatWeights1.x;
    mixedSurface += terrainLayerSample(terrainMaps, 5, splatTextureCoordinates[5]) * vec4(terrainLayerColor[5].rgb, 1.0) * resolvedSplatWeights1.y;
    mixedSurface += terrainLayerSample(terrainMaps, 6, splatTextureCoordinates[6]) * vec4(terrainLayerColor[6].rgb, 1.0) * resolvedSplatWeights1.z;
    mixedSurface += terrainLayerSample(terrainMaps, 7, splatTextureCoordinates[7]) * vec4(terrainLayerColor[7].rgb, 1.0) * resolvedSplatWeights1.w;
    // SC2 TerrainBlend_CopyTerrainSpec reads diffuse alpha as specular, not coverage.
    terrainSpecular = mixedSurface.a;
    surface.rgb *= mixedSurface.rgb;
    surface.a = terrainWeightOverlay > 0.5 ? clamp(rasterCoverage, 0.0, 1.0) : 1.0;
  }
  if (cliffMaskMode > 0.5 && dot(texture(secondaryColorMap, secondaryTextureCoordinate), cliffMaskSelector) >= 0.5)
    discard;
  vec3 causticsLight = vec3(0.0);
  if (waterDepthMode > 0.5) {
    // The shoreline is where the drawn scene rises through the plane (cliff meshes included), and
    // the colour deepens with the water over whatever lies under the pixel - SC2 water reads the
    // scene depth the same way. Same saturation and shore fade as the per-vertex water colour.
    float sceneDepth = texelFetch(sceneDepthMap, ivec2(gl_FragCoord.xy), 0).r;
    float waterDepth = waterAlongRay(sceneDepth, gl_FragCoord.z) * waterDepthScale.y;
    if (waterDepth <= 0.0) discard;
    float saturation = 1.0 - exp(-waterDepth * waterFalloff);
    surface = vec4(
      vertexColor.rgb * (1.0 - 0.35 * saturation),
      (vertexColor.a + (1.0 - vertexColor.a) * saturation) * min(1.0, waterDepth / waterShoreFade)
    );
    if (causticsMode > 0.5) {
      // SC2 Water.fx: the bottom under the pixel, along the view ray; the flip-book frame by its map
      // position (v flipped as the game does), shadowed, stronger with depth up to 1.
      float along = waterAlongRay(sceneDepth, gl_FragCoord.z);
      vec3 bottom = worldPosition + waterViewForward * along;
      vec2 causticsUv = causticsScale * vec2(bottom.x, -bottom.z);
      causticsUv.y = 1.0 - causticsUv.y;
      causticsLight = texture(causticsMap, causticsUv).rgb * shadow * clamp(causticsFalloff * along, 0.0, 1.0);
    }
  }
  if (alphaCutoff > 0.0 && surface.a < alphaCutoff) discard;
  vec3 specular = vec3(0.0);
  if (terrainSurface && terrainLighting.z > 0.0) {
    vec3 specColor = vec3(terrainSpecular);
    if (terrainDecal > 0.5) {
      specColor = terrainDecalSpecularTextured > 0.5
        ? texture(terrainDecalSpecularMap, textureCoordinate).rgb
        : vec3(0.0);
    } else if (terrainSpecularTextured > 0.5) {
      specColor = vec3(0.0);
      for (int layer = 0; layer < 8; layer++) {
        float weight = layerValue(resolvedSplatWeights0, resolvedSplatWeights1, layer);
        if (weight > 0.0) specColor += terrainLayerSample(terrainSpecularMaps, layer, splatTextureCoordinates[layer]).rgb * weight;
      }
    }
    vec3 view = normalize(eyePosition - worldPosition);
    vec3 key = normalize(-lightDirection);
    float highlight = max(dot(resolvedNormal, normalize(view + key)), 0.0);
    if (terrainSpecularGloss > 0.5) {
      // Warzone 2100 terrain_combined_high.frag: a glossier texel widens the lobe (light.glsl
      // blinnTerm, exponent terrainLighting.x (1 - g^2)), weighted by g^2 and the shadowed diffuse.
      float glossSquared = specColor.r * specColor.r;
      float lobe = clamp(pow(max(highlight, 0.000001), terrainLighting.x * (1.0 - glossSquared)), 0.0, 1.0);
      specular = vec3(glossSquared * lobe * diffuse * shadow) * terrainLighting.z * lightSpecularRadiance;
    } else {
      float exponent = max(terrainLighting.x, 1.0);
      // Specular comes from the key light only: SC2 Lighting.fx adds the other directional lights
      // with useSpecular false (their diffuse carries the ambient occlusion instead).
      specular = specColor * terrainLighting.z * lightSpecularRadiance * pow(highlight, exponent) * step(0.000001, diffuse) * shadow;
    }
  }
  if (waterWavesMode > 0.5 && waterSpecular.y > 0.0) {
    // Water.fx adds the key light's highlight on the wave normal, times SpecularScaler, over the
    // blend: divided by alpha here so the blend leaves it whole.
    vec3 view = normalize(eyePosition - worldPosition);
    vec3 key = normalize(-lightDirection);
    specular = lightSpecularRadiance * pow(max(dot(resolvedNormal, normalize(view + key)), 0.0), max(waterSpecular.x, 1.0)) * step(0.000001, diffuse) * shadow * waterSpecular.y / max(surface.a, 0.001);
  }
  // Caustics add to the bottom seen through the water, and SC2 lights that refraction by the
  // surface's diffuse light; blended under this surface they are the share of what shows through.
  vec3 causticsShare = causticsLight * lighting * (1.0 - surface.a) / max(surface.a, 0.001);
  if (unlitSurface > 0.5) {
    outColor = surface;
    return;
  }
  outColor = vec4(surface.rgb * lighting + specular + causticsShare, surface.a);
}`

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (shader === null) throw new TypeError('WebGL could not allocate a world shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'unknown shader error'
    gl.deleteShader(shader)
    throw new TypeError(`world WebGL shader compilation failed: ${message}`)
  }
  return shader
}

function createProgram(gl: WebGL2RenderingContext) {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = gl.createProgram()
  if (program === null) throw new TypeError('WebGL could not allocate a world program')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'unknown program error'
    gl.deleteProgram(program)
    throw new TypeError(`world WebGL program link failed: ${message}`)
  }
  return program
}

const SHADOW_VERTEX_SHADER = `#version 300 es
in vec3 position;
in vec2 uv;
uniform mat4 lightViewProjection;
out vec2 textureCoordinate;
void main() {
  textureCoordinate = uv;
  gl_Position = lightViewProjection * vec4(position, 1.0);
}`

const SHADOW_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 textureCoordinate;
uniform sampler2D baseColorMap;
uniform float alphaCutoff;
void main() {
  if (alphaCutoff > 0.0 && texture(baseColorMap, textureCoordinate).a < alphaCutoff) discard;
}
`

interface WorldShadowResources {
  readonly framebuffer: WebGLFramebuffer
  readonly texture: WebGLTexture
  readonly viewProjection: Float32Array
  readonly size: number
}

interface WorldWebGlOwnedResources {
  readonly gl: WebGL2RenderingContext
  readonly program: WebGLProgram
  readonly shadowProgram: WebGLProgram
  toneMapper: ReturnType<typeof createWorldToneMapper>
  shadowTarget:
    | Readonly<{
        framebuffer: WebGLFramebuffer
        texture: WebGLTexture
        size: number
      }>
    | undefined
  /**
   * Depth of the shadow casters that stayed as they were, alone: kept for the light view and the
   * casters it was drawn with (see renderWorldShadowMap). Its target outlives a change of them.
   */
  shadowKept:
    | Readonly<{
        framebuffer: WebGLFramebuffer
        texture: WebGLTexture
        size: number
        viewProjection: Float32Array | undefined
        casters: readonly (readonly unknown[])[]
      }>
    | undefined
  /** The keys of the last shadow map's casters, by element (see worldShadowKeysAdd). */
  shadowCasterKeys: Map<unknown, unknown> | undefined
  frames: number
  programCompilations: number
  shadowTargetAllocations: number
  shadowTargetReuses: number
  worldPlanBuilds: number
  worldPlanReuses: number
  worldPlanDynamicUpdates: number
  worldObjectsKept: number
  worldObjectsBuilt: number
  worldPosedSamples: number
  worldObjectsUnposed: number
  worldPlanViewRebuilds: number
  readonly worldPlanBuildMilliseconds: number[]
  readonly worldPlanDynamicUpdateMilliseconds: number[]
  readonly animationSeekMilliseconds: number[]
  lastPlanInput: WorldWebGlInput | undefined
  lastPlan: WorldWebGlPlan | undefined
  readonly geometry: Map<object, Map<WebGLProgram, WorldWebGlGeometryEntry>>
  readonly usedGeometry: Set<WorldWebGlGeometryEntry>
  readonly indexBuffers: Map<Uint32Array, WebGLBuffer>
  readonly usedIndexBuffers: Set<Uint32Array>
  geometryUploads: number
  geometryCacheHits: number
  geometryDisposals: number
  /** Keyed by content (`worldTextureKey`): model instances revived or converted apart share one upload. */
  readonly textures: Map<string, WorldWebGlTextureEntry>
  readonly textureArrays: Map<object, WorldWebGlTextureEntry>
  readonly usedTextures: Set<WorldWebGlTextureEntry>
  /** By texture object: one texture path can arrive at different reduced sizes per model. */
  readonly materialTextureHandles: Map<SceneRendererTexture, WebGLTexture>
  materialDraws: ReturnType<typeof materialWebGlDraws>
  materialPlan: WorldWebGlPlan | undefined
  retiredMaterialProgramCompilations: number
  retiredMaterialDrawCalls: number
  /** The material counters (MaterialWebGlDraws.counters) of the material path disposed. */
  retiredMaterialCounters: Readonly<{
    vertexArraysCreated: number
    buffersCreated: number
    placementsDrawn: number
  }>
  sentinelTexture: WorldWebGlTextureEntry | undefined
  textureUploads: number
  textureCacheHits: number
  textureDisposals: number
  readonly cpuFrameMilliseconds: number[]
  readonly gpuFrameMilliseconds: number[]
  readonly gpuTimer:
    | Readonly<{
        TIME_ELAPSED_EXT: number
        GPU_DISJOINT_EXT: number
      }>
    | undefined
  pendingGpuQuery: WebGLQuery | undefined
  disposed: boolean
}

interface WorldWebGlGeometryEntry {
  readonly key: object
  readonly program: WebGLProgram
  readonly vao: WebGLVertexArrayObject
  readonly buffers: readonly WebGLBuffer[]
  readonly count: number
  readonly bytes: number
}

interface WorldWebGlTextureEntry {
  readonly key: object
  readonly handle: WebGLTexture
  readonly target: number
  readonly bytes: number
}

const WORLD_WEBGL_PERFORMANCE_SAMPLE_LIMIT = 240

function retainPerformanceSample(target: number[], value: number): void {
  if (!Number.isFinite(value) || value < 0) return
  target.push(value)
  if (target.length > WORLD_WEBGL_PERFORMANCE_SAMPLE_LIMIT) target.shift()
}

/**
 * The values at `fractions` of the way through `values` in order (the nearest rank), from one sort:
 * the samples are finite and not negative (retainPerformanceSample), so a numeric typed sort orders
 * them as comparing them does. A renderer's stats() takes ten of them, and a caller may read its
 * stats every frame (the RTS preview does).
 */
function percentiles(values: readonly number[], ...fractions: number[]): (number | undefined)[] {
  if (values.length === 0) return fractions.map(() => undefined)
  const ordered = Float64Array.from(values).sort()
  return fractions.map(
    fraction => ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)],
  )
}

function harvestGpuTimer(resources: WorldWebGlOwnedResources): void {
  const query = resources.pendingGpuQuery
  const timer = resources.gpuTimer
  if (query === undefined || timer === undefined || resources.disposed) return
  const available = resources.gl.getQueryParameter(query, resources.gl.QUERY_RESULT_AVAILABLE)
  if (available !== true) return
  const disjoint = resources.gl.getParameter(timer.GPU_DISJOINT_EXT) === true
  if (!disjoint) {
    const nanoseconds = Number(resources.gl.getQueryParameter(query, resources.gl.QUERY_RESULT))
    retainPerformanceSample(resources.gpuFrameMilliseconds, nanoseconds / 1_000_000)
  }
  resources.gl.deleteQuery(query)
  resources.pendingGpuQuery = undefined
}

function deleteGeometryEntry(
  resources: WorldWebGlOwnedResources,
  entry: WorldWebGlGeometryEntry,
): void {
  for (const buffer of entry.buffers) resources.gl.deleteBuffer(buffer)
  resources.gl.deleteVertexArray(entry.vao)
  resources.geometryDisposals += 1
}

function sweepGeometry(resources: WorldWebGlOwnedResources): void {
  for (const [key, programs] of resources.geometry) {
    for (const [program, entry] of programs) {
      if (resources.usedGeometry.has(entry)) continue
      deleteGeometryEntry(resources, entry)
      programs.delete(program)
    }
    if (programs.size === 0) resources.geometry.delete(key)
  }
  resources.usedGeometry.clear()
  for (const [indices, buffer] of resources.indexBuffers) {
    if (resources.usedIndexBuffers.has(indices)) continue
    resources.gl.deleteBuffer(buffer)
    resources.indexBuffers.delete(indices)
  }
  resources.usedIndexBuffers.clear()
}

function geometryResourceTotals(resources: WorldWebGlOwnedResources): {
  entries: number
  bytes: number
} {
  let entries = 0
  let bytes = 0
  for (const programs of resources.geometry.values()) {
    for (const entry of programs.values()) {
      entries += 1
      bytes += entry.bytes
    }
  }
  return { entries, bytes }
}

function deleteTextureEntry(
  resources: WorldWebGlOwnedResources,
  entry: WorldWebGlTextureEntry,
): void {
  resources.gl.deleteTexture(entry.handle)
  resources.textureDisposals += 1
}

function sweepTextures(resources: WorldWebGlOwnedResources): void {
  for (const [key, entry] of resources.textures) {
    if (resources.usedTextures.has(entry)) continue
    deleteTextureEntry(resources, entry)
    resources.textures.delete(key)
  }
  for (const [key, entry] of resources.textureArrays) {
    if (resources.usedTextures.has(entry)) continue
    deleteTextureEntry(resources, entry)
    resources.textureArrays.delete(key)
  }
  // The 1×1 sentinel is shared by all missing weight-map units for the renderer lifetime.
  resources.usedTextures.clear()
}

function textureResourceTotals(resources: WorldWebGlOwnedResources): {
  entries: number
  bytes: number
} {
  let entries = resources.sentinelTexture === undefined ? 0 : 1
  let bytes = resources.sentinelTexture?.bytes ?? 0
  for (const entry of resources.textures.values()) {
    entries += 1
    bytes += entry.bytes
  }
  for (const entry of resources.textureArrays.values()) {
    entries += 1
    bytes += entry.bytes
  }
  return { entries, bytes }
}

const worldTextureKeys = new WeakMap<SceneRendererTexture, string>()

/**
 * Content identity of a world texture: id, size, sampling and a sparse byte checksum, so equal
 * textures held by different objects (per-model copies, revived payload slices) upload once and a
 * reused id with different pixels still gets its own texture.
 */
function worldTextureKey(texture: SceneRendererTexture): string {
  let key = worldTextureKeys.get(texture)
  if (key === undefined) {
    const bytes = texture.compressed?.subresources[0]?.data ?? texture.rgba
    const step = Math.max(1, Math.floor(bytes.length / WORLD_TEXTURE_KEY_SAMPLES))
    let checksum = 0
    for (let offset = 0; offset < bytes.length; offset += step)
      checksum = (Math.imul(checksum, 31) + bytes[offset]!) | 0
    key = [
      texture.id,
      texture.width,
      texture.height,
      texture.wrapU,
      texture.wrapV,
      texture.filter,
      texture.compressed?.format ?? 'rgba8',
      checksum,
    ].join('|')
    worldTextureKeys.set(texture, key)
  }
  return key
}

/**
 * The scalar value each uniform of the world's own programs holds, by program and location. Batch
 * draws of the opaque, water, shadow and composite passes set their flags and sampler units before
 * every draw (`textured`, `normalTextured`, `alphaCutoff`, `shadowReceiver`, `baseColorMap` …) — on
 * Amphion ~17 000 calls a frame, mostly the value the program already holds. A uniform's value is
 * the state of its program, and only these two functions write the scalar uniforms of the world's
 * programs (nothing else writes them at all), so a value the program holds needs no call. The
 * location belongs to the program in use, as every write here already required.
 */
const worldScalarUniforms = new WeakMap<WebGLProgram, Map<WebGLUniformLocation, number>>()

function heldWorldUniforms(program: WebGLProgram): Map<WebGLUniformLocation, number> {
  let held = worldScalarUniforms.get(program)
  if (held === undefined) worldScalarUniforms.set(program, (held = new Map()))
  return held
}

function worldUniform1f(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  value: number,
): void {
  const location = uniformLocation(gl, program, name)
  // A null location takes no value: WebGL ignores the write.
  if (location === null) return
  const held = heldWorldUniforms(program)
  // The program keeps the float32 of the value; -0 and NaN compare as themselves.
  const stored = Math.fround(value)
  if (Object.is(held.get(location), stored)) return
  gl.uniform1f(location, value)
  held.set(location, stored)
}

function worldUniform1i(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  value: number,
): void {
  const location = uniformLocation(gl, program, name)
  if (location === null) return
  const held = heldWorldUniforms(program)
  // WebGL converts a GLint argument as ToInt32.
  const stored = value | 0
  if (held.get(location) === stored) return
  gl.uniform1i(location, value)
  held.set(location, stored)
}

const SCENE_ENVIRONMENT_TEXTURES = Object.freeze([DEFAULT_SCENE_ENVIRONMENT])

/** Uploads once by content and binds a material texture: a 2D image, or a cube map of six faces. */
function bindTexture2d(
  resources: WorldWebGlOwnedResources,
  texture: SceneRendererTexture,
  unit: number,
): WebGLTexture {
  const cube = texture.dimension === 'cube'
  if (
    texture.width <= 0 ||
    texture.height <= 0 ||
    (cube && texture.compressed !== undefined) ||
    (texture.compressed === undefined &&
      texture.rgba.byteLength !== texture.width * texture.height * 4 * (cube ? 6 : 1))
  )
    throw new TypeError(`world texture ${texture.id} is not tightly packed RGBA8`)
  const gl = resources.gl
  const contentKey = worldTextureKey(texture)
  let entry = resources.textures.get(contentKey)
  if (entry === undefined && cube) {
    const handle = gl.createTexture()
    if (handle === null) throw new TypeError('WebGL could not allocate a world texture')
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, handle)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    const faceBytes = texture.width * texture.height * 4
    for (let face = 0; face < 6; face++)
      gl.texImage2D(
        gl.TEXTURE_CUBE_MAP_POSITIVE_X + face,
        0,
        gl.RGBA,
        texture.width,
        texture.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        texture.rgba.subarray(face * faceBytes, (face + 1) * faceBytes),
      )
    for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R])
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, wrap, gl.CLAMP_TO_EDGE)
    applyTextureFilter(gl, gl.TEXTURE_CUBE_MAP, texture.filter === 'nearest' ? 'nearest' : 'linear')
    entry = Object.freeze({
      key: texture,
      handle,
      target: gl.TEXTURE_CUBE_MAP,
      bytes: faceBytes * 6,
    })
    resources.textures.set(contentKey, entry)
    resources.textureUploads += 1
  } else if (entry === undefined) {
    const handle = gl.createTexture()
    if (handle === null) throw new TypeError('WebGL could not allocate a world texture')
    try {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, handle)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      const filter = texture.filter === 'nearest' ? 'nearest' : 'linear'
      // Stored blocks with their stored levels, as the file holds them; texels where the context or
      // the format cannot take them, with mips generated as before.
      const blocks = uploadCompressedTexture(gl, texture, filter)
      if (!blocks) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          texture.width,
          texture.height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          sceneTexturePixels(texture),
        )
        applyTextureFilter(gl, gl.TEXTURE_2D, filter)
      }
      const wrap = (value: string | undefined) => (value === 'clamp' ? gl.CLAMP_TO_EDGE : gl.REPEAT)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap(texture.wrapU))
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap(texture.wrapV))
      entry = Object.freeze({
        key: texture,
        handle,
        target: gl.TEXTURE_2D,
        bytes: blocks ? sceneTextureByteLength(texture) : texture.width * texture.height * 4,
      })
      resources.textures.set(contentKey, entry)
      resources.textureUploads += 1
    } catch (error) {
      gl.deleteTexture(handle)
      throw error
    }
  } else {
    resources.textureCacheHits += 1
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(entry.target, entry.handle)
  }
  resources.usedTextures.add(entry)
  return entry.handle
}

function bindSentinelTexture2d(resources: WorldWebGlOwnedResources, unit: number): void {
  const gl = resources.gl
  let entry = resources.sentinelTexture
  if (entry === undefined) {
    const handle = gl.createTexture()
    if (handle === null) throw new TypeError('WebGL could not allocate a terrain sampler sentinel')
    const key = Object.freeze({ kind: 'world-weight-sentinel' })
    entry = Object.freeze({ key, handle, target: gl.TEXTURE_2D, bytes: 4 })
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, handle)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      Uint8Array.of(255, 0, 0, 0),
    )
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    resources.sentinelTexture = entry
    resources.textureUploads += 1
  } else {
    resources.textureCacheHits += 1
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, entry.handle)
  }
  resources.usedTextures.add(entry)
}

function sameArrayIdentity(
  left: readonly unknown[] | undefined,
  right: readonly unknown[] | undefined,
): boolean {
  if (left === right) return true
  if (left === undefined || right === undefined || left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function sameNumberMap(
  left: ReadonlyMap<number, number> | undefined,
  right: ReadonlyMap<number, number> | undefined,
): boolean {
  if (left === right) return true
  if (left === undefined || right === undefined || left.size !== right.size) return false
  for (const [key, value] of left) if (right.get(key) !== value) return false
  return true
}

function samePreviewPosition(
  left: WorldWebGlInput['previewPosition'],
  right: WorldWebGlInput['previewPosition'],
): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.x === right.x &&
      left.y === right.y &&
      left.z === right.z)
  )
}

/** Snapshot collection membership; entries and typed arrays follow the immutable world contract. */
function snapshotWorldPlanInput(input: WorldWebGlInput): WorldWebGlInput {
  return {
    ...input,
    items: [...input.items],
    ...(input.models === undefined ? {} : { models: new Map(input.models) }),
    ...(input.terrainMaterials === undefined
      ? {}
      : { terrainMaterials: [...input.terrainMaterials] }),
    ...(input.terrainWeightRasters === undefined
      ? {}
      : { terrainWeightRasters: [...input.terrainWeightRasters] }),
    ...(input.terrainTextures === undefined
      ? {}
      : { terrainTextures: new Map(input.terrainTextures) }),
    ...(input.waterMaterials === undefined ? {} : { waterMaterials: [...input.waterMaterials] }),
    ...(input.animationTimes === undefined
      ? {}
      : { animationTimes: new Map(input.animationTimes) }),
    ...(input.teamColors === undefined ? {} : { teamColors: new Map(input.teamColors) }),
    ...(input.teamRamps === undefined ? {} : { teamRamps: new Map(input.teamRamps) }),
    ...(input.previewPosition === undefined
      ? {}
      : { previewPosition: { ...input.previewPosition } }),
  }
}

/** Whether two maps hold the same keys, whatever their values (an absent map holds none). */
function sameMapKeys(
  left: ReadonlyMap<unknown, unknown> | undefined,
  right: ReadonlyMap<unknown, unknown> | undefined,
): boolean {
  if (left === right) return true
  if ((left?.size ?? 0) !== (right?.size ?? 0)) return false
  if (left === undefined || right === undefined) return true
  for (const key of left.keys()) if (!right.has(key)) return false
  return true
}

function sameWorldMap<K, V>(
  left: ReadonlyMap<K, V> | undefined,
  right: ReadonlyMap<K, V> | undefined,
): boolean {
  if (left === right) return true
  if (left === undefined || right === undefined || left.size !== right.size) return false
  for (const [key, value] of left) if (right.get(key) !== value) return false
  return true
}

/** Every non-clock input affecting generated geometry, materials or presentation. */
function sameWorldPlanInputExceptAnimationTimes(
  left: WorldWebGlInput,
  right: WorldWebGlInput,
): boolean {
  return (
    sameArrayIdentity(left.items, right.items) &&
    sameWorldMap(left.models, right.models) &&
    sameArrayIdentity(left.terrainMaterials, right.terrainMaterials) &&
    sameArrayIdentity(left.terrainWeightRasters, right.terrainWeightRasters) &&
    sameWorldMap(left.terrainTextures, right.terrainTextures) &&
    sameArrayIdentity(left.waterMaterials, right.waterMaterials) &&
    left.selectedObjectId === right.selectedObjectId &&
    samePreviewPosition(left.previewPosition, right.previewPosition) &&
    sameWorldMap(left.teamColors, right.teamColors) &&
    sameWorldMap(left.teamRamps, right.teamRamps)
  )
}

function sameWorldPlanInput(left: WorldWebGlInput, right: WorldWebGlInput): boolean {
  // Default model clips and sequence-only material/effect animations also consume this clock. It
  // is what an animated frame changes, so it is compared before the object list.
  return (
    (left.timeSeconds ?? 0) === (right.timeSeconds ?? 0) &&
    sameNumberMap(left.animationTimes, right.animationTimes) &&
    sameWorldPlanInputExceptAnimationTimes(left, right) &&
    // a camera-facing node draws differently as the camera turns
    (!worldInputFacesCamera(right) ||
      worldCameraTurnKey(left.camera) === worldCameraTurnKey(right.camera))
  )
}

/**
 * Whether the terrain preparation (`prepareWorldStaticTerrain`) of `left` serves `right`: it reads
 * the items, the terrain materials, textures and weight rasters, and of the models only the cliff
 * pieces (their results, placements and, for animated geometry, clocks). Loading the other models,
 * selecting or recolouring an object keeps it: each model-loading tick re-prepared the whole terrain.
 */
/**
 * The previous plan's input and the new input while retainedWorldPlan builds a plan whose inputs,
 * the clocks aside, it found to be the same: the static part need not compare them again.
 */
let worldInputsCompared: Readonly<{ previous: WorldWebGlInput; input: WorldWebGlInput }> | undefined

/** The cliff pieces among a list of items, in order: kept with the list. */
const worldCliffItemLists = new WeakMap<
  readonly WorldSceneItem[],
  readonly WorldSceneObjectItem[]
>()
function worldCliffItems(items: readonly WorldSceneItem[]): readonly WorldSceneObjectItem[] {
  let cliffs = worldCliffItemLists.get(items)
  if (cliffs === undefined)
    worldCliffItemLists.set(
      items,
      (cliffs = items.filter(
        (item): item is WorldSceneObjectItem =>
          item.facet === 'objects' &&
          item.resourceId !== undefined &&
          item.derivedFrom === 'cliffs',
      )),
    )
  return cliffs
}

/**
 * The items a terrain preparation reads (prepareWorldStaticTerrain): all but the objects, and of the
 * objects the cliff pieces and those whose models show the ground on their surface. Any other object
 * that enters or leaves the list, or comes as a new item (a unit walking into view, changing clip),
 * leaves the preparation, and every object kept by it, as they are.
 */
function worldStaticItems(input: WorldWebGlInput): readonly WorldSceneItem[] {
  return input.items.filter(
    item =>
      item.facet !== 'objects' ||
      (item.resourceId !== undefined &&
        (item.derivedFrom === 'cliffs' ||
          terrainProjectionMaterialIds(input.models?.get(item.resourceId)).size > 0)),
  )
}

function sameWorldStaticInput(left: WorldWebGlInput, right: WorldWebGlInput): boolean {
  const compared = worldInputsCompared?.previous === left && worldInputsCompared.input === right
  const staticItems = compared ? undefined : worldStaticItems(right)
  if (
    staticItems !== undefined &&
    (!sameArrayIdentity(worldStaticItems(left), staticItems) ||
      !sameArrayIdentity(left.terrainMaterials, right.terrainMaterials) ||
      !sameArrayIdentity(left.terrainWeightRasters, right.terrainWeightRasters) ||
      !sameWorldMap(left.terrainTextures, right.terrainTextures))
  )
    return false
  // With the same model results (inputs found the same but for the clocks) only the cliff pieces
  // can differ: their clocks.
  const items = staticItems ?? worldCliffItems(right.items)
  for (const item of items) {
    if (item.facet !== 'objects' || item.resourceId === undefined) continue
    if (item.derivedFrom !== 'cliffs') {
      // A model that shows the ground on its surface draws with the terrain: its arrival renews it.
      const before = left.models?.get(item.resourceId)
      const after = right.models?.get(item.resourceId)
      if (
        before !== after &&
        (terrainProjectionMaterialIds(before).size > 0 ||
          terrainProjectionMaterialIds(after).size > 0)
      )
        return false
      continue
    }
    const model = right.models?.get(item.resourceId)
    if (model !== left.models?.get(item.resourceId)) return false
    const [lx, ly, lz] = objectPosition(item, left)
    const [rx, ry, rz] = objectPosition(item, right)
    if (lx !== rx || ly !== ry || lz !== rz) return false
    // Cliff caps are sampled model geometry. A changed cliff clock must regenerate both caps and
    // neighbouring terrain. Material-only/empty clips do not alter the sampled cap geometry.
    if (model?.state !== 'converted' || !worldModelHasAnimatedGeometry(model, item)) continue
    if (worldObjectTime(left, item, true) !== worldObjectTime(right, item, true)) return false
  }
  return true
}

/**
 * The plan to draw `input` with: the last one while its input is the same and the view it is drawn
 * with (`viewOf`) sees no object it left unposed, else one made from it. A plan is made for the view
 * of the plan before (whose frame and light the new one keeps while only clocks move) and made again,
 * once, when its own view sees an object it left unposed.
 */
function retainedWorldPlan(
  input: WorldWebGlInput,
  resources: WorldWebGlOwnedResources,
  viewOf?: (plan: WorldWebGlPlan) => WorldPosingView | undefined,
): WorldWebGlPlan {
  if (
    resources.lastPlan !== undefined &&
    resources.lastPlanInput !== undefined &&
    sameWorldPlanInput(resources.lastPlanInput, input)
  ) {
    const last = resources.lastPlan
    if (viewOf === undefined || !worldPlanUnposedSeen(last, viewOf(last))) {
      resources.worldPlanReuses += 1
      return last
    }
    resources.worldPlanViewRebuilds += 1
  }
  const previousInput = resources.lastPlanInput
  // Only the clocks moved (an animated frame): the new plan's static part need not compare again.
  const sameExceptClocks =
    previousInput !== undefined && sameWorldPlanInputExceptAnimationTimes(previousInput, input)
  const animationSeek =
    sameExceptClocks && !sameNumberMap(previousInput.animationTimes, input.animationTimes)
  const previousPreparation =
    resources.lastPlan === undefined
      ? undefined
      : worldStaticPreparations.get(resources.lastPlan)?.preparation
  const startedAt = globalThis.performance?.now() ?? Date.now()
  let plan: WorldWebGlPlan
  try {
    if (sameExceptClocks) worldInputsCompared = Object.freeze({ previous: previousInput, input })
    const lastPlan = resources.lastPlan
    plan = createWorldWebGlPlan(
      input,
      lastPlan,
      viewOf === undefined || lastPlan === undefined ? undefined : viewOf(lastPlan),
    )
    if (viewOf !== undefined) {
      const view = viewOf(plan)
      if (worldPlanUnposedSeen(plan, view)) {
        resources.worldPlanViewRebuilds += 1
        plan = createWorldWebGlPlan(input, lastPlan, view)
      }
    }
  } finally {
    worldInputsCompared = undefined
  }
  const elapsed = (globalThis.performance?.now() ?? Date.now()) - startedAt
  if (
    previousPreparation !== undefined &&
    worldStaticPreparations.get(plan)?.preparation === previousPreparation
  ) {
    resources.worldPlanDynamicUpdates += 1
    retainPerformanceSample(resources.worldPlanDynamicUpdateMilliseconds, elapsed)
  } else {
    resources.worldPlanBuilds += 1
    retainPerformanceSample(resources.worldPlanBuildMilliseconds, elapsed)
  }
  if (animationSeek) retainPerformanceSample(resources.animationSeekMilliseconds, elapsed)
  const work = worldPlanWork.get(plan)
  if (work !== undefined) {
    resources.worldObjectsKept += work.keptObjects
    resources.worldObjectsBuilt += work.builtObjects
    resources.worldPosedSamples += work.posedSamples
    resources.worldObjectsUnposed += work.unposedObjects
  }
  resources.lastPlanInput = worldStaticPreparations.get(plan)!.input
  resources.lastPlan = plan
  return plan
}
/** Each plan's retained bytes: a plan does not change, and a viewer may ask for stats() each frame. */
const worldPlanBytes = new WeakMap<WorldWebGlPlan, number>()

function retainedWorldPlanBytes(plan: WorldWebGlPlan | undefined): number {
  if (plan === undefined) return 0
  const known = worldPlanBytes.get(plan)
  if (known !== undefined) return known
  const buffers = new Set<ArrayBufferLike>()
  const retain = (value: ArrayBufferView | undefined): void => {
    if (value !== undefined) buffers.add(value.buffer)
  }
  const retainBatch = (value: WorldWebGlBatch): void => {
    retain(value.positions)
    retain(value.normals)
    retain(value.colors)
  }
  retainBatch(plan.opaqueTriangles)
  // An appended fallback batch owns a new buffer while the static prefix stays cached separately.
  const preparation = worldStaticPreparations.get(plan)?.preparation
  if (preparation !== undefined) {
    retainBatch(preparation.opaqueTriangles)
    retainBatch(preparation.lines)
    retainBatch(preparation.points)
  }
  const skins = worldCurrentPrograms.get(plan)?.skins
  for (const scene of plan.modelMaterialScenes) {
    for (const primitive of scene.primitives) {
      const skin = materialSkinOf(primitive)
      retain(skin?.joints)
      retain(skin?.weights)
      retain(skin?.palette)
      // the pose a kept skin stands for in this plan
      retain(skin === undefined ? undefined : skins?.get(skin)?.palette)
      retain(primitive.positions)
      retain(primitive.normals)
      retain(primitive.tangents)
      retain(primitive.colors)
      retain(primitive.indices)
      retain(primitive.textureCoordinates)
      for (const coordinates of primitive.textureCoordinateSets ?? [])
        retain(coordinates.coordinates)
    }
    for (const texture of scene.textures) {
      retain(texture.rgba)
      for (const level of texture.compressed?.subresources ?? []) retain(level.data)
    }
  }
  for (const item of plan.shadowControlledOpaqueTriangles) retainBatch(item)
  for (const item of [
    ...plan.texturedTriangles,
    ...plan.transparentTexturedTriangles,
    ...plan.terrainDecalTriangles,
    ...plan.multipliedWaterTriangles,
  ]) {
    retainBatch(item)
    retain(item.textureCoordinates)
    retain(item.secondaryTextureCoordinates)
  }
  for (const item of [...plan.splatTriangles, ...plan.splatOverlayTriangles]) {
    retainBatch(item)
    retain(item.maskTextureCoordinates)
    for (const coordinates of item.textureCoordinates) retain(coordinates)
    retain(item.textureWeights0)
    retain(item.textureWeights1)
    retain(item.weightTextureCoordinates)
  }
  for (const item of [plan.transparentTriangles, plan.lines, plan.points]) retainBatch(item)
  for (const plane of plan.waterPlanes) retainBatch(plane.batch)
  retain(plan.picking.terrainTriangles)
  for (const item of plan.picking.objects) retain(item.triangles)
  let bytes = 0
  for (const buffer of buffers) bytes += buffer.byteLength
  worldPlanBytes.set(plan, bytes)
  return bytes
}

function createShadowProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertex = compile(gl, gl.VERTEX_SHADER, SHADOW_VERTEX_SHADER)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, SHADOW_FRAGMENT_SHADER)
  const program = gl.createProgram()
  if (program === null) {
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    throw new TypeError('WebGL2 could not allocate the world shadow program')
  }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'unknown shader error'
    gl.deleteProgram(program)
    throw new TypeError(`world shadow WebGL program link failed: ${message}`)
  }
  return program
}

function createOwnedResources(gl: WebGL2RenderingContext): WorldWebGlOwnedResources {
  const program = createProgram(gl)
  try {
    const materialTextureHandles = new Map<SceneRendererTexture, WebGLTexture>()
    return {
      gl,
      program,
      shadowProgram: createShadowProgram(gl),
      toneMapper: undefined,
      shadowTarget: undefined,
      shadowKept: undefined,
      shadowCasterKeys: undefined,
      frames: 0,
      programCompilations: 2,
      shadowTargetAllocations: 0,
      shadowTargetReuses: 0,
      worldPlanBuilds: 0,
      worldObjectsKept: 0,
      worldObjectsBuilt: 0,
      worldPosedSamples: 0,
      worldObjectsUnposed: 0,
      worldPlanViewRebuilds: 0,
      worldPlanReuses: 0,
      worldPlanDynamicUpdates: 0,
      worldPlanBuildMilliseconds: [],
      worldPlanDynamicUpdateMilliseconds: [],
      animationSeekMilliseconds: [],
      lastPlanInput: undefined,
      lastPlan: undefined,
      geometry: new Map(),
      usedGeometry: new Set(),
      indexBuffers: new Map(),
      usedIndexBuffers: new Set(),
      geometryUploads: 0,
      geometryCacheHits: 0,
      geometryDisposals: 0,
      textures: new Map(),
      textureArrays: new Map(),
      usedTextures: new Set(),
      materialTextureHandles,
      materialDraws: materialWebGlDraws(gl, texture => materialTextureHandles.get(texture), {
        mipmaps: true,
        checkEachDraw: false,
      }),
      materialPlan: undefined,
      retiredMaterialProgramCompilations: 0,
      retiredMaterialDrawCalls: 0,
      retiredMaterialCounters: { vertexArraysCreated: 0, buffersCreated: 0, placementsDrawn: 0 },
      sentinelTexture: undefined,
      textureUploads: 0,
      textureCacheHits: 0,
      textureDisposals: 0,
      cpuFrameMilliseconds: [],
      gpuFrameMilliseconds: [],
      gpuTimer:
        (gl.getExtension('EXT_disjoint_timer_query_webgl2') as
          WorldWebGlOwnedResources['gpuTimer'] | null) ?? undefined,
      pendingGpuQuery: undefined,
      disposed: false,
    }
  } catch (error) {
    gl.deleteProgram(program)
    throw error
  }
}

/** The material path's cumulative counters: the disposed path's and the live one's. */
function worldMaterialCounters(resources: WorldWebGlOwnedResources) {
  const retired = resources.retiredMaterialCounters
  if (resources.disposed) return retired
  const live = resources.materialDraws.counters()
  return Object.freeze({
    vertexArraysCreated: retired.vertexArraysCreated + live.vertexArraysCreated,
    buffersCreated: retired.buffersCreated + live.buffersCreated,
    placementsDrawn: retired.placementsDrawn + live.placementsDrawn,
  })
}

function disposeOwnedResources(resources: WorldWebGlOwnedResources): void {
  if (resources.disposed) return
  resources.disposed = true
  resources.toneMapper?.dispose()
  resources.toneMapper = undefined
  resources.lastPlanInput = undefined
  resources.lastPlan = undefined
  resources.materialPlan = undefined
  resources.retiredMaterialProgramCompilations += resources.materialDraws.programCompilations()
  resources.retiredMaterialDrawCalls += resources.materialDraws.drawCalls()
  resources.retiredMaterialCounters = worldMaterialCounters(resources)
  resources.materialDraws.release()
  resources.materialTextureHandles.clear()
  resources.usedGeometry.clear()
  for (const programs of resources.geometry.values())
    for (const entry of programs.values()) deleteGeometryEntry(resources, entry)
  resources.geometry.clear()
  for (const buffer of resources.indexBuffers.values()) resources.gl.deleteBuffer(buffer)
  resources.indexBuffers.clear()
  resources.usedIndexBuffers.clear()
  resources.usedTextures.clear()
  for (const entry of resources.textures.values()) deleteTextureEntry(resources, entry)
  for (const entry of resources.textureArrays.values()) deleteTextureEntry(resources, entry)
  resources.textures.clear()
  resources.textureArrays.clear()
  if (resources.sentinelTexture !== undefined) {
    deleteTextureEntry(resources, resources.sentinelTexture)
    resources.sentinelTexture = undefined
  }
  resources.gl.deleteProgram(resources.program)
  resources.gl.deleteProgram(resources.shadowProgram)
  if (resources.pendingGpuQuery !== undefined) {
    resources.gl.deleteQuery(resources.pendingGpuQuery)
    resources.pendingGpuQuery = undefined
  }
  if (resources.shadowTarget !== undefined) {
    resources.gl.deleteFramebuffer(resources.shadowTarget.framebuffer)
    resources.gl.deleteTexture(resources.shadowTarget.texture)
    resources.shadowTarget = undefined
  }
  if (resources.shadowKept !== undefined) {
    resources.gl.deleteFramebuffer(resources.shadowKept.framebuffer)
    resources.gl.deleteTexture(resources.shadowKept.texture)
    resources.shadowKept = undefined
  }
  resources.shadowCasterKeys = undefined
}

/** Frames between WebGL error checks once a renderer has drawn its first frames. */
const WORLD_ERROR_CHECK_INTERVAL = 60

/**
 * WebGL errors of a pass. `getError` waits until the GPU process has run every queued command,
 * which serialized the page and the GPU process up to eight times a frame; a renderer checks its
 * first frames and then every `WORLD_ERROR_CHECK_INTERVAL`th, so an error surfaces at the next
 * checked pass.
 */
function assertNoWebGlError(resources: WorldWebGlOwnedResources, stage: string) {
  if (resources.frames >= 2 && resources.frames % WORLD_ERROR_CHECK_INTERVAL !== 0) return
  const gl = resources.gl
  const error = gl.getError()
  if (error !== gl.NO_ERROR) throw new TypeError(`world WebGL ${stage} failed (${String(error)})`)
}

function drawShadowPositions(
  resources: WorldWebGlOwnedResources,
  program: WebGLProgram,
  positions: Float32Array,
) {
  if (positions.length === 0) return
  const gl = resources.gl
  const cached = resources.geometry.get(positions)?.get(program)
  if (cached !== undefined) {
    resources.geometryCacheHits += 1
    resources.usedGeometry.add(cached)
    gl.bindVertexArray(cached.vao)
    worldUniform1f(gl, program, 'alphaCutoff', 0)
    gl.drawArrays(gl.TRIANGLES, 0, cached.count)
    gl.bindVertexArray(null)
    return
  }
  const location = gl.getAttribLocation(program, 'position')
  if (location < 0) throw new TypeError('world shadow program has no position attribute')
  const buffer = gl.createBuffer()
  const vao = gl.createVertexArray()
  if (buffer === null || vao === null) {
    if (buffer !== null) gl.deleteBuffer(buffer)
    if (vao !== null) gl.deleteVertexArray(vao)
    throw new TypeError('WebGL2 could not allocate world shadow geometry')
  }
  try {
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(location)
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0)
    worldUniform1f(gl, program, 'alphaCutoff', 0)
    gl.drawArrays(gl.TRIANGLES, 0, positions.length / 3)
    gl.bindVertexArray(null)
    const entry: WorldWebGlGeometryEntry = Object.freeze({
      key: positions,
      program,
      vao,
      buffers: Object.freeze([buffer]),
      count: positions.length / 3,
      bytes: positions.byteLength,
    })
    const programs = resources.geometry.get(positions) ?? new Map()
    programs.set(program, entry)
    resources.geometry.set(positions, programs)
    resources.usedGeometry.add(entry)
    resources.geometryUploads += 1
  } catch (error) {
    gl.bindVertexArray(null)
    gl.deleteBuffer(buffer)
    gl.deleteVertexArray(vao)
    throw error
  }
}

function drawShadowTextured(
  resources: WorldWebGlOwnedResources,
  program: WebGLProgram,
  source: WorldWebGlTexturedBatch,
): void {
  bindTexture2d(resources, source.texture, 0)
  const gl = resources.gl
  worldUniform1i(gl, program, 'baseColorMap', 0)
  worldUniform1f(gl, program, 'alphaCutoff', source.alphaCutoff ?? 0)
  drawBatch(resources, program, source, gl.TRIANGLES)
}

function prepareWorldMaterialResources(
  resources: WorldWebGlOwnedResources,
  plan: WorldWebGlPlan,
): void {
  if (resources.materialPlan !== plan) {
    // The material renderer outlives plans. A lease belongs to one program object and keeps the
    // texture handles of its own texture objects, which stay in use while it draws; sweep drops
    // the leases, programs, vertex arrays and buffers a frame no longer draws. Releasing it on
    // every changed input re-linked all programs and re-uploaded all buffers on each model-loading
    // tick, selection and preview drag.
    resources.materialTextureHandles.clear()
    resources.materialPlan = plan
  }
  // The scenes of one model share their texture list: each list is read once.
  const lists = new Set<readonly SceneRendererTexture[]>()
  const seen = new Set<SceneRendererTexture>()
  const bind = (textures: readonly SceneRendererTexture[]) => {
    if (lists.has(textures)) return
    lists.add(textures)
    for (const texture of textures) {
      if (seen.has(texture)) continue
      seen.add(texture)
      resources.materialTextureHandles.set(texture, bindTexture2d(resources, texture, 0))
    }
  }
  for (const scene of plan.modelMaterialScenes) bind(scene.textures)
  for (const effect of plan.modelEffects) bind(effect.textures)
  // what an `envi` layer reflects when it names no map of its own (6 KiB, uploaded once)
  bind(SCENE_ENVIRONMENT_TEXTURES)
  // The poses of the frame's skins, uploaded at once before the shadow pass draws any of them: a
  // kept skin's the one it stands for.
  const skins = worldCurrentPrograms.get(plan)?.skins
  const palettes = new Set<Float32Array>()
  for (const scene of plan.modelMaterialScenes)
    for (const skin of worldSceneSkins(scene)) palettes.add((skins?.get(skin) ?? skin).palette)
  resources.materialDraws.prepareSkins(palettes)
}

/** The skins a scene's primitives draw with, in their order; kept scenes keep theirs. */
const worldSceneSkinLists = new WeakMap<WorldWebGlModelMaterialScene, readonly ModelSceneSkin[]>()
function worldSceneSkins(scene: WorldWebGlModelMaterialScene): readonly ModelSceneSkin[] {
  let skins = worldSceneSkinLists.get(scene)
  if (skins === undefined) {
    const found: ModelSceneSkin[] = []
    for (const primitive of scene.primitives) {
      const skin = materialSkinOf(primitive)
      if (skin !== undefined) found.push(skin)
    }
    worldSceneSkinLists.set(scene, (skins = found))
  }
  return skins
}

/** One caster of the shadow map, with the identities its depth reads (see worldShadowEntryKey). */
type WorldShadowCaster =
  | { readonly key: readonly unknown[]; readonly positions: Float32Array }
  | { readonly key: readonly unknown[]; readonly textured: WorldWebGlTexturedBatch }
  | { readonly key: readonly unknown[]; readonly entry: MaterialSequenceDraw }

const worldShadowDiscards = new WeakMap<StandardMaterialProgram, boolean>()

/**
 * The identities a material caster's depth reads: its geometry, pose and placement, the program whose
 * face culling it takes, and, when its fragment shader can discard (alpha test), the program whose
 * uniforms it takes this frame. Its vertex shader places vertices by the frame's view-projection
 * and the placement alone; without a discard every covered texel keeps its depth.
 */
function worldShadowEntryKey(
  entry: MaterialSequenceDraw,
  passes: ReadonlyMap<StandardMaterialProgram, StandardMaterialProgram> | undefined,
): readonly unknown[] {
  const { draw } = entry
  const primitive = draw.primitive
  const program = draw.program!
  const standing = passes?.get(program) ?? program
  let discards = worldShadowDiscards.get(standing)
  if (discards === undefined)
    worldShadowDiscards.set(
      standing,
      (discards = /\bdiscard\b|gl_FragDepth/u.test(standing.fragmentSource)),
    )
  return [
    'material',
    primitive.positions,
    entry.instances?.palettes ?? materialSkinOf(primitive)?.palette,
    primitive.indices,
    primitive.topology,
    entry.instances?.matrices ?? primitive.transform,
    entry.instances?.count,
    draw.program,
    standing.twoSided,
    discards ? standing : undefined,
    discards ? draw.material : undefined,
  ]
}

/** Adds a key to a set of keys kept as nested maps by element (compared with ===). */
function worldShadowKeysAdd(keys: Map<unknown, unknown>, key: readonly unknown[]): void {
  let level = keys
  for (const element of key) {
    let next = level.get(element) as Map<unknown, unknown> | undefined
    if (next === undefined) level.set(element, (next = new Map()))
    level = next
  }
}

function worldShadowKeysHave(keys: Map<unknown, unknown>, key: readonly unknown[]): boolean {
  let level: Map<unknown, unknown> | undefined = keys
  for (const element of key) {
    level = level.get(element) as Map<unknown, unknown> | undefined
    if (level === undefined) return false
  }
  return true
}

function sameWorldShadowCasters(
  kept: readonly (readonly unknown[])[],
  casters: readonly WorldShadowCaster[],
): boolean {
  if (kept.length !== casters.length) return false
  for (let index = 0; index < kept.length; index++) {
    const left = kept[index]!,
      right = casters[index]!.key
    if (left.length !== right.length) return false
    for (let element = 0; element < left.length; element++)
      if (left[element] !== right[element]) return false
  }
  return true
}

function sameFloats(left: Float32Array | undefined, right: Float32Array): boolean {
  if (left === undefined || left.length !== right.length) return false
  for (let index = 0; index < left.length; index++)
    if (!Object.is(left[index], right[index])) return false
  return true
}

/** Copies a shadow map's depth to another of its size (a copy of the depth values, no filtering). */
function blitWorldShadowDepth(
  gl: WebGL2RenderingContext,
  from: WebGLFramebuffer,
  to: WebGLFramebuffer,
  size: number,
): void {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from)
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to)
  gl.depthMask(true)
  gl.blitFramebuffer(0, 0, size, size, 0, 0, size, size, gl.DEPTH_BUFFER_BIT, gl.NEAREST)
  gl.bindFramebuffer(gl.FRAMEBUFFER, to)
}

/** The kept depth target of the given size, allocated (or reallocated for another size) once. */
function keptWorldShadowTarget(
  resources: WorldWebGlOwnedResources,
  size: number,
): Readonly<{ framebuffer: WebGLFramebuffer; texture: WebGLTexture; size: number }> {
  const gl = resources.gl
  const kept = resources.shadowKept
  if (kept !== undefined && kept.size === size) return kept
  if (kept !== undefined) {
    gl.deleteFramebuffer(kept.framebuffer)
    gl.deleteTexture(kept.texture)
    resources.shadowKept = undefined
  }
  const framebuffer = gl.createFramebuffer()
  const texture = gl.createTexture()
  if (framebuffer === null || texture === null) {
    if (framebuffer !== null) gl.deleteFramebuffer(framebuffer)
    if (texture !== null) gl.deleteTexture(texture)
    throw new TypeError('WebGL2 could not allocate the kept shadow-map depth')
  }
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.DEPTH_COMPONENT24,
    size,
    size,
    0,
    gl.DEPTH_COMPONENT,
    gl.UNSIGNED_INT,
    null,
  )
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0)
  gl.drawBuffers([gl.NONE])
  gl.readBuffer(gl.NONE)
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(framebuffer)
    gl.deleteTexture(texture)
    throw new TypeError('the kept shadow-map depth framebuffer is incomplete')
  }
  const target = Object.freeze({
    framebuffer,
    texture,
    size,
    viewProjection: undefined,
    casters: Object.freeze([]),
  })
  resources.shadowKept = target
  return target
}

/**
 * Draws shadow casters into the bound shadow map: the world's batches with the shadow program, in
 * the state the pass sets for them, then the material casters as one sequence.
 */
function drawWorldShadowCasters(
  resources: WorldWebGlOwnedResources,
  program: WebGLProgram,
  plan: WorldWebGlPlan,
  casters: readonly WorldShadowCaster[],
  sceneCamera: Parameters<WorldWebGlOwnedResources['materialDraws']['drawSequence']>[1],
  passes: ReadonlyMap<StandardMaterialProgram, StandardMaterialProgram> | undefined,
): void {
  const gl = resources.gl
  const entries: MaterialSequenceDraw[] = []
  let world = false
  for (const caster of casters) {
    if ('entry' in caster) {
      entries.push(caster.entry)
      continue
    }
    if (!world) {
      // The state the pass set for its batches (a material sequence before leaves its own).
      world = true
      gl.colorMask(false, false, false, false)
      gl.depthMask(true)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.disable(gl.CULL_FACE)
      gl.enable(gl.POLYGON_OFFSET_FILL)
      gl.polygonOffset(1.1, 4)
      gl.useProgram(program)
      bindSentinelTexture2d(resources, 0)
      worldUniform1i(gl, program, 'baseColorMap', 0)
    }
    if ('textured' in caster) drawShadowTextured(resources, program, caster.textured)
    else drawShadowPositions(resources, program, caster.positions)
  }
  if (entries.length === 0) return
  resources.materialDraws.drawSequence(entries, sceneCamera, worldMaterialLight(plan), passes)
  gl.colorMask(false, false, false, false)
}

/**
 * The key light's depth-map camera for a plan drawn into a buffer of `width` by `height`: an
 * orthographic box `radius` wide about the view, deep enough for the world's height, and its
 * view-projection. The shadow pass draws with it; the posing view bounds shadows by it.
 */
function worldShadowLightView(
  plan: WorldWebGlPlan,
  input: WorldWebGlInput,
  width: number,
  height: number,
) {
  const minimum = new Vector3(...plan.bounds.minimum)
  const maximum = new Vector3(...plan.bounds.maximum)
  const extent = maximum.clone().sub(minimum)
  const view = cameraState(input.camera)
  const frame = view.frame ?? plan.stats.frame
  // Spend the depth map on what the camera sees: the orbit target and the ground footprint of the
  // orthographic view (stretched by a low elevation), plus the world height for casters that lean
  // in. A whole-map map at close zoom turns each texel into a visible block.
  const center = new Vector3(...frame.center).add(new Vector3(...view.target))
  const aspect = width / Math.max(1, height)
  const footprint =
    ((frame.radius / view.zoom) * Math.max(1, aspect)) / Math.max(0.25, Math.sin(view.elevation))
  const radius = Math.max(0.5, Math.min(extent.length() * 0.5, footprint * 1.25 + extent.y))
  const rayDirection = new Vector3(...plan.light.direction).normalize()
  const lightCamera = new OrthographicCamera(-radius, radius, radius, -radius, 0.01, radius * 4 + 2)
  lightCamera.position.copy(center).addScaledVector(rayDirection, -(radius * 2 + 1))
  lightCamera.up.set(0, 1, 0)
  if (Math.abs(rayDirection.dot(lightCamera.up)) > 0.95) lightCamera.up.set(0, 0, 1)
  lightCamera.lookAt(center)
  lightCamera.updateMatrixWorld(true)
  const viewProjection = Float32Array.from(
    lightCamera.projectionMatrix.clone().multiply(lightCamera.matrixWorldInverse).elements,
  )
  return { lightCamera, viewProjection, radius }
}

function renderWorldShadowMap(
  gl: WebGL2RenderingContext,
  plan: WorldWebGlPlan,
  input: WorldWebGlInput,
  resources: WorldWebGlOwnedResources,
): WorldShadowResources | undefined {
  if (input.shadows !== true || plan.stats.shadowCasterTriangles === 0) return undefined
  // Out of the shadow range the map would only be sampled by nothing.
  if (
    worldShadowRangeEye(plan, gl.drawingBufferWidth, gl.drawingBufferHeight, input.camera)
      ?.reachable === false
  )
    return undefined
  const requestedSize = input.shadowMapSize ?? 2_048
  if (!Number.isSafeInteger(requestedSize) || requestedSize <= 0)
    throw new TypeError('world shadowMapSize must be a positive safe integer')
  const size = Math.min(requestedSize, 4_096, Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)))
  if (size <= 0) throw new TypeError('WebGL2 reports no usable shadow-map texture size')

  const { lightCamera, viewProjection } = worldShadowLightView(
    plan,
    input,
    gl.drawingBufferWidth,
    gl.drawingBufferHeight,
  )
  const program = resources.shadowProgram
  if (resources.shadowTarget !== undefined && resources.shadowTarget.size !== size) {
    gl.deleteFramebuffer(resources.shadowTarget.framebuffer)
    gl.deleteTexture(resources.shadowTarget.texture)
    resources.shadowTarget = undefined
  }
  let target = resources.shadowTarget
  let allocated = false
  try {
    if (target === undefined) {
      const framebuffer = gl.createFramebuffer()
      const texture = gl.createTexture()
      if (framebuffer === null || texture === null) {
        if (framebuffer !== null) gl.deleteFramebuffer(framebuffer)
        if (texture !== null) gl.deleteTexture(texture)
        throw new TypeError('WebGL2 could not allocate world shadow-map resources')
      }
      allocated = true
      target = Object.freeze({ framebuffer, texture, size })
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.DEPTH_COMPONENT24,
        size,
        size,
        0,
        gl.DEPTH_COMPONENT,
        gl.UNSIGNED_INT,
        null,
      )
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0)
      gl.drawBuffers([gl.NONE])
      gl.readBuffer(gl.NONE)
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new TypeError('world shadow-map framebuffer is incomplete')
      resources.shadowTarget = target
      resources.shadowTargetAllocations += 1
    } else {
      resources.shadowTargetReuses += 1
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
    }
    // Checked complete when allocated; its attachment never changes. The check is a synchronous
    // round trip to the GPU process: every frame it waited for all the work queued before it.
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
    gl.drawBuffers([gl.NONE])
    gl.readBuffer(gl.NONE)

    gl.viewport(0, 0, size, size)
    gl.clearDepth(1)
    gl.useProgram(program)
    gl.uniformMatrix4fv(uniformLocation(gl, program, 'lightViewProjection'), false, viewProjection)
    // The casters in the order the pass draws them, each with the identity of what its depth reads.
    // The terrain casts: its height field climbs every cliff, so it throws the cliff's shadow, and
    // SC2 marks its natural cliff meshes no-shadows-cast for that reason. Without it the beach under
    // a coast was lit between the shadows of the rim doodads. How far shadows reach is the camera's
    // business (light.shadowRange), not the casters'.
    const casters: WorldShadowCaster[] = []
    const positions = (array: Float32Array) => casters.push({ key: ['positions', array], positions: array })
    positions(plan.opaqueTriangles.positions)
    positions(plan.terrainShadowCasters)
    for (const item of plan.shadowControlledOpaqueTriangles) if (item.castShadows) positions(item.positions)
    for (const item of plan.texturedTriangles) {
      if (item.castShadows === false) continue
      if ((item.alphaCutoff ?? 0) > 0) casters.push({ key: ['textured', item], textured: item })
      else positions(item.positions)
    }
    // A cliff surface drawn as terrain casts nothing: the rock program casts for the rock, and a
    // no-shadows-cast material (Shakuras Cliff 0) must not darken the ground through its ground.
    for (const item of plan.splatTriangles) if (item.maskTexture === undefined) positions(item.positions)
    const passes = worldCurrentPrograms.get(plan)?.passes
    if (plan.modelMaterialScenes.some(scene => scene.shadowPrimitives.length > 0))
      for (const entry of worldMaterialBatchesOf(plan, true).sequence)
        casters.push({ key: worldShadowEntryKey(entry, passes), entry })
    // A depth map holds each texel's nearest caster, whatever order they draw in: the casters that
    // stayed as they were since the last shadow map (on Amphion's game view ~3/4 of its vertices,
    // the doodads and the ground) draw into a kept depth once, and a later map with the same light
    // view and the same staying casters starts from a copy of it and draws only the others.
    const previous = resources.shadowCasterKeys
    const keys = new Map<unknown, unknown>()
    const stayed: WorldShadowCaster[] = []
    const others: WorldShadowCaster[] = []
    for (const caster of casters) {
      ;(previous !== undefined && worldShadowKeysHave(previous, caster.key) ? stayed : others).push(
        caster,
      )
      worldShadowKeysAdd(keys, caster.key)
    }
    resources.shadowCasterKeys = keys
    const sceneCamera = {
      viewProjection,
      viewMatrix: Float32Array.from(lightCamera.matrixWorldInverse.elements),
      eyePosition: [lightCamera.position.x, lightCamera.position.y, lightCamera.position.z] as const,
    }
    const draw = (group: readonly WorldShadowCaster[]) =>
      drawWorldShadowCasters(resources, program, plan, group, sceneCamera, passes)
    const kept = resources.shadowKept
    if (
      kept !== undefined &&
      kept.size === size &&
      stayed.length > 0 &&
      sameFloats(kept.viewProjection, viewProjection) &&
      sameWorldShadowCasters(kept.casters, stayed)
    )
      blitWorldShadowDepth(gl, kept.framebuffer, target.framebuffer, size)
    else {
      gl.depthMask(true)
      gl.clear(gl.DEPTH_BUFFER_BIT)
      draw(stayed)
      if (stayed.length > 0) {
        const keep = keptWorldShadowTarget(resources, size)
        blitWorldShadowDepth(gl, target.framebuffer, keep.framebuffer, size)
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
        resources.shadowKept = Object.freeze({
          framebuffer: keep.framebuffer,
          texture: keep.texture,
          size,
          viewProjection: viewProjection.slice(),
          casters: Object.freeze(stayed.map(caster => caster.key)),
        })
      }
    }
    draw(others)
    assertNoWebGlError(resources, 'shadow-map pass')
    gl.disable(gl.POLYGON_OFFSET_FILL)
    gl.colorMask(true, true, true, true)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return Object.freeze({
      framebuffer: target.framebuffer,
      texture: target.texture,
      viewProjection,
      size,
    })
  } catch (error) {
    gl.disable(gl.POLYGON_OFFSET_FILL)
    gl.colorMask(true, true, true, true)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    if (allocated && target !== undefined) {
      gl.deleteFramebuffer(target.framebuffer)
      gl.deleteTexture(target.texture)
      if (resources.shadowTarget === target) resources.shadowTarget = undefined
    }
    throw error
  }
}

function drawBatch(
  resources: WorldWebGlOwnedResources,
  program: WebGLProgram,
  source: WorldWebGlBatch & {
    readonly textureCoordinates?: Float32Array
    readonly secondaryTextureCoordinates?: Float32Array
    readonly textureWeights0?: Float32Array
    readonly textureWeights1?: Float32Array
    readonly splatTextureCoordinates?: readonly Float32Array[]
    readonly splatWeightTextureCoordinates?: Float32Array
  },
  mode: number,
  cacheKey: object = source,
  range?: WorldWebGlTransparentRange,
) {
  const count = source.positions.length / 3
  if (count === 0) return
  const gl = resources.gl
  const drawSelected = (vertices: number) => {
    if (range === undefined) {
      gl.drawArrays(mode, 0, vertices)
      return
    }
    let buffer = resources.indexBuffers.get(range.indices)
    if (buffer === undefined) {
      const created = gl.createBuffer()
      if (created === null) throw new TypeError('WebGL could not allocate a world index buffer')
      buffer = created
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, range.indices, gl.STATIC_DRAW)
      resources.indexBuffers.set(range.indices, buffer)
      resources.geometryUploads += 1
    } else gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer)
    resources.usedIndexBuffers.add(range.indices)
    gl.drawElements(mode, range.count, gl.UNSIGNED_INT, range.first * 4)
  }
  const cached = resources.geometry.get(cacheKey)?.get(program)
  if (cached !== undefined) {
    resources.geometryCacheHits += 1
    resources.usedGeometry.add(cached)
    gl.bindVertexArray(cached.vao)
    drawSelected(cached.count)
    gl.bindVertexArray(null)
    return
  }
  const buffers: WebGLBuffer[] = []
  let bytes = 0
  const attribute = (name: string, data: Float32Array, size: number) => {
    const location = gl.getAttribLocation(program, name)
    if (location < 0) return
    const buffer = gl.createBuffer()
    if (buffer === null) throw new TypeError(`WebGL could not allocate world ${name} buffer`)
    buffers.push(buffer)
    bytes += data.byteLength
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(location)
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
  }
  const vao = gl.createVertexArray()
  if (vao === null) throw new TypeError('WebGL could not allocate a world vertex array')
  gl.bindVertexArray(vao)
  try {
    attribute('position', source.positions, 3)
    attribute('normal', source.normals, 3)
    attribute('color', source.colors, 4)
    if (source.textureCoordinates !== undefined) attribute('uv', source.textureCoordinates, 2)
    if (source.secondaryTextureCoordinates !== undefined)
      attribute('secondaryUv', source.secondaryTextureCoordinates, 2)
    if (source.textureWeights0 !== undefined)
      attribute('textureWeights0', source.textureWeights0, 4)
    if (source.textureWeights1 !== undefined)
      attribute('textureWeights1', source.textureWeights1, 4)
    source.splatTextureCoordinates?.forEach((coordinates, index) =>
      attribute(`splatUv${String(index)}`, coordinates, 2),
    )
    if (source.splatWeightTextureCoordinates !== undefined)
      attribute('splatWeightUv', source.splatWeightTextureCoordinates, 2)
    drawSelected(count)
    gl.bindVertexArray(null)
    const entry: WorldWebGlGeometryEntry = Object.freeze({
      key: cacheKey,
      program,
      vao,
      buffers: Object.freeze(buffers),
      count,
      bytes,
    })
    const programs = resources.geometry.get(cacheKey) ?? new Map()
    programs.set(program, entry)
    resources.geometry.set(cacheKey, programs)
    resources.usedGeometry.add(entry)
    resources.geometryUploads += 1
  } catch (error) {
    for (const buffer of buffers) gl.deleteBuffer(buffer)
    gl.bindVertexArray(null)
    gl.deleteVertexArray(vao)
    throw error
  }
}

function drawTexturedBatch(
  resources: WorldWebGlOwnedResources,
  program: WebGLProgram,
  source: WorldWebGlTexturedBatch,
  range?: WorldWebGlTransparentRange,
) {
  const gl = resources.gl
  bindTexture2d(resources, source.texture, 4)
  worldUniform1i(gl, program, 'baseColorMap', 4)
  gl.uniform2f(
    uniformLocation(gl, program, 'atlasGrid'),
    source.atlas?.columns ?? 0,
    source.atlas?.rows ?? 0,
  )
  if (source.normalTexture === undefined) {
    worldUniform1f(gl, program, 'normalTextured', 0)
  } else {
    bindTexture2d(resources, source.normalTexture, 5)
    worldUniform1i(gl, program, 'normalMap', 5)
    worldUniform1f(gl, program, 'normalTextured', 1)
    worldUniform1f(gl, program, 'normalSwizzle', source.normalSwizzle ?? 0)
  }
  if (source.secondaryTexture === undefined || source.secondaryTextureCoordinates === undefined) {
    worldUniform1f(gl, program, 'secondaryTextured', 0)
  } else {
    bindTexture2d(resources, source.secondaryTexture, 6)
    worldUniform1i(gl, program, 'secondaryColorMap', 6)
    worldUniform1f(gl, program, 'secondaryTextured', 1)
  }
  const detail = source.waterDetail
  if (detail === undefined) {
    worldUniform1f(gl, program, 'waterDetailMode', 0)
  } else {
    // The first normal image on the ordinary normal unit (unused by this branch), the rest on
    // their own.
    bindTexture2d(resources, detail.normals[0], 5)
    bindTexture2d(resources, detail.normals[1], WATER_DETAIL_NORMAL_UNIT)
    if (detail.foam !== undefined) {
      bindTexture2d(resources, detail.foam[0], WATER_DETAIL_FOAM_UNIT)
      bindTexture2d(resources, detail.foam[1], WATER_DETAIL_SECOND_FOAM_UNIT)
    }
    worldUniform1f(gl, program, 'waterDetailFoamed', detail.foam === undefined ? 0 : 1)
    gl.uniform3f(uniformLocation(gl, program, 'waterDetailColor'), ...detail.color)
    gl.uniform4fv(
      uniformLocation(gl, program, 'waterDetailScroll0'),
      Float32Array.from(detail.sampleScroll.slice(0, 4)),
    )
    gl.uniform4fv(
      uniformLocation(gl, program, 'waterDetailScroll1'),
      Float32Array.from(detail.sampleScroll.slice(4, 8)),
    )
    worldUniform1f(gl, program, 'waterDetailUpScale', detail.upScale)
    worldUniform1f(gl, program, 'waterDetailMode', 1)
  }
  worldUniform1f(gl, program, 'textured', 1)
  worldUniform1f(gl, program, 'alphaCutoff', source.alphaCutoff ?? 0)
  if (source.unlit === true) worldUniform1f(gl, program, 'unlitSurface', 1)
  const team = source.team
  if (team !== undefined) {
    worldUniform1f(gl, program, 'teamColorMode', team.mask === undefined ? 1 : 2)
    worldUniform1f(gl, program, 'teamMaskChannel', team.channel)
    worldUniform1f(gl, program, 'teamBlend', team.blend)
    worldUniform1f(gl, program, 'teamStrength', team.strength)
    gl.uniform3f(uniformLocation(gl, program, 'teamColor'), ...team.color)
    const rule = team.rule
    worldUniform1f(
      gl,
      program,
      'teamMaskMode',
      rule.mode === 'key' ? 1 : rule.mode === 'ramp' ? 2 : 0,
    )
    gl.uniform3f(uniformLocation(gl, program, 'teamKey'), ...(rule.thresholds ?? [0, 0, 255]))
    worldUniform1f(gl, program, 'teamKeyIntensity', rule.intensity ?? 2)
    const shades = rule.shades ?? []
    gl.uniform3fv(
      uniformLocation(gl, program, 'teamRamp'),
      Float32Array.from(
        { length: TEAM_RAMP_MAX * 3 },
        (_, index) => shades[Math.floor(index / 3)]?.[index % 3] ?? 0,
      ),
    )
    worldUniform1f(gl, program, 'teamRampCount', shades.length)
    worldUniform1f(gl, program, 'teamRampFirst', rule.first ?? 0)
    worldUniform1f(gl, program, 'teamRampScale', rule.scale ?? 255)
    worldUniform1f(gl, program, 'teamTintRgb', rule.tintRgb === true ? 1 : 0)
    if (team.mask !== undefined) {
      bindTexture2d(resources, team.mask, 6)
      worldUniform1i(gl, program, 'secondaryColorMap', 6)
    }
  }
  drawBatch(resources, program, source, gl.TRIANGLES, source, range)
  if (source.unlit === true) worldUniform1f(gl, program, 'unlitSurface', 0)
  if (team !== undefined) worldUniform1f(gl, program, 'teamColorMode', 0)
  if (detail !== undefined) worldUniform1f(gl, program, 'waterDetailMode', 0)
}

function drawSplatBatch(
  resources: WorldWebGlOwnedResources,
  program: WebGLProgram,
  source: WorldWebGlSplatBatch,
) {
  const gl = resources.gl
  if (source.textures.length < 1 || source.textures.length > 8)
    throw new TypeError('world terrain splat batch must contain between one and eight textures')
  if (source.normalTextures.length !== source.textures.length)
    throw new TypeError('world terrain splat normals must align with base texture layers')
  const checked = (texture: SceneRendererTexture) => {
    if (
      texture.width <= 0 ||
      texture.height <= 0 ||
      (texture.compressed === undefined &&
        texture.rgba.byteLength !== texture.width * texture.height * 4)
    )
      throw new TypeError(`world texture ${texture.id} is not tightly packed RGBA8`)
    return texture
  }
  const resized = (
    texture: SceneRendererTexture | undefined,
    width: number,
    height: number,
    specular: boolean,
  ): Uint8Array => {
    if (texture === undefined) {
      const flat = new Uint8Array(width * height * 4)
      for (let offset = 0; offset < flat.length; offset += 4) {
        flat[offset] = specular ? 0 : 128
        flat[offset + 1] = specular ? 0 : 128
        flat[offset + 2] = specular ? 0 : 255
        flat[offset + 3] = 255
      }
      return flat
    }
    checked(texture)
    // One array of layers of one size: blocks are decoded here (sceneTexturePixels).
    const pixels = sceneTexturePixels(texture)
    if (texture.width === width && texture.height === height) return pixels
    const output = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      const sourceY = Math.min(
        texture.height - 1,
        Math.floor(((y + 0.5) * texture.height) / height),
      )
      for (let x = 0; x < width; x += 1) {
        const sourceX = Math.min(texture.width - 1, Math.floor(((x + 0.5) * texture.width) / width))
        const from = (sourceY * texture.width + sourceX) * 4
        output.set(pixels.subarray(from, from + 4), (y * width + x) * 4)
      }
    }
    return output
  }
  const uploadArray = (
    textures: readonly (SceneRendererTexture | undefined)[],
    dimensions: readonly SceneRendererTexture[],
    unit: number,
    label: string,
  ) => {
    dimensions.forEach(checked)
    textures
      .filter((texture): texture is SceneRendererTexture => texture !== undefined)
      .forEach(checked)
    const width = Math.max(...dimensions.map(texture => texture.width))
    const height = Math.max(...dimensions.map(texture => texture.height))
    if (
      width > gl.getParameter(gl.MAX_TEXTURE_SIZE) ||
      textures.length > gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)
    )
      throw new TypeError(`world ${label} texture array exceeds WebGL2 limits`)
    const key = textures as object
    let entry = resources.textureArrays.get(key)
    if (entry !== undefined) {
      resources.textureCacheHits += 1
      resources.usedTextures.add(entry)
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, entry.handle)
      return
    }
    const handle = gl.createTexture()
    if (handle === null) throw new TypeError(`WebGL could not allocate a ${label} texture array`)
    let committed = false
    try {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, handle)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      const nearest = textures.every(
        texture => texture === undefined || texture.filter === 'nearest',
      )
      // Layers of stored blocks with one level chain go as they are; any other set is resized
      // texels, as before.
      const blocks = uploadCompressedTextureArray(gl, textures, nearest ? 'nearest' : 'linear')
      if (blocks !== undefined) {
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT)
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT)
        entry = Object.freeze({ key, handle, target: gl.TEXTURE_2D_ARRAY, bytes: blocks.bytes })
        resources.textureArrays.set(key, entry)
        resources.usedTextures.add(entry)
        resources.textureUploads += 1
        committed = true
        return
      }
      gl.texImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        gl.RGBA8,
        width,
        height,
        textures.length,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      )
      textures.forEach((texture, layer) =>
        gl.texSubImage3D(
          gl.TEXTURE_2D_ARRAY,
          0,
          0,
          0,
          layer,
          width,
          height,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          resized(texture, width, height, label === 'terrain specular'),
        ),
      )
      // Repeat is required for continuous terrain-space UVs; clamped layers clamp in the shader.
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT)
      applyTextureFilter(gl, gl.TEXTURE_2D_ARRAY, nearest ? 'nearest' : 'linear')
      entry = Object.freeze({
        key,
        handle,
        target: gl.TEXTURE_2D_ARRAY,
        bytes: width * height * textures.length * 4,
      })
      resources.textureArrays.set(key, entry)
      resources.usedTextures.add(entry)
      resources.textureUploads += 1
      committed = true
    } finally {
      if (!committed) gl.deleteTexture(handle)
    }
  }
  {
    uploadArray(source.textures, source.textures, 0, 'terrain base-color')
    uploadArray(source.normalTextures, source.textures, 1, 'terrain normal')
    const hasSpecular = source.specularTextures?.some(texture => texture !== undefined) ?? false
    if (hasSpecular) uploadArray(source.specularTextures!, source.textures, 8, 'terrain specular')
    worldUniform1i(gl, program, 'terrainSpecularMaps', 8)
    worldUniform1f(gl, program, 'terrainSpecularTextured', hasSpecular ? 1 : 0)
    worldUniform1f(gl, program, 'terrainSpecularGloss', source.specularGloss === true ? 1 : 0)
    worldUniform1i(gl, program, 'terrainMaps', 0)
    worldUniform1i(gl, program, 'terrainNormalMaps', 1)
    if ((source.weightTextures?.length ?? 0) < 2) {
      const firstMissingUnit = 2 + (source.weightTextures?.length ?? 0)
      for (let unit = firstMissingUnit; unit <= 3; unit += 1) {
        bindSentinelTexture2d(resources, unit)
      }
    }
    // Every active sampler type must point at a compatible unit even when its runtime branch is
    // disabled. The ordinary 2D samplers share unit 2 here; array samplers stay on units 0 and 1.
    worldUniform1i(gl, program, 'baseColorMap', 4)
    worldUniform1i(gl, program, 'normalMap', 5)
    worldUniform1i(gl, program, 'secondaryColorMap', 6)
    worldUniform1i(gl, program, 'terrainWeightMaps[0]', 2)
    worldUniform1i(gl, program, 'terrainWeightMaps[1]', 3)
    ;(source.weightTextures ?? []).forEach((texture, index) => {
      bindTexture2d(resources, texture, 2 + index)
      worldUniform1i(gl, program, `terrainWeightMaps[${String(index)}]`, 2 + index)
    })
    const uniformLayers = (name: string, values: readonly number[]) =>
      gl.uniform4fv(uniformLocation(gl, program, name), Float32Array.from(values))
    const padded = (values: readonly number[]) => [...values, ...Array(8 - values.length).fill(0)]
    const normalMask = padded(source.normalTextures.map(texture => (texture === undefined ? 0 : 1)))
    const clampU = padded(source.textures.map(texture => (texture.wrapU === 'clamp' ? 1 : 0)))
    const clampV = padded(source.textures.map(texture => (texture.wrapV === 'clamp' ? 1 : 0)))
    const normalSwizzle = padded(source.normalSwizzles)
    uniformLayers('terrainNormalMask0', normalMask.slice(0, 4))
    uniformLayers('terrainNormalMask1', normalMask.slice(4, 8))
    uniformLayers('terrainNormalSwizzle0', normalSwizzle.slice(0, 4))
    uniformLayers('terrainNormalSwizzle1', normalSwizzle.slice(4, 8))
    uniformLayers('terrainClampU0', clampU.slice(0, 4))
    uniformLayers('terrainClampU1', clampU.slice(4, 8))
    uniformLayers('terrainClampV0', clampV.slice(0, 4))
    uniformLayers('terrainClampV1', clampV.slice(4, 8))
    // all eight on every draw: a batch without colours must not keep the previous batch's
    const layerColors = new Float32Array(32).fill(1)
    source.layerColors?.forEach((color, layer) => layerColors.set(color, layer * 4))
    gl.uniform4fv(uniformLocation(gl, program, 'terrainLayerColor'), layerColors)
    worldUniform1f(gl, program, 'textured', 0)
    worldUniform1f(gl, program, 'alphaCutoff', 0)
    worldUniform1f(gl, program, 'normalTextured', 0)
    worldUniform1f(gl, program, 'secondaryTextured', 0)
    worldUniform1f(gl, program, 'splatTextured', 1)
    worldUniform1f(gl, program, 'rasterSplatTextured', source.weightTextures === undefined ? 0 : 1)
    worldUniform1f(gl, program, 'terrainWeightMapCount', source.weightTextures?.length ?? 0)
    const masked = source.maskTexture !== undefined && source.maskTextureCoordinates !== undefined
    if (masked) {
      bindTexture2d(resources, source.maskTexture!, 6)
      worldUniform1i(gl, program, 'secondaryColorMap', 6)
      const selector = [0, 0, 0, 0]
      selector[source.maskChannel ?? 3] = 1
      gl.uniform4fv(uniformLocation(gl, program, 'cliffMaskSelector'), selector)
    }
    worldUniform1f(gl, program, 'cliffMaskMode', masked ? 1 : 0)
    drawBatch(
      resources,
      program,
      {
        positions: source.positions,
        normals: source.normals,
        colors: source.colors,
        textureWeights0: source.textureWeights0,
        textureWeights1: source.textureWeights1,
        splatTextureCoordinates: source.textureCoordinates,
        ...(source.weightTextureCoordinates === undefined
          ? {}
          : { splatWeightTextureCoordinates: source.weightTextureCoordinates }),
        ...(masked ? { secondaryTextureCoordinates: source.maskTextureCoordinates! } : {}),
      },
      gl.TRIANGLES,
      source,
    )
    // Program state outlives the draw: later batches must not keep testing a mask.
    if (masked) worldUniform1f(gl, program, 'cliffMaskMode', 0)
  }
}

function isWebGl2(value: unknown): value is WebGL2RenderingContext {
  const candidate = value as Partial<WebGL2RenderingContext> | null
  return (
    candidate !== null &&
    typeof candidate.createShader === 'function' &&
    typeof candidate.createVertexArray === 'function' &&
    typeof candidate.drawArrays === 'function'
  )
}

function cameraState(value: WorldWebGlCamera | undefined): WorldWebGlCamera {
  const source = value ?? DEFAULT_WORLD_WEBGL_CAMERA
  const perspective = source.projection === 'perspective'
  if (
    (source.projection !== undefined && source.projection !== 'orthographic' && !perspective) ||
    !Number.isFinite(source.azimuth) ||
    !Number.isFinite(source.elevation) ||
    source.elevation <= (perspective ? 0.03 - Math.PI / 2 : 0.03) ||
    source.elevation >= Math.PI / 2 - 0.03 ||
    (source.fieldOfView !== undefined &&
      !(source.fieldOfView >= 0.1 && source.fieldOfView <= 2.8)) ||
    (source.far !== undefined && !(Number.isFinite(source.far) && source.far > 0)) ||
    !Number.isFinite(source.zoom) ||
    source.zoom < 0.125 ||
    source.zoom > 16 ||
    source.target.length !== 3 ||
    !source.target.every(Number.isFinite) ||
    (source.frame !== undefined &&
      !(
        source.frame.center.length === 3 &&
        source.frame.center.every(Number.isFinite) &&
        Number.isFinite(source.frame.radius) &&
        source.frame.radius > 0
      ))
  ) {
    throw new TypeError('world WebGL camera is outside its finite orbit/zoom domain')
  }
  return source
}

/**
 * Produces exact back-to-front transparent triangle runs for the requested orbit camera.
 * Runs retain their source material so adjacent triangles can share one WebGL draw call without
 * sacrificing ordering between water and textured blend/additive model surfaces.
 */
/**
 * Sorted transparent runs depend only on the plan and the view direction. Reusing them keeps the
 * batches' identity, so their GPU geometry stays cached while the camera pans or zooms; rebuilding
 * every frame uploaded tens of thousands of fresh runs per frame on Amphion.
 */
const transparentDrawPlans = new WeakMap<
  WorldWebGlPlan,
  Readonly<{ key: string; draws: readonly WorldWebGlTransparentDraw[] }>
>()

export function createWorldWebGlTransparentDrawPlan(
  plan: WorldWebGlPlan,
  requested?: WorldWebGlCamera,
  /** Leave out the terrain-clipped water that `plan.waterPlanes` replace. */
  options: Readonly<{ excludeClippedWater?: boolean }> = {},
): readonly WorldWebGlTransparentDraw[] {
  const view = cameraState(requested)
  const excludeClippedWater = options.excludeClippedWater === true
  const key = `${String(view.azimuth)}:${String(view.elevation)}:${String(excludeClippedWater)}`
  const cached = transparentDrawPlans.get(plan)
  if (cached?.key === key) return cached.draws
  const draws = sortedWorldWebGlTransparentDraws(plan, view, excludeClippedWater)
  transparentDrawPlans.set(plan, Object.freeze({ key, draws }))
  return draws
}

function sortedWorldWebGlTransparentDraws(
  plan: WorldWebGlPlan,
  view: ReturnType<typeof cameraState>,
  excludeClippedWater = false,
): readonly WorldWebGlTransparentDraw[] {
  const horizontal = Math.cos(view.elevation)
  const direction = [
    Math.cos(view.azimuth) * horizontal,
    Math.sin(view.elevation),
    Math.sin(view.azimuth) * horizontal,
  ] as const
  const sources = [
    ...(plan.transparentTriangles.positions.length === 0
      ? []
      : [
          {
            kind: 'untextured' as const,
            blendMode: 'blend' as const,
            receiveShadows: false as const,
            batch: plan.transparentTriangles,
          },
        ]),
    ...plan.transparentTexturedTriangles
      .filter(batch => batch.splatLayer === undefined)
      .map(batch => ({
      kind: 'textured' as const,
      blendMode: batch.blendMode,
      receiveShadows: batch.receiveShadows,
      batch,
    })),
  ]
  const triangles: Array<{
    sourceIndex: number
    priority: number
    offset: number
    depth: number
    ordinal: number
  }> = []
  let ordinal = 0
  for (const [sourceIndex, source] of sources.entries()) {
    const { positions, normals, colors } = source.batch
    const vertices = positions.length / 3
    if (
      positions.length % 9 !== 0 ||
      normals.length !== positions.length ||
      colors.length !== vertices * 4 ||
      (source.kind === 'textured' && source.batch.textureCoordinates.length !== vertices * 2) ||
      (source.kind === 'textured' &&
        source.batch.secondaryTextureCoordinates !== undefined &&
        source.batch.secondaryTextureCoordinates.length !== vertices * 2)
    ) {
      throw new TypeError('world transparent batch attributes must align to complete triangles')
    }
    // The untextured batch starts with the clipped water; a renderer drawing the planes skips it.
    const first =
      excludeClippedWater && source.kind === 'untextured' ? plan.transparentWaterTriangles * 9 : 0
    const priority = source.kind === 'textured' ? (source.batch.priority ?? 0) : 0
    for (let offset = first; offset < positions.length; offset += 9) {
      let depth = 0
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const start = offset + vertex * 3
        depth +=
          positions[start]! * direction[0] +
          positions[start + 1]! * direction[1] +
          positions[start + 2]! * direction[2]
      }
      triangles.push({ sourceIndex, priority, offset, depth, ordinal })
      ordinal += 1
    }
  }
  // By priority, then back to front: the camera is positioned along +direction, so the smallest
  // projection is farthest away.
  triangles.sort(
    (left, right) =>
      left.priority - right.priority || left.depth - right.depth || left.ordinal - right.ordinal,
  )

  const output: WorldWebGlTransparentDraw[] = []
  const indices = sources.map(source => new Uint32Array(source.batch.positions.length / 3))
  const filled = sources.map(() => 0)
  let activeSourceIndex = -1
  let runFirst = 0
  let runDepth = 0
  const flush = () => {
    if (activeSourceIndex < 0) return
    const source = sources[activeSourceIndex]!
    const count = filled[activeSourceIndex]! - runFirst
    if (count === 0) return
    // Each triangle's depth sums its three vertices; a run's mean vertex projection is sum / count.
    const range = Object.freeze({
      indices: indices[activeSourceIndex]!,
      first: runFirst,
      count,
      depth: runDepth / count,
    })
    output.push(
      source.kind === 'untextured'
        ? Object.freeze({
            kind: 'untextured',
            blendMode: 'blend',
            receiveShadows: false,
            batch: source.batch,
            range,
          })
        : Object.freeze({
            kind: 'textured',
            blendMode: source.blendMode,
            receiveShadows: source.receiveShadows,
            batch: source.batch,
            range,
          }),
    )
  }
  for (const triangle of triangles) {
    if (triangle.sourceIndex !== activeSourceIndex) {
      flush()
      activeSourceIndex = triangle.sourceIndex
      runFirst = filled[activeSourceIndex]!
      runDepth = 0
    }
    const target = indices[activeSourceIndex]!
    const vertex = triangle.offset / 3
    let at = filled[activeSourceIndex]!
    target[at++] = vertex
    target[at++] = vertex + 1
    target[at++] = vertex + 2
    filled[activeSourceIndex] = at
    runDepth += triangle.depth
  }
  flush()
  return Object.freeze(output)
}

export type WorldWebGlCompositeTransparentDraw =
  | Readonly<{ kind: 'world'; draw: WorldWebGlTransparentDraw }>
  | Readonly<{
      kind: 'material'
      scene: WorldWebGlModelMaterialScene
      draw: MaterialDraw & { readonly program: NonNullable<MaterialDraw['program']> }
      /**
       * Built for this frame alone (an effect's sprites): drawn with others of its program as one
       * draw wherever the order allows (see packWorldWebGlTransparentDraws).
       */
      merge?: boolean
      /** Copies of `draw`'s geometry it draws, in their order (see worldMaterialInstances). */
      instances?: MaterialInstances
    }>

const boundsCenters = new WeakMap<Float32Array, readonly [number, number, number]>()
const primitiveBounds = new WeakMap<Float32Array, ReturnType<typeof boundsOf>>()

/** Vertex arrays are shared by every instance and immutable for a plan: scan each one once. */
function cachedPrimitiveBounds(positions: Float32Array): ReturnType<typeof boundsOf> {
  let bounds = primitiveBounds.get(positions)
  if (bounds === undefined) primitiveBounds.set(positions, (bounds = boundsOf(positions)))
  return bounds
}

/**
 * Depth of a transparent primitive's bounds centre along the view direction, a skin's as its pose
 * stands (materialSkinCenter).
 */
function transparentProjectionDepth(
  primitive: SceneRendererPrimitive,
  direction: readonly [number, number, number],
): number {
  const positions = primitive.positions
  const transform = primitive.transform
  const skin = materialSkinOf(primitive)
  let center =
    skin === undefined ? boundsCenters.get(positions) : materialSkinCenter(primitive, skin)
  if (center === undefined) {
    if (positions.length % 3 !== 0 || !positions.every(Number.isFinite))
      throw new TypeError('world transparent primitive contains invalid positions')
    const { min, max } = cachedPrimitiveBounds(positions)
    center =
      positions.length === 0
        ? ([0, 0, 0] as const)
        : (min.map((value, axis) => (value + max[axis]!) / 2) as [number, number, number])
    boundsCenters.set(positions, center)
  }
  let point: readonly [number, number, number] = center
  if (transform !== undefined) {
    if (transform.length !== 16 || !transform.every(Number.isFinite))
      throw new TypeError('world transparent primitive contains an invalid transform')
    const x = point[0],
      y = point[1],
      z = point[2]
    const w = transform[3]! * x + transform[7]! * y + transform[11]! * z + transform[15]!
    if (w === 0 || !Number.isFinite(w))
      throw new TypeError('world transparent primitive transform has no finite projection')
    point = [
      (transform[0]! * x + transform[4]! * y + transform[8]! * z + transform[12]!) / w,
      (transform[1]! * x + transform[5]! * y + transform[9]! * z + transform[13]!) / w,
      (transform[2]! * x + transform[6]! * y + transform[10]! * z + transform[14]!) / w,
    ]
  }
  const depth = point[0] * direction[0] + point[1] * direction[1] + point[2] * direction[2]
  if (!Number.isFinite(depth)) throw new TypeError('world transparent depth exceeds finite range')
  return depth
}

/**
 * Every transparent draw of a frame in blending order: world runs and transparent material passes by
 * priority and depth, then packed so that decals of one batch draw as one run wherever the order among
 * overlapping draws allows it.
 */
export function createWorldWebGlCompositeTransparentDrawPlan(
  plan: WorldWebGlPlan,
  requested: WorldWebGlCamera | undefined,
  materialDraws: readonly Readonly<{
    scene: WorldWebGlModelMaterialScene
    draw: MaterialDraw & { readonly program: NonNullable<MaterialDraw['program']> }
    merge?: boolean
  }>[],
  excludeClippedWater = false,
  /**
   * Width over height of the viewport: draws that lie wholly outside the camera's view are left
   * out (see worldViewRectangle). Without it every draw is packed.
   */
  aspect?: number,
): readonly WorldWebGlCompositeTransparentDraw[] {
  const view = cameraState(requested)
  const worldDraws = createWorldWebGlTransparentDrawPlan(plan, requested, { excludeClippedWater })
  const visible = aspect === undefined ? undefined : worldViewRectangle(plan, view, aspect)
  // The world runs are cached per view direction; the same runs, view and material draws pack the
  // same.
  const key: unknown[] = [
    worldDraws,
    visible?.u,
    visible?.v,
    visible?.halfWidth,
    visible?.halfHeight,
  ]
  for (const { draw } of materialDraws)
    key.push(
      draw.primitive.positions,
      draw.primitive.transform,
      draw.program,
      materialSkinOf(draw.primitive)?.palette,
    )
  const cached = compositeTransparentPacks.get(plan)
  if (
    cached !== undefined &&
    cached.key.length === key.length &&
    cached.key.every((value, index) => value === key[index])
  )
    return cached.draws
  const horizontal = Math.cos(view.elevation)
  const direction = [
    Math.cos(view.azimuth) * horizontal,
    Math.sin(view.elevation),
    Math.sin(view.azimuth) * horizontal,
  ] as const
  const entries: Array<{
    value: WorldWebGlCompositeTransparentDraw
    priority: number
    depth: number
    ordinal: number
  }> = []
  for (const draw of worldDraws)
    entries.push({
      value: Object.freeze({ kind: 'world', draw }),
      priority: draw.kind === 'textured' ? (draw.batch.priority ?? 0) : 0,
      depth: draw.range.depth,
      ordinal: entries.length,
    })
  for (const entry of materialDraws)
    entries.push({
      value: Object.freeze({ kind: 'material', ...entry }),
      priority: entry.draw.program.priority,
      depth: transparentProjectionDepth(entry.draw.primitive, direction),
      ordinal: entries.length,
    })
  entries.sort(
    (left, right) =>
      left.priority - right.priority || left.depth - right.depth || left.ordinal - right.ordinal,
  )
  const ordered = entries.map(entry => entry.value)
  const draws = packWorldWebGlTransparentDraws(plan, view, worldDraws, ordered, visible)
  compositeTransparentPacks.set(plan, Object.freeze({ key, draws }))
  return draws
}

/** The last packed composite per plan, keyed by its world runs and material draw identities. */
const compositeTransparentPacks = new WeakMap<
  WorldWebGlPlan,
  Readonly<{ key: readonly unknown[]; draws: readonly WorldWebGlCompositeTransparentDraw[] }>
>()

/** Screen boxes of a world transparent plan's triangles; the plan is cached per view direction. */
const worldTransparentTriangles = new WeakMap<
  readonly WorldWebGlTransparentDraw[],
  Readonly<{
    boxes: Float64Array
    depths: Float64Array
    /** First vertex of each triangle in its batch: triangles are three consecutive vertices. */
    vertices: Uint32Array
    /** Each run's first triangle, then one past the last. */
    runStarts: Uint32Array
    runOf: ReadonlyMap<WorldWebGlTransparentDraw, number>
  }>
>()

/** An orthonormal basis of the view plane: the orthographic camera's screen axes up to sign. */
function worldViewPlaneBasis(view: ReturnType<typeof cameraState>) {
  const horizontal = Math.cos(view.elevation)
  const direction = [
    Math.cos(view.azimuth) * horizontal,
    Math.sin(view.elevation),
    Math.sin(view.azimuth) * horizontal,
  ] as const
  // cross((0, 1, 0), direction); straight down any horizontal axis will do.
  const length = Math.hypot(direction[2], direction[0])
  const right =
    length < 1e-9
      ? ([1, 0, 0] as const)
      : ([direction[2] / length, 0, -direction[0] / length] as const)
  const up = [
    direction[1] * right[2] - direction[2] * right[1],
    direction[2] * right[0] - direction[0] * right[2],
    direction[0] * right[1] - direction[1] * right[0],
  ] as const
  return { direction, right, up }
}

/**
 * What the orthographic camera shows, in the view-plane basis (worldViewPlaneBasis, whose axes are the
 * camera's): the point it looks at and the half width and height of its frustum, as cameraFor frames
 * them (radius over zoom, times the aspect across).
 */
function worldViewRectangle(
  plan: WorldWebGlPlan,
  view: ReturnType<typeof cameraState>,
  aspect: number,
): Readonly<{ u: number; v: number; halfWidth: number; halfHeight: number }> | undefined {
  if (!(aspect > 0) || !Number.isFinite(aspect)) return undefined
  // ponytail: a perspective view culls nothing on the CPU (its far plane still clips); a frustum test
  // belongs here when a first-person world draws too much
  if (view.projection === 'perspective') return undefined
  const frame = view.frame ?? plan.stats.frame
  const center = [0, 1, 2].map(axis => frame.center[axis]! + view.target[axis]!) as [
    number,
    number,
    number,
  ]
  const halfHeight = frame.radius / view.zoom
  const { right, up } = worldViewPlaneBasis(view)
  const rectangle = {
    u: center[0] * right[0] + center[1] * right[1] + center[2] * right[2],
    v: center[0] * up[0] + center[1] * up[1] + center[2] * up[2],
    halfWidth: halfHeight * aspect,
    halfHeight,
  }
  return Object.values(rectangle).every(Number.isFinite) ? Object.freeze(rectangle) : undefined
}

/**
 * Screen box of a transformed primitive: its local bounds' corners projected on the view plane. A
 * skin's bounds hold its pose (materialSkinBounds), so the box holds every pixel it draws.
 */
function primitiveScreenBox(
  primitive: SceneRendererPrimitive,
  basis: ReturnType<typeof worldViewPlaneBasis>,
  box: Float64Array,
  offset: number,
): void {
  const skin = materialSkinOf(primitive)
  const posed = skin === undefined ? undefined : materialSkinBounds(primitive, skin)
  const { min, max } =
    posed === undefined
      ? cachedPrimitiveBounds(primitive.positions)
      : { min: posed.minimum, max: posed.maximum }
  if (!(min[0] <= max[0])) {
    // Nothing to draw, nothing to overlap.
    box.set([Infinity, Infinity, -Infinity, -Infinity], offset)
    return
  }
  const matrix = primitive.transform
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let corner = 0; corner < 8; corner += 1) {
    let x = corner & 1 ? max[0] : min[0]
    let y = corner & 2 ? max[1] : min[1]
    let z = corner & 4 ? max[2] : min[2]
    if (matrix !== undefined) {
      const w = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!
      const tx = (matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!) / w
      const ty = (matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!) / w
      z = (matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!) / w
      x = tx
      y = ty
    }
    const u = x * basis.right[0] + y * basis.right[1] + z * basis.right[2]
    const v = x * basis.up[0] + y * basis.up[1] + z * basis.up[2]
    // NaN keeps the bounds NaN, which the levelling reads as covering everything.
    x0 = u < x0 || Number.isNaN(u) ? u : x0
    x1 = u > x1 || Number.isNaN(u) ? u : x1
    y0 = v < y0 || Number.isNaN(v) ? v : y0
    y1 = v > y1 || Number.isNaN(v) ? v : y1
  }
  box[offset] = x0
  box[offset + 1] = y0
  box[offset + 2] = x1
  box[offset + 3] = y1
}

function worldTransparentTrianglesOf(
  worldDraws: readonly WorldWebGlTransparentDraw[],
  basis: ReturnType<typeof worldViewPlaneBasis>,
) {
  const cached = worldTransparentTriangles.get(worldDraws)
  if (cached !== undefined) return cached
  let total = 0
  for (const draw of worldDraws) total += draw.range.count / 3
  const boxes = new Float64Array(total * 4)
  const depths = new Float64Array(total)
  const vertices = new Uint32Array(total)
  const runStarts = new Uint32Array(worldDraws.length + 1)
  const runOf = new Map<WorldWebGlTransparentDraw, number>()
  let triangle = 0
  worldDraws.forEach((draw, run) => {
    runOf.set(draw, run)
    runStarts[run] = triangle
    const positions = draw.batch.positions
    const { indices, first, count } = draw.range
    for (let index = first; index < first + count; index += 3, triangle += 1) {
      const vertex = indices[index]!
      vertices[triangle] = vertex
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      let depth = 0
      for (let corner = 0; corner < 3; corner += 1) {
        const at = (vertex + corner) * 3
        const x = positions[at]!
        const y = positions[at + 1]!
        const z = positions[at + 2]!
        const u = x * basis.right[0] + y * basis.right[1] + z * basis.right[2]
        const v = x * basis.up[0] + y * basis.up[1] + z * basis.up[2]
        if (u < x0) x0 = u
        if (u > x1) x1 = u
        if (v < y0) y0 = v
        if (v > y1) y1 = v
        depth += x * basis.direction[0] + y * basis.direction[1] + z * basis.direction[2]
      }
      boxes.set([x0, y0, x1, y1], triangle * 4)
      depths[triangle] = depth / 3
    }
  })
  runStarts[worldDraws.length] = triangle
  const result = Object.freeze({ boxes, depths, vertices, runStarts, runOf })
  worldTransparentTriangles.set(worldDraws, result)
  return result
}

type WorldCompositeMaterialDraw = Extract<WorldWebGlCompositeTransparentDraw, { kind: 'material' }>

/**
 * Which material draws the packer draws as one (mergeMaterialDraws): draws built for this frame of
 * one program and material, with one depth bias, tint and vertex layout. Not a depth prepass, which
 * would write every member's depth before any member's colour, nor object-space normals, which take
 * the draw's own normal matrix.
 */
function worldMaterialMergeKey(entry: WorldCompositeMaterialDraw): string | undefined {
  const { draw } = entry
  const { program, primitive } = draw
  if (
    entry.merge !== true ||
    draw.depthOnly === true ||
    program.depthPrepass === true ||
    !materialCanInstance(program) ||
    primitive.topology !== 'triangles' ||
    materialSkinOf(primitive) !== undefined
  )
    return undefined
  const bias = primitive.depthBias
  return [
    worldGroupId(program),
    worldGroupId(draw.material),
    bias === undefined ? '-' : `${bias.slopeScale}:${bias.units}`,
    primitiveTint(primitive).join(':'),
    [
      primitive.indices,
      primitive.normals,
      primitive.tangents,
      primitive.colors,
      primitive.textureCoordinates,
      primitiveVertexTints(primitive),
    ]
      .map(values => (values === undefined ? '-' : '+'))
      .join(''),
    (primitive.textureCoordinateSets ?? []).map(set => set.set).join(','),
  ].join('|')
}

/**
 * The members of a packed group (worldMaterialMergeKey) as instances of one draw, in the group's
 * order, when they are copies of one geometry: an effect frame placed at many objects. The vertex
 * stage reads an instance's matrix as it reads a merged vertex's (mergeMaterialDraws), so every
 * vertex computes what it computed merged, and no vertex is copied. Undefined unless every member
 * draws the same vertex arrays, unmerged and unmirrored.
 */
function worldMaterialInstances(
  entries: readonly WorldCompositeMaterialDraw[],
): WorldCompositeMaterialDraw | undefined {
  const first = entries[0]
  if (first === undefined || entries.length < 2) return undefined
  const lead = first.draw.primitive
  for (const { draw } of entries) {
    const primitive = draw.primitive
    if (
      !sameMaterialGeometry(primitive, lead) ||
      primitiveVertexTints(primitive) !== primitiveVertexTints(lead) ||
      primitiveVertexPlacements(primitive) !== undefined ||
      materialMirrors(materialModelMatrix(primitive))
    )
      return undefined
  }
  const matrices = new Float32Array(entries.length * 16)
  entries.forEach(({ draw }, index) =>
    matrices.set(materialModelMatrix(draw.primitive), index * 16),
  )
  const { transform: _transform, ...shared } = lead
  return Object.freeze({
    ...first,
    draw: Object.freeze({ ...first.draw, primitive: Object.freeze(shared) }),
    instances: Object.freeze({ matrices, count: entries.length }),
  })
}

/**
 * Blend classes whose draws commute (see transparentOrderLevels): additions to the target (a world
 * batch's additive blend, a material's additive and add-alpha) and products with it (modulate). A
 * draw that writes depth commutes with nothing.
 */
const ADDING_BLEND = 1
const MULTIPLYING_BLEND = 2

function worldMaterialBlendClass(draw: WorldCompositeMaterialDraw['draw']): number {
  const { program } = draw
  if (materialIsSolid(program) || draw.depthOnly === true || program.depthPrepass === true) return 0
  return program.blend === 'additive' || program.blend === 'add-alpha'
    ? ADDING_BLEND
    : program.blend === 'modulate' || program.blend === 'modulate2x'
      ? MULTIPLYING_BLEND
      : 0
}

/**
 * Transparent draws in back-to-front order, packed: see `transparentOrderLevels`. Decals of one
 * batch that alternate in depth with other batches but never overlap them on screen draw as one run,
 * and every pair that does overlap keeps its sorted order (unless both add to the target, which sums
 * alike in any order), so the blended picture is unchanged.
 * Each world triangle is its own item. So is each material draw; those built for this frame (an
 * effect's sprites) batch by program and draw as one wherever the order allows, each vertex with its
 * draw's model matrix (see worldMaterialMergeKey).
 */
function packWorldWebGlTransparentDraws(
  plan: WorldWebGlPlan,
  view: ReturnType<typeof cameraState>,
  worldDraws: readonly WorldWebGlTransparentDraw[],
  ordered: readonly WorldWebGlCompositeTransparentDraw[],
  visible?: ReturnType<typeof worldViewRectangle>,
): readonly WorldWebGlCompositeTransparentDraw[] {
  const basis = worldViewPlaneBasis(view)
  const triangles = worldTransparentTrianglesOf(worldDraws, basis)
  let materials = 0
  for (const entry of ordered) if (entry.kind === 'material') materials += 1
  const extent = Math.hypot(
    plan.bounds.maximum[0] - plan.bounds.minimum[0],
    plan.bounds.maximum[1] - plan.bounds.minimum[1],
    plan.bounds.maximum[2] - plan.bounds.minimum[2],
  )
  // Far above float32 projection error, far below a decal: only near-touching boxes are affected.
  const epsilon = Math.max(1e-4, extent * 1e-5)
  // A box wholly outside the view covers no pixel: it neither draws nor orders anything. A box with a
  // non-finite bound (drawn everywhere) or an empty one fails none of the tests and is kept.
  const u0 = visible === undefined ? -Infinity : visible.u - visible.halfWidth - epsilon,
    u1 = visible === undefined ? Infinity : visible.u + visible.halfWidth + epsilon,
    v0 = visible === undefined ? -Infinity : visible.v - visible.halfHeight - epsilon,
    v1 = visible === undefined ? Infinity : visible.v + visible.halfHeight + epsilon
  const outside = (source: Float64Array, at: number) =>
    source[at + 2]! < u0 || source[at]! > u1 || source[at + 3]! < v0 || source[at + 1]! > v1
  const capacity = triangles.depths.length + materials
  const boxes = new Float64Array(capacity * 4)
  const batches = new Int32Array(capacity)
  const blends = new Uint8Array(capacity)
  const itemTriangle = new Int32Array(capacity).fill(-1)
  const itemEntry: WorldWebGlCompositeTransparentDraw[] = []
  // World batches and material merge keys, numbered apart.
  const batchIds = new Map<WorldWebGlBatch | string, number>()
  let item = 0
  for (const entry of ordered) {
    if (entry.kind === 'material') {
      primitiveScreenBox(entry.draw.primitive, basis, boxes, item * 4)
      if (outside(boxes, item * 4)) continue
      const key = worldMaterialMergeKey(entry)
      let batch = key === undefined ? -1 : batchIds.get(key)
      if (batch === undefined) batchIds.set(key!, (batch = batchIds.size))
      batches[item] = batch
      blends[item] = worldMaterialBlendClass(entry.draw)
      itemEntry[item] = entry
      item += 1
      continue
    }
    const run = triangles.runOf.get(entry.draw)
    if (run === undefined) throw new TypeError('world transparent run is not in its plan')
    let batch = batchIds.get(entry.draw.batch)
    if (batch === undefined) batchIds.set(entry.draw.batch, (batch = batchIds.size))
    const blend = entry.draw.blendMode === 'additive' ? ADDING_BLEND : 0
    for (let triangle = triangles.runStarts[run]!; triangle < triangles.runStarts[run + 1]!; triangle += 1) {
      // Element copies: a subarray view per triangle cost more than the copy (71 000 a frame).
      const from = triangle * 4,
        to = item * 4
      if (outside(triangles.boxes, from)) continue
      boxes[to] = triangles.boxes[from]!
      boxes[to + 1] = triangles.boxes[from + 1]!
      boxes[to + 2] = triangles.boxes[from + 2]!
      boxes[to + 3] = triangles.boxes[from + 3]!
      batches[item] = batch
      blends[item] = blend
      itemTriangle[item] = triangle
      itemEntry[item] = entry
      item += 1
    }
  }
  const count = item
  const levels = transparentOrderLevels(
    boxes.subarray(0, count * 4),
    batches.subarray(0, count),
    epsilon,
    blends.subarray(0, count),
  )
  // Stable order by level: counting sort.
  let deepest = 0
  for (const level of levels) if (level > deepest) deepest = level
  const starts = new Int32Array(deepest + 2)
  for (const level of levels) starts[level + 1]! += 1
  for (let level = 1; level < starts.length; level += 1) starts[level]! += starts[level - 1]!
  const order = new Int32Array(count)
  for (let index = 0; index < count; index += 1) order[starts[levels[index]!]!++] = index
  interface Group {
    readonly draw: WorldWebGlTransparentDraw
    readonly triangles: number[]
  }
  interface MaterialGroup {
    readonly entries: WorldCompositeMaterialDraw[]
  }
  const emitted: (WorldWebGlCompositeTransparentDraw | Group | MaterialGroup)[] = []
  let currentLevel = -1
  let groups = new Map<number, Group>()
  let materialGroups = new Map<number, MaterialGroup>()
  for (const index of order) {
    const level = levels[index]!
    if (level !== currentLevel) {
      currentLevel = level
      groups = new Map()
      materialGroups = new Map()
    }
    const entry = itemEntry[index]!
    const triangle = itemTriangle[index]!
    if (entry.kind === 'material' && batches[index]! >= 0) {
      let group = materialGroups.get(batches[index]!)
      if (group === undefined) {
        group = { entries: [] }
        materialGroups.set(batches[index]!, group)
        emitted.push(group)
      }
      group.entries.push(entry)
      continue
    }
    if (triangle < 0 || entry.kind !== 'world') {
      emitted.push(entry)
      continue
    }
    let group = groups.get(batches[index]!)
    if (group === undefined) {
      group = { draw: entry.draw, triangles: [] }
      groups.set(batches[index]!, group)
      emitted.push(group)
    }
    group.triangles.push(triangle)
  }
  // One index list per batch, its groups laid out in draw order, so every group is one range.
  const sizes = new Map<WorldWebGlBatch, number>()
  for (const value of emitted)
    if ('triangles' in value)
      sizes.set(value.draw.batch, (sizes.get(value.draw.batch) ?? 0) + value.triangles.length * 3)
  const lists = new Map<WorldWebGlBatch, { indices: Uint32Array; filled: number }>()
  for (const [batch, size] of sizes) lists.set(batch, { indices: new Uint32Array(size), filled: 0 })
  return Object.freeze(
    emitted.flatMap(value => {
      if ('entries' in value) {
        const instanced = worldMaterialInstances(value.entries)
        if (instanced !== undefined) return [instanced]
        // Draws whose vertices do not lay out alike stay apart, still in the group's order.
        const draw = mergeMaterialDraws(value.entries.map(entry => entry.draw))
        return draw === undefined || value.entries.length === 1
          ? value.entries
          : [Object.freeze({ ...value.entries[0]!, draw })]
      }
      if (!('triangles' in value)) return [value]
      const list = lists.get(value.draw.batch)!
      const first = list.filled
      let depth = 0
      for (const triangle of value.triangles) {
        const vertex = triangles.vertices[triangle]!
        list.indices[list.filled++] = vertex
        list.indices[list.filled++] = vertex + 1
        list.indices[list.filled++] = vertex + 2
        depth += triangles.depths[triangle]!
      }
      const range = Object.freeze({
        indices: list.indices,
        first,
        count: list.filled - first,
        depth: depth / value.triangles.length,
      })
      return [Object.freeze({ kind: 'world', draw: Object.freeze({ ...value.draw, range }) })]
    }),
  )
}

export function orbitWorldWebGlCamera(
  source: WorldWebGlCamera,
  delta: Readonly<{ x: number; y: number }>,
): WorldWebGlCamera {
  cameraState(source)
  if (![delta.x, delta.y].every(Number.isFinite))
    throw new TypeError('world WebGL orbit delta must be finite')
  return Object.freeze({
    ...source,
    azimuth: source.azimuth - delta.x * 0.008,
    elevation: clampElevation(source, source.elevation + delta.y * 0.008),
  })
}

/** An elevation within the camera's range: a perspective eye may look up, an orbit only down. */
function clampElevation(view: WorldWebGlCamera, elevation: number): number {
  const lowest = view.projection === 'perspective' ? 0.04 - Math.PI / 2 : 0.04
  return Math.max(lowest, Math.min(Math.PI / 2 - 0.04, elevation))
}

/**
 * A perspective camera looking around from where its eye stands (first person, MW6): the view turns
 * with the drag and the target moves so the eye stays. An orthographic camera orbits instead.
 */
export function lookWorldWebGlCamera(
  input: WorldWebGlInput,
  source: WorldWebGlCamera,
  delta: Readonly<{ x: number; y: number }>,
): WorldWebGlCamera {
  const view = cameraState(source)
  if (view.projection !== 'perspective') return orbitWorldWebGlCamera(view, delta)
  if (![delta.x, delta.y].every(Number.isFinite))
    throw new TypeError('world WebGL look delta must be finite')
  const frame = view.frame ?? createWorldWebGlPlan(input).stats.frame
  const pose = cameraPose(frame, view)
  const eye = pose.center.clone().addScaledVector(pose.toEye, pose.distance)
  const turned = Object.freeze({
    ...view,
    azimuth: view.azimuth + delta.x * 0.008,
    elevation: clampElevation(view, view.elevation + delta.y * 0.008),
  })
  const target = eye
    .addScaledVector(cameraPose(frame, turned).toEye, -pose.distance)
    .sub(new Vector3(...frame.center))
  return Object.freeze({
    ...turned,
    target: Object.freeze([target.x, target.y, target.z] as const),
  })
}

/**
 * The camera flown by `forward` along its view, `right` across it and `up` the world's up axis, in
 * world units: the eye and the target move together (free flight, MW6).
 */
export function flyWorldWebGlCamera(
  source: WorldWebGlCamera,
  move: Readonly<{ forward: number; right: number; up: number }>,
): WorldWebGlCamera {
  const view = cameraState(source)
  if (![move.forward, move.right, move.up].every(Number.isFinite))
    throw new TypeError('world WebGL flight must be finite')
  const horizontal = Math.cos(view.elevation)
  const forward = [
    -Math.cos(view.azimuth) * horizontal,
    -Math.sin(view.elevation),
    -Math.sin(view.azimuth) * horizontal,
  ]
  const right = [Math.sin(view.azimuth), 0, -Math.cos(view.azimuth)]
  return Object.freeze({
    ...view,
    target: Object.freeze([
      view.target[0] + forward[0]! * move.forward + right[0]! * move.right,
      view.target[1] + forward[1]! * move.forward + move.up,
      view.target[2] + forward[2]! * move.forward + right[2]! * move.right,
    ] as const),
  })
}

/** The default lens of a perspective camera: 60° vertically. */
const WORLD_FIELD_OF_VIEW = Math.PI / 3

/**
 * The camera a world opens on, from the game's view of it (MapWorldCamera, WT3/MW6): its
 * projection, angles, lens and draw distance over `base`; an angle outside what the projection can
 * take is brought within it.
 */
export function worldWebGlCameraFromMap(
  camera: MapWorldCamera | undefined,
  base: WorldWebGlCamera = DEFAULT_WORLD_WEBGL_CAMERA,
): WorldWebGlCamera {
  if (camera === undefined) return base
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const view: WorldWebGlCamera = {
    ...base,
    projection: camera.projection,
    ...(camera.azimuthDegrees === undefined ? {} : { azimuth: radians(camera.azimuthDegrees) }),
    ...(camera.fieldOfViewDegrees === undefined
      ? {}
      : { fieldOfView: Math.max(0.1, Math.min(2.8, radians(camera.fieldOfViewDegrees))) }),
    ...(camera.drawDistance === undefined ? {} : { far: camera.drawDistance }),
  }
  return Object.freeze({
    ...view,
    elevation: clampElevation(
      view,
      camera.elevationDegrees === undefined ? view.elevation : radians(camera.elevationDegrees),
    ),
  })
}

/**
 * Where a view's eye stands: the target in its frame, the unit vector from the target to the eye,
 * the height the view shows at the target, and the eye's distance - three frame radii for the
 * orthographic view, the distance at which a perspective lens frames that height.
 */
function cameraPose(frame: WorldWebGlFrame, view: WorldWebGlCamera) {
  const center = new Vector3(...frame.center).add(new Vector3(...view.target))
  const horizontal = Math.cos(view.elevation)
  const toEye = new Vector3(
    Math.cos(view.azimuth) * horizontal,
    Math.sin(view.elevation),
    Math.sin(view.azimuth) * horizontal,
  )
  const halfHeight = frame.radius / view.zoom
  const perspective = view.projection === 'perspective'
  const fieldOfView = view.fieldOfView ?? WORLD_FIELD_OF_VIEW
  const distance = perspective ? halfHeight / Math.tan(fieldOfView / 2) : frame.radius * 3
  return {
    center,
    toEye,
    halfHeight,
    perspective,
    fieldOfView,
    distance,
    far: perspective ? (view.far ?? distance + frame.radius * 10) : frame.radius * 10,
  }
}

export function zoomWorldWebGlCamera(
  source: WorldWebGlCamera,
  wheelDelta: number,
): WorldWebGlCamera {
  cameraState(source)
  if (!Number.isFinite(wheelDelta)) throw new TypeError('world WebGL zoom delta must be finite')
  return Object.freeze({
    ...source,
    zoom: Math.max(0.125, Math.min(16, source.zoom * Math.exp(-wheelDelta * 0.0015))),
  })
}

/** A plan's own camera frame: the middle of its bounds and 0.65 of their diagonal, at least 1. */
function worldPlanFrame(minimum: readonly number[], maximum: readonly number[]): WorldWebGlFrame {
  const center = [0, 1, 2].map(axis => (minimum[axis]! + maximum[axis]!) / 2)
  const radius = Math.hypot(...[0, 1, 2].map(axis => maximum[axis]! - minimum[axis]!)) * 0.65
  return Object.freeze({
    center: Object.freeze(center) as unknown as readonly [number, number, number],
    radius: Math.max(1, radius),
  })
}

/**
 * The ground a camera shows (MW5): where the rays through the corners of its orthographic view meet
 * the plane at the height of its frame's centre, within the near and far planes, as the box of their
 * x and z. A viewer asks a growing world for it (WorldSceneSource.focus).
 */
export function worldViewGroundWindow(
  frame: WorldWebGlFrame,
  requested: WorldWebGlCamera,
  aspect: number,
): Readonly<{ minimumX: number; minimumZ: number; maximumX: number; maximumZ: number }> {
  const view = cameraState(requested)
  if (!(aspect > 0) || !Number.isFinite(aspect))
    throw new TypeError('a world view aspect is positive and finite')
  const pose = cameraPose(frame, view)
  const { center, toEye, halfHeight } = pose
  // the camera's own axes as lookAt with +Y up makes them
  const right = new Vector3(0, 1, 0).cross(toEye).normalize()
  const up = toEye.clone().cross(right)
  const ground = frame.center[1]
  let minimumX = Infinity
  let minimumZ = Infinity
  let maximumX = -Infinity
  let maximumZ = -Infinity
  if (pose.perspective) {
    // each corner ray from the eye meets the ground, or stops at the far plane when it does not
    const eye = center.clone().addScaledVector(toEye, pose.distance)
    const slope = Math.tan(pose.fieldOfView / 2)
    for (const across of [-1, 1])
      for (const along of [-1, 1]) {
        const ray = toEye
          .clone()
          .negate()
          .addScaledVector(right, across * slope * aspect)
          .addScaledVector(up, along * slope)
          .normalize()
        const reach = ray.y < 0 ? Math.min(pose.far, (ground - eye.y) / ray.y) : pose.far
        const met = eye.clone().addScaledVector(ray, Math.max(0, reach))
        minimumX = Math.min(minimumX, met.x)
        minimumZ = Math.min(minimumZ, met.z)
        maximumX = Math.max(maximumX, met.x)
        maximumZ = Math.max(maximumZ, met.z)
      }
    return Object.freeze({ minimumX, minimumZ, maximumX, maximumZ })
  }
  for (const across of [-1, 1])
    for (const along of [-1, 1]) {
      const corner = center
        .clone()
        .addScaledVector(right, across * halfHeight * aspect)
        .addScaledVector(up, along * halfHeight)
      // the eye stands 3 radii before the centre, its far plane 10 radii beyond the eye
      const reach = Math.max(
        -3 * frame.radius,
        Math.min(7 * frame.radius, (corner.y - ground) / toEye.y),
      )
      const met = corner.addScaledVector(toEye, -reach)
      minimumX = Math.min(minimumX, met.x)
      minimumZ = Math.min(minimumZ, met.z)
      maximumX = Math.max(maximumX, met.x)
      maximumZ = Math.max(maximumZ, met.z)
    }
  return Object.freeze({ minimumX, minimumZ, maximumX, maximumZ })
}

function cameraFor(
  plan: WorldWebGlPlan,
  width: number,
  height: number,
  requested?: WorldWebGlCamera,
) {
  const view = cameraState(requested)
  const frame = view.frame ?? plan.stats.frame
  const center = new Vector3(...frame.center).add(new Vector3(...view.target))
  const radius = frame.radius
  const visibleRadius = radius / view.zoom
  const aspect = width / height
  const pose = cameraPose(frame, view)
  if (pose.perspective) {
    const lens = new PerspectiveCamera(
      (pose.fieldOfView * 180) / Math.PI,
      aspect,
      Math.max(0.01, pose.far / 100_000),
      pose.far,
    )
    lens.position.copy(center).addScaledVector(pose.toEye, pose.distance)
    lens.up.set(0, 1, 0)
    lens.lookAt(center)
    lens.updateMatrixWorld(true)
    lens.updateProjectionMatrix()
    return Object.freeze({ camera: lens, radius })
  }
  const camera = new OrthographicCamera(
    -visibleRadius * aspect,
    visibleRadius * aspect,
    visibleRadius,
    -visibleRadius,
    0.01,
    radius * 10,
  )
  const horizontal = Math.cos(view.elevation)
  camera.position
    .copy(center)
    .add(
      new Vector3(
        Math.cos(view.azimuth) * horizontal,
        Math.sin(view.elevation),
        Math.sin(view.azimuth) * horizontal,
      ).multiplyScalar(radius * 3),
    )
  camera.up.set(0, 1, 0)
  camera.lookAt(center)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  return Object.freeze({ camera, radius })
}

/**
 * The perspective eye that frames this view with the lighting's shadow-range field of view, and the
 * distance from it past which nothing is shadowed (SC2 CCamera ShadowClip). `reachable` is false
 * when no visible point can lie within that distance, so the shadow map need not be drawn at all:
 * the SC2 editor's whole-map view shows no shadows for exactly this reason. Undefined without a range.
 */
export function worldShadowRangeEye(
  plan: WorldWebGlPlan,
  width: number,
  height: number,
  requested?: WorldWebGlCamera,
): Readonly<{ eye: readonly [number, number, number]; distance: number; reachable: boolean }> | undefined {
  const range = plan.light.shadowRange
  if (range === undefined || !(range.distance > 0) || !(range.fieldOfViewDegrees > 0)) return undefined
  const { camera, radius } = cameraFor(plan, width, height, requested)
  if (camera instanceof PerspectiveCamera)
    return Object.freeze({
      eye: [camera.position.x, camera.position.y, camera.position.z] as const,
      distance: range.distance,
      reachable: true,
    })
  const forward = camera.getWorldDirection(new Vector3())
  const center = camera.position.clone().addScaledVector(forward, radius * 3)
  const halfHeight = camera.top
  const eyeDistance = halfHeight / Math.tan((Math.min(179, range.fieldOfViewDegrees) * Math.PI) / 360)
  const eye = center.clone().addScaledVector(forward, -eyeDistance)
  const nearest =
    eyeDistance -
    Math.hypot(camera.right, halfHeight) -
    (plan.bounds.maximum[1] - plan.bounds.minimum[1])
  return Object.freeze({
    eye: [eye.x, eye.y, eye.z] as const,
    distance: range.distance,
    reachable: nearest < range.distance,
  })
}

/**
 * Where the height fog's rays start: the perspective eye of the shadow range when the lighting names
 * one (the game camera that frames this view), else the view's own camera.
 */
export function worldFogEye(
  plan: WorldWebGlPlan,
  width: number,
  height: number,
  requested?: WorldWebGlCamera,
): readonly [number, number, number] {
  const framing = worldShadowRangeEye(plan, width, height, requested)
  if (framing !== undefined) return framing.eye
  const { camera } = cameraFor(plan, width, height, requested)
  return [camera.position.x, camera.position.y, camera.position.z] as const
}

/** Model material light: key color × intensity plus the authored ambient color, as terrain uses. */
export function worldMaterialLight(plan: WorldWebGlPlan) {
  const { direction, color, intensity, ambient, ambientIntensity } = plan.light
  return {
    // World facets carry the emitted ray; materialGeometry expects surface-to-light.
    direction: [-direction[0], -direction[1], -direction[2]] as const,
    color: [color[0] * intensity, color[1] * intensity, color[2] * intensity, 1] as const,
    specularColor: (plan.light.specularColor ?? color).map(
      value => value * (plan.light.specularIntensity ?? intensity),
    ) as [number, number, number],
    ambient: ambientIntensity,
    ambientColor: [
      ambient[0] * ambientIntensity,
      ambient[1] * ambientIntensity,
      ambient[2] * ambientIntensity,
    ] as const,
    fills: plan.light.fills.map(fill => ({
      direction: [-fill.direction[0], -fill.direction[1], -fill.direction[2]] as const,
      color: fill.color.map(value => value * fill.intensity) as [number, number, number],
    })),
  }
}

/** Returns the exact camera frame consumed by world material draws for parity and host overlays. */
export function createWorldWebGlCameraFrame(
  plan: WorldWebGlPlan,
  width: number,
  height: number,
  requested?: WorldWebGlCamera,
): WorldWebGlCameraFrame {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0)
    throw new TypeError('world WebGL camera viewport must contain positive safe integers')
  const { camera } = cameraFor(plan, width, height, requested)
  return Object.freeze({
    viewProjection: Float32Array.from(
      camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).elements,
    ),
    viewMatrix: Float32Array.from(camera.matrixWorldInverse.elements),
    eyePosition: Object.freeze([camera.position.x, camera.position.y, camera.position.z] as const),
  })
}

export function panWorldWebGlCamera(
  input: WorldWebGlInput,
  source: WorldWebGlCamera,
  delta: Readonly<{ x: number; y: number; viewportHeight: number }>,
): WorldWebGlCamera {
  const view = cameraState(source)
  if (
    ![delta.x, delta.y, delta.viewportHeight].every(Number.isFinite) ||
    delta.viewportHeight <= 0
  ) {
    throw new TypeError('world WebGL pan delta and viewport must be finite')
  }
  const plan = createWorldWebGlPlan(input)
  const { radius } = cameraFor(plan, delta.viewportHeight, delta.viewportHeight, view)
  const unitsPerPixel = (radius * 2) / (delta.viewportHeight * view.zoom)
  const right = [Math.sin(view.azimuth), 0, -Math.cos(view.azimuth)] as const
  const forward = [Math.cos(view.azimuth), 0, Math.sin(view.azimuth)] as const
  return Object.freeze({
    ...view,
    target: Object.freeze([
      view.target[0] + (-right[0] * delta.x + forward[0] * delta.y) * unitsPerPixel,
      view.target[1],
      view.target[2] + (-right[2] * delta.x + forward[2] * delta.y) * unitsPerPixel,
    ] as const),
  })
}

export type WorldWebGlPick = Readonly<{
  kind: 'terrain' | 'object'
  position: readonly [number, number, number]
  objectId?: number
}>

export type WorldWebGlPickScreen = Readonly<{ x: number; y: number; width: number; height: number }>

/** Casts through the same camera as the renderer and tests instance triangles before terrain. */
export function pickWorldWebGl(
  input: WorldWebGlInput,
  screen: WorldWebGlPickScreen,
): WorldWebGlPick | undefined {
  return pickWorldWebGlPlan(createWorldWebGlPlan(input), input, screen)
}

function pickWorldWebGlPlan(
  plan: WorldWebGlPlan,
  input: WorldWebGlInput,
  screen: WorldWebGlPickScreen,
): WorldWebGlPick | undefined {
  if (
    ![screen.x, screen.y, screen.width, screen.height].every(Number.isFinite) ||
    screen.width <= 0 ||
    screen.height <= 0
  ) {
    throw new TypeError('world WebGL pick screen must be finite and non-empty')
  }
  const { camera, radius } = cameraFor(plan, screen.width, screen.height, input.camera)
  const raycaster = new Raycaster()
  raycaster.setFromCamera(
    new Vector2((screen.x / screen.width) * 2 - 1, 1 - (screen.y / screen.height) * 2),
    camera,
  )
  let nearestDistance = Infinity
  let nearest: WorldWebGlPick | undefined
  const target = new Vector3()
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3()
  const box = new Box3()
  const intersectTriangles = (
    triangles: Float32Array,
    callback: (position: Vector3) => WorldWebGlPick,
  ) => {
    for (let offset = 0; offset + 8 < triangles.length; offset += 9) {
      const hit = raycaster.ray.intersectTriangle(
        new Vector3(triangles[offset], triangles[offset + 1], triangles[offset + 2]),
        new Vector3(triangles[offset + 3], triangles[offset + 4], triangles[offset + 5]),
        new Vector3(triangles[offset + 6], triangles[offset + 7], triangles[offset + 8]),
        false,
        target,
      )
      if (hit === null) continue
      const distance = raycaster.ray.origin.distanceTo(hit)
      if (distance >= nearestDistance) continue
      nearestDistance = distance
      nearest = callback(hit.clone())
    }
  }
  for (const object of plan.picking.objects) {
    if (object.placeholder) {
      const hit = raycaster.ray.intersectSphere(
        new Sphere(new Vector3(...object.center), Math.max(0.25, radius * 0.018)),
        target,
      )
      if (hit !== null) {
        const distance = raycaster.ray.origin.distanceTo(hit)
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearest = Object.freeze({
            kind: 'object',
            objectId: object.objectId,
            position: Object.freeze([hit.x, hit.y, hit.z] as const),
          })
        }
      }
      continue
    }
    intersectTriangles(object.triangles, hit =>
      Object.freeze({
        kind: 'object',
        objectId: object.objectId,
        position: Object.freeze([hit.x, hit.y, hit.z] as const),
      }),
    )
    for (const entry of object.primitives ?? []) {
      box.min.set(...entry.minimum)
      box.max.set(...entry.maximum)
      if (!raycaster.ray.intersectsBox(box)) continue
      for (const triangle of primitiveTriangles(entry.primitive)) {
        a.set(...transformedPrimitiveVertex(entry.primitive, triangle[0]))
        b.set(...transformedPrimitiveVertex(entry.primitive, triangle[1]))
        c.set(...transformedPrimitiveVertex(entry.primitive, triangle[2]))
        const hit = raycaster.ray.intersectTriangle(a, b, c, false, target)
        if (hit === null) continue
        const distance = raycaster.ray.origin.distanceTo(hit)
        if (distance >= nearestDistance) continue
        nearestDistance = distance
        nearest = Object.freeze({
          kind: 'object',
          objectId: object.objectId,
          position: Object.freeze([hit.x, hit.y, hit.z] as const),
        })
      }
    }
  }
  intersectTriangles(plan.picking.terrainTriangles, hit =>
    Object.freeze({
      kind: 'terrain',
      position: Object.freeze([hit.x, hit.y, hit.z] as const),
    }),
  )
  return nearest
}

export interface WorldWebGlMaterialGroup {
  readonly draw: MaterialDraw & { readonly program: NonNullable<MaterialDraw['program']> }
  readonly instances: MaterialInstances
}

export interface WorldWebGlMaterialBatches {
  /** Instanced draws, in the order their first placement appears in the plan. */
  readonly groups: readonly WorldWebGlMaterialGroup[]
  /** Solid draws of materials that cannot instance, one placement each. */
  readonly singles: readonly MaterialDraw[]
  /** The groups, then the singles: the renderer's draw sequence. */
  readonly sequence: readonly MaterialSequenceDraw[]
  /** Scenes with a blended pass: those passes keep their per-frame back-to-front order. */
  readonly transparentScenes: readonly WorldWebGlModelMaterialScene[]
}

/**
 * The draws of one blended material pass. A depth prepass fills the pass's depth right before its
 * colour, after every solid draw and every blended draw behind it: the pass then shows only its
 * nearest surface over the scene behind it, as in MK2. A solid pass writes its own depth and needs
 * no prepass; drawing prepasses with the solid passes instead would hide whatever solid draw came
 * later behind a translucent surface, so the picture would depend on the order of placements.
 */
export function worldBlendedMaterialPasses<Draw extends MaterialDraw>(draw: Draw): readonly Draw[] {
  return draw.program?.depthPrepass === true && !materialIsSolid(draw.program)
    ? [{ ...draw, depthOnly: true }, draw]
    : [draw]
}

const IDENTITY_VIEW_PROJECTION = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const worldMaterialBatches = new WeakMap<WorldWebGlPlan, WorldWebGlMaterialBatches>()
const worldShadowMaterialBatches = new WeakMap<WorldWebGlPlan, WorldWebGlMaterialBatches>()
const SHADOW_DEPTH_BIAS = Object.freeze({ slopeScale: 1.1, units: 4 })

/**
 * A scene's solid draws with their group keys (undefined: the draw cannot instance) and the part of
 * the key that is not the program and material: geometry, depth use, bias and tint.
 */
interface WorldSceneSolidDraws {
  readonly draws: readonly Readonly<{
    key: string | undefined
    geometryKey: string | undefined
    draw: WorldWebGlMaterialGroup['draw']
  }>[]
  readonly transparent: boolean
}

// Scenes are immutable and a retained object keeps its scenes across plans, so their solid draws
// and group keys are computed once per scene.
const worldSceneSolidDraws = new WeakMap<WorldWebGlModelMaterialScene, WorldSceneSolidDraws>()
const worldSceneCasterDraws = new WeakMap<WorldWebGlModelMaterialScene, WorldSceneSolidDraws>()
const worldGroupIds = new WeakMap<object, number>()
let worldGroupIdCount = 0
const worldGroupId = (value: object | undefined) => {
  if (value === undefined) return '-'
  let known = worldGroupIds.get(value)
  if (known === undefined) worldGroupIds.set(value, (known = ++worldGroupIdCount))
  return String(known)
}

/**
 * A kept scene's draw in the pose its skin stands for in a plan and where its object stands now:
 * the draw of the scene as the plan poses it (worldWebGlPosedScene), whose primitive differs from
 * this one's in its skin and transform alone. The draw itself where neither stands for another.
 */
function worldPosedDraw<T extends MaterialDraw>(
  draw: T,
  skin: ModelSceneSkin | undefined,
  transform: Float32Array | undefined,
): T {
  if (skin === undefined && transform === undefined) return draw
  return {
    ...draw,
    primitive: {
      ...draw.primitive,
      ...(skin === undefined ? {} : { skin }),
      ...(transform === undefined ? {} : { transform }),
    },
  }
}

function worldSceneSolidDrawsOf(
  scene: WorldWebGlModelMaterialScene,
  shadow: boolean,
): WorldSceneSolidDraws {
  const cache = shadow ? worldSceneCasterDraws : worldSceneSolidDraws
  const cached = cache.get(scene)
  if (cached !== undefined) return cached
  const primitives = shadow ? scene.shadowPrimitives : scene.primitives
  // Blended passes draw per frame in depth order (transparentScenes): only note that there are some.
  const transparent = primitives.some(primitive =>
    scene.programs
      .get(primitive.materialId ?? '')
      ?.passes.some(program => !materialIsSolid(program)),
  )
  const draws: {
    key: string | undefined
    geometryKey: string | undefined
    draw: WorldWebGlMaterialGroup['draw']
  }[] = []
  for (const found of sceneMaterialDraws(
    primitives,
    scene.materials,
    scene.programs,
    IDENTITY_VIEW_PROJECTION,
    [],
    1,
    undefined,
    true,
  )) {
    const program = found.program
    if (program === undefined) continue
    const draw = shadow
      ? {
          ...found,
          program,
          primitive: { ...found.primitive, depthBias: SHADOW_DEPTH_BIAS },
          depthOnly: true,
        }
      : worldSceneDraw(scene, { ...found, program })
    if (!materialCanInstance(program)) {
      draws.push({ key: undefined, geometryKey: undefined, draw })
      continue
    }
    const primitive = draw.primitive
    const bias = primitive.depthBias
    const skin = materialSkinOf(primitive)
    const geometryKey = [
      draw.depthOnly === true ? 'depth' : 'colour',
      primitive.topology,
      worldGroupId(primitive.positions),
      worldGroupId(primitive.normals),
      worldGroupId(primitive.tangents),
      worldGroupId(primitive.colors),
      worldGroupId(primitive.textureCoordinates),
      ...(primitive.textureCoordinateSets ?? []).map(
        set => `${set.set}:${worldGroupId(set.coordinates)}`,
      ),
      worldGroupId(primitive.indices),
      // a skin by its vertex slots and weights: placements in other poses draw at once (each
      // instance's palette, MaterialInstances.palettes)
      skin === undefined ? '-' : `${worldGroupId(skin.joints)}:${worldGroupId(skin.weights)}`,
      bias === undefined ? '-' : `${bias.slopeScale}:${bias.units}`,
      primitiveTint(primitive).join(':'),
    ].join('|')
    draws.push({
      key: `${worldGroupId(program)}|${worldGroupId(draw.material)}|${geometryKey}`,
      geometryKey,
      draw,
    })
  }
  const result = Object.freeze({ draws: Object.freeze(draws), transparent })
  cache.set(scene, result)
  return result
}

/**
 * Solid (opaque and alpha-tested) material draws of a plan, grouped by everything one instanced
 * draw shares: program, material, geometry, depth bias and tint. With depth writes the order of
 * solid passes does not decide the picture, so every placement of a group draws at once. Depth
 * prepasses are left to their blended passes (`worldBlendedMaterialPasses`). `shadow` builds the
 * depth-only casters of the shadow map instead.
 */
/**
 * Instance matrices of the latest grouping, per geometry key (see WorldSceneSolidDraws): every
 * animated frame groups a new plan, and a group whose placements are the same transform objects in
 * the same order takes the matrices it had instead of new ones. The same array keeps its uploaded
 * buffer and vertex array in the renderer, where a new one allocated both again for every group
 * at every frame. A program sampled at a new clock changes the group key, not the geometry key.
 */
/** A group's placements as last given: its matrices and, for a skin, the pose of each placement. */
type WorldInstancesKept = Readonly<{
  transforms: readonly Float32Array[]
  matrices: Float32Array
  palettes: readonly Float32Array[] | undefined
}>
const lastWorldInstanceMatrices = [
  new Map<string, WorldInstancesKept>(),
  new Map<string, WorldInstancesKept>(),
]

function groupWorldMaterialDraws(plan: WorldWebGlPlan, shadow: boolean): WorldWebGlMaterialBatches {
  interface Group {
    readonly draw: WorldWebGlMaterialGroup['draw']
    readonly geometryKey: string
    readonly transforms: Float32Array[]
    /** A skinned group's pose per placement, in the order of `transforms`. */
    readonly palettes: Float32Array[] | undefined
    readonly seen: Set<Float32Array>
  }
  // Groups by program, material and geometry key, in the order they first appear: the parts of a
  // draw's group key, without building a key string for each of a frame's ~15 000 draws.
  const groupsBy = new Map<unknown, Map<unknown, Map<string, Group>>>()
  const groups: Group[] = []
  const singles: MaterialDraw[] = []
  const transparentScenes: WorldWebGlModelMaterialScene[] = []
  const current = worldCurrentPrograms.get(plan)
  const skins = current?.skins
  const transforms = current?.transforms
  for (const scene of plan.modelMaterialScenes) {
    const solid = worldSceneSolidDrawsOf(scene, shadow)
    for (const { key, geometryKey, draw } of solid.draws) {
      // A kept scene's skin draws in the pose it stands for in this plan, and a moved object's
      // primitive where the object stands now.
      const skin = materialSkinOf(draw.primitive)
      const pose = skin === undefined ? undefined : (skins?.get(skin) ?? skin)
      const own = draw.primitive.transform
      const placed = own === undefined ? undefined : transforms?.get(own)
      if (key === undefined || geometryKey === undefined) {
        singles.push(worldPosedDraw(draw, pose === skin ? undefined : pose, placed))
        continue
      }
      // A kept scene's draw groups with the draws of the programs it stands for, as a new scene's
      // (the scene's key names its own program and material: worldSceneSolidDrawsOf).
      const pass = current?.passes.get(draw.program)
      const program: unknown = pass ?? draw.program
      const material: unknown =
        pass === undefined ? draw.material : current!.materials.get(draw.material!)
      let byMaterial = groupsBy.get(program)
      if (byMaterial === undefined) groupsBy.set(program, (byMaterial = new Map()))
      let byGeometry = byMaterial.get(material)
      if (byGeometry === undefined) byMaterial.set(material, (byGeometry = new Map()))
      let group = byGeometry.get(geometryKey)
      const palette = pose?.palette
      if (group === undefined) {
        byGeometry.set(
          geometryKey,
          (group = {
            draw: worldPosedDraw(draw, pose === skin ? undefined : pose, placed),
            geometryKey,
            transforms: [],
            palettes: palette === undefined ? undefined : [],
            seen: new Set(),
          }),
        )
        groups.push(group)
      }
      const transform = placed ?? own ?? IDENTITY_VIEW_PROJECTION
      // A primitive drawn twice into the same depth (two solid passes) writes it once.
      if (shadow) {
        if (group.seen.has(transform)) continue
        group.seen.add(transform)
      }
      group.transforms.push(transform)
      if (palette !== undefined) group.palettes?.push(palette)
    }
    if (solid.transparent && !shadow) transparentScenes.push(scene)
  }
  const last = lastWorldInstanceMatrices[shadow ? 1 : 0]!
  const kept = new Map<string, WorldInstancesKept>()
  const instanced = groups.map(({ draw, geometryKey, transforms, palettes }) => {
    const previous = kept.get(geometryKey) ?? last.get(geometryKey)
    let matrices = previous?.matrices
    if (
      previous === undefined ||
      previous.transforms.length !== transforms.length ||
      previous.transforms.some((transform, index) => transform !== transforms[index])
    ) {
      matrices = new Float32Array(transforms.length * 16)
      transforms.forEach((transform, index) => matrices!.set(transform, index * 16))
    }
    // the same poses as before keep their list (the shadow pass keys its casters by it)
    const posed =
      palettes === undefined
        ? undefined
        : previous?.palettes !== undefined &&
            previous.palettes.length === palettes.length &&
            previous.palettes.every((palette, index) => palette === palettes[index])
          ? previous.palettes
          : Object.freeze(palettes)
    if (!kept.has(geometryKey))
      kept.set(geometryKey, { transforms, matrices: matrices!, palettes: posed })
    return Object.freeze({
      draw,
      instances: Object.freeze({
        matrices: matrices!,
        count: transforms.length,
        ...(posed === undefined ? {} : { palettes: posed }),
      }),
    })
  })
  lastWorldInstanceMatrices[shadow ? 1 : 0] = kept
  return Object.freeze({
    groups: Object.freeze(instanced),
    singles: Object.freeze(singles),
    sequence: Object.freeze([...instanced, ...singles.map(draw => Object.freeze({ draw }))]),
    transparentScenes: Object.freeze(transparentScenes),
  })
}

/**
 * The solid draws the camera shows (see worldViewRectangle): a group keeps the placements whose
 * bounds reach into the view and is left out when none does, a single draw is left out when its
 * bounds lie wholly outside. What lies wholly outside covers no pixel, so the picture is the same. A
 * skin posed on the GPU, placements per vertex or a projective placement keep their draw whole: their
 * bounds are not the positions'.
 */
function worldVisibleMaterialSequence(
  plan: WorldWebGlPlan,
  batches: WorldWebGlMaterialBatches,
  view: ReturnType<typeof cameraState>,
  visible: ReturnType<typeof worldViewRectangle>,
): readonly MaterialSequenceDraw[] {
  if (visible === undefined) return batches.sequence
  const cached = visibleMaterialSequences.get(batches)
  if (
    cached !== undefined &&
    cached.visible.u === visible.u &&
    cached.visible.v === visible.v &&
    cached.visible.halfWidth === visible.halfWidth &&
    cached.visible.halfHeight === visible.halfHeight
  )
    return cached.sequence
  const { right, up } = worldViewPlaneBasis(view)
  const extent = Math.hypot(
    plan.bounds.maximum[0] - plan.bounds.minimum[0],
    plan.bounds.maximum[1] - plan.bounds.minimum[1],
    plan.bounds.maximum[2] - plan.bounds.minimum[2],
  )
  // The margin of the transparent packing (packWorldWebGlTransparentDraws).
  const epsilon = Math.max(1e-4, extent * 1e-5)
  const u0 = visible.u - visible.halfWidth - epsilon,
    u1 = visible.u + visible.halfWidth + epsilon,
    v0 = visible.v - visible.halfHeight - epsilon,
    v1 = visible.v + visible.halfHeight + epsilon
  // Local bounds placed by an affine matrix, projected on the view plane: the centre's projection
  // plus, along each axis, the half extents weighted by the matrix column's projection.
  const shows = (
    bounds: ReturnType<typeof boundsOf>,
    matrix: ArrayLike<number>,
    at: number,
  ): boolean => {
    if (
      matrix[at + 3] !== 0 ||
      matrix[at + 7] !== 0 ||
      matrix[at + 11] !== 0 ||
      matrix[at + 15] !== 1
    )
      return true
    let u = 0,
      v = 0,
      reachU = 0,
      reachV = 0
    for (let axis = 0; axis < 3; axis++) {
      const centre = (bounds.min[axis]! + bounds.max[axis]!) / 2,
        half = (bounds.max[axis]! - bounds.min[axis]!) / 2
      const x = matrix[at + axis * 4]!,
        y = matrix[at + axis * 4 + 1]!,
        z = matrix[at + axis * 4 + 2]!
      const alongU = x * right[0] + y * right[1] + z * right[2],
        alongV = x * up[0] + y * up[1] + z * up[2]
      u += alongU * centre
      v += alongV * centre
      reachU += Math.abs(alongU) * half
      reachV += Math.abs(alongV) * half
    }
    const x = matrix[at + 12]!,
      y = matrix[at + 13]!,
      z = matrix[at + 14]!
    u += x * right[0] + y * right[1] + z * right[2]
    v += x * up[0] + y * up[1] + z * up[2]
    // NaN fails every comparison and keeps the draw.
    return !(u + reachU < u0 || u - reachU > u1 || v + reachV < v0 || v - reachV > v1)
  }
  const sequence: MaterialSequenceDraw[] = []
  for (const entry of batches.sequence) {
    const { primitive } = entry.draw
    const bounds = cachedPrimitiveBounds(primitive.positions)
    if (
      materialSkinOf(primitive) !== undefined ||
      primitiveVertexPlacements(primitive) !== undefined ||
      !(bounds.min[0] <= bounds.max[0])
    ) {
      sequence.push(entry)
      continue
    }
    if (entry.instances === undefined) {
      if (shows(bounds, primitive.transform ?? IDENTITY_VIEW_PROJECTION, 0)) sequence.push(entry)
      continue
    }
    const { matrices, count } = entry.instances
    const kept: number[] = []
    for (let index = 0; index < count; index++)
      if (shows(bounds, matrices, index * 16)) kept.push(index)
    if (kept.length === count) sequence.push(entry)
    else if (kept.length > 0)
      sequence.push(Object.freeze({ ...entry, instances: visibleInstances(matrices, kept) }))
  }
  visibleMaterialSequences.set(batches, Object.freeze({ visible, sequence }))
  return sequence
}

const visibleMaterialSequences = new WeakMap<
  WorldWebGlMaterialBatches,
  Readonly<{
    visible: NonNullable<ReturnType<typeof worldViewRectangle>>
    sequence: readonly MaterialSequenceDraw[]
  }>
>()

/**
 * The placements of a group at the given indices. The same indices of the same placements give the
 * same array, so a still camera draws the group from the buffer it uploaded before.
 */
function visibleInstances(matrices: Float32Array, kept: readonly number[]): MaterialInstances {
  const previous = visibleInstanceSubsets.get(matrices)
  if (
    previous !== undefined &&
    previous.kept.length === kept.length &&
    previous.kept.every((index, at) => index === kept[at])
  )
    return previous.instances
  const subset = new Float32Array(kept.length * 16)
  kept.forEach((index, at) => subset.set(matrices.subarray(index * 16, index * 16 + 16), at * 16))
  const instances = Object.freeze({ matrices: subset, count: kept.length })
  visibleInstanceSubsets.set(matrices, Object.freeze({ kept, instances }))
  return instances
}

const visibleInstanceSubsets = new WeakMap<
  Float32Array,
  Readonly<{ kept: readonly number[]; instances: MaterialInstances }>
>()

/**
 * The splat layers of a projected scene's primitives, by primitive id (projectedSplatLayer): its
 * blended draws are part of the ground and draw in the splat pass.
 */
const worldSplatSceneLayers = new WeakMap<
  WorldWebGlModelMaterialScene,
  ReadonlyMap<string, number | undefined>
>()

/**
 * The splat layer of a projector's decal. An M3 splat-terrain-bake material (STBM) is baked into the
 * terrain texture in SC2, under every projected splat whatever layer it names: Washout's sidewalks
 * (STBM on layer 0) lie under its manholes (a material splat on layer 11), which drew hidden.
 */
const TERRAIN_BAKED_SPLAT_LAYER = -1
function worldProjectorSplatLayer(
  primitive: SceneRendererPrimitive,
  material: SceneRendererMaterial | undefined,
): number | undefined {
  const parameters = material?.shader?.parameters as
    | { readonly renderModel?: { readonly metadata?: { readonly sourceMaterialTag?: unknown } } }
    | undefined
  return parameters?.renderModel?.metadata?.sourceMaterialTag === 'STBM'
    ? TERRAIN_BAKED_SPLAT_LAYER
    : projectedSplatLayer(primitive)
}

interface WorldProjectorNormal {
  readonly texture: MutableTexturedBatch['texture']
  /** normalSwizzleOf: 1 X in alpha and Y in green (DXT5nm), 0 plain RGB. */
  readonly swizzle: number
}

/**
 * A projector decal's normal map: the `normal` layer of its render material. SC2 shades a deferred
 * splat through its whole material (splatdeferred.fx runs PSMaterial with normal mapping, the
 * binormal along +v), so the relief of Washout's cracks (Void_CrackSplat: CrackSplat03_Normals)
 * catches the light; drawn flat they were dark lines. The render-material vocabulary's normal maps
 * are DXT5nm unless the texture's storage says otherwise (materialNormalFormats).
 */
function worldProjectorNormal(
  material: SceneRendererMaterial | undefined,
  textures: readonly MutableTexturedBatch['texture'][],
): WorldProjectorNormal | undefined {
  const model = (
    material?.shader?.parameters as { readonly renderModel?: { readonly layers?: unknown } } | undefined
  )?.renderModel
  if (!Array.isArray(model?.layers)) return undefined
  const layer = (model.layers as readonly unknown[]).find(
    (candidate): candidate is { readonly label: string; readonly path: string } =>
      typeof candidate === 'object' &&
      candidate !== null &&
      String((candidate as { label?: unknown }).label).toLowerCase() === 'normal' &&
      typeof (candidate as { path?: unknown }).path === 'string',
  )
  if (layer === undefined) return undefined
  const textureId = material?.textureBindings?.find(
    binding => binding.resourceId === layer.path,
  )?.textureId
  const texture = textures.find(candidate => candidate.id === textureId)
  if (texture === undefined) return undefined
  const format = textureNormalFormat(texture) ?? 'dxt5nm'
  return format === 'dxt5nm'
    ? { texture, swizzle: 1 }
    : format === 'rgb8'
      ? { texture, swizzle: 0 }
      : undefined
}

/**
 * Where a splat layer draws, bottom first (the M3 projector layers as the model carries them): the
 * terrain bakes (TERRAIN_BAKED_SPLAT_LAYER), the terrain-baked layers (10, 11), hardtile with the
 * roads (9), under creep (8), then the layers above creep in their order (generic 1-4, building,
 * area of effect, power, user interface: 0-7). An unknown layer draws last.
 */
const SPLAT_LAYER_ORDER: readonly number[] = [
  TERRAIN_BAKED_SPLAT_LAYER,
  10,
  11,
  9,
  8,
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
]
const splatLayerRank = (layer: number | undefined) => {
  const rank = layer === undefined ? -1 : SPLAT_LAYER_ORDER.indexOf(layer)
  return rank < 0 ? SPLAT_LAYER_ORDER.length : rank
}

/** Every triangle of a batch in its own order, as one transparent range. */
const wholeBatchRanges = new WeakMap<WorldWebGlBatch, WorldWebGlTransparentRange>()
function wholeBatchRange(batch: WorldWebGlBatch): WorldWebGlTransparentRange {
  let range = wholeBatchRanges.get(batch)
  if (range === undefined) {
    const count = batch.positions.length / 3
    const indices = new Uint32Array(count)
    for (let index = 0; index < count; index++) indices[index] = index
    wholeBatchRanges.set(batch, (range = Object.freeze({ indices, first: 0, count, depth: 0 })))
  }
  return range
}

/**
 * The splat pass: projector decals, the ground's top layer, before every other transparent draw
 * and in their layers' order rather than by depth. A layer draws its decal batches (by texture, in
 * the order the plan first met them, each in the order of its placements), then its projected
 * material draws. Decals lie on what they are projected onto, so a transparent draw in the same
 * pixel is either before that surface, where it belongs over the decal, or behind it and hidden by
 * its depth.
 */
function worldSplatEntries(
  plan: WorldWebGlPlan,
  materialDraws: readonly Readonly<{
    scene: WorldWebGlModelMaterialScene
    draw: MaterialDraw & { readonly program: NonNullable<MaterialDraw['program']> }
    layer: number | undefined
  }>[],
): readonly WorldWebGlCompositeTransparentDraw[] {
  const entries: Array<{ value: WorldWebGlCompositeTransparentDraw; rank: number; order: number }> =
    []
  for (const batch of plan.transparentTexturedTriangles)
    if (batch.splatLayer !== undefined && batch.positions.length > 0)
      entries.push({
        value: Object.freeze({
          kind: 'world',
          draw: Object.freeze({
            kind: 'textured',
            blendMode: batch.blendMode,
            receiveShadows: batch.receiveShadows,
            batch,
            range: wholeBatchRange(batch),
          }),
        }),
        rank: splatLayerRank(batch.splatLayer) * 2,
        order: entries.length,
      })
  for (const { scene, draw, layer } of materialDraws)
    entries.push({
      value: Object.freeze({ kind: 'material', scene, draw }),
      rank: splatLayerRank(layer) * 2 + 1,
      order: entries.length,
    })
  entries.sort((left, right) => left.rank - right.rank || left.order - right.order)
  return entries.map(entry => entry.value)
}

/** A blended draw of a scene as the transparent pass takes it (WorldWebGlCompositeTransparentDraw). */
type WorldSceneBlendedDraw = Readonly<{
  scene: WorldWebGlModelMaterialScene
  draw: MaterialDraw & { readonly program: NonNullable<MaterialDraw['program']> }
}>

/**
 * Each scene's blended draws for the view it was last drawn with: the draws in back-to-front order,
 * and its projected decals' with their splat layers (worldSplatSceneLayers). A scene is the same
 * object for as long as its object is kept, and for the same view sorting and preparing its draws
 * (sceneMaterialDraws) gives the same draws: a kept scene seen from the same camera takes them as
 * they were, where they were made again at every frame.
 */
const worldSceneBlendedDrawsByView = new WeakMap<
  WorldWebGlModelMaterialScene,
  Readonly<{
    viewProjection: Float32Array
    blended: readonly WorldSceneBlendedDraw[]
    splat: readonly (WorldSceneBlendedDraw & Readonly<{ layer: number | undefined }>)[]
  }>
>()

function worldSceneBlendedDraws(scene: WorldWebGlModelMaterialScene, viewProjection: Float32Array) {
  const kept = worldSceneBlendedDrawsByView.get(scene)
  if (kept !== undefined && sameFloats(kept.viewProjection, viewProjection)) return kept
  const splatLayers = worldSplatSceneLayers.get(scene)
  const blended: WorldSceneBlendedDraw[] = []
  const splat: (WorldSceneBlendedDraw & Readonly<{ layer: number | undefined }>)[] = []
  // Only a primitive with a blended pass gives a blended draw, and leaving the others out changes
  // none of them nor their order: sceneMaterialDraws orders blended draws after the solid ones, by
  // their own priority, depth and order, and sorts each one's triangles alone. A posed scene (its
  // skins standing for new poses) is made again every plan; most of its primitives are solid.
  const blending = scene.primitives.filter(primitive =>
    scene.programs
      .get(primitive.materialId ?? '')
      ?.passes.some(program => !materialIsSolid(program)),
  )
  for (const draw of sceneMaterialDraws(
    blending,
    scene.materials,
    scene.programs,
    viewProjection,
    [],
    1,
  ))
    if (draw.depthOnly !== true && draw.program !== undefined && !materialIsSolid(draw.program)) {
      const entry = { scene, draw: worldSceneDraw(scene, { ...draw, program: draw.program }) }
      if (splatLayers === undefined) blended.push(Object.freeze(entry))
      else splat.push(Object.freeze({ ...entry, layer: splatLayers.get(draw.primitive.id) }))
    }
  const made = Object.freeze({
    viewProjection: Float32Array.from(viewProjection),
    blended: Object.freeze(blended),
    splat: Object.freeze(splat),
  })
  worldSceneBlendedDrawsByView.set(scene, made)
  return made
}

/** A plan's material draws as the renderer submits them; retained with the plan. */
export function worldMaterialBatchesOf(
  plan: WorldWebGlPlan,
  shadow = false,
): WorldWebGlMaterialBatches {
  const cache = shadow ? worldShadowMaterialBatches : worldMaterialBatches
  let batches = cache.get(plan)
  if (batches === undefined) cache.set(plan, (batches = groupWorldMaterialDraws(plan, shadow)))
  return batches
}

function drawWorldWebGlWithResources(
  canvas: HTMLCanvasElement,
  input: WorldWebGlInput,
  resources: WorldWebGlOwnedResources,
): WorldWebGlStats {
  if (resources.disposed) throw new TypeError('world WebGL renderer is disposed')
  const gl = resources.gl
  harvestGpuTimer(resources)
  const startedAt = globalThis.performance?.now() ?? Date.now()
  const plan = retainedWorldPlan(input, resources, made =>
    worldPlanPosingView(made, input, canvas.width, canvas.height, {
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
    }),
  )
  const program = resources.program
  let shadow: WorldShadowResources | undefined
  let gpuQuery: WebGLQuery | undefined
  let gpuQueryStarted = false
  let completed = false
  try {
    if (resources.gpuTimer !== undefined && resources.pendingGpuQuery === undefined) {
      gpuQuery = gl.createQuery() ?? undefined
      if (gpuQuery !== undefined) {
        gl.beginQuery(resources.gpuTimer.TIME_ELAPSED_EXT, gpuQuery)
        gpuQueryStarted = true
      }
    }
    prepareWorldMaterialResources(resources, plan)
    shadow = renderWorldShadowMap(gl, plan, input, resources)
    if (plan.light.toneMapping !== undefined) {
      resources.toneMapper ??= createWorldToneMapper(gl)
      resources.toneMapper?.begin(canvas.width, canvas.height)
    }
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0.035, 0.055, 0.075, 1)
    gl.clearDepth(1)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.useProgram(program)
    // Active sampler types must never share a texture unit, including draws whose shader branches
    // do not sample them. Reserve a stable layout before the first opaque batch is submitted.
    worldUniform1i(gl, program, 'terrainMaps', 0)
    worldUniform1i(gl, program, 'terrainNormalMaps', 1)
    worldUniform1i(gl, program, 'terrainWeightMaps[0]', 2)
    worldUniform1i(gl, program, 'terrainWeightMaps[1]', 3)
    worldUniform1i(gl, program, 'baseColorMap', 4)
    worldUniform1i(gl, program, 'normalMap', 5)
    worldUniform1i(gl, program, 'secondaryColorMap', 6)
    worldUniform1i(gl, program, 'shadowMap', 7)
    // The water pass samples the scene depth here; every other draw keeps a compatible 2D texture.
    bindSentinelTexture2d(resources, WATER_SCENE_DEPTH_UNIT)
    worldUniform1i(gl, program, 'sceneDepthMap', WATER_SCENE_DEPTH_UNIT)
    bindSentinelTexture2d(resources, WATER_CAUSTICS_UNIT)
    worldUniform1i(gl, program, 'causticsMap', WATER_CAUSTICS_UNIT)
    worldUniform1f(gl, program, 'causticsMode', 0)
    bindSentinelTexture2d(resources, WATER_NORMAL_UNIT)
    worldUniform1i(gl, program, 'waterNormalMap', WATER_NORMAL_UNIT)
    bindSentinelTexture2d(resources, TERRAIN_DECAL_SPECULAR_UNIT)
    worldUniform1i(gl, program, 'terrainDecalSpecularMap', TERRAIN_DECAL_SPECULAR_UNIT)
    for (const [name, unit] of [
      ['waterDetailNormal1', WATER_DETAIL_NORMAL_UNIT],
      ['waterDetailFoam0', WATER_DETAIL_FOAM_UNIT],
      ['waterDetailFoam1', WATER_DETAIL_SECOND_FOAM_UNIT],
    ] as const) {
      bindSentinelTexture2d(resources, unit)
      worldUniform1i(gl, program, name, unit)
    }
    worldUniform1f(gl, program, 'waterDetailMode', 0)
    // The clock of animated water: waves on planes and detail waves on the surface triangles.
    worldUniform1f(gl, program, 'waterTime', input.timeSeconds ?? 0)
    worldUniform1f(gl, program, 'terrainDecal', 0)
    worldUniform1f(gl, program, 'terrainDecalCoverageOnly', 0)
    worldUniform1f(gl, program, 'terrainSpecularGloss', 0)
    worldUniform1f(gl, program, 'normalSwizzle', 0)
    worldUniform1f(gl, program, 'waterWavesMode', 0)
    worldUniform1f(gl, program, 'waterDepthMode', 0)
    worldUniform1f(gl, program, 'cliffMaskMode', 0)
    worldUniform1f(gl, program, 'terrainWeightOverlay', 0)
    worldUniform1f(gl, program, 'unlitSurface', 0)
    const sceneCamera = createWorldWebGlCameraFrame(plan, canvas.width, canvas.height, input.camera)
    gl.uniform3fv(uniformLocation(gl, program, 'eyePosition'), sceneCamera.eyePosition)
    const terrainLight = plan.light.terrain
    gl.uniform3f(
      uniformLocation(gl, program, 'terrainLighting'),
      terrainLight?.specularExponent ?? 16,
      terrainLight?.diffuseMultiplier ?? 1,
      terrainLight?.specularMultiplier ?? 0,
    )
    worldUniform1f(gl, program, 'keyUsesVertexAo', plan.light.useAmbientOcclusion === false ? 0 : 1)
    gl.uniform3fv(
      uniformLocation(gl, program, 'lightSpecularRadiance'),
      (plan.light.specularColor ?? plan.light.color).map(
        value => value * (plan.light.specularIntensity ?? plan.light.intensity),
      ),
    )
    worldUniform1i(gl, program, 'terrainSpecularMaps', 8)
    const viewProjection = sceneCamera.viewProjection
    gl.uniformMatrix4fv(uniformLocation(gl, program, 'viewProjection'), false, viewProjection)
    gl.uniform3fv(
      uniformLocation(gl, program, 'ambientColor'),
      Float32Array.from(plan.light.ambient),
    )
    worldUniform1f(gl, program, 'ambientIntensity', plan.light.ambientIntensity)
    gl.uniform3fv(
      uniformLocation(gl, program, 'lightDirection'),
      Float32Array.from(plan.light.direction),
    )
    gl.uniform3fv(uniformLocation(gl, program, 'lightColor'), Float32Array.from(plan.light.color))
    worldUniform1f(gl, program, 'lightIntensity', plan.light.intensity)
    const fills = plan.light.fills.slice(0, MAXIMUM_FILL_LIGHTS)
    for (let index = 0; index < MAXIMUM_FILL_LIGHTS; index += 1) {
      const fill = fills[index]
      worldUniform1f(
        gl,
        program,
        `fillUsesVertexAo${String(index)}`,
        fill?.useAmbientOcclusion === false ? 0 : 1,
      )
      gl.uniform3fv(
        uniformLocation(gl, program, `fillLightDirection${String(index)}`),
        Float32Array.from(fill?.direction ?? [0, 0, 0]),
      )
      gl.uniform3fv(
        uniformLocation(gl, program, `fillLightRadiance${String(index)}`),
        Float32Array.from(
          fill === undefined ? [0, 0, 0] : fill.color.map(channel => channel * fill.intensity),
        ),
      )
    }
    if (shadow === undefined) {
      worldUniform1f(gl, program, 'shadowEnabled', 0)
    } else {
      gl.uniformMatrix4fv(
        uniformLocation(gl, program, 'shadowViewProjection'),
        false,
        shadow.viewProjection,
      )
      gl.uniform2f(
        uniformLocation(gl, program, 'shadowTexelSize'),
        1 / shadow.size,
        1 / shadow.size,
      )
      gl.activeTexture(gl.TEXTURE7)
      gl.bindTexture(gl.TEXTURE_2D, shadow.texture)
      worldUniform1f(gl, program, 'shadowEnabled', 1)
    }
    const shadowRange = worldShadowRangeEye(plan, canvas.width, canvas.height, input.camera)
    gl.uniform3fv(
      uniformLocation(gl, program, 'shadowRangeEye'),
      Float32Array.from(shadowRange?.eye ?? [0, 0, 0]),
    )
    worldUniform1f(gl, program, 'shadowRangeDistance', shadowRange?.distance ?? 0)
    worldUniform1f(gl, program, 'pointSize', 7)
    worldUniform1f(gl, program, 'alphaCutoff', 0)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)
    gl.depthMask(true)
    worldUniform1f(gl, program, 'textured', 0)
    worldUniform1f(gl, program, 'normalTextured', 0)
    worldUniform1f(gl, program, 'secondaryTextured', 0)
    worldUniform1f(gl, program, 'splatTextured', 0)
    worldUniform1f(gl, program, 'alphaCutoff', 0)
    worldUniform1f(gl, program, 'shadowReceiver', 1)
    drawBatch(resources, program, plan.opaqueTriangles, gl.TRIANGLES)
    for (const item of plan.shadowControlledOpaqueTriangles) {
      worldUniform1f(gl, program, 'shadowReceiver', item.receiveShadows ? 1 : 0)
      drawBatch(resources, program, item, gl.TRIANGLES)
    }
    for (const item of plan.texturedTriangles) {
      worldUniform1f(gl, program, 'shadowReceiver', item.receiveShadows === false ? 0 : 1)
      drawTexturedBatch(resources, program, item)
    }
    worldUniform1f(gl, program, 'shadowReceiver', 1)
    // The ground writes its depth a little farther than it lies, as Warzone 2100 writes its terrain
    // (terrain.cpp: polygon offset 0.1, 1): what lies flat on it, such as a structure's base plate,
    // wins the tie instead of fighting it. Its later raster groups and decal tiles share the offset,
    // so they still meet it at LEQUAL.
    gl.enable(gl.POLYGON_OFFSET_FILL)
    gl.polygonOffset(TERRAIN_DEPTH_OFFSET.factor, TERRAIN_DEPTH_OFFSET.units)
    for (const item of plan.splatTriangles) drawSplatBatch(resources, program, item)
    if (plan.splatOverlayTriangles.length > 0 || plan.terrainDecalTriangles.length > 0) {
      // Later raster groups and decal tiles blend over the ground where it lies, before water as
      // the game draws them: the same triangles at the same depth, so LEQUAL keeps them.
      gl.enable(gl.BLEND)
      gl.blendEquation(gl.FUNC_ADD)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.depthMask(false)
      worldUniform1f(gl, program, 'terrainWeightOverlay', 1)
      for (const item of plan.splatOverlayTriangles) drawSplatBatch(resources, program, item)
      worldUniform1f(gl, program, 'terrainWeightOverlay', 0)
      worldUniform1f(gl, program, 'splatTextured', 0)
      worldUniform1f(gl, program, 'rasterSplatTextured', 0)
      worldUniform1f(gl, program, 'terrainDecal', 1)
      for (const item of plan.terrainDecalTriangles) {
        worldUniform1f(gl, program, 'terrainDecalCoverageOnly', item.overlayAlpha === 'coverage' ? 1 : 0)
        if (item.specularTexture === undefined) {
          worldUniform1f(gl, program, 'terrainDecalSpecularTextured', 0)
        } else {
          bindTexture2d(resources, item.specularTexture, TERRAIN_DECAL_SPECULAR_UNIT)
          worldUniform1f(gl, program, 'terrainDecalSpecularTextured', 1)
        }
        worldUniform1f(gl, program, 'terrainSpecularGloss', item.specularGloss === true ? 1 : 0)
        drawTexturedBatch(resources, program, item)
      }
      worldUniform1f(gl, program, 'terrainDecal', 0)
      worldUniform1f(gl, program, 'terrainDecalCoverageOnly', 0)
      bindSentinelTexture2d(resources, TERRAIN_DECAL_SPECULAR_UNIT)
      gl.disable(gl.BLEND)
      gl.depthMask(true)
    }
    gl.disable(gl.POLYGON_OFFSET_FILL)
    if (plan.multipliedWaterTriangles.length > 0) {
      // Water that multiplies the ground (Warzone 2100 REND_MULTIPLICATIVE): after the terrain and
      // before the models, as the game draws it; unlit, no depth write.
      gl.enable(gl.BLEND)
      gl.blendEquation(gl.FUNC_ADD)
      gl.blendFunc(gl.DST_COLOR, gl.ZERO)
      gl.depthMask(false)
      worldUniform1f(gl, program, 'splatTextured', 0)
      worldUniform1f(gl, program, 'rasterSplatTextured', 0)
      worldUniform1f(gl, program, 'shadowReceiver', 0)
      worldUniform1f(gl, program, 'unlitSurface', 1)
      for (const item of plan.multipliedWaterTriangles) drawTexturedBatch(resources, program, item)
      worldUniform1f(gl, program, 'unlitSurface', 0)
      worldUniform1f(gl, program, 'shadowReceiver', 1)
      gl.disable(gl.BLEND)
      gl.depthMask(true)
    }
    // Material programs take the key light's shadow from the batches' map, texel and reach.
    const sceneLight: MaterialSceneLight =
      shadow === undefined
        ? worldMaterialLight(plan)
        : {
            ...worldMaterialLight(plan),
            shadow: Object.freeze({
              texture: shadow.texture,
              viewProjection: shadow.viewProjection,
              texelSize: Object.freeze([1 / shadow.size, 1 / shadow.size] as const),
              rangeEye: shadowRange?.eye ?? Object.freeze([0, 0, 0] as const),
              rangeDistance: shadowRange?.distance ?? 0,
            }),
          }
    const batches = worldMaterialBatchesOf(plan)
    // Blended passes keep the per-frame back-to-front order of their scene.
    const transparentSceneDraws: Array<{
      scene: WorldWebGlModelMaterialScene
      draw: MaterialDraw & { readonly program: NonNullable<MaterialDraw['program']> }
    }> = []
    // Projected decals with material programs draw in the splat pass (worldSplatEntries).
    const splatMaterialDraws: Array<{
      scene: WorldWebGlModelMaterialScene
      draw: MaterialDraw & { readonly program: NonNullable<MaterialDraw['program']> }
      layer: number | undefined
    }> = []
    for (const scene of batches.transparentScenes) {
      const { blended, splat } = worldSceneBlendedDraws(
        worldWebGlPosedScene(plan, scene),
        sceneCamera.viewProjection,
      )
      for (const entry of blended) transparentSceneDraws.push(entry)
      for (const entry of splat) splatMaterialDraws.push(entry)
    }
    const effectDraws = worldModelEffectDraws(plan, sceneCamera)
    // Issue every program this frame needs before the first draw, so they compile in parallel.
    resources.materialDraws.warm([
      ...batches.groups.map(group => group.draw),
      ...batches.singles,
      ...transparentSceneDraws.map(entry => entry.draw),
      ...splatMaterialDraws.map(entry => entry.draw),
      ...effectDraws.map(entry => entry.draw),
    ])
    // What the camera shows of the solid draws; the shadow map and the transparent pass take theirs.
    const solidSequence = worldVisibleMaterialSequence(
      plan,
      batches,
      cameraState(input.camera),
      worldViewRectangle(plan, cameraState(input.camera), canvas.width / canvas.height),
    )
    if (solidSequence.length > 0) {
      resources.materialDraws.drawSequence(
        solidSequence,
        sceneCamera,
        sceneLight,
        worldCurrentPrograms.get(plan)?.passes,
      )
      gl.useProgram(program)
      gl.disable(gl.POLYGON_OFFSET_FILL)
    }
    assertNoWebGlError(resources, 'opaque pass')
    worldUniform1f(gl, program, 'textured', 0)
    worldUniform1f(gl, program, 'normalTextured', 0)
    worldUniform1f(gl, program, 'secondaryTextured', 0)
    worldUniform1f(gl, program, 'splatTextured', 0)
    worldUniform1f(gl, program, 'shadowReceiver', 0)
    drawBatch(resources, program, plan.lines, gl.LINES)
    drawBatch(resources, program, plan.points, gl.POINTS)
    assertNoWebGlError(resources, 'overlay pass')
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.depthMask(false)
    // Water over the HDR target is drawn as zone planes against a copy of the opaque depth: its
    // shoreline follows the drawn ground and cliff meshes, not steps of the height grid (see
    // WorldWebGlWaterPlane). Without that target the terrain-clipped water stays.
    const waterByDepth =
      resources.toneMapper !== undefined &&
      plan.light.toneMapping !== undefined &&
      plan.waterPlanes.length > 0
    if (waterByDepth) {
      const sceneDepth = resources.toneMapper!.sceneDepth()
      gl.useProgram(program)
      gl.activeTexture(gl.TEXTURE0 + WATER_SCENE_DEPTH_UNIT)
      gl.bindTexture(gl.TEXTURE_2D, sceneDepth)
      if (shadow !== undefined) {
        gl.activeTexture(gl.TEXTURE7)
        gl.bindTexture(gl.TEXTURE_2D, shadow.texture)
      }
      const { camera } = cameraFor(plan, canvas.width, canvas.height, input.camera)
      const forward = camera.getWorldDirection(new Vector3())
      gl.uniform2f(
        uniformLocation(gl, program, 'waterDepthScale'),
        camera.far - camera.near,
        Math.abs(forward.y),
      )
      gl.uniform3f(
        uniformLocation(gl, program, 'waterDepthLens'),
        camera.near,
        camera.far,
        camera instanceof PerspectiveCamera ? 1 : 0,
      )
      worldUniform1f(gl, program, 'waterShoreFade', WATER_SHORE_FADE)
      worldUniform1f(gl, program, 'waterDepthMode', 1)
      worldUniform1f(gl, program, 'textured', 0)
      worldUniform1f(gl, program, 'normalTextured', 0)
      worldUniform1f(gl, program, 'secondaryTextured', 0)
      worldUniform1f(gl, program, 'splatTextured', 0)
      worldUniform1f(gl, program, 'alphaCutoff', 0)
      gl.disable(gl.POLYGON_OFFSET_FILL)
      gl.uniform3f(uniformLocation(gl, program, 'waterViewForward'), forward.x, forward.y, forward.z)
      for (const plane of plan.waterPlanes) {
        worldUniform1f(gl, program, 'waterFalloff', plane.colorFalloff)
        worldUniform1f(gl, program, 'shadowReceiver', plane.receiveShadows ? 1 : 0)
        const caustics = plane.caustics
        if (caustics === undefined) worldUniform1f(gl, program, 'causticsMode', 0)
        else {
          // The flip-book frame of the moment, as the game plays it at CausticsFPS.
          const frame =
            caustics.framesPerSecond > 0
              ? Math.floor((input.timeSeconds ?? 0) * caustics.framesPerSecond) % caustics.frames.length
              : 0
          bindTexture2d(resources, caustics.frames[frame]!, WATER_CAUSTICS_UNIT)
          worldUniform1f(gl, program, 'causticsMode', 1)
          gl.uniform2f(uniformLocation(gl, program, 'causticsScale'), caustics.scale[0], caustics.scale[1])
          worldUniform1f(gl, program, 'causticsFalloff', caustics.falloff)
        }
        const waves = plane.waves
        if (waves === undefined) worldUniform1f(gl, program, 'waterWavesMode', 0)
        else {
          bindTexture2d(resources, waves.texture, WATER_NORMAL_UNIT)
          worldUniform1f(gl, program, 'waterWavesMode', 1)
          gl.uniform2f(uniformLocation(gl, program, 'waterWaveTiling'), waves.tiling[0], waves.tiling[1])
          gl.uniform4f(uniformLocation(gl, program, 'waterWaveScroll'), ...waves.scroll)
          gl.uniform2f(uniformLocation(gl, program, 'waterSpecular'), waves.specularity, waves.specularScale)
          worldUniform1f(gl, program, 'waterTime', input.timeSeconds ?? 0)
        }
        drawBatch(resources, program, plane.batch, gl.TRIANGLES)
      }
      worldUniform1f(gl, program, 'causticsMode', 0)
      worldUniform1f(gl, program, 'waterWavesMode', 0)
      worldUniform1f(gl, program, 'waterDepthMode', 0)
      assertNoWebGlError(resources, 'water pass')
    }
    const transparentMaterialDraws = [...transparentSceneDraws, ...effectDraws]
    const transparentEntries = [
      ...worldSplatEntries(plan, splatMaterialDraws),
      ...createWorldWebGlCompositeTransparentDrawPlan(
        plan,
        input.camera,
        transparentMaterialDraws,
        waterByDepth,
        canvas.width / canvas.height,
      ),
    ]
    // What the last batch entry left set: undefined at first and after a material run, else
    // whether its blending adds. A batch draw changes only its textures (units 4-6), vertex array
    // and uniforms, so the next batch entry keeps the program, blending, depth writes and the
    // shadow map's unit; a material run leaves its own.
    let batchAdditive: boolean | undefined
    for (let index = 0; index < transparentEntries.length; index++) {
      const entry = transparentEntries[index]!
      if (entry.kind === 'material') {
        // Consecutive material draws run as one sequence of the material renderer.
        const run: MaterialSequenceDraw[] = []
        for (let next = index; next < transparentEntries.length; next++) {
          const candidate = transparentEntries[next]!
          if (candidate.kind !== 'material') break
          for (const draw of worldBlendedMaterialPasses(candidate.draw))
            run.push(
              candidate.instances === undefined
                ? { draw }
                : { draw, instances: candidate.instances },
            )
          index = next
        }
        resources.materialDraws.drawSequence(
          run,
          sceneCamera,
          sceneLight,
          worldCurrentPrograms.get(plan)?.passes,
        )
        batchAdditive = undefined
        continue
      }
      const item = entry.draw
      const additive = item.blendMode === 'additive'
      if (batchAdditive === undefined) {
        gl.useProgram(program)
        gl.disable(gl.POLYGON_OFFSET_FILL)
        if (shadow !== undefined) {
          gl.activeTexture(gl.TEXTURE7)
          gl.bindTexture(gl.TEXTURE_2D, shadow.texture)
        }
        gl.enable(gl.BLEND)
        gl.depthMask(false)
      }
      if (batchAdditive !== additive)
        gl.blendFunc(gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA)
      batchAdditive = additive
      worldUniform1f(gl, program, 'shadowReceiver', item.receiveShadows ? 1 : 0)
      if (item.kind === 'textured') {
        drawTexturedBatch(resources, program, item.batch, item.range)
      } else {
        worldUniform1f(gl, program, 'textured', 0)
        worldUniform1f(gl, program, 'normalTextured', 0)
        worldUniform1f(gl, program, 'secondaryTextured', 0)
        worldUniform1f(gl, program, 'splatTextured', 0)
        worldUniform1f(gl, program, 'alphaCutoff', 0)
        drawBatch(resources, program, item.batch, gl.TRIANGLES, item.batch, item.range)
      }
    }
    gl.depthMask(true)
    assertNoWebGlError(resources, 'transparent pass')
    const waterSurfaces = waterByDepth
      ? plan.waterPlanes.map(plane => plane.batch.positions)
      : [plan.waterSurfaceDepth]
    if (
      resources.toneMapper !== undefined &&
      (plan.light.toneMapping?.ambientOcclusion?.radius ?? 0) > 0 &&
      waterSurfaces.some(positions => positions.length > 0)
    ) {
      // Color blending stays depth-read-only. Afterwards AO needs the visible water plane,
      // not the submerged height field: otherwise its tile creases darken the whole water color.
      gl.disable(gl.BLEND)
      gl.disable(gl.POLYGON_OFFSET_FILL)
      gl.colorMask(false, false, false, false)
      const depthProgram = resources.shadowProgram
      gl.useProgram(depthProgram)
      gl.uniformMatrix4fv(
        uniformLocation(gl, depthProgram, 'lightViewProjection'),
        false,
        sceneCamera.viewProjection,
      )
      bindSentinelTexture2d(resources, 0)
      worldUniform1i(gl, depthProgram, 'baseColorMap', 0)
      try {
        // Depth-tested: a plane writes only where the water lies over the drawn scene.
        for (const positions of waterSurfaces) drawShadowPositions(resources, depthProgram, positions)
      } finally {
        gl.colorMask(true, true, true, true)
      }
      assertNoWebGlError(resources, 'water surface depth pass')
    }
    if (plan.light.toneMapping !== undefined) {
      const fog = plan.light.fog
      resources.toneMapper?.finish(
        plan.light.toneMapping,
        sceneCamera.viewProjection,
        fog === undefined
          ? undefined
          : { fog, eye: worldFogEye(plan, canvas.width, canvas.height, input.camera) },
      )
    }
    assertNoWebGlError(resources, 'postprocess pass')
    resources.frames += 1
    completed = true
    return Object.freeze({
      ...plan.stats,
      shadowMapSize: shadow?.size ?? 0,
    })
  } finally {
    if (gpuQueryStarted) {
      gl.endQuery(resources.gpuTimer!.TIME_ELAPSED_EXT)
      if (completed) resources.pendingGpuQuery = gpuQuery
      else if (gpuQuery !== undefined) gl.deleteQuery(gpuQuery)
    }
    if (completed)
      retainPerformanceSample(
        resources.cpuFrameMilliseconds,
        (globalThis.performance?.now() ?? Date.now()) - startedAt,
      )
    if (completed) {
      sweepGeometry(resources)
      sweepTextures(resources)
      resources.materialDraws.sweep()
    } else {
      resources.usedGeometry.clear()
      resources.usedIndexBuffers.clear()
      resources.usedTextures.clear()
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }
}

/**
 * Creates the production retained renderer used by an interactive viewer. Shader programs and the
 * shadow target survive camera/animation redraws; `dispose()` releases every retained GPU object.
 */
export function createWorldWebGlRenderer(
  canvas: HTMLCanvasElement,
): WorldWebGlRenderer | undefined {
  const context = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    depth: true,
    preserveDrawingBuffer: false,
  })
  if (!isWebGl2(context)) return undefined
  const resources = createOwnedResources(context)
  return Object.freeze({
    draw: (input: WorldWebGlInput) => drawWorldWebGlWithResources(canvas, input, resources),
    pick: (input: WorldWebGlInput, screen: WorldWebGlPickScreen) => {
      if (resources.disposed) throw new TypeError('world WebGL renderer is disposed')
      const plan = retainedWorldPlan(input, resources, made =>
        worldPlanPosingView(made, input, screen.width, screen.height, {
          width: resources.gl.drawingBufferWidth,
          height: resources.gl.drawingBufferHeight,
        }),
      )
      return pickWorldWebGlPlan(plan, input, screen)
    },
    stats: (): WorldWebGlRendererStats =>
      (() => {
        harvestGpuTimer(resources)
        const [cpuP50, cpuP95] = percentiles(resources.cpuFrameMilliseconds, 0.5, 0.95)
        const [gpuP50, gpuP95] = percentiles(resources.gpuFrameMilliseconds, 0.5, 0.95)
        const [planP50, planP95] = percentiles(resources.worldPlanBuildMilliseconds, 0.5, 0.95)
        const [dynamicP50, dynamicP95] = percentiles(
          resources.worldPlanDynamicUpdateMilliseconds,
          0.5,
          0.95,
        )
        const [seekP50, seekP95] = percentiles(resources.animationSeekMilliseconds, 0.5, 0.95)
        const geometry = geometryResourceTotals(resources)
        const textures = textureResourceTotals(resources)
        const material = resources.disposed
          ? { bufferEntries: 0, bufferBytesRetained: 0, vertexArrayEntries: 0 }
          : resources.materialDraws.stats()
        const counters = worldMaterialCounters(resources)
        const worldPlanBytesRetained = retainedWorldPlanBytes(resources.lastPlan)
        const shadowTargetBytesRetained =
          (resources.shadowTarget === undefined ? 0 : resources.shadowTarget.size ** 2 * 4) +
          (resources.shadowKept === undefined ? 0 : resources.shadowKept.size ** 2 * 4)
        const sentinelBytesRetained = resources.sentinelTexture === undefined ? 0 : 4
        return Object.freeze({
          frames: resources.frames,
          programCompilations:
            resources.programCompilations +
            resources.retiredMaterialProgramCompilations +
            (resources.disposed ? 0 : resources.materialDraws.programCompilations()),
          materialDrawCalls:
            resources.retiredMaterialDrawCalls +
            (resources.disposed ? 0 : resources.materialDraws.drawCalls()),
          shadowTargetAllocations: resources.shadowTargetAllocations,
          shadowTargetReuses: resources.shadowTargetReuses,
          worldPlanBuilds: resources.worldPlanBuilds,
          worldPlanReuses: resources.worldPlanReuses,
          worldObjectsKept: resources.worldObjectsKept,
          worldObjectsBuilt: resources.worldObjectsBuilt,
          worldPosedSamples: resources.worldPosedSamples,
          worldObjectsUnposed: resources.worldObjectsUnposed,
          worldPlanViewRebuilds: resources.worldPlanViewRebuilds,
          worldPlanDynamicUpdates: resources.worldPlanDynamicUpdates,
          worldPlanDynamicUpdateSamples: resources.worldPlanDynamicUpdateMilliseconds.length,
          ...(dynamicP50 === undefined
            ? {}
            : { worldPlanDynamicUpdateP50Milliseconds: dynamicP50 }),
          ...(dynamicP95 === undefined
            ? {}
            : { worldPlanDynamicUpdateP95Milliseconds: dynamicP95 }),
          worldPlanBuildSamples: resources.worldPlanBuildMilliseconds.length,
          ...(planP50 === undefined ? {} : { worldPlanBuildP50Milliseconds: planP50 }),
          ...(planP95 === undefined ? {} : { worldPlanBuildP95Milliseconds: planP95 }),
          animationSeekSamples: resources.animationSeekMilliseconds.length,
          ...(seekP50 === undefined ? {} : { animationSeekP50Milliseconds: seekP50 }),
          ...(seekP95 === undefined ? {} : { animationSeekP95Milliseconds: seekP95 }),
          geometryUploads: resources.geometryUploads,
          geometryCacheHits: resources.geometryCacheHits,
          geometryDisposals: resources.geometryDisposals,
          geometryEntries: geometry.entries,
          geometryBytesRetained: geometry.bytes,
          materialBufferEntries: material.bufferEntries,
          materialBufferBytesRetained: material.bufferBytesRetained,
          materialVertexArrayEntries: material.vertexArrayEntries,
          materialVertexArraysCreated: counters.vertexArraysCreated,
          materialBuffersCreated: counters.buffersCreated,
          materialPlacementsDrawn: counters.placementsDrawn,
          textureUploads: resources.textureUploads,
          textureCacheHits: resources.textureCacheHits,
          textureDisposals: resources.textureDisposals,
          textureEntries: textures.entries,
          textureBytesRetained: textures.bytes,
          worldPlanBytesRetained,
          shadowTargetBytesRetained,
          // textures.bytes already includes the retained 1x1 sentinel texture.
          knownGpuBytesRetained:
            geometry.bytes +
            material.bufferBytesRetained +
            textures.bytes +
            shadowTargetBytesRetained +
            (resources.toneMapper?.bytes() ?? 0),
          gpuProgramBytesObservable: false as const,
          cpuFrameSamples: resources.cpuFrameMilliseconds.length,
          ...(cpuP50 === undefined ? {} : { cpuFrameP50Milliseconds: cpuP50 }),
          ...(cpuP95 === undefined ? {} : { cpuFrameP95Milliseconds: cpuP95 }),
          gpuTimerSupported: resources.gpuTimer !== undefined,
          gpuFrameSamples: resources.gpuFrameMilliseconds.length,
          ...(gpuP50 === undefined ? {} : { gpuFrameP50Milliseconds: gpuP50 }),
          ...(gpuP95 === undefined ? {} : { gpuFrameP95Milliseconds: gpuP95 }),
          disposed: resources.disposed,
        })
      })(),
    dispose: () => disposeOwnedResources(resources),
  })
}

/** Draws one real depth-tested WebGL2 frame; returns undefined only when WebGL2 is unavailable. */
export function drawWorldWebGl(
  canvas: HTMLCanvasElement,
  input: WorldWebGlInput,
): WorldWebGlStats | undefined {
  const renderer = createWorldWebGlRenderer(canvas)
  if (renderer === undefined) return undefined
  try {
    return renderer.draw(input)
  } finally {
    renderer.dispose()
  }
}

/**
 * Quad [a, b, c, d] split along a–c or b–d, both wound so the face normal points up.
 *
 * The scene mirrors the map's Y into -Z, which flips the handedness: the map-order winding made
 * every terrain face normal point down, so the key light's N·L was zero and terrain was lit by
 * ambient alone. Culling is off, so nothing looked missing — it just looked flat.
 */
const SPLIT_AC = [
  [0, 1, 2],
  [0, 2, 3],
] as const
const SPLIT_BD = [
  [1, 2, 3],
  [1, 3, 0],
] as const

/**
 * The diagonal a cell is cut along when an upper layer's corner coverage singles out one corner: the
 * one between that corner's neighbours, so the blend runs straight across the corner's triangle.
 */
function cornerAlphaSplit(
  sample: MapTerrainMaterialSample | undefined,
): typeof SPLIT_AC | typeof SPLIT_BD | undefined {
  for (const layer of sample?.layers?.slice(1) ?? []) {
    const alpha = layer.cornerAlpha
    if (alpha === undefined) continue
    const odd = alpha.findIndex((value, corner) => {
      const others = alpha.filter((_, index) => index !== corner)
      return others.every(other => other === others[0] && other !== value)
    })
    if (odd >= 0) return odd % 2 === 0 ? SPLIT_BD : SPLIT_AC
  }
  return undefined
}

/** Directionals past the key light that the world shader sums (SC2 rigs ship Key, Fill, Back). */
const MAXIMUM_FILL_LIGHTS = 2

/** Bytes sampled per texture for its content key (a checksum, not a full hash). */
const WORLD_TEXTURE_KEY_SAMPLES = 256

const WATER_SURFACE_NORMAL = [0, 1, 0] as const
/** Texture unit of the scene depth copy the water pass reads (units 0-8 hold the terrain and shadow). */
const WATER_SCENE_DEPTH_UNIT = 9
/** The water's caustics flip-book frame; every other draw keeps a 2D sentinel here. */
const WATER_CAUSTICS_UNIT = 10
/** The water's wave normal image; a 2D sentinel for every other draw. */
const WATER_NORMAL_UNIT = 11
/** A terrain decal tile's specular map; a 2D sentinel for every other draw. */
const TERRAIN_DECAL_SPECULAR_UNIT = 12
/** How much farther the ground writes its depth than it lies (glPolygonOffset factor, units). */
const TERRAIN_DEPTH_OFFSET = Object.freeze({ factor: 0.1, units: 1 })
/** Detail-wave water: its second normal image and its two foam masks; 2D sentinels otherwise. */
const WATER_DETAIL_NORMAL_UNIT = 13
const WATER_DETAIL_FOAM_UNIT = 14
const WATER_DETAIL_SECOND_FOAM_UNIT = 15
/** Water colour and opacity at depth zero when a material states none. */
const WATER_DEFAULT_COLOR = [0.12, 0.52, 0.82, 0.48] as const

/** Depth (world units) over which a shoreline reaches the water's own opacity. */
const WATER_SHORE_FADE = 0.04
/** `ColorFallOff` of the stock CWater templates: saturation rate per unit of water depth. */
const WATER_COLOR_FALLOFF = 0.1

/** World units per water clipping bucket, and how far a terrain cell reaches past its corner. */
const WATER_BUCKET_SIZE = 8
const WATER_CELL_MARGIN = 2
