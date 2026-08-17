import { uint64 } from '@modkitx-x3/core'
import { createHostTopology, type HostTopology } from '@modkitx-x3/sdk'
import { createHostComposition, type ExtensionInput, type HostComposition } from '@modkitx-x3/host'
import { nodeRuntimeTargetBase } from '@modkitx-x3/host/node'

export const SERVER_REALM = 'org.modkitx.app.server/main'

export function createServerTopology(): HostTopology {
  return createHostTopology({
    schemaVersion: 1,
    topologyId: 'org.modkitx.app/server',
    realms: [
      {
        schemaVersion: 1,
        realmId: SERVER_REALM,
        revision: '1',
        target: nodeRuntimeTargetBase(),
        facilities: [
          'directory.watch',
          'filesystem.atomic-replace',
          'filesystem.read-random',
          'native-process.rpc',
          'native.load',
          'network.range-fetch',
          'worker.module',
        ],
        budgets: {
          maxConcurrentTasks: 32,
          maxWorkerCount: 16,
          maxResidentBytes: uint64('17179869184'),
          maxTransferBytes: uint64('1073741824'),
          defaultDeadlineMs: 300_000,
        },
        policy: { id: 'org.modkitx.policy/server-deployment', revision: '1' },
      },
    ],
    links: [],
  })
}

export interface ServerHealthSnapshot {
  readonly status: 'ok' | 'degraded'
  readonly topologyId: string
  readonly realmId: string
  readonly profileRevision: string
  readonly extensionCount: number
  readonly diagnosticCount: number
}

export interface ServerApp {
  readonly composition: HostComposition
  health(): ServerHealthSnapshot
}

export async function createServerApp(
  extensions: readonly ExtensionInput[] = [],
): Promise<ServerApp> {
  const composition = await createHostComposition({
    topology: createServerTopology(),
    realmId: SERVER_REALM,
    extensions,
  })
  return Object.freeze({
    composition,
    health: () =>
      Object.freeze({
        status: composition.inventory.diagnostics.some(item => item.severity === 'error')
          ? 'degraded'
          : 'ok',
        topologyId: composition.topology.topologyId,
        realmId: composition.profile.realmId,
        profileRevision: composition.profile.revision,
        extensionCount: composition.inventory.extensions.length,
        diagnosticCount: composition.inventory.diagnostics.length,
      }),
  })
}
