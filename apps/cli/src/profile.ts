import { uint64 } from '@modkit/core'
import { sceneModule } from '@modkit/scene/module'
import {
  createHostTopology,
  INDEX_CACHE_DIRECTORY_SETTING,
  type ContributionSettings,
  type HostTopology,
} from '@modkit/sdk'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { uvModule } from '@modkit/uv/module'
import {
  createHostComposition,
  createMemoryCredentialStore,
  linkedExtensionInputs,
  type ExecutionBackendRegistry,
  type ExtensionInput,
  type HostComposition,
} from '@modkit/host'
import type { Diagnostic } from '@modkit/core'
import {
  createNodeExecutionBackends,
  createNodeSubjectServices,
  loadExtensionRoots,
  nodeRuntimeTargetBase,
  nodeWorkerLinks,
  nodeWorkerRealmProfile,
  resolveContentSources,
  workerBackendPolicy,
  type NodeSubjectServices,
  type LoadedExtensionRoots,
  type WorkerBackendPolicy,
} from '@modkit/host/node'

const CLI_BUILTIN_MODULES = /* @__PURE__ */ linkedExtensionInputs([sceneModule, uvModule])

/** The Host owns root admission; the CLI's explicit --trust remains its execution decision. */
export async function loadModkitCliExtensions(
  roots: readonly string[],
  trust = false,
  signal?: AbortSignal,
): Promise<LoadedExtensionRoots> {
  const loaded = await loadExtensionRoots(
    roots.map(root => resolve(root)),
    {
      origin: 'linked',
      claimed: CLI_BUILTIN_MODULES.coordinates,
      ...(signal === undefined ? {} : { signal }),
    },
  )
  return {
    ...loaded,
    inputs: loaded.inputs.map(input => ({
      ...input,
      execution: { origin: 'linked', allowTrustedInProcess: trust },
    })),
  }
}

export const MODKIT_CLI_REALM = 'modkit.app.cli/main'
/** Worker threads of the CLI process: where portable (`worker-brokered`) variants run. */
export const MODKIT_CLI_WORKER_REALM = 'modkit.app.cli/worker'

/**
 * Worker policy of the CLI (a short-lived tool: small heaps). Its deadlines are the host ceilings:
 * a batch conversion is allowed to be long (an SC2 map analysis took 142 s on a busy machine and
 * 30 s dropped the map's world), and the user stops a run that should not go on.
 */
export const MODKIT_CLI_WORKER_POLICY: WorkerBackendPolicy = workerBackendPolicy({
  resourceLimits: {
    maxOldGenerationSizeMb: 512,
    maxYoungGenerationSizeMb: 64,
    codeRangeSizeMb: 64,
    stackSizeMb: 4,
  },
  loadDeadlineMs: 120_000,
  defaultCallDeadlineMs: 600_000,
  graceMs: 1_000,
  outputCapBytes: 64 * 1024,
  maxRestartsPerLease: 1,
})

export function createModkitCliTopology(): HostTopology {
  return createHostTopology({
    schemaVersion: 1,
    topologyId: 'modkit.app/cli',
    realms: [
      {
        schemaVersion: 1,
        realmId: MODKIT_CLI_REALM,
        revision: '1',
        target: nodeRuntimeTargetBase(),
        facilities: [
          'directory.watch',
          'filesystem.atomic-replace',
          'filesystem.read-random',
          'native.load',
          'process.launch',
          'worker.module',
        ],
        budgets: {
          maxConcurrentTasks: 8,
          maxWorkerCount: 4,
          maxResidentBytes: uint64('4294967296'),
          maxTransferBytes: uint64('536870912'),
          defaultDeadlineMs: 120_000,
        },
        policy: { id: 'modkit.policy/cli-default', revision: '1' },
      },
      nodeWorkerRealmProfile({
        realmId: MODKIT_CLI_WORKER_REALM,
        budgets: {
          maxConcurrentTasks: 4,
          maxWorkerCount: 0,
          maxResidentBytes: uint64('2147483648'),
          maxTransferBytes: uint64('268435456'),
          defaultDeadlineMs: 60_000,
        },
        policy: { id: 'modkit.policy/cli-worker', revision: '1' },
      }),
    ],
    links: [...nodeWorkerLinks(MODKIT_CLI_REALM, MODKIT_CLI_WORKER_REALM)],
  })
}

