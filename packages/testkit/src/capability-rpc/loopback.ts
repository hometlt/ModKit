/**
 * In-memory loopback transport for the capability-RPC conformance kit.
 *
 * Two `FramePort`s joined back to back. Every frame goes through `structuredClone` with its
 * transfer list — exactly what a `MessagePort` does, so a sent `Uint8Array` is detached on the
 * sender — and is delivered asynchronously (microtask or macrotask). The pair also keeps a wire
 * log and accepts per-side taps, which is what lets the kit's negative self-tests build
 * deliberately broken transports (duplicating, dropping, reordering) and prove that the
 * conformance run catches them.
 */

import type { Frame, FramePort } from '@modkit/host/execution'
import type { ConformancePair } from './conformance.js'

export type LoopbackSide = 'host' | 'worker'

/** Rewrites what a side sends: `'drop'` swallows the frame, an array replaces it. */
export type LoopbackTap = (
  frame: Frame,
  side: LoopbackSide,
) => readonly Frame[] | 'drop' | undefined

export interface LoopbackLogEntry {
  readonly from: LoopbackSide
  readonly frame: Frame
}

export interface LoopbackOptions {
  /** `'microtask'` (default) mimics same-tick ports; `'macrotask'` mimics real event-loop hops. */
  readonly delivery?: 'microtask' | 'macrotask'
  /** Set to `false` to deliver the very object that was posted (a transport that does not clone). */
  readonly clone?: boolean
  readonly tap?: LoopbackTap
}

export interface LoopbackPair extends ConformancePair {
  /** Always in-process: both ends are here. */
  readonly worker: FramePort
  readonly log: readonly LoopbackLogEntry[]
  /** Replace the tap after construction (self-tests flip behaviour mid-run). */
  setTap(tap: LoopbackTap | undefined): void
}

type Handler = (frame: unknown) => void

export function createLoopbackPair(options: LoopbackOptions = {}): LoopbackPair {
  const delivery = options.delivery ?? 'microtask'
  const clone = options.clone ?? true
  let tap = options.tap
  let closed = false
  const handlers: Record<LoopbackSide, Set<Handler>> = { host: new Set(), worker: new Set() }
  const log: LoopbackLogEntry[] = []

  const schedule = (task: () => void): void => {
    if (delivery === 'microtask') queueMicrotask(task)
    else setTimeout(task, 0)
  }

  const deliver = (from: LoopbackSide, frame: Frame, transfer: readonly ArrayBuffer[]): void => {
    if (closed) return
    const carried = clone ? (structuredClone(frame, { transfer: [...transfer] }) as Frame) : frame
    log.push({ from, frame: carried })
    let frames: readonly Frame[] = [carried]
    const tapped = tap?.(carried, from)
    if (tapped === 'drop') return
    if (tapped !== undefined) frames = tapped
    const targets = handlers[from === 'host' ? 'worker' : 'host']
    schedule(() => {
      if (closed) return
      for (const item of frames) for (const handler of [...targets]) handler(item)
    })
  }

  const port = (side: LoopbackSide): FramePort => ({
    post: (frame, transfer) => deliver(side, frame, transfer),
    onFrame: handler => {
      handlers[side].add(handler)
      return () => handlers[side].delete(handler)
    },
  })

  return {
    transport: `loopback:${delivery}${clone ? '' : ':no-clone'}`,
    host: port('host'),
    worker: port('worker'),
    log,
    setTap(next) {
      tap = next
    },
    close() {
      closed = true
      handlers.host.clear()
      handlers.worker.clear()
    },
  }
}
