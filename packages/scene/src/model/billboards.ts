import type { ModelBoneBinding } from '@modkit/sdk'
import type { ModelBonePoseSample } from '@modkit/codec-kit/model/skeleton'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import {
  decomposeMatrix4,
  invertQuat,
  multiplyQuat,
  normalizeQuat,
  invertMatrix4OrNull,
  multiplyMatrix4,
  quaternionFromRotationMatrix,
  rotationTranslationScaleOriginMatrix,
} from './billboard-math.js'

export type BillboardRotation = readonly [number, number, number, number]
export type BillboardPosition = readonly [number, number, number]
/** Explicit camera rule and post-camera basis, independent of native flag vocabularies. */
export interface ModelInverseCameraBillboardConstraint {
  readonly nodeId: string
  readonly mode: 'inverse-camera'
  readonly basisRotations: readonly BillboardRotation[]
}
/** Position-facing constraint for rigid scene nodes. Local +Y faces the camera. */
export interface ModelFaceCameraBillboardConstraint {
  readonly nodeId: string
  readonly mode: 'face-camera'
  /** Z preserves the local Z axis; XZ also pitches around local X before rolling around Z. */
  readonly rotationAxes: 'z' | 'xz'
  readonly pivot: BillboardPosition
}
/** Aim-built orientation of a bound joint (`ModelNodeBillboard` `aim`, sdk). */
export interface ModelAimBillboardConstraint {
  readonly nodeId: string
  readonly mode: 'aim'
  readonly aim: 'view' | 'eye'
  readonly lock: 'free' | 'frame-x' | 'frame-y' | 'frame-z' | 'own-x' | 'own-y'
  readonly correction?: BillboardRotation
  readonly rootCorrection?: BillboardRotation
}
export type ModelBillboardConstraint =
  | ModelInverseCameraBillboardConstraint
  | ModelFaceCameraBillboardConstraint
  | ModelAimBillboardConstraint
const AIM_LOCKS = ['free', 'frame-x', 'frame-y', 'frame-z', 'own-x', 'own-y']
function needed<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new TypeError('billboard ' + label + ' absent')
  return value
}
function rotation(value: unknown): BillboardRotation {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(
      item =>
        typeof item === 'number' && Number.isFinite(item) && Number.isFinite(Math.fround(item)),
    ) ||
    Math.hypot(...value) === 0
  )
    throw new TypeError('billboard quaternion must be finite and nonzero')
  return normalizeQuat(value)
}
function matrix(value: readonly number[] | Float32Array): Float32Array {
  if (
    value.length !== 16 ||
    !value.every(Number.isFinite) ||
    [3, 7, 11].some(index => value[index] !== 0) ||
    value[15] !== 1
  )
    throw new TypeError('billboard matrix must be finite affine')
  const result = Float32Array.from(value)
  if (!result.every(Number.isFinite)) throw new RangeError('billboard matrix exceeds float32')
  return result
}
function position(value: unknown): BillboardPosition {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(item => typeof item === 'number' && Number.isFinite(item))
  )
    throw new TypeError('billboard position must contain three finite numbers')
  return [value[0] as number, value[1] as number, value[2] as number]
}
export function snapshotModelBillboards(
  values: readonly ModelBillboardConstraint[],
  maxBytes: number,
  signal?: AbortSignal,
): readonly ModelBillboardConstraint[] {
  const owned = snapshotJson(
    values,
    { maxBytes, maxDepth: 8, maxNodes: Math.floor(maxBytes / 16) },
    signal,
  ) as unknown as readonly ModelBillboardConstraint[]
  if (!Array.isArray(owned)) throw new TypeError('billboard constraints must be an array')
  const seen = new Set<string>()
  for (const item of owned) {
    if (!item || typeof item.nodeId !== 'string' || !item.nodeId || seen.has(item.nodeId))
      throw new TypeError('invalid or duplicate billboard constraint')
    if (item.mode === 'inverse-camera') {
      if (
        Object.keys(item).some(key => !['nodeId', 'mode', 'basisRotations'].includes(key)) ||
        !Array.isArray(item.basisRotations) ||
        item.basisRotations.length > 4
      )
        throw new TypeError('invalid inverse-camera billboard constraint')
      for (const basis of item.basisRotations) rotation(basis)
    } else if (item.mode === 'face-camera') {
      if (
        Object.keys(item).some(key => !['nodeId', 'mode', 'rotationAxes', 'pivot'].includes(key)) ||
        !['z', 'xz'].includes(item.rotationAxes)
      )
        throw new TypeError('invalid face-camera billboard constraint')
      position(item.pivot)
    } else if (item.mode === 'aim') {
      if (
        Object.keys(item).some(
          key => !['nodeId', 'mode', 'aim', 'lock', 'correction', 'rootCorrection'].includes(key),
        ) ||
        (item.aim !== 'view' && item.aim !== 'eye') ||
        !AIM_LOCKS.includes(item.lock)
      )
        throw new TypeError('invalid aim billboard constraint')
      if (item.correction !== undefined) rotation(item.correction)
      if (item.rootCorrection !== undefined) rotation(item.rootCorrection)
    } else throw new TypeError('invalid billboard mode')
    seen.add(item.nodeId)
  }
  return owned
}

