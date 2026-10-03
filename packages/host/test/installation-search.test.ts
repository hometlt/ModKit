import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { gameLaunchOptionsJsonSchema } from '../../sdk/src/games/index.js'
import {
  GAME_INSTALLATION_MATCHER,
  gameInstallationSearchOf,
  gameLaunchOptionsOf,
} from '../src/games/index.js'
import type { Inventory } from '../src/inventory.js'
import { searchInstallationFolders } from '../src/node/installation-search.js'

const drive = await mkdtemp(join(tmpdir(), 'modkit-installation-search-'))
afterAll(() => rm(drive, { recursive: true, force: true }))

async function install(path: string, files: readonly string[]): Promise<void> {
  await mkdir(join(drive, path), { recursive: true })
  for (const file of files) await writeFile(join(drive, path, file), '')
}

const markers = [
  { gameId: 'blizzard/starcraft-2', files: ['.build.info', 'StarCraft II.exe'] },
  { gameId: 'blizzard/diablo-3', files: ['.build.info', 'Diablo III.exe'] },
  { gameId: 'wz2100project/warzone-2100', files: ['warzone2100.exe'] },
]

describe('the host’s folder search for installed games', () => {
  it('finds folders shaped like a game two levels into the search folders, and no deeper', async () => {
    await install('Games/StarCraft II', ['.build.info', 'StarCraft II.exe'])
    await install('Games/Blizzard/Diablo III', ['.BUILD.INFO', 'diablo iii.exe'])
    await install('Games/Deep/er/Warzone 2100', ['warzone2100.exe'])
    await install('XboxGames/Warzone 2100', ['warzone2100.exe'])
    await install('Games/Blizzard/Half', ['.build.info'])
    const search = await searchInstallationFolders({
      markers,
      searchFolders: ['XboxGames'],
      platform: 'win32',
      drives: [drive],
      environment: {},
    })
    expect(search.complete).toBe(true)
    expect(search.found).toEqual({
      'blizzard/starcraft-2': [join(drive, 'Games', 'StarCraft II')],
      'blizzard/diablo-3': [join(drive, 'Games', 'Blizzard', 'Diablo III')],
      'wz2100project/warzone-2100': [join(drive, 'XboxGames', 'Warzone 2100')],
    })
  })

  it('searches a folder the user names as it is, and says when its limit stopped the walk', async () => {
    const named = await searchInstallationFolders({
      markers,
      folders: [join(drive, 'Games', 'Deep')],
      platform: 'win32',
      drives: [],
      environment: {},
    })
    expect(named.found['wz2100project/warzone-2100']).toEqual([
      join(drive, 'Games', 'Deep', 'er', 'Warzone 2100'),
    ])
    const limited = await searchInstallationFolders({
      markers,
      platform: 'win32',
      drives: [drive],
      environment: {},
      maxFolders: 2,
    })
    expect(limited.complete).toBe(false)
  })

  it('searches only the common folders the user kept, when the application names them', async () => {
    const kept = await searchInstallationFolders({
      markers,
      commonFolders: ['XboxGames'],
      platform: 'win32',
      drives: [drive],
      environment: { LOCALAPPDATA: join(drive, 'Games') },
    })
    // `Games` is neither kept nor reached through %LOCALAPPDATA%
    expect(kept.found).toEqual({
      'wz2100project/warzone-2100': [join(drive, 'XboxGames', 'Warzone 2100')],
    })
  })

  it('takes the local drives Windows mounts itself, never a mapped share', async () => {
    const asked: string[][] = []
    const search = await searchInstallationFolders({
      markers,
      platform: 'win32',
      environment: {},
      runRegistry: async args => {
        asked.push([...args])
        return [
          'HKEY_LOCAL_MACHINE\\SYSTEM\\MountedDevices',
          '    \\DosDevices\\Q:    REG_BINARY    00',
          '    \\??\\Volume{1234}    REG_BINARY    00',
        ].join('\r\n')
      },
    })
    expect(asked).toEqual([['query', 'HKLM\\SYSTEM\\MountedDevices']])
    expect(search.found).toEqual({})
  })
})

