import type { ModelMaterialRef } from '@modkit/sdk'
import type { SceneRendererTeamColor, SceneRendererTexture } from '@modkit/sdk/renderer'

const TEAM_COLOR_SLOTS = new Set(['teamcolor', 'team'])
// the base colour layers, as the materializer's glTF slot table names them
const BASE_COLOR_SLOTS = new Set(['diffuse', 'basecolor', 'albedo', 'color'])
const CHANNELS: Readonly<Record<number, 'r' | 'g' | 'b' | 'a'>> = { 1: 'r', 2: 'g', 4: 'b', 8: 'a' }
const slotKey = (slot: string) => slot.toLowerCase().replace(/[^a-z0-9]/gu, '')

/**
 * A model material's team colour as a renderer draws it, from its team-colour layer (slot
 * `teamColor` or `team`, as publishers and UVM's UV_game_material_team_color state it): `whole`
 * without a resource, else the layer's resource as the mask — its texture found in `textures` by
 * resource id, its channel from the layer's channel bits (one bit names a channel, else `rgb`) —
 * with the layer's rule (ModelTeamColorRule): a key over the mask's stored channels, whose source is
 * the base colour when the layer names no resource; an indexed ramp; the object's tint as the
 * colour; the mask's colour tinting it. Undefined when the material has no such layer, its mask
 * texture did not arrive, or the mask reads other UVs than `uvSource`, which it is sampled with.
 */
export function modelMaterialTeamColor(
  material: ModelMaterialRef,
  textures: ReadonlyMap<string, SceneRendererTexture>,
  uvSource: number,
): SceneRendererTeamColor | undefined {
  const layer = material.layers?.find(candidate => TEAM_COLOR_SLOTS.has(slotKey(candidate.slot)))
  if (layer === undefined) return undefined
  const rule = layer.teamColor
  const common = {
    blend: layer.blend ?? 'multiply',
    ...(rule?.strength === undefined ? {} : { strength: rule.strength }),
    ...(rule?.defaultColor === undefined ? {} : { defaultColor: rule.defaultColor }),
    ...(rule?.colorSource === 'object-tint' ? { source: 'object-tint' as const } : {}),
    ...(rule?.tint === 'mask-rgb' ? { tint: 'mask-rgb' as const } : {}),
  }
  // a key reads the base colour when the layer names no texture of its own
  const source =
    layer.resourceId === undefined && rule?.maskSource === 'channelKey'
      ? material.layers?.find(
          candidate =>
            BASE_COLOR_SLOTS.has(slotKey(candidate.slot)) && candidate.resourceId !== undefined,
        )
      : layer
  if (source?.resourceId === undefined)
    return rule?.maskSource === undefined ? { mask: 'whole', ...common } : undefined
  const texture = textures.get(source.resourceId)
  if (texture === undefined || (source.uvSource ?? 0) !== uvSource) return undefined
  const channel = CHANNELS[layer.colorChannels ?? 0]
  if (rule?.maskSource === 'channelKey')
    return {
      mask: { texture: texture.id, channel: channel ?? 'rgb' },
      ...common,
      key: {
        channels: rule.keyChannels ?? ['r', 'g'],
        threshold: rule.keyThreshold ?? 0,
        intensity: rule.intensityChannel ?? 'b',
      },
    }
  if (rule?.maskSource === 'paletteRange')
    return rule.ramp === undefined || rule.range === undefined
      ? undefined
      : {
          // the indices are one scalar channel
          mask: { texture: texture.id, channel: channel ?? 'r' },
          ...common,
          ramp: {
            shades: rule.ramp,
            first: rule.range[0],
            scale: rule.paletteIndexScale ?? 255,
          },
        }
  return { mask: { texture: texture.id, channel: channel ?? 'rgb' }, ...common }
}
