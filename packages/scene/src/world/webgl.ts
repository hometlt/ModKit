import { Box3, OrthographicCamera, Raycaster, Sphere, Vector2, Vector3 } from 'three'
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
  WorldShadowRange,
} from '@modkit/sdk/maps'
import type {
  ModelMaterialRef,
  SceneRendererMaterial,
  SceneRendererPrimitive,
  SceneRendererTexture,
} from '@modkit/sdk'
import type { SceneRendererMaterialContext } from '@modkit/sdk/renderer'
import { boundsOf } from '@modkit/codec-kit/model/bounds'
import { createModelSceneSampler } from '../model/index.js'
import { createUvmEffectSource, type UvmEffectSource } from '../uvm/effect-source.js'
import {
  materialCanInstance,
  materialWebGlDraws,
  type MaterialInstances,
  type MaterialSequenceDraw,
} from '../render/material-webgl.js'
import type { StandardMaterialProgram } from '../materials/index.js'
import { primitiveTint } from '../render/tint.js'
import { materialIsSolid, sceneMaterialDraws, type MaterialDraw } from '../render/material-draws.js'
import {
  createSceneMaterialProgramSampler,
  prepareSceneMaterialPrograms,
  type SceneMaterialProgramSampler,
  type SceneMaterialPrograms,
} from '../render/materials.js'
import { applyTextureFilter } from '../render/texture-filtering.js'
import { uniformLocation } from '../materials/webgl.js'
import { invertMaterialFrame } from '../materials/frame.js'
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
  /** Actual material draw submissions, including shadow passes and retired material leases. */
  readonly materialDrawCalls: number
  readonly shadowTargetAllocations: number
  readonly shadowTargetReuses: number
  readonly worldPlanBuilds: number
  readonly worldPlanReuses: number
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
  /** A cliff piece's surface drawn as terrain where this texture's alpha (its blend mask) is clear. */
  readonly maskTexture?: SceneRendererTexture
  readonly maskTextureCoordinates?: number[]
  /** Which texel channel holds the mask: 0-2 colour, 3 alpha. */
  readonly maskChannel?: number
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
  /**
   * Cliff surfaces drawn as terrain only where this texture's alpha is below one half: SC2 shows the
   * ground through a cliff piece by its terrain blend mask (TerrainAlphaMask), per pixel.
   */
  readonly maskTexture?: SceneRendererTexture
  readonly maskTextureCoordinates?: Float32Array
  /** Which texel channel holds the mask: 0-2 colour, 3 alpha. */
  readonly maskChannel?: number
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
  readonly minimum: readonly [number, number, number]
  readonly maximum: readonly [number, number, number]
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
 */
export function worldModelEffectDraws(
  plan: WorldWebGlPlan,
  camera: WorldWebGlCameraFrame,
): readonly Readonly<{
  scene: WorldWebGlModelMaterialScene
  draw: MaterialDraw & { readonly program: NonNullable<MaterialDraw['program']> }
}>[] {
  const cameraKey = `${camera.viewMatrix.join(',')}|${camera.viewProjection.join(',')}`
  const previous = effectDrawPlans.get(plan)
  if (previous?.cameraKey === cameraKey) return previous.draws
  effectPass += 1
  const draws: Array<{
    scene: WorldWebGlModelMaterialScene
    draw: MaterialDraw & { readonly program: NonNullable<MaterialDraw['program']> }
  }> = []
  for (const effect of plan.modelEffects) {
    // Simulate one full clip before the current phase so plumes are already developed at load.
    // ponytail: cost grows with clip length per instance per frame; cache emitter state per clock.
    const period = effect.source.clipSeconds
    const time = period === undefined || period <= 0 ? effect.time : period + (effect.time % period)
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
      if (frames === undefined)
        effectFrames.set(
          effect.source,
          (frames = {
            pass: effectPass,
            camera: cameraKey,
            current: new Map(),
            previous: new Map(),
          }),
        )
      else if (frames.pass !== effectPass) {
        frames.previous = frames.camera === cameraKey ? frames.current : new Map()
        frames.current = new Map()
        frames.pass = effectPass
        frames.camera = cameraKey
      }
      let cached = frames.current.get(key) ?? frames.previous.get(key)
      if (cached !== undefined) frames.current.set(key, cached)
      else {
        const frame = effect.source.frame(time, effect.materials, localView)
        // Stable program objects keep the GPU leases across frames that reuse this entry.
        const programs = effectMaterialPrograms(frame.materials, effect.textures, {
          ...effect.context,
          time,
          sequenceTime: time,
        })
        frames.current.set(key, (cached = { frame, programs }))
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
          draws.push({ scene, draw: { ...draw, program: draw.program } })
    } catch {
      // An unsupported effect must not stop the map from rendering.
    }
  }
  effectDrawPlans.set(plan, { cameraKey, draws })
  return draws
}

/**
 * Program samplers of effect materials, per material and texture list. An effect source hands out
 * one material object per emitter for all its frames (see createUvmEffectFrame), so each is
 * snapshotted and compiled once and only sampled at each new clock.
 */
const effectProgramSamplers = new WeakMap<
  SceneRendererMaterial,
  WeakMap<readonly SceneRendererTexture[], SceneMaterialProgramSampler>
>()

