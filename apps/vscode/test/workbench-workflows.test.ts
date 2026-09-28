import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildContainerIndex } from '../src/container-uri.js'
import { STAGE_ORDER } from '../src/view-policy.js'
import {
  VSCODE_CONTAINER_SEARCH_LIMIT,
  VSCODE_LEGACY_VIEW_REPLACEMENTS,
  assertMaterializationBound,
  createDiagnosticJournal,
  diagnosticsReport,
  gameLocales,
  installationSearchFolders,
  installationGameIds,
  logLevelOf,
  installationsAtFolder,
  regionsToConnect,
  searchContainerIndex,
  selectedContentSources,
  selectedInstallationDirectory,
  withSelectedContentSource,
  withoutSelectedContentSource,
} from '../src/workbench-workflows.js'

describe('generic container tools', () => {
  const index = buildContainerIndex([
    { id: '1', path: 'Base.ALPHAData/GameData/Units.xml', name: 'Units.xml', kind: 'file' },
    { id: '2', path: 'mods/readme.TXT', name: 'readme.TXT', kind: 'file' },
    { id: '3', path: 'mods/units.txt', name: 'units.txt', kind: 'file' },
  ])

  it('searches normalized member paths deterministically and with a hard cap', () => {
    expect(searchContainerIndex(index, 'UNIT').map(hit => hit.path)).toEqual([
      'Base.ALPHAData/GameData/Units.xml',
      'mods/units.txt',
    ])
    expect(searchContainerIndex(index, 'mods\\', 1).map(hit => hit.path)).toEqual([
      'mods/readme.TXT',
    ])
    expect(searchContainerIndex(index, 'txt', VSCODE_CONTAINER_SEARCH_LIMIT + 1)).toHaveLength(2)
    expect(searchContainerIndex(index, '   ')).toEqual([])
  })

  it('refuses directories and declared or observed payloads over the materialization budget', () => {
    expect(() =>
      assertMaterializationBound('folder', { name: 'folder', kind: 'directory' }),
    ).toThrow(/directory/u)
    expect(() =>
      assertMaterializationBound(
        'huge.bin',
        { name: 'huge.bin', kind: 'file', size: 9 },
        undefined,
        8,
      ),
    ).toThrow(/materialization limit/u)
    expect(() =>
      assertMaterializationBound('unknown.bin', { name: 'unknown.bin', kind: 'file' }),
    ).toThrow(/declares no size/u)
    expect(() =>
      assertMaterializationBound('unknown.bin', { name: 'unknown.bin', kind: 'file' }, 9, 8),
    ).toThrow(/materialization limit/u)
    expect(() =>
      assertMaterializationBound('small.bin', { name: 'small.bin', kind: 'file', size: 8 }, 8, 8),
    ).not.toThrow()
  })
})

