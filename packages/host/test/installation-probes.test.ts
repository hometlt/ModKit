import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createNodeInstallationProbes,
  registryLines,
  valveValues,
} from '../src/node/installation-probes.js'

const work = await mkdtemp(join(tmpdir(), 'modkit-installation-probes-'))
afterAll(() => rm(work, { recursive: true, force: true }))

describe('installation probes of a desktop host', () => {
  it('finds a Steam app through libraryfolders.vdf and its app manifest', async () => {
    const steam = join(work, 'Steam')
    const library = join(work, 'SteamLibrary')
    await mkdir(join(steam, 'steamapps'), { recursive: true })
    await mkdir(join(library, 'steamapps', 'common', 'Warzone 2100'), { recursive: true })
    await writeFile(
      join(steam, 'steamapps', 'libraryfolders.vdf'),
      `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam.replaceAll('\\', '\\\\')}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${library.replaceAll('\\', '\\\\')}"\n\t}\n}\n`,
    )
    await writeFile(
      join(library, 'steamapps', 'appmanifest_1241950.acf'),
      '"AppState"\n{\n\t"appid"\t\t"1241950"\n\t"installdir"\t\t"Warzone 2100"\n}\n',
    )
    const probes = createNodeInstallationProbes({ steamRoots: [steam], platform: 'win32' })
    expect(await probes.steamAppDir(1241950)).toBe(
      join(library, 'steamapps', 'common', 'Warzone 2100'),
    )
    expect(await probes.steamAppDir(7)).toBeUndefined()
  })

  it('reads an Epic manifest by AppName and ignores unreadable ones', async () => {
    const manifests = join(work, 'Manifests')
    await mkdir(manifests, { recursive: true })
    await writeFile(
      join(manifests, 'a.item'),
      JSON.stringify({ AppName: 'Game', InstallLocation: 'D:\\Games\\Game' }),
    )
    await writeFile(join(manifests, 'b.item'), '{ not json')
    const probes = createNodeInstallationProbes({ epicManifestDirs: [manifests] })
    expect(await probes.epicInstallLocation('Game')).toBe('D:\\Games\\Game')
    expect(await probes.epicInstallLocation('Other')).toBeUndefined()
  })

  it('reads registry values from both views and refuses unsafe keys without running reg.exe', async () => {
    const calls: string[][] = []
    const probes = createNodeInstallationProbes({
      platform: 'win32',
      async runRegistry(args) {
        calls.push([...args])
        return args.includes('/reg:64')
          ? '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Game\r\n    InstallPath    REG_SZ    C:\\Games\\Game\r\n'
          : '    Version    REG_SZ    1.2\r\n'
      },
    })
    expect(
      await probes.registryValues('HKLM', 'SOFTWARE\\Game', ['InstallPath', 'Version']),
    ).toEqual({
      InstallPath: 'C:\\Games\\Game',
      Version: '1.2',
    })
    expect(await probes.registryValues('HKLM', 'SOFTWARE\\Game" & calc', ['x'])).toEqual({})
    expect(calls).toHaveLength(2)
    expect(
      await createNodeInstallationProbes({ platform: 'linux' }).registryValues(
        'HKLM',
        'SOFTWARE\\Game',
        ['x'],
      ),
    ).toEqual({})
  })

  it('parses Valve key-values and reg query output', () => {
    expect(valveValues('"path"\t"C:\\\\Steam"\n"Path" "D:\\\\Lib"', 'path')).toEqual([
      'C:\\Steam',
      'D:\\Lib',
    ])
    expect(registryLines('    Name    REG_EXPAND_SZ    %ProgramFiles%\\X\n')).toEqual({
      Name: '%ProgramFiles%\\X',
    })
    expect(
      registryLines('    Flags    REG_BINARY    01000000FF\n    Empty    REG_BINARY\n'),
    ).toEqual({
      Flags: '01000000ff',
      Empty: '',
    })
  })

  it('finds Documents through the shell folder, ProgramData through the environment', async () => {
    const probes = createNodeInstallationProbes({
      platform: 'win32',
      environment: { USERPROFILE: 'C:/Users/Tester', ProgramData: 'C:/ProgramData' },
      async runRegistry(args) {
        return args.includes('/reg:64')
          ? '    Personal    REG_EXPAND_SZ    %USERPROFILE%/OneDrive/Documents\r\n'
          : ''
      },
    })
    expect(await probes.knownFolder('documents')).toBe('C:/Users/Tester/OneDrive/Documents')
    expect(await probes.knownFolder('program-data')).toBe('C:/ProgramData')
    const appData = createNodeInstallationProbes({
      platform: 'win32',
      environment: {
        APPDATA: 'C:/Users/Tester/AppData/Roaming',
        LOCALAPPDATA: 'C:/Users/Tester/AppData/Local',
        USERPROFILE: 'C:/Users/Tester',
      },
    })
    expect(await appData.knownFolder('roaming-app-data')).toBe('C:/Users/Tester/AppData/Roaming')
    expect(await appData.knownFolder('local-app-data')).toBe('C:/Users/Tester/AppData/Local')
    expect(await appData.knownFolder('home')).toBe('C:/Users/Tester')
    expect(
      await createNodeInstallationProbes({ platform: 'linux' }).knownFolder('program-data'),
    ).toBeUndefined()
  })
})