/** The programs of an effect frame's materials at one moment, as prepareSceneMaterialPrograms. */
function effectMaterialPrograms(
  materials: readonly SceneRendererMaterial[],
  textures: readonly SceneRendererTexture[],
  context: SceneRendererMaterialContext,
): ReadonlyMap<string, SceneMaterialPrograms> {
  const programs = new Map<string, SceneMaterialPrograms>()
  for (const material of materials) {
    let byTextures = effectProgramSamplers.get(material)
    if (byTextures === undefined) effectProgramSamplers.set(material, (byTextures = new WeakMap()))
    let sampler = byTextures.get(textures)
    if (sampler === undefined)
      byTextures.set(
        textures,
        (sampler = createSceneMaterialProgramSampler(
          [material],
          new Map(textures.map(texture => [texture.id, texture])),
        )),
      )
    for (const [id, program] of sampler.sample(context, [])) programs.set(id, program)
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
  return (
    result.animations?.find(clip => clip.name?.toLowerCase() === requested) ??
    result.animations?.find(clip => clip.name?.toLowerCase().startsWith(`${requested} `)) ??
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
    cached.time === time
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
  if (material !== undefined && texture !== undefined) {
    const surface = material
    const target: MutableTexturedBatch = {
      ...batch(),
      textureCoordinates: [],
      ...(secondaryTexture === undefined ? {} : { secondaryTextureCoordinates: [] }),
      texture,
    }
    triangles = target
    push = ground => pushTexturedWaterTriangle(target, ground, elevation, surface, timeSeconds)
  } else {
    const target = batch()
    triangles = target
    push = ground => pushWaterTriangle(target, ground, elevation, material)
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
  const zone = Object.freeze({ texture, secondaryTexture, time, plane, triangles, emitted })
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
    // The material's layer transform: rotate about the centre, then tile and offset.
    transform: (u: number, v: number) => {
      const cu = u - 0.5,
        cv = v - 0.5
      return [
        (cos * cu + sin * cv + 0.5) * tiling[0]! + offset[0]!,
        (-sin * cu + cos * cv + 0.5) * tiling[1]! + offset[1]!,
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
 * Pick entry of a placed primitive: its world bounding box over the vertices it references. With
 * an `owner` and `slot` the bounds are kept for the next plan while the source geometry and the
 * placement matrix stay the same.
 */
function sharedPickPrimitive(
  source: SceneRendererPrimitive,
  primitive: SceneRendererPrimitive,
  owner?: object,
  slot?: string,
): WorldWebGlPickPrimitive {
  const slots = owner === undefined ? undefined : lastPickBounds.get(owner)
  const last = slot === undefined ? undefined : slots?.get(slot)
  if (
    last !== undefined &&
    last.source === source &&
    sameOptionalMatrix(last.transform, primitive.transform)
  )
    return Object.freeze({ primitive, minimum: last.minimum, maximum: last.maximum })
  // Animated instances get new geometry every frame: this loop runs per vertex, so it keeps to
  // locals (the same arithmetic as transformedPrimitiveVertex).
  const referenced = referencedVertexIndices(source)
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
    let known = slots
    if (known === undefined) lastPickBounds.set(owner, (known = new Map()))
    known.set(slot, bounds)
  }
  return Object.freeze({ primitive, minimum: bounds.minimum, maximum: bounds.maximum })
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
    ...(source.specularTextures === undefined
      ? {}
      : { specularTextures: Object.freeze([...source.specularTextures]) }),
    normalSwizzles: Object.freeze([...source.normalSwizzles]),
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
      },
    )
    samplers.set(key, sampler)
  }
  return sampler
}

const staticModelSamples = new WeakMap<WorldModelSample['result'], Map<string, WorldModelSample>>()

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
  const materialContext: SceneRendererMaterialContext = {
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
  }
  return { selectedAnimation, time, teamColor, materialContext }
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
  context: () => SceneRendererMaterialContext,
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
  return [
    resourceId,
    moment.selectedAnimation?.id ?? '',
    moment.teamColor?.join(',') ?? '',
    item.presentationTeamColorIntensity ?? '',
    item.derivedFrom === 'cliffs' ? 'cliffs' : '',
  ].join('\u0000')
}

/** The clocks at which an object samples its clock-following materials, one per model. */
function worldObjectMaterialClock(item: WorldSceneObjectItem, input: WorldWebGlInput): string {
  let clock = ''
  for (const resourceId of worldObjectResourcesOf(item).keyed) {
    const result = input.models?.get(resourceId)
    if (result?.state !== 'converted' || !worldMaterialsFollowTime(result)) continue
    const selected = worldModelAnimation(result, item)
    const time = worldObjectTime(input, item, selected !== undefined, selected?.durationSeconds)
    clock += `${time}\u0000`
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
 * What the programs of kept scenes stand for in one plan (see keptWorldObjectScenes). A kept scene
 * keeps the programs it was built with, and with them its draws, instanced groups and GPU leases;
 * each of its passes stands for the pass of the programs sampled at the plan's clock, whose uniform
 * values it draws with (`passes`, for MaterialSequencePrograms), and its draws group with the draws
 * of those programs as a new scene's would (`materials` and `passes`).
 */
interface WorldCurrentPrograms {
  readonly passes: Map<StandardMaterialProgram, StandardMaterialProgram>
  readonly materials: Map<SceneMaterialPrograms, SceneMaterialPrograms>
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
  // At its own clock a kept scene stands for its own programs.
  const moved = worldObjectMaterialClock(item, input) !== kept.materialClock
  // Objects kept with the same programs mostly stand for the same ones: only new pairs are added.
  let added: [SceneMaterialPrograms, SceneMaterialPrograms][] | undefined
  for (const [index, scene] of kept.scenes.entries()) {
    const resample = kept.resamplers[index]
    if (resample === undefined) continue
    const programs = moved ? resample(input, planPrograms) : scene.programs
    if (programs !== scene.programs && !sameProgramLayout(scene.programs, programs))
      return undefined
    for (const [id, entry] of scene.programs) {
      const now = programs.get(id)!
      const standing = current.materials.get(entry) ?? added?.find(pair => pair[0] === entry)?.[1]
      if (standing === now) continue
      if (standing !== undefined) return undefined
      ;(added ??= []).push([entry, now])
    }
  }
  for (const [entry, now] of added ?? []) {
    current.materials.set(entry, now)
    entry.passes.forEach((pass, index) => current.passes.set(pass, now.passes[index]!))
  }
  return kept.scenes
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

/** What an object added to a plan, and the inputs it was built from. */
interface WorldStaticObject {
  readonly key: readonly unknown[]
  readonly scenes: readonly WorldWebGlModelMaterialScene[]
  /**
   * For an object whose clock reaches only its materials: the moment its scenes' programs were
   * sampled at (worldObjectMaterialClock) and, per scene, how to sample them at another moment.
   */
  readonly materialClock?: string
  readonly resamplers?: readonly (WorldSceneResampler | undefined)[]
  readonly effects: readonly WorldWebGlModelEffectInstance[]
  /** Triangles the object wrote to the plan's shared batches (projector decals, fallback), in order. */
  readonly batchWrites: readonly WorldObjectBatchWrite[]
  readonly pickMesh: WorldObjectPickMesh
  readonly modelTriangles: number
  readonly shadowTriangles: number
}

interface WorldObjectPickMesh {
  readonly objectId: number
  readonly center: readonly [number, number, number]
  readonly triangles: number[]
  readonly primitives: WorldWebGlPickPrimitive[]
  readonly placeholder: boolean
  /** Bounds of its triangles and primitives (min xyz, max xyz); null when it has neither. */
  readonly bounds: readonly number[] | null
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
}

/**
 * A retained object's write and the shared batch it goes to. `target` is the batch as the write's
 * first plan created it: a plan that has no batch under `key` yet adds that one. Shared batches
 * only describe the batch (texture, blending, shadows); their triangles are the writes.
 */
type WorldObjectBatchWrite =
  | { readonly collection: 'opaque'; readonly write: WorldBatchWrite }
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
    ...(template.secondaryTexture === undefined
      ? {}
      : { secondaryTexture: template.secondaryTexture }),
    ...(template.alphaCutoff === undefined ? {} : { alphaCutoff: template.alphaCutoff }),
    ...(template.castShadows === undefined ? {} : { castShadows: template.castShadows }),
    ...(template.receiveShadows === undefined ? {} : { receiveShadows: template.receiveShadows }),
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
      (right as { colorFalloff?: number }).colorFalloff
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
 * Everything an object's contribution depends on: the terrain preparation (cliff lifting, projector
 * ground), its team colour, and each model result with the clock the object samples it at (its
 * geometry, materials, effects and projectors follow only that clock). The selected object
 * (tinted, possibly moved by a preview) is never retained.
 */
function worldStaticObjectKey(
  item: WorldSceneObjectItem,
  input: WorldWebGlInput,
  preparation: unknown,
): readonly unknown[] | undefined {
  if (item.objectId === input.selectedObjectId) return undefined
  const teamColor =
    item.presentationTeamColor ??
    (item.player === undefined ? undefined : input.teamColors?.get(item.player))
  const keyed = worldObjectResourcesOf(item).keyed
  const known = worldStaticObjectKeys.get(item)
  if (
    known !== undefined &&
    known.preparation === preparation &&
    known.teamColor === teamColor &&
    keyed.every((resourceId, index) => input.models?.get(resourceId) === known.results[index])
  )
    return known.key
  const key: unknown[] = [preparation, teamColor?.join(',') ?? '']
  const results: unknown[] = []
  let timed = false
  for (const resourceId of keyed) {
    const result = input.models?.get(resourceId)
    results.push(result)
    key.push(resourceId, result)
    // Materials alone follow the clock through the kept object's resamplers.
    if (result?.state !== 'converted' || !worldObjectFollowsTime(result, item)) continue
    const selected = worldModelAnimation(result, item)
    key.push(worldObjectTime(input, item, selected !== undefined, selected?.durationSeconds))
    timed = true
  }
  if (timed) worldStaticObjectKeys.delete(item)
  else worldStaticObjectKeys.set(item, Object.freeze({ preparation, teamColor, results, key }))
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
  }>
>()

/**
 * Whether more than the materials of a model's contribution to an object follows the object's
 * clock: sampled geometry (keyed TRS or visibility), live effects (simulated at that time) or
 * decals whose projection does. A clip that moves none of these (an empty Stand, a material-only
 * sequence, a still blob shadow) leaves the object's geometry the same at every clock, so it is
 * kept while the map animates; material tracks only have its programs sampled again
 * (keptWorldObjectScenes).
 */
function worldObjectFollowsTime(
  result: WorldModelSample['result'],
  item: WorldSceneObjectItem,
): boolean {
  if (worldModelHasAnimatedGeometry(result, item)) return true
  const source =
    result.uvmBytes === undefined
      ? undefined
      : uvmEffectSource(result.uvmBytes, worldModelAnimation(result, item)?.sequenceIndex)
  return source !== undefined && (source.liveEffects || source.projectionsFollowTime)
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
  if (follows === undefined) {
    follows = false
    const pending: unknown[] = [...(result.materials ?? [])]
    while (pending.length > 0 && !follows) {
      const value = pending.pop()
      if (value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) continue
      if (Array.isArray(value)) {
        pending.push(...value)
        continue
      }
      for (const [key, entry] of Object.entries(value)) {
        if ((key === 'track' || key === 'sequenceTracks') && entry !== undefined && entry !== null) {
          follows = true
          break
        }
        pending.push(entry)
      }
    }
    materialsFollowingTime.set(result, follows)
  }
  return follows
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
  // Match createModelSceneSampler: only keyed TRS and visibility affect sampled primitives.
  // Empty Stand clips and material-only sequences must not invalidate the terrain every frame.
  return (
    (result.nodes?.length ?? 0) > 0 &&
    clip?.kind === 'animation' &&
    clip.channels.some(
      channel =>
        ['translation', 'rotation', 'scale', 'visibility'].includes(channel.kind) &&
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
  /**
   * Per-vertex base offsets of one placed piece, before seams are joined (see `offsetAt`), with the
   * world point each vertex stands on at standard height. Undefined when nothing moves.
   */
  const computeCliffOffsets = <P extends { readonly positions: Float32Array }>(
    primitives: readonly P[],
    instanceTransform: Float32Array,
  ) => {
    if (baseHeight.step === 0) return undefined
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
          specularTextures: rasterDefinitions.map(definition =>
            definition?.specularResourceId === undefined
              ? undefined
              : input.terrainTextures?.get(definition.specularResourceId),
          ),
          normalSwizzles: (rasterDefinitions as readonly MapTerrainMaterialDefinition[]).map(
            definition => (definition.normalEncoding === 'xy-in-alpha-green' ? 1 : 0),
          ),
          weightTextures: rasterWeightTextures as readonly SceneRendererTexture[],
        })
      : undefined
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
          exactRasterSplat.weightTextures
            .map(candidate => candidate.id)
            .join(String.fromCharCode(0)),
        ].join(String.fromCharCode(0))
  const rasterSplatBatch = (
    key = rasterSplatKey!,
    mask?: Readonly<{ texture: SceneRendererTexture; channel: number }>,
  ): MutableSplatBatch => {
    const existing = splat.get(key)
    if (existing !== undefined) return existing
    const target: MutableSplatBatch = {
      ...(mask === undefined
        ? {}
        : { maskTexture: mask.texture, maskTextureCoordinates: [], maskChannel: mask.channel }),
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
              [normal, normal, normal],
              grid.map(([x, y]) => terrainAoAt(x, y)),
            )
            maskTarget.weightTextureCoordinates!.push(
              ...grid.map(point => rasterUv(point[0], point[1])).flat(),
            )
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
          if (normal[1] >= 0.5) raw.push({ vertices: upward, normal })
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
      const color = [1, 1, 1, 1] as const
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
          specularTextures: resolvedSplat.map(layer =>
            layer.definition.specularResourceId === undefined
              ? undefined
              : input.terrainTextures?.get(layer.definition.specularResourceId),
          ),
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
        for (const index of [0, 1] as const) {
          const vertices = tri(quad, index),
            normals = tri(cornerNormals, index)
          for (const corner of [0, 1, 2] as const)
            pushVertex(opaque, vertices[corner], normals[corner], heightColor(vertices[corner][1]))
        }
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

  if (!finitePlan([opaque, lines, points, ...textured.values(), ...splat.values()]))
    throw new TypeError('world WebGL plan contains a non-finite coordinate')
  for (const item of textured.values())
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
    lines: frozenBatch(lines),
    points: frozenBatch(points),
    terrainTriangles: Float32Array.from(terrainPickTriangles),
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
      cliffEdges,
      cliffTriangles,
      gatewaySegments,
    },
  }
}

/**
 * The items of each facet, grouped in one pass per terrain preparation: a plan reuses a preparation
 * only while its items are the same, element by element (see sameWorldStaticInput), and scanning
 * all ~72 000 items once per facet took several milliseconds of every plan.
 */
const worldPreparationFacets = new WeakMap<object, ReadonlyMap<string, readonly WorldSceneItem[]>>()

function worldFacetItems<F extends WorldSceneItem['facet']>(
  preparation: object,
  items: readonly WorldSceneItem[],
  facet: F,
): readonly Extract<WorldSceneItem, { facet: F }>[] {
  let facets = worldPreparationFacets.get(preparation)
  if (facets === undefined) {
    const grouped = new Map<string, WorldSceneItem[]>()
    for (const item of items) {
      const list = grouped.get(item.facet)
      if (list === undefined) grouped.set(item.facet, [item])
      else list.push(item)
    }
    worldPreparationFacets.set(preparation, (facets = grouped))
  }
  return (facets.get(facet) ?? []) as readonly Extract<WorldSceneItem, { facet: F }>[]
}

const worldStaticPreparations = new WeakMap<
  WorldWebGlPlan,
  {
    input: WorldWebGlInput
    preparation: ReturnType<typeof prepareWorldStaticTerrain>
  }
>()

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
): WorldWebGlPlan {
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
    const staticGeometry = !worldModelHasAnimatedGeometry(result, item)
    const staticKey = selected?.id ?? ''
    const previousStatic = staticGeometry
      ? staticModelSamples.get(result)?.get(staticKey)
      : undefined
    if (previousStatic !== undefined) return previousStatic
    const clock = worldObjectTime(input, item, selected !== undefined, selected?.durationSeconds)
    const time =
      selected?.durationSeconds && (item.presentationAnimation?.loop ?? selected.looping)
        ? clock % selected.durationSeconds
        : clock
    const sharedKey = `${resourceId}\u0000${selected?.id ?? ''}\u0000${time}`
    const shared = planSamples.get(sharedKey)
    if (shared !== undefined) return shared
    const clip = selected?.kind === 'animation' ? selected : undefined
    const sample =
      (result.nodes?.length ?? 0) === 0
        ? { primitives: result.primitives, nodeTransforms: new Map<string, Float32Array>() }
        : worldModelSceneSampler(result, clip).sample(time)
    const current = {
      result,
      primitives: sample.primitives,
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
  const preparation =
    previous !== undefined && sameWorldStaticInput(previous.input, input)
      ? previous.preparation
      : prepareWorldStaticTerrain(input, sampleSharedModel)
  const { terrain, liftedCliffPrimitives } = preparation
  const timeSeconds = input.timeSeconds ?? 0
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0)
    throw new TypeError('world WebGL timeSeconds must be finite and nonnegative')
  let waterPolygons = 0
  const waterPlaneBatches = new Map<
    string,
    { readonly batch: MutableBatch; readonly colorFalloff: number; readonly receiveShadows: boolean }
  >()
  for (const item of worldFacetItems(preparation, input.items, 'water')) {
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
    const zone = worldWaterZone(
      preparation,
      material,
      texture,
      secondaryTexture,
      minimum,
      maximum,
      elevation,
      timeSeconds,
    )
    if (zone.plane !== undefined) {
      const key = material?.materialId ?? ''
      const plane = waterPlaneBatches.get(key) ?? {
        batch: batch(),
        colorFalloff: material?.colorFalloff ?? WATER_COLOR_FALLOFF,
        receiveShadows: material?.receiveShadows ?? false,
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
  const waterWrites = [transparent, ...transparentTextured.values()].flatMap(writesOf)
  const waterSurfaceDepth =
    previousBatches !== undefined && sameWrites(previousBatches.water, waterWrites)
      ? previousBatches.waterSurfaceDepth
      : worldWaterSurfaceDepth(waterWrites)

  const objects = worldFacetItems(preparation, input.items, 'objects')
  const projectorGround = preparation.terrainTriangles
  let modelTriangles = 0
  let diagnosticPlaceholders = 0
  const planPrograms: WorldPlanPrograms = new Map()
  const currentPrograms: WorldCurrentPrograms = { passes: new Map(), materials: new Map() }
  const projectorBatch = (texture: MutableTexturedBatch['texture']) => {
    const key = `projector:${texture.id}`
    const target = transparentTextured.get(key) ?? {
      ...batch(),
      textureCoordinates: [],
      texture,
      blendMode: 'blend' as const,
      castShadows: false,
      receiveShadows: false,
    }
    transparentTextured.set(key, target)
    return target
  }
  for (const item of objects) {
    const staticKey = worldStaticObjectKey(item, input, preparation)
    const retainedObject = staticKey === undefined ? undefined : retainedStaticObjects.get(item)
    const keptScenes =
      retainedObject !== undefined && sameWorldStaticObjectKey(retainedObject.key, staticKey!)
        ? keptWorldObjectScenes(item, retainedObject, input, planPrograms, currentPrograms)
        : undefined
    if (retainedObject !== undefined && keptScenes !== undefined) {
      for (const scene of keptScenes) modelMaterialScenes.push(scene)
      for (const effect of retainedObject.effects) modelEffects.push(effect)
      for (const entry of retainedObject.batchWrites) journalObjectWrite(entry)
      objectPickMeshes.push(retainedObject.pickMesh)
      modelTriangles += retainedObject.modelTriangles
      modelMaterialShadowTriangles += retainedObject.shadowTriangles
      continue
    }
    const scenesBefore = modelMaterialScenes.length
    const sceneResamplers = new Map<WorldWebGlModelMaterialScene, WorldSceneResampler>()
    const effectsBefore = modelEffects.length
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
    const { components } = worldObjectResourcesOf(item)
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
      const componentTransform = componentTransforms.get(component.id)
      // A child whose parent model is not loaded cannot be placed: it resolves nothing, so the object
      // keeps its placeholder instead of vanishing.
      if (componentTransform === undefined) continue
      resolved = true
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
      const materialShadowPrimitives: SceneRendererPrimitive[] = []
      const instanceTransform = multiplyComponentTransforms(
        worldObjectTransform(item, translation),
        componentTransform,
      )
      let primitiveIndex = -1
      for (const primitive of primitives) {
        primitiveIndex += 1
        const material = modelMaterialById(presented, primitive.materialId)
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
            ...(objectTint === undefined ? {} : { tint: objectTint }),
          })
          materialPrimitives.push(instancePrimitive)
          if (castsSharedMaterialShadow) materialShadowPrimitives.push(instancePrimitive)
          const count = primitiveTriangleCount(primitive)
          if (count > 0) {
            pickPrimitives.push(
              sharedPickPrimitive(
                primitive,
                instancePrimitive,
                item,
                `${component.id}\u0000${String(primitiveIndex)}`,
              ),
            )
            if (castsSharedMaterialShadow) modelMaterialShadowTriangles += count
            modelTriangles += count
            rendered = true
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
        // As glTF: COLOR_0 × the object's tint (× the texture, in the shader). A primitive with
        // neither texture nor COLOR_0 keeps a stand-in hue per material.
        const factor: WorldColor =
          texture === undefined && primitive.colors === undefined
            ? colorHash(primitive.materialId ?? item.kind)
            : [1, 1, 1, 1]
        const tint = item.presentationTint ?? [1, 1, 1]
        const base: WorldColor = [
          factor[0] * tint[0],
          factor[1] * tint[1],
          factor[2] * tint[2],
          factor[3],
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
        const projected = reuse
          ? kept.projected
          : effectSource.project(time, scene.materials, [
              {
                id: 'world-terrain-receiver',
                topology: 'triangles',
                positions: projectorGround,
                transform: receiverTransform,
              },
            ])
        let projectedPrograms: ReadonlyMap<string, SceneMaterialPrograms> = new Map()
        if (reuse && kept.programs !== undefined) projectedPrograms = kept.programs
        else
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
          const target = projectorBatch(texture)
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
          const key = `projector:${texture.id}`
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
          if (materialsFollowTime) {
            let sampler: SceneMaterialProgramSampler | undefined
            sceneResamplers.set(projectedScene, next => {
              try {
                sampler ??= createSceneMaterialProgramSampler(
                  projected.materials,
                  new Map(scene.textures.map(texture => [texture.id, texture])),
                )
                const { materialContext: context } = worldObjectMaterialMoment(next, item, result)
                return sampler.sample(context, [])
              } catch {
                // As in the build: unsupported projector materials stay apart from the map.
                return new Map()
              }
            })
          }
        }
      }
      // Decals are projected above; only particles and ribbons are drawn per frame from here.
      if (effectSource?.liveEffects === true)
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
      if (materialPrimitives.length > 0) {
        const materialScene = Object.freeze({
          primitives: Object.freeze(materialPrimitives),
          shadowPrimitives: Object.freeze(materialShadowPrimitives),
          materials: scene.materials,
          programs,
          textures: scene.textures,
        })
        modelMaterialScenes.push(materialScene)
        // The presentation (clip, team colour) is in the kept object's key: only the time moves.
        if (materialsFollowTime)
          sceneResamplers.set(
            materialScene,
            (next, nextPrograms) =>
              worldObjectModelPrograms(
                result,
                item,
                templateKey,
                worldObjectTime(
                  next,
                  item,
                  selectedAnimation !== undefined,
                  selectedAnimation?.durationSeconds,
                ),
                () => worldObjectMaterialMoment(next, item, result).materialContext,
                nextPrograms,
              ).programs,
          )
      }
    }
    // A cliff piece whose code ships no mesh (ramp interiors) is the terrain's own slope: nothing to
    // mark.
    if (!rendered && !resolved && item.derivedFrom !== 'cliffs') {
      const selected = item.objectId === input.selectedObjectId
      pushVertex(points, translation, [0, 1, 0], selected ? [1, 0.9, 0.1, 1] : colorHash(item.kind))
      diagnosticPlaceholders += 1
      retainable = false
    }
    lastProjectorWrites.set(item, projectorWrites)
    if (!pickTriangles.every(Number.isFinite))
      throw new TypeError('world WebGL plan contains a non-finite model coordinate')
    const pickMesh: WorldObjectPickMesh = {
      objectId: item.objectId,
      center: translation,
      triangles: pickTriangles,
      primitives: pickPrimitives,
      placeholder: !resolved,
      bounds: pickMeshBoundsOf(pickTriangles, pickPrimitives),
      pick: Object.freeze({
        objectId: item.objectId,
        center: translation,
        triangles: Float32Array.from(pickTriangles),
        primitives: Object.freeze(pickPrimitives),
        placeholder: !resolved,
      }),
    }
    objectPickMeshes.push(pickMesh)
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
              }),
          effects: Object.freeze(modelEffects.slice(effectsBefore)),
          batchWrites: Object.freeze(objectBatchWrites),
          pickMesh,
          modelTriangles: modelTriangles - trianglesBefore,
          shadowTriangles: modelMaterialShadowTriangles - shadowTrianglesBefore,
        }),
      )
  }

  let navigationSamples = 0
  for (const item of worldFacetItems(preparation, input.items, 'navigation')) {
    if (item.flags === 0) continue
    const position =
      item.uvwPosition === undefined
        ? ([item.x, 0, item.y] as const)
        : ([item.uvwPosition.x, item.uvwPosition.y, item.uvwPosition.z] as const)
    pushVertex(points, position, [0, 1, 0], [0.88, 0.15, 0.12, 0.7])
    navigationSamples += 1
  }

  let regionShapes = 0
  for (const item of worldFacetItems(preparation, input.items, 'regions')) {
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
  for (const { bounds } of objectPickMeshes) {
    if (bounds === null) continue
    hasPositions = true
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
  const lighting = worldFacetItems(preparation, input.items, 'lighting')[0]
  const directional = lighting?.directional[0]
  const ambient: readonly [number, number, number] = lighting?.ambientColor ?? [1, 1, 1]
  const direction: readonly [number, number, number] = directional?.direction ?? [-0.45, -1, -0.35]
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
      }),
    ),
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
    transparentTriangles,
    lines: appendWorldBatch(preparation.lines, lines),
    points: appendWorldBatch(preparation.points, points),
    picking: Object.freeze({
      terrainTriangles: projectorGround,
      objects: Object.freeze(objectPickMeshes.map(item => item.pick)),
    }),
    bounds: Object.freeze({ minimum: Object.freeze(minimum), maximum: Object.freeze(maximum) }),
    light: Object.freeze({
      ...(lighting?.toneMapping === undefined ? {} : { toneMapping: lighting.toneMapping }),
      ...(lighting?.terrain === undefined ? {} : { terrain: lighting.terrain }),
      ...(lighting?.shadowRange === undefined ? {} : { shadowRange: lighting.shadowRange }),
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
      terrainTriangles: preparation.stats.terrainTriangles,
      terrainTexturedTriangles: preparation.stats.terrainTexturedTriangles,
      terrainSplatFallbackCells: preparation.stats.terrainSplatFallbackCells,
      waterPolygons,
      cliffEdges: preparation.stats.cliffEdges,
      cliffTriangles: preparation.stats.cliffTriangles,
      objectInstances: objects.length,
      modelTriangles,
      navigationSamples,
      gatewaySegments: preparation.stats.gatewaySegments,
      regionShapes,
      diagnosticPlaceholders,
      shadowCasterTriangles,
      shadowMapSize: 0,
    }),
  })
  worldStaticPreparations.set(plan, { input: snapshotWorldPlanInput(input), preparation })
  if (currentPrograms.materials.size > 0) worldCurrentPrograms.set(plan, currentPrograms)
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
// A cliff surface drawn as terrain: kept only where its blend mask (secondaryColorMap, channel
// picked by the selector) is clear, the complement of the rock's alpha test.
uniform float cliffMaskMode;
uniform vec4 cliffMaskSelector;
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
  // SC2 draws shadows only within its camera's ShadowClip of the eye: fade over the last tenth.
  float reach = shadowRangeDistance > 0.0
    ? distance(worldPosition, shadowRangeEye) / shadowRangeDistance
    : 0.0;
  if (reach >= 1.0) return 1.0;
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
  return mix(visible / 9.0, 1.0, smoothstep(0.9, 1.0, reach));
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
  if (cliffMaskMode > 0.5 && dot(texture(secondaryColorMap, secondaryTextureCoordinate), cliffMaskSelector) >= 0.5)
    discard;
  if (waterDepthMode > 0.5) {
    // The shoreline is where the drawn scene rises through the plane (cliff meshes included), and
    // the colour deepens with the water over whatever lies under the pixel - SC2 water reads the
    // scene depth the same way. Same saturation and shore fade as the per-vertex water colour.
    float sceneDepth = texelFetch(sceneDepthMap, ivec2(gl_FragCoord.xy), 0).r;
    float waterDepth = (sceneDepth - gl_FragCoord.z) * waterDepthScale.x * waterDepthScale.y;
    if (waterDepth <= 0.0) discard;
    float saturation = 1.0 - exp(-waterDepth * waterFalloff);
    surface = vec4(
      vertexColor.rgb * (1.0 - 0.35 * saturation),
      (vertexColor.a + (1.0 - vertexColor.a) * saturation) * min(1.0, waterDepth / waterShoreFade)
    );
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
    // Specular comes from the key light only: SC2 Lighting.fx adds the other directional lights
    // with useSpecular false (their diffuse carries the ambient occlusion instead).
    specular = specColor * terrainLighting.z * lightSpecularRadiance * pow(max(dot(resolvedNormal, normalize(view + key)), 0.0), exponent) * step(0.000001, diffuse) * shadow;
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
  worldPlanDynamicUpdates: number
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
    key = [
      texture.id,
      texture.width,
      texture.height,
      texture.wrapU,
      texture.wrapV,
      texture.filter,
      checksum,
    ].join('|')
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
    ...(input.previewPosition === undefined
      ? {}
      : { previewPosition: { ...input.previewPosition } }),
  }
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
    sameWorldMap(left.teamColors, right.teamColors)
  )
}

