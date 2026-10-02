import type { JsonObject, JsonValue } from '@modkit/sdk'
import { snapshotJson, type JsonSnapshotBudget } from '@modkit/codec-kit/json-snapshot'
import type {
  AnimatedValueTracks,
  StandardMaterialModel,
  StandardMaterialLayer,
} from '@modkit/codec-kit/legacy/models/material'
import { isStandardLayerSlot } from '@modkit/codec-kit/legacy/models/material'
import type { RenderScalarAnimationTrack } from '@modkit/codec-kit/legacy/models'
import { sampleTrackValue } from '@modkit/codec-kit/model-math/sequence-pose'
import { WORLD_PROJECTION_UV_SOURCES } from '@modkit/uv/model/frame'
import { materialFrame } from './frame.js'
import type { NormalBlendPolicy } from './normal-blending.js'
import { SCENE_ENVIRONMENT_RESOURCE } from './environment.js'

/** Vocabulary carried by UV_game_material.params; this module never reads native extras. */
export const RENDER_MATERIAL_SHADER = 'modkit.render-material.v1'

/**
 * The renderer's own view of a material whose only texture statement is its neutral layer list
 * (`renderModel.layers`: label and resource path); the base route draws its diffuse layer.
 */
export const MATERIAL_LAYERS_SHADER = 'modkit.material-layers.v1'

export interface MaterialSampleTime {
  /** Elapsed playback time, used by independently looping concurrent tracks. */
  readonly time: number
  /** Sequence-local time after clip looping. Defaults to time. */
  readonly sequenceTime?: number
  /** Index in the imported render-model sequence table, not an arbitrary clip id suffix. */
  readonly sequenceIndex?: number
}

export interface RenderMaterialPass {
  readonly material: SceneStandardMaterial
  readonly alpha: number
  readonly priority: number
}

/** Scene vocabulary additions do not alter the frozen native material model. */
export interface SceneStandardMaterial extends StandardMaterialModel {
  readonly normalBlendPolicy?: NormalBlendPolicy
  /** Select stored UVs only when generating missing tangents; authored tangents take precedence. */
  readonly tangentGeneration?: MaterialTangentGeneration
}

export interface MaterialTangentGeneration {
  /** TEXCOORD_0 through TEXCOORD_4. Explicit missing inputs refuse instead of selecting another set. */
  readonly texCoord: number
}

function activeLayers(material: SceneStandardMaterial): StandardMaterialLayer[] {
  return Object.values(material.layers).filter(
    layer => layer.slot !== 'normalBlend2Mask' || material.normalBlendPolicy?.secondMask !== false,
  )
}

/**
 * How a material contributes to the frame. `surface` (default) is an ordinary color pass.
 * `screen-distortion` only refracts what is already drawn behind it (heat haze);
 * `terrain-projection` shows the underlying terrain surface on the geometry. Neither has a color
 * of its own, so a renderer without that pass draws nothing rather than an approximated surface.
 */
export type RenderMaterialPresentation = 'surface' | 'screen-distortion' | 'terrain-projection'
const PRESENTATIONS: readonly string[] = ['surface', 'screen-distortion', 'terrain-projection']

export interface RenderMaterialSampler {
  /** Stable, deduplicated logical resource ids, in authored pass/layer order. */
  readonly resources: readonly string[]
  /** An `envi` layer reads the scene's environment (SCENE_ENVIRONMENT_RESOURCE, not in `resources`). */
  readonly usesSceneEnvironment: boolean
  readonly presentation: RenderMaterialPresentation
  readonly worldToMaterial?: readonly number[]
  readonly usesWorldProjection: boolean
  sample(time: MaterialSampleTime, signal?: AbortSignal): readonly RenderMaterialPass[]
}

