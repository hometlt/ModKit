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
export type ModelBillboardConstraint =
  | ModelInverseCameraBillboardConstraint
  | ModelFaceCameraBillboardConstraint
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
): readonly ModelBonePoseSample[] {
  signal?.throwIfAborted()
  const inverseConstraints = constraints.filter(
    (item): item is ModelInverseCameraBillboardConstraint => item.mode === 'inverse-camera',
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
        let facing = multiplyQuat(parentInverse, cameraInFrame)
        for (const basis of constraint.basisRotations)
          facing = multiplyQuat(facing, rotation(basis))
        facing = multiplyQuat(facing, localTransform.rotation)
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