describe('generic source lifecycle', () => {
  const alpha = {
    gameId: 'org.example/game-alpha',
    displayName: 'Example Game Alpha',
    installPath: 'C:\\Games\\Example Game Alpha',
    normalizedPath: 'c:/games/example game alpha',
    version: '1.2.3',
    buildUid: 'build-alpha',
  }
  const beta = {
    gameId: 'org.example/game-beta',
    displayName: 'Example Game Beta',
    installPath: 'C:\\Games\\Example Game Beta',
    normalizedPath: 'c:/games/beta 2100',
  }

  it('validates persisted selections, replaces a path once and unloads exactly one source', () => {
    expect(selectedContentSources([null, { gameId: '' }, alpha])).toEqual([alpha])
    expect(withSelectedContentSource([alpha], { ...alpha, displayName: 'ALPHA' })).toEqual([
      { ...alpha, displayName: 'ALPHA' },
    ])
    expect(withoutSelectedContentSource([alpha, beta], alpha.normalizedPath)).toEqual([beta])
  })

  it('selects only the installation a provider proved at the folder the user chose', () => {
    const installation = (installPath: string, origin: 'configured-path' | 'registry') => ({
      gameId: 'org.example/game-alpha',
      displayName: 'Example Game Alpha',
      installPath,
      normalizedPath: installPath.toLowerCase(),
      origins: [origin],
      evidence: [],
      version: '1.06',
    })
    const chosen = join('F:', 'Games', 'Alpha')
    // The same discovery also reports the stale registry root; it does not answer for the folder.
    expect(
      installationsAtFolder(
        [
          installation(join('C:', 'Apps', 'Alpha'), 'registry'),
          installation(join(chosen, '.'), 'configured-path'),
          installation(join('F:', 'Games', 'Other'), 'configured-path'),
        ],
        chosen,
      ),
    ).toEqual([
      {
        gameId: 'org.example/game-alpha',
        displayName: 'Example Game Alpha',
        installPath: join(chosen, '.'),
        normalizedPath: join(chosen, '.').toLowerCase(),
        version: '1.06',
      },
    ])
    expect(installationsAtFolder([installation(chosen, 'registry')], chosen)).toEqual([])
  })

  it('derives supported game ids from standard installation offer facts, not an app allowlist', () => {
    const contribution = (gameIds: readonly string[]) => ({
      manifest: {
        spec: {
          provides: [
            {
              contract: 'common.game/installation-discovery',
              major: 1,
              facet: { gameIds },
            },
          ],
        },
      },
    })
    expect(
      installationGameIds({
        extensions: [
          { contributions: [contribution([beta.gameId, alpha.gameId])] },
          { contributions: [contribution([alpha.gameId])] },
        ],
      }),
    ).toEqual([alpha.gameId, beta.gameId])
  })

  it('signs in only to the regions the reference downloads come from', () => {
    const roots = [
      { id: 'roblox:assets', region: 'open-cloud' },
      { id: 'battlenet:public', region: 'eu' },
    ]
    const regions = [
      { id: 'eu', credentialId: 'blizzard/battlenet' },
      { id: 'open-cloud', credentialId: 'roblox/open-cloud' },
      { id: 'local' },
    ]
    // a Roblox download does not touch the Battle.net account, whose sign-in may fail
    expect(regionsToConnect(['roblox:assets'], roots, regions, [])).toEqual(['open-cloud'])
    expect(regionsToConnect(['roblox:assets'], roots, regions, ['open-cloud'])).toEqual([])
    expect(regionsToConnect(['unknown'], roots, regions, [])).toEqual([])
  })

  it('writes a diagnostics report without the secrets settings may hold (plan 8.5)', () => {
    const report = diagnosticsReport({
      createdAt: '2026-09-29T00:00:00.000Z',
      versions: { modkit: '0.1.0' },
      settings: {
        locale: 'ruRU',
        contributionSettings: {
          'modkit/translation': { apiKey: 'sk-live-secret', endpoint: 'https://translate.example' },
        },
        stormgate: { aesKey: '0xDEADBEEF' },
        accounts: [{ token: 'ticket-value', name: 'shown' }],
      },
      contentSources: [{ id: 'local:casc', label: 'StarCraft II' }],
      loadedMods: [{ id: 'sc2|host|c:/mods/a.sc2mod', label: 'A.SC2Mod' }],
      journal: '[host] opened\r\n[host] closed\n',
    })
    for (const secret of ['sk-live-secret', '0xDEADBEEF', 'ticket-value'])
      expect(report).not.toContain(secret)
    const parsed = JSON.parse(report) as Record<string, unknown>
    expect(parsed['settings']).toMatchObject({
      locale: 'ruRU',
      contributionSettings: { 'modkit/translation': { endpoint: 'https://translate.example' } },
      accounts: [{ name: 'shown' }],
    })
    expect(parsed['journal']).toEqual(['[host] opened', '[host] closed'])
    expect(parsed['loadedMods']).toEqual([{ id: 'sc2|host|c:/mods/a.sc2mod', label: 'A.SC2Mod' }])
  })

  it('reads the installation search folders: a name at every drive root, a path as it is', () => {
    expect(
      installationSearchFolders(
        ['Games', ' Apps ', '%LOCALAPPDATA%\\Programs', 'Z:\\Shared\\Games', '%UNSET%', '', 7],
        { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      ),
    ).toEqual({
      driveFolders: ['Games', 'Apps', '%UNSET%'],
      folders: ['C:\\Users\\me\\AppData\\Local\\Programs', 'Z:\\Shared\\Games'],
    })
    expect(installationSearchFolders(undefined, {})).toEqual({ driveFolders: [], folders: [] })
  })

  it('files journal lines by the severity word the product writes', () => {
    expect(logLevelOf('[container] warning x3.host/capped: listing capped')).toBe('warning')
    expect(logLevelOf('[subject-rpc] error x3.abi/closed: gone')).toBe('error')
    expect(logLevelOf('[extensions] no errors in 12 roots')).toBe('info')
    expect(logLevelOf('Modkit MK3 0.1.0 activated in 4000 ms')).toBe('info')
  })

  it('takes the game-string locale from modkit.locale, else from the display language, then enUS', () => {
    expect(gameLocales('', 'ru')).toEqual(['ruRU', 'enUS'])
    expect(gameLocales(undefined, 'pt-br')).toEqual(['ptBR', 'enUS'])
    expect(gameLocales('', 'zh-tw')).toEqual(['zhTW', 'enUS'])
    // a display language no game locale matches, or its English, reads enUS alone
    expect(gameLocales('', 'cs')).toEqual(['enUS'])
    expect(gameLocales('', 'en-gb')).toEqual(['enUS'])
    // the setting wins over the display language, spelled any case; an unlisted code is kept
    expect(gameLocales('dede', 'ru')).toEqual(['deDE', 'enUS'])
    expect(gameLocales(' enUS ', 'ru')).toEqual(['enUS'])
    expect(gameLocales('xxYY', 'ru')).toEqual(['xxYY', 'enUS'])
  })

  it('hands each extension the selected installation of the game its own discovery names', () => {
    const extension = (id: string, gameIds: readonly string[]) => ({
      manifest: { publisher: 'org.example', id },
      contributions: [
        {
          manifest: {
            spec: {
              provides: [
                { contract: 'common.game/installation-discovery', major: 1, facet: { gameIds } },
              ],
            },
          },
        },
      ],
    })
    const inventory = {
      extensions: [
        extension('alpha', [alpha.gameId]),
        extension('beta', [beta.gameId]),
        extension('images', []),
      ],
    }
    expect(selectedInstallationDirectory(inventory, [alpha, beta], 'org.example/alpha')).toBe(
      alpha.installPath,
    )
    expect(selectedInstallationDirectory(inventory, [alpha, beta], 'org.example/beta')).toBe(
      beta.installPath,
    )
    // no discovery of its own, or its game not selected: the module gets no installation
    expect(selectedInstallationDirectory(inventory, [alpha, beta], 'org.example/images')).toBe(
      undefined,
    )
    expect(selectedInstallationDirectory(inventory, [alpha], 'org.example/beta')).toBe(undefined)
  })
})

describe('visible diagnostics and focused-view replacement truth', () => {
  it('keeps a bounded readable/exportable journal', () => {
    const journal = createDiagnosticJournal(2)
    journal.append('first')
    journal.append('second\r\ncontinued')
    journal.append('third')
    expect(journal.lines()).toEqual(['continued', 'third'])
    expect(journal.text()).toBe('continued\nthird\n')
  })

  it('maps the generic legacy views to live surfaces exactly once', () => {
    expect(VSCODE_LEGACY_VIEW_REPLACEMENTS.map(row => row.legacyViewId)).toEqual([
      'modkitArchiveTree',
      'modkitGameCodecsTree',
      'modkitModTree',
      'modkitView',
    ])
    expect(VSCODE_LEGACY_VIEW_REPLACEMENTS.flatMap(row => row.surfaces)).toEqual(
      expect.arrayContaining([
        'native-explorer',
        'extensions-view',
        'host-view',
        'presentation:tree',
        'presentation:relations',
        'presentation:edit',
      ]),
    )
    for (const surface of VSCODE_LEGACY_VIEW_REPLACEMENTS.flatMap(row => row.surfaces)) {
      if (!surface.startsWith('presentation:') || surface === 'presentation:workbench') continue
      expect(STAGE_ORDER).toContain(surface.slice('presentation:'.length))
    }
  })

  it('surfaces every replacement workflow as a registered and activated native command', () => {
    const appRoot = join(import.meta.dirname, '..')
    const manifest = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as {
      readonly contributes: { readonly commands: readonly { readonly command: string }[] }
      readonly activationEvents: readonly string[]
    }
    const source = readFileSync(join(appRoot, 'src', 'extension.ts'), 'utf8')
    const expected = [
      'modkit.exportDiagnostics',
      'modkit.materializeContainerEntry',
      'modkit.navigateResource',
      'modkit.refreshContainer',
      'modkit.refreshRelations',
      'modkit.searchContainer',
      'modkit.selectGameInstallation',
      'modkit.showDiagnostics',
      'modkit.unloadSource',
    ]
    for (const command of expected) {
      expect(manifest.contributes.commands.map(row => row.command)).toContain(command)
      expect(manifest.activationEvents).toContain(`onCommand:${command}`)
      expect(source).toContain(`registerCommand('${command}'`)
    }
    expect(source).toMatch(
      /assertMaterializationBound\(entry, node\)[\s\S]*containers\.read\(container, entry\)[\s\S]*assertMaterializationBound\(entry, node, bytes\.byteLength\)/u,
    )
  })
})
