/**
 * Subject services of a Node composition root (S7): the same four steps Electron's bootstrap
 * performs, for any topology with a host realm and a `node-worker` realm — the CLI, the server
 * and the automation host compose through this; Electron keeps its three-realm application and
 * uses the host-level pieces directly.
 *
 *  1. one backend registry for both realms, its `foreignSurfaces` bound late to the definition
 *     registry (definitions are inventoried after the backends exist, workers read them per spawn);
 *  2. compose the host realm (holds the inventory) and the worker realm (holds the target);
 *  3. register the inventory's service-contract definitions, failing closed;
 *  4. `createSubjectServices` — resolve against the host inventory, activate for the worker target.
 *
 * Trust is not decided here: each `ExtensionInput.execution` says whether *that* artifact may run
 * in-process; the gate refuses variants without an executable boundary for the worker target.
 */

import type { Diagnostic } from '@modkitx-x3/core'
import type { HostTopology, ServiceContractDefinitionRegistry } from '@modkitx-x3/sdk'
import { createHostComposition, type HostComposition } from '../composition.js'
import type { ExecutionBackendRegistry } from '../execution/backend.js'
import type { WorkerBackendPolicy } from '../execution/worker-policy.js'
import type { ExtensionInput } from '../inventory.js'
import {
  createBundledServiceDefinitionRegistry,
  createSubjectServices,
  registerServiceDefinitionsOrThrow,
  serviceDefinitionSurfaces,
  type SubjectServices,
} from '../subject-services.js'
import { createNodeExecutionBackends } from './execution-backends.js'

export interface NodeSubjectServicesOptions {
  readonly topology: HostTopology
  /** The realm that holds the inventory (host process) and the realm codecs run in (workers). */
  readonly realms: { readonly host: string; readonly workers: string }
  readonly extensions: readonly ExtensionInput[]
  /** Worker policy chosen by the root (`workerBackendPolicy`); lab defaults otherwise. */
  readonly policy?: WorkerBackendPolicy
  /** Backend diagnostics: shared-process notice, restarts, crashes, capped worker stdio. */
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
  /**
   * Service-contract definitions: `'bundled'` (default) registers the inventory's definitions
   * into a bundled registry (every inventoried owner accepted — for inputs the host vouches for);
   * a registry of the root's own; `false` registers nothing.
   */
  readonly serviceDefinitions?: 'bundled' | false | ServiceContractDefinitionRegistry
  /**
   * Where the worker bootstrap lives, for a host that cannot rely on `import.meta.url` — a
   * CommonJS bundle has no `import.meta`, so the default resolves to `undefined` there and every
   * codec spawn dies at `new Worker`.
   */
  readonly bootstrapUrl?: URL
  /** Register the in-process backend too (default true; the gate still requires the artifact decision). */
  readonly trustedInProcess?: boolean
  /** Statically linked modules (see `linkedExtensionInputs`), served by the in-process backend. */
  readonly linkedModules?: ReadonlyMap<string, Readonly<Record<string, unknown>>>
  /**
   * Extension coordinates (`publisher/id`) the user switched off. Their contributions stay
   * inventoried and their individual disabled settings remain independent.
   */
  readonly disabledExtensions?: readonly string[]
  /** Contribution ids the user switched off; they stay listed and lose activation eligibility. */
  readonly disabledContributions?: readonly string[]
}

export interface NodeSubjectServices extends SubjectServices {
  /** The host realm composition: inventory, profile, target of the process itself. */
  readonly host: HostComposition
  /** The worker realm composition: codecs are resolved and activated for its target. */
  readonly workers: HostComposition
}

export async function createNodeSubjectServices(
  options: NodeSubjectServicesOptions,
): Promise<NodeSubjectServices> {
  const definitions =
    options.serviceDefinitions === false
      ? undefined
      : options.serviceDefinitions === undefined || options.serviceDefinitions === 'bundled'
        ? createBundledServiceDefinitionRegistry()
        : options.serviceDefinitions
  const executionBackends: ExecutionBackendRegistry = createNodeExecutionBackends({
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
    ...(definitions === undefined
      ? {}
      : { foreignSurfaces: () => serviceDefinitionSurfaces(definitions) }),
    ...(options.bootstrapUrl === undefined ? {} : { bootstrapUrl: options.bootstrapUrl }),
    ...(options.trustedInProcess === undefined
      ? {}
      : { trustedInProcess: options.trustedInProcess }),
    ...(options.linkedModules === undefined ? {} : { linkedModules: options.linkedModules }),
  })
  const [host, workers] = await Promise.all([
    createHostComposition({
      topology: options.topology,
      realmId: options.realms.host,
      extensions: options.extensions,
      executionBackends,
      ...(options.disabledExtensions === undefined
        ? {}
        : { disabledExtensions: options.disabledExtensions }),
      ...(options.disabledContributions === undefined
        ? {}
        : { disabledContributions: options.disabledContributions }),
    }),
    createHostComposition({
      topology: options.topology,
      realmId: options.realms.workers,
      extensions: options.extensions,
      executionBackends,
      ...(options.disabledExtensions === undefined
        ? {}
        : { disabledExtensions: options.disabledExtensions }),
      ...(options.disabledContributions === undefined
        ? {}
        : { disabledContributions: options.disabledContributions }),
    }),
  ])
  if (definitions !== undefined)
    await registerServiceDefinitionsOrThrow(host.inventory, definitions)
  const services = createSubjectServices({
    inventory: host.inventory,
    target: workers.target,
    executionBackends,
    ...(definitions === undefined ? {} : { serviceDefinitions: definitions }),
  })
  return Object.freeze({ ...services, host, workers })
}
