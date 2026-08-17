import { uint64 } from '@modkitx-x3/core'
import { createHostTopology, type HostTopology } from '@modkitx-x3/sdk'
import { createHostComposition, type ExtensionInput, type HostComposition } from '@modkitx-x3/host'
import { nodeRuntimeTargetBase } from '@modkitx-x3/host/node'

export const MODKIT_CLI_REALM = 'org.modkitx.app.cli/main'

export function createModkitCliTopology(): HostTopology {
  return createHostTopology({
    schemaVersion: 1,
    topologyId: 'org.modkitx.app/cli',
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
        policy: { id: 'org.modkitx.policy/cli-default', revision: '1' },
      },
    ],
    links: [],
  })
}

export function createModkitCliComposition(
  extensions: readonly ExtensionInput[] = [],
): Promise<HostComposition> {
  return createHostComposition({
    topology: createModkitCliTopology(),
    realmId: MODKIT_CLI_REALM,
    extensions,
  })
}
