import type { JsonObject } from '@modkit/sdk'
import { array, field, integer, object, safeIndex } from './validation/values.js'
import { readUvmAnimationMaterialTargets } from './animation-materials.js'
export {
  readUvmAnimationMaterialTargets,
  materializeUvmAnimationMaterialTargets,
  uvmAnimationMaterialPropertyWidth,
} from './animation-materials.js'
export type {
  UvmAnimationMaterialTarget,
  UvmAnimationMaterialProperty,
} from './animation-materials.js'

/** Complete selectable clip identity; glTF animation is optional for material-only/empty clips. */
export interface UvmAnimationClip {
  readonly id: string
  readonly name: string
  readonly durationSeconds: number
  readonly sourceSequenceIndex: number
  readonly animation?: number
  readonly sourceId?: string
  readonly looping?: boolean
  readonly repeatCount?: number
  readonly kind?: 'animation' | 'rest-pose'
  readonly frames?: number
}

/** A scalar visibility property applies to every instance of one actual mesh primitive. */
export type UvmPrimitiveVisibility =
  | { readonly mesh: number; readonly primitive: number; readonly value: number }
  | { readonly node: number; readonly binding: 'batch'; readonly value: number }

export function readUvmPrimitiveVisibility(
  document: JsonObject,
  signal?: AbortSignal,
): readonly UvmPrimitiveVisibility[] {
  const value = field(field(document['extensions'], 'UV_game_variants'), 'visibility')
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TypeError('UVM primitive visibility must be an array')
  if (!array(document, 'extensionsUsed').includes('UV_game_variants'))
    throw new TypeError('UV_game_variants is not declared in extensionsUsed')
  const meshes = array(document, 'meshes')
  const targets = new Set<string>()
  return Object.freeze(
    value.map(candidate => {
      signal?.throwIfAborted()
      const item = object(candidate, 'UVM primitive visibility')
      const scalar = item['value']
      const nodeBinding = item['binding'] === 'batch'
      const target = nodeBinding
        ? { node: safeIndex(item['node'], array(document, 'nodes').length, 'visibility node'), binding: 'batch' as const }
        : (() => {
            const mesh = safeIndex(item['mesh'], meshes.length, 'visibility mesh')
            return {
              mesh,
              primitive: safeIndex(item['primitive'], array(meshes[mesh], 'primitives').length, 'visibility primitive'),
            }
          })()
      const key = 'node' in target ? `node/${target.node}/batch` : `${target.mesh}/${target.primitive}`
      if (typeof scalar !== 'number' || !Number.isFinite(scalar) || targets.has(key))
        throw new TypeError('UVM visibility requires a finite value and unique primitive target')
      targets.add(key)
      return Object.freeze({ ...target, value: scalar }) as UvmPrimitiveVisibility
    }),
  )
}

export function uvmVisibilityPointer(index: number): string {
  if (!integer(index) || index < 0) throw new TypeError('invalid visibility index')
  return `/extensions/UV_game_variants/visibility/${index}/value`
}

export function uvmVisibilityTarget(
  pointer: unknown,
  visibility: readonly UvmPrimitiveVisibility[],
): UvmPrimitiveVisibility | undefined {
  if (typeof pointer !== 'string') return undefined
  const match = /^\/extensions\/UV_game_variants\/visibility\/(0|[1-9]\d*)\/value$/u.exec(pointer)
  if (match === null) return undefined
  return visibility[safeIndex(Number(match[1]), visibility.length, 'visibility pointer')]
}