const record = (value: unknown, path: string): JsonObject => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${path} must be an object`)
  return value as JsonObject
}
const finite = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
    throw new TypeError(`${path} must be a finite float32 number`)
  return value
}
const integer = (value: unknown, path: string, min: number, max: number): number => {
  const result = finite(value, path)
  if (!Number.isSafeInteger(result) || result < min || result > max)
    throw new TypeError(`${path} must be an integer in ${min}..${max}`)
  return result
}
const vector = (value: unknown, path: string, size: number): void => {
  if (!Array.isArray(value) || value.length !== size)
    throw new TypeError(`${path} must contain ${size} components`)
  for (const component of value) finite(component, path)
}
const flags = (value: JsonObject, path: string, names: readonly string[], optional = false) => {
  for (const key of names)
    if ((!optional || value[key] !== undefined) && typeof value[key] !== 'boolean')
      throw new TypeError(`${path}.${key} must be boolean`)
}

function validateTrack(value: unknown, path: string, size: number, signal?: AbortSignal) {
  const track = record(value, path)
  // The shared sampler implements step/linear. Refuse cubic rather than silently sample linearly.
  integer(track['lineType'], `${path}.lineType`, 0, 1)
  if (track['globalSeqId'] !== null)
    throw new TypeError(`${path}.globalSeqId requires an explicit global sequence timeline`)
  const keys = track['keys']
  if (!Array.isArray(keys) || keys.length === 0)
    throw new TypeError(`${path}.keys must be nonempty`)
  let previous = -Infinity
  for (const [index, item] of keys.entries()) {
    signal?.throwIfAborted()
    const keyPath = `${path}.keys[${index}]`,
      key = record(item, keyPath)
    const frame = finite(key['frame'], `${keyPath}.frame`)
    if (frame < previous) throw new TypeError(`${path} keys must be ordered by frame`)
    previous = frame
    vector(key['vector'], `${keyPath}.vector`, size)
    for (const tangent of ['inTan', 'outTan'])
      if (key[tangent] !== undefined) vector(key[tangent], `${keyPath}.${tangent}`, size)
  }
}

function animated(value: unknown, path: string, size: number, signal?: AbortSignal) {
  const property = record(value, path)
  if (size === 1) finite(property['value'], `${path}.value`)
  else vector(property['value'], `${path}.value`, size)
  if (property['track'] !== undefined)
    validateTrack(property['track'], `${path}.track`, size, signal)
  const sequences = property['sequenceTracks']
  if (sequences === undefined) return
  if (!Array.isArray(sequences)) throw new TypeError(`${path}.sequenceTracks must be an array`)
  const seen = new Set<number>()
  for (const [index, entry] of sequences.entries()) {
    const trackPath = `${path}.sequenceTracks[${index}]`,
      track = record(entry, trackPath)
    const sequence = integer(track['sequenceIndex'], `${trackPath}.sequenceIndex`, 0, 0xffffffff)
    if (seen.has(sequence)) throw new TypeError(`${path} has duplicate sequence ${sequence}`)
    seen.add(sequence)
    flags(track, trackPath, ['concurrent'], true)
    if (track['wrapSeconds'] !== undefined || track['concurrent'] === true)
      if (finite(track['wrapSeconds'], `${trackPath}.wrapSeconds`) <= 0)
        throw new TypeError(`${trackPath}.wrapSeconds must be positive`)
    validateTrack(track['track'], `${trackPath}.track`, size, signal)
  }
}

const LAYER_ANIMATIONS = [
  ['constantColor', 4],
  ['colorMultiply', 1],
  ['colorAdd', 1],
  ['alphaFactor', 1],
  ['uvOffset', 2],
  ['uvAngle', 3],
  ['uvTiling', 2],
  ['uvTriplanarOffset', 3],
  ['uvTriplanarScale', 3],
] as const

function validateLayer(value: JsonValue, slot: string, path: string, signal?: AbortSignal) {
  const layer = record(value, path)
  if (layer['slot'] !== slot) throw new TypeError(`${path}.slot does not match its layer key`)
  if (
    layer['texturePath'] !== null &&
    (typeof layer['texturePath'] !== 'string' || layer['texturePath'].trim() === '')
  )
    throw new TypeError(`${path}.texturePath must be a nonempty logical id or null`)
  // `sceneEnvironment`: an environment layer without a map of its own reflects the scene's
  if (layer['sceneEnvironment'] !== undefined) {
    if (
      layer['sceneEnvironment'] !== true ||
      slot !== 'envi' ||
      layer['texturePath'] !== null ||
      layer['constantColor'] !== undefined
    )
      throw new TypeError(
        `${path}.sceneEnvironment is true only on an envi layer without a texture or constant color`,
      )
  } else if (layer['texturePath'] === null && layer['constantColor'] === undefined)
    throw new TypeError(`${path} has no texture or constant color`)
  integer(layer['uvSource'], `${path}.uvSource`, 0, 18)
  integer(layer['channels'], `${path}.channels`, 0, 5)
  integer(layer['op'], `${path}.op`, 0, 6)
  integer(layer['teamColorMode'], `${path}.teamColorMode`, 0, 2)
  flags(layer, path, ['invert', 'clampResult', 'wrapX', 'wrapY'])
  for (const [key, size] of LAYER_ANIMATIONS)
    if (layer[key] !== undefined) animated(layer[key], `${path}.${key}`, size, signal)
  if (layer['flipbook'] !== undefined) {
    const flip = record(layer['flipbook'], `${path}.flipbook`)
    integer(flip['rows'], `${path}.flipbook.rows`, 1, 0xffff)
    integer(flip['cols'], `${path}.flipbook.cols`, 1, 0xffff)
    if (flip['frameSize'] !== undefined) {
      vector(flip['frameSize'], `${path}.flipbook.frameSize`, 2)
      if ((flip['frameSize'] as readonly number[]).some(component => component <= 0))
        throw new TypeError(`${path}.flipbook.frameSize must be positive`)
    }
    animated(flip['frame'], `${path}.flipbook.frame`, 1, signal)
  }
  if (layer['angleLookup'] !== undefined) {
    // StandardLayerAngleLookup: a texture read at angle coordinates in place of its uv source
    const lookup = record(layer['angleLookup'], `${path}.angleLookup`)
    if (
      layer['texturePath'] === null ||
      (lookup['u'] !== 'edge' && lookup['u'] !== 'reflection') ||
      (lookup['v'] !== 'row' && lookup['v'] !== 'light') ||
      Object.keys(lookup).some(key => !['u', 'v', 'exponent', 'row'].includes(key)) ||
      (lookup['exponent'] !== undefined && lookup['u'] !== 'edge') ||
      (lookup['v'] === 'row') !== (lookup['row'] !== undefined)
    )
      throw new TypeError(
        `${path}.angleLookup is a textured layer's { u: edge|reflection, v: row|light }, an exponent only for edge, a row exactly for row`,
      )
    if (
      lookup['exponent'] !== undefined &&
      !(finite(lookup['exponent'], `${path}.angleLookup.exponent`) > 0)
    )
      throw new TypeError(`${path}.angleLookup.exponent must be positive`)
    if (lookup['row'] !== undefined) finite(lookup['row'], `${path}.angleLookup.row`)
  }
  if (layer['fresnel'] !== undefined) {
    const fresnel = record(layer['fresnel'], `${path}.fresnel`)
    integer(fresnel['mode'], `${path}.fresnel.mode`, 1, 2)
    integer(fresnel['transformMode'], `${path}.fresnel.transformMode`, 0, 2)
    for (const key of ['exponent', 'min', 'maxOffset'])
      finite(fresnel[key], `${path}.fresnel.${key}`)
    flags(fresnel, `${path}.fresnel`, ['localTransform', 'doNotMirror'])
    for (const key of ['translation', 'invertMask'])
      vector(fresnel[key], `${path}.fresnel.${key}`, 3)
    vector(fresnel['rotation'], `${path}.fresnel.rotation`, 2)
  }
}

