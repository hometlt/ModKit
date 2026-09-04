/** Plan-facing entry point; projections remain explicit and use native MK3 contracts. */
export * from './adapters.js'
export {
  adaptLanguageModule,
  adaptLanguageModule as adaptLanguageService,
} from './language-adapter.js'
export { adaptRuntimeProvider, adaptRuntimeProvider as adaptRuntime } from './runtime-adapter.js'
