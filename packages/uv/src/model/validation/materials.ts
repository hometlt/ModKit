import type { JsonObject, JsonValue } from '@modkit/sdk'
import { array, field, object, nonBlank, finite, oneOf } from './values.js'

/** `UV_game_material.blendMode` values; other native equations stay in extras. */
const UVM_GAME_BLEND_MODES = [
  'opaque',
  'alpha-blend',
  'alpha-test',
  'additive',
  'add-alpha',
  'modulate',
  'modulate2x',
  'alpha-key',
  'screen',
  'subtract',
] as const
export type UvmGameBlendMode = (typeof UVM_GAME_BLEND_MODES)[number]
export const isUvmGameBlendMode = (value: unknown): value is UvmGameBlendMode =>
  (UVM_GAME_BLEND_MODES as readonly unknown[]).includes(value)

export function validateGameMaterialMetadata(
  document: JsonObject,
  used: readonly JsonValue[],
  signal?: AbortSignal,
): void {
  signal?.throwIfAborted()
  let extensionCount = 0
  for (const [materialIndex, candidate] of array(document, 'materials').entries()) {
    signal?.throwIfAborted()
    const material = object(candidate, `material ${materialIndex}`)
    const extension = field(material['extensions'], 'UV_game_material')
    if (extension === undefined) continue
    extensionCount += 1
    const label = `material ${materialIndex} UV_game_material`
    if (!used.includes('UV_game_material')) {
      throw new TypeError(`${label} is not declared in extensionsUsed`)
    }
    const gameMaterial = object(extension, label)
    if (Object.hasOwn(gameMaterial, 'shader')) {
      if (!nonBlank(gameMaterial['shader']))
        throw new TypeError(`${label} requires a shader identity`)
    } else {
      const keys = Object.keys(gameMaterial)
      if (
        keys.length === 0 ||
        keys.some(
          key =>
            (key !== 'blendMode' && key !== 'depthWrite' && key !== 'sortPriority') ||
            gameMaterial[key] === undefined,
        )
      )
        throw new TypeError(`${label} requires nonempty fixed state or a shader identity`)
      if (
        Object.hasOwn(gameMaterial, 'blendMode') &&
        !isUvmGameBlendMode(gameMaterial['blendMode'])
      )
        throw new TypeError(`${label} has an unknown fixed-state blend mode`)
    }
    if (gameMaterial['depthWrite'] !== undefined && typeof gameMaterial['depthWrite'] !== 'boolean')
      throw new TypeError(`${label} depthWrite must be boolean`)
    if (
      gameMaterial['sortPriority'] !== undefined &&
      !Number.isSafeInteger(gameMaterial['sortPriority'])
    )
      throw new TypeError(`${label} sortPriority must be an integer`)
    const params =
      gameMaterial['params'] === undefined
        ? {}
        : object(gameMaterial['params'], `${label} parameters`)
    const snapshot = params['renderModel']
    if (snapshot === undefined) continue
    const renderModel = object(snapshot, `${label} neutral snapshot`)
    if (renderModel['version'] !== 1) {
      throw new TypeError(`${label} neutral snapshot has an unsupported version`)
    }
    if (renderModel['standard'] === undefined && renderModel['composite'] === undefined) {
      throw new TypeError(`${label} neutral snapshot has no material payload`)
    }
    if (renderModel['standard'] !== undefined) {
      object(renderModel['standard'], `${label} standard material`)
    }
    if (renderModel['composite'] !== undefined) {
      object(renderModel['composite'], `${label} composite material`)
    }
  }
  if (used.includes('UV_game_material') && extensionCount === 0) {
    throw new TypeError('UV_game_material is declared but absent')
  }
}

const integerIn = (value: JsonValue | undefined, minimum: number, maximum: number) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum

const unitRgb = (value: JsonValue | undefined) =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every(component => typeof component === 'number' && component >= 0 && component <= 1)

/**
 * The common recolouring fields of Runtime 02.10 (SPEC_UVM_EXTENSIONS): a key or an exact ramp is
 * stated with `replace`, a key has a source texture, and a ramp its mask, its range and one shade
 * per index of the range.
 */
