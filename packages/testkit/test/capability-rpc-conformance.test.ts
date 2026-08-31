import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import type { Frame } from '@modkit/host/execution'
import {
  framePortFromJsonPort,
  framePortFromMessagePort as productionAdapter,
  protocolLimits,
  type JsonPortLike,
} from '@modkit/host/execution'
import { DEFAULT_WORKER_BACKEND_POLICY, spawnWorkerRealm } from '@modkit/host/node'
import {
  CONFORMANCE_CASE_IDS,
  HOSTILE_WORKER_FIXTURES,
  createLoopbackPair,
  demoWorkerPair,
  describeConformanceReport,
  framePortFromMessagePort,
  runFramePortConformance,
  type ConformancePair,
  type ConformanceReport,
} from '@modkit/testkit'

function expectConformant(report: ConformanceReport): void {
  expect(report.failures, describeConformanceReport(report)).toEqual([])
  expect(report.skipped, describeConformanceReport(report)).toEqual([])
  expect(report.passed).toEqual(CONFORMANCE_CASE_IDS)
  expect(report.observations['delivery']).toBe('asynchronous')
}

describe('capability-rpc conformance kit — reference transports pass', () => {
  it('loopback with microtask delivery passes every case and detaches transferred bytes', async () => {
    const report = await runFramePortConformance(() =>
      createLoopbackPair({ delivery: 'microtask' }),
    )
    expectConformant(report)
    expect(report.transport).toBe('loopback:microtask')
    expect(report.observations['transfer']).toBe('detached')
  }, 60_000)

  it('loopback with macrotask delivery (real event-loop hops) passes every case', async () => {
    const report = await runFramePortConformance(() =>
      createLoopbackPair({ delivery: 'macrotask' }),
    )
    expectConformant(report)
    expect(report.transport).toBe('loopback:macrotask')
  }, 60_000)

  it('a real Node MessageChannel (structured clone + transfer over MessagePort) passes every case', async () => {
    const report = await runFramePortConformance((): ConformancePair => {
      const channel = new MessageChannel()
      return {
        transport: 'node:MessageChannel',
        host: framePortFromMessagePort(channel.port1),
        worker: framePortFromMessagePort(channel.port2),
        close() {
          channel.port1.close()
          channel.port2.close()
        },
      }
    })
    expectConformant(report)
    expect(report.transport).toBe('node:MessageChannel')
    expect(report.observations['transfer']).toBe('detached')
  }, 60_000)

  it('the Electron MessagePortMain event shape passes (emitter-event: listeners receive { data }) — the R6 main-side adapter', async () => {
    const report = await runFramePortConformance((): ConformancePair => {
      const channel = new MessageChannel()
      // MessagePortMain delivers events whose payload sits under .data; wrap a Node port to
      // that exact shape so the kit proves the adapter style the Electron main process uses
      const mainShape = (port: InstanceType<typeof MessageChannel>['port1']) => {
        const wrapped = new Map<(payload: unknown) => void, (value: unknown) => void>()
        return {
          postMessage: (message: unknown, transfer?: readonly ArrayBuffer[]) =>
            port.postMessage(message, transfer === undefined ? [] : [...transfer]),
          on(_event: 'message', listener: (payload: unknown) => void) {
            const translated = (value: unknown) => listener({ data: value })
            wrapped.set(listener, translated)
            port.on('message', translated)
            return this
          },
          off(_event: 'message', listener: (payload: unknown) => void) {
            const translated = wrapped.get(listener)
            if (translated !== undefined) port.off('message', translated)
            wrapped.delete(listener)
            return this
          },
          start: () => port.start(),
          close: () => port.close(),
        }
      }
      return {
        transport: 'electron:MessagePortMain-shape',
        host: framePortFromMessagePort(channel.port1, { listener: 'event-target' }),
        worker: framePortFromMessagePort(mainShape(channel.port2), { listener: 'emitter-event' }),
        close() {
          channel.port1.close()
          channel.port2.close()
        },
      }
    })
    expectConformant(report)
    expect(report.transport).toBe('electron:MessagePortMain-shape')
    expect(report.observations['transfer']).toBe('detached')
  }, 60_000)

  it('the emitter-style MessagePort listener works too (Node `on("message")`)', async () => {
    const report = await runFramePortConformance(
      (): ConformancePair => {
        const channel = new MessageChannel()
        return {
          transport: 'node:MessageChannel:emitter',
          host: framePortFromMessagePort(channel.port1, { listener: 'emitter-value' }),
          worker: framePortFromMessagePort(channel.port2, { listener: 'emitter-value' }),
          close() {
            channel.port1.close()
            channel.port2.close()
          },
        }
      },
      { only: ['rt-load-call-lease-iterate-dispose', 'rt-wire-values', 'hs-duplicate-reply'] },
    )
    expect(report.failures, describeConformanceReport(report)).toEqual([])
    expect(report.passed).toEqual([
      'rt-load-call-lease-iterate-dispose',
      'rt-wire-values',
      'hs-duplicate-reply',
    ])
  }, 30_000)
})

