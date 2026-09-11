// Format-neutral field wiring; the existing simulator owns field physics.
import type { JsonObject } from '@modkit/sdk'
import type {
  RenderEffectForce,
  RenderEffectWarp,
  RenderEffectSequenceTracks,
} from '@modkit/codec-kit/legacy/models'
import { sampleEffectSequenceScalar } from '@modkit/codec-kit/model-math/effects-sim'
import { readUvmEffectAnimation } from './effect-tracks.js'
import { array, object, safeIndex } from './values.js'

interface Options {
  readonly nodeCount: number
  readonly activeNodes: ReadonlySet<string>
  readonly timeUnit: 'seconds' | 'milliseconds'
  readonly maxNodes: number
  readonly maxBytes: number
  readonly warn: (message: string) => void
  readonly signal?: AbortSignal
}
function scalar(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TypeError(`invalid effect field ${name}`)
  return value
}
function unsigned(value: unknown, name: string): number {
  const result = scalar(value, name)
  if (!Number.isSafeInteger(result) || result < 0 || result > 0xffffffff)
    throw new TypeError(`invalid effect field ${name}`)
  return result
}
function flag(value: unknown, name: string): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw new TypeError(`invalid effect field ${name}`)
  return value
}

/** Own only public field definitions. Sample their already-declared tracks once per simulator
 * step before force/warp evaluation. Existing simulation remains the sole field physics engine. */
export function readUvmEffectFields(effect: JsonObject, options: Options) {
  const forces: RenderEffectForce[] = [],
    warps: RenderEffectWarp[] = []
  const updates: ((time: number, sequence: number | null) => void)[] = []
  let count = 0
  function animation(
    entry: JsonObject,
    target: RenderEffectForce | RenderEffectWarp,
    defaults: Record<string, number>,
  ) {
    const source = entry['sequenceAnimation']
    if (source === undefined) return
    const parsed = readUvmEffectAnimation(
      source,
      true,
      options.timeUnit,
      options.maxNodes,
      options.signal,
    )
    for (const key of Object.keys(parsed))
      if (!Object.hasOwn(defaults, key))
        throw new TypeError(`unsupported effect field track ${key}`)
    // readUvmEffectAnimation validates every complete entry; field tracks additionally require scalars.
    for (const list of Object.values(parsed))
      for (const raw of array({ list }, 'list')) {
        const track = object(object(raw, 'field sequence')['track'], 'field track')
        for (const rawKey of array(track, 'keys')) {
          const key = object(rawKey, 'field key')
          for (const component of ['vector', 'inTan', 'outTan'])
            if (key[component] !== undefined && array(key, component).length !== 1)
              throw new TypeError('effect field animation requires scalar keys')
        }
      }
    const tracks = parsed as unknown as Readonly<Record<string, RenderEffectSequenceTracks>>
    updates.push((time, sequence) => {
      const sampled: Record<string, number> = {}
      for (const [key, fallback] of Object.entries(defaults))
        sampled[key] = scalar(
          sampleEffectSequenceScalar(tracks[key], undefined, sequence, time, fallback),
          key,
        )
      Object.assign(target, sampled)
    })
  }
  for (const kind of ['forces', 'warps'] as const)
    for (const [index, value] of array(effect, kind).entries()) {
      options.signal?.throwIfAborted()
      const entry = object(value, kind),
        node = safeIndex(entry['node'], options.nodeCount, `${kind} node`)
      if (!options.activeNodes.has(`node-${node}`)) continue
      if (++count > options.maxNodes || count * 4096 > options.maxBytes)
        throw new RangeError('effect fields exceed budget')
      const name = typeof entry['name'] === 'string' ? entry['name'] : `${kind}-${index}`
      let allowed: readonly string[]
      if (kind === 'forces') {
        const type = entry['type'],
          shape = entry['shape']
        if (type !== 'radial' && type !== 'wind' && type !== 'explosion')
          throw new TypeError('unsupported effect force type')
        if (shape !== 'sphere' && shape !== 'cylinder' && shape !== 'box' && shape !== 'hemisphere')
          throw new TypeError('unsupported effect force shape')
        const defaults = Object.fromEntries(
          ['strength', 'width', 'height', 'length'].map(key => [key, scalar(entry[key], key)]),
        )
        const force: RenderEffectForce = {
          name,
          boneIndex: node,
          type,
          shape,
          channels: unsigned(entry['channels'], 'channels'),
          strength: scalar(entry['strength'], 'strength'),
          width: scalar(entry['width'], 'width'),
          height: scalar(entry['height'], 'height'),
          length: scalar(entry['length'], 'length'),
          falloff: flag(entry['falloff'], 'falloff'),
          heightGradient: flag(entry['heightGradient'], 'heightGradient'),
          unbounded: flag(entry['unbounded'], 'unbounded'),
        }
        animation(entry, force, defaults)
        forces.push(force)
        allowed = [
          'type',
          'shape',
          'channels',
          'strength',
          'width',
          'height',
          'length',
          'falloff',
          'heightGradient',
          'unbounded',
        ]
      } else {
        const warpType = unsigned(entry['warpType'], 'warpType')
        if (warpType !== 0) {
          options.warn(`${name}: unsupported warpType ${warpType}.`)
          continue
        }
        const warp: RenderEffectWarp = {
          name,
          boneIndex: node,
          warpType,
          radius: scalar(entry['radius'], 'radius'),
          height: scalar(entry['height'], 'height'),
          strength: scalar(entry['strength'], 'strength'),
          angular: scalar(entry['angular'], 'angular'),
          axial: scalar(entry['axial'], 'axial'),
          radial: scalar(entry['radial'], 'radial'),
        }
        animation(entry, warp, { radius: warp.radius, strength: warp.strength })
        warps.push(warp)
        allowed = ['warpType', 'radius', 'height', 'strength', 'angular', 'axial', 'radial']
      }
      for (const key of Object.keys(entry))
        if (!['name', 'node', 'sequenceAnimation', ...allowed].includes(key))
          options.warn(`${name}: preview does not apply ${key}.`)
    }
  return {
    forces,
    warps,
    count,
    sample(time: number, sequence: number | null) {
      options.signal?.throwIfAborted()
      for (const update of updates) update(time, sequence)
    },
  }
}
