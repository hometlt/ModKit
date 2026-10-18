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

/** How one glTF animation plays: its `UV_game_animation_clips` extension (SPEC_UVM §12.2). */
export interface UvmAnimationPlayback {
  readonly loop?: 'once' | 'loop' | 'ping-pong' | 'hold'
  readonly priority?: number
  readonly speedScale?: number
  readonly blendInSeconds?: number
  readonly blendOutSeconds?: number
}

const LOOP_MODES: readonly unknown[] = ['once', 'loop', 'ping-pong', 'hold']

/** The playback fields of an animation (or of a clip to write as one), checked; empty when none. */
export function uvmAnimationPlayback(value: unknown): UvmAnimationPlayback {
  if (value === undefined) return {}
  const record = object(value, 'UV_game_animation_clips of an animation')
  const { loop, priority, speedScale, blendInSeconds, blendOutSeconds } = record
  const seconds = (item: unknown) =>
    item === undefined || (typeof item === 'number' && Number.isFinite(item) && item >= 0)
  if (
    (loop !== undefined && !LOOP_MODES.includes(loop)) ||
    (priority !== undefined && !integer(priority)) ||
    (speedScale !== undefined &&
      (typeof speedScale !== 'number' || !Number.isFinite(speedScale) || speedScale <= 0)) ||
    !seconds(blendInSeconds) ||
    !seconds(blendOutSeconds)
  )
    throw new TypeError('UVM animation playback is invalid')
  return Object.freeze({
    ...(loop === undefined ? {} : { loop: loop as UvmAnimationPlayback['loop'] & string }),
    ...(priority === undefined ? {} : { priority: priority as number }),
    ...(speedScale === undefined ? {} : { speedScale }),
    ...(blendInSeconds === undefined ? {} : { blendInSeconds: blendInSeconds as number }),
    ...(blendOutSeconds === undefined ? {} : { blendOutSeconds: blendOutSeconds as number }),
  })
}

/** One record of an animation's `UV_game_animation_events` (SPEC_UVM §12.3). */
export interface UvmAnimationEvent {
  readonly t: number
  readonly name: string
  /** A node index. */
  readonly socket?: number
  readonly payload?: JsonObject
  readonly duration?: number
}

const EVENT_KEYS = new Set(['t', 'name', 'socket', 'payload', 'duration'])