function validateStandard(value: unknown, path: string, signal?: AbortSignal) {
  const material = record(value, path)
  if (material['tangentGeneration'] !== undefined) {
    const generation = record(material['tangentGeneration'], `${path}.tangentGeneration`)
    if (Object.keys(generation).some(key => key !== 'texCoord'))
      throw new TypeError(`${path}.tangentGeneration has unsupported properties`)
    integer(generation['texCoord'], `${path}.tangentGeneration.texCoord`, 0, 4)
  }
  integer(material['blendMode'], `${path}.blendMode`, 0, 6)
  integer(material['specMode'], `${path}.specMode`, 0, 1)
  for (const key of ['priority', 'specularity', 'specMult', 'emisMult'])
    finite(material[key], `${path}.${key}`)
  const threshold = finite(material['alphaTestThreshold'], `${path}.alphaTestThreshold`)
  if (threshold < 0 || threshold > 1)
    throw new TypeError(`${path}.alphaTestThreshold must be in 0..1`)
  flags(material, path, [
    'twoSided',
    'unshaded',
    'doubleLambert',
    'clampOutput',
    'usesVertexColor',
    'usesVertexAlpha',
  ])
  flags(
    material,
    path,
    ['depthPrepass', 'specularEnergyConservation', 'environmentTintByBase'],
    true,
  )
  for (const key of ['sourceFlags', 'sourceAdditionalFlags', 'materialClass'])
    if (material[key] !== undefined) integer(material[key], `${path}.${key}`, 0, 0xffffffff)
  for (const key of ['environmentMultipliers', 'emissiveTint'])
    if (material[key] !== undefined) vector(material[key], `${path}.${key}`, 3)
  if (material['parallaxHeight'] !== undefined)
    animated(material['parallaxHeight'], `${path}.parallaxHeight`, 1, signal)
  const factors = material['normalBlendFactors']
  if (factors !== undefined) {
    if (!Array.isArray(factors) || factors.length !== 8)
      throw new TypeError(`${path}.normalBlendFactors must have 8 entries`)
    for (const [index, factor] of factors.entries())
      animated(factor, `${path}.normalBlendFactors[${index}]`, 1, signal)
  }
  if (
    material['normalMapFormat'] !== undefined &&
    (typeof material['normalMapFormat'] !== 'string' ||
      !['dxt5nm', 'bc5', 'rgb8', 'luminance-alpha'].includes(material['normalMapFormat']))
  )
    throw new TypeError(`${path}.normalMapFormat is unsupported`)
  if (
    material['normalMapSpace'] !== undefined &&
    material['normalMapSpace'] !== 'tangent' &&
    material['normalMapSpace'] !== 'object'
  )
    throw new TypeError(`${path}.normalMapSpace is unsupported`)
  if (material['normalMapTransform'] !== undefined)
    vector(material['normalMapTransform'], `${path}.normalMapTransform`, 9)
  const lightingModel = material['lightingModel'] ?? 'm3'
  if (lightingModel !== 'm3' && lightingModel !== 'pbr-metallic-roughness')
    throw new TypeError(`${path}.lightingModel is unsupported`)
  for (const key of ['metallicFactor', 'roughnessFactor'])
    if (material[key] !== undefined) {
      const factor = finite(material[key], `${path}.${key}`)
      if (factor < 0 || factor > 1) throw new TypeError(`${path}.${key} must be in 0..1`)
    }
  const colorPipeline = material['colorPipeline'] ?? 'm3'
  if (colorPipeline !== 'm3' && colorPipeline !== 'linear-srgb')
    throw new TypeError(`${path}.colorPipeline is unsupported`)
  if (colorPipeline === 'linear-srgb' && lightingModel !== 'pbr-metallic-roughness')
    throw new TypeError(`${path}.colorPipeline linear-srgb requires the pbr lighting model`)
  if (material['tonemap'] !== undefined) {
    vector(material['tonemap'], `${path}.tonemap`, 5)
    // x(ax + b) / (x(cx + d) + e): nonnegative terms and e > 0 keep the curve finite from 0 up
    const curve = material['tonemap'] as readonly number[]
    if (curve.some(term => term < 0) || !(curve[4]! > 0))
      throw new TypeError(`${path}.tonemap needs nonnegative terms and e > 0`)
    if (colorPipeline !== 'linear-srgb')
      throw new TypeError(`${path}.tonemap requires the linear-srgb color pipeline`)
  }
  if (material['normalMapSpace'] !== 'object' && material['normalMapTransform'] !== undefined)
    throw new TypeError(`${path}.normalMapTransform requires object-space normals`)
  const layers = record(material['layers'], `${path}.layers`)
  if (
    material['normalMapSpace'] === 'object' &&
    (layers['normal'] === undefined ||
      ['normalBlend1', 'normalBlend2', 'normalBlend1Mask', 'normalBlend2Mask'].some(
        slot => layers[slot] !== undefined,
      ))
  )
    throw new TypeError(`${path}.normalMapSpace object requires one primary normal layer`)
  if (material['normalBlendPolicy'] !== undefined) {
    const policy = record(material['normalBlendPolicy'], `${path}.normalBlendPolicy`)
    if (
      policy['mode'] !== 'signed-two-detail' ||
      typeof policy['secondMask'] !== 'boolean' ||
      Object.keys(policy).some(key => key !== 'mode' && key !== 'secondMask')
    )
      throw new TypeError(`${path}.normalBlendPolicy is unsupported`)
    if (layers['normalBlend1'] === undefined || layers['normalBlend2'] === undefined)
      throw new TypeError(`${path}.normalBlendPolicy requires both detail layers`)
  }
  for (const [slot, layer] of Object.entries(layers)) {
    if (!isStandardLayerSlot(slot)) throw new TypeError(`${path} has unknown layer ${slot}`)
    validateLayer(layer, slot, `${path}.layers.${slot}`, signal)
  }
}

