import type { JsonObject } from '@modkit/sdk'
import type { RenderCollisionShape } from '@modkit/codec-kit/legacy/models'
import { array, object, field, finiteArray } from './values.js'
import { readCollisionMesh } from './collision-mesh.js'
import { multiplyMaterialFrames, IDENTITY_MATERIAL_FRAME } from '../materials/frame.js'

/** Semantic UVM physics volumes -> existing swept primitive kernel. ATVL/effect volumes are
 * not physics solids. No rendered mesh or local filesystem becomes an implicit world collider. */
export function readEffectCollisionShapes(
  document: JsonObject,
  binary: Uint8Array,
  options: {
    readonly activeNodes: ReadonlySet<string>
    readonly maxNodes: number
    readonly maxBytes: number
    readonly warn: (message: string) => void
    readonly signal?: AbortSignal
  },
) {
  if (
    !Number.isSafeInteger(options.maxNodes) ||
    options.maxNodes < 0 ||
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes < 0
  )
    throw new RangeError('invalid effect collision budget')
  const shapes: RenderCollisionShape[] = []
  let bytes = 0,
    nodes = 0
  for (const [nodeIndex, rawNode] of array(document, 'nodes').entries()) {
    options.signal?.throwIfAborted()
    if (!options.activeNodes.has(`node-${nodeIndex}`)) continue
    const raw = field(field(rawNode, 'extensions'), 'UV_game_collision')
    if (raw === undefined) continue
    const extension = object(raw, 'collision')
    if (extension['role'] !== 'physics') continue
    for (const rawShape of array(extension, 'shapes')) {
      if (++nodes > options.maxNodes || (bytes += 512) > options.maxBytes)
        throw new RangeError('effect collision shapes exceed budget')
      const shape = object(rawShape, 'physics shape'),
        kind = shape['kind']
      const rawMatrix = shape['matrix'] ?? [...IDENTITY_MATERIAL_FRAME]
      if (
        !finiteArray(rawMatrix, 16) ||
        rawMatrix[3] !== 0 ||
        rawMatrix[7] !== 0 ||
        rawMatrix[11] !== 0 ||
        rawMatrix[15] !== 1
      )
        throw new TypeError('effect collision matrix must be affine')
      let matrix: readonly number[] = rawMatrix
      const positive = (value: unknown) => {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
          throw new TypeError('invalid effect collision dimension')
        return value
      }
      let size: readonly [number, number, number]
      let vertices: readonly (readonly [number, number, number])[] | undefined
      if (kind === 'box') {
        const dimensions = array(shape, 'size')
        if (dimensions.length !== 3) throw new TypeError('physics box requires xyz size')
        size = [positive(dimensions[0]), positive(dimensions[1]), positive(dimensions[2])]
      } else if (kind === 'sphere') size = [positive(shape['radius']), 1, 1]
      else if (kind === 'capsule' || kind === 'cylinder') {
        size = [positive(shape['radius']), positive(shape['height']), 1]
        const axis = shape['axis'] ?? 'y'
        if (!['x', 'y', 'z'].includes(String(axis)))
          throw new TypeError('invalid physics axial direction')
        if (axis !== 'y')
          matrix = multiplyMaterialFrames(
            matrix,
            axis === 'z'
              ? [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]
              : [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          )
      } else if (kind === 'mesh' || kind === 'convex-hull') {
        const mesh = readCollisionMesh(
            document,
            binary,
            shape,
            { maxScalarBytes: options.maxBytes - bytes },
            options.signal,
          ),
          count = mesh.positions.length / 3
        bytes += mesh.scalarBytes + count * 32
        nodes += count
        if (bytes > options.maxBytes || nodes > options.maxNodes)
          throw new RangeError('effect collision vertices exceed budget')
        const points: Array<readonly [number, number, number]> = []
        for (let index = 0; index < mesh.positions.length; index += 3) {
          options.signal?.throwIfAborted()
          const x = mesh.positions[index],
            y = mesh.positions[index + 1],
            z = mesh.positions[index + 2]
          if (x === undefined || y === undefined || z === undefined)
            throw new TypeError('incomplete collision vertex')
          points.push([x, y, z])
        }
        vertices = points
        size = [1, 1, 1]
        options.warn(
          `${kind} effect collision uses the existing swept local-bounds approximation; original geometry is retained.`,
        )
      } else {
        options.warn(
          `physics ${String(kind)} has no existing effect collision kernel; it was not substituted with a solid.`,
        )
        continue
      }
      shapes.push({
        kind,
        boneIndex: nodeIndex,
        matrix: [...matrix],
        size,
        ...(vertices === undefined ? {} : { vertices }),
      })
    }
  }
  return { shapes, bytes, nodes }
}
