// Intended for packages/scene/src/uvm. Conservative all-time bounds; no native evaluator.
import type { ModelAnimationClip, ModelBoneBinding, ModelPrimitive } from '@modkit/sdk'

interface Extent {
  readonly translation: number
  readonly scale: number
}
const finite = (value: number): number => {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('rig bounds exceed finite range')
  return value
}
function vector(value: readonly number[] | Float32Array, width: number): void {
  if (value.length !== width || value.some(item => !Number.isFinite(item)))
    throw new TypeError('rig bounds require finite declared vectors')
}
/** Caller must establish identity non-joint frames and ordinary TRS inheritance. Joint
 * hierarchy/IBMs and all clips belong to the same source frame as the supplied vertices.
 * The resulting origin-centered sphere covers rest and every accepted clip interval. */
export function boundUvmRig(
  bindings: readonly ModelBoneBinding[],
  primitives: readonly ModelPrimitive[],
  clips: readonly ModelAnimationClip[],
  budget: { readonly maxNodes: number; readonly spatialRoundoff?: number },
  signal?: AbortSignal,
): { readonly radius: number } {
  if (!Number.isSafeInteger(budget.maxNodes) || budget.maxNodes <= 0)
    throw new TypeError('invalid rig bounds budget')
  // Optional absolute per-component spatial conversion error, in this source frame.
  // Native boundaries supply their subnormal quantization floor; relative roundoff
  // and quaternion normalization tolerances are covered by the factors below.
  const spatialError = Math.sqrt(3) * finite(budget.spatialRoundoff ?? 0)
  let work = 0
  const tick = (): void => {
    signal?.throwIfAborted()
    if (++work > budget.maxNodes) throw new RangeError('rig bounds exceed work budget')
  }
  const key = (part: string, bone: number): string => `${part}/${bone}`
  const name = (bone: ModelBoneBinding): string =>
    key(bone.hierarchyId ?? bone.partId, bone.boneIndex)
  const byName = new Map<string, ModelBoneBinding>(),
    byNode = new Map<string, string>(),
    local = new Map<string, Extent>()
  const rotation = (value: readonly number[]): void => {
    vector(value, 4)
    if (Math.abs(Math.hypot(...value) - 1) > 0.0001)
      throw new TypeError('bounds require unit quaternions')
  }
  for (const bone of bindings) {
    tick()
    const id = name(bone),
      pose = bone.localPose,
      matrix = bone.inverseBindMatrix
    if (
      byName.has(id) ||
      bone.nodeId === undefined ||
      byNode.has(bone.nodeId) ||
      pose === undefined ||
      matrix === undefined ||
      bone.parentBoneIndex === undefined
    )
      throw new TypeError('bounds need unique complete joint bindings')
    vector(pose.translation, 3)
    vector(pose.scale, 3)
    rotation(pose.rotation)
    vector(matrix, 16)
    if (matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1)
      throw new TypeError('bounds require affine inverse bind matrices')
    byName.set(id, bone)
    byNode.set(bone.nodeId, id)
    local.set(id, {
      translation: Math.hypot(...pose.translation) + spatialError,
      scale: Math.max(...pose.scale.map(Math.abs)),
    })
  }
  for (const clip of clips) {
    if (clip.unsupportedChannels) throw new TypeError('bounds cannot ignore unsupported channels')
    for (const channel of clip.channels) {
      tick()
      const id = byNode.get(channel.target),
        extent = id === undefined ? undefined : local.get(id)
      if (
        id === undefined ||
        extent === undefined ||
        channel.samples === undefined ||
        !['step', 'linear', 'spherical-linear', 'cubic-spline'].includes(
          channel.interpolation ?? '',
        )
      )
        throw new TypeError('bounds require ordinary complete joint tracks')
      const cubic = channel.interpolation === 'cubic-spline'
      let translation = extent.translation,
        scale = extent.scale
      for (const sample of channel.samples) {
        tick()
        if (cubic) {
          const width = channel.kind === 'rotation' ? 4 : channel.kind === 'visibility' ? 1 : 3
          vector(sample.inTangent ?? [], width)
          vector(sample.outTangent ?? [], width)
        }
        // A rotation, sampled spherically or as a normalized cubic, stays a rotation: it turns
        // extents without growing them, so only its keys are checked.
        if (channel.kind === 'rotation') rotation(sample.value)
        else if (channel.kind === 'translation') {
          vector(sample.value, 3)
          translation = Math.max(translation, Math.hypot(...sample.value) + spatialError)
        } else if (channel.kind === 'scale') {
          vector(sample.value, 3)
          scale = Math.max(scale, ...sample.value.map(Math.abs))
        } else if (channel.kind === 'visibility') {
          // Visibility changes whether geometry is drawn, never where it can be.
          // Validate the owned scalar track while retaining the conservative
          // all-visible geometric bound.
          vector(sample.value, 1)
        } else throw new TypeError('bounds cannot ignore a non-TRS channel')
      }
      // Between two keys a cubic Hermite segment leaves the hull of its ends by at most
      // (4/27)·Δt·(|m0| + |m1|): h00 and h01 are non-negative and sum to one, and |h10|, |h11|
      // peak at 4/27 (t = 1/3, 2/3). The tangents are derivatives per second, so Δt is seconds.
      if (cubic && (channel.kind === 'translation' || channel.kind === 'scale'))
        for (let index = 1; index < channel.samples.length; index += 1) {
          tick()
          const from = channel.samples[index - 1]!,
            to = channel.samples[index]!
          const reach = (4 / 27) * ((to.timeSeconds ?? NaN) - (from.timeSeconds ?? NaN))
          if (!(reach >= 0)) throw new TypeError('bounds require ordered timed cubic keys')
          const leaving = from.outTangent!,
            arriving = to.inTangent!
          if (channel.kind === 'translation')
            translation = Math.max(
              translation,
              Math.max(Math.hypot(...from.value), Math.hypot(...to.value)) +
                reach * (Math.hypot(...leaving) + Math.hypot(...arriving)) +
                spatialError,
            )
          else
            for (let axis = 0; axis < 3; axis += 1)
              scale = Math.max(
                scale,
                Math.max(Math.abs(from.value[axis]!), Math.abs(to.value[axis]!)) +
                  reach * (Math.abs(leaving[axis]!) + Math.abs(arriving[axis]!)),
              )
        }
      local.set(id, { translation, scale })
    }
  }
  const world = new Map<string, Extent>(),
    active = new Set<string>()
  const extentOf = (id: string, depth = 0): Extent => {
    const cached = world.get(id)
    if (cached !== undefined) return cached
    if (active.has(id) || depth > 96) throw new TypeError('bounds hierarchy is cyclic or too deep')
    const bone = byName.get(id),
      own = local.get(id)
    if (bone === undefined || own === undefined) throw new TypeError('bounds parent binding absent')
    active.add(id)
    const parent =
      bone.parentBoneIndex === null
        ? { translation: 0, scale: 1 }
        : extentOf(key(bone.hierarchyId ?? bone.partId, Number(bone.parentBoneIndex)), depth + 1)
    // For the accepted |norm(q)-1|<=1e-4, the TRS rotation operator norm is at
    // most max(1,2*norm(q)^2-1)<1.000401. 1.001 also covers float32 packing;
    // multiplication slack accumulates per level rather than only at the end.
    const result = {
      translation: finite((parent.translation + parent.scale * own.translation) * 1.000001),
      scale: finite(parent.scale * own.scale * 1.001),
    }
    if (!Number.isFinite(Math.fround(result.scale)))
      throw new RangeError('rig hierarchy exceeds finite float32 matrix scale')
    active.delete(id)
    world.set(id, result)
    return result
  }
  for (const id of byName.keys()) extentOf(id)
  let radius = 0
  for (const primitive of primitives) {
    const indices = primitive.boneIndices,
      weights = primitive.boneWeights
    if (
      primitive.hierarchyId === undefined ||
      indices === undefined ||
      weights === undefined ||
      weights.length !== indices.length ||
      indices.length !== (primitive.positions.length / 3) * 4
    )
      throw new TypeError('bounds require complete skin influences')
    for (let offset = 0; offset < primitive.positions.length; offset += 3) {
      tick()
      const position = primitive.positions.subarray(offset, offset + 3)
      vector(position, 3)
      const distance = Math.hypot(...position) + spatialError
      let sum = 0,
        vertexRadius = 0
      for (let slot = 0; slot < 4; slot++) {
        const index = (offset / 3) * 4 + slot,
          weight = weights[index],
          boneIndex = indices[index]
        if (
          weight === undefined ||
          boneIndex === undefined ||
          weight < 0 ||
          !Number.isFinite(weight)
        )
          throw new TypeError('bounds skin influence invalid')
        sum += weight
        if (weight === 0) continue
        const id = key(primitive.hierarchyId, boneIndex),
          bone = byName.get(id),
          extent = world.get(id),
          matrix = bone?.inverseBindMatrix
        if (extent === undefined || matrix === undefined)
          throw new TypeError('bounds influence bone absent')
        const linear = Math.hypot(...matrix.filter((_value, index) => index % 4 < 3 && index < 12))
        const translation = Math.hypot(...matrix.slice(12, 15)) + spatialError
        vertexRadius = Math.max(
          vertexRadius,
          extent.translation + extent.scale * (linear * distance + translation),
        )
      }
      if (Math.abs(sum - 1) > 0.0001)
        throw new TypeError('bounds require normalized nonnegative skin weights')
      // A convex combination cannot exceed the largest influence radius. This also
      // covers reordered/quantized nonnegative weights summing to one in native output.
      radius = Math.max(radius, finite(vertexRadius * Math.max(1, sum) * 1.00001))
    }
  }
  return { radius: finite(radius) }
}