/** Own and validate inert material JSON before any renderer is allowed to execute it. */
export function createRenderMaterialSampler(
  parameters: unknown,
  budget: JsonSnapshotBudget,
  signal?: AbortSignal,
): RenderMaterialSampler {
  const params = record(snapshotJson(parameters, budget, signal), 'material params')
  const model = record(params['renderModel'], 'material params.renderModel')
  if (model['version'] !== 1) throw new TypeError('unsupported render material version')
  const presentation = model['presentation'] ?? 'surface'
  if (typeof presentation !== 'string' || !PRESENTATIONS.includes(presentation))
    throw new TypeError('unsupported render material presentation')
  // ponytail: no distortion or terrain-projection pass exists yet, so those materials sample to no
  // color passes and acquire no textures; add the passes (and their resources) when a renderer draws them.
  const colorless = presentation !== 'surface'
  const worldToMaterial =
    model['worldToMaterial'] === undefined ? undefined : materialFrame(model['worldToMaterial'])
  let priority: number | undefined
  let passes: readonly {
    material: SceneStandardMaterial
    alphaFactor: { value: number } & AnimatedValueTracks
  }[]
  if (model['composite'] !== undefined) {
    const composite = record(model['composite'], 'composite material')
    priority = finite(composite['priority'], 'composite material.priority')
    if (!Array.isArray(composite['passes']) || composite['passes'].length === 0)
      throw new TypeError('composite material.passes must be nonempty')
    for (const [index, value] of composite['passes'].entries()) {
      const pass = record(value, `material pass ${index}`)
      validateStandard(pass['material'], `material pass ${index}`, signal)
      animated(pass['alphaFactor'], `material pass ${index}.alphaFactor`, 1, signal)
    }
    // Every field used by the shared typed kernels has been checked above; unknown JSON stays inert.
    passes = (composite['passes'] as unknown as typeof passes).map(pass => ({
      ...pass,
      material: withSceneEnvironment(pass.material),
    }))
    if (model['standard'] !== undefined)
      validateStandard(model['standard'], 'standard material', signal)
  } else {
    validateStandard(model['standard'], 'standard material', signal)
    passes = [
      {
        material: withSceneEnvironment(model['standard'] as unknown as SceneStandardMaterial),
        alphaFactor: { value: 1 },
      },
    ]
  }
  const resources = Object.freeze(
    colorless
      ? []
      : [
          ...new Set(
            passes.flatMap(pass =>
              activeLayers(pass.material).flatMap(layer =>
                layer.texturePath === null || layer.texturePath === SCENE_ENVIRONMENT_RESOURCE
                  ? []
                  : [layer.texturePath],
              ),
            ),
          ),
        ],
  )
  return Object.freeze({
    resources,
    usesSceneEnvironment:
      !colorless &&
      passes.some(pass => pass.material.layers.envi?.texturePath === SCENE_ENVIRONMENT_RESOURCE),
    presentation: presentation as RenderMaterialPresentation,
    ...(worldToMaterial === undefined ? {} : { worldToMaterial }),
    usesWorldProjection: passes.some(pass =>
      // Rebasing preserves authored coordinates even for a layer that may be enabled later.
      Object.values(pass.material.layers).some(
        layer => layer.texturePath !== null && WORLD_PROJECTION_UV_SOURCES.includes(layer.uvSource),
      ),
    ),
    sample(time: MaterialSampleTime, sampleSignal?: AbortSignal): readonly RenderMaterialPass[] {
      if (!Number.isFinite(time.time) || time.time < 0)
        throw new TypeError('material time must be finite and nonnegative')
      if (
        time.sequenceTime !== undefined &&
        (!Number.isFinite(time.sequenceTime) || time.sequenceTime < 0)
      )
        throw new TypeError('material sequenceTime must be finite and nonnegative')
      if (time.sequenceIndex !== undefined)
        integer(time.sequenceIndex, 'material sequenceIndex', 0, 0xffffffff)
      sampleSignal?.throwIfAborted()
      if (colorless) return Object.freeze([])
      return Object.freeze(
        passes.map((pass, index) => {
          sampleSignal?.throwIfAborted()
          return Object.freeze({
            material: sampleMaterial(pass.material, time, sampleSignal),
            // Render-model composites use their first pass as the base; its CMS opacity is ignored.
            alpha: index === 0 ? 1 : sampleAnimated(pass.alphaFactor, time).value,
            priority: priority ?? pass.material.priority,
          })
        }),
      )
    },
  })
}

