import type { JsonValue } from '@modkit/sdk'
import { readUvmEffectAnimation } from './effect-tracks.js'
import { array, field, object } from './values.js'

function lensNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
    throw new TypeError(`${label} must be a finite lens number`)
  return value
}

/** Validate the existing v1 lens extension without sampling or interpreting native global ids.
 * Direct callers own their document's input limits; maxKeys is an optional caller key cap,
 * not a document size or work budget. No whole-document snapshot is made here. */
export function validateUvmSceneCamera(
  rawCamera: unknown,
  extensionsUsed: readonly JsonValue[],
  maxKeys = Infinity,
  signal?: AbortSignal,
): void {
  signal?.throwIfAborted()
  const raw = field(field(rawCamera, 'extensions'), 'UV_scene_camera')
  if (raw === undefined) return
  if (!extensionsUsed.includes('UV_scene_camera'))
    throw new TypeError('UV_scene_camera is not declared in extensionsUsed')
  const camera = object(rawCamera, 'camera'), extension = object(raw, 'UV_scene_camera')
  if (extension['version'] !== 1 || camera['type'] !== 'perspective' ||
      Object.keys(extension).some(key => !['version', 'sequenceAnimation'].includes(key)))
    throw new TypeError('invalid UV_scene_camera version, lens type or field')
  const lens = object(camera['perspective'], 'perspective camera')
  const yfov = lensNumber(lens['yfov'], 'camera yfov'),
    near = lensNumber(lens['znear'], 'camera znear')
  if (!(yfov > 0 && yfov < Math.PI) || !(near > 0))
    throw new TypeError('invalid UV_scene_camera perspective lens')
  if (lens['zfar'] !== undefined && !(lensNumber(lens['zfar'], 'camera zfar') > near))
    throw new TypeError('camera zfar must exceed znear')
  const animation = object(extension['sequenceAnimation'], 'UV_scene_camera sequenceAnimation')
  if (Object.keys(animation).some(key => !['yfov', 'znear', 'zfar'].includes(key)))
    throw new TypeError('unsupported UV_scene_camera property')
  const parsed = readUvmEffectAnimation(animation, true, 'seconds', maxKeys, signal)
  for (const property of Object.keys(parsed)) {
    if (lens[property] === undefined)
      throw new TypeError('animated camera property requires a static default')
    const rawEntries = array(animation, property)
    for (const [index, rawEntry] of array(parsed, property).entries()) {
      signal?.throwIfAborted()
      const entry = object(rawEntry, 'camera sequence track')
      const rawTrack = object(field(rawEntries[index], 'track'), 'camera track')
      if (!Object.hasOwn(rawTrack, 'globalSeqId'))
        throw new TypeError('camera track must state nullable globalSeqId')
      if (entry['wrapSeconds'] !== undefined) lensNumber(entry['wrapSeconds'], 'camera wrapSeconds')
      for (const rawKey of array(entry['track'], 'keys')) {
        signal?.throwIfAborted()
        const key = object(rawKey, 'camera key')
        lensNumber(key['frame'], 'camera key frame')
        for (const component of ['vector', 'inTan', 'outTan']) {
          if (key[component] === undefined && component !== 'vector') continue
          const vector = array(key, component)
          if (vector.length !== 1) throw new TypeError('camera lens track width must be one')
          const value = lensNumber(vector[0], 'camera lens key')
          if (component === 'vector' && (!(value > 0) || property === 'yfov' && value >= Math.PI))
            throw new TypeError('invalid authored camera lens key')
        }
      }
    }
  }
}
