import { ModkitError } from '@modkitx-x3/core'

export const GOLDEN_PATH_CONCEPTS = Object.freeze([
  'Subject',
  'Contribution',
  'Contract',
  'Operation',
] as const)

export interface GoldenPathMetrics {
  readonly stepsToFirstGreen: number
  readonly filesTouched: number
  readonly conceptsRequired: readonly string[]
  readonly timeToBadgeMs: number | null
}

export interface GoldenPathBudget {
  readonly maxStepsToFirstGreen: number
  readonly maxFilesTouched: number
  readonly maxConceptsRequired: number
  readonly maxTimeToBadgeMs?: number
}

export const GOLDEN_PATH_BASELINE: GoldenPathBudget = Object.freeze({
  maxStepsToFirstGreen: 5,
  maxFilesTouched: 5,
  maxConceptsRequired: 4,
})

/** Build-breaking regression gate used by scaffolds and packed-extension tests. */
export function assertGoldenPathMetrics(
  metrics: GoldenPathMetrics,
  budget: GoldenPathBudget = GOLDEN_PATH_BASELINE,
): void {
  const failures = [
    ...(metrics.stepsToFirstGreen > budget.maxStepsToFirstGreen
      ? [`steps ${metrics.stepsToFirstGreen} > ${budget.maxStepsToFirstGreen}`]
      : []),
    ...(metrics.filesTouched > budget.maxFilesTouched
      ? [`files ${metrics.filesTouched} > ${budget.maxFilesTouched}`]
      : []),
    ...(metrics.conceptsRequired.length > budget.maxConceptsRequired
      ? [`concepts ${metrics.conceptsRequired.length} > ${budget.maxConceptsRequired}`]
      : []),
    ...(budget.maxTimeToBadgeMs !== undefined &&
    metrics.timeToBadgeMs !== null &&
    metrics.timeToBadgeMs > budget.maxTimeToBadgeMs
      ? [`time ${metrics.timeToBadgeMs}ms > ${budget.maxTimeToBadgeMs}ms`]
      : []),
  ]
  if (failures.length > 0) {
    throw new ModkitError({
      code: 'x3.testkit/golden-path-regression',
      message: `extension golden path regressed: ${failures.join('; ')}`,
      context: { failures },
    })
  }
  if (
    metrics.conceptsRequired.length !== GOLDEN_PATH_CONCEPTS.length ||
    GOLDEN_PATH_CONCEPTS.some((concept, index) => metrics.conceptsRequired[index] !== concept)
  ) {
    throw new ModkitError({
      code: 'x3.testkit/golden-path-concepts-changed',
      message: 'the minimal authoring path must require exactly the four canonical concepts',
      context: { concepts: metrics.conceptsRequired },
    })
  }
}
