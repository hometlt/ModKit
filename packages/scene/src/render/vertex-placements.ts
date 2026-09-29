import type { SceneRendererPrimitive } from '@modkit/sdk/renderer'
import type { MaterialDraw } from './material-draws.js'
import { materialModelMatrix } from './material-geometry.js'
import { materialSkinOf } from './material-skin.js'
import { primitiveVertexTints } from './tint.js'

/**
 * Model matrices per vertex (sixteen column-major floats each): the placement vertex stage reads a
 * vertex's matrix as it reads a draw's or an instance's, so draws of one material placed apart draw
 * as one primitive (see mergeMaterialDraws). The positions stay in each placement's model space and
 * the primitive has no `transform` of its own.
 */
export function primitiveVertexPlacements(
  primitive: SceneRendererPrimitive,
): Float32Array | undefined {
  return (primitive as { readonly vertexPlacements?: Float32Array }).vertexPlacements
}

/**
 * Draws of one material program as one draw: their vertices one after another, each with its draw's
 * model matrix (primitiveVertexPlacements) and its own attributes, so every vertex computes what it
 * computed in its own draw and the triangles rasterize and blend in the order of the draws. Draws of
 * one program already share everything else a draw sets (textures, uniforms, blending; the caller
 * checks their depth bias and tint). Undefined where the primitives do not lay out alike (attributes
 * present, sizes, UV sets, indexing) or one is skinned or placed already.
 */
export function mergeMaterialDraws<Draw extends MaterialDraw>(
  draws: readonly Draw[],
): Draw | undefined {
  const first = draws[0]
  if (first === undefined) return undefined
  if (draws.length === 1) return first
  const primitives = draws.map(draw => draw.primitive)
  const lead = first.primitive
  const indexed = lead.indices !== undefined
  let vertices = 0,
    corners = 0
  // Strips and fans would join their last and first vertices.
  for (const primitive of primitives) {
    if (
      primitive.topology !== 'triangles' ||
      (primitive.indices !== undefined) !== indexed ||
      primitive.positions.length % 3 !== 0 ||
      materialSkinOf(primitive) !== undefined ||
      primitiveVertexPlacements(primitive) !== undefined
    )
      return undefined
    vertices += primitive.positions.length / 3
    corners += primitive.indices?.length ?? 0
  }
  // One array per attribute, or undefined when no draw has it; a draw without it where another has
  // it, or with another size per vertex, cannot join.
  let aligned = true
  const joined = (
    pick: (primitive: SceneRendererPrimitive) => Float32Array | undefined,
    size: number,
  ): Float32Array | undefined => {
    if (pick(lead) === undefined) {
      if (primitives.some(primitive => pick(primitive) !== undefined)) aligned = false
      return undefined
    }
    const output = new Float32Array(vertices * size)
    let at = 0
    for (const primitive of primitives) {
      const values = pick(primitive)
      if (values === undefined || values.length !== (primitive.positions.length / 3) * size) {
        aligned = false
        return undefined
      }
      output.set(values, at)
      at += values.length
    }
    return output
  }
  const positions = joined(primitive => primitive.positions, 3)!
  const normals = joined(primitive => primitive.normals, 3)
  const tangents = joined(primitive => primitive.tangents, 4)
  const colors = joined(primitive => primitive.colors, 4)
  const textureCoordinates = joined(primitive => primitive.textureCoordinates, 2)
  const vertexTints = joined(primitiveVertexTints, 4)
  const leadSets = lead.textureCoordinateSets
  const textureCoordinateSets = leadSets?.map((leadSet, index) => {
    const setOf = (primitive: SceneRendererPrimitive) => {
      const set = primitive.textureCoordinateSets?.[index]
      if (set?.set !== leadSet.set) aligned = false
      return set?.coordinates
    }
    // A set every draw shares with its UV0 (an effect sprite's masks) stays one array.
    const shared =
      textureCoordinates !== undefined &&
      primitives.every(primitive => setOf(primitive) === primitive.textureCoordinates)
    return {
      set: leadSet.set,
      coordinates: shared ? textureCoordinates : (joined(setOf, 2) ?? new Float32Array(0)),
    }
  })
  if (
    primitives.some(
      primitive => (primitive.textureCoordinateSets?.length ?? 0) !== (leadSets?.length ?? 0),
    )
  )
    aligned = false
  if (!aligned) return undefined
  let indices: Uint32Array | undefined
  if (indexed) {
    indices = new Uint32Array(corners)
    let corner = 0,
      base = 0
    for (const primitive of primitives) {
      for (const index of primitive.indices!) indices[corner++] = index + base
      base += primitive.positions.length / 3
    }
  }
  const vertexPlacements = new Float32Array(vertices * 16)
  let vertex = 0
  for (const primitive of primitives) {
    const model = materialModelMatrix(primitive)
    for (let end = vertex + primitive.positions.length / 3; vertex < end; vertex++)
      vertexPlacements.set(model, vertex * 16)
  }
  const { transform: _transform, indices: _indices, ...rest } = lead
  const primitive: SceneRendererPrimitive & {
    readonly vertexTints?: Float32Array
    readonly vertexPlacements: Float32Array
  } = {
    ...rest,
    positions,
    ...(normals === undefined ? {} : { normals }),
    ...(tangents === undefined ? {} : { tangents }),
    ...(colors === undefined ? {} : { colors }),
    ...(textureCoordinates === undefined ? {} : { textureCoordinates }),
    ...(textureCoordinateSets === undefined ? {} : { textureCoordinateSets }),
    ...(indices === undefined ? {} : { indices }),
    ...(vertexTints === undefined ? {} : { vertexTints }),
    vertexPlacements,
  }
  return { ...first, primitive }
}
