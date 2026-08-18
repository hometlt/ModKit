/**
 * `FramePort` over a `MessagePort`-shaped object — DOM `MessagePort`, Node `worker_threads`
 * `MessagePort`, or Electron `MessagePortMain`. Test infrastructure for exercising the
 * conformance kit against real structured-clone ports (`MessageChannel` pairs live in one
 * thread, so both ends are observable); production transports own their adapters and stay
 * free to differ, but they must pass the same conformance run.
 */

import type { Frame, FramePort } from '@modkitx-x3/host/execution'

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