export interface ModkitCliCompositionOptions {
  /** Which realm to compose: the host process (default) or its worker realm. */
  readonly realmId?: typeof MODKIT_CLI_REALM | typeof MODKIT_CLI_WORKER_REALM
  /** Defaults to the trusted in-process backend plus the Node worker backend under the CLI policy. */
  readonly executionBackends?: ExecutionBackendRegistry
}

/** The CLI's execution backends: trusted in-process (gated per artifact) + Node worker threads. */
export function createModkitCliExecutionBackends(): ExecutionBackendRegistry {
  return createNodeExecutionBackends({
    policy: MODKIT_CLI_WORKER_POLICY,
    linkedModules: CLI_BUILTIN_MODULES.modules,
  })
}

export function createModkitCliComposition(
  extensions: readonly ExtensionInput[] = [],
  options: ModkitCliCompositionOptions = {},
): Promise<HostComposition> {
  return createHostComposition({
    topology: createModkitCliTopology(),
    realmId: options.realmId ?? MODKIT_CLI_REALM,
    extensions: [...CLI_BUILTIN_MODULES.inputs, ...extensions],
    executionBackends: options.executionBackends ?? createModkitCliExecutionBackends(),
  })
}

/**
 * The CLI's product open path (S7, `modkit open`): resolve against the process realm's inventory,
 * activate for the worker realm — portable variants run worker-brokered in worker threads of the
 * CLI process; in-process execution needs the artifact's own `allowTrustedInProcess`.
 */
/**
 * The CLI never prompts and keeps no secret: a credential comes from the environment variable its
 * declaration names (`modkit.credentials[].environment`), for this process only.
 */
export function modkitCliCredentials() {
  return { store: createMemoryCredentialStore(), environment: process.env }
}

/**
 * The index caches the CLI shares across runs (an installation's name index, a content index):
 * `MODKIT_INDEX_CACHE_DIRECTORY`, else the user's local cache folder. Without it every run parsed
 * Diablo III's 285 000 names again.
 */
export function modkitCliIndexCacheDirectory(environment = process.env): string {
  return (
    environment['MODKIT_INDEX_CACHE_DIRECTORY'] ??
    join(environment['LOCALAPPDATA'] ?? join(homedir(), '.cache'), 'modkit', 'index-caches')
  )
}

/**
 * The content sources the loaded extensions declare, for a folder a run opens: the root that reads
 * the folder (`storageOf`) serves it as the installation tree, as VS Code mounts it (§4.4). Resolved
 * only for a folder, which the module takes as the installation chosen; a file opens without. The
 * caller disposes them.
 */
export async function modkitCliInstallationSources(
  extensionRoots: readonly string[],
  path: string,
  environment = process.env,
): ReturnType<typeof resolveContentSources> {
  if ((await stat(path).catch(() => undefined))?.isDirectory() !== true) return undefined
  return resolveContentSources({
    extensionRoots,
    storage:
      environment['MODKIT_CONTENT_SOURCE_STORAGE'] ??
      join(environment['LOCALAPPDATA'] ?? join(homedir(), '.cache'), 'modkit', 'content-sources'),
    moduleOptions: () => ({ installationDirectory: path }),
    indexCacheDirectory: modkitCliIndexCacheDirectory(environment),
  })
}

/** Every contribution is told where the shared index caches live, as VS Code tells it. */
function modkitCliContributionSettings(): (contributionId: string) => ContributionSettings {
  const settings: ContributionSettings = Object.freeze({
    values: Object.freeze({ [INDEX_CACHE_DIRECTORY_SETTING]: modkitCliIndexCacheDirectory() }),
  })
  return () => settings
}

export function createModkitCliSubjectServices(
  extensions: readonly ExtensionInput[],
  options: { readonly onDiagnostic?: (diagnostic: Diagnostic) => void } = {},
): Promise<NodeSubjectServices> {
  return createNodeSubjectServices({
    topology: createModkitCliTopology(),
    realms: { host: MODKIT_CLI_REALM, workers: MODKIT_CLI_WORKER_REALM },
    extensions: [...CLI_BUILTIN_MODULES.inputs, ...extensions],
    linkedModules: CLI_BUILTIN_MODULES.modules,
    policy: MODKIT_CLI_WORKER_POLICY,
    credentials: modkitCliCredentials(),
    contributionSettings: modkitCliContributionSettings(),
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
  })
}
