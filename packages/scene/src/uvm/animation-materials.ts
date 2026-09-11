import type { JsonObject, JsonValue } from '@modkit/sdk'
import type { JsonSnapshotBudget } from '@modkit/codec-kit/json-snapshot'
import { readUvmAnimationMaterialTargets } from '@modkit/uv/model/animation-clips'
import { createRenderMaterialSampler, RENDER_MATERIAL_SHADER } from '../materials/render-model.js'
import { applyUvmJsonEdit } from './json-edit.js'
import { array, field, object, safeIndex } from './values.js'

const layerProperties = [
  'constantColor',
  'colorMultiply',
  'colorAdd',
  'alphaFactor',
  'uvOffset',
  'uvAngle',
  'uvTiling',
  'uvTriplanarOffset',
  'uvTriplanarScale',
]
const escape = (value: string) => value.replace(/~/gu, '~0').replace(/\//gu, '~1')

/** Only published v1 animation properties are inspected; arbitrary material extras remain inert. */
function properties(params: JsonObject): Map<string, JsonObject> {
  const result = new Map<string, JsonObject>()
  const add = (candidate: unknown, path: string) => {
    if (candidate !== undefined) result.set(path, object(candidate, 'animated material property'))
  }
  const standard = (candidate: unknown, path: string) => {
    const material = object(candidate, 'standard material')
    add(material['parallaxHeight'], `${path}/parallaxHeight`)
    for (const [index, value] of array(material, 'normalBlendFactors').entries())
      add(value, `${path}/normalBlendFactors/${index}`)
    for (const [slot, value] of Object.entries(object(material['layers'], 'material layers'))) {
      const layer = object(value, 'material layer')
      const prefix = `${path}/layers/${escape(slot)}`
      for (const key of layerProperties) add(layer[key], `${prefix}/${key}`)
      add(field(layer['flipbook'], 'frame'), `${prefix}/flipbook/frame`)
    }
  }
  const model = object(params['renderModel'], 'render model')
  if (model['standard'] !== undefined) standard(model['standard'], '/renderModel/standard')
  for (const [index, candidate] of array(model['composite'], 'passes').entries()) {
    const pass = object(candidate, 'material pass')
    standard(pass['material'], `/renderModel/composite/passes/${index}/material`)
    add(pass['alphaFactor'], `/renderModel/composite/passes/${index}/alphaFactor`)
  }
  return result
}

export function attachMaterialSequences(
  source: JsonObject,
  target: JsonObject,
  sequenceMap: ReadonlyMap<number, number>,
  materialMap: ReadonlyMap<string, number>,
  budget: JsonSnapshotBudget,
  signal?: AbortSignal,
): JsonObject {
  let result = target
  const targetMaterials = array(target, 'materials')
  const usedTargets = new Set<string>()
  const sources: { key: string; properties: ReadonlyMap<string, JsonObject> }[] = []
  for (const [index, candidate] of array(source, 'materials').entries()) {
    signal?.throwIfAborted()
    const extension = field(field(candidate, 'extensions'), 'UV_game_material')
    if (field(extension, 'shader') !== RENDER_MATERIAL_SHADER) continue
    const params = object(field(extension, 'params'), 'source material params')
    createRenderMaterialSampler(params, budget, signal)
    sources.push({ key: `material:${index}`, properties: properties(params) })
  }
  for (const [index, target] of readUvmAnimationMaterialTargets(source, signal).entries())
    sources.push({
      key: `animation-target:${index}`,
      properties: new Map(
        target.properties.map(property => [
          property.path,
          { value: property.value, sequenceTracks: property.sequenceTracks },
        ]),
      ),
    })
  for (const source of sources) {
    const selected = [...source.properties]
      .map(([path, property]) => ({
        path,
        property,
        tracks: array(property, 'sequenceTracks').filter(track =>
          sequenceMap.has(Number(field(track, 'sequenceIndex'))),
        ),
      }))
      .filter(item => item.tracks.length > 0)
    if (selected.length === 0) continue
    const mapped = materialMap.get(source.key)
    if (mapped === undefined)
      throw new TypeError(`animation attachment lacks material mapping for ${source.key}`)
    safeIndex(mapped, targetMaterials.length, 'attachment material')
    const targetExtension = object(
      field(field(array(result, 'materials')[mapped], 'extensions'), 'UV_game_material'),
      'target material extension',
    )
    if (targetExtension['shader'] !== RENDER_MATERIAL_SHADER)
      throw new TypeError('attachment material shaders differ')
    let targetParams = object(targetExtension['params'], 'target material params')
    createRenderMaterialSampler(targetParams, budget, signal)
    const targetProperties = properties(targetParams)
    for (const { path, property, tracks } of selected) {
      const targetProperty = targetProperties.get(path)
      if (targetProperty === undefined)
        throw new TypeError(`attachment material property is absent: ${path}`)
      const sourceValue = property['value'],
        targetValue = targetProperty['value']
      if (
        (Array.isArray(sourceValue) ? sourceValue.length : 1) !==
        (Array.isArray(targetValue) ? targetValue.length : 1)
      )
        throw new TypeError('attachment material property widths differ')
      const key = `${mapped}${path}`
      if (usedTargets.has(key))
        throw new TypeError('multiple attachment materials write the same property')
      usedTargets.add(key)
      // Installing sequenceTracks would change a legacy global fallback even with no selected
      // clip. That migration needs an explicit playback policy; attachment never guesses it.
      if (targetProperty['sequenceTracks'] === undefined && targetProperty['track'] !== undefined)
        throw new TypeError(
          'attachment requires explicit sequenceTracks for a target with a legacy fallback track',
        )
      const existing: JsonValue[] = [...array(targetProperty, 'sequenceTracks')]
      const sequences = new Set(existing.map(track => field(track, 'sequenceIndex')))
      for (const value of tracks) {
        const track = object(value, 'material sequence track')
        const sequenceIndex = sequenceMap.get(Number(track['sequenceIndex']))
        if (sequenceIndex === undefined || sequences.has(sequenceIndex))
          throw new TypeError('attachment material sequence collision')
        sequences.add(sequenceIndex)
        existing.push({ ...track, sequenceIndex })
      }
      targetParams = applyUvmJsonEdit(
        targetParams,
        { op: 'replace', path, value: { ...targetProperty, sequenceTracks: existing } },
        budget.maxDepth,
      )
    }
    createRenderMaterialSampler(targetParams, budget, signal)
    result = applyUvmJsonEdit(
      result,
      {
        op: 'replace',
        path: `/materials/${mapped}/extensions/UV_game_material/params`,
        value: targetParams,
      },
      budget.maxDepth,
    )
  }
  return result
}