/** The program binds a `sceneEnvironment` layer as the scene's environment resource. */
function withSceneEnvironment(material: SceneStandardMaterial): SceneStandardMaterial {
  const envi = material.layers.envi as
    (StandardMaterialLayer & { sceneEnvironment?: true }) | undefined
  if (envi?.sceneEnvironment !== true) return material
  const { sceneEnvironment: _, ...layer } = envi
  void _
  return {
    ...material,
    layers: { ...material.layers, envi: { ...layer, texturePath: SCENE_ENVIRONMENT_RESOURCE } },
  }
}

function sampleAnimated<T extends number | readonly number[]>(
  value: { value: T } & AnimatedValueTracks,
  time: MaterialSampleTime,
): { value: T } {
  const sequence =
    time.sequenceIndex === undefined
      ? undefined
      : value.sequenceTracks?.find(entry => entry.sequenceIndex === time.sequenceIndex)
  // Sparse per-sequence properties use their static value in other sequences, not track 0.
  const track: RenderScalarAnimationTrack | undefined =
    value.sequenceTracks === undefined ? value.track : sequence?.track
  let sampled: number | readonly number[] = value.value
  if (track !== undefined) {
    const components = sampleTrackValue(
      track,
      sequence?.concurrent === true ? time.time : (time.sequenceTime ?? time.time),
      [],
      sequence?.concurrent === true ? { wrapSeconds: sequence.wrapSeconds } : {},
    )
    if (components.length === 0) throw new TypeError('material sample produced no components')
    for (const component of components) finite(component, 'material sample')
    sampled =
      typeof value.value === 'number' ? (components[0] as number) : Object.freeze(components)
  }
  // Input shape and track vector arity were validated together; sampling preserves that shape.
  return Object.freeze({ value: sampled as T })
}

