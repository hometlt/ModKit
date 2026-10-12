import { readUvmPoseSamples } from './pose-samples.js'
import { composeModelParticles, type ModelParticleInstance } from './model-particles.js'
import { readUvmSceneLights } from './lights.js'
import { readUvmBillboards } from './billboards.js'
import { readUvmModelStates } from './model-states.js'
import { readUvmShadowMeshBindings } from './shadow-meshes.js'
import { billboardCameraRotation } from '../model/billboards.js'
import type { EffectParticleCollisionProvider } from '@modkit/codec-kit/model-math/effects-sim'
import { createUvmProjectorFrame } from './projectors.js'
import { resolveUvmCamera } from './cameras.js'
import { diagnostic, type Diagnostic } from '@modkit/core'
import type {
  ContractResolverPort,
  JsonValue,
  ResourceBudget,
  RasterResourcePort,
  ModelResourcePort,
} from '@modkit/sdk'
import {
  SCENE_RENDERER_CONTRACT,
  type SceneRenderFrame,
  type SceneRenderRequest,
  type SceneRendererDiagnostic,
  type SceneRendererMaterial,
  type SceneRendererTexture,
  type SceneRendererMaterialContext,
} from '@modkit/sdk/renderer'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { createModelAnimationSampler } from '@modkit/codec-kit/model/animation'
import { readUvmContainer } from '@modkit/uv/model/container'
import { readUvmAnimationClips, readUvmPrimitiveVisibility } from '@modkit/uv/model/animation-clips'
import {
  readUvmTextureAlpha,
  readUvmTextureColorKeys,
  validateUvmDocument,
} from '@modkit/uv/model/validation'
import { applyColorKeyTransparency } from '@modkit/codec-kit/raster'
import { createModelSceneSampler } from '../model/sampler.js'
import { encodeRgbaPng } from '../output/png.js'
import { readUvmModel } from './model.js'
import { createUvmCollisionOverlay } from './collision-overlay.js'
import { createUvmEffectFrame } from './effects.js'
import {
  opaqueTexels,
  prepareUvmImages,
  prepareUvmTextureImages,
  uvmImageResourceId,
  uvmImageFilters,
  uvmImageTexels,
  type UvmImage,
} from './images.js'
import { array, field, finiteArray, object, safeIndex, vector4 } from './values.js'
import {
  uvmMaterialBlendEffect,
  uvmMaterialDrawOrder,
  uvmMaterialPbr,
  uvmMaterialShader,
  uvmMaterialTeamColor,
  uvmProgramTeamColor,
  uvmProgramWithoutLayers,
  uvmMaterialResources,
  acquireUvmMaterialTextures,
} from './materials.js'
import { snapshotEnvironment } from '../materials/environment.js'
import { RENDER_MATERIAL_SHADER } from '../materials/render-model.js'

/** What preparing a frame takes: everything `renderUvm` does but the renderer. */
export interface UvmFrameOptions {
  readonly modelResources?: ModelResourcePort
  /** Trusted collision callback in UV_game_effects simulation space; never supplied by JSON. */
  readonly effectCollisionProvider?: EffectParticleCollisionProvider
  readonly budget: ResourceBudget
  /** Decoded texels keyed by UVM texture index. UVM owns sampler modes; supplied wrap modes are ignored. */
  readonly textures?: ReadonlyMap<number, SceneRendererTexture>
  readonly rasterResources?: RasterResourcePort
  readonly signal?: AbortSignal
}

export interface UvmRenderOptions extends UvmFrameOptions {
  readonly contracts: ContractResolverPort
}

/** Read a UVM frame, then invoke the selected standard scene renderer. The request is inert JSON:
 * {schemaVersion:1, viewport:{width,height}, camera:{viewProjection:[16 numbers],viewMatrix?,eyePosition?},
 *  sceneIndex?, modelState?, clipId?, time?, poseSamples?:[{clipId,time,weight,additive?}], materialContext?:{teamColor?,teamColorIntensity?,ambient?,environment?}, collisions?, shadows?, clearColor?, rendererId?, lighting?:'unlit'|'material'}.
 * `lighting: 'material'` shades glTF materials with their own metallic-roughness (`pbr`); KHR_materials_unlit stays unlit.
 * A `clipId` is the `id` of a clip in `UV_game_animation_clips` or the publisher's own id it keeps as
 * `sourceId`, or `animation-<index>` of a glTF animation when the document has no clip catalog;
 * `time` is seconds.
 * Native extras are never interpreted here. Unsupported material/effect rendering is reported.
 */
export interface PreparedUvmRender {
  readonly request: SceneRenderRequest
  readonly diagnostics: readonly SceneRendererDiagnostic[]
  readonly rendererId?: string
  /**
   * `UV_units.metersPerSourceUnit` of the document, 1 without it: the frame is in metres under one
   * `uv:units` scale node, so a viewer that draws in source units divides by it (and multiplies
   * its camera into the frame's space).
   */
  readonly metersPerSourceUnit: number
  /**
   * The primitives of `request.scene` that are effects, not the model's meshes: particles,
   * ribbons, projector decals and model particles.
   */
  readonly effectPrimitiveIds: readonly string[]
}

/**
 * The scene request `renderUvm` hands its renderer, for a viewer that draws frames itself (the VS
 * Code model viewer): the same JSON request, sampled at its camera, clip and time, with effects,
 * model states, model particles (through `modelResources`) and textures (`textures`,
 * `rasterResources`), and the diagnostics of what will not render.
 */
export function prepareUvmRender(
  bytes: Uint8Array,
  value: JsonValue,
  options: UvmFrameOptions,
): Promise<PreparedUvmRender> {
  return prepareNestedUvmRender(bytes, value, options, 0)
}

export interface UvmFramePreparer {
  /** {@link prepareUvmRender} for this document; `signal` replaces the options' one for a call. */
  prepare(request: JsonValue, signal?: AbortSignal): Promise<PreparedUvmRender>
  /** Forgets the parsed document; later calls refuse. */
  dispose(): void
}

/**
 * {@link prepareUvmRender} for many frames of one document (a viewer turning its camera): the
 * container is read and validated once and the decoded geometry is kept while the frame's stage
 * budget stays the same (a resize changes it). Effects are still simulated per frame.
 */