describe('capability-rpc conformance kit — JSON text transport (F1: bigint and bytes as tagged JSON, nothing transferred)', () => {
  /** Two text channels joined by macrotask delivery — a socket or a webview channel in miniature. */
  function jsonPair(): { a: JsonPortLike; b: JsonPortLike; close(): void } {
    const listeners = { a: new Set<(text: string) => void>(), b: new Set<(text: string) => void>() }
    let open = true
    const make = (mine: 'a' | 'b', other: 'a' | 'b'): JsonPortLike => ({
      send(text) {
        if (!open) return
        setTimeout(() => {
          if (!open) return
          for (const listener of [...listeners[other]]) listener(text)
        }, 0)
      },
      onMessage(handler) {
        listeners[mine].add(handler)
        return () => listeners[mine].delete(handler)
      },
    })
    return {
      a: make('a', 'b'),
      b: make('b', 'a'),
      close() {
        open = false
        listeners.a.clear()
        listeners.b.clear()
      },
    }
  }

  it('passes every case over JSON text with copied bytes', async () => {
    const report = await runFramePortConformance((): ConformancePair => {
      const pair = jsonPair()
      return {
        transport: 'json:text',
        host: framePortFromJsonPort(pair.a),
        worker: framePortFromJsonPort(pair.b),
        close: () => pair.close(),
      }
    })
    expect(report.failures, describeConformanceReport(report)).toEqual([])
    // the one hostile probe JSON cannot carry faithfully (a partial typed-array view) is refused
    // at post — the transport never launders it into a clean copy — so the kit skips that case
    expect(
      report.skipped.map(item => item.caseId),
      describeConformanceReport(report),
    ).toEqual(['hs-bad-values-reply'])
    expect(report.passed).toEqual(CONFORMANCE_CASE_IDS.filter(id => id !== 'hs-bad-values-reply'))
    expect(report.observations['delivery']).toBe('asynchronous')
    // JSON carries bytes by copy: the sender keeps its buffer
    expect(report.observations['transfer']).toBe('copied')
  }, 60_000)
})

describe('capability-rpc conformance kit — broken transports are caught', () => {
  it('a transport that duplicates replies fails the run with a duplicate-reply violation', async () => {
    const report = await runFramePortConformance(
      () =>
        createLoopbackPair({
          tap: (frame: Frame, side) =>
            side === 'worker' && frame.t === 'return'
              ? [frame, { ...frame, id: frame.id + 100_000 }]
              : undefined,
        }),
      { only: ['rt-load-call-lease-iterate-dispose', 'rt-errors'] },
    )
    expect(report.passed).toEqual([])
    expect(report.failures.map(item => item.caseId)).toEqual([
      'rt-load-call-lease-iterate-dispose',
      'rt-errors',
    ])
    expect(report.failures[0]?.message).toMatch(/protocol-violation|endpoint-closed|failed/)
  }, 30_000)

  it('a transport that silently drops frames fails the run (calls time out instead of settling)', async () => {
    let dropped = 0
    const report = await runFramePortConformance(
      () =>
        createLoopbackPair({
          tap: (frame: Frame, side) => {
            if (side === 'worker' && frame.t === 'return' && frame.inReplyTo > 2 && dropped < 1) {
              dropped += 1
              return 'drop'
            }
            return undefined
          },
        }),
      { only: ['rt-load-call-lease-iterate-dispose'] },
    )
    expect(report.passed).toEqual([])
    expect(report.failures).toHaveLength(1)
    expect(report.failures[0]?.message).toMatch(/deadline-exceeded|did not finish/)
  }, 30_000)

  it('a transport that delivers synchronously inside post is reported', async () => {
    const report = await runFramePortConformance(
      () => {
        const pair = createLoopbackPair({ delivery: 'microtask' })
        // wrap: deliver each frame *synchronously* to the peer in addition to the async copy
        let hostHandler: ((frame: unknown) => void) | undefined
        let workerHandler: ((frame: unknown) => void) | undefined
        const sync: ConformancePair = {
          transport: 'loopback:synchronous',
          host: {
            post: (frame, transfer) => {
              const copy = structuredClone(frame, { transfer: [...transfer] })
              workerHandler?.(copy)
            },
            onFrame: handler => {
              hostHandler = handler
              return () => void (hostHandler = undefined)
            },
          },
          worker: {
            post: (frame, transfer) => {
              const copy = structuredClone(frame, { transfer: [...transfer] })
              hostHandler?.(copy)
            },
            onFrame: handler => {
              workerHandler = handler
              return () => void (workerHandler = undefined)
            },
          },
          close: () => pair.close?.(),
        }
        return sync
      },
      { only: ['rt-ordering'] },
    )
    expect(report.failures.map(item => item.caseId)).toEqual(['rt-ordering'])
    expect(report.failures[0]?.message).toMatch(/synchronously/)
  }, 30_000)

  it('a validating transport that refuses raw objects skips hostile cases instead of failing them', async () => {
    const report = await runFramePortConformance(
      () => {
        const pair = createLoopbackPair()
        const strict = (port: ConformancePair['host']): ConformancePair['host'] => ({
          post: (frame, transfer) => {
            if (typeof frame !== 'object' || frame === null || typeof frame.t !== 'string')
              throw new TypeError('strict transport: not a frame')
            port.post(frame, transfer)
          },
          onFrame: handler => port.onFrame(handler),
        })
        return {
          transport: 'loopback:strict',
          host: strict(pair.host),
          worker: strict(pair.worker),
          close: () => pair.close?.(),
        }
      },
      { only: ['rt-errors', 'hs-malformed-frames'] },
    )
    expect(report.failures, describeConformanceReport(report)).toEqual([])
    expect(report.passed).toEqual(['rt-errors'])
    expect(report.skipped.map(item => item.caseId)).toEqual(['hs-malformed-frames'])
  }, 30_000)
})

