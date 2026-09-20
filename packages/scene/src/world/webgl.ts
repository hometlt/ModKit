import { OrthographicCamera, Raycaster, Sphere, Vector2, Vector3 } from 'three'
import type {
  MapModelComponentPlacement,
  MapTerrainMaterialDefinition,
  MapTerrainWeightRaster,
  MapWaterMaterialDefinition,
  WorldSceneItem,
  WorldSceneModelResult,
  WorldSceneObjectItem,
  WorldSceneTerrainItem,
  WorldToneMapping,
  WorldTerrainLighting,
} from '@modkit/sdk/maps'
import type {
  ModelMaterialRef,
  SceneRendererMaterial,
  SceneRendererPrimitive,
  SceneRendererTexture,
} from '@modkit/sdk'
import type { SceneRendererMaterialContext } from '@modkit/sdk/renderer'
import { createModelSceneSampler } from '../model/index.js'
import { createUvmEffectSource, type UvmEffectSource } from '../uvm/effect-source.js'
import { materialWebGlDraws } from '../render/material-webgl.js'
import { materialIsSolid, sceneMaterialDraws, type MaterialDraw } from '../render/material-draws.js'
import { prepareSceneMaterialPrograms, type SceneMaterialPrograms } from '../render/materials.js'
import { applyTextureFilter } from '../render/texture-filtering.js'
import { uniformLocation } from '../materials/webgl.js'
import { invertMaterialFrame } from '../materials/frame.js'
import { createWorldToneMapper } from './tone-mapping.js'

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
  /** Global initial-world clock used by actor animations and scrolling water surfaces. */
  readonly timeSeconds?: number
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
  readonly waterPolygons: number
  readonly cliffEdges: number
  readonly cliffTriangles: number
  readonly objectInstances: number
  readonly modelTriangles: number
  readonly navigationSamples: number
  readonly gatewaySegments: number
  readonly regionShapes: number
  readonly diagnosticPlaceholders: number
  readonly shadowCasterTriangles: number
  readonly shadowMapSize: number
}

/** Observable retained-resource counters used by the UI and performance receipts. */
export interface WorldWebGlRendererStats {
  readonly frames: number
  readonly programCompilations: number
  readonly shadowTargetAllocations: number
  readonly shadowTargetReuses: number
  readonly worldPlanBuilds: number
  readonly worldPlanReuses: number
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
  stats(): WorldWebGlRendererStats
  dispose(): void
}

interface MutableBatch {
  readonly positions: number[]
  readonly normals: number[]
  readonly colors: number[]
}

interface MutableTexturedBatch extends MutableBatch {
  readonly textureCoordinates: number[]
  readonly secondaryTextureCoordinates?: number[]
  readonly texture: NonNullable<
    Extract<WorldSceneModelResult, { state: 'converted' }>['textures']
  >[number]
  readonly normalTexture?: NonNullable<
    Extract<WorldSceneModelResult, { state: 'converted' }>['textures']
  >[number]
  readonly secondaryTexture?: NonNullable<
    Extract<WorldSceneModelResult, { state: 'converted' }>['textures']
  >[number]
  readonly alphaCutoff?: number
  readonly castShadows?: boolean
  readonly receiveShadows?: boolean
}

interface MutableSplatBatch extends MutableBatch {
  readonly specularTextures?: readonly (SceneRendererTexture | undefined)[]
  readonly textureCoordinates: readonly number[][]
  readonly textureWeights0: number[]
  readonly textureWeights1: number[]
  readonly textures: readonly SceneRendererTexture[]
  /** Layer-aligned tangent-space normals; an absent entry is the flat [0,0,1] normal. */
  readonly normalTextures: readonly (SceneRendererTexture | undefined)[]
  /** Layer-aligned: 1 where the normal map keeps X in alpha and Y in green (DXN-swizzled). */
  readonly normalSwizzles: readonly number[]
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
  readonly textureCoordinates: Float32Array
  readonly secondaryTextureCoordinates?: Float32Array
  readonly texture: MutableTexturedBatch['texture']
  readonly normalTexture?: MutableTexturedBatch['normalTexture']
  readonly secondaryTexture?: MutableTexturedBatch['secondaryTexture']
  /** Zero/absent is solid coverage; a positive value discards lower-alpha texels in all passes. */
  readonly alphaCutoff?: number
  readonly castShadows?: boolean
  readonly receiveShadows?: boolean
}

export interface WorldWebGlTransparentTexturedBatch extends WorldWebGlTexturedBatch {
  readonly blendMode: 'blend' | 'additive'
  readonly receiveShadows: boolean
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
  readonly specularTextures?: readonly (SceneRendererTexture | undefined)[]
  readonly textureCoordinates: readonly Float32Array[]
  readonly textureWeights0: Float32Array
  readonly textureWeights1: Float32Array
  readonly textures: readonly SceneRendererTexture[]
  readonly normalTextures: readonly (SceneRendererTexture | undefined)[]
  readonly normalSwizzles: readonly number[]
  readonly weightTextures?: readonly SceneRendererTexture[]
  readonly weightTextureCoordinates?: Float32Array
}

export interface WorldWebGlPlan {
  /** Visible water surface depth for screen-space effects, isolated from model transparency. */
  readonly waterSurfaceDepth: Float32Array
  readonly opaqueTriangles: WorldWebGlBatch
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
  readonly transparentTriangles: WorldWebGlBatch
  readonly lines: WorldWebGlBatch
  readonly points: WorldWebGlBatch
  readonly picking: Readonly<{
    terrainTriangles: Float32Array
    objects: readonly Readonly<{
      objectId: number
      center: readonly [number, number, number]
      triangles: Float32Array
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

export interface WorldWebGlModelEffectInstance {
  readonly source: UvmEffectSource
  /** Model-to-world transform of the placed component. */
  readonly transform: Float32Array
  readonly time: number
  readonly materials: readonly SceneRendererMaterial[]
  readonly textures: readonly SceneRendererTexture[]
  readonly context: SceneRendererMaterialContext
}

const effectSources = new WeakMap<Uint8Array, Map<number | undefined, UvmEffectSource | null>>()
const effectFrames = new WeakMap<
  UvmEffectSource,
  Map<
    string,
    {
      readonly frame: ReturnType<UvmEffectSource['frame']>
      readonly programs: ReadonlyMap<string, SceneMaterialPrograms>
    }
  >
>()
const effectDrawPlans = new WeakMap<WorldWebGlPlan, {
  cameraKey: string
  draws: ReturnType<typeof worldModelEffectDraws>
}>()

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
 */
function worldModelEffectDraws(
  plan: WorldWebGlPlan,
  camera: WorldWebGlCameraFrame,
): readonly Readonly<{
  scene: WorldWebGlModelMaterialScene
  draw: MaterialDraw & { readonly program: NonNullable<MaterialDraw['program']> }
}>[] {
  const cameraKey = `${camera.viewMatrix.join(',')}|${camera.viewProjection.join(',')}`
  const previous = effectDrawPlans.get(plan)
  if (previous?.cameraKey === cameraKey) return previous.draws
  const draws: Array<{
    scene: WorldWebGlModelMaterialScene
    draw: MaterialDraw & { readonly program: NonNullable<MaterialDraw['program']> }
  }> = []
  for (const effect of plan.modelEffects) {
    // Simulate one full clip before the current phase so plumes are already developed at load.
    // ponytail: cost grows with clip length per instance per frame; cache emitter state per clock.
    const period = effect.source.clipSeconds
    const time =
      period === undefined || period <= 0 ? effect.time : period + (effect.time % period)
    try {
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
      let frames = effectFrames.get(effect.source)
      if (frames === undefined || frames.size > 64) effectFrames.set(effect.source, (frames = new Map()))
      let cached = frames.get(key)
      if (cached === undefined) {
        const frame = effect.source.frame(time, effect.materials, localView)
        // Stable program objects keep the GPU leases across frames that reuse this entry.
        const programs = prepareSceneMaterialPrograms(
          frame.materials,
          new Map(effect.textures.map(texture => [texture.id, texture])),
          { ...effect.context, time, sequenceTime: time },
          [],
        )
        frames.set(key, (cached = { frame, programs }))
      }
      const { frame, programs } = cached
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
      for (const draw of sceneMaterialDraws(primitives, frame.materials, programs, camera.viewProjection, [], 1))
        // ponytail: simple single-texture effects (no render-material program) are not drawn here.
        if (draw.program !== undefined && draw.depthOnly !== true)
          draws.push({ scene, draw: { ...draw, program: draw.program } })
    } catch {
      // An unsupported effect must not stop the map from rendering.
    }
  }
  effectDrawPlans.set(plan, { cameraKey, draws })
  return draws
}

export interface WorldWebGlModelMaterialScene {
  readonly primitives: readonly SceneRendererPrimitive[]
  readonly shadowPrimitives: readonly SceneRendererPrimitive[]
  readonly materials: readonly SceneRendererMaterial[]
  readonly programs: ReadonlyMap<string, SceneMaterialPrograms>
  readonly textures: readonly SceneRendererTexture[]
}

const batch = (): MutableBatch => ({ positions: [], normals: [], colors: [] })

/** Actor animation properties select a named sequence, not the first clip with keyframes. */
export function worldModelAnimation(result: Extract<WorldSceneModelResult, { state: 'converted' }>, item: WorldSceneObjectItem) {
  const requested = [item.presentationAnimation?.name ?? 'Stand', ...(item.presentationAnimation?.groups ?? [])].join(' ').toLowerCase()
  return result.animations?.find(clip => clip.name?.toLowerCase() === requested)
    ?? result.animations?.find(clip => clip.name?.toLowerCase().startsWith(`${requested} `))
    ?? (item.presentationAnimation === undefined ? result.animations?.find(clip => clip.kind === 'animation' && clip.channels.length > 0) : undefined)
}

function worldObjectTime(
  input: WorldWebGlInput,
  item: WorldSceneObjectItem,
  hasSelectedAnimation: boolean,
): number {
  return (
    input.animationTimes?.get(item.objectId) ??
    (item.presentationAnimation !== undefined || hasSelectedAnimation ? input.timeSeconds ?? 0 : 0)
  ) * (item.presentationAnimation?.speed ?? 1)
}

function colorHash(value: string | number): readonly [number, number, number, number] {
  const text = String(value)
  let hash = 2_166_136_261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  const hue = ((hash >>> 0) % 360) / 60
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
  return [item.position.x, item.position.z, item.position.y]
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

function pushTriangle(
  target: MutableBatch,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  color: readonly [number, number, number, number],
  normals?: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ],
) {
  const normal = faceNormal(a, b, c)
  pushVertex(target, a, normals?.[0] ?? normal, color)
  pushVertex(target, b, normals?.[1] ?? normal, color)
  pushVertex(target, c, normals?.[2] ?? normal, color)
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
  color: readonly [number, number, number, number],
  normals?: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ],
) {
  const normal = faceNormal(vertices[0], vertices[1], vertices[2])
  for (let index = 0; index < 3; index += 1) {
    pushVertex(target, vertices[index]!, normals?.[index] ?? normal, color)
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

function waterVertexColor(
  material: MapWaterMaterialDefinition | undefined,
  elevation: number,
  groundHeight: number,
): readonly [number, number, number, number] {
  const color = material?.color ?? [0.12, 0.52, 0.82, 0.48]
  const depth = Math.max(0, elevation - groundHeight)
  // `CWater.State.ColorFallOff` is the depth over which the water reaches its own colour, not a
  // rate: read as a rate, Amphion's sea (0.1-0.7 deep) stayed glassy and its 0.3-deep ponds
  // vanished, where the editor draws the sea opaque past the shallow band and the ponds solid.
  const saturation = 1 - Math.exp(-depth / (material?.colorFalloff ?? WATER_COLOR_FALLOFF))
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

function pushWaterTriangle(
  target: MutableBatch,
  ground: readonly [WaterGroundVertex, WaterGroundVertex, WaterGroundVertex],
  elevation: number,
  material: MapWaterMaterialDefinition | undefined,
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
      waterVertexColor(material, elevation, ground[index]![1]),
    )
}

function pushTexturedWaterTriangle(
  target: MutableTexturedBatch,
  ground: readonly [WaterGroundVertex, WaterGroundVertex, WaterGroundVertex],
  elevation: number,
  material: MapWaterMaterialDefinition,
  time: number,
) {
  const vertices = ground.map(vertex => [vertex[0], elevation, vertex[2]] as const)
  // A water surface is horizontal by construction, and clipping leaves its winding arbitrary, so the
  // normal is stated rather than derived — a derived one pointed down and left water ambient-only.
  const normal = WATER_SURFACE_NORMAL
  const scale = material.uvScale ?? [0.125, 0.125]
  const scroll = material.scroll ?? [0, 0]
  for (let index = 0; index < 3; index += 1) {
    const source = ground[index]!
    pushVertex(target, vertices[index]!, normal, waterVertexColor(material, elevation, source[1]))
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
    pushVertex(target, vertices[vertex]!, normals?.[vertex] ?? normal, [1, 1, 1, occlusion?.[vertex] ?? 1])
    for (let texture = 0; texture < target.textures.length; texture += 1)
      target.textureCoordinates[texture]!.push(...textureCoordinates[texture]![vertex]!)
    target.textureWeights0.push(weights[0] ?? 0, weights[1] ?? 0, weights[2] ?? 0, weights[3] ?? 0)
    target.textureWeights1.push(weights[4] ?? 0, weights[5] ?? 0, weights[6] ?? 0, weights[7] ?? 0)
  }
}

/** Neutral stand-in for a splat layer whose base-color texture did not resolve. */
const MISSING_TERRAIN_LAYER_TEXTURE: SceneRendererTexture = Object.freeze({
  id: 'modkit.world/missing-terrain-layer',
  width: 1,
  height: 1,
  rgba: Uint8Array.of(128, 128, 128, 255),
})

function transformedTerrainUv(
  uv: readonly [number, number],
  transform:
    | Readonly<{
        readonly offset: readonly [number, number]
        readonly scale: readonly [number, number]
        readonly rotation: number
      }>
    | undefined,
): readonly [number, number] {
  if (transform === undefined) return uv
  const x = uv[0] * transform.scale[0]
  const y = uv[1] * transform.scale[1]
  const cosine = Math.cos(transform.rotation)
  const sine = Math.sin(transform.rotation)
  return [transform.offset[0] + x * cosine - y * sine, transform.offset[1] + x * sine + y * cosine]
}

/**
 * Terrain UV at a cell corner. A sample transform is cell-local (tile rotation/flip); a material
 * transform acts in continuous terrain cell units (world tiling), so repeats cross cell borders
 * without seams. Integer cell offsets are invisible to repeat-wrapped tiles.
 */
function terrainSurfaceUv(
  cell: Readonly<{ x: number; y: number }>,
  local: readonly [number, number],
  sampleTransform: Parameters<typeof transformedTerrainUv>[1],
  materialTransform: Parameters<typeof transformedTerrainUv>[1],
): readonly [number, number] {
  const inCell = transformedTerrainUv(local, sampleTransform)
  return transformedTerrainUv([cell.x + inCell[0], cell.y + inCell[1]], materialTransform)
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
    const yaw = item.rotation ?? 0
    const cosine = Math.cos(yaw)
    const sine = Math.sin(yaw)
    rotated = [
      cosine * scaled[0] - sine * scaled[2],
      scaled[1],
      sine * scaled[0] + cosine * scaled[2],
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
    ...(source.normalTexture === undefined ? {} : { normalTexture: source.normalTexture }),
    ...(source.secondaryTexture === undefined ? {} : { secondaryTexture: source.secondaryTexture }),
    ...(source.alphaCutoff === undefined ? {} : { alphaCutoff: source.alphaCutoff }),
    ...(source.castShadows === undefined ? {} : { castShadows: source.castShadows }),
    ...(source.receiveShadows === undefined ? {} : { receiveShadows: source.receiveShadows }),
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
    ...(source.specularTextures === undefined ? {} : { specularTextures: Object.freeze([...source.specularTextures]) }),
    normalSwizzles: Object.freeze([...source.normalSwizzles]),
    ...(source.weightTextures === undefined
      ? {}
      : { weightTextures: Object.freeze([...source.weightTextures]) }),
    ...(source.weightTextureCoordinates === undefined
      ? {}
      : { weightTextureCoordinates: Float32Array.from(source.weightTextureCoordinates) }),
  })
}

const BASE_COLOR_SLOTS = new Set(['diffuse', 'basecolor', 'albedo', 'color', 'colour', 'mapkd'])
const NORMAL_SLOTS = new Set(['normal', 'normalmap', 'mapnormal', 'mapbump', 'bump'])
const materialSlot = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/gu, '')

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
      out = {
        ...out,
        alphaMode: 'mask' as const,
        alphaCutoff: 0.5,
        shader: {
          ...out.shader,
          parameters: {
            ...out.shader.parameters,
            renderModel: {
              standard: { ...standard, blendMode: 0, alphaTestThreshold: 0.5 },
            },
          },
        },
      }
    }
    return out
  })
}

