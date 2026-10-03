import { describe, expect, it } from 'vitest'
import type { ExtensionManagerEntry } from '@modkit/extension-manager'
import { createUiLocalizer } from '@modkit/ui/localization'

import type { ContributionRow } from '../src/contributions.js'
import {
  createExtensionTree,
  extensionActionContextValue,
  extensionComponentActionContextValue,
  extensionEntryDisplayName,
  extensionGroupActionContextValue,
  extensionTreeChildren,
  extensionVendorActionContextValue,
  type ExtensionComponentNode,
  type ExtensionSectionNode,
  type ContributionContractNode,
  type ContributionNode,
  type ExtensionEntryNode,
  type ExtensionVendorNode,
} from '../src/extension-tree.js'

const installed: ExtensionManagerEntry = Object.freeze({
  id: 'org.example/models',
  displayName: 'Models',
  publisher: 'Example',
  availableVersion: 'local',
  installedVersion: 'local',
  enabled: true,
  updateAvailable: false,
  source: 'workspace',
  trusted: true,
})

const disabledExtension: ExtensionManagerEntry = Object.freeze({
  ...installed,
  id: 'org.example/audio',
  displayName: 'Audio',
  enabled: false,
})

const available: ExtensionManagerEntry = Object.freeze({
  id: 'org.example/available',
  displayName: 'Available',
  publisher: 'Example',
  availableVersion: '1.0.0',
  enabled: false,
  updateAvailable: false,
  source: 'registry',
  trusted: true,
})

function contribution(
  id: string,
  displayName: string,
  contract: string,
  contractMajor = 1,
  overrides: Partial<ContributionRow> = {},
): ContributionRow {
  return Object.freeze({
    id,
    displayName,
    contract,
    contractMajor,
    extension: installed.id,
    origin: 'installed',
    activationEligible: true,
    disabled: false,
    path: `${id}.json`,
    fileExtensions: [],
    anchorFileNames: [],
    pathFileNames: [],
    ...overrides,
  })
}

const contributions: readonly ContributionRow[] = Object.freeze([
  contribution('org.example/model-a', 'Model A', 'modkit/codec-contribution'),
  contribution('org.example/model-b', 'Model B', 'modkit/codec-contribution'),
  contribution('org.example/model-v2', 'Model v2', 'modkit/codec-contribution', 2),
  contribution('org.example/model-language', 'Model language', 'modkit/language-provider'),
  contribution('org.example/russian-ui', 'Russian UI', 'modkit/localization-contribution', 1),
  contribution('org.example/audio-codec', 'Audio codec', 'modkit/codec-contribution', 1, {
    extension: disabledExtension.id,
  }),
  Object.freeze({
    displayName: 'bad.json',
    extension: installed.id,
    origin: 'installed',
    activationEligible: false,
    disabled: false,
    path: 'bad.json',
    fileExtensions: [],
    anchorFileNames: [],
    pathFileNames: [],
  }),
])

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new TypeError(message)
  return value
}

function model() {
  return createExtensionTree({
    entries: [available, installed, disabledExtension],
    contributions,
    configuredDisabledContributionIds: ['org.example/model-b'],
    problems: [],
  })
}