export function createUvmFramePreparer(
  bytes: Uint8Array,
  options: UvmFrameOptions,
): UvmFramePreparer {
  const owned = bytes.slice()
  let cache: UvmParseCache | undefined = {}
  return Object.freeze({
    prepare(request: JsonValue, signal?: AbortSignal) {
      if (cache === undefined)
        return Promise.reject(new TypeError('the frame preparer is disposed'))
      return prepareNestedUvmRender(
        owned,
        request,
        signal === undefined ? options : { ...options, signal },
        0,
        cache,
      )
    },
    dispose() {
      cache = undefined
    },
  })
}

/** What {@link createUvmFramePreparer} keeps between frames. */
interface UvmParseCache {
  container?: { readonly document: UvmJsonDocument; readonly binary: Uint8Array }
  model?: { readonly stageBytes: number; readonly decoded: ReturnType<typeof readUvmModel> }
}
type UvmJsonDocument = ReturnType<typeof readUvmContainer>['document']

/** {@link prepareUvmRender} at a nesting depth: model states and particles prepare their models. */
async function prepareNestedUvmRender(
  bytes: Uint8Array,
  value: JsonValue,
  options: UvmFrameOptions,
  depth: number,
  cache?: UvmParseCache,
): Promise<PreparedUvmRender> {
  const { budget, signal, rasterResources } = options
  signal?.throwIfAborted()
  for (const limit of [
    budget.maxDepth,
    budget.maxNodes,
    budget.maxScalarBytes,
    budget.maxDiagnostics,
  ])
    if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('invalid UVM render budget')
  const input = object(
    snapshotJson(
      value,
      { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxScalarBytes },
      signal,
    ),
    'render request',
  )
  if (
    input['schemaVersion'] !== 1 ||
    Object.keys(input).some(
      key =>
        ![
          'schemaVersion',
          'viewport',
          'camera',
          'clipId',
          'poseSamples',
          'time',
          'collisions',
          'shadows',
          'clearColor',
          'rendererId',
          'sceneIndex',
          'modelState',
          'materialContext',
          'lighting',
        ].includes(key),
    )
  )
    throw new TypeError('unsupported UVM render request')
  const viewport = object(input['viewport'], 'render viewport')
  const camera = object(input['camera'], 'render camera')
  const width = viewport['width'],
    height = viewport['height']
  if (
    Object.keys(viewport).some(key => !['width', 'height'].includes(key)) ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 4096 ||
    height > 4096
  )
    throw new TypeError('UVM render dimensions must be integers in 1..4096')
  // `material`: glTF materials take their own light (pbr); `unlit` (the default) draws them flat
  const lighting = input['lighting'] ?? 'unlit'
  if (lighting !== 'unlit' && lighting !== 'material')
    throw new TypeError('UVM render lighting must be unlit or material')
  const materialInput = object(input['materialContext'] ?? {}, 'material context')
  const environment = snapshotEnvironment(materialInput['environment'])
  if (
    Object.keys(materialInput).some(
      key => !['teamColor', 'teamColorIntensity', 'ambient', 'environment'].includes(key),
    )
  )
    throw new TypeError('invalid material context field')
  const team = materialInput['teamColor'],
    teamIntensity = materialInput['teamColorIntensity'],
    ambient = materialInput['ambient']
  if (teamIntensity !== undefined && teamIntensity !== 0 && teamIntensity !== 1)
    throw new TypeError('team color intensity must be 0 or 1')
  if (team !== undefined && (!finiteArray(team, 3) || team.some(value => value < 0 || value > 1)))
    throw new TypeError('team color must contain three components in 0..1')
  if (
    ambient !== undefined &&
    (!finiteArray(ambient, 4) || ambient.some(value => value < 0 || value > 1))
  )
    throw new TypeError('material ambient must contain four components in 0..1')
  const time = input['time'] ?? 0,
    clipId = input['clipId'],
    rendererId = input['rendererId'],
    modelState = input['modelState'] ?? 'base'
  if (
    typeof time !== 'number' ||
    !Number.isFinite(time) ||
    time < 0 ||
    (clipId !== undefined && (typeof clipId !== 'string' || !clipId)) ||
    (rendererId !== undefined && (typeof rendererId !== 'string' || !rendererId)) ||
    typeof modelState !== 'string' ||
    modelState.length === 0 ||
    (input['collisions'] !== undefined && typeof input['collisions'] !== 'boolean') ||
    (input['shadows'] !== undefined && typeof input['shadows'] !== 'boolean')
  )
    throw new TypeError('invalid render time, clip, renderer or collision option')
  const clearColor = input['clearColor'] === undefined ? undefined : vector4(input['clearColor'])
  if (clearColor?.some(component => component < 0 || component > 1))
    throw new RangeError('render clearColor must be in 0..1')
  // Reserve separate bounded portions for decoded inputs, sampler copies, overlays and frame/PNG.
  const frameBytes = width * height * 12
  let textureBytes = 0
  const textures = new Map<number, SceneRendererTexture>()
  for (const [index, texture] of options.textures ?? []) {
    signal?.throwIfAborted()
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      !Number.isSafeInteger(texture.width) ||
      !Number.isSafeInteger(texture.height) ||
      texture.width <= 0 ||
      texture.height <= 0 ||
      !(texture.rgba instanceof Uint8Array) ||
      texture.rgba.length !== texture.width * texture.height * 4
    )
      throw new TypeError('invalid decoded UVM render texture')
    textureBytes += texture.rgba.length
    if (frameBytes + textureBytes > budget.maxScalarBytes)
      throw new RangeError('render textures exceed budget')
    textures.set(index, { ...texture, id: `uvm-texture-${index}`, rgba: texture.rgba.slice() })
  }
  const available = budget.maxScalarBytes - frameBytes - textureBytes
  if (available < 0) throw new RangeError('render frame exceeds maxScalarBytes')
  const parsed =
    cache?.container ??
    (() => {
      const container = readUvmContainer(
        bytes,
        {
          maxInputBytes: Number(
            budget.maxInputBytes > 0xffffffffn ? 0xffffffffn : budget.maxInputBytes,
          ),
          maxJsonBytes: budget.maxScalarBytes,
          maxDepth: budget.maxDepth,
          maxNodes: budget.maxNodes,
        },
        signal,
      )
      validateUvmDocument(container.document, {
        binaryByteLength: container.binary.length,
        ...(signal === undefined ? {} : { signal }),
      })
      const read = { document: container.document, binary: container.binary }
      if (cache !== undefined) cache.container = read
      return read
    })()
  const { document, binary } = parsed
  const units = field(document['extensions'], 'UV_units')
  const metersPerSourceUnit = units === undefined ? 1 : field(units, 'metersPerSourceUnit')
  if (
    typeof metersPerSourceUnit !== 'number' ||
    !Number.isFinite(metersPerSourceUnit) ||
    metersPerSourceUnit <= 0
  )
    throw new TypeError('UV_units.metersPerSourceUnit must be a positive finite number')
  const effectPrimitiveIds: string[] = []
  const modelStates = readUvmModelStates(document, budget.maxScalarBytes, signal)
  const selectedModelState =
    modelState === 'base'
      ? undefined
      : modelStates.find(candidate => candidate.state === modelState)
  const textureDeclarations = array(document, 'textures')
  const effectDeclarations = field(document['extensions'], 'UV_game_effects')
  const hasEffectTextures = ['particles', 'ribbons'].some(kind =>
    array(effectDeclarations, kind).some(
      emitter => typeof field(emitter, 'texturePath') === 'string',
    ),
  )
  const hasNestedModels =
    selectedModelState !== undefined ||
    array(field(document['extensions'], 'UV_game_effects'), 'particles').some(
      emitter =>
        Array.isArray(field(emitter, 'modelPaths')) &&
        (field(emitter, 'modelPaths') as unknown[]).length > 0,
    )
  const nestedBudget =
    options.modelResources !== undefined && hasNestedModels ? Math.floor(available / 4) : 0
  const sceneAvailable = available - nestedBudget
  const rasterBudget =
    rasterResources === undefined ||
    (textureDeclarations.length === 0 &&
      !hasEffectTextures &&
      // A material states its textures either as a game material or as the neutral layer list
      // every model facet writes; both need the raster budget, and neither is a glTF texture.
      !array(document, 'materials').some(
        material => uvmMaterialShader(object(material, 'material')) !== undefined,
      ))
      ? 0
      : Math.floor(sceneAvailable / 3)
  const stageBytes = Math.floor((sceneAvailable - rasterBudget) / 4)
  const samplers = array(document, 'samplers')
  const samplerDiagnostics: SceneRendererDiagnostic[] = []
  const samplerByIndex = new Map<number, Pick<SceneRendererTexture, 'wrapU' | 'wrapV' | 'filter'>>()
  const textureSampler = (index: number) => {
    const existing = samplerByIndex.get(index)
    if (existing !== undefined) return existing
    const texture = object(
      textureDeclarations[safeIndex(index, textureDeclarations.length, 'decoded texture')],
      'texture',
    )
    const sampler =
      texture['sampler'] === undefined
        ? {}
        : object(samplers[safeIndex(texture['sampler'], samplers.length, 'sampler')], 'sampler')
    const wrap = (axis: 'wrapS' | 'wrapT'): 'repeat' | 'clamp' => {
      const mode = sampler[axis] ?? 10497
      if (mode === 10497) return 'repeat'
      if (mode === 33071) return 'clamp'
      throw new TypeError(
        `texture ${index} ${axis} mode ${String(mode)} is not supported by the scene renderer`,
      )
    }
    // glTF NEAREST (9728) / LINEAR (9729) magnification is the scene's first-surface filter
    const magnified = sampler['magFilter']
    const filter: SceneRendererTexture['filter'] =
      magnified === 9728 ? 'nearest' : magnified === 9729 ? 'linear' : undefined
    const settings = {
      wrapU: wrap('wrapS'),
      wrapV: wrap('wrapT'),
      ...(filter === undefined ? {} : { filter }),
    }
    if (magnified !== undefined && filter === undefined)
      samplerDiagnostics.push({
        severity: 'warning',
        code: 'common.uvm/texture-filter-unrendered',
        message: `Texture ${index} requests an explicit filter; the current scene contract leaves filtering to the renderer provider.`,
      })
    samplerByIndex.set(index, settings)
    return settings
  }
  /*
   * A texture's colour key (UV_texture_color_key, SPEC_UVM §11.6): its texels of that stored colour
   * become transparent black before anything samples them, as the game's loader made them. A texture
   * whose stored alpha the game ignores (UV_texture_alpha) is opaque first.
   */
  const colorKeys = readUvmTextureColorKeys(document, signal)
  const alphaPolicies = readUvmTextureAlpha(document, signal)
  const keyed = <
    T extends { readonly width: number; readonly height: number; readonly rgba: Uint8Array },
  >(
    index: number,
    stored: T,
  ): T => {
    const texels =
      alphaPolicies.get(index) === true ? { ...stored, rgba: opaqueTexels(stored.rgba) } : stored
    const key = colorKeys.get(index)
    if (key === undefined) return texels
    const [r, g, b] = key.color
    return {
      ...texels,
      rgba: applyColorKeyTransparency(
        { width: texels.width, height: texels.height, pixels: texels.rgba },
        { target: { r, g, b }, tolerance: key.tolerance },
      ).pixels,
    }
  }
  for (const [index, texels] of textures)
    textures.set(index, { ...keyed(index, texels), ...textureSampler(index) })
  const decoded =
    cache?.model?.stageBytes === stageBytes
      ? cache.model.decoded
      : readUvmModel(document, binary, { maxScalarBytes: stageBytes }, signal)
  if (cache !== undefined) cache.model = { stageBytes, decoded }
  const { scene, rig } = decoded
  const scenes = array(document, 'scenes')
  const selected =
    scenes.length === 0 && input['sceneIndex'] === undefined
      ? undefined
      : object(
          scenes[safeIndex(input['sceneIndex'] ?? document['scene'] ?? 0, scenes.length, 'scene')],
          'scene',
        )
  const activeNodes = new Set<string>()
  const allNodes = array(document, 'nodes')
  const pending = [...array(selected, 'nodes')]
  while (pending.length > 0) {
    signal?.throwIfAborted()
    const index = safeIndex(pending.pop(), allNodes.length, 'scene node')
    const id = `node-${index}`
    if (activeNodes.has(id)) continue
    activeNodes.add(id)
    pending.push(...array(allNodes[index], 'children'))
  }
  const activeMeshes = new Set(
    scene.nodes.filter(node => activeNodes.has(node.id)).flatMap(node => node.meshIds),
  )
  const meshes = scene.meshes.filter(mesh => activeMeshes.has(mesh.id))
  const activePrimitives = new Set(meshes.flatMap(mesh => mesh.primitiveIds))
  // the publisher's clip id (the catalog's sourceId) names the clip as its catalog id does
  const catalogIds = new Map(
    (readUvmAnimationClips(document, signal) ?? []).flatMap(entry =>
      entry.sourceId === undefined ? [] : [[entry.sourceId, entry.id] as const],
    ),
  )
  const clipOf = (id: string) =>
    rig.clips.find(candidate => candidate.id === id) ??
    rig.clips.find(candidate => candidate.id === catalogIds.get(id))
  const clip = clipId === undefined ? undefined : clipOf(clipId)
  if (clipId !== undefined && clip === undefined)
    throw new TypeError(`unknown UVM animation clip: ${clipId}`)
  const requestedPoses = input['poseSamples']
  const poseSamples = readUvmPoseSamples(
    Array.isArray(requestedPoses)
      ? requestedPoses.map(sample => {
          const id = field(sample, 'clipId')
          const canonical = typeof id === 'string' ? clipOf(id)?.id : undefined
          return canonical === undefined || canonical === id
            ? sample
            : { ...object(sample, 'pose sample'), clipId: canonical }
        })
      : requestedPoses,
    rig.clips,
  )
  const visible = new Map<string, boolean>(
    readUvmPrimitiveVisibility(document, signal).map(
      item =>
        [
          'node' in item ? `node-${item.node}` : `mesh-${item.mesh}-primitive-${item.primitive}`,
          item.value > 0,
        ] as const,
    ),
  )
  const visibilityChannels = clip?.channels.filter(channel => channel.kind === 'visibility') ?? []
  if (clip !== undefined && visibilityChannels.length > 0) {
    const visibilitySampler = createModelAnimationSampler(
      { ...clip, channels: visibilityChannels },
      { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: stageBytes },
      signal,
    )
    for (const sampled of visibilitySampler.sample(time, signal))
      visible.set(sampled.target, (sampled.value[0] ?? 0) > 0)
  }
  const sequence = clip?.sequenceIndex
  if (
    sequence !== undefined &&
    (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0)
  )
    throw new TypeError('invalid material source sequence index')
  // Preview lighting: ambient lights the diffuse color on every face (scene lighting), plus a key
  // light from above and behind the viewer. The viewer-headlight model with 0.02 ambient left every
  // face turned from the light black.
  const materialContext: SceneRendererMaterialContext = {
    sceneLighting: true,
    time,
    sequenceTime: time,
    ...(sequence === undefined ? {} : { sequenceIndex: sequence }),
    ...(team === undefined ? {} : { teamColor: [team[0] ?? 0, team[1] ?? 0, team[2] ?? 0] }),
    ...(teamIntensity === undefined ? {} : { teamColorIntensity: teamIntensity }),
    ...(ambient === undefined ? {} : { ambient: vector4(ambient) }),
    ...(environment === undefined ? {} : { environment }),
  }
  const cameraPose =
    camera['node'] === undefined
      ? new Map<string, Float32Array>()
      : createModelSceneSampler(
          {
            nodes: scene.nodes.map(node => ({ ...node, meshIds: [] })),
            meshes: [],
            primitives: [],
            skeleton: rig.bindings,
            nodePoses: rig.nodePoses,
          },
          {
            maxBytes: stageBytes,
            ...(poseSamples === undefined ? {} : { poseSamples, poseTime: time }),
            ...(clip === undefined
              ? {}
              : {
                  clip: {
                    ...clip,
                    channels: clip.channels.filter(channel => channel.kind !== 'visibility'),
                  },
                }),
            ...(signal === undefined ? {} : { signal }),
          },
        ).sample(time, signal).nodeTransforms
  const { viewProjection, viewMatrix, eyePosition } = resolveUvmCamera(document, camera, {
    aspect: width / height,
    nodeTransforms: cameraPose,
    activeNodes,
    maxBytes: stageBytes,
    maxNodes: budget.maxNodes,
    time,
    ...(clip?.sequenceIndex === undefined ? {} : { sequenceIndex: clip.sequenceIndex }),
    ...(signal === undefined ? {} : { signal }),
  })
  const billboards = readUvmBillboards(document, stageBytes, signal)
  const billboardOptions = {
    billboards,
    ...(eyePosition === undefined ? {} : { billboardCameraPosition: eyePosition }),
    ...(viewMatrix === undefined
      ? {}
      : { billboardCameraRotation: billboardCameraRotation(Array.from(viewMatrix)) }),
  }
  const sample = createModelSceneSampler(
    {
      nodes: scene.nodes.map(node => (activeNodes.has(node.id) ? node : { ...node, meshIds: [] })),
      meshes,
      // visibility is decided above, from the stored values and this clip: what passes is drawn
      primitives: scene.primitives
        .filter(
          primitive => activePrimitives.has(primitive.id) && visible.get(primitive.id) !== false,
        )
        .map(({ hidden: _hidden, ...primitive }) => primitive),
      skeleton: rig.bindings,
      nodePoses: rig.nodePoses,
    },
    {
      maxBytes: stageBytes * 2,
      ...(poseSamples === undefined ? {} : { poseSamples, poseTime: time }),
      ...billboardOptions,
      ...(clip === undefined
        ? {}
        : {
            clip:
              visibilityChannels.length === 0
                ? clip
                : {
                    ...clip,
                    channels: clip.channels.filter(channel => channel.kind !== 'visibility'),
                  },
          }),
      ...(signal === undefined ? {} : { signal }),
    },
  ).sample(time, signal)
  const sceneLights = readUvmSceneLights(document, sample.nodeTransforms, activeNodes, {
    maxBytes: stageBytes,
    maxNodes: budget.maxNodes,
    time,
    ...(clip?.sequenceIndex === undefined ? {} : { sequenceIndex: clip.sequenceIndex }),
    ...(signal === undefined ? {} : { signal }),
  })
  const diagnostics: SceneRendererDiagnostic[] = [...sample.diagnostics]
  const warn = (code: string, message: string) =>
    diagnostics.push({ severity: 'warning', code, message })
  if (modelState !== 'base' && selectedModelState === undefined)
    warn(
      'common.uvm/model-state-unrendered',
      `Model state ${modelState} is not declared; the base scene is retained.`,
    )
  // Import limitations describe the rendered working asset even when its native bytes survive.
  // Read only the common provenance vocabulary; vendor extras never drive the renderer.
  const provenance = field(document['extensions'], 'UV_provenance')
  let importNotes = 0
  for (const key of ['warnings', 'lost'] as const) {
    const notes = field(provenance, key)
    if (notes === undefined) continue
    if (!Array.isArray(notes)) throw new TypeError(`UV_provenance.${key} must be an array`)
    importNotes += notes.length
    if (importNotes > budget.maxDiagnostics)
      throw new RangeError('UVM import diagnostics exceed maxDiagnostics')
    for (const note of notes) {
      signal?.throwIfAborted()
      if (
        (typeof note !== 'string' || !note.trim()) &&
        (note === null || typeof note !== 'object' || Array.isArray(note))
      )
        throw new TypeError(`UV_provenance.${key} requires text or a diagnostic object`)
      const severity = field(note, 'severity')
      diagnostics.push({
        severity: severity === 'error' ? 'error' : severity === 'info' ? 'information' : 'warning',
        code: key === 'lost' ? 'common.uvm/import-loss' : 'common.uvm/import-warning',
        message: typeof note === 'string' ? note : JSON.stringify(note),
      })
    }
  }
  const materialUv = new Map<string, number>()
  const materialTextures = new Map<string, number>()
  const materials: SceneRendererMaterial[] = array(document, 'materials').map(
    (candidate, index) => {
      const material = object(candidate, 'render material')
      if (material['doubleSided'] !== undefined && typeof material['doubleSided'] !== 'boolean')
        throw new TypeError('material doubleSided must be boolean')
      const pbr = object(material['pbrMetallicRoughness'] ?? {}, 'PBR material')
      const baseColor =
        pbr['baseColorFactor'] === undefined
          ? ([1, 1, 1, 1] as const)
          : vector4(pbr['baseColorFactor'])
      if (baseColor.some(component => component < 0 || component > 1))
        throw new RangeError('material baseColorFactor must be in 0..1')
      const texture =
        pbr['baseColorTexture'] === undefined
          ? undefined
          : object(pbr['baseColorTexture'], 'base color texture')
      const textureIndex =
        texture === undefined
          ? undefined
          : safeIndex(texture['index'], array(document, 'textures').length, 'texture')
      const alphaMode = material['alphaMode'] ?? 'OPAQUE'
      if (alphaMode !== 'OPAQUE' && alphaMode !== 'MASK' && alphaMode !== 'BLEND')
        throw new TypeError(`Material ${index} alphaMode is invalid`)
      const alphaCutoff = material['alphaCutoff'] ?? 0.5
      if (typeof alphaCutoff !== 'number' || !Number.isFinite(alphaCutoff) || alphaCutoff < 0)
        throw new TypeError(`Material ${index} alphaCutoff must be finite and nonnegative`)
      const texCoord = texture?.['texCoord'] ?? 0
      if (
        typeof texCoord !== 'number' ||
        !Number.isInteger(texCoord) ||
        texCoord < 0 ||
        texCoord > 4
      )
        throw new TypeError('render texture coordinate must be in 0..4')
      if (textureIndex !== undefined) {
        materialUv.set(`material-${index}`, texCoord)
        materialTextures.set(`material-${index}`, textureIndex)
      }
      if (
        texture !== undefined &&
        field(texture['extensions'], 'KHR_texture_transform') !== undefined
      )
        warn(
          'common.uvm/texture-transform-unrendered',
          `Material ${index} texture transform is preserved but not rendered.`,
        )
      const shader = uvmMaterialShader(material)
      const unlit = field(material['extensions'], 'KHR_materials_unlit') !== undefined
      const lit = lighting === 'material' && !unlit ? uvmMaterialPbr(material, texCoord) : undefined
      if (lit === undefined && shader === undefined && !unlit)
        warn(
          'common.uvm/pbr-lighting-unrendered',
          `Material ${index} is rendered without PBR lighting by the current base-color scene route.`,
        )
      if (lit !== undefined)
        for (const reason of lit.unrendered)
          warn('common.uvm/material-features-unrendered', `Material ${index} ${reason}.`)
      else if (
        material['normalTexture'] !== undefined ||
        material['emissiveTexture'] !== undefined ||
        pbr['metallicRoughnessTexture'] !== undefined
      )
        warn(
          'common.uvm/material-features-unrendered',
          `Material ${index} uses shading features beyond the current base-color scene contract.`,
        )
      const team = uvmMaterialTeamColor(material, texCoord)
      // a material program draws the team colour itself, in place of the base route (С1)
      const programTeam = uvmProgramTeamColor(
        document,
        shader,
        team.teamColor,
        team.maskTexture,
        texCoord,
      )
      if (team.unrendered !== undefined)
        warn(
          'common.uvm/team-color-unrendered',
          `Material ${index} team colour is not drawn: ${team.unrendered}.`,
        )
      const simpleEffect = uvmMaterialBlendEffect(material, () => {
        const { wrapU, wrapV } =
          textureIndex === undefined
            ? ({ wrapU: 'repeat', wrapV: 'repeat' } as const)
            : textureSampler(textureIndex)
        return { wrapU: wrapU ?? 'repeat', wrapV: wrapV ?? 'repeat' }
      })
      return {
        id: `material-${index}`,
        baseColor,
        alphaMode: alphaMode === 'OPAQUE' ? 'opaque' : alphaMode === 'MASK' ? 'mask' : 'blend',
        alphaCutoff,
        shading: lit !== undefined && simpleEffect === undefined ? 'pbr' : 'unlit',
        ...(lit === undefined || simpleEffect !== undefined ? {} : { pbr: lit.pbr }),
        ...(textureIndex === undefined ? {} : { baseColorTexture: `uvm-texture-${textureIndex}` }),
        doubleSided: material['doubleSided'] === true,
        ...uvmMaterialDrawOrder(material),
        ...(team.teamColor === undefined || programTeam !== undefined
          ? {}
          : { teamColor: team.teamColor }),
        ...(programTeam !== undefined
          ? { shader: programTeam }
          : shader === undefined
            ? {}
            : { shader }),
        ...(simpleEffect === undefined ? {} : { simpleEffect }),
      }
    },
  )
  materials.push({
    id: 'uvm-default',
    baseColor: [1, 1, 1, 1],
    shading: 'unlit',
    doubleSided: false,
  })
  const primitives = sample.primitives.map(source => {
    const primitive =
      source.materialId === undefined ? { ...source, materialId: 'uvm-default' } : source
    const channel = materialUv.get(primitive.materialId ?? '') ?? 0
    const uv =
      primitive.textureCoordinateSets?.find(set => set.set === channel)?.coordinates ??
      (channel === 0 ? primitive.textureCoordinates : undefined)
    if (materialUv.has(primitive.materialId ?? '') && uv === undefined)
      throw new TypeError(`primitive ${primitive.id} lacks TEXCOORD_${channel}`)
    return uv === undefined ? primitive : { ...primitive, textureCoordinates: uv }
  })
  let modelParticles: readonly ModelParticleInstance[] = []
  if (
    field(document['extensions'], 'UV_game_effects') !== undefined ||
    field(document['extensions'], 'UV_game_baked_particles') !== undefined
  ) {
    const projectorReceivers = primitives.slice()
    // Emitters sample historical node poses while seeking. Avoid deforming mesh buffers for each
    // simulation step; this sampler has the same rig and nodes but no geometry.
    const effectPose = createModelSceneSampler(
      {
        nodes: scene.nodes.map(node => ({ ...node, meshIds: [] })),
        meshes: [],
        primitives: [],
        skeleton: rig.bindings,
        nodePoses: rig.nodePoses,
      },
      {
        maxBytes: stageBytes,
        ...billboardOptions,
        ...(poseSamples === undefined ? {} : { poseSamples, poseTime: time }),
        ...(clip === undefined
          ? {}
          : {
              clip: {
                ...clip,
                channels: clip.channels.filter(channel => channel.kind !== 'visibility'),
              },
            }),
        ...(signal === undefined ? {} : { signal }),
      },
    )
    const effects = createUvmEffectFrame(document, {
      projectorsHandled: true,
      ...(options.effectCollisionProvider === undefined
        ? {}
        : { collisionProvider: options.effectCollisionProvider }),
      binary,
      time,
      ...(sequence === undefined ? {} : { sequenceIndex: sequence }),
      materials,
      activeNodes,
      maxBytes: stageBytes,
      maxNodes: budget.maxNodes,
      maxDiagnostics: budget.maxDiagnostics,
      nodeTransformsAt: time => effectPose.sample(time, signal).nodeTransforms,
      ...(viewMatrix === undefined ? {} : { viewMatrix }),
      ...(signal === undefined ? {} : { signal }),
    })
    primitives.push(...effects.primitives)
    effectPrimitiveIds.push(...effects.primitives.map(primitive => primitive.id))
    modelParticles = effects.modelParticles
    materials.push(...effects.materials)
    diagnostics.push(...effects.diagnostics)
    const projected = createUvmProjectorFrame(document, {
      receivers: projectorReceivers,
      collisionSplats: effects.collisionSplats,
      nodeTransforms: sample.nodeTransforms,
      activeNodes,
      materials,
      time,
      ...(sequence === undefined ? {} : { sequenceIndex: sequence }),
      maxBytes:
        stageBytes -
        effects.collisionSplats.length * 256 -
        effects.primitives.reduce(
          (sum, primitive) =>
            sum +
            primitive.positions.byteLength +
            (primitive.indices?.byteLength ?? 0) +
            (primitive.textureCoordinates?.byteLength ?? 0) +
            (primitive.colors?.byteLength ?? 0),
          0,
        ),
      maxNodes: budget.maxNodes - effects.primitives.length - effects.collisionSplats.length,
      warn: message => warn('common.uvm/projector-preview-limitation', message),
      ...(signal === undefined ? {} : { signal }),
    })
    primitives.push(...projected.primitives)
    effectPrimitiveIds.push(...projected.primitives.map(primitive => primitive.id))
    materials.push(...projected.materials)
  }
  if (input['collisions'] === true) {
    const overlay = createUvmCollisionOverlay(
      document,
      binary,
      { maxScalarBytes: stageBytes },
      signal,
    )
    primitives.push(...overlay.sample(sample.nodeTransforms, signal, activeNodes))
    diagnostics.push(...overlay.diagnostics)
    materials.push({
      id: 'uvm-collision-overlay',
      baseColor: [0.9, 0.65, 0.15, 1],
      doubleSided: true,
    })
  }
  if (input['shadows'] === true) {
    const shadowBindings = readUvmShadowMeshBindings(document)
    const meshesById = new Map(scene.meshes.map(mesh => [mesh.id, mesh]))
    const primitivesById = new Map(scene.primitives.map(primitive => [primitive.id, primitive]))
    for (const [ordinal, binding] of shadowBindings.entries()) {
      const mesh = meshesById.get(`mesh-${binding.mesh}`)
      const transform = sample.nodeTransforms.get(`node-${binding.node}`)
      if (mesh === undefined) throw new TypeError('UVM shadow mesh binding is not renderable')
      if (transform === undefined) continue
      for (const primitiveId of mesh.primitiveIds) {
        const primitive = primitivesById.get(primitiveId)
        if (primitive === undefined || primitive.topology !== 'triangles')
          throw new TypeError('UVM shadow mesh requires triangle primitives')
        primitives.push({
          id: `uvm-shadow-${ordinal}-${primitive.id}`,
          topology: 'triangles',
          positions: primitive.positions,
          ...(primitive.indices === undefined ? {} : { indices: primitive.indices }),
          transform,
          materialId: 'uvm-shadow-overlay',
        })
      }
    }
    if (shadowBindings.length > 0)
      materials.push({
        id: 'uvm-shadow-overlay',
        baseColor: [0.65, 0.12, 0.8, 0.45],
        alphaMode: 'blend',
        doubleSided: true,
        shading: 'unlit',
      })
  }
  // A material drawn by some primitive decodes its base-colour texture. Effect sprites draw with
  // materials derived from a document material (`uvm-effect-…`, projector and splat copies) that
  // keep its `uvm-texture-<n>`: without it their sprites drew untextured, a white card tinted by the
  // particle colour.
  const materialById = new Map(materials.map(material => [material.id, material]))
  // the base colour of a primitive's material, and the mask of its team colour
  const drawnTextures = (materialId: string | undefined) => {
    const material = materialById.get(materialId ?? '')
    const mask = material?.teamColor?.mask
    return [
      materialTextures.get(materialId ?? '') ?? documentTextureIndex(material?.baseColorTexture),
      mask === undefined || mask === 'whole' ? undefined : documentTextureIndex(mask.texture),
      documentTextureIndex(material?.pbr?.metallicRoughnessTexture),
      documentTextureIndex(material?.pbr?.occlusionTexture),
      documentTextureIndex(material?.pbr?.emissiveTexture),
      documentTextureIndex(material?.pbr?.normalTexture),
    ].filter((index): index is number => index !== undefined)
  }
  const usedTextures = new Set(primitives.flatMap(primitive => drawnTextures(primitive.materialId)))
  const images =
    rasterResources === undefined
      ? []
      : prepareUvmTextureImages(
          document,
          binary,
          [...usedTextures].filter(index => !textures.has(index)),
          Math.floor(rasterBudget / 2),
          signal,
        )
  for (const image of images) textureSampler(image.texture)
  const activeMaterials = new Set(primitives.map(primitive => primitive.materialId))
  const materialResources = uvmMaterialResources(
    materials.filter(material => activeMaterials.has(material.id)),
    stageBytes,
    signal,
  )
  const requestedResources = new Set([...materialResources.values()].flat())
  const resourceImages = new Map<string, number>()
  for (const [index] of array(document, 'images').entries()) {
    const id = uvmImageResourceId(document, index)
    if (!requestedResources.has(id)) continue
    if (resourceImages.has(id)) throw new TypeError(`ambiguous UVM material image identity: ${id}`)
    resourceImages.set(id, index)
  }
  const suppliedResources = new Map<string, SceneRendererTexture>()
  for (const [index, texture] of textures) {
    const source = object(array(document, 'textures')[index], 'texture')['source']
    if (typeof source === 'number') {
      const id = uvmImageResourceId(document, source)
      if (requestedResources.has(id) && suppliedResources.has(id))
        throw new TypeError(`ambiguous supplied UVM material texture identity: ${id}`)
      suppliedResources.set(id, texture)
    }
  }
  const capturedImages = new Map<number, UvmImage>(images.map(image => [image.image, image]))
  const materialImageIndices = [...resourceImages].flatMap(([id, index]) =>
    !suppliedResources.has(id) && !capturedImages.has(index) ? [index] : [],
  )
  const capturedBytes = [...capturedImages.values()].reduce(
    (sum, image) => sum + (image.source.kind === 'embedded' ? image.source.bytes.length : 0),
    0,
  )
  const materialImages =
    rasterResources === undefined
      ? []
      : prepareUvmImages(
          document,
          binary,
          materialImageIndices,
          Math.floor(rasterBudget / 2) - capturedBytes,
          signal,
        )
  for (const image of materialImages) capturedImages.set(image.image, image)
  const materialImageSources = new Map(
    [...resourceImages].flatMap(([id, index]) => {
      const image = capturedImages.get(index)
      return image === undefined ? [] : [[id, image.source] as const]
    }),
  )
  diagnostics.push(...samplerDiagnostics)
  // All scene arrays, image payloads and caller texels are owned before the first await.
  let remainingDecodedBytes = Math.floor(rasterBudget / 2)
  // A game material's own layers come first: its base-colour texture is only the fallback drawn
  // while those layers are unresolved. Decoding every fallback first spent the shared budget on
  // textures the material shader never samples — often the same files again — and a model with
  // large layers (the Nova shield: two 1024² maps) lost materials to their fallback, which draws
  // without the alpha masks that hide them.
  const acquiredMaterials = await acquireUvmMaterialTextures(
    materialResources,
    rasterResources,
    remainingDecodedBytes,
    diagnostics,
    signal,
    uvmImageFilters(document),
    materialImageSources,
    suppliedResources,
  )
  for (const texture of acquiredMaterials.textures) remainingDecodedBytes -= texture.rgba.length
  // A program whose unresolved textures only refine its shading draws without them
  // (uvmProgramWithoutLayers) rather than falling back to the base colour.
  const trimmed = new Set<string>()
  for (const [index, material] of materials.entries()) {
    if (!activeMaterials.has(material.id)) continue
    const bound = new Set(acquiredMaterials.bindings(material.id).map(item => item.resourceId))
    const unresolved = new Set(
      (materialResources.get(material.id) ?? []).filter(resource => !bound.has(resource)),
    )
    const without = uvmProgramWithoutLayers(material.shader, unresolved)
    if (without === undefined) continue
    materials[index] = { ...material, shader: without.shader }
    trimmed.add(material.id)
    warn(
      'common.uvm/material-layer-dropped',
      `Material ${material.id} is drawn without its ${without.dropped.join(', ')} layer: ${[...unresolved].join(', ')} did not resolve.`,
    )
  }
  const drawnByShader = new Set(
    materials
      .filter(
        material =>
          material.shader?.id === RENDER_MATERIAL_SHADER &&
          (trimmed.has(material.id) ||
            (materialResources.get(material.id) ?? []).length ===
              acquiredMaterials.bindings(material.id).length),
      )
      .map(material => material.id),
  )
  const fallbackTextures = new Set(
    primitives.flatMap(primitive =>
      drawnByShader.has(primitive.materialId ?? '') ? [] : drawnTextures(primitive.materialId),
    ),
  )
  const decodedImages = new Map<number, Omit<SceneRendererTexture, 'id'>>()
  const failedImages = new Set<number>()
  for (const image of images) {
    signal?.throwIfAborted()
    if (!fallbackTextures.has(image.texture) || failedImages.has(image.image)) continue
    let decoded = decodedImages.get(image.image)
    if (decoded === undefined && rasterResources !== undefined) {
      // its most detailed mip that fits, as a program's layers come: a 4096² fallback at mip 0
      // (64 MiB) left a BAR Legion unit white
      const result = await rasterResources.read(
        { ...image.source, maxBytes: remainingDecodedBytes, selection: { mipLevel: 'fit' } },
        signal,
      )
      signal?.throwIfAborted()
      for (const item of result.diagnostics)
        diagnostics.push({
          severity: item.severity === 'hint' ? 'information' : item.severity,
          code: item.code,
          message: item.message,
        })
      if (result.state === 'decoded') {
        try {
          // the chosen level's size, not the image's
          const { width, height } = result.region
          if (width * height * 4 > remainingDecodedBytes)
            throw new RangeError('decoded UVM images exceed budget')
          const rgba = uvmImageTexels({ ...result, info: { ...result.info, width, height } })
          remainingDecodedBytes -= rgba.length
          decoded = { width, height, rgba }
          decodedImages.set(image.image, decoded)
        } catch (error) {
          warn(
            'common.uvm/image-unrendered',
            error instanceof Error ? error.message : 'Invalid decoded image',
          )
        }
      }
    }
    if (decoded === undefined) {
      failedImages.add(image.image)
      continue
    }
    textures.set(image.texture, {
      ...keyed(image.texture, decoded),
      id: `uvm-texture-${image.texture}`,
      ...textureSampler(image.texture),
    })
  }
  for (const index of fallbackTextures)
    if (!textures.has(index))
      warn(
        'common.uvm/texture-unresolved',
        `Texture ${index} has no decoded texels available from the resource host.`,
      )
  const carriedTextureIds = new Set([...textures.values()].map(texture => texture.id))
  const request: SceneRenderRequest = {
    outputKind: 'rgba8',
    viewport: { width, height },
    camera: {
      viewProjection,
      ...(viewMatrix === undefined ? {} : { viewMatrix }),
      ...(eyePosition === undefined ? {} : { eyePosition }),
    },
    scene: {
      ...(sceneLights ?? {}),
      light: previewKeyLight(viewMatrix),
      primitives,
      materials: materials
        .filter(material => activeMaterials.has(material.id))
        .map(material => {
          const bound = { ...material, textureBindings: acquiredMaterials.bindings(material.id) }
          // A material its shader draws needs no base-colour fallback, which was not decoded.
          if (
            !drawnByShader.has(material.id) ||
            material.baseColorTexture === undefined ||
            carriedTextureIds.has(material.baseColorTexture)
          )
            return bound
          const { baseColorTexture: _fallback, ...drawn } = bound
          return drawn
        }),
      textures: [...textures.values(), ...acquiredMaterials.textures],
      materialContext,
    },
    ...(clearColor === undefined ? {} : { clearColor }),
    ...(signal === undefined ? {} : { signal }),
  }
  const modelStateNested = await composeModelParticles(
    selectedModelState === undefined
      ? []
      : [
          {
            path: selectedModelState.model,
            emitterIndex: 0,
            slot: 0,
            ageSeconds: time,
            position: [0, 0, 0],
            right: [1, 0, 0],
            up: [0, 1, 0],
            forward: [0, 0, 1],
            scale: [1, 1, 1],
            color: [1, 1, 1, 1],
            swapYZ: false,
            transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          },
        ],
    request,
    options,
    depth,
    nestedBudget,
    prepareNestedUvmRender,
    { id: 'model-state', label: 'Model states', prefix: 'model-state' },
  )
  const stateApplied = modelStateNested.composedInstances > 0
  const nested = await composeModelParticles(
    stateApplied ? [] : modelParticles,
    request,
    options,
    depth,
    nestedBudget,
    prepareNestedUvmRender,
  )
  if (
    diagnostics.length + modelStateNested.diagnostics.length + nested.diagnostics.length >
    budget.maxDiagnostics
  )
    throw new RangeError('UVM render diagnostics exceed maxDiagnostics')
  const basePrimitives = stateApplied ? modelStateNested.primitives : request.scene.primitives
  const baseMaterials = stateApplied ? modelStateNested.materials : (request.scene.materials ?? [])
  const baseTextures = stateApplied ? modelStateNested.textures : (request.scene.textures ?? [])
  return {
    request: {
      ...request,
      scene: {
        ...request.scene,
        primitives: [...basePrimitives, ...nested.primitives],
        materials: [...baseMaterials, ...nested.materials],
        textures: [...baseTextures, ...nested.textures],
      },
    },
    diagnostics: [...diagnostics, ...modelStateNested.diagnostics, ...nested.diagnostics],
    ...(rendererId === undefined ? {} : { rendererId }),
    metersPerSourceUnit,
    effectPrimitiveIds: [
      ...effectPrimitiveIds,
      ...nested.primitives.map(primitive => primitive.id),
    ],
  }
}

