/**
 * Baked particles (`UV_game_baked_particles`, SPEC_UVM §13.4): sprites a scripted effect system
 * (PopcornFX) drew, stored per clip, batch and frame. Presentation data — nothing is simulated.
 *
 * Owner: [MK] Core (scene). `readUvmBakedParticles` reads and checks the extension and its
 * accessors once per document; `bakedParticleSprites` picks the frame of a track for a clock and
 * builds each sprite's quad in the effect geometry form (UvmParticleGeometryEntry: four corners,
 * triangles 0 1 2 and 0 2 3), in the `spaceNode` frame, oriented to a camera given in that frame.
 * The effect frame (effects.ts) batches them per draw with the effect material path. Limits: a
 * frame draws at most `maxSprites` sprites, the first ones; nothing interpolates between frames.
 */
import type { JsonObject } from '@modkit/sdk'
import { readUvmAccessor } from '@modkit/uv/model/accessor'
import type { UvmParticleGeometryEntry } from './effect-particles.js'
import { array, field, object, safeIndex } from './values.js'

type Vec3 = readonly [number, number, number]

/** Floats per sprite: position, half size, rotation, colour, atlas cell, axis, normal. */
const SPRITE_FLOATS = 17

export interface UvmBakedParticleBatch {
  readonly material: number
  readonly orientation: 'camera' | 'axis' | 'plane'
  readonly atlas: readonly [number, number]
}

export interface UvmBakedParticleTrack {
  readonly sequence: number
  readonly batch: number
  readonly loop: boolean
  /** Frame-count + 1 ascending sprite offsets. */
  readonly frames: Uint32Array
  readonly sprites: Float32Array
}

export interface UvmBakedParticles {
  readonly spaceNode?: number
  readonly frameRate: number
  readonly batches: readonly UvmBakedParticleBatch[]
  readonly tracks: readonly UvmBakedParticleTrack[]
}

const read = new WeakMap<JsonObject, UvmBakedParticles | null>()

/**
 * The document's baked particles with their accessors decoded, or undefined without the extension.
 * Refuses a malformed extension (unknown orientation, offsets that do not run from 0 to the sprite
 * count, non-finite values) rather than drawing part of it. Read once per document object.
 */
export function readUvmBakedParticles(
  document: JsonObject,
  binary: Uint8Array | undefined,
  maxBytes: number,
  signal?: AbortSignal,
): UvmBakedParticles | undefined {
  const known = read.get(document)
  if (known !== undefined) return known ?? undefined
  const value = field(document['extensions'], 'UV_game_baked_particles')
  if (value === undefined) {
    read.set(document, null)
    return undefined
  }
  if (binary === undefined) throw new TypeError('baked particles need the UVM binary chunk')
  const extension = object(value, 'UV_game_baked_particles')
  const frameRate = extension['frameRate']
  if (typeof frameRate !== 'number' || !(frameRate > 0) || !Number.isFinite(frameRate))
    throw new TypeError('baked particles need a positive frame rate')
  const nodes = Array.isArray(document['nodes']) ? document['nodes'].length : 0
  const materials = Array.isArray(document['materials']) ? document['materials'].length : 0
  const batches = array(extension, 'batches').map((entry): UvmBakedParticleBatch => {
    const batch = object(entry, 'baked particle batch')
    const orientation = batch['orientation']
    if (orientation !== 'camera' && orientation !== 'axis' && orientation !== 'plane')
      throw new TypeError('baked particle batch has no known orientation')
    const atlas = batch['atlas'] === undefined ? [1, 1] : array(batch, 'atlas')
    if (
      atlas.length !== 2 ||
      !atlas.every(cells => Number.isSafeInteger(cells) && Number(cells) >= 1)
    )
      throw new TypeError('baked particle batch atlas must be two positive integers')
    return {
      material: safeIndex(batch['material'], materials, 'baked particle material'),
      orientation,
      atlas: [Number(atlas[0]), Number(atlas[1])],
    }
  })
  let bytes = 0
  const tracks = array(extension, 'tracks').map((entry): UvmBakedParticleTrack => {
    signal?.throwIfAborted()
    const track = object(entry, 'baked particle track')
    const sequence = track['sequence']
    if (!Number.isSafeInteger(sequence) || Number(sequence) < 0)
      throw new TypeError('baked particle track needs a sequence')
    const frames = readUvmAccessor(
      document,
      binary,
      track['frames'],
      { maxScalarBytes: maxBytes - bytes },
      'indices',
      signal,
    )
    bytes += frames.values.byteLength
    const sprites = readUvmAccessor(
      document,
      binary,
      track['sprites'],
      { maxScalarBytes: maxBytes - bytes },
      'baked particle sprites',
      signal,
    )
    bytes += sprites.values.byteLength
    const values = sprites.values
    const count = values.length / SPRITE_FLOATS
    const offsets = frames.values
    if (
      !(values instanceof Float32Array) ||
      sprites.width !== 1 ||
      !Number.isInteger(count) ||
      offsets.length < 2 ||
      offsets[0] !== 0 ||
      offsets[offsets.length - 1] !== count ||
      offsets.some((offset, at) => at > 0 && offset < offsets[at - 1]!) ||
      !values.every(Number.isFinite)
    )
      throw new TypeError(
        'baked particle track needs finite sprites and offsets from 0 to their count',
      )
    return {
      sequence: Number(sequence),
      batch: safeIndex(track['batch'], batches.length, 'baked particle batch'),
      loop: track['loop'] === true,
      frames: offsets,
      sprites: values,
    }
  })
  const spaceNode =
    extension['spaceNode'] === undefined
      ? undefined
      : safeIndex(extension['spaceNode'], nodes, 'baked particle spaceNode')
  const result = { ...(spaceNode === undefined ? {} : { spaceNode }), frameRate, batches, tracks }
  read.set(document, result)
  return result
}