function translation(value: BillboardPosition): Float32Array {
  return Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, value[0], value[1], value[2], 1)
}
function rotationX(angle: number): Float32Array {
  const c = Math.cos(angle), s = Math.sin(angle)
  return Float32Array.of(1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1)
}
function rotationZ(angle: number): Float32Array {
  const c = Math.cos(angle), s = Math.sin(angle)
  return Float32Array.of(c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
}

/** Apply a local-axis position-facing operation to one already composed node world matrix. */
export function applyModelFaceCameraBillboard(
  sourceWorld: readonly number[] | Float32Array,
  constraint: ModelFaceCameraBillboardConstraint,
  cameraPosition: BillboardPosition,
): Float32Array {
  const world = matrix(sourceWorld)
  const inverse = invertMatrix4OrNull(world)
  if (inverse === null) throw new TypeError('face-camera billboard world is singular')
  const camera = position(cameraPosition)
  const pivot = position(constraint.pivot)
  const x = (inverse[0] ?? 0) * camera[0] + (inverse[4] ?? 0) * camera[1] +
    (inverse[8] ?? 0) * camera[2] + (inverse[12] ?? 0) - pivot[0]
  let y = (inverse[1] ?? 0) * camera[0] + (inverse[5] ?? 0) * camera[1] +
    (inverse[9] ?? 0) * camera[2] + (inverse[13] ?? 0) - pivot[1]
  const z = (inverse[2] ?? 0) * camera[0] + (inverse[6] ?? 0) * camera[1] +
    (inverse[10] ?? 0) * camera[2] + (inverse[14] ?? 0) - pivot[2]
  let result = multiplyMatrix4(world, translation(pivot))
  if (constraint.rotationAxes === 'xz') {
    const pitch = Math.atan2(z, y)
    result = multiplyMatrix4(result, rotationX(pitch))
    y = Math.hypot(y, z)
  }
  result = multiplyMatrix4(result, rotationZ(-Math.atan2(x, y)))
  result = multiplyMatrix4(result, translation([-pivot[0], -pivot[1], -pivot[2]]))
  if (!result.every(Number.isFinite)) throw new RangeError('face-camera billboard exceeds float32')
  return result
}
/** Camera orientation is in common world space, recovered from the already owned view matrix. */
export function billboardCameraRotation(view: readonly number[]): BillboardRotation {
  const inverse = invertMatrix4OrNull(matrix(view))
  if (inverse === null) throw new TypeError('billboard camera view is singular')
  return decomposeMatrix4(inverse).rotation
}
/** Pinned m3BillboardMatrices traversal generalized to named bones and an explicit basis.
 * The common hierarchy frame is applied by the caller once, after this authored-frame pose. */
export function applyModelBillboards(
  pose: readonly ModelBonePoseSample[],
  bindings: readonly ModelBoneBinding[],
  constraints: readonly ModelBillboardConstraint[],
  cameraRotation: BillboardRotation | undefined,
  hierarchyFrame: readonly number[] | Float32Array,
  maxBytes: number,
  signal?: AbortSignal,
  /** The eye, in the space the frame maps the skeleton into; an `eye` aim needs it. */
  cameraPosition?: BillboardPosition,
): readonly ModelBonePoseSample[] {
  signal?.throwIfAborted()
  const inverseConstraints = constraints.filter(
    (item): item is ModelInverseCameraBillboardConstraint | ModelAimBillboardConstraint =>
      item.mode === 'inverse-camera' || item.mode === 'aim',
  )
  if (cameraRotation === undefined || inverseConstraints.length === 0) return pose
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    pose.length * 2048 + inverseConstraints.length * 256 > maxBytes
  )
    throw new RangeError('billboard pose exceeds byte budget')
  const byNode = new Map(inverseConstraints.map(item => [item.nodeId, item])),
    source = new Map<number, ModelBonePoseSample>(),
    bones = new Map(bindings.map(item => [item.boneIndex, item]))
  for (const item of pose) {
    if (source.has(item.boneIndex)) throw new TypeError('duplicate billboard pose bone')
    source.set(item.boneIndex, item)
  }
  if (!pose.some(item => byNode.has(item.nodeId))) return pose
  // The camera's own rotation — camera to world, then into the authored frame — is what turns the
  // node toward it: rotation = parent⁻¹ · camera · basis · local, mdx-m3-viewer's
  // `parent.inverseWorldRotation · camera.inverseRotation`, whose camera.inverseRotation is the
  // camera-to-world turn `billboardCameraRotation` returns. Inverting it once more turned the node
  // away as the camera went round: it faced the viewer from one side only.
  const cameraInFrame = multiplyQuat(
    invertQuat(decomposeMatrix4(matrix(hierarchyFrame)).rotation),
    rotation(cameraRotation),
  )
  const frameInverse = invertMatrix4OrNull(matrix(hierarchyFrame))
  const eye =
    cameraPosition === undefined || frameInverse === null
      ? undefined
      : transformPoint(frameInverse, position(cameraPosition))
  const camera: AimCamera = {
    forward: rotateVector(cameraInFrame, [0, 0, -1]),
    up: rotateVector(cameraInFrame, [0, 1, 0]),
    axisX: rotateVector(cameraInFrame, [1, 0, 0]),
    ...(eye === undefined ? {} : { eye }),
  }
  const adjusted = new Map<number, Float32Array>(),
    output = new Map<number, ModelBonePoseSample>()
  for (const entry of pose) {
    const chain: number[] = [],
      visiting = new Set<number>()
    let cursor: number | null = entry.boneIndex
    while (cursor !== null && !adjusted.has(cursor)) {
      if (visiting.has(cursor)) throw new TypeError('cyclic billboard hierarchy')
      visiting.add(cursor)
      chain.push(cursor)
      const parent: number | null | undefined = needed(
        bones.get(cursor),
        'bone binding',
      ).parentBoneIndex
      if (parent === undefined) throw new TypeError('billboard parent is unknown')
      cursor = parent
    }
    for (const index of chain.reverse()) {
      signal?.throwIfAborted()
      const bone = needed(bones.get(index), 'binding'),
        original = needed(source.get(index), 'source pose'),
        parent = bone.parentBoneIndex
      if (parent === undefined) throw new TypeError('billboard parent is unknown')
      const originalWorld = matrix(original.worldMatrix),
        originalParent =
          parent === null ? null : matrix(needed(source.get(parent), 'parent pose').worldMatrix),
        inverseOriginalParent = originalParent === null ? null : invertMatrix4OrNull(originalParent)
      const local =
        originalParent !== null && inverseOriginalParent !== null
          ? multiplyMatrix4(inverseOriginalParent, originalWorld)
          : originalWorld
      const adjustedParent =
        parent === null ? undefined : needed(adjusted.get(parent), 'adjusted parent')
      let world = adjustedParent === undefined ? local : multiplyMatrix4(adjustedParent, local)
      const constraint = byNode.get(original.nodeId)
      if (constraint !== undefined) {
        const localTransform = decomposeMatrix4(local),
          parentInverse =
            adjustedParent === undefined
              ? ([0, 0, 0, 1] as const)
              : invertQuat(decomposeMatrix4(adjustedParent).rotation)
        let facing: BillboardRotation | undefined
        if (constraint.mode === 'inverse-camera') {
          facing = multiplyQuat(parentInverse, cameraInFrame)
          for (const basis of constraint.basisRotations)
            facing = multiplyQuat(facing, rotation(basis))
          facing = multiplyQuat(facing, localTransform.rotation)
        } else {
          const aimed = aimRotation(constraint, camera, world, parent === null, localTransform.rotation)
          if (aimed !== undefined) facing = multiplyQuat(parentInverse, aimed)
        }
        if (facing !== undefined) {
          const billboardLocal = rotationTranslationScaleOriginMatrix(
            normalizeQuat(facing),
            localTransform.translation,
            localTransform.scaling,
            [0, 0, 0],
          )
          world =
            adjustedParent === undefined
              ? billboardLocal
              : multiplyMatrix4(adjustedParent, billboardLocal)
        }
      }
      if (!world.every(Number.isFinite)) throw new RangeError('billboard world exceeds float32')
      adjusted.set(index, world)
      const skin =
        bone.inverseBindMatrix === undefined
          ? undefined
          : multiplyMatrix4(world, matrix(bone.inverseBindMatrix))
      if (skin !== undefined && !skin.every(Number.isFinite))
        throw new RangeError('billboard skin exceeds float32')
      output.set(index, {
        boneIndex: index,
        nodeId: original.nodeId,
        worldMatrix: Array.from(world),
        ...(skin === undefined ? {} : { skinningMatrix: Array.from(skin) }),
      })
    }
  }
  signal?.throwIfAborted()
  return pose.map(item => needed(output.get(item.boneIndex), 'result'))
}

