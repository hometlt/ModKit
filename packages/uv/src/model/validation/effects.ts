import type { JsonObject, JsonValue } from '@modkit/sdk'
import {
  array,
  field,
  object,
  nonBlank,
  finite,
  integer,
  finiteArray,
  oneOf,
  safeIndex,
} from './values.js'

export function validateEffectsMetadata(
  document: JsonObject,
  used: readonly JsonValue[],
  signal?: AbortSignal,
): void {
  signal?.throwIfAborted()
  const extension = field(document['extensions'], 'UV_game_effects')
  if (extension === undefined) {
    if (used.includes('UV_game_effects'))
      throw new TypeError('UV_game_effects is declared but absent')
    return
  }
  if (!used.includes('UV_game_effects')) {
    throw new TypeError('UV_game_effects is not declared in extensionsUsed')
  }
  const effects = object(extension, 'UV_game_effects')
  if (
    effects['profile'] !== undefined &&
    !oneOf(effects['profile'], ['common', 'm3', 'mdx', 'w3d'])
  ) {
    throw new TypeError('UV_game_effects has an invalid profile')
  }
  if (
    effects['trackTimeUnit'] !== undefined &&
    !oneOf(effects['trackTimeUnit'], ['seconds', 'milliseconds'])
  ) {
    throw new TypeError('UV_game_effects has an invalid trackTimeUnit')
  }
  const nodes = array(document, 'nodes')
  const materials = array(document, 'materials')
  // Simulation values live in this explicit frame; renderers must not infer native axes
  // from a format profile or inspect a codec's private metadata.
  if (effects['spaceNode'] !== undefined)
    safeIndex(effects['spaceNode'], nodes.length, 'UV_game_effects spaceNode')
  for (const kind of ['particles', 'ribbons', 'forces', 'warps', 'projectors']) {
    const entries = effects[kind]
    if (entries === undefined) continue
    if (!Array.isArray(entries)) throw new TypeError(`UV_game_effects.${kind} must be an array`)
    for (const [index, candidate] of entries.entries()) {
      signal?.throwIfAborted()
      const entry = object(candidate, `UV_game_effects ${kind} ${index}`)
      if (!nonBlank(entry['name']))
        throw new TypeError(`UV_game_effects ${kind} ${index} needs a name`)
      safeIndex(entry['node'], nodes.length, `UV_game_effects ${kind} ${index} node`)
      if (oneOf(kind, ['particles', 'ribbons', 'projectors'])) {
        safeIndex(entry['material'], materials.length, `UV_game_effects ${kind} ${index} material`)
      }
      if (
        entry['maxParticles'] !== undefined &&
        (!integer(entry['maxParticles']) || entry['maxParticles'] < 0)
      ) {
        throw new RangeError(`UV_game_effects ${kind} ${index} maxParticles is invalid`)
      }
      if (entry['lifecycleSize'] !== undefined) {
        const lifecycle = object(
          entry['lifecycleSize'],
          `UV_game_effects ${kind} ${index} lifecycleSize`,
        )
        if (
          !finiteArray(lifecycle['start'], 3) ||
          !finiteArray(lifecycle['middle'], 3) ||
          !finiteArray(lifecycle['end'], 3) ||
          !finite(lifecycle['timeMiddle'])
        ) {
          throw new TypeError(`UV_game_effects ${kind} ${index} lifecycleSize is invalid`)
        }
      }
    }
  }
}
