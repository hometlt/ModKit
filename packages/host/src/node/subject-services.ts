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

import type { InstallationProbes, VideoFrameDecoder } from '@modkit/sdk'
import { createNodeInstallationProbes } from './installation-probes.js'
import { createCredentialBroker, type CredentialBrokerOptions } from '../credentials.js'
import { createNodeOAuth2Engine } from './oauth2-pkce.js'
import { createNodeVideoFrameDecoder } from './video-frames.js'
import type { Diagnostic } from '@modkit/core'
import {
  runtimeTargetForHostRealm,
  type ContributionSettings,
  type HostTopology,
  type ServiceContractDefinitionRegistry,
} from '@modkit/sdk'
import { createHostComposition, type HostComposition } from '../composition.js'
import type { ExecutionBackendRegistry } from '../execution/backend.js'
import type { WorkerBackendPolicy } from '../execution/worker-policy.js'
import type { SubjectCatalogOptions } from '../catalog-questions.js'
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
  /** What the user configured for a contribution; handed to it when the host activates it. */
  readonly contributionSettings?: (contributionId: string) => ContributionSettings | undefined
  /** Contribution ids the user switched off; they stay listed and lose activation eligibility. */
  readonly disabledContributions?: readonly string[]
  /** Where an opened subject's catalog questions are answered (its mod context). */
  readonly subjectCatalog?: SubjectCatalogOptions
  /** Video frames for codecs; default: ffmpeg found on PATH, `false` to offer none. */
  readonly videoFrames?: VideoFrameDecoder | false
  /**
   * The application's secret store and prompter; the services build the credential broker over
   * their inventory (OAuth through the loopback engine unless another is given).
   */
  readonly credentials?: Omit<CredentialBrokerOptions, 'inventory'>
}

export interface NodeSubjectServices extends SubjectServices {
  /** The host realm composition: inventory, profile, target of the process itself. */
  readonly host: HostComposition
  /** The worker realm composition: codecs are resolved and activated for its target. */
  readonly workers: HostComposition
  /** Where platforms installed games, handed to installation discovery providers. */
  readonly installationProbes: InstallationProbes
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
  // in-process variants (linked built-ins, trusted artifacts) run in the host process, not a worker
  const hostRealm = options.topology.realms.find(realm => realm.realmId === options.realms.host)
  const executionBackends: ExecutionBackendRegistry = createNodeExecutionBackends({
    ...(hostRealm === undefined ? {} : { inProcessTarget: runtimeTargetForHostRealm(hostRealm) }),
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
  const host = await createHostComposition({
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
  })
  // Same extensions, contracts and switches: the worker realm shares the host's inventory. Two
  // compositions built side by side validated every manifest twice (the validation cache only
  // fills once a validation finishes).
  const workers = await createHostComposition({
    topology: options.topology,
    realmId: options.realms.workers,
    executionBackends,
    inventory: host.inventory,
  })
  if (definitions !== undefined)
    await registerServiceDefinitionsOrThrow(host.inventory, definitions)
  const videoFrames =
    options.videoFrames === false
      ? undefined
      : (options.videoFrames ?? createNodeVideoFrameDecoder())
  const credentials =
    options.credentials === undefined
      ? undefined
      : createCredentialBroker({
          oauth: createNodeOAuth2Engine(),
          ...options.credentials,
          inventory: host.inventory,
        })
  const services = createSubjectServices({
    inventory: host.inventory,
    target: workers.target,
    executionBackends,
    ...(definitions === undefined ? {} : { serviceDefinitions: definitions }),
    ...(options.contributionSettings === undefined
      ? {}
      : { contributionSettings: options.contributionSettings }),
    ...(options.subjectCatalog === undefined ? {} : { subjectCatalog: options.subjectCatalog }),
    ...(videoFrames === undefined ? {} : { videoFrames }),
    ...(credentials === undefined ? {} : { credentials }),
  })
  return Object.freeze({
    ...services,
    host,
    workers,
    installationProbes: createNodeInstallationProbes(),
  })
}