interface AimCamera {
  readonly forward: Vec3
  readonly up: Vec3
  readonly axisX: Vec3
  readonly eye?: Vec3
}
type Vec3 = readonly [number, number, number]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2])
  return length > 0 ? [v[0] / length, v[1] / length, v[2] / length] : v
}
/** A 2D direction normalised: the engine's QuarterTurn. */
const unit2 = (a: number, b: number): readonly [number, number] => {
  const length = Math.hypot(a, b)
  return length > 0 ? [a / length, b / length] : [a, b]
}
function rotateVector(q: BillboardRotation, v: Vec3): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]]
  const c1 = cross(u, v)
  const t: Vec3 = [c1[0] * 2, c1[1] * 2, c1[2] * 2]
  const c2 = cross(u, t)
  return [v[0] + q[3] * t[0] + c2[0], v[1] + q[3] * t[1] + c2[1], v[2] + q[3] * t[2] + c2[2]]
}
function transformPoint(m: Float32Array, p: Vec3): Vec3 {
  const row = (r: number) =>
    (m[r] ?? 0) * p[0] + (m[4 + r] ?? 0) * p[1] + (m[8 + r] ?? 0) * p[2] + (m[12 + r] ?? 0)
  return [row(0), row(1), row(2)]
}
// The engine's thresholds (CBBSolver::ApplyBillboard, as WhiteoutFlakes reads it).
const AXIS_EPSILON = 2.384185791015625e-7
const DEGENERATE_LENGTH_SQUARED = 1e-4
const ORTHONORMAL_TOLERANCE = 1e-3

