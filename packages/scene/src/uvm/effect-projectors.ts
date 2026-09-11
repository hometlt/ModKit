import type { JsonObject } from '@modkit/sdk'
import type { RenderProjector } from '@modkit/codec-kit/legacy/models'
import { array, object, safeIndex } from './values.js'
/** Index-preserving simulator inputs. Inactive declarations can still be impact templates. */
export function readEffectProjectors(
  document: JsonObject,
  maxNodes: number,
  maxBytes: number,
  signal?: AbortSignal,
): RenderProjector[] {
  if (
    !Number.isSafeInteger(maxNodes) ||
    maxNodes < 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0
  )
    throw new RangeError('invalid projector template budget')
  const effect = object(object(document['extensions'], 'extensions')['UV_game_effects'], 'effects'),
    raw = array(effect, 'projectors'),
    nodes = array(document, 'nodes'),
    materials = array(document, 'materials')
  if (raw.length > maxNodes || raw.length * 1024 > maxBytes)
    throw new RangeError('effect projector templates exceed budget')
  return raw.map((value, index) => {
    signal?.throwIfAborted()
    const entry = object(value, 'projector'),
      output: Record<string, unknown> = {
        name: typeof entry['name'] === 'string' ? entry['name'] : `projector-${index}`,
        boneIndex: safeIndex(entry['node'], nodes.length, 'projector node'),
        materialIndex: safeIndex(entry['material'], materials.length, 'projector material'),
      }
    const type = entry['projectionType']
    if (type !== 'orthographic' && type !== 'perspective')
      throw new TypeError('invalid projector projection type')
    output['projectionType'] = type
    const offset = array(entry, 'offset')
    if (offset.length !== 3 || offset.some(v => typeof v !== 'number' || !Number.isFinite(v)))
      throw new TypeError('invalid projector offset')
    output['offset'] = [...offset]
    for (const key of [
      'pitch',
      'yaw',
      'roll',
      'fieldOfView',
      'aspectRatio',
      'near',
      'far',
      'boxOffsetZBottom',
      'boxOffsetZTop',
      'boxOffsetXLeft',
      'boxOffsetXRight',
      'boxOffsetYFront',
      'boxOffsetYBack',
      'falloff',
      'alphaInit',
      'alphaMid',
      'alphaEnd',
      'attenuationDistance',
      'active',
      'layer',
      'flags',
    ]) {
      const scalar = entry[key]
      if (typeof scalar !== 'number' || !Number.isFinite(scalar))
        throw new TypeError(`invalid projector ${key}`)
      output[key] = scalar
    }
    for (const key of [
      'lifetimeAttack',
      'lifetimeAttackTo',
      'lifetimeHold',
      'lifetimeHoldTo',
      'lifetimeDecay',
      'lifetimeDecayTo',
    ]) {
      const scalar = entry[key]
      if (scalar === undefined) continue
      if (typeof scalar !== 'number' || !Number.isFinite(scalar) || scalar < 0)
        throw new TypeError(`invalid projector ${key}`)
      output[key] = scalar
    }
    return output as unknown as RenderProjector
  })
}
