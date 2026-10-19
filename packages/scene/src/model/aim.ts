/** Joint-local aiming after animation, shared by CPU deformation and GPU palettes.
 * Publishers resolve named groups, target points and temporal weights. This owner knows no game,
 * catalog or file format. Parent constraints run before children; input poses are never mutated.
 */
import type { ModelBoneBinding, ModelNodeBehaviourRef } from '@modkit/sdk'
import type { ModelBonePoseSample } from '@modkit/codec-kit/model/skeleton'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { invertMatrix4OrNull, multiplyMatrix4 } from './billboard-math.js'

export type ModelAimPart = NonNullable<ModelNodeBehaviourRef['aim']>['parts'][number]
export interface ModelAimConstraint extends ModelAimPart {
  /** Target in the common model frame, including the static frame above the skeleton. */
  readonly target: readonly [number, number, number]
  readonly weight: number
}

/** Validate caller-owned constraints before using them to change a pose or its skin matrices. */
export function validateModelAimConstraints(constraints: readonly ModelAimConstraint[]): void {
  if (!Array.isArray(constraints) || constraints.length > 256) throw new RangeError('model aim exceeds 256 parts')
  for (const part of constraints) {
    if (typeof part.nodeId !== 'string' || !part.nodeId || part.target.length !== 3 ||
      !part.target.every(Number.isFinite) || !Number.isFinite(part.weight) || part.weight < 0 || part.weight > 1 ||
      part.forwardMatrix.length !== 16 || !part.forwardMatrix.every(Number.isFinite) ||
      [3, 7, 11].some(index => part.forwardMatrix[index] !== 0) || part.forwardMatrix[15] !== 1)
      throw new TypeError('invalid model aim frame, target or weight')
    for (const axis of [part.yaw, part.pitch])
      if (!Number.isFinite(axis.weight) || axis.weight < 0 || axis.weight > 1 || (axis.limits !== undefined &&
        (axis.limits.length !== 2 || !axis.limits.every(Number.isFinite) || axis.limits[0] > axis.limits[1])))
        throw new TypeError('invalid model aim axis')
  }
}

/** Apply bounded yaw/pitch about each joint and update its descendants and inverse-bind palettes. */
export function applyModelAimConstraints(
  pose: readonly ModelBonePoseSample[], bindings: readonly ModelBoneBinding[],
  constraints: readonly ModelAimConstraint[], frame: Float32Array, maxBytes: number, signal?: AbortSignal,
): readonly ModelBonePoseSample[] {
  if (constraints.length === 0) return pose
  validateModelAimConstraints(constraints)
  signal?.throwIfAborted()
  if (!Number.isSafeInteger(maxBytes) || maxBytes < pose.length * 2048 + constraints.length * 512)
    throw new RangeError('model aim pose exceeds byte budget')
  const inverse = invertMatrix4OrNull(frame)
  if (inverse === null) throw new TypeError('model aim hierarchy frame is singular')
  const byNode = new Map(bindings.flatMap(binding => binding.nodeId === undefined ? [] : [[binding.nodeId, binding] as const]))
  const byBone = new Map(bindings.map(binding => [binding.boneIndex, binding]))
  const result = new Map(pose.map(bone => [bone.boneIndex, bone]))
  const ancestors = (index: number) => {
    const chain: number[] = [], visited = new Set<number>()
    for (let at: number | null | undefined = index; at !== null && at !== undefined; at = byBone.get(at)?.parentBoneIndex) {
      if (visited.has(at)) throw new TypeError('model aim hierarchy is cyclic')
      visited.add(at); chain.push(at)
    }
    return chain
  }
  const chains = new Map(pose.map(bone => [bone.boneIndex, ancestors(bone.boneIndex)]))
  const sorted = constraints.filter(part => byNode.has(part.nodeId)).map(part => ({ part, binding: byNode.get(part.nodeId)! }))
    .sort((a, b) => ancestors(a.binding.boneIndex).length - ancestors(b.binding.boneIndex).length)
  const qYaw = new Quaternion(), qPitch = new Quaternion(), rotation = new Matrix4()
  const forward = new Vector3(), right = new Vector3(), up = new Vector3(), direction = new Vector3()
  for (const { part, binding } of sorted) {
    signal?.throwIfAborted()
    if (part.weight === 0) continue
    const bone = result.get(binding.boneIndex)
    if (bone === undefined) throw new TypeError('model aim joint pose is absent')
    const world = multiplyMatrix4(frame, Float32Array.from(bone.worldMatrix))
    const basis = new Matrix4().fromArray(multiplyMatrix4(world, Float32Array.from(part.forwardMatrix)))
    forward.setFromMatrixColumn(basis, 0).normalize()
    right.setFromMatrixColumn(basis, 1).normalize()
    up.setFromMatrixColumn(basis, 2).normalize()
    if (Math.min(forward.lengthSq(), right.lengthSq(), up.lengthSq()) < 0.5)
      throw new TypeError('model aim axes are degenerate')
    direction.set(part.target[0] - world[12]!, part.target[1] - world[13]!, part.target[2] - world[14]!)
    if (direction.lengthSq() < 1e-16) continue
    const f = direction.dot(forward), r = direction.dot(right), u = direction.dot(up)
    const clamp = (angle: number, axis: ModelAimPart['yaw']) => axis.limits === undefined ? angle : Math.max(axis.limits[0], Math.min(axis.limits[1], angle))
    const yaw = clamp(Math.atan2(r, f), part.yaw) * part.yaw.weight * part.weight
    const pitch = clamp(Math.atan2(u, Math.hypot(f, r)), part.pitch) * part.pitch.weight * part.weight
    qYaw.setFromAxisAngle(up, yaw)
    right.applyQuaternion(qYaw)
    qPitch.setFromAxisAngle(right, -pitch).multiply(qYaw)
    rotation.makeRotationFromQuaternion(qPitch)
    const e = rotation.elements, x = world[12]!, y = world[13]!, z = world[14]!
    e[12] = x - e[0]! * x - e[4]! * y - e[8]! * z
    e[13] = y - e[1]! * x - e[5]! * y - e[9]! * z
    e[14] = z - e[2]! * x - e[6]! * y - e[10]! * z
    const delta = multiplyMatrix4(multiplyMatrix4(inverse, Float32Array.from(e)), frame)
    for (const source of pose) {
      if (!chains.get(source.boneIndex)!.includes(binding.boneIndex)) continue
      const current = result.get(source.boneIndex)!
      const moved = multiplyMatrix4(delta, Float32Array.from(current.worldMatrix))
      const inverseBind = byBone.get(source.boneIndex)?.inverseBindMatrix
      const skin = inverseBind === undefined ? undefined : multiplyMatrix4(moved, Float32Array.from(inverseBind))
      if (!moved.every(Number.isFinite) || skin?.some(value => !Number.isFinite(value)))
        throw new RangeError('model aim exceeds finite float32 range')
      result.set(source.boneIndex, { ...current, worldMatrix: [...moved], ...(skin === undefined ? {} : { skinningMatrix: [...skin] }) })
    }
  }
  return pose.map(bone => result.get(bone.boneIndex)!)
}
