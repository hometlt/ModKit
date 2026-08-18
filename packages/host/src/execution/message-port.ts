/**
 * `FramePort` over a `MessagePort`-shaped object — DOM `MessagePort`, Node `worker_threads`
 * `MessagePort`, or Electron `MessagePortMain`. This is the one production adapter every
 * structured-clone transport of the host uses (the Node worker backend, the Electron preload
 * bridge, browser workers) and the one the testkit conformance kit proves; a transport that
 * needs a different adapter must pass the same conformance run.
 *
 * The adapter carries frames unchanged: `post` hands the frame and its transfer list to
 * `postMessage`, `onFrame` unwraps `event.data` where the port emits events and passes emitter
 * payloads through. Nothing is validated here — the endpoint validates every frame it receives.
 */

import type { Frame } from './protocol.js'
import type { FramePort } from './endpoint.js'

export interface MessagePortLike {
  postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void
  /** Listener parameter is `object` so DOM/Node `EventListener` signatures stay assignable. */
  addEventListener?(type: 'message', listener: (event: object) => void): void
  removeEventListener?(type: 'message', listener: (event: object) => void): void
  on?(event: 'message', listener: (payload: unknown) => void): unknown
  off?(event: 'message', listener: (payload: unknown) => void): unknown
  start?(): void
  close?(): void
}

export interface MessagePortFrameOptions {
  /**
   * How `'message'` listeners receive payloads:
   *  - `'event-target'` — `addEventListener('message', e => e.data)` (DOM, Node ≥ 15);
   *  - `'emitter-value'` — `on('message', value => …)` (Node emitter style);
   *  - `'emitter-event'` — `on('message', event => event.data)` (Electron `MessagePortMain`).
   * Default: `'event-target'` when `addEventListener` exists, otherwise `'emitter-value'`.
   */
  readonly listener?: 'event-target' | 'emitter-value' | 'emitter-event'
}

export function framePortFromMessagePort(
  port: MessagePortLike,
  options: MessagePortFrameOptions = {},
): FramePort {
  const style =
    options.listener ??
    (typeof port.addEventListener === 'function' ? 'event-target' : 'emitter-value')
  return {
    post(frame: Frame, transfer: readonly ArrayBuffer[]): void {
      port.postMessage(frame, [...transfer])
    },
    onFrame(handler: (frame: unknown) => void): () => void {
      if (style === 'event-target') {
        const listener = (event: object) =>
          handler('data' in event ? (event as { readonly data: unknown }).data : undefined)
        port.addEventListener?.('message', listener)
        port.start?.()
        return () => port.removeEventListener?.('message', listener)
      }
      const listener =
        style === 'emitter-value'
          ? (payload: unknown) => handler(payload)
          : (payload: unknown) =>
              handler(
                typeof payload === 'object' && payload !== null && 'data' in payload
                  ? (payload as { readonly data: unknown }).data
                  : payload,
              )
      port.on?.('message', listener)
      port.start?.()
      return () => port.off?.('message', listener)
    },
  }
}
