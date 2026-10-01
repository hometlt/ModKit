import type { ModelMaterialRef } from '@modkit/sdk'
import type { SceneRendererTeamColor, SceneRendererTexture } from '@modkit/sdk/renderer'

const TEAM_COLOR_SLOTS = new Set(['teamcolor', 'team'])
const CHANNELS: Readonly<Record<number, 'r' | 'g' | 'b' | 'a'>> = { 1: 'r', 2: 'g', 4: 'b', 8: 'a' }
const slotKey = (slot: string) => slot.toLowerCase().replace(/[^a-z0-9]/gu, '')

/**
 * A model material's team colour as a renderer draws it, from its team-colour layer (slot
 * `teamColor` or `team`, as publishers and UVM's UV_game_material_team_color state it): `whole`
 * without a resource, else the layer's resource as the mask — its texture found in `textures` by
 * resource id, its channel from the layer's channel bits (one bit names a channel, else `rgb`).
 * Undefined when the material has no such layer, its mask texture did not arrive, or the mask
 * reads other UVs than `uvSource`, the base colour's, which it is sampled with.
 */
export function modelMaterialTeamColor(
  material: ModelMaterialRef,
  textures: ReadonlyMap<string, SceneRendererTexture>,
  uvSource: number,
): SceneRendererTeamColor | undefined {
  const layer = material.layers?.find(candidate => TEAM_COLOR_SLOTS.has(slotKey(candidate.slot)))
  if (layer === undefined) return undefined
  const blend = layer.blend ?? 'multiply'
  if (layer.resourceId === undefined) return { mask: 'whole', blend }
  const texture = textures.get(layer.resourceId)
  if (texture === undefined || (layer.uvSource ?? 0) !== uvSource) return undefined
  return {
    mask: { texture: texture.id, channel: CHANNELS[layer.colorChannels ?? 0] ?? 'rgb' },
    blend,
  }
}
