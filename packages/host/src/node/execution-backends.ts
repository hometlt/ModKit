/**
 * Execution backends of a Node composition root: the in-process backend for variants the host
 * explicitly trusts (`trusted-in-process`, gated per artifact) and the Node worker backend for
 * `worker-brokered` variants resolved for the `node-worker` realm. One registry serves both realms
 * of a topology (host and worker): the target of each activation decides which backend applies,
 * so a root passes the same registry to every `createHostComposition` and to `openSubject`.
 *
 * The root owns the policy (`workerBackendPolicy`, ceilings enforced) and the diagnostics sink;
 * `foreignSurfaces` is read at every spawn, so definitions inventoried after the registry was
 * created (the usual order in an application bootstrap) still reach the workers.
 */

import type { Diagnostic } from '@modkit/core'
import type { RuntimeTarget } from '@modkit/sdk'
import {
  linkedInProcessBackend,
  createExecutionBackendRegistry,
  type ExecutionBackend,
  type ExecutionBackendRegistry,
} from '../execution/backend.js'
import type { DataSourceSurfaceSource, RetainedValuePolicy } from '../execution/index.js'
import type { WorkerBackendPolicy } from '../execution/worker-policy.js'
import { languageImmutableCapture } from '../language/index.js'
import { NATIVE_TEXT_MODULES, withNativeTextModules } from '../native-text.js'
import {
  warmExecutionBackend,
  type WarmExecutionBackendOptions,
} from '../execution/warm-backend.js'
import { createNodeWorkerBackend } from './worker-backend.js'

export interface NodeExecutionBackendsOptions {
  /** Worker policy chosen by the root (`workerBackendPolicy`); lab defaults otherwise. */
  readonly policy?: WorkerBackendPolicy
  /** Backend diagnostics: shared-process notice, restarts, crashes, capped worker stdio. */
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
  /** Surfaces of the root's registered contract definitions (a thunk is read per spawn). */
  readonly foreignSurfaces?:
    readonly DataSourceSurfaceSource[] | (() => readonly DataSourceSurfaceSource[])
  /**
   * Where the worker bootstrap lives, for a host that cannot rely on `import.meta.url`.
   *
   * The default resolves the bootstrap beside this module, which is right for an ESM host. A host
   * bundled as CommonJS has no `import.meta` — VS Code *requires* a CommonJS extension entry — so
   * the default resolves to `undefined` there and every codec spawn dies at `new Worker`. Such a
   * host passes the URL of the bootstrap it shipped instead.
   */
  readonly bootstrapUrl?: URL
  /** Register the in-process backend too (default true; the gate still requires the artifact decision). */
  readonly trustedInProcess?: boolean
  /** How long, and how many, activated worker realms stay warm between opens. */
  readonly warmRealms?: WarmExecutionBackendOptions
  /**
   * Modules the application imported at build time, keyed by the linked entrypoint href
   * (`linkedExtensionInputs(...).modules`). When present, the in-process backend serves these
   * before falling back to dynamic import.
   */
  readonly linkedModules?: ReadonlyMap<string, Readonly<Record<string, unknown>>>
  /** The host process's target, when codecs are activated for a worker realm (see the registry). */
  readonly inProcessTarget?: RuntimeTarget
  /**
   * Call values each worker keeps between calls. Defaults to the language captures (validated
   * semantic inputs and document snapshots) within {@link LANGUAGE_RETAINED_VALUE_BYTES}; `false`
   * sends full copies on every call.
   */
  readonly retainedValues?: RetainedValuePolicy | false
}

/**
 * Estimated bytes of language captures one worker keeps: the full SC2 authoring index of a
 * dependency closure plus its documents, with room for the previous revision during edits.
 */
export const LANGUAGE_RETAINED_VALUE_BYTES = 256 * 1_024 * 1_024

/**
 * The language captures one worker keeps for a host that holds `memoryBytes` of resolved Data
 * contexts (`createLanguageWorkspace({ semanticContextMemoryBytes })`): twice that, since the
 * retained estimate counts UTF-16 units and a cost per node (about twice the JSON bytes the
 * workspace weighs) and the contexts' documents stay too; never below
 * {@link LANGUAGE_RETAINED_VALUE_BYTES}. Below it, a worker serving two loaded mods (Liberty and
 * Void) is sent each mod's index again whenever the editor moves between them.
 */
export function languageRetainedValues(memoryBytes: number): RetainedValuePolicy {
  const held = Number.isSafeInteger(memoryBytes) && memoryBytes > 0 ? memoryBytes : 0
  return Object.freeze({
    isRetainable: languageImmutableCapture,
    maxBytes: Math.max(LANGUAGE_RETAINED_VALUE_BYTES, Math.min(2 * held, Number.MAX_SAFE_INTEGER)),
  })
}

export function createNodeExecutionBackends(
  options: NodeExecutionBackendsOptions = {},
): ExecutionBackendRegistry {
  const retainedValues =
    options.retainedValues === false
      ? undefined
      : (options.retainedValues ?? {
          isRetainable: languageImmutableCapture,
          maxBytes: LANGUAGE_RETAINED_VALUE_BYTES,
        })
  const backends: ExecutionBackend[] = []
  // Core-native modules are always present. `trustedInProcess: false` only excludes application-
  // supplied linked extensions; it must not disable the built-in text/JSON implementation.
  const linkedModules =
    options.trustedInProcess === false
      ? NATIVE_TEXT_MODULES
      : withNativeTextModules(options.linkedModules)
  backends.push(linkedInProcessBackend(linkedModules))
  /*
   * Warm, not new, for the next open of the same codec under the same grant: the spawn is cheap
   * and the cold module graph is not. See `../execution/warm-backend.ts`.
   */
  backends.push(
    warmExecutionBackend(
      createNodeWorkerBackend({
        ...(options.policy === undefined ? {} : { policy: options.policy }),
        ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
        ...(options.foreignSurfaces === undefined
          ? {}
          : { foreignSurfaces: options.foreignSurfaces }),
        ...(options.bootstrapUrl === undefined ? {} : { bootstrapUrl: options.bootstrapUrl }),
        ...(retainedValues === undefined ? {} : { retainedValues }),
      }),
      {
        ...(options.warmRealms ?? {}),
        ...(options.onDiagnostic === undefined
          ? {}
          : {
              onReuse: (contributionId: string) => {
                options.onDiagnostic?.({
                  code: 'x3.host/worker-realm-reused',
                  severity: 'information',
                  message: `«${contributionId}» reused a warm worker realm: its module graph was already loaded`,
                })
              },
            }),
      },
    ),
  )
  return createExecutionBackendRegistry(
    backends,
    options.inProcessTarget === undefined ? {} : { inProcessTarget: options.inProcessTarget },
  )
}