function validateTeamColorRule(teamColor: JsonObject, material: JsonObject, label: string): void {
  const channels = teamColor['keyChannels']
  if (
    channels !== undefined &&
    (!Array.isArray(channels) ||
      channels.length === 0 ||
      channels.some(channel => !oneOf(channel, ['r', 'g', 'b'])) ||
      new Set(channels).size !== channels.length)
  )
    throw new TypeError(`${label} has invalid keyChannels`)
  if (teamColor['keyThreshold'] !== undefined && !integerIn(teamColor['keyThreshold'], 0, 255))
    throw new TypeError(`${label} has an invalid keyThreshold`)
  for (const [key, values] of [
    ['intensityChannel', ['r', 'g', 'b', 'a']],
    ['colorSource', ['team', 'object-tint']],
    ['tint', ['none', 'mask-rgb']],
  ] as const)
    if (teamColor[key] !== undefined && !oneOf(teamColor[key], [...values]))
      throw new TypeError(`${label} has an invalid ${key}`)
  const scale = teamColor['paletteIndexScale'] ?? 255
  if (!integerIn(scale, 1, 65535)) throw new TypeError(`${label} has an invalid paletteIndexScale`)
  const range = teamColor['range']
  if (
    range !== undefined &&
    (!Array.isArray(range) ||
      range.length !== 2 ||
      !integerIn(range[0], 0, scale as number) ||
      !integerIn(range[1], range[0] as number, scale as number))
  )
    throw new TypeError(`${label} has an invalid range`)
  if (teamColor['defaultColor'] !== undefined) {
    const color = teamColor['defaultColor']
    if (!Array.isArray(color) || color.length !== 4 || !unitRgb(color.slice(0, 3)))
      throw new TypeError(`${label} has an invalid defaultColor`)
  }
  const keyed = teamColor['maskSource'] === 'channelKey'
  const ramp = teamColor['ramp']
  if ((keyed || ramp !== undefined) && teamColor['blend'] !== 'replace')
    throw new TypeError(`${label} states a key or a ramp without blend replace`)
  if (
    keyed &&
    teamColor['maskTexture'] === undefined &&
    field(material['pbrMetallicRoughness'], 'baseColorTexture') === undefined
  )
    throw new TypeError(`${label} keys no texture`)
  if (ramp !== undefined) {
    const span = Array.isArray(range) ? (range[1] as number) - (range[0] as number) + 1 : -1
    if (
      teamColor['maskSource'] !== 'paletteRange' ||
      teamColor['maskTexture'] === undefined ||
      !Array.isArray(ramp) ||
      ramp.length !== span ||
      !ramp.every(unitRgb)
    )
      throw new TypeError(`${label} has a ramp without its mask, range or one shade per index`)
  }
}

export function validateTeamColorMetadata(
  document: JsonObject,
  used: readonly JsonValue[],
  signal?: AbortSignal,
): void {
  signal?.throwIfAborted()
  let extensionCount = 0
  for (const [materialIndex, candidate] of array(document, 'materials').entries()) {
    signal?.throwIfAborted()
    const material = object(candidate, `material ${materialIndex}`)
    const extension = field(material['extensions'], 'UV_game_material_team_color')
    if (extension === undefined) continue
    extensionCount += 1
    const label = `material ${materialIndex} UV_game_material_team_color`
    if (!used.includes('UV_game_material_team_color')) {
      throw new TypeError(`${label} is not declared in extensionsUsed`)
    }
    const teamColor = object(extension, label)
    if (
      !oneOf(teamColor['maskSource'], [
        'texture',
        'vertexColor',
        'paletteRange',
        'whole',
        'channelKey',
      ])
    ) {
      throw new TypeError(`${label} has an invalid maskSource`)
    }
    validateTeamColorRule(teamColor, material, label)
    if (
      teamColor['blend'] !== undefined &&
      !oneOf(teamColor['blend'], ['multiply', 'add', 'replace', 'overlay', 'lerp'])
    ) {
      throw new TypeError(`${label} has an invalid blend`)
    }
    if (
      teamColor['targets'] !== undefined &&
      (!Array.isArray(teamColor['targets']) ||
        teamColor['targets'].length === 0 ||
        teamColor['targets'].some(
          target => !oneOf(target, ['baseColor', 'emissive', 'specular']),
        ) ||
        new Set(teamColor['targets']).size !== teamColor['targets'].length)
    ) {
      throw new TypeError(`${label} has invalid targets`)
    }
    if (
      teamColor['strength'] !== undefined &&
      (!finite(teamColor['strength']) || teamColor['strength'] < 0)
    ) {
      throw new TypeError(`${label} has an invalid strength`)
    }
    const renderModel = field(teamColor['extras'], 'renderModel')
    if (renderModel !== undefined) {
      const remap = object(renderModel, `${label} neutral remap`)
      if (
        remap['target'] !== 'team-color' ||
        !oneOf(remap['operation'], ['replace', 'multiply', 'hsv-shade', 'grain-merge'])
      ) {
        throw new TypeError(`${label} has invalid neutral remap metadata`)
      }
    }
  }
  if (used.includes('UV_game_material_team_color') && extensionCount === 0) {
    throw new TypeError('UV_game_material_team_color is declared but absent')
  }
}