/**
 * The frame rotation an `aim` constraint gives a joint, or undefined where the joint keeps its
 * animated pose: d too short to aim with, a lock axis along it, a basis that is not unit. `world`
 * is the joint as its parent chain left it: its position aims an `eye` billboard and its own axes
 * lock `own-x`/`own-y`. A root joint keeps its sampled rotation (`spin`) after the aim.
 */
function aimRotation(
  constraint: ModelAimBillboardConstraint,
  camera: AimCamera,
  world: Float32Array,
  root: boolean,
  spin: BillboardRotation,
): BillboardRotation | undefined {
  let d: Vec3
  if (constraint.aim === 'eye') {
    if (camera.eye === undefined) return undefined
    d = unit(sub([world[12] ?? 0, world[13] ?? 0, world[14] ?? 0], camera.eye))
  } else d = camera.forward
  if (d.every(component => Math.abs(component) < AXIS_EPSILON)) return undefined
  let rows: readonly [Vec3, Vec3, Vec3] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  switch (constraint.lock) {
    case 'frame-x': {
      let v: Vec3 = [0, d[1], d[2]]
      if (d[1] * d[1] + d[2] * d[2] < DEGENERATE_LENGTH_SQUARED) v = camera.axisX
      v = unit(v)
      const p = unit2(-v[2], v[1])
      rows = [[1, 0, 0], v, [0, p[0], p[1]]]
      break
    }
    case 'frame-y': {
      let v: Vec3 = [d[0], 0, d[2]]
      if (d[2] * d[2] + d[0] * d[0] < DEGENERATE_LENGTH_SQUARED) v = camera.up
      v = unit(v)
      const p = unit2(-v[2], v[0])
      rows = [v, [0, 1, 0], [p[0], 0, p[1]]]
      break
    }
    case 'frame-z': {
      let v: Vec3 = [d[0], d[1], 0]
      if (d[1] * d[1] + d[0] * d[0] < DEGENERATE_LENGTH_SQUARED) v = camera.up
      v = unit(v)
      const p = unit2(v[1], -v[0])
      rows = [[p[0], p[1], 0], v, [0, 0, 1]]
      break
    }
    case 'own-x':
    case 'own-y': {
      const column = constraint.lock === 'own-x' ? 0 : 4
      const a = unit([world[column] ?? 0, world[column + 1] ?? 0, world[column + 2] ?? 0])
      const c = cross(a, d)
      if (dot(c, c) < DEGENERATE_LENGTH_SQUARED) return undefined
      const cn = unit(c)
      rows = constraint.lock === 'own-x' ? [a, cn, cross(a, cn)] : [cn, cross(a, cn), a]
      break
    }
    case 'free': {
      const e = cross(d, camera.up)
      if (dot(e, e) < DEGENERATE_LENGTH_SQUARED) break
      const en = unit(e)
      rows = [en, d, unit(cross(en, d))]
      break
    }
  }
  if (rows.some(row => Math.abs(dot(row, row) - 1) >= ORTHONORMAL_TOLERANCE)) return undefined
  // Rows are the joint's local axes in the frame: the columns of its rotation.
  let q: BillboardRotation = normalizeQuat(
    quaternionFromRotationMatrix([...rows[0], ...rows[1], ...rows[2]]),
  )
  if (root) {
    q = multiplyQuat(q, spin)
    if (constraint.rootCorrection !== undefined)
      q = multiplyQuat(q, rotation(constraint.rootCorrection))
  } else if (constraint.correction !== undefined) q = multiplyQuat(q, rotation(constraint.correction))
  return q
}