function worldModelSceneMaterials(
  refs: readonly ModelMaterialRef[],
  textures: readonly SceneRendererTexture[],
): Readonly<{
  materials: readonly SceneRendererMaterial[]
  textures: readonly SceneRendererTexture[]
}> {
  const byId = new Map(textures.map(texture => [texture.id, texture]))
  const used = new Map<string, SceneRendererTexture>()
  const materials = refs.map((ref): SceneRendererMaterial => {
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
          rotation: [0, Math.sin((item.rotation ?? 0) / 2), 0, Math.cos((item.rotation ?? 0) / 2)],
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
  const mode =
    material?.alphaMode === 'mask' ||
    (material?.alphaMode === undefined &&
      (cutoff ?? 0) > 0 &&
      nativeBlend !== 'blend' &&
      nativeBlend !== 'additive')
      ? 'mask'
      : material?.alphaMode === 'blend' || nativeBlend === 'blend' || nativeBlend === 'additive'
        ? 'blend'
        : 'opaque'
  return Object.freeze({ mode, cutoff: mode === 'mask' ? (cutoff ?? 0.5) : 0 })
}

function modelMaterialShadowPolicy(material: ModelMaterialRef | undefined): Readonly<{
  castShadows: boolean
  receiveShadows: boolean
}> {
  const flags = new Set(material?.flagNames ?? [])
  return Object.freeze({
    castShadows: material?.castShadows ?? !flags.has('no-shadows-cast'),
    receiveShadows: material?.receiveShadows ?? !flags.has('no-shadows-receive'),
  })
}

function finitePlan(plan: readonly MutableBatch[]) {
  for (const item of plan) {
    for (const values of [item.positions, item.normals, item.colors]) {
      for (const value of values) if (!Number.isFinite(value)) return false
    }
  }
  return true
}

/** Builds a renderer-ready, game-neutral 3D scene without requiring a browser or GPU. */
export function createWorldWebGlPlan(input: WorldWebGlInput): WorldWebGlPlan {
  const opaque = batch()
  const modelMaterialScenes: WorldWebGlModelMaterialScene[] = []
  const modelEffects: WorldWebGlModelEffectInstance[] = []
  let modelMaterialShadowTriangles = 0
  const shadowControlledOpaque = new Map<
    string,
    MutableBatch & { readonly castShadows: boolean; readonly receiveShadows: boolean }
  >()
  const transparent = batch()
  const lines = batch()
  const points = batch()
  const textured = new Map<string, MutableTexturedBatch>()
  const transparentTextured = new Map<
    string,
    MutableTexturedBatch & {
      readonly blendMode: 'blend' | 'additive'
      readonly receiveShadows: boolean
    }
  >()
  const splat = new Map<string, MutableSplatBatch>()
  const terrainPickTriangles: number[] = []
  const objectPickMeshes: {
    objectId: number
    center: readonly [number, number, number]
    triangles: number[]
    placeholder: boolean
  }[] = []
  const terrain = input.items.filter(
    (item): item is WorldSceneTerrainItem => item.facet === 'terrain',
  )
  const terrainByCell = new Map(terrain.map(item => [`${item.x}:${item.y}`, item]))
  const materialByCell = new Map(
    input.items
      .filter(item => item.facet === 'terrain-materials')
      .map(item => [`${item.x}:${item.y}`, item]),
  )
  let terrainTriangles = 0
  let terrainTexturedTriangles = 0
  let terrainSplatFallbackCells = 0
  const terrainMinimumX = Math.min(...terrain.map(item => item.x))
  const terrainMaximumX = Math.max(...terrain.map(item => item.x))
  const terrainMinimumY = Math.min(...terrain.map(item => item.y))
  const terrainMaximumY = Math.max(...terrain.map(item => item.y))
  const rasterDefinitions = (input.terrainWeightRasters ?? []).flatMap(raster =>
    raster.materialIds.map(materialId =>
      input.terrainMaterials?.find(material => material.materialId === materialId),
    ),
  )
  const rasterMaterialTextures = rasterDefinitions.map(definition =>
    definition?.baseColorResourceId === undefined
      ? undefined
      : input.terrainTextures?.get(definition.baseColorResourceId),
  )
  const rasterNormalTextures = rasterDefinitions.map(definition =>
    definition?.normalResourceId === undefined
      ? undefined
      : input.terrainTextures?.get(definition.normalResourceId),
  )
  const rasterWeightTextures = (input.terrainWeightRasters ?? []).map(raster =>
    input.terrainTextures?.get(raster.resourceId),
  )
  const exactRasterSplat =
    (input.terrainWeightRasters?.length ?? 0) > 0 &&
    input.terrainWeightRasters!.length <= 2 &&
    rasterDefinitions.length <= 8 &&
    rasterDefinitions.every(definition => definition !== undefined) &&
    rasterWeightTextures.every(
      (texture, index) =>
        texture !== undefined &&
        texture.width === input.terrainWeightRasters![index]!.width &&
        texture.height === input.terrainWeightRasters![index]!.height,
    ) &&
    terrainMaximumX > terrainMinimumX &&
    terrainMaximumY > terrainMinimumY
      ? Object.freeze({
          definitions: rasterDefinitions as readonly MapTerrainMaterialDefinition[],
          // One unresolved layer must not drop per-pixel blending for the whole map.
          textures: rasterMaterialTextures.map(texture => texture ?? MISSING_TERRAIN_LAYER_TEXTURE),
          normalTextures: rasterNormalTextures,
          specularTextures: rasterDefinitions.map(definition => definition?.specularResourceId === undefined ? undefined : input.terrainTextures?.get(definition.specularResourceId)),
          normalSwizzles: (rasterDefinitions as readonly MapTerrainMaterialDefinition[]).map(
            definition => (definition.normalEncoding === 'xy-in-alpha-green' ? 1 : 0),
          ),
          weightTextures: rasterWeightTextures as readonly SceneRendererTexture[],
        })
      : undefined
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
    const clock = worldObjectTime(input, item, selected !== undefined)
    const time = selected?.durationSeconds && (item.presentationAnimation?.loop ?? selected.looping)
      ? clock % selected.durationSeconds : clock
    const sharedKey = `${resourceId}\u0000${selected?.id ?? ''}\u0000${time}`
    const shared = planSamples.get(sharedKey)
    if (shared !== undefined) return shared
    const clip = selected?.kind === 'animation' ? selected : undefined
    const sample =
      (result.nodes?.length ?? 0) === 0
        ? { primitives: result.primitives, nodeTransforms: new Map<string, Float32Array>() }
        : createModelSceneSampler(
            {
              nodes: result.nodes ?? [],
              meshes: result.meshes,
              primitives: result.primitives,
              ...(result.skeleton === undefined ? {} : { skeleton: result.skeleton }),
            },
            {
              ...(clip === undefined ? {} : { clip }),
              maxBytes: 64 * 1024 * 1024,
            },
          ).sample(time)
    const current = {
      result,
      primitives: sample.primitives,
      nodeTransforms: sample.nodeTransforms,
    }
    planSamples.set(sharedKey, current)
    return current
  }
  /** The one batch that draws the exact raster splat: the height field and the cliff tiles share it. */
  const rasterSplatKey =
    exactRasterSplat === undefined
      ? undefined
      : [
          'terrain-raster-splat',
          exactRasterSplat.textures.map(candidate => candidate.id).join(String.fromCharCode(0)),
          exactRasterSplat.normalTextures
            .map(candidate => candidate?.id ?? '')
            .join(String.fromCharCode(0)),
          exactRasterSplat.weightTextures.map(candidate => candidate.id).join(String.fromCharCode(0)),
        ].join(String.fromCharCode(0))
  const rasterSplatBatch = (key = rasterSplatKey!): MutableSplatBatch => {
    const existing = splat.get(key)
    if (existing !== undefined) return existing
    const target: MutableSplatBatch = {
      ...batch(),
      textureCoordinates: exactRasterSplat!.textures.map(() => []),
      textureWeights0: [],
      textureWeights1: [],
      textures: exactRasterSplat!.textures,
      normalTextures: exactRasterSplat!.normalTextures,
      specularTextures: exactRasterSplat!.specularTextures,
      normalSwizzles: exactRasterSplat!.normalSwizzles,
      weightTextures: exactRasterSplat!.weightTextures,
      weightTextureCoordinates: [],
    }
    splat.set(key, target)
    return target
  }
  const rasterUv = (x: number, y: number): readonly [number, number] => [
    (x - terrainMinimumX) / (terrainMaximumX - terrainMinimumX),
    (y - terrainMinimumY) / (terrainMaximumY - terrainMinimumY),
  ]
  const terrainAoAt = (x: number, y: number): number => {
    const gx = Math.floor(x), gy = Math.floor(y), fx = x - gx, fy = y - gy
    const at = (dx: number, dy: number) => terrainByCell.get(`${gx + dx}:${gy + dy}`)?.ambientOcclusion ?? 1
    return at(0, 0) * (1 - fx) * (1 - fy) + at(1, 0) * fx * (1 - fy) + at(1, 1) * fx * fy + at(0, 1) * (1 - fx) * fy
  }
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
   * The standard base is the most common `heightBase` (untouched ground; on Amphion 19 400 of
   * 31 329 vertices sit exactly there), and world units per base step come from two vertices of one
   * cliff level with different bases.
   * ponytail: the mode stands in for `standardHeight`, which this plan does not receive; pass it
   * with the terrain transform if a map repaints most of its ground.
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
    (vertex.heightBase - baseHeight.reference) * baseHeight.step
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
  const liftedCliffPrimitives = <P extends { readonly positions: Float32Array }>(
    primitives: readonly P[],
    instanceTransform: Float32Array,
  ): readonly P[] => {
    if (baseHeight.step === 0) return primitives
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
    if (!Number.isFinite(minX)) return primitives
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
    if (footprint.every(entry => entry.offset === 0)) return primitives
    const LEVEL_TOLERANCE = 0.05
    const nearest = (
      candidates: readonly (typeof footprint)[number][],
      x: number,
      z: number,
    ) => {
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
        if (entry.standard <= y + LEVEL_TOLERANCE && (below === undefined || entry.standard > below))
          below = entry.standard
        if (entry.standard >= y - LEVEL_TOLERANCE && (above === undefined || entry.standard < above))
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
    return prepared.map(({ primitive, m }) => {
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
        const x = source[index]!
        const y = source[index + 1]!
        const z = source[index + 2]!
        const offset = offsetAt(
          m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
          m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
          m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
        )
        if (offset !== 0) moved = true
        positions[index] = x + upX * offset
        positions[index + 1] = y + upY * offset
        positions[index + 2] = z + upZ * offset
      }
      return moved ? { ...primitive, positions } : primitive
    })
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
  if (exactRasterSplat !== undefined)
    for (const item of input.items) {
      if (item.facet !== 'objects' || item.derivedFrom !== 'cliffs' || item.resourceId === undefined)
        continue
      const sampled = sampleSharedModel(item.resourceId, item)
      if (sampled === undefined) continue
      const translation = objectPosition(item, input)
      const ramp = /:ramp-[0-9]+$/u.test(item.id)
      const raw: CliffPlate[] = []
      const cover: CliffPlate[] = []
      for (const primitive of liftedCliffPrimitives(
        sampled.primitives,
        worldObjectTransform(item, translation),
      ))
        for (const triangle of primitiveTriangles(primitive)) {
          const vertices = triangle.map(index =>
            instanceVertex(transformedPrimitiveVertex(primitive, index), item, translation),
          ) as unknown as CliffTriangle
          let normal = faceNormal(vertices[0], vertices[1], vertices[2])
          const upward: CliffTriangle =
            normal[1] >= 0 ? vertices : [vertices[0], vertices[2], vertices[1]]
          if (normal[1] < 0) normal = [-normal[0], -normal[1], -normal[2]]
          if (normal[1] < 0.05) continue
          cover.push({ vertices: upward, normal })
          if (normal[1] >= 0.5) raw.push({ vertices: upward, normal })
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
      cliffFills.push({ ramp, minX, maxX, minZ, maxZ, plates, cover })
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
      pushSplatTriangle(target, plate.vertices, coordinates, [], [
        plate.normal,
        plate.normal,
        plate.normal,
      ], grid.map(([x, y]) => terrainAoAt(x, y)))
      target.weightTextureCoordinates!.push(
        ...grid.map(point => rasterUv(point[0], point[1])).flat(),
      )
      terrainTexturedTriangles += 1
      terrainTriangles += 1
    }
  }
  /** A height-field vertex, snapped onto a cliff piece's surface where one covers it. */
  const snappedTerrainPosition = (item: WorldSceneTerrainItem): readonly [number, number, number] => {
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
  for (const item of terrain) {
    const east = terrainByCell.get(`${item.x + 1}:${item.y}`)
    const south = terrainByCell.get(`${item.x}:${item.y + 1}`)
    const southEast = terrainByCell.get(`${item.x + 1}:${item.y + 1}`)
    if (east === undefined || south === undefined || southEast === undefined) continue
    const corners = [item, east, southEast, south].map(
      snappedTerrainPosition,
    ) as unknown as TerrainPatch['positions']
    if (cutCells.has(`${item.x}:${item.y}`)) continue
    const cornerKeys = [
      `${item.x}:${item.y}`,
      `${item.x + 1}:${item.y}`,
      `${item.x + 1}:${item.y + 1}`,
      `${item.x}:${item.y + 1}`,
    ]
    // Cut along the diagonal with the smaller height difference, so 45° cliff and ramp edges in
    // either direction stay straight instead of zig-zagging across fixed-diagonal cells.
    const split =
      Math.abs(corners[0][1] - corners[2][1]) <= Math.abs(corners[1][1] - corners[3][1])
        ? SPLIT_AC
        : SPLIT_BD
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
    const tri = <T,>(values: readonly [T, T, T, T], index: 0 | 1) =>
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
    const cornerAo = patch.locals.map(([x, y]) => terrainAoAt(item.x + x, item.y + y)) as [number, number, number, number]
    if (exactRasterSplat !== undefined) {
      const key = `terrain-raster-splat\u0000${exactRasterSplat.textures
        .map(candidate => candidate.id)
        .join('\u0000')}\u0000${exactRasterSplat.normalTextures
        .map(candidate => candidate?.id ?? '')
        .join('\u0000')}\u0000${exactRasterSplat.weightTextures
        .map(candidate => candidate.id)
        .join('\u0000')}`
      const target = rasterSplatBatch(key)
      const coordinates = exactRasterSplat.definitions.map(definition => {
        const [uvA, uvB, uvC, uvD] = patch.locals.map(local =>
          terrainSurfaceUv(item, local, undefined, definition.uvTransform),
        ) as [
          readonly [number, number],
          readonly [number, number],
          readonly [number, number],
          readonly [number, number],
        ]
        return { first: tri([uvA, uvB, uvC, uvD], 0), second: tri([uvA, uvB, uvC, uvD], 1) }
      })
      const [uvA, uvB, uvC, uvD] = patch.locals.map(local =>
        rasterUv(item.x + local[0], item.y + local[1]),
      ) as [
        readonly [number, number],
        readonly [number, number],
        readonly [number, number],
        readonly [number, number],
      ]
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
      terrainPickTriangles.push(...tri(quad, 0).flat(), ...tri(quad, 1).flat())
      terrainTexturedTriangles += 2
      terrainTriangles += 2
      continue
    }
    const materialSample = materialByCell.get(`${item.x}:${item.y}`)
    const declaredWeights =
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
    const color =
      texture === undefined
        ? colorHash(dominantMaterialId ?? materialSample?.textureIndex ?? 0)
        : ([1, 1, 1, 1] as const)
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
      const key = `terrain-splat\u0000${textures
        .map(candidate => candidate.id)
        .join(
          '\u0000',
        )}\u0000${normalTextures.map(candidate => candidate?.id ?? '').join('\u0000')}`
      const target = splat.get(key) ?? {
        ...batch(),
        textureCoordinates: textures.map(() => []),
        textureWeights0: [],
        textureWeights1: [],
        textures,
        normalTextures,
        specularTextures: resolvedSplat.map(layer => layer.definition.specularResourceId === undefined ? undefined : input.terrainTextures?.get(layer.definition.specularResourceId)),
        normalSwizzles: resolvedSplat.map(layer =>
          layer.definition.normalEncoding === 'xy-in-alpha-green' ? 1 : 0,
        ),
      }
      splat.set(key, target)
      const coordinates = resolvedSplat.map(layer => {
        const transform = (uv: readonly [number, number]) =>
          terrainSurfaceUv(item, uv, materialSample?.uvTransform, layer.definition.uvTransform)
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
      pushTriangle(opaque, ...tri(quad, 0), color, tri(cornerNormals, 0))
      pushTriangle(opaque, ...tri(quad, 1), color, tri(cornerNormals, 1))
    } else {
      const key = `terrain\u0000${texture.id}\u0000${normalTexture?.id ?? ''}`
      const target = textured.get(key) ?? {
        ...batch(),
        textureCoordinates: [],
        texture,
        ...(normalTexture === undefined ? {} : { normalTexture }),
      }
      textured.set(key, target)
      const uv = (local: readonly [number, number]) =>
        terrainSurfaceUv(item, local, materialSample?.uvTransform, material?.uvTransform)
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
      pushTexturedTriangle(
        target,
        tri(quad, 1),
        tri([uvA, uvB, uvC, uvD], 1),
        color,
        tri(cornerNormals, 1),
      )
      terrainTexturedTriangles += 2
    }
    terrainPickTriangles.push(...tri(quad, 0).flat(), ...tri(quad, 1).flat())
    terrainTriangles += 2
    }
  }
  if (terrainTriangles === 0) {
    for (const item of terrain) pushVertex(points, terrainPosition(item), [0, 1, 0], colorHash(0))
  }

  const timeSeconds = input.timeSeconds ?? 0
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0)
    throw new TypeError('world WebGL timeSeconds must be finite and nonnegative')
  let waterPolygons = 0
  // Terrain cells bucketed by their UVW corner, so each water zone clips only the cells under it
  // instead of scanning the whole map per zone.
  let waterGroundBuckets: Map<string, WorldSceneTerrainItem[]> | undefined
  const waterGroundCells = (
    minimum: Readonly<{ x: number; z: number }>,
    maximum: Readonly<{ x: number; z: number }>,
  ): WorldSceneTerrainItem[] => {
    if (waterGroundBuckets === undefined) {
      waterGroundBuckets = new Map()
      for (const ground of terrain) {
        const [x, , z] = terrainPosition(ground)
        const key = `${Math.floor(x / WATER_BUCKET_SIZE)}:${Math.floor(z / WATER_BUCKET_SIZE)}`
        const bucket = waterGroundBuckets.get(key)
        if (bucket === undefined) waterGroundBuckets.set(key, [ground])
        else bucket.push(ground)
      }
    }
    const cells: WorldSceneTerrainItem[] = []
    // A cell reaches one sample past its corner in either direction, so widen by that margin.
    const bucket = (value: number) => Math.floor(value / WATER_BUCKET_SIZE)
    for (let bx = bucket(minimum.x - WATER_CELL_MARGIN); bx <= bucket(maximum.x + WATER_CELL_MARGIN); bx += 1)
      for (let bz = bucket(minimum.z - WATER_CELL_MARGIN); bz <= bucket(maximum.z + WATER_CELL_MARGIN); bz += 1)
        for (const ground of waterGroundBuckets.get(`${bx}:${bz}`) ?? []) cells.push(ground)
    return cells
  }
  for (const item of input.items.filter(item => item.facet === 'water')) {
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
    const texturedTarget =
      material === undefined || texture === undefined
        ? undefined
        : (() => {
            const key = `water\u0000${material.materialId}\u0000${texture.id}\u0000${secondaryTexture?.id ?? ''}`
            const previous = transparentTextured.get(key)
            if (previous !== undefined) return previous
            const current = {
              ...batch(),
              textureCoordinates: [],
              ...(secondaryTexture === undefined ? {} : { secondaryTextureCoordinates: [] }),
              texture,
              ...(secondaryTexture === undefined ? {} : { secondaryTexture }),
              blendMode: 'blend' as const,
              receiveShadows: material.receiveShadows ?? false,
            }
            transparentTextured.set(key, current)
            return current
          })()
    let emitted = false
    if (material?.shorelineMode === 'terrain-clipped' && terrain.length > 0) {
      for (const ground of waterGroundCells(minimum, maximum)) {
        const east = terrainByCell.get(`${ground.x + 1}:${ground.y}`)
        const south = terrainByCell.get(`${ground.x}:${ground.y + 1}`)
        const southEast = terrainByCell.get(`${ground.x + 1}:${ground.y + 1}`)
        if (east === undefined || south === undefined || southEast === undefined) continue
        const a = terrainPosition(ground)
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
          for (let index = 1; index + 1 < polygon.length; index += 1) {
            const clipped = [polygon[0]!, polygon[index]!, polygon[index + 1]!] as const
            if (texturedTarget === undefined)
              pushWaterTriangle(transparent, clipped, elevation, material)
            else
              pushTexturedWaterTriangle(texturedTarget, clipped, elevation, material!, timeSeconds)
            emitted = true
          }
        }
      }
    } else {
      const a = [minimum.x, elevation - 1, minimum.z] as const
      const b = [maximum.x, elevation - 1, minimum.z] as const
      const c = [maximum.x, elevation - 1, maximum.z] as const
      const d = [minimum.x, elevation - 1, maximum.z] as const
      for (const triangle of [
        [a, c, b],
        [a, d, c],
      ] as const) {
        if (texturedTarget === undefined)
          pushWaterTriangle(transparent, triangle, elevation, material)
        else pushTexturedWaterTriangle(texturedTarget, triangle, elevation, material!, timeSeconds)
      }
      emitted = true
    }
    if (!emitted && material?.shorelineMode === 'terrain-clipped') continue
    waterPolygons += 1
  }

  // Capture before models append their transparent geometry: particles must not become AO surfaces.
  const waterDepthPositions: number[] = []
  for (const source of [transparent, ...transparentTextured.values()]) {
    for (let offset = 0; offset < source.positions.length; offset += 9) {
      const color = offset / 3 * 4
      if (Math.max(source.colors[color + 3]!, source.colors[color + 7]!, source.colors[color + 11]!) <= 0.01) continue
      waterDepthPositions.push(...source.positions.slice(offset, offset + 9))
    }
  }
  const waterSurfaceDepth = Float32Array.from(waterDepthPositions)

  let cliffEdges = 0
  let cliffTriangles = 0
  // Authored cliff meshes replace the procedural skirts.
  const authoredCliffMeshes = input.items.some(
    item => item.facet === 'objects' && item.derivedFrom === 'cliffs',
  )
  const cliffs = authoredCliffMeshes ? [] : input.items.filter(item => item.facet === 'cliffs')
  const cliffByCell = new Map(cliffs.map(item => [`${item.x}:${item.y}`, item]))
  for (const item of cliffs) {
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ] as const) {
      const neighbor = cliffByCell.get(`${item.x + dx}:${item.y + dy}`)
      if (neighbor === undefined || neighbor.level === item.level) continue
      const a = terrainByCell.get(`${item.x}:${item.y}`)
      const b = terrainByCell.get(`${item.x + dx}:${item.y + dy}`)
      if (a === undefined || b === undefined) continue
      pushLine(lines, terrainPosition(a), terrainPosition(b), [0.18, 0.1, 0.05, 1])
      cliffEdges += 1
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

  const objects = input.items.filter(
    (item): item is WorldSceneObjectItem => item.facet === 'objects',
  )
  const projectorGround = Float32Array.from(terrainPickTriangles)
  let modelTriangles = 0
  let diagnosticPlaceholders = 0
  const planPrograms = new Map<
    string,
    Readonly<{
      scene: ReturnType<typeof worldModelSceneMaterials>
      programs: ReadonlyMap<string, SceneMaterialPrograms>
    }>
  >()
  for (const item of objects) {
    const translation = objectPosition(item, input)
    const pickTriangles: number[] = []
    const resourceIds = [
      ...new Set([
        ...(item.resourceId === undefined ? [] : [item.resourceId]),
        ...(item.resourceIds ?? []),
      ]),
    ]
    const components: readonly MapModelComponentPlacement[] =
      item.modelComponents ??
      resourceIds.map((resourceId, index) => ({
        id: `implicit-${String(index)}`,
        resourceId,
      }))
    const componentTransforms = new Map<string, Float32Array>()
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
      const current = sampleSharedModel(resourceId, item)
      if (current !== undefined) samples.set(resourceId, current)
      return current
    }
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
          const parentSample = parent === undefined ? undefined : sampleFor(parent.resourceId)
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
    let rendered = false
    let resolved = false
    for (const component of components) {
      const sampled = sampleFor(component.resourceId)
      if (sampled === undefined) continue
      const { result } = sampled
      resolved = true
      const componentTransform = componentTransforms.get(component.id)
      if (componentTransform === undefined) continue
      // Cliff meshes follow the painted base height (see `baseOffsetAt`).
      const primitives: typeof sampled.primitives =
        item.derivedFrom === 'cliffs'
          ? (liftedCliffPrimitives(
              sampled.primitives,
              multiplyComponentTransforms(worldObjectTransform(item, translation), componentTransform),
            ) as typeof sampled.primitives)
          : sampled.primitives
      let programs: ReadonlyMap<string, SceneMaterialPrograms> = new Map()
      const selectedAnimation = worldModelAnimation(result, item)
      const time = worldObjectTime(input, item, selectedAnimation !== undefined)
      const sequenceTime = selectedAnimation?.durationSeconds &&
        (item.presentationAnimation?.loop ?? selectedAnimation.looping)
        ? time % selectedAnimation.durationSeconds : time
      const teamColor =
        item.presentationTeamColor ??
        (item.player === undefined ? undefined : input.teamColors?.get(item.player))
      const materialContext: SceneRendererMaterialContext = {
        time,
        sequenceTime,
        ...(selectedAnimation?.sequenceIndex === undefined ? {} : { sequenceIndex: selectedAnimation.sequenceIndex }),
        sceneLighting: true,
        ...(teamColor === undefined ? {} : { teamColor }),
        ...(item.presentationTeamColorIntensity === undefined
          ? {}
          : { teamColorIntensity: item.presentationTeamColorIntensity }),
      }
      // Same model, clock and team presentation → same materials and programs (one GPU lease each).
      const programKey = [
        component.resourceId,
        time,
        selectedAnimation?.id ?? '',
        teamColor?.join(',') ?? '',
        item.presentationTeamColorIntensity ?? '',
      ].join('\u0000')
      const cachedMaterials = planPrograms.get(programKey)
      const presented = presentationMaterials(item, result.materials ?? [])
      const scene =
        cachedMaterials?.scene ?? worldModelSceneMaterials(presented, result.textures ?? [])
      if (cachedMaterials !== undefined) programs = cachedMaterials.programs
      else {
        try {
          programs = prepareSceneMaterialPrograms(
            scene.materials,
            new Map(scene.textures.map(texture => [texture.id, texture])),
            materialContext,
            [],
          )
        } catch {
          // A malformed or unsupported game-material vocabulary must retain the existing visible
          // fallback instead of making the whole map fail to render.
          programs = new Map()
        }
        planPrograms.set(programKey, { scene, programs })
      }
      const materialPrimitives: SceneRendererPrimitive[] = []
      const materialShadowPrimitives: SceneRendererPrimitive[] = []
      const instanceTransform = multiplyComponentTransforms(
        worldObjectTransform(item, translation),
        componentTransform,
      )
      for (const primitive of primitives) {
        const material = presented.find(candidate => candidate.id === primitive.materialId)
        const shadowPolicy = modelMaterialShadowPolicy(material)
        const prepared = programs.get(primitive.materialId ?? '')
        // A prepared material without color passes (distortion, terrain projection) draws nothing;
        // only an unprepared material takes the textured fallback below.
        if (prepared !== undefined && prepared.passes.length === 0) continue
        const sharedMaterial = prepared !== undefined
        const castsSharedMaterialShadow =
          sharedMaterial && shadowPolicy.castShadows && prepared.passes.some(materialIsSolid)
        if (sharedMaterial) {
          const primitiveTransform = 'transform' in primitive ? primitive.transform : undefined
          const instancePrimitive = Object.freeze({
            ...primitive,
            transform: multiplyComponentTransforms(
              instanceTransform,
              primitiveTransform ?? IDENTITY_COMPONENT_TRANSFORM,
            ),
            ...(item.objectId === input.selectedObjectId
              ? { tint: [1, 0.82, 0.12, 1] as const }
              : {}),
          })
          materialPrimitives.push(instancePrimitive)
          if (castsSharedMaterialShadow) materialShadowPrimitives.push(instancePrimitive)
        }
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
        const coverage = modelMaterialCoverage(material)
        const blendMode =
          coverage.mode !== 'blend'
            ? undefined
            : material?.blendMode === 'additive'
              ? ('additive' as const)
              : ('blend' as const)
        const normalTexture =
          normalLayer?.resourceId === undefined || (normalLayer.uvSource ?? 0) !== requestedUv
            ? undefined
            : result.textures?.find(candidate => candidate.id === normalLayer.resourceId)
        const textureCoordinates =
          primitive.textureCoordinateSets?.find(candidate => candidate.set === requestedUv)
            ?.coordinates ?? (requestedUv === 0 ? primitive.textureCoordinates : undefined)
        const color =
          item.objectId === input.selectedObjectId
            ? ([1, 0.82, 0.12, 1] as const)
            : texture === undefined
              ? colorHash(primitive.materialId ?? item.kind)
              : ([1, 1, 1, 1] as const)
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
          if (sharedMaterial) {
            if (castsSharedMaterialShadow) modelMaterialShadowTriangles += 1
          } else if (
            texture !== undefined &&
            textureCoordinates !== undefined &&
            textureCoordinates.length >= (primitive.positions.length / 3) * 2
          ) {
            const key = `${result.sourceKey}\u0000${texture.id}\u0000${normalTexture?.id ?? ''}\u0000${blendMode ?? 'opaque'}\u0000${String(coverage.cutoff)}\u0000${String(shadowPolicy.castShadows)}\u0000${String(shadowPolicy.receiveShadows)}`
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
            }
            collection.set(
              key,
              target as MutableTexturedBatch & {
                readonly blendMode: 'blend' | 'additive'
                readonly receiveShadows: boolean
              },
            )
            pushTexturedTriangle(
              target,
              vertices,
              triangle.map(index => [
                textureCoordinates[index * 2] ?? 0,
                textureCoordinates[index * 2 + 1] ?? 0,
              ]) as unknown as readonly [
                readonly [number, number],
                readonly [number, number],
                readonly [number, number],
              ],
              color,
            )
          } else if (shadowPolicy.castShadows && shadowPolicy.receiveShadows) {
            pushTriangle(opaque, vertices[0], vertices[1], vertices[2], color)
          } else {
            const key = `${String(shadowPolicy.castShadows)}:${String(shadowPolicy.receiveShadows)}`
            const target = shadowControlledOpaque.get(key) ?? {
              ...batch(),
              castShadows: shadowPolicy.castShadows,
              receiveShadows: shadowPolicy.receiveShadows,
            }
            shadowControlledOpaque.set(key, target)
            pushTriangle(target, vertices[0], vertices[1], vertices[2], color)
          }
          for (const vertex of vertices) pickTriangles.push(vertex[0], vertex[1], vertex[2])
          modelTriangles += 1
          rendered = true
        }
      }
      const effectSource = result.uvmBytes === undefined ? undefined : uvmEffectSource(result.uvmBytes, selectedAnimation?.sequenceIndex)
      if (effectSource?.hasProjectors && scene.materials.length > 0) {
        const projected = effectSource.project(time, scene.materials, [{
          id: 'world-terrain-receiver', topology: 'triangles', positions: projectorGround,
          transform: Float32Array.from(invertMaterialFrame(Array.from(instanceTransform))),
        }])
        let projectedPrograms: ReadonlyMap<string, SceneMaterialPrograms> = new Map()
        try {
          projectedPrograms = prepareSceneMaterialPrograms(
            projected.materials,
            new Map(scene.textures.map(texture => [texture.id, texture])),
            materialContext,
            [],
          )
        } catch {
          // Unsupported projector materials remain isolated from the rest of the map.
        }
        const projectedMaterialPrimitives: SceneRendererPrimitive[] = []
        for (const primitive of projected.primitives) {
          const material = projected.materials.find(candidate => candidate.id === primitive.materialId)
          if (material !== undefined && material.simpleEffect === undefined) {
            if (projectedPrograms.has(material.id))
              projectedMaterialPrimitives.push(Object.freeze({
                ...primitive,
                transform: multiplyComponentTransforms(
                  instanceTransform,
                  primitive.transform ?? IDENTITY_COMPONENT_TRANSFORM,
                ),
              }))
            continue
          }
          const resource = material?.simpleEffect?.textureResource
          const textureId = material?.textureBindings?.find(binding => binding.resourceId === resource)?.textureId
          const texture = scene.textures.find(candidate => candidate.id === textureId)
          if (!texture || !primitive.textureCoordinates) continue
          const key = `projector:${texture.id}`
          const target = transparentTextured.get(key) ?? {
            ...batch(), textureCoordinates: [], texture, blendMode: 'blend' as const,
            castShadows: false, receiveShadows: false,
          }
          transparentTextured.set(key, target)
          for (const triangle of primitiveTriangles(primitive)) {
            const vertices = triangle.map(index => {
              const p = transformedComponentVertex(transformedPrimitiveVertex(primitive, index), instanceTransform)
              return [p[0], p[1] + 0.005, p[2]] as const
            })
            pushTexturedTriangle(target, vertices as unknown as Parameters<typeof pushTexturedTriangle>[1],
              triangle.map(index => [primitive.textureCoordinates![index * 2]!, primitive.textureCoordinates![index * 2 + 1]!]) as unknown as Parameters<typeof pushTexturedTriangle>[2],
              [1, 1, 1, material?.baseColor?.[3] ?? 1])
          }
        }
        if (projectedMaterialPrimitives.length > 0)
          modelMaterialScenes.push(Object.freeze({
            primitives: Object.freeze(projectedMaterialPrimitives),
            shadowPrimitives: Object.freeze([]),
            materials: projected.materials,
            programs: projectedPrograms,
            textures: scene.textures,
          }))
      }
      if (effectSource !== undefined)
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
      if (materialPrimitives.length > 0)
        modelMaterialScenes.push(
          Object.freeze({
            primitives: Object.freeze(materialPrimitives),
            shadowPrimitives: Object.freeze(materialShadowPrimitives),
            materials: scene.materials,
            programs,
            textures: scene.textures,
          }),
        )
    }
    // A cliff piece whose code ships no mesh (ramp interiors) is the terrain's own slope: nothing to
    // mark.
    if (!rendered && !resolved && item.derivedFrom !== 'cliffs') {
      const selected = item.objectId === input.selectedObjectId
      pushVertex(points, translation, [0, 1, 0], selected ? [1, 0.9, 0.1, 1] : colorHash(item.kind))
      diagnosticPlaceholders += 1
    }
    objectPickMeshes.push({
      objectId: item.objectId,
      center: translation,
      triangles: pickTriangles,
      placeholder: !resolved,
    })
  }

  let navigationSamples = 0
  for (const item of input.items.filter(item => item.facet === 'navigation')) {
    if (item.flags === 0) continue
    const position =
      item.uvwPosition === undefined
        ? ([item.x, 0, item.y] as const)
        : ([item.uvwPosition.x, item.uvwPosition.y, item.uvwPosition.z] as const)
    pushVertex(points, position, [0, 1, 0], [0.88, 0.15, 0.12, 0.7])
    navigationSamples += 1
  }

  let regionShapes = 0
  for (const item of input.items.filter(item => item.facet === 'regions')) {
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

  if (
    !finitePlan([
      opaque,
      transparent,
      lines,
      points,
      ...textured.values(),
      ...transparentTextured.values(),
      ...splat.values(),
    ])
  )
    throw new TypeError('world WebGL plan contains a non-finite coordinate')
  for (const item of objectPickMeshes)
    if (!item.triangles.every(Number.isFinite))
      throw new TypeError('world WebGL plan contains a non-finite model coordinate')
  for (const item of textured.values())
    if (!item.textureCoordinates.every(Number.isFinite))
      throw new TypeError('world WebGL plan contains a non-finite texture coordinate')
  for (const item of transparentTextured.values())
    if (!item.textureCoordinates.every(Number.isFinite))
      throw new TypeError('world WebGL plan contains a non-finite texture coordinate')
  for (const item of splat.values()) {
    if (
      item.textureCoordinates.some(coordinates => !coordinates.every(Number.isFinite)) ||
      !item.textureWeights0.every(Number.isFinite) ||
      !item.textureWeights1.every(Number.isFinite) ||
      (item.weightTextureCoordinates !== undefined &&
        !item.weightTextureCoordinates.every(Number.isFinite))
    )
      throw new TypeError('world WebGL splat plan contains a non-finite texture value')
  }
  const positionSets: readonly (readonly number[] | Float32Array)[] = [
    opaque,
    transparent,
    lines,
    points,
    ...shadowControlledOpaque.values(),
    ...textured.values(),
    ...transparentTextured.values(),
    ...splat.values(),
  ].map(item => item.positions)
  const minimum: [number, number, number] = [Infinity, Infinity, Infinity]
  const maximum: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  let hasPositions = false
  for (const positions of [...positionSets, ...objectPickMeshes.map(item => item.triangles)]) {
    if (positions.length > 0) hasPositions = true
    for (let offset = 0; offset < positions.length; offset += 3) {
      for (const axis of [0, 1, 2] as const) {
        minimum[axis] = Math.min(minimum[axis], positions[offset + axis]!)
        maximum[axis] = Math.max(maximum[axis], positions[offset + axis]!)
      }
    }
  }
  if (!hasPositions) {
    minimum.fill(-0.5)
    maximum.fill(0.5)
  }
  const lighting = input.items.find(item => item.facet === 'lighting')
  const directional = lighting?.directional[0]
  const ambient: readonly [number, number, number] = lighting?.ambientColor ?? [1, 1, 1]
  const direction: readonly [number, number, number] = directional?.direction ?? [-0.45, -1, -0.35]
  const lightColor: readonly [number, number, number] = directional?.color ?? [1, 0.97, 0.9]
  const shadowCasterTriangles =
    modelMaterialShadowTriangles +
    (opaque.positions.length +
      [...shadowControlledOpaque.values()].reduce(
        (sum, item) => sum + (item.castShadows ? item.positions.length : 0),
        0,
      ) +
      [...textured.values()].reduce(
        (sum, item) => sum + (item.castShadows === false ? 0 : item.positions.length),
        0,
      ) +
      [...splat.values()].reduce((sum, item) => sum + item.positions.length, 0)) /
      9
  return Object.freeze({
    opaqueTriangles: frozenBatch(opaque),
    waterSurfaceDepth,
    modelMaterialScenes: Object.freeze(modelMaterialScenes),
    modelEffects: Object.freeze(modelEffects),
    shadowControlledOpaqueTriangles: Object.freeze(
      [...shadowControlledOpaque.values()].map(item =>
        Object.freeze({
          ...frozenBatch(item),
          castShadows: item.castShadows,
          receiveShadows: item.receiveShadows,
        }),
      ),
    ),
    texturedTriangles: Object.freeze([...textured.values()].map(frozenTexturedBatch)),
    transparentTexturedTriangles: Object.freeze(
      [...transparentTextured.values()].map(item =>
        Object.freeze({
          ...frozenTexturedBatch(item),
          blendMode: item.blendMode,
          receiveShadows: item.receiveShadows,
        }),
      ),
    ),
    splatTriangles: Object.freeze([...splat.values()].map(frozenSplatBatch)),
    transparentTriangles: frozenBatch(transparent),
    lines: frozenBatch(lines),
    points: frozenBatch(points),
    picking: Object.freeze({
      terrainTriangles: projectorGround,
      objects: Object.freeze(
        objectPickMeshes.map(item =>
          Object.freeze({
            objectId: item.objectId,
            center: item.center,
            triangles: Float32Array.from(item.triangles),
            placeholder: item.placeholder,
          }),
        ),
      ),
    }),
    bounds: Object.freeze({ minimum: Object.freeze(minimum), maximum: Object.freeze(maximum) }),
    light: Object.freeze({
      ...(lighting?.toneMapping === undefined ? {} : { toneMapping: lighting.toneMapping }),
      ...(lighting?.terrain === undefined ? {} : { terrain: lighting.terrain }),
      specularColor: directional?.specularColor ?? lightColor,
      specularIntensity: directional?.specularIntensity ?? directional?.intensity ?? 0.9,
      useAmbientOcclusion: directional?.useAmbientOcclusion ?? true,
      ambient,
      ambientIntensity: lighting?.ambientIntensity ?? 0.36,
      direction,
      color: lightColor,
      intensity: directional?.intensity ?? 0.9,
      fills: Object.freeze(
        (lighting?.directional ?? []).slice(1, 1 + MAXIMUM_FILL_LIGHTS).map(light =>
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
      terrainTriangles,
      terrainTexturedTriangles,
      terrainSplatFallbackCells,
      waterPolygons,
      cliffEdges,
      cliffTriangles,
      objectInstances: objects.length,
      modelTriangles,
      navigationSamples,
      gatewaySegments,
      regionShapes,
      diagnosticPlaceholders,
      shadowCasterTriangles,
      shadowMapSize: 0,
    }),
  })
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
out vec2 textureCoordinate;
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
in vec2 textureCoordinate;
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
uniform vec3 fillSpecularRadiance0;
uniform vec3 fillSpecularRadiance1;
uniform vec3 terrainLighting;
uniform float keyUsesVertexAo;
uniform float fillUsesVertexAo0;
uniform float fillUsesVertexAo1;
uniform float terrainSpecularTextured;
uniform sampler2DArray terrainSpecularMaps;
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
uniform sampler2D baseColorMap;
uniform float alphaCutoff;
uniform sampler2D normalMap;
uniform sampler2D secondaryColorMap;
uniform sampler2DArray terrainMaps;
uniform sampler2DArray terrainNormalMaps;
uniform sampler2D terrainWeightMaps[2];
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
out vec4 outColor;
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
  if (layerValue(terrainNormalSwizzle0, terrainNormalSwizzle1, layer) > 0.5) {
    // DXN-swizzled: X in alpha, Y in green, Z rebuilt — Shaders/TerrainBlend.fx UnSwizzleNormals.
    vec2 mappedXy = 2.0 * vec2(normalSample.w, normalSample.y) - 1.0;
    mappedNormal = vec3(mappedXy, sqrt(max(0.0, 1.0 - dot(mappedXy, mappedXy))));
  } else {
    mappedNormal = normalSample.xyz * 2.0 - 1.0;
    // A map that remaps to about zero (a grey height map, say) would have its noise amplified into
    // a per-triangle normal by the normalize below — a lattice over flat ground.
    if (dot(mappedNormal, mappedNormal) < 0.04) return baseNormal;
  }
  return normalize(tangent * mappedNormal.x + bitangent * mappedNormal.y + baseNormal * mappedNormal.z);
}
float directionalShadow(vec3 resolvedNormal) {
  if (shadowEnabled < 0.5 || shadowReceiver < 0.5 || shadowPosition.w <= 0.0) return 1.0;
  vec3 projected = shadowPosition.xyz / shadowPosition.w * 0.5 + 0.5;
  if (
    projected.x <= 0.0 || projected.x >= 1.0 ||
    projected.y <= 0.0 || projected.y >= 1.0 ||
    projected.z <= 0.0 || projected.z >= 1.0
  ) return 1.0;
  float slope = 1.0 - max(0.0, dot(normalize(resolvedNormal), normalize(-lightDirection)));
  float bias = max(0.00035, 0.0015 * slope);
  float visible = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      float closest = texture(
        shadowMap,
        projected.xy + vec2(float(x), float(y)) * shadowTexelSize
      ).r;
      visible += projected.z - bias <= closest ? 1.0 : 0.0;
    }
  }
  return visible / 9.0;
}
/** Radiance already carries intensity; a zero direction means "no such light". */
vec3 fillLight(vec3 resolvedNormal, vec3 direction, vec3 radiance) {
  if (dot(direction, direction) <= 0.0) return vec3(0.0);
  return radiance * max(0.0, dot(resolvedNormal, normalize(-direction)));
}
void main() {
  vec3 resolvedNormal = normalize(worldNormal);
  if (normalTextured > 0.5) {
    vec3 positionDx = dFdx(worldPosition);
    vec3 positionDy = dFdy(worldPosition);
    vec2 uvDx = dFdx(textureCoordinate);
    vec2 uvDy = dFdy(textureCoordinate);
    float determinant = uvDx.x * uvDy.y - uvDx.y * uvDy.x;
    if (abs(determinant) > 0.000001) {
      vec3 tangent = normalize((positionDx * uvDy.y - positionDy * uvDx.y) / determinant);
      vec3 bitangent = normalize((-positionDx * uvDy.x + positionDy * uvDx.x) / determinant);
      vec3 mappedNormal = texture(normalMap, textureCoordinate).xyz * 2.0 - 1.0;
      if (dot(mappedNormal, mappedNormal) >= 0.04) {
        resolvedNormal = normalize(
          tangent * mappedNormal.x + bitangent * mappedNormal.y + resolvedNormal * mappedNormal.z
        );
      }
    }
  }
  vec4 resolvedSplatWeights0 = splatWeights0;
  vec4 resolvedSplatWeights1 = splatWeights1;
  if (splatTextured > 0.5) {
    if (rasterSplatTextured > 0.5) {
      resolvedSplatWeights0 = texture(terrainWeightMaps[0], splatWeightTextureCoordinate);
      resolvedSplatWeights1 = terrainWeightMapCount > 1.5
        ? texture(terrainWeightMaps[1], splatWeightTextureCoordinate)
        : vec4(0.0);
      float totalWeight = dot(resolvedSplatWeights0, vec4(1.0)) + dot(resolvedSplatWeights1, vec4(1.0));
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
  float ao = splatTextured > 0.5 ? vertexColor.a : 1.0;
  float diffuseScale = splatTextured > 0.5 ? terrainLighting.y : 1.0;
  vec3 lighting = ambientColor * ambientIntensity * ao + lightColor * lightIntensity * diffuse * shadow * diffuseScale * mix(1.0, ao, keyUsesVertexAo);
  // Fill and back lights: diffuse only. The depth map belongs to the key light, and SC2's rig casts
  // one shadow too. Unrolled with constant indices: indexing these uniform arrays by a loop variable
  // silently contributed nothing through ANGLE/D3D11, while constant indices read them correctly.
  lighting += fillLight(resolvedNormal, fillLightDirection0, fillLightRadiance0) * diffuseScale * mix(1.0, ao, fillUsesVertexAo0);
  lighting += fillLight(resolvedNormal, fillLightDirection1, fillLightRadiance1) * diffuseScale * mix(1.0, ao, fillUsesVertexAo1);
  vec4 surface = vertexColor;
  float terrainSpecular = 0.0;
  if (splatTextured > 0.5) surface.a = 1.0;
  if (textured > 0.5) surface *= texture(baseColorMap, textureCoordinate);
  if (secondaryTextured > 0.5) {
    float secondarySurface = texture(secondaryColorMap, secondaryTextureCoordinate).r;
    surface.rgb *= secondarySurface;
  }
  if (splatTextured > 0.5) {
    vec4 mixedSurface = vec4(0.0);
    mixedSurface += terrainLayerSample(terrainMaps, 0, splatTextureCoordinates[0]) * resolvedSplatWeights0.x;
    mixedSurface += terrainLayerSample(terrainMaps, 1, splatTextureCoordinates[1]) * resolvedSplatWeights0.y;
    mixedSurface += terrainLayerSample(terrainMaps, 2, splatTextureCoordinates[2]) * resolvedSplatWeights0.z;
    mixedSurface += terrainLayerSample(terrainMaps, 3, splatTextureCoordinates[3]) * resolvedSplatWeights0.w;
    mixedSurface += terrainLayerSample(terrainMaps, 4, splatTextureCoordinates[4]) * resolvedSplatWeights1.x;
    mixedSurface += terrainLayerSample(terrainMaps, 5, splatTextureCoordinates[5]) * resolvedSplatWeights1.y;
    mixedSurface += terrainLayerSample(terrainMaps, 6, splatTextureCoordinates[6]) * resolvedSplatWeights1.z;
    mixedSurface += terrainLayerSample(terrainMaps, 7, splatTextureCoordinates[7]) * resolvedSplatWeights1.w;
    // SC2 TerrainBlend_CopyTerrainSpec reads diffuse alpha as specular, not coverage.
    terrainSpecular = mixedSurface.a;
    surface.rgb *= mixedSurface.rgb;
    surface.a = 1.0;
  }
  if (alphaCutoff > 0.0 && surface.a < alphaCutoff) discard;
  vec3 specular = vec3(0.0);
  if (splatTextured > 0.5 && terrainLighting.z > 0.0) {
    vec3 specColor = vec3(terrainSpecular);
    if (terrainSpecularTextured > 0.5) {
      specColor = vec3(0.0);
      for (int layer = 0; layer < 8; layer++) {
        float weight = layerValue(resolvedSplatWeights0, resolvedSplatWeights1, layer);
        if (weight > 0.0) specColor += terrainLayerSample(terrainSpecularMaps, layer, splatTextureCoordinates[layer]).rgb * weight;
      }
    }
    vec3 view = normalize(eyePosition - worldPosition);
    vec3 key = normalize(-lightDirection);
    float exponent = max(terrainLighting.x, 1.0);
    specular = specColor * terrainLighting.z * lightSpecularRadiance * pow(max(dot(resolvedNormal, normalize(view + key)), 0.0), exponent) * step(0.000001, diffuse) * shadow;
    if (length(fillLightDirection0) > 0.0) specular += specColor * terrainLighting.z * fillSpecularRadiance0 * pow(max(dot(resolvedNormal, normalize(view - normalize(fillLightDirection0))), 0.0), exponent) * step(0.000001, dot(resolvedNormal, -normalize(fillLightDirection0)));
    if (length(fillLightDirection1) > 0.0) specular += specColor * terrainLighting.z * fillSpecularRadiance1 * pow(max(dot(resolvedNormal, normalize(view - normalize(fillLightDirection1))), 0.0), exponent) * step(0.000001, dot(resolvedNormal, -normalize(fillLightDirection1)));
  }
  outColor = vec4(surface.rgb * lighting + specular, surface.a);
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
  frames: number
  programCompilations: number
  shadowTargetAllocations: number
  shadowTargetReuses: number
  worldPlanBuilds: number
  worldPlanReuses: number
  readonly worldPlanBuildMilliseconds: number[]
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
  readonly materialTextureHandles: Map<string, WebGLTexture>
  materialDraws: ReturnType<typeof materialWebGlDraws>
  materialPlan: WorldWebGlPlan | undefined
  retiredMaterialProgramCompilations: number
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

function percentile(values: readonly number[], fraction: number): number | undefined {
  if (values.length === 0) return undefined
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)]
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
    const bytes = texture.rgba
    const step = Math.max(1, Math.floor(bytes.length / WORLD_TEXTURE_KEY_SAMPLES))
    let checksum = 0
    for (let offset = 0; offset < bytes.length; offset += step)
      checksum = (Math.imul(checksum, 31) + bytes[offset]!) | 0
    key = [texture.id, texture.width, texture.height, texture.wrapU, texture.wrapV, texture.filter, checksum].join('|')
    worldTextureKeys.set(texture, key)
  }
  return key
}

