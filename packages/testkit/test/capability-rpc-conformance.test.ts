import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import type { Frame } from '@modkitx-x3/host/execution'
import {
  CONFORMANCE_CASE_IDS,
  createLoopbackPair,
  demoWorkerPair,
  describeConformanceReport,
  framePortFromMessagePort,
  runFramePortConformance,
  type ConformancePair,
  type ConformanceReport,
} from '@modkitx-x3/testkit'

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

describe('capability-rpc conformance kit — host-only mode over a real thread', () => {
  it('runs the host-observable subset against the demo-worker fixture in worker_threads and skips the rest', async () => {
    const report = await runFramePortConformance(identity => demoWorkerPair(identity), {
      caseTimeoutMs: 20_000,
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
    ])
    expect(report.passed.length + report.skipped.length).toBe(CONFORMANCE_CASE_IDS.length)
  }, 120_000)
})