function sameWorldPlanInput(left: WorldWebGlInput, right: WorldWebGlInput): boolean {
  // Default model clips and sequence-only material/effect animations also consume this clock.
  return (
    sameWorldPlanInputExceptAnimationTimes(left, right) &&
    sameNumberMap(left.animationTimes, right.animationTimes) &&
    (left.timeSeconds ?? 0) === (right.timeSeconds ?? 0)
  )
}

/**
 * Whether the terrain preparation (`prepareWorldStaticTerrain`) of `left` serves `right`: it reads
 * the items, the terrain materials, textures and weight rasters, and of the models only the cliff
 * pieces (their results, placements and, for animated geometry, clocks). Loading the other models,
 * selecting or recolouring an object keeps it: each model-loading tick re-prepared the whole terrain.
 */
function sameWorldStaticInput(left: WorldWebGlInput, right: WorldWebGlInput): boolean {
  if (
    !sameArrayIdentity(left.items, right.items) ||
    !sameArrayIdentity(left.terrainMaterials, right.terrainMaterials) ||
    !sameArrayIdentity(left.terrainWeightRasters, right.terrainWeightRasters) ||
    !sameWorldMap(left.terrainTextures, right.terrainTextures)
  )
    return false
  for (const item of right.items) {
    if (item.facet !== 'objects' || item.derivedFrom !== 'cliffs' || item.resourceId === undefined)
      continue
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
    return resources.lastPlan
  }
  const previousInput = resources.lastPlanInput
  const animationSeek =
    previousInput !== undefined &&
    sameWorldPlanInputExceptAnimationTimes(previousInput, input) &&
    !sameNumberMap(previousInput.animationTimes, input.animationTimes)
  const previousPreparation =
    resources.lastPlan === undefined
      ? undefined
      : worldStaticPreparations.get(resources.lastPlan)?.preparation
  const startedAt = globalThis.performance?.now() ?? Date.now()
  const plan = createWorldWebGlPlan(input, resources.lastPlan)
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
  resources.lastPlanInput = worldStaticPreparations.get(plan)!.input
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
  // An appended fallback batch owns a new buffer while the static prefix stays cached separately.
  const preparation = worldStaticPreparations.get(plan)?.preparation
  if (preparation !== undefined) {
    retainBatch(preparation.opaqueTriangles)
    retainBatch(preparation.lines)
    retainBatch(preparation.points)
  }
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
      frames: 0,
      programCompilations: 2,
      shadowTargetAllocations: 0,
      shadowTargetReuses: 0,
      worldPlanBuilds: 0,
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
  resources.retiredMaterialDrawCalls += resources.materialDraws.drawCalls()
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
    // The material renderer outlives plans. A lease belongs to one program object and keeps the
    // texture handles of its own texture objects, which stay in use while it draws; sweep drops
    // the leases, programs, vertex arrays and buffers a frame no longer draws. Releasing it on
    // every changed input re-linked all programs and re-uploaded all buffers on each model-loading
    // tick, selection and preview drag.
    resources.materialTextureHandles.clear()
    resources.materialPlan = plan
  }
  const seen = new Set<SceneRendererTexture>()
  for (const scene of [...plan.modelMaterialScenes, ...plan.modelEffects])
    for (const texture of scene.textures) {
      if (seen.has(texture)) continue
      seen.add(texture)
      resources.materialTextureHandles.set(texture, bindTexture2d(resources, texture, 0))
    }
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

  const minimum = new Vector3(...plan.bounds.minimum)
  const maximum = new Vector3(...plan.bounds.maximum)
  const extent = maximum.clone().sub(minimum)
  const view = cameraState(input.camera)
  // Spend the depth map on what the camera sees: the orbit target and the ground footprint of the
  // orthographic view (stretched by a low elevation), plus the world height for casters that lean
  // in. A whole-map map at close zoom turns each texel into a visible block.
  const center = minimum
    .clone()
    .add(maximum)
    .multiplyScalar(0.5)
    .add(new Vector3(...view.target))
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
    gl.uniformMatrix4fv(uniformLocation(gl, program, 'lightViewProjection'), false, viewProjection)
    bindSentinelTexture2d(resources, 0)
    gl.uniform1i(uniformLocation(gl, program, 'baseColorMap'), 0)
    // The terrain casts: its height field climbs every cliff, so it throws the cliff's shadow, and
    // SC2 marks its natural cliff meshes no-shadows-cast for that reason. Without it the beach under
    // a coast was lit between the shadows of the rim doodads. How far shadows reach is the camera's
    // business (light.shadowRange), not the casters'.
    drawShadowPositions(resources, program, plan.opaqueTriangles.positions)
    drawShadowPositions(resources, program, plan.terrainShadowCasters)
    for (const item of plan.shadowControlledOpaqueTriangles) {
      if (item.castShadows) drawShadowPositions(resources, program, item.positions)
    }
    for (const item of plan.texturedTriangles) {
      if (item.castShadows === false) continue
      if ((item.alphaCutoff ?? 0) > 0) drawShadowTextured(resources, program, item)
      else drawShadowPositions(resources, program, item.positions)
    }
    // A cliff surface drawn as terrain casts nothing: the rock program casts for the rock, and a
    // no-shadows-cast material (Shakuras Cliff 0) must not darken the ground through its ground.
    for (const item of plan.splatTriangles)
      if (item.maskTexture === undefined) drawShadowPositions(resources, program, item.positions)
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
      resources.materialDraws.drawSequence(
        worldMaterialBatchesOf(plan, true).sequence,
        sceneCamera,
        sceneLight,
        worldCurrentPrograms.get(plan)?.passes,
      )
      gl.colorMask(false, false, false, false)
    }
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
    const masked = source.maskTexture !== undefined && source.maskTextureCoordinates !== undefined
    if (masked) {
      bindTexture2d(resources, source.maskTexture!, 6)
      gl.uniform1i(uniformLocation(gl, program, 'secondaryColorMap'), 6)
      const selector = [0, 0, 0, 0]
      selector[source.maskChannel ?? 3] = 1
      gl.uniform4fv(uniformLocation(gl, program, 'cliffMaskSelector'), selector)
    }
    gl.uniform1f(uniformLocation(gl, program, 'cliffMaskMode'), masked ? 1 : 0)
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
    if (masked) gl.uniform1f(uniformLocation(gl, program, 'cliffMaskMode'), 0)
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
    // The untextured batch starts with the clipped water; a renderer drawing the planes skips it.
    const first =
      excludeClippedWater && source.kind === 'untextured' ? plan.transparentWaterTriangles * 9 : 0
    for (let offset = first; offset < positions.length; offset += 9) {
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

export type WorldWebGlCompositeTransparentDraw =
  | Readonly<{ kind: 'world'; draw: WorldWebGlTransparentDraw }>
  | Readonly<{
      kind: 'material'
      scene: WorldWebGlModelMaterialScene
      draw: MaterialDraw & { readonly program: NonNullable<MaterialDraw['program']> }
    }>

const boundsCenters = new WeakMap<Float32Array, readonly [number, number, number]>()
const primitiveBounds = new WeakMap<Float32Array, ReturnType<typeof boundsOf>>()

/** Vertex arrays are shared by every instance and immutable for a plan: scan each one once. */
function cachedPrimitiveBounds(positions: Float32Array): ReturnType<typeof boundsOf> {
  let bounds = primitiveBounds.get(positions)
  if (bounds === undefined) primitiveBounds.set(positions, (bounds = boundsOf(positions)))
  return bounds
}

function transparentProjectionDepth(
  positions: Float32Array,
  direction: readonly [number, number, number],
  transform?: Float32Array,
): number {
  let center = boundsCenters.get(positions)
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
  }>[],
  excludeClippedWater = false,
): readonly WorldWebGlCompositeTransparentDraw[] {
  const view = cameraState(requested)
  const worldDraws = createWorldWebGlTransparentDrawPlan(plan, requested, { excludeClippedWater })
  // The world runs are cached per view direction; the same runs and material draws pack the same.
  const key: unknown[] = [worldDraws]
  for (const { draw } of materialDraws)
    key.push(draw.primitive.positions, draw.primitive.transform, draw.program)
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
  const ordered = entries.map(entry => entry.value)
  const draws = packWorldWebGlTransparentDraws(plan, view, worldDraws, ordered)
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

/** Screen box of a transformed primitive: its local bounds' corners projected on the view plane. */
function primitiveScreenBox(
  primitive: SceneRendererPrimitive,
  basis: ReturnType<typeof worldViewPlaneBasis>,
  box: Float64Array,
  offset: number,
): void {
  const { min, max } = cachedPrimitiveBounds(primitive.positions)
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

/**
 * Transparent draws in back-to-front order, packed: see `transparentOrderLevels`. Decals of one
 * batch that alternate in depth with other batches but never overlap them on screen draw as one run,
 * and every pair that does overlap keeps its sorted order, so the blended picture is unchanged.
 * Each world triangle is its own item; material draws never merge.
 */
function packWorldWebGlTransparentDraws(
  plan: WorldWebGlPlan,
  view: ReturnType<typeof cameraState>,
  worldDraws: readonly WorldWebGlTransparentDraw[],
  ordered: readonly WorldWebGlCompositeTransparentDraw[],
): readonly WorldWebGlCompositeTransparentDraw[] {
  const basis = worldViewPlaneBasis(view)
  const triangles = worldTransparentTrianglesOf(worldDraws, basis)
  let materials = 0
  for (const entry of ordered) if (entry.kind === 'material') materials += 1
  const count = triangles.depths.length + materials
  const boxes = new Float64Array(count * 4)
  const batches = new Int32Array(count)
  const itemTriangle = new Int32Array(count).fill(-1)
  const itemEntry: WorldWebGlCompositeTransparentDraw[] = []
  const batchIds = new Map<WorldWebGlBatch, number>()
  let item = 0
  for (const entry of ordered) {
    if (entry.kind === 'material') {
      primitiveScreenBox(entry.draw.primitive, basis, boxes, item * 4)
      batches[item] = -1
      itemEntry[item] = entry
      item += 1
      continue
    }
    const run = triangles.runOf.get(entry.draw)
    if (run === undefined) throw new TypeError('world transparent run is not in its plan')
    let batch = batchIds.get(entry.draw.batch)
    if (batch === undefined) batchIds.set(entry.draw.batch, (batch = batchIds.size))
    for (let triangle = triangles.runStarts[run]!; triangle < triangles.runStarts[run + 1]!; triangle += 1) {
      boxes.set(triangles.boxes.subarray(triangle * 4, triangle * 4 + 4), item * 4)
      batches[item] = batch
      itemTriangle[item] = triangle
      itemEntry[item] = entry
      item += 1
    }
  }
  const extent = Math.hypot(
    plan.bounds.maximum[0] - plan.bounds.minimum[0],
    plan.bounds.maximum[1] - plan.bounds.minimum[1],
    plan.bounds.maximum[2] - plan.bounds.minimum[2],
  )
  // Far above float32 projection error, far below a decal: only near-touching boxes are affected.
  const levels = transparentOrderLevels(boxes, batches, Math.max(1e-4, extent * 1e-5))
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
  const emitted: (WorldWebGlCompositeTransparentDraw | Group)[] = []
  let currentLevel = -1
  let groups = new Map<number, Group>()
  for (const index of order) {
    const level = levels[index]!
    if (level !== currentLevel) {
      currentLevel = level
      groups = new Map()
    }
    const entry = itemEntry[index]!
    const triangle = itemTriangle[index]!
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
    emitted.map(value => {
      if (!('triangles' in value)) return value
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
      return Object.freeze({ kind: 'world', draw: Object.freeze({ ...value.draw, range }) })
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
      : { ...found, program }
    if (!materialCanInstance(program)) {
      draws.push({ key: undefined, geometryKey: undefined, draw })
      continue
    }
    const primitive = draw.primitive
    const bias = primitive.depthBias
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
const lastWorldInstanceMatrices = [
  new Map<string, Readonly<{ transforms: readonly Float32Array[]; matrices: Float32Array }>>(),
  new Map<string, Readonly<{ transforms: readonly Float32Array[]; matrices: Float32Array }>>(),
]

function groupWorldMaterialDraws(plan: WorldWebGlPlan, shadow: boolean): WorldWebGlMaterialBatches {
  const groups = new Map<
    string,
    {
      draw: WorldWebGlMaterialGroup['draw']
      geometryKey: string
      transforms: Float32Array[]
      seen: Set<Float32Array>
    }
  >()
  const singles: MaterialDraw[] = []
  const transparentScenes: WorldWebGlModelMaterialScene[] = []
  const current = worldCurrentPrograms.get(plan)
  for (const scene of plan.modelMaterialScenes) {
    const solid = worldSceneSolidDrawsOf(scene, shadow)
    for (const { key, geometryKey, draw } of solid.draws) {
      if (key === undefined || geometryKey === undefined) {
        singles.push(draw)
        continue
      }
      // A kept scene's draw groups with the draws of the programs it stands for, as a new scene's.
      const pass = current?.passes.get(draw.program)
      const groupKey =
        pass === undefined
          ? key
          : `${worldGroupId(pass)}|${worldGroupId(current!.materials.get(draw.material!))}|${geometryKey}`
      let group = groups.get(groupKey)
      if (group === undefined)
        groups.set(groupKey, (group = { draw, geometryKey, transforms: [], seen: new Set() }))
      const transform = draw.primitive.transform ?? IDENTITY_VIEW_PROJECTION
      // A primitive drawn twice into the same depth (two solid passes) writes it once.
      if (shadow) {
        if (group.seen.has(transform)) continue
        group.seen.add(transform)
      }
      group.transforms.push(transform)
    }
    if (solid.transparent && !shadow) transparentScenes.push(scene)
  }
  const last = lastWorldInstanceMatrices[shadow ? 1 : 0]!
  const kept = new Map<
    string,
    Readonly<{ transforms: readonly Float32Array[]; matrices: Float32Array }>
  >()
  const instanced = [...groups.values()].map(({ draw, geometryKey, transforms }) => {
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
    if (!kept.has(geometryKey)) kept.set(geometryKey, { transforms, matrices: matrices! })
    return Object.freeze({
      draw,
      instances: Object.freeze({ matrices: matrices!, count: transforms.length }),
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
    // The water pass samples the scene depth here; every other draw keeps a compatible 2D texture.
    bindSentinelTexture2d(resources, WATER_SCENE_DEPTH_UNIT)
    gl.uniform1i(uniformLocation(gl, program, 'sceneDepthMap'), WATER_SCENE_DEPTH_UNIT)
    gl.uniform1f(uniformLocation(gl, program, 'waterDepthMode'), 0)
    gl.uniform1f(uniformLocation(gl, program, 'cliffMaskMode'), 0)
    const sceneCamera = createWorldWebGlCameraFrame(plan, canvas.width, canvas.height, input.camera)
    gl.uniform3fv(uniformLocation(gl, program, 'eyePosition'), sceneCamera.eyePosition)
    const terrainLight = plan.light.terrain
    gl.uniform3f(
      uniformLocation(gl, program, 'terrainLighting'),
      terrainLight?.specularExponent ?? 16,
      terrainLight?.diffuseMultiplier ?? 1,
      terrainLight?.specularMultiplier ?? 0,
    )
    gl.uniform1f(
      uniformLocation(gl, program, 'keyUsesVertexAo'),
      plan.light.useAmbientOcclusion === false ? 0 : 1,
    )
    gl.uniform3fv(
      uniformLocation(gl, program, 'lightSpecularRadiance'),
      (plan.light.specularColor ?? plan.light.color).map(
        value => value * (plan.light.specularIntensity ?? plan.light.intensity),
      ),
    )
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
      gl.uniform1f(
        uniformLocation(gl, program, `fillUsesVertexAo${String(index)}`),
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
    const shadowRange = worldShadowRangeEye(plan, canvas.width, canvas.height, input.camera)
    gl.uniform3fv(
      uniformLocation(gl, program, 'shadowRangeEye'),
      Float32Array.from(shadowRange?.eye ?? [0, 0, 0]),
    )
    gl.uniform1f(uniformLocation(gl, program, 'shadowRangeDistance'), shadowRange?.distance ?? 0)
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
    const batches = worldMaterialBatchesOf(plan)
    // Blended passes keep the per-frame back-to-front order of their scene.
    const transparentSceneDraws: Array<{
      scene: WorldWebGlModelMaterialScene
      draw: MaterialDraw & { readonly program: NonNullable<MaterialDraw['program']> }
    }> = []
    for (const scene of batches.transparentScenes)
      for (const draw of sceneMaterialDraws(
        scene.primitives,
        scene.materials,
        scene.programs,
        sceneCamera.viewProjection,
        [],
        1,
      ))
        if (draw.depthOnly !== true && draw.program !== undefined && !materialIsSolid(draw.program))
          transparentSceneDraws.push({ scene, draw: { ...draw, program: draw.program } })
    const effectDraws = worldModelEffectDraws(plan, sceneCamera)
    // Issue every program this frame needs before the first draw, so they compile in parallel.
    resources.materialDraws.warm([
      ...batches.groups.map(group => group.draw),
      ...batches.singles,
      ...transparentSceneDraws.map(entry => entry.draw),
      ...effectDraws.map(entry => entry.draw),
    ])
    if (batches.sequence.length > 0) {
      resources.materialDraws.drawSequence(
        batches.sequence,
        sceneCamera,
        sceneLight,
        worldCurrentPrograms.get(plan)?.passes,
      )
      gl.useProgram(program)
      gl.disable(gl.POLYGON_OFFSET_FILL)
    }
    assertNoWebGlError(resources, 'opaque pass')
    gl.uniform1f(uniformLocation(gl, program, 'textured'), 0)
    gl.uniform1f(uniformLocation(gl, program, 'normalTextured'), 0)
    gl.uniform1f(uniformLocation(gl, program, 'secondaryTextured'), 0)
    gl.uniform1f(uniformLocation(gl, program, 'splatTextured'), 0)
    gl.uniform1f(uniformLocation(gl, program, 'shadowReceiver'), 0)
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
      gl.uniform1f(uniformLocation(gl, program, 'waterShoreFade'), WATER_SHORE_FADE)
      gl.uniform1f(uniformLocation(gl, program, 'waterDepthMode'), 1)
      gl.uniform1f(uniformLocation(gl, program, 'textured'), 0)
      gl.uniform1f(uniformLocation(gl, program, 'normalTextured'), 0)
      gl.uniform1f(uniformLocation(gl, program, 'secondaryTextured'), 0)
      gl.uniform1f(uniformLocation(gl, program, 'splatTextured'), 0)
      gl.uniform1f(uniformLocation(gl, program, 'alphaCutoff'), 0)
      gl.disable(gl.POLYGON_OFFSET_FILL)
      for (const plane of plan.waterPlanes) {
        gl.uniform1f(uniformLocation(gl, program, 'waterFalloff'), plane.colorFalloff)
        gl.uniform1f(uniformLocation(gl, program, 'shadowReceiver'), plane.receiveShadows ? 1 : 0)
        drawBatch(resources, program, plane.batch, gl.TRIANGLES)
      }
      gl.uniform1f(uniformLocation(gl, program, 'waterDepthMode'), 0)
      assertNoWebGlError(resources, 'water pass')
    }
    const transparentMaterialDraws = [...transparentSceneDraws, ...effectDraws]
    const transparentEntries = createWorldWebGlCompositeTransparentDrawPlan(
      plan,
      input.camera,
      transparentMaterialDraws,
      waterByDepth,
    )
    for (let index = 0; index < transparentEntries.length; index++) {
      const entry = transparentEntries[index]!
      if (entry.kind === 'material') {
        // Consecutive material draws run as one sequence of the material renderer.
        const run: MaterialSequenceDraw[] = []
        for (let next = index; next < transparentEntries.length; next++) {
          const candidate = transparentEntries[next]!
          if (candidate.kind !== 'material') break
          for (const draw of worldBlendedMaterialPasses(candidate.draw)) run.push({ draw })
          index = next
        }
        resources.materialDraws.drawSequence(
          run,
          sceneCamera,
          sceneLight,
          worldCurrentPrograms.get(plan)?.passes,
        )
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
      gl.uniform1i(uniformLocation(gl, depthProgram, 'baseColorMap'), 0)
      try {
        // Depth-tested: a plane writes only where the water lies over the drawn scene.
        for (const positions of waterSurfaces) drawShadowPositions(resources, depthProgram, positions)
      } finally {
        gl.colorMask(true, true, true, true)
      }
      assertNoWebGlError(resources, 'water surface depth pass')
    }
    if (plan.light.toneMapping !== undefined)
      resources.toneMapper?.finish(plan.light.toneMapping, sceneCamera.viewProjection)
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
      return pickWorldWebGlPlan(retainedWorldPlan(input, resources), input, screen)
    },
    stats: (): WorldWebGlRendererStats =>
      (() => {
        harvestGpuTimer(resources)
        const cpuP50 = percentile(resources.cpuFrameMilliseconds, 0.5)
        const cpuP95 = percentile(resources.cpuFrameMilliseconds, 0.95)
        const gpuP50 = percentile(resources.gpuFrameMilliseconds, 0.5)
        const gpuP95 = percentile(resources.gpuFrameMilliseconds, 0.95)
        const planP50 = percentile(resources.worldPlanBuildMilliseconds, 0.5)
        const planP95 = percentile(resources.worldPlanBuildMilliseconds, 0.95)
        const dynamicP50 = percentile(resources.worldPlanDynamicUpdateMilliseconds, 0.5)
        const dynamicP95 = percentile(resources.worldPlanDynamicUpdateMilliseconds, 0.95)
        const seekP50 = percentile(resources.animationSeekMilliseconds, 0.5)
        const seekP95 = percentile(resources.animationSeekMilliseconds, 0.95)
        const geometry = geometryResourceTotals(resources)
        const textures = textureResourceTotals(resources)
        const material = resources.disposed
          ? { bufferEntries: 0, bufferBytesRetained: 0, vertexArrayEntries: 0 }
          : resources.materialDraws.stats()
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
          materialDrawCalls:
            resources.retiredMaterialDrawCalls +
            (resources.disposed ? 0 : resources.materialDraws.drawCalls()),
          shadowTargetAllocations: resources.shadowTargetAllocations,
          shadowTargetReuses: resources.shadowTargetReuses,
          worldPlanBuilds: resources.worldPlanBuilds,
          worldPlanReuses: resources.worldPlanReuses,
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

/** Directionals past the key light that the world shader sums (SC2 rigs ship Key, Fill, Back). */
const MAXIMUM_FILL_LIGHTS = 2

/** Bytes sampled per texture for its content key (a checksum, not a full hash). */
const WORLD_TEXTURE_KEY_SAMPLES = 256

const WATER_SURFACE_NORMAL = [0, 1, 0] as const
/** Texture unit of the scene depth copy the water pass reads (units 0-8 hold the terrain and shadow). */
const WATER_SCENE_DEPTH_UNIT = 9
/** Water colour and opacity at depth zero when a material states none. */
const WATER_DEFAULT_COLOR = [0.12, 0.52, 0.82, 0.48] as const

/** Depth (world units) over which a shoreline reaches the water's own opacity. */
const WATER_SHORE_FADE = 0.04
/** `ColorFallOff` of the stock CWater templates: saturation rate per unit of water depth. */
const WATER_COLOR_FALLOFF = 0.1

/** World units per water clipping bucket, and how far a terrain cell reaches past its corner. */
const WATER_BUCKET_SIZE = 8
const WATER_CELL_MARGIN = 2
