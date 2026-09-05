import type { AnyDescriptor } from '@modkit/sdk'

export const GENERIC_SURFACE_ANCHORS = Object.freeze([
  'sections',
  'tree',
  'hex',
  'card',
  'preview',
  'relations',
  'selector',
  'mcp-inspect',
  'script',
  'no-op-edit',
] as const)

export type GenericSurfaceAnchor = (typeof GENERIC_SURFACE_ANCHORS)[number]

export interface SurfaceSmokeClaim {
  readonly anchor: GenericSurfaceAnchor
  readonly applicable: boolean
  readonly sources: readonly string[]
}

export interface SurfaceSmokeExecution {
  readonly executed: number
  readonly passed: number
  readonly failed: number
  readonly skipped: number
  readonly evidence: readonly string[]
}

export type SurfaceSmokeExecutor = () => SurfaceSmokeExecution | Promise<SurfaceSmokeExecution>

export interface SurfaceSmokeAnchorResult {
  readonly anchor: GenericSurfaceAnchor
  readonly applicable: boolean
  readonly state: 'not-applicable' | 'passed' | 'failed'
  readonly execution?: SurfaceSmokeExecution
  readonly problems: readonly string[]
}

export interface SurfaceSmokeReport {
  readonly schemaVersion: 1
  readonly kind: 'modkit.generic-surface-smoke'
  readonly verdict: 'pass' | 'fail'
  readonly anchors: readonly SurfaceSmokeAnchorResult[]
  readonly problems: readonly string[]
}

const dataSources = (descriptor: AnyDescriptor): ReadonlySet<string> =>
  new Set(descriptor.dataSources.map(value => value.contract))

/** Runtime applicability independently discovered from the opened subject descriptor. */
export function discoverApplicableSurfaceAnchors(
  descriptor: AnyDescriptor,
): ReadonlySet<GenericSurfaceAnchor> {
  const contracts = dataSources(descriptor)
  const available = descriptor.operations.filter(value => value.state === 'available')
  const inspect = available.some(value => value.id === 'view.inspect')
  const metadata = descriptor.interpretation === 'codec' && descriptor.metadata.length > 0
  const anchors = new Set<GenericSurfaceAnchor>()
  if (metadata) anchors.add('sections')
  if (contracts.has('common.view/tree-data-source')) anchors.add('tree')
  if (contracts.has('common.view/byte-range-source')) anchors.add('hex')
  if (contracts.has('common.view/subject-facts-source') || metadata) anchors.add('card')
  if (
    [
      'common.view/raster-image-source',
      'common.view/vector-scene-source',
      'common.view/audio-media-source',
      'common.view/video-media-source',
      'common.view/model-scene-source',
      'common.view/world-scene-source',
      'common.view/slide-deck-source',
    ].some(contract => contracts.has(contract)) ||
    available.some(value => /^(?:preview|render|thumbnail)\./u.test(value.id))
  )
    anchors.add('preview')
  if (contracts.has('common.view/relation-graph-source')) anchors.add('relations')
  if (contracts.has('common.view/subject-selector-source')) anchors.add('selector')
  if (inspect) {
    anchors.add('mcp-inspect')
    // P7's script minimum is open().metadata(); its runtime applicability is the same inspect
    // projection. An application executor still has to prove its own script adapter.
    anchors.add('script')
  }
  if (available.some(value => value.mutatesSource)) anchors.add('no-op-edit')
  return anchors
}

const validCount = (value: number): boolean => Number.isSafeInteger(value) && value >= 0

/**
 * Execute every applicable inventory claim. Claims and runtime discovery must agree exactly.
 * Zero work, any skip, a missing claim/executor, or inconsistent counts fail closed.
 */
export async function runGenericSurfaceSmoke(options: {
  readonly descriptor: AnyDescriptor
  readonly claims: readonly SurfaceSmokeClaim[]
  readonly executors: Readonly<Partial<Record<GenericSurfaceAnchor, SurfaceSmokeExecutor>>>
}): Promise<SurfaceSmokeReport> {
  const discovered = discoverApplicableSurfaceAnchors(options.descriptor)
  const claims = new Map<GenericSurfaceAnchor, SurfaceSmokeClaim>()
  const globalProblems: string[] = []
  for (const claim of options.claims) {
    if (claims.has(claim.anchor)) globalProblems.push(`${claim.anchor}: duplicate claim`)
    else claims.set(claim.anchor, claim)
  }
  for (const anchor of GENERIC_SURFACE_ANCHORS) {
    if (!claims.has(anchor)) globalProblems.push(`${anchor}: missing claim`)
  }

  const results: SurfaceSmokeAnchorResult[] = []
  for (const anchor of GENERIC_SURFACE_ANCHORS) {
    const claim = claims.get(anchor)
    const runtimeApplicable = discovered.has(anchor)
    const problems: string[] = []
    if (claim === undefined) {
      results.push({
        anchor,
        applicable: runtimeApplicable,
        state: 'failed',
        problems: ['missing claim'],
      })
      continue
    }
    if (claim.applicable !== runtimeApplicable) {
      problems.push(
        `inventory claim is ${claim.applicable ? 'applicable' : 'not-applicable'} but runtime discovery is ${runtimeApplicable ? 'applicable' : 'not-applicable'}`,
      )
    }
    if (!claim.applicable) {
      results.push({
        anchor,
        applicable: false,
        state: problems.length === 0 ? 'not-applicable' : 'failed',
        problems: Object.freeze(problems),
      })
      continue
    }
    if (claim.sources.length === 0) problems.push('applicable claim has no inventory source')
    const executor = options.executors[anchor]
    if (executor === undefined) {
      problems.push('missing executor')
      results.push({ anchor, applicable: true, state: 'failed', problems: Object.freeze(problems) })
      continue
    }
    let execution: SurfaceSmokeExecution | undefined
    try {
      execution = await executor()
      if (
        ![execution.executed, execution.passed, execution.failed, execution.skipped].every(
          validCount,
        )
      )
        problems.push('execution counts must be non-negative safe integers')
      else {
        if (execution.executed === 0) problems.push('executed zero checks')
        if (execution.passed === 0) problems.push('passed zero checks')
        if (execution.failed > 0) problems.push(`${execution.failed} check(s) failed`)
        if (execution.skipped > 0) problems.push(`${execution.skipped} check(s) skipped`)
        if (execution.passed + execution.failed + execution.skipped !== execution.executed)
          problems.push('execution counts are inconsistent')
      }
      if (execution.evidence.length === 0) problems.push('execution produced no evidence')
    } catch (error) {
      problems.push(`executor threw: ${error instanceof Error ? error.message : String(error)}`)
    }
    results.push({
      anchor,
      applicable: true,
      state: problems.length === 0 ? 'passed' : 'failed',
      ...(execution === undefined ? {} : { execution }),
      problems: Object.freeze(problems),
    })
  }
  const problems = [
    ...globalProblems,
    ...results.flatMap(value => value.problems.map(problem => `${value.anchor}: ${problem}`)),
  ]
  return Object.freeze({
    schemaVersion: 1,
    kind: 'modkit.generic-surface-smoke',
    verdict: problems.length === 0 ? 'pass' : 'fail',
    anchors: Object.freeze(results),
    problems: Object.freeze(problems),
  })
}