function bindTexture2d(
  resources: WorldWebGlOwnedResources,
  texture: SceneRendererTexture,
  unit: number,
): WebGLTexture {
  if (
    texture.width <= 0 ||
    texture.height <= 0 ||
    texture.rgba.byteLength !== texture.width * texture.height * 4
  )
    throw new TypeError(`world texture ${texture.id} is not tightly packed RGBA8`)
  const gl = resources.gl
  const contentKey = worldTextureKey(texture)
  let entry = resources.textures.get(contentKey)
  if (entry === undefined) {
    const handle = gl.createTexture()
    if (handle === null) throw new TypeError('WebGL could not allocate a world texture')
    entry = Object.freeze({
      key: texture,
      handle,
      target: gl.TEXTURE_2D,
      bytes: texture.rgba.byteLength,
    })
    try {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, handle)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        texture.width,
        texture.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        texture.rgba,
      )
      const wrap = (value: string | undefined) => (value === 'clamp' ? gl.CLAMP_TO_EDGE : gl.REPEAT)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap(texture.wrapU))
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap(texture.wrapV))
      applyTextureFilter(gl, gl.TEXTURE_2D, texture.filter === 'nearest' ? 'nearest' : 'linear')
      resources.textures.set(contentKey, entry)
      resources.textureUploads += 1
    } catch (error) {
      gl.deleteTexture(handle)
      throw error
    }
  } else {
    resources.textureCacheHits += 1
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, entry.handle)
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

