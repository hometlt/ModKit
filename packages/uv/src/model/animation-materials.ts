import type { JsonObject, JsonValue, ModelMaterialRef } from '@modkit/sdk'
import { snapshotModelMaterials } from '@modkit/codec-kit/model/materials'
import { snapshotJson, type JsonSnapshotBudget } from '@modkit/codec-kit/json-snapshot'
import { isStandardLayerSlot } from '@modkit/codec-kit/legacy/models/material'
import { array, field, integer, object } from './validation/values.js'

export interface UvmAnimationMaterialProperty {
  /** A published animated property inside UV_game_material.params, never a resource reference. */
  readonly path: string
  readonly value: number | readonly number[]
  readonly sequenceTracks: readonly JsonObject[]
}
export interface UvmAnimationMaterialTarget {
  readonly id: string
  readonly properties: readonly UvmAnimationMaterialProperty[]
}
const layerWidths: Readonly<Record<string, number>> = {
  constantColor: 4,
  colorMultiply: 1,
  colorAdd: 1,
  alphaFactor: 1,
  uvOffset: 2,
  uvAngle: 3,
  uvTiling: 2,
  uvTriplanarOffset: 3,
  uvTriplanarScale: 3,
}
const ordinal = '(?:0|[1-9]\\d*)'
const standard = `(?:standard|composite/passes/${ordinal}/material)`
const layerPath = new RegExp(`^/renderModel/${standard}/layers/([^/]+)/(.*)$`, 'u')
const scalarPath = new RegExp(
  `^/renderModel/(?:${standard}/(?:emisMult|parallaxHeight|normalBlendFactors/[0-7])|composite/passes/${ordinal}/alphaFactor)$`,
  'u',
)

export function uvmAnimationMaterialPropertyWidth(path: string): number | undefined {
  if (scalarPath.test(path)) return 1
  const layer = layerPath.exec(path)
  if (layer === null || !isStandardLayerSlot(layer[1] ?? '')) return undefined
  const property = layer[2] ?? ''
  return property === 'flipbook/frame'
    ? 1
    : Object.hasOwn(layerWidths, property)
      ? layerWidths[property]
      : undefined
}
function vector(value: unknown, width: number, scalar = false): number | readonly number[] {
  if (scalar && width === 1 && typeof value === 'number' && Number.isFinite(Math.fround(value)))
    return value
  if (
    !Array.isArray(value) ||
    value.length !== width ||
    value.some(item => typeof item !== 'number' || !Number.isFinite(Math.fround(item)))
  )
    throw new TypeError('animation material values must match a finite float32 property width')
  return Object.freeze(Array.from(value, item => Number(item)))
}
function readTargets(value: unknown, signal?: AbortSignal): readonly UvmAnimationMaterialTarget[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TypeError('animation materialTargets must be an array')
  const ids = new Set<string>()
  return Object.freeze(
    value.map(candidate => {
      signal?.throwIfAborted()
      const item = object(candidate, 'animation material target')
      const id = item['id']
      if (typeof id !== 'string' || !id.trim() || ids.has(id) || !Array.isArray(item['properties']))
        throw new TypeError('animation material target requires a unique id and properties')
      ids.add(id)
      const paths = new Set<string>()
      const properties = item['properties'].map(candidate => {
        const property = object(candidate, 'animation material property')
        const path = property['path']
        const width = typeof path === 'string' ? uvmAnimationMaterialPropertyWidth(path) : undefined
        if (
          typeof path !== 'string' ||
          width === undefined ||
          paths.has(path) ||
          !Array.isArray(property['sequenceTracks']) ||
          property['sequenceTracks'].length === 0
        )
          throw new TypeError(
            'animation material property requires a unique published path and sequenceTracks',
          )
        paths.add(path)
        if (path.endsWith('/emisMult') && typeof property['value'] !== 'number')
          throw new TypeError('emissive gain default must be a numeric scalar')
        const value = vector(property['value'], width, true)
        const sequences = new Set<number>()
        const sequenceTracks = property['sequenceTracks'].map(candidate => {
          signal?.throwIfAborted()
          const sequence = object(candidate, 'animation material sequence track')
          const index = sequence['sequenceIndex']
          if (!integer(index) || index < 0 || index > 0xffffffff || sequences.has(index))
            throw new TypeError('invalid animation material sequence index')
          sequences.add(index)
          const concurrent = sequence['concurrent'],
            wrap = sequence['wrapSeconds']
          if (
            (concurrent !== undefined && typeof concurrent !== 'boolean') ||
            ((wrap !== undefined || concurrent === true) &&
              (typeof wrap !== 'number' || !Number.isFinite(wrap) || wrap <= 0))
          )
            throw new TypeError('invalid animation material concurrent clock')
          const track = object(sequence['track'], 'animation material track')
          if (
            (track['lineType'] !== 0 && track['lineType'] !== 1) ||
            track['globalSeqId'] !== null ||
            !Array.isArray(track['keys']) ||
            track['keys'].length === 0
          )
            throw new TypeError(
              'animation material track requires supported step/linear keys and explicit sequence clock',
            )
          let previous = -Infinity
          for (const key of track['keys']) {
            const keyValue = object(key, 'animation material key'),
              frame = keyValue['frame']
            if (
              typeof frame !== 'number' ||
              !Number.isFinite(Math.fround(frame)) ||
              frame < previous
            )
              throw new TypeError('animation material key times must be finite and ordered')
            previous = frame
            vector(keyValue['vector'], width)
            for (const tangent of ['inTan', 'outTan'])
              if (keyValue[tangent] !== undefined) vector(keyValue[tangent], width)
          }
          return sequence
        })
        return Object.freeze({ path, value, sequenceTracks: Object.freeze(sequenceTracks) })
      })
      return Object.freeze({ id, properties: Object.freeze(properties) })
    }),
  )
}

