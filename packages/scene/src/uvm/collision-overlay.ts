import type { JsonObject } from '@modkit/sdk'
import type { SceneRendererPrimitive, SceneRendererDiagnostic } from '@modkit/sdk/renderer'
import {
  BoxGeometry,
  SphereGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  PlaneGeometry,
  Quaternion,
  Vector3,
  Matrix4,
  type BufferGeometry,
} from 'three'
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js'
import { validateUvmDocument } from '@modkit/uv/model/validation'
import { array, field, finiteArray, object, required, vector3 } from './values.js'
import { readCollisionMesh } from './collision-mesh.js'

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
// Fixed tessellation bounds all temporary Three geometry plus two owned render snapshots.
const WORKING_BYTES_PER_SHAPE = 65_536

/** Create render geometry for UVM volumes. This entrypoint has no codec/parser/host.
 * Curves are tessellated for display only; the document retains exact analytic dimensions.
 * Infinite planes use an explicitly reported finite preview; hulls use bounded convex tessellation.
 */
export function createUvmCollisionOverlay(
  document: JsonObject,
  binary: Uint8Array,
  budget: {
    readonly maxScalarBytes: number
    readonly maxShapes?: number
    readonly maxHullVertices?: number
    readonly planeExtent?: number
  },
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  if (!Number.isSafeInteger(budget.maxScalarBytes) || budget.maxScalarBytes < 0)
    throw new TypeError('invalid UVM collision overlay budget')
  const maxShapes = budget.maxShapes ?? 65_536
  const maxHullVertices = budget.maxHullVertices ?? 4096
  const planeExtent = budget.planeExtent ?? 2
  if (!Number.isSafeInteger(maxShapes) || maxShapes < 0) throw new TypeError('invalid maxShapes')
  if (!Number.isSafeInteger(maxHullVertices) || maxHullVertices < 0)
    throw new TypeError('invalid maxHullVertices')
  if (!Number.isFinite(planeExtent) || planeExtent <= 0) throw new TypeError('invalid planeExtent')
  validateUvmDocument(document, {
    binaryByteLength: binary.length,
    ...(signal === undefined ? {} : { signal }),
  })
  const records: { nodeId: string; id: string; shape: JsonObject }[] = []
  for (const [nodeIndex, node] of array(document, 'nodes').entries()) {
    signal?.throwIfAborted()
    const collision = field(field(node, 'extensions'), 'UV_game_collision')
    if (collision === undefined) continue
    for (const [index, value] of array(collision, 'shapes').entries()) {
      if (
        records.length >= maxShapes ||
        (records.length + 1) * WORKING_BYTES_PER_SHAPE > budget.maxScalarBytes
      )
        throw new RangeError('UVM collision overlay exceeds its working budget')
      records.push({
        nodeId: `node-${nodeIndex}`,
        id: `node-${nodeIndex}-collision-${index}`,
        shape: object(value, 'collision shape'),
      })
    }
  }
  const diagnostics: SceneRendererDiagnostic[] = []
  const prepared: {
    nodeId: string
    primitive: SceneRendererPrimitive
    local: readonly number[]
  }[] = []
  let workingBytes = records.length * WORKING_BYTES_PER_SHAPE
  for (const { nodeId, id, shape } of records) {
    signal?.throwIfAborted()
    const matrix = shape['matrix'] ?? IDENTITY
    if (!finiteArray(matrix, 16) || [3, 7, 11].some(i => matrix[i] !== 0) || matrix[15] !== 1)
      throw new TypeError('collision overlay requires finite affine local matrices')
    let geometry: BufferGeometry
    switch (shape['kind']) {
      case 'mesh':
      case 'convex-hull': {
        const mesh = readCollisionMesh(
          document,
          binary,
          shape,
          { maxScalarBytes: Math.floor((budget.maxScalarBytes - workingBytes) / 3) },
          signal,
        )
        const points = mesh.positions.length / 3
        const additionalBytes =
          mesh.scalarBytes * 3 + (shape['kind'] === 'convex-hull' ? points * 1024 : 0)
        workingBytes += additionalBytes
        if (!Number.isSafeInteger(workingBytes) || workingBytes > budget.maxScalarBytes)
          throw new RangeError('UVM collision overlay exceeds its working budget')
        if (shape['kind'] === 'mesh') {
          prepared.push({
            nodeId,
            local: [...matrix],
            primitive: {
              id,
              topology: 'triangles',
              positions: mesh.positions,
              indices: required(mesh.indices, 'collision mesh indices'),
              materialId: 'uvm-collision-overlay',
            },
          })
          continue
        }
        if (points > maxHullVertices) throw new RangeError('collision hull exceeds maxHullVertices')
        if (points < 4) throw new TypeError('collision hull needs at least four noncoplanar points')
        const vertices: Vector3[] = []
        for (let i = 0; i < mesh.positions.length; i += 3) {
          if (i % 4096 === 0) signal?.throwIfAborted()
          vertices.push(
            new Vector3(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]),
          )
        }
        try {
          geometry = new ConvexGeometry(vertices)
        } catch (cause) {
          throw new TypeError('collision hull could not form a closed convex volume', { cause })
        }
        signal?.throwIfAborted()
        break
      }
      case 'plane': {
        const normal = new Vector3(...vector3(shape['normal'])).normalize()
        geometry = new PlaneGeometry(planeExtent, planeExtent)
        geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), normal))
        diagnostics.push({
          severity: 'information',
          code: 'uvm/collision-plane-preview',
          primitiveId: id,
          message: `Infinite collision plane is displayed as a ${planeExtent} by ${planeExtent} local preview.`,
        })
        break
      }
      case 'box':
        geometry = new BoxGeometry(...vector3(shape['size']))
        break
      case 'sphere':
        geometry = new SphereGeometry(Number(shape['radius']), 12, 8)
        break
      case 'capsule':
        geometry = new CapsuleGeometry(Number(shape['radius']), Number(shape['height']), 4, 12)
        break
      case 'cylinder':
        geometry = new CylinderGeometry(
          Number(shape['radius']),
          Number(shape['radius']),
          Number(shape['height']),
          12,
          1,
        )
        break
      default:
        throw new TypeError(`unsupported UVM collision kind ${String(shape['kind'])}`)
    }
    try {
      if (shape['kind'] === 'capsule' || shape['kind'] === 'cylinder') {
        if (shape['axis'] === 'x') geometry.rotateZ(-Math.PI / 2)
        if (shape['axis'] === 'z') geometry.rotateX(Math.PI / 2)
      }
      const positions = Float32Array.from(geometry.getAttribute('position').array)
      const index = geometry.getIndex()
      const indices =
        index === null
          ? Uint32Array.from({ length: positions.length / 3 }, (_, i) => i)
          : Uint32Array.from(index.array)
      if (positions.length === 0 || !positions.every(Number.isFinite))
        throw new RangeError('collision dimensions exceed float32 render range')
      prepared.push({
        nodeId,
        local: [...matrix],
        primitive: {
          id,
          topology: 'triangles',
          positions,
          indices,
          materialId: 'uvm-collision-overlay',
        },
      })
    } finally {
      geometry.dispose()
    }
  }
  return Object.freeze({
    diagnostics: Object.freeze(diagnostics.map(item => Object.freeze(item))),
    /** Each call returns owned geometry and matrices. A mutated frame cannot corrupt later frames. */
    sample(
      nodeTransforms: ReadonlyMap<string, Float32Array>,
      signal?: AbortSignal,
      visibleNodeIds?: ReadonlySet<string>,
    ): readonly SceneRendererPrimitive[] {
      signal?.throwIfAborted()
      const visible =
        visibleNodeIds === undefined
          ? prepared
          : prepared.filter(item => visibleNodeIds.has(item.nodeId))
      for (const item of visible) {
        const world = required(nodeTransforms.get(item.nodeId), 'collision node world transform')
        if (
          world.length !== 16 ||
          !world.every(Number.isFinite) ||
          [3, 7, 11].some(i => world[i] !== 0) ||
          world[15] !== 1
        )
          throw new TypeError('collision overlay requires finite affine world matrices')
      }
      return visible.map(item => {
        signal?.throwIfAborted()
        const world = new Matrix4().fromArray(
          required(nodeTransforms.get(item.nodeId), 'collision node'),
        )
        const transform = Float32Array.from(
          world.multiply(new Matrix4().fromArray(item.local)).elements,
        )
        if (!transform.every(Number.isFinite))
          throw new RangeError('collision world transform exceeds float32 range')
        return {
          ...item.primitive,
          positions: new Float32Array(item.primitive.positions),
          indices: new Uint32Array(required(item.primitive.indices, 'collision indices')),
          transform,
        }
      })
    },
  })
}