/** Undefined preserves legacy positional animation identities. A present catalog is complete. */
export function readUvmAnimationClips(
  document: JsonObject,
  signal?: AbortSignal,
): readonly UvmAnimationClip[] | undefined {
  signal?.throwIfAborted()
  const value = field(document['extensions'], 'UV_game_animation_clips')
  if (value === undefined) return undefined
  const catalog = object(value, 'UV_game_animation_clips')
  if (!Array.isArray(catalog['clips'])) throw new TypeError('UVM clip catalog requires clips')
  const animations = array(document, 'animations')
  const ids = new Set<string>(),
    sequences = new Set<number>(),
    linked = new Set<number>()
  const clips: UvmAnimationClip[] = []
  for (const item of catalog['clips']) {
    signal?.throwIfAborted()
    const record = object(item, 'UVM clip catalog entry')
    const id = record['id'],
      name = record['name'],
      duration = record['durationSeconds'],
      sequence = record['sourceSequenceIndex']
    if (
      typeof id !== 'string' ||
      !id.trim() ||
      ids.has(id) ||
      typeof name !== 'string' ||
      typeof duration !== 'number' ||
      !Number.isFinite(duration) ||
      duration < 0 ||
      !integer(sequence) ||
      sequence < 0 ||
      sequences.has(sequence)
    )
      throw new TypeError('UVM clip catalog identity, duration or sequence is invalid')
    const sourceId = record['sourceId'],
      looping = record['looping'],
      repeatCount = record['repeatCount'],
      kind = record['kind'],
      frames = record['frames']
    if (
      (sourceId !== undefined && (typeof sourceId !== 'string' || !sourceId)) ||
      (looping !== undefined && typeof looping !== 'boolean') ||
      (repeatCount !== undefined && (!integer(repeatCount) || repeatCount < 0)) ||
      (kind !== undefined && kind !== 'animation' && kind !== 'rest-pose') ||
      (frames !== undefined && (!integer(frames) || frames < 0))
    )
      throw new TypeError('UVM clip catalog optional metadata is invalid')
    const animation =
      record['animation'] === undefined
        ? undefined
        : safeIndex(record['animation'], animations.length, 'clip animation')
    if (animation !== undefined) {
      if (linked.has(animation)) throw new TypeError('UVM animation is linked by multiple clips')
      const target = object(animations[animation], 'clip animation')
      if (array(target, 'channels').length === 0 || array(target, 'samplers').length === 0)
        throw new TypeError('UVM catalog must not link an empty glTF animation')
      const declared = field(field(target['extras'], 'uv'), 'sourceSequenceIndex')
      if (declared !== undefined && declared !== sequence)
        throw new TypeError('UVM clip and animation sequence indices disagree')
      linked.add(animation)
    }
    ids.add(id)
    sequences.add(sequence)
    clips.push(
      Object.freeze({
        id,
        name,
        durationSeconds: duration,
        sourceSequenceIndex: sequence,
        ...(animation === undefined ? {} : { animation }),
        ...(sourceId === undefined ? {} : { sourceId }),
        ...(looping === undefined ? {} : { looping }),
        ...(repeatCount === undefined ? {} : { repeatCount }),
        ...(kind === undefined ? {} : { kind }),
        ...(frames === undefined ? {} : { frames }),
      }),
    )
  }
  for (const [index, animation] of animations.entries()) {
    const scope = field(field(field(animation, 'extras'), 'uv'), 'effectTrackScope')
    if (!linked.has(index) && scope !== 'absolute' && scope !== 'global')
      throw new TypeError('UVM clip catalog omits a selectable glTF animation')
  }
  return Object.freeze(clips)
}

export function validateUvmAnimationClips(document: JsonObject, signal?: AbortSignal): void {
  readUvmPrimitiveVisibility(document, signal)
  const clips = readUvmAnimationClips(document, signal)
  const sequences = new Set(clips?.map(clip => clip.sourceSequenceIndex))
  for (const target of readUvmAnimationMaterialTargets(document, signal))
    for (const property of target.properties)
      for (const track of property.sequenceTracks)
        if (!sequences.has(Number(track['sequenceIndex'])))
          throw new TypeError('animation material target references an absent catalog sequence')
  if (clips !== undefined && !array(document, 'extensionsUsed').includes('UV_game_animation_clips'))
    throw new TypeError('UV_game_animation_clips is not declared in extensionsUsed')
}
