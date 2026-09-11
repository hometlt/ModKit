import type { EffectProjectorSplatState } from '@modkit/codec-kit/model-math/effects-sim'
import type { RenderProjector } from '@modkit/codec-kit/legacy/models'
import type { ProjectorFrame, ProjectorVec3 } from './projector-receivers.js'

export interface UvmCollisionSplat {
  readonly slot: number
  readonly projector: number
  readonly position: ProjectorVec3
  readonly normal: ProjectorVec3
  readonly alpha: number
}
const finite = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value))
    throw new TypeError('invalid collision splat scalar')
  return value
}
/** Own only live splats before returning from the simulator frame; no simulator/pool escapes. */
export function captureCollisionSplats(
  state: EffectProjectorSplatState,
  maxNodes: number,
  maxBytes: number,
  signal?: AbortSignal,
): readonly UvmCollisionSplat[] {
  signal?.throwIfAborted()
  if (
    !Number.isSafeInteger(maxNodes) ||
    maxNodes < 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    !Number.isSafeInteger(state.activeCount) ||
    state.activeCount < 0 ||
    state.activeCount > state.capacity ||
    state.activeCount > maxNodes ||
    state.activeCount * 256 > maxBytes
  )
    throw new RangeError('collision splat snapshot exceeds budget')
  const result: UvmCollisionSplat[] = [],
    slots = new Set<number>()
  for (let index = 0; index < state.activeCount; index++) {
    signal?.throwIfAborted()
    const slot = state.activeSlots[index]
    if (slot === undefined || slot < 0 || slot >= state.capacity || slots.has(slot))
      throw new TypeError('invalid collision splat slot')
    slots.add(slot)
    const projector = state.projectorIndices[slot],
      offset = slot * 3
    if (projector === undefined) throw new TypeError('collision splat projector absent')
    const alpha = finite(state.alphas[slot])
    if (alpha < 0 || alpha > 1) throw new TypeError('invalid collision splat alpha')
    result.push({
      slot,
      projector,
      alpha,
      position: [
        finite(state.positions[offset]),
        finite(state.positions[offset + 1]),
        finite(state.positions[offset + 2]),
      ],
      normal: [
        finite(state.normals[offset]),
        finite(state.normals[offset + 1]),
        finite(state.normals[offset + 2]),
      ],
    })
  }
  return result
}
const unit = (v: ProjectorVec3): ProjectorVec3 => {
  const length = Math.hypot(...v)
  if (!(length > 1e-8)) throw new TypeError('invalid collision splat normal')
  return [v[0] / length, v[1] / length, v[2] / length]
}
const cross = (a: ProjectorVec3, b: ProjectorVec3): ProjectorVec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
/** Pinned evaluateCollisionProjectorFrames equations; ignores declaration active/offset/Euler.
 * The simulator already owns impact correction, random lifetimes and alpha interpolation. */
export function collisionSplatFrame(
  splat: UvmCollisionSplat,
  projector: RenderProjector,
): ProjectorFrame {
  const normal = unit(splat.normal),
    forwardAxis: ProjectorVec3 = [-normal[0], -normal[1], -normal[2]]
  const reference: ProjectorVec3 = Math.abs(forwardAxis[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]
  const rightAxis = unit(cross(reference, forwardAxis)),
    upAxis = unit(cross(forwardAxis, rightAxis))
  const near = Math.max(0.0001, Math.min(Math.abs(projector.near), Math.abs(projector.far))),
    far = Math.max(0.001, Math.max(Math.abs(projector.near), Math.abs(projector.far)))
  const origin: ProjectorVec3 = [
    splat.position[0] + normal[0] * near,
    splat.position[1] + normal[1] * near,
    splat.position[2] + normal[2] * near,
  ]
  const absolute = Math.abs(projector.fieldOfView || Math.PI / 4),
    fov = Math.min(
      Math.PI - 0.001,
      Math.max(0.001, absolute > Math.PI * 2 ? (absolute * Math.PI) / 180 : absolute),
    ),
    tangentY = Math.tan(fov * 0.5)
  let left = Math.min(projector.boxOffsetXLeft, projector.boxOffsetXRight),
    rightExtent = Math.max(projector.boxOffsetXLeft, projector.boxOffsetXRight),
    bottom = Math.min(projector.boxOffsetYBack, projector.boxOffsetYFront),
    top = Math.max(projector.boxOffsetYBack, projector.boxOffsetYFront)
  if (rightExtent - left < 0.002) {
    left = -0.001
    rightExtent = 0.001
  }
  if (top - bottom < 0.002) {
    bottom = -0.001
    top = 0.001
  }
  return {
    projectionType: projector.projectionType,
    origin,
    rightAxis,
    upAxis,
    forwardAxis,
    near,
    far,
    left,
    rightExtent,
    bottom,
    top,
    tangentX: tangentY * Math.max(0.001, Math.abs(projector.aspectRatio) || 1),
    tangentY,
  }
}
