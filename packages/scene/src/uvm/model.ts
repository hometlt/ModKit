import type { JsonObject } from '@modkit/sdk'
import { readUvmAccessor, type UvmScalarBudget } from '@modkit/uv/model/accessor'
import { decodeUvmGeometry, type UvmGeometry } from './geometry.js'
import { decodeUvmRig, type UvmRig } from './rig.js'

export type { UvmGeometry } from './geometry.js'
export type { UvmRig } from './rig.js'

export interface UvmModel {
  readonly scene: UvmGeometry
  readonly rig: UvmRig
}

/** Project embedded UVM geometry, skin and TRS animations into shared model facets.
 * The input must already have passed the container/profile validation. No native format,
 * file lookup, renderer, host session or extension runtime is needed by this module.
 * Geometry and rig share a single scalar budget. Returned buffers are independently owned.
 */
export function readUvmModel(
  document: JsonObject,
  binary: Uint8Array,
  budget: UvmScalarBudget,
  signal?: AbortSignal,
): UvmModel {
  signal?.throwIfAborted()
  if (!Number.isSafeInteger(budget.maxScalarBytes) || budget.maxScalarBytes < 0)
    throw new TypeError('invalid UVM scalar budget')
  const scene = decodeUvmGeometry(document, binary, budget, signal)
  const rig = decodeUvmRig(
    document,
    (accessor, maxScalarBytes, purpose) =>
      readUvmAccessor(document, binary, accessor, { maxScalarBytes }, purpose, signal),
    budget.maxScalarBytes - scene.decodedGeometryBytes,
    scene.nodes,
    signal,
  )
  return Object.freeze({ scene, rig })
}
