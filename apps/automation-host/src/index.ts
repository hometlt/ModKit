import { uint64 } from '@modkitx-x3/core'
import { createHostTopology, type HostTopology } from '@modkitx-x3/sdk'
import { createHostComposition, type ExtensionInput, type HostComposition } from '@modkitx-x3/host'
import { nodeRuntimeTargetBase } from '@modkitx-x3/host/node'

export const AUTOMATION_REALM = 'org.modkitx.app.automation/main'

export function createAutomationTopology(): HostTopology {
  return createHostTopology({
    schemaVersion: 1,
    topologyId: 'org.modkitx.app/automation-host',
    realms: [
      {
        schemaVersion: 1,
        realmId: AUTOMATION_REALM,
        revision: '1',
        target: nodeRuntimeTargetBase(),
        facilities: [
          'filesystem.read-random',
          'native-process.rpc',
          'network.range-fetch',
          'worker.module',
        ],
        budgets: {
          maxConcurrentTasks: 16,
          maxWorkerCount: 8,
          maxResidentBytes: uint64('8589934592'),
          maxTransferBytes: uint64('536870912'),
          defaultDeadlineMs: 300_000,
        },
        policy: { id: 'org.modkitx.policy/automation-default', revision: '1' },
      },
    ],
    links: [],
  })
}

export interface AutomationHostDescription {
  readonly topologyId: string
  readonly realmId: string
  readonly facilities: readonly string[]
  readonly contributions: readonly string[]
  readonly diagnostics: number
}

export interface AutomationHost {
  readonly composition: HostComposition
  describeHost(): AutomationHostDescription
}

export async function createAutomationHost(
  extensions: readonly ExtensionInput[] = [],
): Promise<AutomationHost> {
  const composition = await createHostComposition({
    topology: createAutomationTopology(),
    realmId: AUTOMATION_REALM,
    extensions,
  })
  return Object.freeze({
    composition,
    describeHost: () =>
      Object.freeze({
        topologyId: composition.topology.topologyId,
        realmId: composition.profile.realmId,
        facilities: composition.profile.facilities,
        contributions: Object.freeze(
          composition.inventory.extensions.flatMap(extension =>
            extension.contributions.flatMap(contribution =>
              contribution.manifest === undefined ? [] : [contribution.manifest.id],
            ),
          ),
        ),
        diagnostics: composition.inventory.diagnostics.length,
      }),
  })
}