/** Surface-to-light key light: upper left, toward the viewer; world +Y up without a view matrix. */
function previewKeyLight(viewMatrix: ArrayLike<number> | undefined) {
  const local = [-0.35, 0.75, 0.55]
  const direction =
    viewMatrix === undefined
      ? [0.35, 0.85, 0.4]
      : // Inverse of the view rotation is its transpose (column-major rows become columns).
        [0, 1, 2].map(axis =>
          local.reduce((sum, value, row) => sum + value * (viewMatrix[axis * 4 + row] ?? 0), 0),
        )
  return {
    direction: direction as [number, number, number],
    ambient: 0.55,
    color: [0.8, 0.8, 0.8, 1] as [number, number, number, number],
  }
}

export async function renderUvm(
  bytes: Uint8Array,
  value: JsonValue,
  options: UvmRenderOptions,
): Promise<SceneRenderFrame> {
  const { request, diagnostics, rendererId } = await prepareUvmRender(bytes, value, options)
  const { signal } = options
  const { width, height } = request.viewport
  const lease = await options.contracts.resolve({
    contract: SCENE_RENDERER_CONTRACT,
    major: 1,
    facet: { outputKind: 'rgba8', ...(rendererId === undefined ? {} : { rendererId }) },
    ...(signal === undefined ? {} : { signal }),
  })
  try {
    signal?.throwIfAborted()
    const frame = await lease.value.render(request)
    signal?.throwIfAborted()
    if (
      frame.outputKind !== 'rgba8' ||
      frame.width !== width ||
      frame.height !== height ||
      !(frame.rgba instanceof Uint8Array) ||
      frame.rgba.length !== width * height * 4
    )
      throw new TypeError('scene renderer returned an invalid frame')
    return {
      ...frame,
      rgba: frame.rgba.slice(),
      statistics: { ...frame.statistics },
      diagnostics: Object.freeze(
        [...diagnostics, ...frame.diagnostics].map(item => Object.freeze({ ...item })),
      ),
    }
  } finally {
    await lease.release()
  }
}

/** Codec operation adapter over the same scene renderer; diagnostics accompany the PNG result. */
export async function renderUvmPng(
  bytes: Uint8Array,
  request: JsonValue,
  options: UvmRenderOptions & { readonly reportDiagnostic?: (value: Diagnostic) => void },
): Promise<{ kind: 'bytes'; value: Uint8Array }> {
  const frame = await renderUvm(bytes, request, options)
  for (const item of frame.diagnostics)
    options.reportDiagnostic?.(
      diagnostic(
        item.severity,
        item.code,
        item.message,
        undefined,
        item.primitiveId === undefined ? undefined : { primitiveId: item.primitiveId },
      ),
    )
  return { kind: 'bytes', value: await encodeRgbaPng(frame, options.signal) }
}

/** The glTF texture index a scene texture id of this module names (`uvm-texture-<n>`). */
function documentTextureIndex(id: string | undefined): number | undefined {
  const match = id === undefined ? null : /^uvm-texture-(0|[1-9]\d*)$/u.exec(id)
  return match === null ? undefined : Number(match[1])
}