function sampleMaterial(
  material: SceneStandardMaterial,
  time: MaterialSampleTime,
  signal?: AbortSignal,
): SceneStandardMaterial {
  const layers: StandardMaterialModel['layers'] = {}
  for (const layer of activeLayers(material)) {
    const slot = layer.slot
    signal?.throwIfAborted()
    if (!isStandardLayerSlot(slot)) throw new TypeError(`unknown material slot ${slot}`)
    const sampled: StandardMaterialLayer = { ...layer }
    for (const [key] of LAYER_ANIMATIONS) {
      const property = layer[key]
      if (property !== undefined)
        Object.assign(sampled, {
          [key]: sampleAnimated<number | readonly number[]>(property, time),
        })
    }
    if (layer.flipbook !== undefined)
      sampled.flipbook = Object.freeze({
        ...layer.flipbook,
        frame: sampleAnimated(layer.flipbook.frame, time),
      })
    layers[slot] = Object.freeze(sampled)
  }
  return Object.freeze({
    ...material,
    layers: Object.freeze(layers),
    ...(material.parallaxHeight === undefined
      ? {}
      : { parallaxHeight: sampleAnimated(material.parallaxHeight, time) }),
    ...(material.normalBlendFactors === undefined
      ? {}
      : {
          normalBlendFactors: Object.freeze(
            material.normalBlendFactors.map(factor => sampleAnimated(factor, time)),
          ) as NonNullable<StandardMaterialModel['normalBlendFactors']>,
        }),
  })
}