function animatedWater(input: WorldWebGlInput): boolean {
  return (
    input.waterMaterials?.some(material => material.scroll?.some(component => component !== 0)) ===
    true
  )
}

function animatedWorld(input: WorldWebGlInput): boolean {
  return animatedWater(input) || input.items.some(item => item.facet === 'objects' && item.presentationAnimation !== undefined)
}

function sameWorldPlanInput(left: WorldWebGlInput, right: WorldWebGlInput): boolean {
  return (
    sameArrayIdentity(left.items, right.items) &&
    left.models === right.models &&
    sameArrayIdentity(left.terrainMaterials, right.terrainMaterials) &&
    sameArrayIdentity(left.terrainWeightRasters, right.terrainWeightRasters) &&
    left.terrainTextures === right.terrainTextures &&
    sameArrayIdentity(left.waterMaterials, right.waterMaterials) &&
    left.selectedObjectId === right.selectedObjectId &&
    samePreviewPosition(left.previewPosition, right.previewPosition) &&
    sameNumberMap(left.animationTimes, right.animationTimes) &&
    left.teamColors === right.teamColors &&
    (!animatedWorld(left) || left.timeSeconds === right.timeSeconds)
  )
}

function sameWorldPlanInputExceptAnimationTimes(
  left: WorldWebGlInput,
  right: WorldWebGlInput,
): boolean {
  return (
    sameArrayIdentity(left.items, right.items) &&
    left.models === right.models &&
    sameArrayIdentity(left.terrainMaterials, right.terrainMaterials) &&
    sameArrayIdentity(left.terrainWeightRasters, right.terrainWeightRasters) &&
    left.terrainTextures === right.terrainTextures &&
    sameArrayIdentity(left.waterMaterials, right.waterMaterials) &&
    left.selectedObjectId === right.selectedObjectId &&
    samePreviewPosition(left.previewPosition, right.previewPosition) &&
    left.teamColors === right.teamColors &&
    (!animatedWorld(left) || left.timeSeconds === right.timeSeconds)
  )
}