const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const unit = (v: Vec3): Vec3 | undefined => {
  const length = Math.hypot(v[0], v[1], v[2])
  return length > 0 ? scale(v, 1 / length) : undefined
}

/**
 * The quads of a track's frame at `time` (seconds into its clip): frame ⌊time × frameRate⌋, wrapped
 * on a looping track and nothing past the end of another. `camera` is the view's right, up and
 * position in the `spaceNode` frame. A sprite whose side or up vector vanishes (an axis-aligned card
 * seen down its axis) is left out.
 */
export function bakedParticleSprites(
  baked: UvmBakedParticles,
  track: UvmBakedParticleTrack,
  time: number,
  camera: { readonly right: Vec3; readonly up: Vec3; readonly position: Vec3 },
  maxSprites: number,
): { readonly sprites: UvmParticleGeometryEntry[]; readonly dropped: number } {
  const frameCount = track.frames.length - 1
  let frame = Math.floor(time * baked.frameRate + 1e-6)
  if (frame < 0) frame = 0
  if (frame >= frameCount) {
    if (!track.loop || frameCount === 0) return { sprites: [], dropped: 0 }
    frame %= frameCount
  }
  const first = track.frames[frame]!
  const end = track.frames[frame + 1]!
  const batch = baked.batches[track.batch]!
  const [columns, rows] = batch.atlas
  const values = track.sprites
  const sprites: UvmParticleGeometryEntry[] = []
  const last = Math.min(end, first + maxSprites)
  for (let index = first; index < last; index++) {
    const at = index * SPRITE_FLOATS
    const position: Vec3 = [values[at]!, values[at + 1]!, values[at + 2]!]
    const width = values[at + 3]!,
      height = values[at + 4]!,
      rotation = values[at + 5]!
    const cosine = Math.cos(rotation),
      sine = Math.sin(rotation)
    const axis: Vec3 = [values[at + 11]!, values[at + 12]!, values[at + 13]!]
    const normal: Vec3 = [values[at + 14]!, values[at + 15]!, values[at + 16]!]
    let side: Vec3 | undefined, up: Vec3 | undefined
    if (batch.orientation === 'camera') {
      const { right: r, up: u } = camera
      side = scale(
        [r[0] * cosine + u[0] * sine, r[1] * cosine + u[1] * sine, r[2] * cosine + u[2] * sine],
        width,
      )
      up = scale(
        [u[0] * cosine - r[0] * sine, u[1] * cosine - r[1] * sine, u[2] * cosine - r[2] * sine],
        height,
      )
    } else if (batch.orientation === 'axis') {
      up = axis
      const toCamera: Vec3 = [
        camera.position[0] - position[0],
        camera.position[1] - position[1],
        camera.position[2] - position[2],
      ]
      const across = unit(cross(axis, toCamera))
      side = across === undefined ? undefined : scale(across, width)
    } else {
      const n = unit(normal),
        along = unit(axis)
      if (n !== undefined && along !== undefined) {
        const turned = unit([
          along[0] * cosine + cross(n, along)[0] * sine,
          along[1] * cosine + cross(n, along)[1] * sine,
          along[2] * cosine + cross(n, along)[2] * sine,
        ])
        const across = turned === undefined ? undefined : unit(cross(turned, n))
        if (turned !== undefined && across !== undefined) {
          up = scale(turned, height)
          side = scale(across, width)
        }
      }
    }
    if (side === undefined || up === undefined) continue
    const positions = new Float32Array(12)
    // corners: top left, top right, bottom right, bottom left (v grows from U toward −U)
    ;[
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ].forEach(([s, u], corner) => {
      for (let axisIndex = 0; axisIndex < 3; axisIndex++)
        positions[corner * 3 + axisIndex] =
          position[axisIndex]! + side[axisIndex]! * s! + up[axisIndex]! * u!
    })
    const cell = Math.max(0, Math.trunc(values[at + 10]!))
    const column = cell % columns,
      row = Math.floor(cell / columns) % rows
    const u0 = column / columns,
      u1 = (column + 1) / columns,
      v0 = row / rows,
      v1 = (row + 1) / rows
    const colors = new Float32Array(16)
    for (let corner = 0; corner < 4; corner++)
      colors.set(values.subarray(at + 6, at + 10), corner * 4)
    sprites.push({
      emitter: track.batch,
      slot: index,
      positions,
      indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
      textureCoordinates: Float32Array.of(u0, v0, u1, v0, u1, v1, u0, v1),
      colors,
    })
  }
  return { sprites, dropped: end - last }
}