/** Neutral inactive slots: selecting a clip alone never creates a material or resolves textures. */
export function readUvmAnimationMaterialTargets(
  document: JsonObject,
  signal?: AbortSignal,
): readonly UvmAnimationMaterialTarget[] {
  return readTargets(
    field(field(document['extensions'], 'UV_game_animation_clips'), 'materialTargets'),
    signal,
  )
}

/** Extract only the shared material vocabulary from facets before a standalone bundle strips meshes. */
export function materializeUvmAnimationMaterialTargets(
  source: readonly ModelMaterialRef[],
  budget: JsonSnapshotBudget = { maxDepth: 128, maxNodes: 1_000_000, maxBytes: 67_108_864 },
  signal?: AbortSignal,
): readonly UvmAnimationMaterialTarget[] {
  const materials = snapshotModelMaterials(source, budget, signal)
  const targets: JsonObject[] = []
  for (const material of materials) {
    signal?.throwIfAborted()
    if (material.shader?.id !== 'modkit.render-material.v1') continue
    const model = object(
      material.shader.parameters['renderModel'],
      'animation material render model',
    )
    if (model['version'] !== 1) throw new TypeError('unsupported animation material version')
    const properties: JsonObject[] = []
    const visit = (value: JsonValue | undefined, path: string, depth: number): void => {
      signal?.throwIfAborted()
      if (depth > budget.maxDepth)
        throw new RangeError('animation material target exceeds maxDepth')
      if (uvmAnimationMaterialPropertyWidth(path) !== undefined && value !== undefined) {
        // These two admitted paths also retain their legacy numeric static form.
        if (path.endsWith('/emisMult') && typeof value === 'number') {
          vector(value, 1, true)
          return
        }
        const property = object(value, 'material animation property')
        if (array(property, 'sequenceTracks').length > 0)
          properties.push({
            path,
            value: property['value'] as JsonValue,
            sequenceTracks: property['sequenceTracks'] as JsonValue,
          })
        return
      }
      if (Array.isArray(value)) {
        for (const [index, child] of value.entries()) visit(child, `${path}/${index}`, depth + 1)
      } else if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          // Exact safe tokens only; unknown extras are never interpreted as an animated field.
          if (!['extras', 'extensions'].includes(key)) {
            const token = key.replace(/~/gu, '~0').replace(/\//gu, '~1')
            visit(child, `${path}/${token}`, depth + 1)
          }
        }
      }
    }
    visit(model, '/renderModel', 0)
    if (properties.length > 0) targets.push({ id: material.id, properties })
  }
  return readTargets(snapshotJson(targets, budget, signal), signal)
}
