/**
 * JSON encoding of capability-RPC frames (F1) — for transports that carry text or JSON, not
 * structured clone: a VS Code webview channel, a WebSocket, a pipe. Wire values are JSON plus
 * what JSON lacks: `bigint` and `Uint8Array` travel as tagged objects
 * (`{"$x3":"bigint","value":"123"}`, `{"$x3":"bytes","base64":"…"}`), the numbers JSON cannot
 * spell (`-0`, `NaN`, `±Infinity`) as `{"$x3":"number","value":"-0"}` so the receiving endpoint
 * applies its own rules to them (negative zero survives, NaN is still refused there), and a plain
 * object that itself owns a `$x3` key is wrapped (`{"$x3":"object","value":{…}}`) so nothing
 * user-authored can impersonate a tag. Keys are (re)created as own properties — a `__proto__`
 * key arrives as the forbidden key it is, never as a prototype. `undefined` inside objects is
 * dropped, as JSON does; inside arrays it becomes `null`. Handle refs are plain JSON already.
 * Nothing is transferred — bytes are copied (`transfer: copied` in the conformance kit) — and a
 * typed array that is a partial view or shares its buffer is refused at `post` rather than
 * silently normalised: the peer's endpoint would have failed closed on it, and this transport
 * must not launder it into a clean copy.
 *
 * `framePortFromJsonPort` adapts any text channel (`send(text)` / `onMessage(handler)`) to a
 * `FramePort`; the endpoint still validates every decoded frame, so a hostile peer gets the same
 * fail-closed treatment as on any other transport. A message that is not valid JSON is delivered
 * as the string itself (the endpoint then fails closed on a non-frame, as the kit's `not-an-object`
 * probe expects).
 */

import type { FramePort } from './endpoint.js'
import type { Frame } from './protocol.js'

const TAG = '$x3'

function base64Of(bytes: Uint8Array): string {
  if (typeof Buffer === 'function') return Buffer.from(bytes).toString('base64')
  let binary = ''
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0)
  }
  return btoa(binary)
}

function bytesOf(base64: string): Uint8Array {
  if (typeof Buffer === 'function') return new Uint8Array(Buffer.from(base64, 'base64'))
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index)
  return out
}

const SHARED = typeof SharedArrayBuffer === 'function' ? SharedArrayBuffer : undefined

function own(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  })
}

function bytesView(view: ArrayBufferView): Uint8Array {
  if (SHARED !== undefined && view.buffer instanceof SHARED) {
    throw new TypeError('json transport: cannot carry a typed array over a shared buffer')
  }
  if (view.byteOffset !== 0 || view.byteLength !== view.buffer.byteLength) {
    throw new TypeError('json transport: cannot carry a partial typed-array view')
  }
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
}

/** Structured value → JSON-safe value (tagged bigint/bytes/special numbers, escaped `$x3`). */
export function encodeJsonValue(value: unknown): unknown {
  if (typeof value === 'bigint') return { [TAG]: 'bigint', value: value.toString(10) }
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return { [TAG]: 'number', value: '-0' }
    if (Number.isNaN(value)) return { [TAG]: 'number', value: 'NaN' }
    if (value === Number.POSITIVE_INFINITY) return { [TAG]: 'number', value: 'Infinity' }
    if (value === Number.NEGATIVE_INFINITY) return { [TAG]: 'number', value: '-Infinity' }
    return value
  }
  if (ArrayBuffer.isView(value)) return { [TAG]: 'bytes', base64: base64Of(bytesView(value)) }
  if (value instanceof ArrayBuffer) {
    return { [TAG]: 'bytes', base64: base64Of(new Uint8Array(value)) }
  }
  if (Array.isArray(value)) {
    return value.map(item => (item === undefined ? null : encodeJsonValue(item)))
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue
      own(out, key, encodeJsonValue(item))
    }
    return Object.prototype.hasOwnProperty.call(value, TAG) ? { [TAG]: 'object', value: out } : out
  }
  return value
}

/** JSON-safe value → structured value (the inverse of `encodeJsonValue`). */
export function decodeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeJsonValue)
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    const tag = record[TAG]
    if (typeof tag === 'string' && Object.keys(record).length === 2) {
      if (
        tag === 'bigint' &&
        typeof record['value'] === 'string' &&
        /^-?\d+$/u.test(record['value'])
      ) {
        return BigInt(record['value'])
      }
      if (tag === 'bytes' && typeof record['base64'] === 'string') return bytesOf(record['base64'])
      if (tag === 'number' && typeof record['value'] === 'string') {
        switch (record['value']) {
          case '-0':
            return -0
          case 'NaN':
            return Number.NaN
          case 'Infinity':
            return Number.POSITIVE_INFINITY
          case '-Infinity':
            return Number.NEGATIVE_INFINITY
          default:
            break
        }
      }
      if (tag === 'object' && typeof record['value'] === 'object' && record['value'] !== null) {
        return decodeJsonValue(record['value'])
      }
    }
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(record)) own(out, key, decodeJsonValue(item))
    return out
  }
  return value
}

/** A frame (or any posted value) as one JSON text. */
export function encodeFrameJson(frame: unknown): string {
  return JSON.stringify(encodeJsonValue(frame))
}

/** One JSON text → the frame value; text that is not JSON is handed back as the string itself. */
export function decodeFrameJson(text: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return text
  }
  return decodeJsonValue(parsed)
}

/** A text channel: what a WebSocket, a VS Code webview or a pipe can offer. */
export interface JsonPortLike {
  send(text: string): void
  /** Subscribe to incoming texts; returns the unsubscribe function. */
  onMessage(handler: (text: string) => void): () => void
  close?(): void
}

/** `FramePort` over a text channel, encoding every frame as JSON and decoding what arrives. */
export function framePortFromJsonPort(port: JsonPortLike): FramePort {
  return {
    post(frame: Frame): void {
      port.send(encodeFrameJson(frame))
    },
    onFrame(handler: (frame: unknown) => void): () => void {
      return port.onMessage(text => handler(decodeFrameJson(text)))
    },
  }
}
