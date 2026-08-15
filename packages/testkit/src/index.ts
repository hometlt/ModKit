export { runMinimalHost, type MinimalHostOptions, type MinimalHostRun } from './minimal-host.js'
export { offersFromInventory } from '@modkitx-x3/host'
export {
  assertGoldenPathMetrics,
  GOLDEN_PATH_BASELINE,
  GOLDEN_PATH_CONCEPTS,
  type GoldenPathBudget,
  type GoldenPathMetrics,
} from './golden-path.js'
export {
  asGreeterModule,
  GREETER_CONTRACT,
  GREETER_CONTRIBUTION_CONTRACT,
  GREETER_MAJOR,
  greeterSpecEntry,
  greeterSpecSchema,
  type Greeter,
  type GreeterModule,
} from './demo-contract.js'
export {
  runTextDataConformance,
  type TextDataConformanceCase,
  type TextDataConformanceFailure,
  type TextDataConformanceReport,
} from './text-data-conformance.js'