function retainedWorldPlan(
  input: WorldWebGlInput,
  resources: WorldWebGlOwnedResources,
): WorldWebGlPlan {
  if (
    resources.lastPlan !== undefined &&
    resources.lastPlanInput !== undefined &&
    sameWorldPlanInput(resources.lastPlanInput, input)
  ) {
    resources.worldPlanReuses += 1
    resources.lastPlanInput = input
    return resources.lastPlan
  }
  const previousInput = resources.lastPlanInput
  const animationSeek =
    previousInput !== undefined &&
    sameWorldPlanInputExceptAnimationTimes(previousInput, input) &&
    !sameNumberMap(previousInput.animationTimes, input.animationTimes)
  const startedAt = globalThis.performance?.now() ?? Date.now()
  const plan = createWorldWebGlPlan(input)
  const elapsed = (globalThis.performance?.now() ?? Date.now()) - startedAt
  retainPerformanceSample(resources.worldPlanBuildMilliseconds, elapsed)
  if (animationSeek) retainPerformanceSample(resources.animationSeekMilliseconds, elapsed)
  resources.worldPlanBuilds += 1
  resources.lastPlanInput = input
  resources.lastPlan = plan
  return plan
}

function retainedWorldPlanBytes(plan: WorldWebGlPlan | undefined): number {
  if (plan === undefined) return 0
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
  for (const scene of plan.modelMaterialScenes) {
    for (const primitive of scene.primitives) {
      retain(primitive.positions)
      retain(primitive.normals)
      retain(primitive.tangents)
      retain(primitive.colors)
      retain(primitive.indices)
      retain(primitive.textureCoordinates)
      for (const coordinates of primitive.textureCoordinateSets ?? [])
        retain(coordinates.coordinates)
    }
    for (const texture of scene.textures) retain(texture.rgba)
  }
  for (const item of plan.shadowControlledOpaqueTriangles) retainBatch(item)
  for (const item of [...plan.texturedTriangles, ...plan.transparentTexturedTriangles]) {
    retainBatch(item)
    retain(item.textureCoordinates)
    retain(item.secondaryTextureCoordinates)
  }
  for (const item of plan.splatTriangles) {
    retainBatch(item)
    for (const coordinates of item.textureCoordinates) retain(coordinates)
    retain(item.textureWeights0)
    retain(item.textureWeights1)
    retain(item.weightTextureCoordinates)
  }
  for (const item of [plan.transparentTriangles, plan.lines, plan.points]) retainBatch(item)
  retain(plan.picking.terrainTriangles)
  for (const item of plan.picking.objects) retain(item.triangles)
  let bytes = 0
  for (const buffer of buffers) bytes += buffer.byteLength
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
    const materialTextureHandles = new Map<string, WebGLTexture>()
    return {
      gl,
      program,
      shadowProgram: createShadowProgram(gl),
      toneMapper: undefined,
      shadowTarget: undefined,
      frames: 0,
      programCompilations: 2,
      shadowTargetAllocations: 0,
      shadowTargetReuses: 0,
      worldPlanBuilds: 0,
      worldPlanReuses: 0,
      worldPlanBuildMilliseconds: [],
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
      materialDraws: materialWebGlDraws(gl, materialTextureHandles, { mipmaps: true, checkEachDraw: false }),
      materialPlan: undefined,
      retiredMaterialProgramCompilations: 0,
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

function disposeOwnedResources(resources: WorldWebGlOwnedResources): void {
  if (resources.disposed) return
  resources.disposed = true
  resources.toneMapper?.dispose()
  resources.toneMapper = undefined
  resources.lastPlanInput = undefined
  resources.lastPlan = undefined
  resources.materialPlan = undefined
  resources.retiredMaterialProgramCompilations += resources.materialDraws.programCompilations()
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
}

function assertNoWebGlError(gl: WebGL2RenderingContext, stage: string) {
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
    gl.uniform1f(uniformLocation(gl, program, 'alphaCutoff'), 0)
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
    gl.uniform1f(uniformLocation(gl, program, 'alphaCutoff'), 0)
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
  gl.uniform1i(uniformLocation(gl, program, 'baseColorMap'), 0)
  gl.uniform1f(uniformLocation(gl, program, 'alphaCutoff'), source.alphaCutoff ?? 0)
  drawBatch(resources, program, source, gl.TRIANGLES)
}

function prepareWorldMaterialResources(
  resources: WorldWebGlOwnedResources,
  plan: WorldWebGlPlan,
): void {
  if (resources.materialPlan !== plan) {
    resources.retiredMaterialProgramCompilations += resources.materialDraws.programCompilations()
    resources.materialDraws.release()
    resources.materialTextureHandles.clear()
    resources.materialDraws = materialWebGlDraws(resources.gl, resources.materialTextureHandles, {
      mipmaps: true,
      checkEachDraw: false,
    })
    resources.materialPlan = plan
  }
  const seen = new Set<SceneRendererTexture>()
  for (const scene of [...plan.modelMaterialScenes, ...plan.modelEffects])
    for (const texture of scene.textures) {
      if (seen.has(texture)) continue
      seen.add(texture)
      resources.materialTextureHandles.set(texture.id, bindTexture2d(resources, texture, 0))
    }
}

function renderWorldShadowMap(
  gl: WebGL2RenderingContext,
  plan: WorldWebGlPlan,
  input: WorldWebGlInput,
  resources: WorldWebGlOwnedResources,
): WorldShadowResources | undefined {
  if (input.shadows !== true || plan.stats.shadowCasterTriangles === 0) return undefined
  const requestedSize = input.shadowMapSize ?? 2_048
  if (!Number.isSafeInteger(requestedSize) || requestedSize <= 0)
    throw new TypeError('world shadowMapSize must be a positive safe integer')
  const size = Math.min(requestedSize, 4_096, Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)))
  if (size <= 0) throw new TypeError('WebGL2 reports no usable shadow-map texture size')

  const minimum = new Vector3(...plan.bounds.minimum)
  const maximum = new Vector3(...plan.bounds.maximum)
  const extent = maximum.clone().sub(minimum)
  const view = cameraState(input.camera)
  // Spend the depth map on what the camera sees: the orbit target and the ground footprint of the
  // orthographic view (stretched by a low elevation), plus the world height for casters that lean
  // in. A whole-map map at close zoom turns each texel into a visible block.
  const center = minimum.clone().add(maximum).multiplyScalar(0.5).add(new Vector3(...view.target))
  const aspect = gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight)
  const footprint =
    ((Math.max(1, extent.length() * 0.65) / view.zoom) * Math.max(1, aspect)) /
    Math.max(0.25, Math.sin(view.elevation))
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
    gl.drawBuffers([gl.NONE])
    gl.readBuffer(gl.NONE)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new TypeError('world shadow-map framebuffer is incomplete')

    gl.viewport(0, 0, size, size)
    gl.colorMask(false, false, false, false)
    gl.clearDepth(1)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.enable(gl.POLYGON_OFFSET_FILL)
    gl.polygonOffset(1.1, 4)
    gl.clear(gl.DEPTH_BUFFER_BIT)
    gl.useProgram(program)
    gl.uniformMatrix4fv(
      uniformLocation(gl, program, 'lightViewProjection'),
      false,
      viewProjection,
    )
    bindSentinelTexture2d(resources, 0)
    gl.uniform1i(uniformLocation(gl, program, 'baseColorMap'), 0)
    drawShadowPositions(resources, program, plan.opaqueTriangles.positions)
    for (const item of plan.shadowControlledOpaqueTriangles) {
      if (item.castShadows) drawShadowPositions(resources, program, item.positions)
    }
    for (const item of plan.texturedTriangles) {
      if (item.castShadows === false) continue
      if ((item.alphaCutoff ?? 0) > 0) drawShadowTextured(resources, program, item)
      else drawShadowPositions(resources, program, item.positions)
    }
    for (const item of plan.splatTriangles) drawShadowPositions(resources, program, item.positions)
    if (plan.modelMaterialScenes.some(scene => scene.shadowPrimitives.length > 0)) {
      const sceneCamera = {
        viewProjection,
        viewMatrix: Float32Array.from(lightCamera.matrixWorldInverse.elements),
        eyePosition: [
          lightCamera.position.x,
          lightCamera.position.y,
          lightCamera.position.z,
        ] as const,
      }
      const sceneLight = worldMaterialLight(plan)
      for (const scene of plan.modelMaterialScenes)
        for (const draw of sceneMaterialDraws(
          scene.shadowPrimitives,
          scene.materials,
          scene.programs,
          viewProjection,
          [],
          1,
        )) {
          if (draw.program === undefined || !materialIsSolid(draw.program)) continue
          resources.materialDraws.draw(
            {
              ...draw,
              primitive: {
                ...draw.primitive,
                depthBias: { slopeScale: 1.1, units: 4 },
              },
              depthOnly: true,
            },
            sceneCamera,
            sceneLight,
          )
        }
      gl.colorMask(false, false, false, false)
    }
    assertNoWebGlError(gl, 'shadow-map pass')
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
  gl.uniform1i(uniformLocation(gl, program, 'baseColorMap'), 4)
  if (source.normalTexture === undefined) {
    gl.uniform1f(uniformLocation(gl, program, 'normalTextured'), 0)
  } else {
    bindTexture2d(resources, source.normalTexture, 5)
    gl.uniform1i(uniformLocation(gl, program, 'normalMap'), 5)
    gl.uniform1f(uniformLocation(gl, program, 'normalTextured'), 1)
  }
  if (source.secondaryTexture === undefined || source.secondaryTextureCoordinates === undefined) {
    gl.uniform1f(uniformLocation(gl, program, 'secondaryTextured'), 0)
  } else {
    bindTexture2d(resources, source.secondaryTexture, 6)
    gl.uniform1i(uniformLocation(gl, program, 'secondaryColorMap'), 6)
    gl.uniform1f(uniformLocation(gl, program, 'secondaryTextured'), 1)
  }
  gl.uniform1f(uniformLocation(gl, program, 'textured'), 1)
  gl.uniform1f(uniformLocation(gl, program, 'alphaCutoff'), source.alphaCutoff ?? 0)
  drawBatch(resources, program, source, gl.TRIANGLES, source, range)
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
      texture.rgba.byteLength !== texture.width * texture.height * 4
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
    if (texture.width === width && texture.height === height) return texture.rgba
    const output = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      const sourceY = Math.min(
        texture.height - 1,
        Math.floor(((y + 0.5) * texture.height) / height),
      )
      for (let x = 0; x < width; x += 1) {
        const sourceX = Math.min(texture.width - 1, Math.floor(((x + 0.5) * texture.width) / width))
        const from = (sourceY * texture.width + sourceX) * 4
        output.set(texture.rgba.subarray(from, from + 4), (y * width + x) * 4)
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
      const nearest = textures.every(
        texture => texture === undefined || texture.filter === 'nearest',
      )
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
    gl.uniform1i(uniformLocation(gl, program, 'terrainSpecularMaps'), 8)
    gl.uniform1f(uniformLocation(gl, program, 'terrainSpecularTextured'), hasSpecular ? 1 : 0)
    gl.uniform1i(uniformLocation(gl, program, 'terrainMaps'), 0)
    gl.uniform1i(uniformLocation(gl, program, 'terrainNormalMaps'), 1)
    if ((source.weightTextures?.length ?? 0) < 2) {
      const firstMissingUnit = 2 + (source.weightTextures?.length ?? 0)
      for (let unit = firstMissingUnit; unit <= 3; unit += 1) {
        bindSentinelTexture2d(resources, unit)
      }
    }
    // Every active sampler type must point at a compatible unit even when its runtime branch is
    // disabled. The ordinary 2D samplers share unit 2 here; array samplers stay on units 0 and 1.
    gl.uniform1i(uniformLocation(gl, program, 'baseColorMap'), 4)
    gl.uniform1i(uniformLocation(gl, program, 'normalMap'), 5)
    gl.uniform1i(uniformLocation(gl, program, 'secondaryColorMap'), 6)
    gl.uniform1i(uniformLocation(gl, program, 'terrainWeightMaps[0]'), 2)
    gl.uniform1i(uniformLocation(gl, program, 'terrainWeightMaps[1]'), 3)
    ;(source.weightTextures ?? []).forEach((texture, index) => {
      bindTexture2d(resources, texture, 2 + index)
      gl.uniform1i(uniformLocation(gl, program, `terrainWeightMaps[${String(index)}]`), 2 + index)
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
    gl.uniform1f(uniformLocation(gl, program, 'textured'), 0)
    gl.uniform1f(uniformLocation(gl, program, 'alphaCutoff'), 0)
    gl.uniform1f(uniformLocation(gl, program, 'normalTextured'), 0)
    gl.uniform1f(uniformLocation(gl, program, 'secondaryTextured'), 0)
    gl.uniform1f(uniformLocation(gl, program, 'splatTextured'), 1)
    gl.uniform1f(
      uniformLocation(gl, program, 'rasterSplatTextured'),
      source.weightTextures === undefined ? 0 : 1,
    )
    gl.uniform1f(
      uniformLocation(gl, program, 'terrainWeightMapCount'),
      source.weightTextures?.length ?? 0,
    )
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
      },
      gl.TRIANGLES,
      source,
    )
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
  if (
    !Number.isFinite(source.azimuth) ||
    !Number.isFinite(source.elevation) ||
    source.elevation <= 0.03 ||
    source.elevation >= Math.PI / 2 - 0.03 ||
    !Number.isFinite(source.zoom) ||
    source.zoom < 0.125 ||
    source.zoom > 16 ||
    source.target.length !== 3 ||
    !source.target.every(Number.isFinite)
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
): readonly WorldWebGlTransparentDraw[] {
  const view = cameraState(requested)
  const key = `${String(view.azimuth)}:${String(view.elevation)}`
  const cached = transparentDrawPlans.get(plan)
  if (cached?.key === key) return cached.draws
  const draws = sortedWorldWebGlTransparentDraws(plan, view)
  transparentDrawPlans.set(plan, Object.freeze({ key, draws }))
  return draws
}

function sortedWorldWebGlTransparentDraws(
  plan: WorldWebGlPlan,
  view: ReturnType<typeof cameraState>,
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
    ...plan.transparentTexturedTriangles.map(batch => ({
      kind: 'textured' as const,
      blendMode: batch.blendMode,
      receiveShadows: batch.receiveShadows,
      batch,
    })),
  ]
  const triangles: Array<{
    sourceIndex: number
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
    for (let offset = 0; offset < positions.length; offset += 9) {
      let depth = 0
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const start = offset + vertex * 3
        depth +=
          positions[start]! * direction[0] +
          positions[start + 1]! * direction[1] +
          positions[start + 2]! * direction[2]
      }
      triangles.push({ sourceIndex, offset, depth, ordinal })
      ordinal += 1
    }
  }
  // The camera is positioned along +direction, so the smallest projection is farthest away.
  triangles.sort((left, right) => left.depth - right.depth || left.ordinal - right.ordinal)

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

