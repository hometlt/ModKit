/**
 * Scene-owned posed skin surface queries for codec-kit's rigid voxel binding.
 * Reuses Three Triangle/Box3 closest-point and barycentric geometry. Positions and cell centres
 * must already share a reference pose, frame and units; joint slots retain the caller's binding
 * order. Does not sample animation, deform skins, voxelize meshes or serialize UVM data.
 * Positions are snapshotted into bounded triangle queries; skin buffers remain borrowed until
 * binding finishes. Count/input-byte limits do not bound total Three/JS object heap. Portable,
 * synchronous and cooperatively cancellable; no Host, filesystem, DOM or GPU imports.
 */
import { Box3, Line3, Triangle, Vector3 } from 'three'
import type { VoxelBindingTriangle } from '@modkit/codec-kit/model/geometry'

export interface VoxelSkinSurfaceMesh {
  readonly positions: Float32Array | Float64Array
  readonly indices?: Uint32Array
  readonly joints: ArrayLike<number>
  readonly weights: ArrayLike<number>
  readonly influences?: 4 | 8
}

export interface VoxelSkinSurfaceOptions {
  readonly maxMeshes?: number
  readonly maxTriangles?: number
  readonly maxVertices?: number
  readonly maxInputBytes?: number
  readonly signal?: AbortSignal
}

/** Refuse invalid and overflowing aggregate surface limits before allocating Three objects. */
function limit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`invalid ${label}`)
  return value
}

/** Build ordered closest-surface queries over one explicit shared joint-slot namespace. */
export function createVoxelBindingSurface(
  meshes: readonly VoxelSkinSurfaceMesh[],
  options: VoxelSkinSurfaceOptions = {},
): readonly VoxelBindingTriangle[] {
  const { signal } = options
  signal?.throwIfAborted()
  const maxMeshes = limit(options.maxMeshes ?? 4096, 'maxMeshes')
  if (meshes.length > maxMeshes) throw new RangeError('surface exceeds maxMeshes')
  const maxTriangles = limit(options.maxTriangles ?? 250_000, 'maxTriangles')
  const maxVertices = limit(options.maxVertices ?? 1_000_000, 'maxVertices')
  const maxBytes = limit(options.maxInputBytes ?? 256 * 1024 ** 2, 'maxInputBytes')
  let vertices = 0,
    triangles = 0,
    bytes = 0
  for (const mesh of meshes) {
    signal?.throwIfAborted()
    if (!(mesh.positions instanceof Float32Array || mesh.positions instanceof Float64Array))
      throw new TypeError('surface positions must be a float array')
    const count = mesh.positions.length / 3,
      width = mesh.influences ?? 4
    if (
      !Number.isSafeInteger(count) ||
      (width !== 4 && width !== 8) ||
      mesh.joints.length !== count * width ||
      mesh.weights.length !== count * width
    )
      throw new TypeError('surface requires matching positions, joints and weights')
    if (mesh.indices !== undefined && !(mesh.indices instanceof Uint32Array))
      throw new TypeError('surface indices must be Uint32Array')
    const corners = mesh.indices?.length ?? count
    if (corners % 3 !== 0)
      throw new TypeError('surface requires triangle indices or vertex triples')
    vertices += count
    triangles += corners / 3
    bytes += mesh.positions.byteLength + (mesh.indices?.byteLength ?? 0) + count * width * 16
    if (!Number.isSafeInteger(vertices) || vertices > maxVertices)
      throw new RangeError('surface exceeds maxVertices')
    if (!Number.isSafeInteger(triangles) || triangles > maxTriangles)
      throw new RangeError('surface exceeds maxTriangles')
    if (!Number.isSafeInteger(bytes) || bytes > maxBytes)
      throw new RangeError('surface exceeds maxInputBytes')
  }
  const result: VoxelBindingTriangle[] = []
  const point = new Vector3(),
    segmentPoint = new Vector3(),
    closest = new Vector3(),
    bary = new Vector3()
  for (const mesh of meshes) {
    const count = mesh.positions.length / 3,
      corners = mesh.indices?.length ?? count
    for (let i = 0; i < mesh.positions.length; i++) {
      if ((i & 1023) === 0) signal?.throwIfAborted()
      if (!Number.isFinite(mesh.positions[i]))
        throw new TypeError('nonfinite posed surface position')
    }
    for (let i = 0; i < corners; i += 3) {
      if ((i & 1023) === 0) signal?.throwIfAborted()
      const indices: [number, number, number] = [
        mesh.indices?.[i] ?? i,
        mesh.indices?.[i + 1] ?? i + 1,
        mesh.indices?.[i + 2] ?? i + 2,
      ]
      if (indices.some(index => index >= count))
        throw new TypeError('surface index is out of range')
      const points = indices.map(index => new Vector3().fromArray(mesh.positions, index * 3))
      const triangle = new Triangle(points[0]!, points[1]!, points[2]!),
        box = new Box3().setFromPoints(points)
      const edgeSquared = Math.max(
        triangle.a.distanceToSquared(triangle.b),
        triangle.b.distanceToSquared(triangle.c),
        triangle.c.distanceToSquared(triangle.a),
      )
      // Gram-matrix cancellation makes barycentric votes unreliable on nearly collinear faces.
      // Use Three's area/segments and the existing explicit degenerate-policy path, never clamp votes.
      const illConditioned = (2 * triangle.getArea()) ** 2 <= 64 * Number.EPSILON * edgeSquared ** 2
      let edges: readonly Line3[] | undefined
      result.push({
        vertices: indices,
        joints: mesh.joints,
        weights: mesh.weights,
        influences: mesh.influences ?? 4,
        /** Conservative lower bound used by the shared ordered traversal. */
        boundsDistance(p) {
          return box.distanceToPoint(point.set(...p))
        },
        /** Three supplies zero barycentric weights for degenerate triangles; Core applies caller policy. */
        closestDistance(p, out) {
          point.set(...p)
          triangle.closestPointToPoint(point, closest)
          let degenerate = illConditioned || triangle.getBarycoord(closest, bary) === null
          // A finite Three result may still be outside the barycentric simplex through cancellation.
          // Such a query cannot supply skin weights; report degeneracy through the existing policy.
          const total = bary.x + bary.y + bary.z
          const unstable = illConditioned || !Number.isFinite(total)
            || Math.abs(total - 1) > 1e-6
            || Math.min(bary.x, bary.y, bary.z) < -1e-6 || Math.max(bary.x, bary.y, bary.z) > 1 + 1e-6
          if (unstable) { degenerate = true; bary.set(0, 0, 0) }
          // Three's triangle query can divide by zero on a collapsed edge. Its segment query
          // covers that unsupported case without changing finite queries from the accepted corpus.
          if (degenerate && (unstable || !Number.isFinite(closest.distanceTo(point)))) {
            edges ??= [
              new Line3(triangle.a, triangle.b),
              new Line3(triangle.b, triangle.c),
              new Line3(triangle.c, triangle.a),
            ]
            let best = Infinity
            for (const edge of edges) {
              if (edge.start.equals(edge.end)) segmentPoint.copy(edge.start)
              else edge.closestPointToPoint(point, true, segmentPoint)
              const distance = segmentPoint.distanceTo(point)
              if (distance < best) {
                best = distance
                closest.copy(segmentPoint)
              }
            }
          }
          out.set([bary.x, bary.y, bary.z])
          return closest.distanceTo(point)
        },
      })
    }
  }
  signal?.throwIfAborted()
  return result
}