describe('VS Code extension contribution tree', () => {
  it('groups package rows by vendor and game metadata while retaining shared components', () => {
    const gamePackage = Object.freeze({
      ...installed,
      id: 'org.example/game-tools',
      displayName: 'Technical package name',
      presentation: {
        displayName: 'Game Tools',
        vendor: { id: 'example', displayName: 'Example Studios' },
        games: [{ id: 'example-game', displayName: 'Example Game' }],
      },
    })
    const sharedPackage = Object.freeze({
      ...installed,
      id: 'org.example/shared-tools',
      displayName: 'Shared tools',
      presentation: { vendor: { id: 'example', displayName: 'Example Studios' } },
    })
    const groups = createExtensionTree({
      entries: [gamePackage, sharedPackage],
      contributions: [],
      configuredDisabledContributionIds: [],
      pendingReloadEntryIds: [gamePackage.id],
      problems: [],
    })
    const installedGroup = required(
      groups.find(group => group.group === 'installed'),
      'installed group is missing',
    )
    const [vendor] = extensionTreeChildren(installedGroup, []) as readonly ExtensionVendorNode[]
    const sections = extensionTreeChildren(
      required(vendor, 'vendor is missing'),
      [],
    ) as readonly ExtensionSectionNode[]
    const games = extensionTreeChildren(
      required(sections[0], 'games section is missing'),
      [],
    ) as readonly ExtensionComponentNode[]
    const components = extensionTreeChildren(
      required(sections[1], 'components section is missing'),
      [],
    ) as readonly ExtensionEntryNode[]

    expect(vendor).toMatchObject({ kind: 'vendor', id: 'example', label: 'Example Studios' })
    expect(sections.map(section => section.label)).toEqual(['Games', 'Components'])
    expect(games.map(component => component.label)).toEqual(['Example Game'])
    const gameEntry = games[0]?.entries[0]
    expect(extensionEntryDisplayName(required(gameEntry, 'game entry is missing').entry)).toBe(
      'Game Tools',
    )
    expect(gameEntry?.pendingReload).toBe(true)
    expect(components[0]?.entry.id).toBe(sharedPackage.id)
  })

  it('shows extensions directly below a vendor when that vendor declares no games', () => {
    const installedGroup = required(
      model().find(group => group.group === 'installed'),
      'installed group is missing',
    )
    const [maybeVendor] = extensionTreeChildren(
      installedGroup,
      [],
    ) as readonly ExtensionVendorNode[]
    const vendor = required(maybeVendor, 'vendor is missing')
    const directEntries = extensionTreeChildren(vendor, []) as readonly ExtensionEntryNode[]

    expect(vendor.label).toBe('Example')
    expect(directEntries.map(entry => entry.entry.id)).toEqual([disabledExtension.id, installed.id])
    expect(directEntries.every(entry => entry.kind === 'entry')).toBe(true)
  })

  it('exposes hover actions only for installed codecs and mutable packages', () => {
    const installedGroup = required(
      model().find(group => group.group === 'installed'),
      'installed group is missing',
    )
    const availableGroup = required(
      model().find(group => group.group === 'available'),
      'available group is missing',
    )
    const installedEntry = required(
      installedGroup.entries?.find(node => node.entry.id === installed.id),
      'installed entry is missing',
    )
    const availableEntry = required(availableGroup.entries?.[0], 'available entry is missing')
    const codecContract = (
      extensionTreeChildren(installedEntry, [
        'org.example/model-b',
      ]) as readonly ContributionContractNode[]
    ).find(node => node.contract === 'modkit/codec-contribution' && node.contractMajor === 1)
    const codecs = extensionTreeChildren(required(codecContract, 'codec contract is missing'), [
      'org.example/model-b',
    ]) as readonly ContributionNode[]

    expect(extensionActionContextValue(installedEntry)).toBe(
      'modkitExtension.installed.immutable.codecs.disabled',
    )
    expect(extensionActionContextValue(availableEntry)).toBe('modkitExtension.available')
    expect(extensionGroupActionContextValue(availableGroup)).toBe('modkitExtensionGroup.available')
    expect(codecs.map(extensionActionContextValue)).toEqual([
      'modkitContribution.codec.enabled',
      'modkitContribution.codec.disabled',
    ])
    // any installed contribution switches as its card does; one of an available package does not
    const provider = required(codecs[0], 'codec node is missing')
    const asProvider = {
      ...provider,
      contribution: { ...provider.contribution, contract: 'modkit/service-provider-contribution' },
    }
    expect(extensionActionContextValue(asProvider)).toBe('modkitContribution.installed.enabled')
    expect(extensionActionContextValue({ ...asProvider, group: 'available' })).toBe(
      'modkitContribution.enabled',
    )
    expect(
      extensionActionContextValue({
        ...installedEntry,
        entry: {
          ...installedEntry.entry,
          source: 'https://registry.example/modkit.tgz',
          updateAvailable: true,
        },
      }),
    ).toBe('modkitExtension.installed.mutable.update.codecs.disabled')
    expect(
      extensionVendorActionContextValue({
        kind: 'vendor',
        group: 'installed',
        id: 'example',
        label: 'Example',
        sections: [],
        mutable: true,
      }),
    ).toBe('modkitExtensionVendor.installed.mutable')
  })

  it('uses install, complete, and remove contexts for game state without offering install for immutable support', () => {
    const localGame = Object.freeze({
      ...installed,
      id: 'example/local-game',
      presentation: {
        vendor: { id: 'example', displayName: 'Example Studios' },
        games: [{ id: 'example/game', displayName: 'Example Game' }],
      },
    })
    const remoteGame = Object.freeze({
      ...available,
      id: 'example/remote-game',
      presentation: localGame.presentation,
    })
    const groups = createExtensionTree({
      entries: [localGame, remoteGame],
      contributions: [],
      configuredDisabledContributionIds: [],
      problems: [],
    })
    const installedVendor = required(
      extensionTreeChildren(required(groups[0], 'installed group'), [])[0] as ExtensionVendorNode,
      'installed vendor is missing',
    )
    const installedSections = extensionTreeChildren(
      installedVendor,
      [],
    ) as readonly ExtensionSectionNode[]
    const installedGame = required(
      (
        extensionTreeChildren(
          required(installedSections[0], 'games section'),
          [],
        ) as readonly ExtensionComponentNode[]
      )[0],
      'installed game is missing',
    )

    expect(extensionComponentActionContextValue(installedGame)).toBe(
      'modkitExtensionComponent.game.partial',
    )

    const immutableOnly = createExtensionTree({
      entries: [localGame],
      contributions: [],
      configuredDisabledContributionIds: [],
      problems: [],
    })
    const vendor = extensionTreeChildren(
      required(immutableOnly[0], 'installed group'),
      [],
    )[0] as ExtensionVendorNode
    const sections = extensionTreeChildren(vendor, []) as readonly ExtensionSectionNode[]
    const game = (
      extensionTreeChildren(
        required(sections[0], 'games section'),
        [],
      ) as readonly ExtensionComponentNode[]
    )[0]
    expect(extensionComponentActionContextValue(required(game, 'game is missing'))).toBe(
      'modkitExtensionComponent.game.installed.immutable',
    )
  })

  it('offers grouped removal for a game root explicitly linked in user settings', () => {
    const configuredGame = Object.freeze({
      ...installed,
      id: 'example/configured-game',
      source: 'configured',
      presentation: {
        vendor: { id: 'example', displayName: 'Example Studios' },
        games: [{ id: 'example/game', displayName: 'Example Game' }],
      },
    })
    const groups = createExtensionTree({
      entries: [configuredGame],
      contributions: [],
      configuredDisabledContributionIds: [],
      problems: [],
    })
    const vendor = extensionTreeChildren(
      required(groups[0], 'installed group'),
      [],
    )[0] as ExtensionVendorNode
    const sections = extensionTreeChildren(vendor, []) as readonly ExtensionSectionNode[]
    const game = extensionTreeChildren(
      required(sections[0], 'games section'),
      [],
    )[0] as ExtensionComponentNode

    expect(extensionVendorActionContextValue(vendor)).toBe(
      'modkitExtensionVendor.installed.mutable',
    )
    expect(extensionComponentActionContextValue(game)).toBe(
      'modkitExtensionComponent.game.installed.mutable',
    )
  })

  it('offers one inverse action when every codec in an extension is disabled', () => {
    const [installedGroup] = createExtensionTree({
      entries: [installed],
      contributions,
      configuredDisabledContributionIds: [
        'org.example/model-a',
        'org.example/model-b',
        'org.example/model-v2',
      ],
      problems: [],
    })
    const entry = required(installedGroup?.entries?.[0], 'installed entry is missing')
    expect(extensionActionContextValue(entry)).toBe(
      'modkitExtension.installed.immutable.codecs.disabled',
    )
  })

  it('nests real contributions under their exact owner extension and contract pair', () => {
    const installedGroup = required(
      model().find(group => group.group === 'installed'),
      'installed group is missing',
    )
    const modelExtension = installedGroup.entries?.find(
      node => node.entry.id === installed.id,
    ) as ExtensionEntryNode
    const contracts = extensionTreeChildren(modelExtension, [
      'org.example/model-b',
    ]) as readonly ContributionContractNode[]

    expect(contracts.map(node => node.label)).toEqual([
      'Invalid Contributions',
      'Codec Contributions',
      'Codec Contributions',
      'Language Contributions',
      'Language Contributions',
    ])
    expect(
      contracts.find(node => node.contractMajor === 1 && node.contract?.includes('codec'))
        ?.contributions,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'org.example/model-a' }),
        expect.objectContaining({ id: 'org.example/model-b' }),
      ]),
    )
    expect(contracts.every(node => node.kind === 'contract')).toBe(true)
  })

  it('uses the configured contribution switch immediately and marks reload drift honestly', () => {
    const installedGroup = required(
      model().find(group => group.group === 'installed'),
      'installed group is missing',
    )
    const modelExtension = installedGroup.entries?.find(
      node => node.entry.id === installed.id,
    ) as ExtensionEntryNode
    const codecContract = (
      extensionTreeChildren(modelExtension, [
        'org.example/model-b',
      ]) as readonly ContributionContractNode[]
    ).find(node => node.contract === 'modkit/codec-contribution' && node.contractMajor === 1)
    const requiredCodecContract = required(codecContract, 'codec contract group is missing')
    const leaves = extensionTreeChildren(requiredCodecContract, ['org.example/model-b'])

    expect(leaves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'contribution',
          contribution: expect.objectContaining({ id: 'org.example/model-a' }),
          enabled: true,
          pendingReload: false,
        }),
        expect.objectContaining({
          kind: 'contribution',
          contribution: expect.objectContaining({ id: 'org.example/model-b' }),
          enabled: false,
          configuredDisabled: true,
          pendingReload: true,
        }),
      ]),
    )
  })

  it('makes all contribution leaves ineffective when their extension is disabled', () => {
    const installedGroup = required(
      model().find(group => group.group === 'installed'),
      'installed group is missing',
    )
    const extension = installedGroup.entries?.find(
      node => node.entry.id === disabledExtension.id,
    ) as ExtensionEntryNode
    const [contract] = extensionTreeChildren(extension, []) as readonly ContributionContractNode[]
    const [leaf] = extensionTreeChildren(required(contract, 'contract group is missing'), [])

    expect(leaf).toMatchObject({
      kind: 'contribution',
      enabled: false,
      configuredDisabled: false,
    })
  })

  it('keeps available packages as leaves because they have no composed inventory yet', () => {
    const availableGroup = required(
      model().find(group => group.group === 'available'),
      'available group is missing',
    )
    const [entry] = availableGroup.entries ?? []

    expect(entry?.entry.id).toBe(available.id)
    expect(extensionTreeChildren(required(entry, 'available entry is missing'), [])).toEqual([])
  })

  it('shows only installed, available, and problems roots in that order', () => {
    const groups = model()

    expect(groups.map(group => group.group)).toEqual(['installed', 'available', 'problems'])
    expect(groups[0]?.entries?.map(node => node.entry.id)).toEqual([
      installed.id,
      disabledExtension.id,
    ])
  })

  it('does not offer install-all for an empty available group', () => {
    const groups = createExtensionTree({
      entries: [installed],
      contributions,
      configuredDisabledContributionIds: [],
      problems: [],
    })
    const availableGroup = required(
      groups.find(group => group.group === 'available'),
      'available group is missing',
    )
    expect(extensionGroupActionContextValue(availableGroup)).toBe(
      'modkitExtensionGroup.available.empty',
    )
  })

  it('localizes group and contribution contract labels without replacing exact identities', () => {
    const localized = createExtensionTree({
      entries: [installed],
      contributions,
      configuredDisabledContributionIds: [],
      problems: [],
      localizer: createUiLocalizer('ru'),
    })
    expect(localized.map(group => group.label)).toEqual(['Установленные', 'Доступные', 'Проблемы'])
    const installedGroup = required(
      localized.find(group => group.group === 'installed'),
      'installed group is missing',
    )
    const extension = required(installedGroup.entries?.[0], 'installed extension is missing')
    const contracts = extensionTreeChildren(
      extension,
      [],
      createUiLocalizer('ru'),
    ) as readonly ContributionContractNode[]
    expect(contracts.map(node => node.label)).toEqual([
      'Ошибочные возможности',
      'Кодеки',
      'Кодеки',
      'Языки',
      'Языки',
    ])
    expect(contracts[1]).toMatchObject({
      contract: 'modkit/codec-contribution',
      contractMajor: 1,
    })
  })
})