type WorldWebGlCompositeTransparentDraw =
  | Readonly<{ kind: 'world'; draw: WorldWebGlTransparentDraw }>
  | Readonly<{
      kind: 'material'
      scene: WorldWebGlModelMaterialScene
      draw: MaterialDraw & { readonly program: NonNullable<MaterialDraw['program']> }
    }>

const boundsCenters = new WeakMap<Float32Array, readonly [number, number, number]>()

function transparentProjectionDepth(
  positions: Float32Array,
  direction: readonly [number, number, number],
  transform?: Float32Array,
): number {
  // Vertex arrays are shared by every instance and immutable for a plan; scan each one once.
  let center = boundsCenters.get(positions)
  if (center === undefined) {
    if (positions.length % 3 !== 0 || !positions.every(Number.isFinite))
      throw new TypeError('world transparent primitive contains invalid positions')
    const minimum = [Infinity, Infinity, Infinity]
    const maximum = [-Infinity, -Infinity, -Infinity]
    for (let offset = 0; offset < positions.length; offset += 3)
      for (const axis of [0, 1, 2] as const) {
        minimum[axis] = Math.min(minimum[axis]!, positions[offset + axis]!)
        maximum[axis] = Math.max(maximum[axis]!, positions[offset + axis]!)
      }
    center =
      positions.length === 0
        ? ([0, 0, 0] as const)
        : (minimum.map((value, axis) => (value + maximum[axis]!) / 2) as [number, number, number])
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

function createWorldWebGlCompositeTransparentDrawPlan(
  plan: WorldWebGlPlan,
  requested: WorldWebGlCamera | undefined,
  materialDraws: readonly Readonly<{
    scene: WorldWebGlModelMaterialScene
    draw: MaterialDraw & { readonly program: NonNullable<MaterialDraw['program']> }
  }>[],
): readonly WorldWebGlCompositeTransparentDraw[] {
  const view = cameraState(requested)
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
  for (const draw of createWorldWebGlTransparentDrawPlan(plan, requested))
    entries.push({
      value: Object.freeze({ kind: 'world', draw }),
      priority: 0,
      depth: draw.range.depth,
      ordinal: entries.length,
    })
  for (const entry of materialDraws)
    entries.push({
      value: Object.freeze({ kind: 'material', ...entry }),
      priority: entry.draw.program.priority,
      depth: transparentProjectionDepth(
        entry.draw.primitive.positions,
        direction,
        entry.draw.primitive.transform,
      ),
      ordinal: entries.length,
    })
  entries.sort(
    (left, right) =>
      left.priority - right.priority || left.depth - right.depth || left.ordinal - right.ordinal,
  )
  return Object.freeze(entries.map(entry => entry.value))
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
    elevation: Math.max(0.04, Math.min(Math.PI / 2 - 0.04, source.elevation + delta.y * 0.008)),
  })
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

function cameraFor(
  plan: WorldWebGlPlan,
  width: number,
  height: number,
  requested?: WorldWebGlCamera,
) {
  const view = cameraState(requested)
  const center = new Vector3(
    (plan.bounds.minimum[0] + plan.bounds.maximum[0]) / 2,
    (plan.bounds.minimum[1] + plan.bounds.maximum[1]) / 2,
    (plan.bounds.minimum[2] + plan.bounds.maximum[2]) / 2,
  ).add(new Vector3(...view.target))
  const extent = new Vector3(
    plan.bounds.maximum[0] - plan.bounds.minimum[0],
    plan.bounds.maximum[1] - plan.bounds.minimum[1],
    plan.bounds.maximum[2] - plan.bounds.minimum[2],
  )
  const radius = Math.max(1, extent.length() * 0.65)
  const visibleRadius = radius / view.zoom
  const aspect = width / height
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

/** Model material light: key color × intensity plus the authored ambient color, as terrain uses. */
export function worldMaterialLight(plan: WorldWebGlPlan) {
  const { direction, color, intensity, ambient, ambientIntensity } = plan.light
  return {
    // World facets carry the emitted ray; materialGeometry expects surface-to-light.
    direction: [-direction[0], -direction[1], -direction[2]] as const,
    color: [color[0] * intensity, color[1] * intensity, color[2] * intensity, 1] as const,
    specularColor: (plan.light.specularColor ?? color).map(value => value * (plan.light.specularIntensity ?? intensity)) as [number, number, number],
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

/** Casts through the same camera as the renderer and tests instance triangles before terrain. */
export function pickWorldWebGl(
  input: WorldWebGlInput,
  screen: Readonly<{ x: number; y: number; width: number; height: number }>,
): WorldWebGlPick | undefined {
  if (
    ![screen.x, screen.y, screen.width, screen.height].every(Number.isFinite) ||
    screen.width <= 0 ||
    screen.height <= 0
  ) {
    throw new TypeError('world WebGL pick screen must be finite and non-empty')
  }
  const plan = createWorldWebGlPlan(input)
  const { camera, radius } = cameraFor(plan, screen.width, screen.height, input.camera)
  const raycaster = new Raycaster()
  raycaster.setFromCamera(
    new Vector2((screen.x / screen.width) * 2 - 1, 1 - (screen.y / screen.height) * 2),
    camera,
  )
  let nearestDistance = Infinity
  let nearest: WorldWebGlPick | undefined
  const target = new Vector3()
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
  }
  intersectTriangles(plan.picking.terrainTriangles, hit =>
    Object.freeze({
      kind: 'terrain',
      position: Object.freeze([hit.x, hit.y, hit.z] as const),
    }),
  )
  return nearest
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
  const plan = retainedWorldPlan(input, resources)
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
    gl.uniform1i(uniformLocation(gl, program, 'terrainMaps'), 0)
    gl.uniform1i(uniformLocation(gl, program, 'terrainNormalMaps'), 1)
    gl.uniform1i(uniformLocation(gl, program, 'terrainWeightMaps[0]'), 2)
    gl.uniform1i(uniformLocation(gl, program, 'terrainWeightMaps[1]'), 3)
    gl.uniform1i(uniformLocation(gl, program, 'baseColorMap'), 4)
    gl.uniform1i(uniformLocation(gl, program, 'normalMap'), 5)
    gl.uniform1i(uniformLocation(gl, program, 'secondaryColorMap'), 6)
    gl.uniform1i(uniformLocation(gl, program, 'shadowMap'), 7)
    const sceneCamera = createWorldWebGlCameraFrame(plan, canvas.width, canvas.height, input.camera)
    gl.uniform3fv(uniformLocation(gl, program, 'eyePosition'), sceneCamera.eyePosition)
    const terrainLight = plan.light.terrain
    gl.uniform3f(uniformLocation(gl, program, 'terrainLighting'), terrainLight?.specularExponent ?? 16, terrainLight?.diffuseMultiplier ?? 1, terrainLight?.specularMultiplier ?? 0)
    gl.uniform1f(uniformLocation(gl, program, 'keyUsesVertexAo'), plan.light.useAmbientOcclusion === false ? 0 : 1)
    gl.uniform3fv(uniformLocation(gl, program, 'lightSpecularRadiance'), (plan.light.specularColor ?? plan.light.color).map(value => value * (plan.light.specularIntensity ?? plan.light.intensity)))
    gl.uniform1i(uniformLocation(gl, program, 'terrainSpecularMaps'), 8)
    const viewProjection = sceneCamera.viewProjection
    gl.uniformMatrix4fv(uniformLocation(gl, program, 'viewProjection'), false, viewProjection)
    gl.uniform3fv(
      uniformLocation(gl, program, 'ambientColor'),
      Float32Array.from(plan.light.ambient),
    )
    gl.uniform1f(uniformLocation(gl, program, 'ambientIntensity'), plan.light.ambientIntensity)
    gl.uniform3fv(
      uniformLocation(gl, program, 'lightDirection'),
      Float32Array.from(plan.light.direction),
    )
    gl.uniform3fv(uniformLocation(gl, program, 'lightColor'), Float32Array.from(plan.light.color))
    gl.uniform1f(uniformLocation(gl, program, 'lightIntensity'), plan.light.intensity)
    const fills = plan.light.fills.slice(0, MAXIMUM_FILL_LIGHTS)
    for (let index = 0; index < MAXIMUM_FILL_LIGHTS; index += 1) {
      const fill = fills[index]
      gl.uniform1f(uniformLocation(gl, program, `fillUsesVertexAo${String(index)}`), fill?.useAmbientOcclusion === false ? 0 : 1)
      gl.uniform3fv(uniformLocation(gl, program, `fillSpecularRadiance${String(index)}`), fill === undefined ? [0, 0, 0] : (fill.specularColor ?? fill.color).map(value => value * (fill.specularIntensity ?? fill.intensity)))
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
      gl.uniform1f(uniformLocation(gl, program, 'shadowEnabled'), 0)
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
      gl.uniform1f(uniformLocation(gl, program, 'shadowEnabled'), 1)
    }
    gl.uniform1f(uniformLocation(gl, program, 'pointSize'), 7)
    gl.uniform1f(uniformLocation(gl, program, 'alphaCutoff'), 0)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)
    gl.depthMask(true)
    gl.uniform1f(uniformLocation(gl, program, 'textured'), 0)
    gl.uniform1f(uniformLocation(gl, program, 'normalTextured'), 0)
    gl.uniform1f(uniformLocation(gl, program, 'secondaryTextured'), 0)
    gl.uniform1f(uniformLocation(gl, program, 'splatTextured'), 0)
    gl.uniform1f(uniformLocation(gl, program, 'alphaCutoff'), 0)
    gl.uniform1f(uniformLocation(gl, program, 'shadowReceiver'), 1)
    drawBatch(resources, program, plan.opaqueTriangles, gl.TRIANGLES)
    for (const item of plan.shadowControlledOpaqueTriangles) {
      gl.uniform1f(uniformLocation(gl, program, 'shadowReceiver'), item.receiveShadows ? 1 : 0)
      drawBatch(resources, program, item, gl.TRIANGLES)
    }
    for (const item of plan.texturedTriangles) {
      gl.uniform1f(
        uniformLocation(gl, program, 'shadowReceiver'),
        item.receiveShadows === false ? 0 : 1,
      )
      drawTexturedBatch(resources, program, item)
    }
    gl.uniform1f(uniformLocation(gl, program, 'shadowReceiver'), 1)
    for (const item of plan.splatTriangles) drawSplatBatch(resources, program, item)
    const sceneLight = worldMaterialLight(plan)
    const materialSceneDraws: Array<{
      scene: WorldWebGlModelMaterialScene
      draw: MaterialDraw
    }> = []
    for (const scene of plan.modelMaterialScenes)
      for (const draw of sceneMaterialDraws(
        scene.primitives,
        scene.materials,
        scene.programs,
        sceneCamera.viewProjection,
        [],
        1,
      ))
        materialSceneDraws.push({ scene, draw })
    const effectDraws = worldModelEffectDraws(plan, sceneCamera)
    // Issue every program this frame needs before the first draw, so they compile in parallel.
    resources.materialDraws.warm([
      ...materialSceneDraws.map(entry => entry.draw),
      ...effectDraws.map(entry => entry.draw),
    ])
    if (materialSceneDraws.length > 0) {
      for (const { draw } of materialSceneDraws)
        if (draw.depthOnly === true || (draw.program !== undefined && materialIsSolid(draw.program)))
          resources.materialDraws.draw(draw, sceneCamera, sceneLight)
      gl.useProgram(program)
      gl.disable(gl.POLYGON_OFFSET_FILL)
    }
    assertNoWebGlError(gl, 'opaque pass')
    gl.uniform1f(uniformLocation(gl, program, 'textured'), 0)
    gl.uniform1f(uniformLocation(gl, program, 'normalTextured'), 0)
    gl.uniform1f(uniformLocation(gl, program, 'secondaryTextured'), 0)
    gl.uniform1f(uniformLocation(gl, program, 'splatTextured'), 0)
    gl.uniform1f(uniformLocation(gl, program, 'shadowReceiver'), 0)
    drawBatch(resources, program, plan.lines, gl.LINES)
    drawBatch(resources, program, plan.points, gl.POINTS)
    assertNoWebGlError(gl, 'overlay pass')
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.depthMask(false)
    const transparentMaterialDraws = [
      ...materialSceneDraws.flatMap(({ scene, draw }) =>
        draw.depthOnly !== true && draw.program !== undefined && !materialIsSolid(draw.program)
          ? [{ scene, draw: { ...draw, program: draw.program } }]
          : [],
      ),
      ...effectDraws,
    ]
    for (const entry of createWorldWebGlCompositeTransparentDrawPlan(
      plan,
      input.camera,
      transparentMaterialDraws,
    )) {
      if (entry.kind === 'material') {
        resources.materialDraws.draw(entry.draw, sceneCamera, sceneLight)
        continue
      }
      const item = entry.draw
      gl.useProgram(program)
      gl.disable(gl.POLYGON_OFFSET_FILL)
      if (shadow !== undefined) {
        gl.activeTexture(gl.TEXTURE7)
        gl.bindTexture(gl.TEXTURE_2D, shadow.texture)
      }
      gl.enable(gl.BLEND)
      gl.depthMask(false)
      gl.blendFunc(gl.SRC_ALPHA, item.blendMode === 'additive' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA)
      gl.uniform1f(uniformLocation(gl, program, 'shadowReceiver'), item.receiveShadows ? 1 : 0)
      if (item.kind === 'textured') {
        drawTexturedBatch(resources, program, item.batch, item.range)
      } else {
        gl.uniform1f(uniformLocation(gl, program, 'textured'), 0)
        gl.uniform1f(uniformLocation(gl, program, 'normalTextured'), 0)
        gl.uniform1f(uniformLocation(gl, program, 'secondaryTextured'), 0)
        gl.uniform1f(uniformLocation(gl, program, 'splatTextured'), 0)
        gl.uniform1f(uniformLocation(gl, program, 'alphaCutoff'), 0)
        drawBatch(resources, program, item.batch, gl.TRIANGLES, item.batch, item.range)
      }
    }
    gl.depthMask(true)
    assertNoWebGlError(gl, 'transparent pass')
    if (resources.toneMapper !== undefined && (plan.light.toneMapping?.ambientOcclusion?.radius ?? 0) > 0 && plan.waterSurfaceDepth.length > 0) {
      // Color blending stays depth-read-only. Afterwards AO needs the visible water plane,
      // not the submerged height field: otherwise its tile creases darken the whole water color.
      gl.disable(gl.BLEND)
      gl.disable(gl.POLYGON_OFFSET_FILL)
      gl.colorMask(false, false, false, false)
      const depthProgram = resources.shadowProgram
      gl.useProgram(depthProgram)
      gl.uniformMatrix4fv(uniformLocation(gl, depthProgram, 'lightViewProjection'), false, sceneCamera.viewProjection)
      bindSentinelTexture2d(resources, 0)
      gl.uniform1i(uniformLocation(gl, depthProgram, 'baseColorMap'), 0)
      try {
        drawShadowPositions(resources, depthProgram, plan.waterSurfaceDepth)
      } finally {
        gl.colorMask(true, true, true, true)
      }
      assertNoWebGlError(gl, 'water surface depth pass')
    }
    if (plan.light.toneMapping !== undefined) resources.toneMapper?.finish(plan.light.toneMapping, sceneCamera.viewProjection)
    assertNoWebGlError(gl, 'postprocess pass')
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
    stats: (): WorldWebGlRendererStats =>
      (() => {
        harvestGpuTimer(resources)
        const cpuP50 = percentile(resources.cpuFrameMilliseconds, 0.5)
        const cpuP95 = percentile(resources.cpuFrameMilliseconds, 0.95)
        const gpuP50 = percentile(resources.gpuFrameMilliseconds, 0.5)
        const gpuP95 = percentile(resources.gpuFrameMilliseconds, 0.95)
        const planP50 = percentile(resources.worldPlanBuildMilliseconds, 0.5)
        const planP95 = percentile(resources.worldPlanBuildMilliseconds, 0.95)
        const seekP50 = percentile(resources.animationSeekMilliseconds, 0.5)
        const seekP95 = percentile(resources.animationSeekMilliseconds, 0.95)
        const geometry = geometryResourceTotals(resources)
        const textures = textureResourceTotals(resources)
        const worldPlanBytesRetained = retainedWorldPlanBytes(resources.lastPlan)
        const shadowTargetBytesRetained =
          resources.shadowTarget === undefined ? 0 : resources.shadowTarget.size ** 2 * 4
        const sentinelBytesRetained = resources.sentinelTexture === undefined ? 0 : 4
        return Object.freeze({
          frames: resources.frames,
          programCompilations:
            resources.programCompilations +
            resources.retiredMaterialProgramCompilations +
            (resources.disposed ? 0 : resources.materialDraws.programCompilations()),
          shadowTargetAllocations: resources.shadowTargetAllocations,
          shadowTargetReuses: resources.shadowTargetReuses,
          worldPlanBuilds: resources.worldPlanBuilds,
          worldPlanReuses: resources.worldPlanReuses,
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
          textureUploads: resources.textureUploads,
          textureCacheHits: resources.textureCacheHits,
          textureDisposals: resources.textureDisposals,
          textureEntries: textures.entries,
          textureBytesRetained: textures.bytes,
          worldPlanBytesRetained,
          shadowTargetBytesRetained,
          // textures.bytes already includes the retained 1x1 sentinel texture.
          knownGpuBytesRetained: geometry.bytes + textures.bytes + shadowTargetBytesRetained + (resources.toneMapper?.bytes() ?? 0),
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

/** Directionals past the key light that the world shader sums (SC2 rigs ship Key, Fill, Back). */
const MAXIMUM_FILL_LIGHTS = 2

/** Bytes sampled per texture for its content key (a checksum, not a full hash). */
const WORLD_TEXTURE_KEY_SAMPLES = 256

const WATER_SURFACE_NORMAL = [0, 1, 0] as const

/** Depth (world units) over which a shoreline reaches the water's own opacity. */
const WATER_SHORE_FADE = 0.04
/**
 * Depth (world units) over which water without a `ColorFallOff` reaches its own colour. Kept long:
 * without the editor's sky reflection, a sea drawn at its own colour reads as flat paint (Amphion's
 * Avernus turned pure green), while a translucent blend over the sea floor matches the editor's teal.
 */
const WATER_COLOR_FALLOFF = 10

/** World units per water clipping bucket, and how far a terrain cell reaches past its corner. */
const WATER_BUCKET_SIZE = 8
const WATER_CELL_MARGIN = 2
