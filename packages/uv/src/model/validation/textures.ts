import type { JsonObject, JsonValue } from '@modkit/sdk'
import { array, field, integer, object } from './values.js'

/** `UV_texture_color_key` of one texture (SPEC_UVM §11.6, SPEC_UVM_EXTENSIONS). */
export interface UvmTextureColorKey {
  /** Stored 8-bit red, green, blue. */
  readonly color: readonly [number, number, number]
  /** Largest per-channel difference that still matches; 0 is an exact match. */
  readonly tolerance: number
}

const channel = (value: unknown): value is number => integer(value) && value >= 0 && value <= 255

function colorKeyOf(value: JsonValue, label: string): UvmTextureColorKey {
  const extension = object(value, label)
  if (Object.keys(extension).some(key => !['color', 'tolerance', 'extras'].includes(key)))
    throw new TypeError(`${label} has an unknown property`)
  const color = extension['color']
  if (!Array.isArray(color) || color.length !== 3 || !color.every(channel))
    throw new TypeError(`${label} color must be three stored 8-bit channels`)
  const tolerance = extension['tolerance'] ?? 0
  if (!channel(tolerance)) throw new TypeError(`${label} tolerance must be an integer 0..255`)
  return Object.freeze({
    color: Object.freeze([color[0], color[1], color[2]]) as unknown as readonly [
      number,
      number,
      number,
    ],
    tolerance,
  })
}

/** Every texture's colour key, by glTF texture index; a document without the extension has none. */
export function readUvmTextureColorKeys(
  document: JsonObject,
  signal?: AbortSignal,
): ReadonlyMap<number, UvmTextureColorKey> {
  const keys = new Map<number, UvmTextureColorKey>()
  for (const [index, candidate] of array(document, 'textures').entries()) {
    signal?.throwIfAborted()
    const extension = field(field(candidate, 'extensions'), 'UV_texture_color_key')
    if (extension !== undefined)
      keys.set(index, colorKeyOf(extension, `texture ${index} UV_texture_color_key`))
  }
  return keys
}

export function validateTextureColorKeys(
  document: JsonObject,
  used: readonly JsonValue[],
  signal?: AbortSignal,
): void {
  const keys = readUvmTextureColorKeys(document, signal)
  if (keys.size > 0 && !used.includes('UV_texture_color_key'))
    throw new TypeError('UV_texture_color_key is not declared in extensionsUsed')
  if (keys.size === 0 && used.includes('UV_texture_color_key'))
    throw new TypeError('UV_texture_color_key is declared but absent')
}
