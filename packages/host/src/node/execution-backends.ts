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

import type { Diagnostic } from '@modkitx-x3/core'
import {
  TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
  createExecutionBackendRegistry,
  type ExecutionBackend,
  type ExecutionBackendRegistry,
} from '../execution/backend.js'
import type { DataSourceSurfaceSource } from '../execution/index.js'
import type { WorkerBackendPolicy } from '../execution/worker-policy.js'
import { createNodeWorkerBackend } from './worker-backend.js'

export interface NodeExecutionBackendsOptions {
  /** Worker policy chosen by the root (`workerBackendPolicy`); lab defaults otherwise. */
  readonly policy?: WorkerBackendPolicy
  /** Backend diagnostics: shared-process notice, restarts, crashes, capped worker stdio. */
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
  /** Surfaces of the root's registered contract definitions (a thunk is read per spawn). */
  readonly foreignSurfaces?:
    readonly DataSourceSurfaceSource[] | (() => readonly DataSourceSurfaceSource[])
  /** Register the in-process backend too (default true; the gate still requires the artifact decision). */
  readonly trustedInProcess?: boolean
}

export function createNodeExecutionBackends(
  options: NodeExecutionBackendsOptions = {},
): ExecutionBackendRegistry {
  const backends: ExecutionBackend[] = []
  if (options.trustedInProcess !== false) backends.push(TRUSTED_IN_PROCESS_EXECUTION_BACKEND)
  backends.push(
    createNodeWorkerBackend({
      ...(options.policy === undefined ? {} : { policy: options.policy }),
      ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
      ...(options.foreignSurfaces === undefined
        ? {}
        : { foreignSurfaces: options.foreignSurfaces }),
    }),
  )
  return createExecutionBackendRegistry(backends)
}
