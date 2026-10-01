import type { JsonObject, JsonValue } from '@modkit/sdk'
import { array, field, object, nonBlank, finite, oneOf } from './values.js'

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
    if (!nonBlank(gameMaterial['shader']))
      throw new TypeError(`${label} requires a shader identity`)
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
    if (!oneOf(teamColor['maskSource'], ['texture', 'vertexColor', 'paletteRange', 'whole'])) {
      throw new TypeError(`${label} has an invalid maskSource`)
    }
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
