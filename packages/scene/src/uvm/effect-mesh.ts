import type { JsonObject } from '@modkit/sdk'
import { readUvmAccessor } from '@modkit/uv/model/accessor'
import type { RenderParticleEmissionMesh } from '@modkit/codec-kit/legacy/models'
import { object } from './values.js'

/** Decode owned emission surfaces; reserve the simulator's triangle-area table as well. */
export function readUvmEffectMeshes(
  document: JsonObject,
  binary: Uint8Array,
  value: unknown,
  budget: { readonly maxBytes: number; readonly maxNodes: number },
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  if (![budget.maxBytes, budget.maxNodes].every(limit => Number.isSafeInteger(limit) && limit >= 0))
    throw new RangeError('invalid effect mesh budget')
  if (!Array.isArray(value) || value.length === 0)
    throw new TypeError('effect mesh emission requires nonempty emitShapeMeshes')
  const meshes: RenderParticleEmissionMesh[] = []
  let bytes = 0,
    nodes = 0,
    totalArea = 0
  for (const valueEntry of value) {
    signal?.throwIfAborted()
    const entry = object(valueEntry, 'effect emission mesh')
    bytes += 256
    if (++nodes > budget.maxNodes || bytes > budget.maxBytes)
      throw new RangeError('effect emission meshes exceed budget')
    const positions = readUvmAccessor(
      document,
      binary,
      entry['positions'],
      { maxScalarBytes: Math.min(budget.maxBytes - bytes, (budget.maxNodes - nodes) * 12) },
      'effect emission positions',
      signal,
    )
    if (
      positions.width !== 3 ||
      positions.componentType !== 5126 ||
      positions.normalized ||
      positions.count === 0 ||
      !(positions.values instanceof Float32Array) ||
      !positions.values.every(Number.isFinite)
    )
      throw new TypeError('effect emission positions must be finite nonempty float VEC3')
    bytes += positions.values.byteLength
    nodes += positions.count
    if (nodes > budget.maxNodes) throw new RangeError('effect emission vertices exceed node budget')
    const indices = readUvmAccessor(
      document,
      binary,
      entry['indices'],
      {
        maxScalarBytes: Math.min(
          Math.floor((budget.maxBytes - bytes) / 20) * 12,
          (budget.maxNodes - nodes) * 12,
        ),
      },
      'indices',
      signal,
    )
    if (
      indices.width !== 1 ||
      ![5121, 5123, 5125].includes(indices.componentType) ||
      indices.normalized ||
      indices.count === 0 ||
      indices.count % 3 !== 0
    )
      throw new TypeError('effect emission indices must form unsigned integer triangles')
    bytes += indices.values.byteLength + (indices.count / 3) * Float64Array.BYTES_PER_ELEMENT
    nodes += indices.count / 3
    if (nodes > budget.maxNodes || bytes > budget.maxBytes)
      throw new RangeError('effect emission triangles exceed budget')
    let area = 0
    const coordinate = (vertex: number, component: number): number => {
      const scalar = positions.values[vertex * 3 + component]
      if (scalar === undefined) throw new RangeError('effect emission index exceeds positions')
      return scalar
    }
    for (let offset = 0; offset < indices.count; offset += 3) {
      if (offset % 4096 === 0) signal?.throwIfAborted()
      const a = indices.values[offset],
        b = indices.values[offset + 1],
        c = indices.values[offset + 2]
      if (
        a === undefined ||
        b === undefined ||
        c === undefined ||
        a >= positions.count ||
        b >= positions.count ||
        c >= positions.count
      )
        throw new RangeError('effect emission index exceeds positions')
      const abX = coordinate(b, 0) - coordinate(a, 0)
      const abY = coordinate(b, 1) - coordinate(a, 1)
      const abZ = coordinate(b, 2) - coordinate(a, 2)
      const acX = coordinate(c, 0) - coordinate(a, 0)
      const acY = coordinate(c, 1) - coordinate(a, 1)
      const acZ = coordinate(c, 2) - coordinate(a, 2)
      area += Math.hypot(abY * acZ - abZ * acY, abZ * acX - abX * acZ, abX * acY - abY * acX) * 0.5
    }
    // Match the simulator's usable-area threshold; never silently emit from a fallback box.
    if (!Number.isFinite(area)) throw new RangeError('effect emission mesh area is not finite')
    if (area > 1e-12) totalArea += area
    meshes.push(Object.freeze({ positions: positions.values, indices: indices.values }))
  }
  if (!(totalArea > 0) || !Number.isFinite(totalArea))
    throw new RangeError('effect emission meshes have no usable triangle area')
  return Object.freeze({ meshes: Object.freeze(meshes), bytes, nodes })
}
