import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  collectWarzoneInstallationCandidates,
  normalizeWarzoneInstallationPath,
  parseAppModelPackageKeys,
  parseRegistryValue,
  parseSteamInstallDirectory,
  parseSteamLibraryPaths,
} from '../src/installation-candidates.js'
import {
  defaultWarzoneInstallationPaths,
  discoverWarzone2100Installations,
} from '../src/provider.js'

const GAME_ID = 'org.modkitx/warzone-2100'
const temporaryRoots: string[] = []

afterAll(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })),
  )
})

async function installation(layout: 'direct' | 'nested', magic = Buffer.from('PK\x03\x04')) {
  const root = await mkdtemp(join(tmpdir(), 'modkitx-wz-install-'))
  temporaryRoots.push(root)
  const contentRoot = layout === 'nested' ? join(root, 'data') : root
  await mkdir(contentRoot, { recursive: true })
  await writeFile(join(contentRoot, 'base.wz'), Buffer.concat([magic, Buffer.from('fixture')]))
  await writeFile(
    join(contentRoot, 'mp.wz'),
    Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('mp')]),
  )
  return root
}

describe('Warzone 2100 installation candidate collection', () => {
  it('preserves manual, environment, AppModel, uninstall, Steam and default precedence', () => {
    const root = join(process.cwd(), '.warzone-candidate-fixtures')
    const manual = join(root, 'manual')
    const environment = join(root, 'environment')
    const store = join(root, 'store')
    const registry = join(root, 'registry')
    const steam = join(root, 'steam')
    const fallback = join(root, 'fallback')
    const result = collectWarzoneInstallationCandidates(
      {
        configuredPaths: [manual],
        environmentPath: environment,
        appModelPaths: [{ path: store, storeAppId: 'store-id', version: '4.7.0.0' }],
        registryPaths: [registry, store.toUpperCase()],
        steamPaths: [{ path: steam, storeAppId: '1241950' }],
        defaultPaths: [fallback, steam.toUpperCase()],
        platform: 'win32',
      },
      16,
    )
    expect(result.candidates.map(value => [value.origin, value.path])).toEqual(
      [
        ['configured-path', manual],
        ['configured-path', environment],
        ['registry', store],
        ['registry', registry],
        ['steam', steam],
        ['default-directory', fallback],
      ].map(([origin, path]) => [origin, normalizeWarzoneInstallationPath(path)]),
    )
    expect(result.candidateOrigins).toEqual([
      ['configured-path'],
      ['configured-path'],
      ['registry'],
      ['registry'],
      ['steam', 'default-directory'],
      ['default-directory'],
    ])
    expect(result.truncated).toBe(false)
  })

  it('rejects empty and NUL-bearing configured paths', () => {
    const base = {
      environmentPath: undefined,
      appModelPaths: [],
      registryPaths: [],
      steamPaths: [],
      defaultPaths: [],
      platform: process.platform,
    }
    expect(() =>
      collectWarzoneInstallationCandidates({ ...base, configuredPaths: [''] }, 1),
    ).toThrow('configuredPaths[0] must be a non-empty path')
    expect(() =>
      collectWarzoneInstallationCandidates({ ...base, configuredPaths: ['bad\0path'] }, 1),
    ).toThrow('must not contain NUL')
  })
})

describe('bounded platform metadata parsers', () => {
  it('accepts only the exact Warzone Windows Store package prefix', () => {
    const prefix = '48148WZ2100Project.Warzone2100forWindows'
    const root =
      'HKEY_CURRENT_USER\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages'
    const expected = `${prefix}_4.7.0.0_x64__qsk72963svc8a`
    const parsed = parseAppModelPackageKeys(
      `${root}\\Unrelated.Warzone_1.0.0.0_x64__none\r\n${root}\\${expected}\r\n${root}\\${prefix}Extra_4.7.0.0_x64__none`,
      prefix,
    )
    expect(parsed).toEqual([{ key: `${root}\\${expected}`, packageFullName: expected }])
  })

  it('reads registry values without accepting adjacent names', () => {
    const output = `PackageRootFolderOld    REG_SZ    C:\\wrong\r\n    PackageRootFolder    REG_SZ    C:\\Warzone`
    expect(parseRegistryValue(output, 'PackageRootFolder')).toBe('C:\\Warzone')
  })

  it('parses bounded Steam libraries and a safe one-component install directory', () => {
    const libraries = parseSteamLibraryPaths(
      `"path" "D:\\\\SteamLibrary"\n"path" "E:\\\\Games\\\\Steam"`,
    )
    expect(libraries).toEqual(
      ['D:\\SteamLibrary', 'E:\\Games\\Steam'].map(normalizeWarzoneInstallationPath),
    )
    expect(parseSteamInstallDirectory('"installdir" "Warzone 2100"')).toBe('Warzone 2100')
    expect(parseSteamInstallDirectory('"installdir" "..\\\\escape"')).toBeUndefined()
    expect(parseSteamInstallDirectory('"installdir" "nested/path"')).toBeUndefined()
  })

  it('keeps macOS, Linux, Flatpak and Snap defaults bounded', () => {
    expect(defaultWarzoneInstallationPaths('darwin', '/Users/test')).toContain(
      '/Applications/Warzone 2100.app/Contents/Resources',
    )
    const linux = defaultWarzoneInstallationPaths('linux', '/home/test')
    expect(linux).toContain('/usr/share/warzone2100')
    expect(linux.some(path => path.includes('/snap/warzone2100/current/'))).toBe(true)
    expect(linux.some(path => path.includes('/flatpak/app/net.wz2100.wz2100/'))).toBe(true)
  })
})

describe('Warzone 2100 installation provider', () => {
  it('accepts the nested packaged layout and reports optional archive evidence', async () => {
    const root = await installation('nested')
    const result = await discoverWarzone2100Installations({
      gameId: GAME_ID,
      configuredPaths: [root],
      maxCandidates: 1,
    })
    expect(result.complete).toBe(false)
    expect(result.installations).toHaveLength(1)
    expect(result.installations[0]?.normalizedPath).toBe(normalizeWarzoneInstallationPath(root))
    expect(result.installations[0]?.origins).toEqual(['configured-path'])
    expect(result.installations[0]?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'warzone-base-zip-signature', found: true }),
        expect.objectContaining({ kind: 'warzone-mp-archive', found: true }),
        expect.objectContaining({ kind: 'warzone-sequences-archive', found: false }),
      ]),
    )
  })

  it('accepts a direct Linux-style content root and rejects bad ZIP magic', async () => {
    const valid = await installation('direct')
    const invalid = await installation('direct', Buffer.from('NOPE'))
    const result = await discoverWarzone2100Installations({
      gameId: GAME_ID,
      configuredPaths: [valid, invalid],
      maxCandidates: 2,
    })
    expect(result.complete).toBe(false)
    expect(result.probes.map(probe => probe.confirmed)).toEqual([true, false])
    expect(result.installations.map(value => value.normalizedPath)).toEqual([
      normalizeWarzoneInstallationPath(valid),
    ])
  })

  it('fails closed for another game and invalid candidate limits', async () => {
    await expect(
      discoverWarzone2100Installations({ gameId: 'org.modkitx/other', maxCandidates: 1 }),
    ).rejects.toThrow('cannot inspect')
    await expect(
      discoverWarzone2100Installations({ gameId: GAME_ID, maxCandidates: 0 }),
    ).rejects.toThrow('maxCandidates')
  })
})
