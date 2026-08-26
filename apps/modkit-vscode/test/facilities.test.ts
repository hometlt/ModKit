/**
 * Intent against reality, without a webview.
 *
 * The probe reads four globals and the comparison is set arithmetic, so both are asserted here
 * rather than through a running editor — a real webview cannot be made to lack WebGL2 on demand.
 * The receipt records what the smoke's own editor answers (`gpu.webgl2` honoured even under
 * `--disable-gpu`, `gpu.webgpu` offered and ungranted); these cases cover the shapes that editor
 * happens not to produce, which is the half a live run can never reach.
 */
import { describe, expect, it } from 'vitest'
import {
  describeDegradation,
  describeFacilities,
  probeWebviewFacilities,
  VSCODE_WEBVIEW_INTENDED_FACILITIES,
} from '../src/facilities.js'

const canvasReturning = (context: unknown) => ({
  createElement: () => ({ getContext: () => context }),
})

/** A `Worker` global the probe only ever type-checks; it is never constructed. */
const workerGlobal = (): undefined => undefined

describe('what a page can honour', () => {
  it('reports WebGL2 only when a context can actually be created', () => {
    expect(probeWebviewFacilities({ Worker: workerGlobal, document: canvasReturning({}) })).toEqual(
      ['gpu.webgl2', 'worker.module'],
    )
    // a driver or a headless container without WebGL2: the canvas exists and answers null
    expect(
      probeWebviewFacilities({ Worker: workerGlobal, document: canvasReturning(null) }),
    ).toEqual(['worker.module'])
  })

  it('treats a throwing canvas as an absent facility rather than a crash', () => {
    expect(
      probeWebviewFacilities({
        Worker: workerGlobal,
        document: {
          createElement: () => ({
            getContext: () => {
              throw new Error('context creation refused')
            },
          }),
        },
      }),
    ).toEqual(['worker.module'])
  })

  it('finds WebGPU when the navigator offers it, and nothing when it does not', () => {
    expect(probeWebviewFacilities({ navigator: { gpu: {} } })).toEqual(['gpu.webgpu'])
    expect(probeWebviewFacilities({})).toEqual([])
  })
})

describe('intent against reality', () => {
  it('names a composed facility the page cannot honour', () => {
    const report = describeFacilities(['worker.module'])
    expect(report.intended).toEqual([...VSCODE_WEBVIEW_INTENDED_FACILITIES].sort())
    expect(report.degraded).toEqual(['gpu.webgl2'])
    expect(report.ungranted).toEqual([])
    const lines = describeDegradation(report)
    expect(lines).toHaveLength(1)
    // the sentence has to say what happens instead, not merely that something is missing
    expect(lines[0]).toContain('unavailable here rather than emulated')
  })

  it('names a facility the page offers that this realm was not composed with', () => {
    const report = describeFacilities(['gpu.webgl2', 'gpu.webgpu', 'worker.module'])
    expect(report.degraded).toEqual([])
    expect(report.ungranted).toEqual(['gpu.webgpu'])
    expect(describeDegradation(report)).toEqual([])
  })

  it('says nothing is degraded when the page honours everything composed', () => {
    const report = describeFacilities([...VSCODE_WEBVIEW_INTENDED_FACILITIES])
    expect(report.degraded).toEqual([])
    expect(report.ungranted).toEqual([])
  })
})
