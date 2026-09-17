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
import {
  linkedInProcessBackend,
  createExecutionBackendRegistry,
  type ExecutionBackend,
  type ExecutionBackendRegistry,
} from '../execution/backend.js'
import type { DataSourceSurfaceSource } from '../execution/index.js'
import type { WorkerBackendPolicy } from '../execution/worker-policy.js'
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
}

export function createNodeExecutionBackends(
  options: NodeExecutionBackendsOptions = {},
): ExecutionBackendRegistry {
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
  return createExecutionBackendRegistry(backends)
}
