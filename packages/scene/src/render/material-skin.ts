import type { SceneRendererPrimitive } from '@modkit/sdk/renderer'
import type { ModelSceneSkin } from '../model/sampler.js'

/** The pose a sampled skin takes on the GPU (see ModelSceneSkin), if the primitive has one. */
export function materialSkinOf(primitive: SceneRendererPrimitive): ModelSceneSkin | undefined {
  return (primitive as { readonly skin?: ModelSceneSkin }).skin
}

/**
 * The positions a primitive stands at, for work on the CPU (depth order, screen boxes): a skin
 * posed on the GPU is posed on the CPU once for them. A primitive prepared from a skin (the same
 * vertices, expanded or not) shares its source's pose, and with it its bounds.
 */
export function materialPosedPositions(primitive: SceneRendererPrimitive): Float32Array {
  return materialSkinOf(primitive)?.deformed().positions ?? primitive.positions
}

/**
 * The primitive as it stands, for work on the CPU that reads its vertices (picking, triangles the
 * caller writes itself): a skin posed on the GPU gets its pose's positions, normals and tangents.
 */
export function materialPosedPrimitive<T extends SceneRendererPrimitive>(primitive: T): T {
  const skin = materialSkinOf(primitive)
  if (skin === undefined) return primitive
  const deformed = skin.deformed()
  const { skin: _skin, ...rest } = primitive as T & { readonly skin?: ModelSceneSkin }
  return {
    ...rest,
    positions: deformed.positions,
    ...(deformed.normals === undefined ? {} : { normals: deformed.normals }),
    ...(deformed.tangents === undefined ? {} : { tangents: deformed.tangents }),
  } as unknown as T
}