/** Bound the same model-space sphere in an explicitly declared root joint's local
 * frame. The caller establishes ordinary T*R*S inheritance and identity external
 * frames, and obtains modelRadius from boundUvmRig for these exact clips. This is
 * useful when a format's bounds may be interpreted in either of those frames.
 * Refuses singular or numerically unresolved inverse scale; never samples motion. */
export function boundUvmRootFrame(
  root: ModelBoneBinding,
  clips: readonly ModelAnimationClip[],
  modelRadius: number,
  budget: { readonly maxNodes: number; readonly spatialRoundoff?: number },
  signal?: AbortSignal,
): { readonly localRadius: number; readonly radius: number } {
  if (!Number.isSafeInteger(budget.maxNodes) || budget.maxNodes <= 0)
    throw new TypeError('invalid root bounds budget')
  const pose = root.localPose
  if (root.parentBoneIndex !== null || root.nodeId === undefined || pose === undefined)
    throw new TypeError('root frame bounds require an explicit root local pose')
  finite(modelRadius)
  const spatialError = Math.sqrt(3) * finite(budget.spatialRoundoff ?? 0)
  let work = 0,
    translation = 0,
    minimumScale = Infinity
  const tick = (): void => {
    signal?.throwIfAborted()
    if (++work > budget.maxNodes) throw new RangeError('root frame bounds exceed work budget')
  }
  const rotation = (value: readonly number[]): void => {
    vector(value, 4)
    if (Math.abs(Math.hypot(...value) - 1) > 0.0001)
      throw new TypeError('root frame bounds require unit quaternions')
  }
  const translate = (value: readonly number[]): void => {
    vector(value, 3)
    translation = Math.max(translation, finite(Math.hypot(...value) * 1.000001 + spatialError))
  }
  const scale = (value: readonly number[], previous?: readonly number[]): number[] => {
    vector(value, 3)
    const packed = value.map(Math.fround)
    for (const [index, component] of packed.entries()) {
      const prior = previous?.[index]
      if (
        !Number.isFinite(component) ||
        component === 0 ||
        (prior !== undefined && Math.sign(prior) !== Math.sign(component))
      )
        throw new TypeError('root frame scale is singular in float32 or crosses zero')
      // The 1e-6 allowance exceeds eight float32 roundoff units for a same-sign
      // linear segment. Keep it segment-local; independent clips do not blend.
      const largest = Math.max(Math.abs(component), Math.abs(prior ?? component))
      const smallest = Math.min(Math.abs(component), Math.abs(prior ?? component))
      const lower = smallest - largest * 1e-6 - 4 * 2 ** -149
      if (!(lower > 0) || !Number.isFinite(Math.fround(1 / lower)))
        throw new RangeError('root frame inverse scale exceeds proven float32 range')
      minimumScale = Math.min(minimumScale, lower)
    }
    return packed
  }
  tick()
  translate(pose.translation)
  rotation(pose.rotation)
  scale(pose.scale)
  for (const clip of clips) {
    tick()
    if (clip.unsupportedChannels)
      throw new TypeError('root bounds cannot ignore unsupported channels')
    const kinds = new Set<string>()
    for (const channel of clip.channels) {
      tick()
      if (channel.target !== root.nodeId) continue
      if (channel.kind === 'visibility') {
        if (
          kinds.has(channel.kind) ||
          channel.samples === undefined ||
          channel.samples.length === 0 ||
          !['step', 'linear'].includes(channel.interpolation ?? '')
        )
          throw new TypeError('root bounds require a unique ordinary visibility track')
        kinds.add(channel.kind)
        let priorTime = -Infinity
        for (const sample of channel.samples) {
          tick()
          vector(sample.value, 1)
          if (
            sample.timeSeconds === undefined ||
            !Number.isFinite(sample.timeSeconds) ||
            sample.timeSeconds < 0 ||
            sample.timeSeconds <= priorTime
          )
            throw new TypeError('root bounds require increasing finite sample times')
          priorTime = sample.timeSeconds
        }
        continue
      }
      if (
        kinds.has(channel.kind) ||
        channel.samples === undefined ||
        channel.samples.length === 0 ||
        !['translation', 'rotation', 'scale'].includes(channel.kind) ||
        (channel.interpolation !== 'step' &&
          channel.interpolation !== 'cubic-spline' &&
          channel.interpolation !== (channel.kind === 'rotation' ? 'spherical-linear' : 'linear'))
      )
        throw new TypeError('root bounds require unique ordinary TRS tracks')
      kinds.add(channel.kind)
      const cubic = channel.interpolation === 'cubic-spline'
      let priorTime = -Infinity,
        previousScale: readonly number[] | undefined
      for (const sample of channel.samples) {
        tick()
        if (
          sample.timeSeconds === undefined ||
          !Number.isFinite(sample.timeSeconds) ||
          sample.timeSeconds < 0 ||
          sample.timeSeconds <= priorTime
        )
          throw new TypeError('root bounds require increasing finite sample times')
        priorTime = sample.timeSeconds
        if (cubic) {
          vector(sample.inTangent ?? [], sample.value.length)
          vector(sample.outTangent ?? [], sample.value.length)
        }
        // A normalized cubic rotation is a rotation, as a spherical one is: keys alone are checked.
        if (channel.kind === 'translation') translate(sample.value)
        else if (channel.kind === 'rotation') rotation(sample.value)
        else
          previousScale = scale(
            sample.value,
            channel.interpolation === 'linear' ? previousScale : undefined,
          )
      }
      // A cubic segment leaves the hull of its keys by at most (4/27)·Δt·(|m0| + |m1|) (see
      // boundUvmRig): past them for a translation, below them for a scale, which must then
      // keep its sign and stay invertible over the whole segment.
      if (cubic && channel.kind !== 'rotation')
        for (let index = 1; index < channel.samples.length; index += 1) {
          tick()
          const from = channel.samples[index - 1]!,
            to = channel.samples[index]!
          const reach = (4 / 27) * (to.timeSeconds! - from.timeSeconds!)
          const leaving = from.outTangent!,
            arriving = to.inTangent!
          if (channel.kind === 'translation') {
            const far =
              Math.max(Math.hypot(...from.value), Math.hypot(...to.value)) +
              reach * (Math.hypot(...leaving) + Math.hypot(...arriving))
            translation = Math.max(translation, finite(far * 1.000001 + spatialError))
          } else
            for (let axis = 0; axis < 3; axis += 1) {
              const [a, b] = [from.value[axis]!, to.value[axis]!]
              const largest = Math.max(Math.abs(a), Math.abs(b))
              const lower =
                Math.min(Math.abs(a), Math.abs(b)) -
                reach * (Math.abs(leaving[axis]!) + Math.abs(arriving[axis]!)) -
                largest * 1e-6 -
                4 * 2 ** -149
              if (Math.sign(a) !== Math.sign(b) || !(lower > 0))
                throw new TypeError('root frame cubic scale may cross zero between its keys')
              if (!Number.isFinite(Math.fround(1 / lower)))
                throw new RangeError('root frame inverse scale exceeds proven float32 range')
              minimumScale = Math.min(minimumScale, lower)
            }
        }
    }
  }
  // For |norm(q)-1|<=1e-4, R(q)'s least singular value is at least
  // 2*(1-1e-4)^2-1 > 0.9996. 1.002 exceeds its inverse and float32
  // packing/interpolation slack. Standard spherical interpolation is required.
  const localRadius = finite(((modelRadius + translation) / minimumScale) * 1.002)
  if (!Number.isFinite(Math.fround(localRadius)))
    throw new RangeError('root frame bounds exceed finite float32 range')
  return { localRadius, radius: Math.max(modelRadius, localRadius) }
}

/** Preserve an existing finite bounds box/sphere when deriving a new origin sphere.
 * Radius contains every old box corner as well as the requested geometric extent. */
export function expandRigBoundsRadius(
  min: readonly number[],
  max: readonly number[],
  radius: number,
  requiredRadius: number,
): number {
  vector(min, 3)
  vector(max, 3)
  finite(radius)
  finite(requiredRadius)
  if (min.some((value, axis) => value > (max[axis] ?? -Infinity)))
    throw new TypeError('existing rig bounds min exceeds max')
  const extent = min.map((value, axis) =>
    Math.max(Math.abs(value), Math.abs(max[axis] ?? Infinity)),
  )
  return finite(Math.max(radius, requiredRadius, Math.hypot(...extent)))
}
