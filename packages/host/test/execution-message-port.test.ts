/**
 * The frame-port adapter's transfer policy.
 *
 * The endpoint transfers result buffers, and a DOM `MessagePort` takes them. Electron's
 * `MessagePortMain` does not: its transfer list accepts only `MessagePortMain` values and rejects
 * an `ArrayBuffer` with `Port at index 0 is not a valid port`. That failure is quiet in a product —
 * json-carrying calls keep working, byte-carrying ones fail, and viewers that degrade honestly
 * still mount — so it is worth a test that names the shape rather than the symptom.
 */
import { describe, expect, it } from 'vitest'

import { framePortFromMessagePort, type MessagePortLike } from '../src/execution/index.js'
import type { Frame } from '../src/execution/protocol.js'

interface Posted {
  readonly message: unknown
  readonly transfer: readonly ArrayBuffer[] | undefined
}

const frame = { kind: 'call', id: 1 } as unknown as Frame

function domPort(posted: Posted[]): MessagePortLike {
  return {
    postMessage: (message, transfer) => posted.push({ message, transfer }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
}

/** Electron's shape: an emitter whose `'message'` events carry `.data`, and no `addEventListener`. */
function mainPort(posted: Posted[]): MessagePortLike {
  return {
    postMessage: (message, transfer) => {
      if (transfer !== undefined && transfer.length > 0) {
        throw new TypeError('Port at index 0 is not a valid port')
      }
      posted.push({ message, transfer })
    },
    on: () => undefined,
    off: () => undefined,
    start: () => undefined,
  }
}

describe('framePortFromMessagePort transfer policy', () => {
  it('moves buffers over a DOM port, so nothing is copied on the fast path', () => {
    const posted: Posted[] = []
    const buffer = new ArrayBuffer(8)
    framePortFromMessagePort(domPort(posted)).post(frame, [buffer])
    expect(posted).toHaveLength(1)
    expect(posted[0]?.transfer).toEqual([buffer])
  })

  it('copies over an Electron-shaped port, because its transfer list takes ports only', () => {
    const posted: Posted[] = []
    const port = mainPort(posted)
    // the bug this replaces: with the list handed through, `postMessage` throws and the frame is lost
    expect(() => port.postMessage(frame, [new ArrayBuffer(8)])).toThrow(/not a valid port/)
    framePortFromMessagePort(port, { listener: 'emitter-event' }).post(frame, [new ArrayBuffer(8)])
    expect(posted).toHaveLength(1)
    expect(posted[0]?.transfer).toBeUndefined()
    expect(posted[0]?.message).toBe(frame)
  })

  it('lets a transport override the default in either direction', () => {
    const moved: Posted[] = []
    const buffer = new ArrayBuffer(8)
    // an emitter-event port whose platform *can* transfer (a Node port behind an event wrapper)
    framePortFromMessagePort(domPort(moved), { listener: 'emitter-event', transfer: 'move' }).post(
      frame,
      [buffer],
    )
    expect(moved[0]?.transfer).toEqual([buffer])

    const copied: Posted[] = []
    framePortFromMessagePort(domPort(copied), { transfer: 'copy' }).post(frame, [
      new ArrayBuffer(8),
    ])
    expect(copied[0]?.transfer).toBeUndefined()
  })

  it('keeps emitter-value the default for a bare emitter, so the copy rule is opt-in by shape', () => {
    const posted: Posted[] = []
    const buffer = new ArrayBuffer(8)
    const bare: MessagePortLike = {
      postMessage: (message, transfer) => posted.push({ message, transfer }),
      on: () => undefined,
      off: () => undefined,
    }
    framePortFromMessagePort(bare).post(frame, [buffer])
    expect(posted[0]?.transfer).toEqual([buffer])
  })
})