/*
 * Per-call budget for the runs that spawn a real OS worker.
 *
 * The kit defaults every call to 2 s, which is right for the in-process transports where a call is
 * a function invocation. These two runs are different: their first call is `load`, which spawns a
 * worker thread and evaluates a module graph — and the suite already says so by allowing 20 s per
 * *case* while leaving each call at 2 s. Under a loaded machine the spawn crosses 2 s and the run
 * fails on a budget that was never about this transport (observed: passes at ~1.9 s solo, fails
 * during a full `pnpm test`).
 *
 * 15 s is not an arbitrary bump: it is the production `loadDeadlineMs` for exactly this operation
 * (`DEFAULT_WORKER_BACKEND_POLICY`). No product contract moves, and the one case that asserts a
 * deadline fires passes its own explicit `deadlineMs: 30`, so it is unaffected.
 */
const WORKER_SPAWN_LIMITS = protocolLimits({
  defaultCallDeadlineMs: DEFAULT_WORKER_BACKEND_POLICY.loadDeadlineMs,
})

describe('capability-rpc conformance kit — the production transport of the Node worker backend (acc-12)', () => {
  it('the kit re-exports the production MessagePort adapter, so every in-process run above proves it', () => {
    expect(framePortFromMessagePort).toBe(productionAdapter)
  })

  it('a pair spawned through spawnWorkerRealm (the backend spawn path: isolation options, policy limits, capped stdio, dedicated port) passes the host-observable suite', async () => {
    const report = await runFramePortConformance(
      identity => {
        const realm = spawnWorkerRealm({
          bootstrap: HOSTILE_WORKER_FIXTURES['demo-worker'],
          ...identity,
          resourceLimits: { ...DEFAULT_WORKER_BACKEND_POLICY.resourceLimits },
          outputCapBytes: DEFAULT_WORKER_BACKEND_POLICY.outputCapBytes,
          name: 'x3-conformance:spawnWorkerRealm',
        })
        return {
          transport: 'node:worker_threads:spawnWorkerRealm',
          host: realm.port,
          farSide: 'demo-world',
          close: async () => void (await realm.terminate()),
        }
      },
      { caseTimeoutMs: 20_000, limits: WORKER_SPAWN_LIMITS },
    )
    expect(report.failures, describeConformanceReport(report)).toEqual([])
    expect(report.transport).toBe('node:worker_threads:spawnWorkerRealm')
    expect(report.observations['mode']).toBe('host-only')
    expect(report.observations['transfer']).toBe('detached')
    expect(report.observations['delivery']).toBe('asynchronous')
    expect(report.passed.length + report.skipped.length).toBe(CONFORMANCE_CASE_IDS.length)
    expect(report.passed.length).toBeGreaterThanOrEqual(16)
  }, 120_000)
})

describe('capability-rpc conformance kit — host-only mode over a real thread', () => {
  it('runs the host-observable subset against the demo-worker fixture in worker_threads and skips the rest', async () => {
    const report = await runFramePortConformance(identity => demoWorkerPair(identity), {
      caseTimeoutMs: 20_000,
      limits: WORKER_SPAWN_LIMITS,
    })
    expect(report.failures, describeConformanceReport(report)).toEqual([])
    expect(report.transport).toBe('node:worker_threads:demo-worker')
    expect(report.observations['mode']).toBe('host-only')
    expect(report.observations['transfer']).toBe('detached')
    expect(report.observations['delivery']).toBe('asynchronous')
    expect(report.skipped.map(item => item.caseId)).toEqual([
      'lc-events-overflow',
      'hs-malformed-frames',
      'hs-duplicate-reply',
      'hs-unknown-handle-and-method',
      'hs-iterator-busy-and-stale-generation',
      'hs-proto-pollution-reply',
      'hs-bad-values-reply',
      'hs-event-unknown-subscription',
      'hs-progress-after-settle',
    ])
    expect(report.passed.length + report.skipped.length).toBe(CONFORMANCE_CASE_IDS.length)
  }, 120_000)
})