describe('installation markers in discovery offers', () => {
  const offer = (facet: unknown) =>
    ({
      extensions: [
        {
          contributions: [
            {
              activationEligible: true,
              manifest: {
                contract: { id: 'modkit/service-provider-contribution', major: 1 },
                spec: {
                  provides: [{ contract: 'common.game/installation-discovery', major: 1, facet }],
                },
              },
            },
          ],
        },
      ],
    }) as unknown as Inventory
  const match = (facet: unknown) =>
    GAME_INSTALLATION_MATCHER.match({
      contract: 'common.game/installation-discovery',
      major: 1,
      offerFacet: facet,
      requestFacet: { gameId: 'blizzard/starcraft-2' },
    } as never, undefined)

  it('are gathered from the inventory without activating a provider', async () => {
    const facet = {
      gameIds: ['blizzard/starcraft-2'],
      markers: [markers[0]],
      searchFolders: ['XboxGames', 'Battle.net Games'],
    }
    expect((await match(facet)).state).toBe('match')
    expect(gameInstallationSearchOf(offer(facet))).toEqual({
      markers: [markers[0]],
      searchFolders: ['XboxGames', 'Battle.net Games'],
    })
  })

  it('make an offer invalid when they name another game or a path', async () => {
    for (const facet of [
      { gameIds: ['blizzard/starcraft-2'], markers: [markers[1]] },
      { gameIds: ['blizzard/starcraft-2'], markers: [{ ...markers[0], files: ['x/y.exe'] }] },
      { gameIds: ['blizzard/starcraft-2'], searchFolders: ['C:\\Games'] },
    ]) {
      expect((await match(facet)).state).toBe('invalid')
      expect(gameInstallationSearchOf(offer(facet))).toEqual({ markers: [], searchFolders: [] })
    }
  })
})

describe('launch options in launch-plan offers', () => {
  const launchOffer = (facet: unknown) =>
    ({
      extensions: [
        {
          contributions: [
            {
              activationEligible: true,
              manifest: {
                contract: { id: 'modkit/service-provider-contribution', major: 1 },
                spec: { provides: [{ contract: 'common.game/launch-plan', major: 1, facet }] },
              },
            },
          ],
        },
      ],
    }) as unknown as Inventory
  const options = {
    triggerDebug: { type: 'boolean', default: false, description: 'Open the trigger debugger' },
    difficulty: { type: 'integer', minimum: 1, maximum: 10, default: 4 },
    speed: { type: 'integer', enum: [0, 1, 2, 3, 4] },
    map: { type: 'string', path: true },
  }

  it('are gathered by game from the inventory without activating a planner', async () => {
    const facet = { gameIds: ['blizzard/starcraft-2'], launchOptions: options }
    expect(
      (await GAME_INSTALLATION_MATCHER.match({
        contract: 'common.game/launch-plan',
        major: 1,
        offerFacet: facet,
        requestFacet: { gameId: 'blizzard/starcraft-2' },
      } as never, undefined)).state,
    ).toBe('match')
    expect(gameLaunchOptionsOf(launchOffer(facet)).get('blizzard/starcraft-2')).toEqual(options)
    // an offer without options adds none
    expect(gameLaunchOptionsOf(launchOffer({ gameIds: ['blizzard/starcraft-2'] })).size).toBe(0)
  })

  it('make the offer invalid when an option is not well formed', () => {
    for (const launchOptions of [
      {},
      { 'bad name': { type: 'boolean' } },
      { flag: { type: 'boolean', enum: [true] } },
      { level: { type: 'integer', default: 2.5 } },
      { level: { type: 'integer', minimum: 5, maximum: 1 } },
      { level: { type: 'number', minimum: 1, default: 0 } },
      { speed: { type: 'integer', enum: [1, 2], default: 3 } },
      { path: { type: 'number', path: true } },
      { note: { type: 'string', extra: 1 } },
    ]) {
      expect(gameLaunchOptionsOf(launchOffer({ gameIds: ['g/x'], launchOptions })).size).toBe(0)
    }
  })

  it('give a launch configuration the JSON Schema of exactly these options', () => {
    expect(gameLaunchOptionsJsonSchema({ difficulty: options.difficulty } as never)).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: { difficulty: { type: 'integer', default: 4, minimum: 1, maximum: 10 } },
    })
  })
})