/** The events of an animation (or to write on one), checked against its node count; empty when none. */
export function uvmAnimationEvents(
  value: unknown,
  nodeCount: number,
): readonly UvmAnimationEvent[] {
  if (value === undefined) return []
  const events = object(value, 'UV_game_animation_events')['events']
  if (!Array.isArray(events)) throw new TypeError('UV_game_animation_events requires events')
  return Object.freeze(
    events.map(item => {
      const record = object(item, 'UVM animation event')
      const { t, name, socket, payload, duration } = record
      if (
        Object.keys(record).some(key => !EVENT_KEYS.has(key)) ||
        typeof t !== 'number' ||
        !Number.isFinite(t) ||
        t < 0 ||
        typeof name !== 'string' ||
        !name ||
        (socket !== undefined && (!integer(socket) || socket < 0 || socket >= nodeCount)) ||
        (payload !== undefined &&
          (payload === null || typeof payload !== 'object' || Array.isArray(payload))) ||
        (duration !== undefined &&
          (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0))
      )
        throw new TypeError('UVM animation event is invalid')
      return Object.freeze({
        t,
        name,
        ...(socket === undefined ? {} : { socket: socket as number }),
        ...(payload === undefined ? {} : { payload: payload as JsonObject }),
        ...(duration === undefined ? {} : { duration }),
      })
    }),
  )
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

/** One named variant of `UV_game_variants.variants` (SPEC_UVM §15.2) as its primitive targets. */
export interface UvmNamedVariant {
  readonly name: string
  /** The display name the writer kept in `extras.modkit.label`, else the name. */
  readonly label: string
  readonly slot?: string
  readonly default?: true
  readonly showPrimitives: readonly { readonly mesh: number; readonly primitive: number }[]
  readonly hidePrimitives: readonly { readonly mesh: number; readonly primitive: number }[]
}

/**
 * The named variants that show and hide primitives. Names are unique, a slot has at most one
 * default and a variant neither shows and hides one target. A variant that replaces the whole
 * model, attaches, swaps materials or switches nodes is read here only for its primitive lists:
 * those parts of the contract have no consumer yet.
 */
export function readUvmNamedVariants(
  document: JsonObject,
  signal?: AbortSignal,
): readonly UvmNamedVariant[] {
  const value = field(field(document['extensions'], 'UV_game_variants'), 'variants')
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TypeError('UVM named variants must be an array')
  if (!array(document, 'extensionsUsed').includes('UV_game_variants'))
    throw new TypeError('UV_game_variants is not declared in extensionsUsed')
  const meshes = array(document, 'meshes')
  const names = new Set<string>()
  const defaults = new Set<string>()
  const targets = (item: JsonObject, key: string, name: string) => {
    const seen = new Set<string>()
    return Object.freeze(
      array(item, key).map(candidate => {
        const target = object(candidate, 'UVM variant primitive')
        const mesh = safeIndex(target['mesh'], meshes.length, 'variant mesh')
        const primitive = safeIndex(
          target['primitive'],
          array(meshes[mesh], 'primitives').length,
          'variant primitive',
        )
        const id = `${mesh}/${primitive}`
        if (seen.has(id)) throw new TypeError(`variant «${name}» repeats a primitive`)
        seen.add(id)
        return Object.freeze({ mesh, primitive })
      }),
    )
  }
  return Object.freeze(
    value.map(candidate => {
      signal?.throwIfAborted()
      const item = object(candidate, 'UVM named variant')
      const name = item['name']
      const slot = item['slot']
      if (typeof name !== 'string' || name.length === 0 || names.has(name))
        throw new TypeError('UVM named variants need unique names')
      names.add(name)
      if (slot !== undefined && (typeof slot !== 'string' || slot.length === 0))
        throw new TypeError(`variant «${name}» names an invalid slot`)
      if (item['default'] !== undefined && typeof item['default'] !== 'boolean')
        throw new TypeError(`variant «${name}» has a non-boolean default`)
      const isDefault = item['default'] === true
      if (isDefault) {
        if (defaults.has(slot ?? '')) throw new TypeError(`variant «${name}» is a second default`)
        defaults.add(slot ?? '')
      }
      const show = targets(item, 'showPrimitives', name)
      const hide = targets(item, 'hidePrimitives', name)
      const hidden = new Set(hide.map(target => `${target.mesh}/${target.primitive}`))
      if (show.some(target => hidden.has(`${target.mesh}/${target.primitive}`)))
        throw new TypeError(`variant «${name}» both shows and hides a primitive`)
      const label = field(field(item['extras'], 'modkit'), 'label')
      return Object.freeze({
        name,
        label: typeof label === 'string' && label.length > 0 ? label : name,
        ...(slot === undefined ? {} : { slot: slot as string }),
        ...(isDefault ? { default: true as const } : {}),
        showPrimitives: show,
        hidePrimitives: hide,
      })
    }),
  )
}

/**
 * The primitives (`mesh-<m>-primitive-<p>`) a choice of variants does not draw: per slot the chosen
 * variant, else the slot's default, hides its `hidePrimitives`. A shown primitive is only eligible:
 * its own stored visibility still applies (§15.2), and the scene's other primitives are untouched.
 * `chosen` names variants, at most one per slot; an unknown name or a second of a slot throws.
 */
export function uvmVariantHiddenPrimitives(
  variants: readonly UvmNamedVariant[],
  chosen: readonly string[] = [],
): ReadonlySet<string> {
  const bySlot = new Map<string, UvmNamedVariant>()
  for (const variant of variants)
    if (variant.default === true) bySlot.set(variant.slot ?? '', variant)
  const picked = new Set<string>()
  for (const name of chosen) {
    const variant = variants.find(candidate => candidate.name === name)
    if (variant === undefined) throw new TypeError(`no variant is named ${name}`)
    if (picked.has(variant.slot ?? ''))
      throw new TypeError(`two variants are chosen for slot «${variant.slot ?? ''}»`)
    picked.add(variant.slot ?? '')
    bySlot.set(variant.slot ?? '', variant)
  }
  const hidden = new Set<string>()
  for (const variant of bySlot.values())
    for (const target of variant.hidePrimitives)
      hidden.add(`mesh-${target.mesh}-primitive-${target.primitive}`)
  return hidden
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
      uvmAnimationPlayback(field(target['extensions'], 'UV_game_animation_clips'))
      uvmAnimationEvents(
        field(target['extensions'], 'UV_game_animation_events'),
        array(document, 'nodes').length,
      )
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
