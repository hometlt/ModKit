/**
 * The one implementation of `InstallationProbes` for a desktop host: registry reads through
 * `reg.exe`, Steam libraries and app manifests, Epic Games Launcher manifests, GOG's registry keys and
 * Microsoft Store packages. Read-only; every probe answers `undefined` (or `{}`) when the platform,
 * the store or the product is absent, and never throws for a missing install.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { InstallationProbes, KnownFolder, RegistryHive } from '@modkit/sdk'

const execFileAsync = promisify(execFile)
const MAX_TEXT_BYTES = 4 * 1024 * 1024
const SAFE_KEY = /^[\w .()&'+,\\-]{1,512}$/u
const SAFE_NAME = /^[\w .()-]{0,256}$/u

export interface NodeInstallationProbeOptions {
  /** Steam installation roots to search instead of the platform defaults (tests). */
  readonly steamRoots?: readonly string[]
  /** Epic Games Launcher manifest folders instead of the platform defaults (tests). */
  readonly epicManifestDirs?: readonly string[]
  /** Runs `reg.exe`; replaceable so a test need not touch the machine's registry. */
  readonly runRegistry?: (args: readonly string[], signal?: AbortSignal) => Promise<string>
  /** Runs a PowerShell command for Store packages; replaceable for tests. */
  readonly runPowerShell?: (command: string, signal?: AbortSignal) => Promise<string>
  readonly platform?: NodeJS.Platform
  /** Environment for `%VAR%` expansion and ProgramData; replaceable for tests. */
  readonly environment?: Readonly<Record<string, string | undefined>>
}

async function readText(path: string): Promise<string | undefined> {
  try {
    if ((await stat(path)).size > MAX_TEXT_BYTES) return undefined
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/** The quoted `"key" "value"` pairs of a Valve KeyValues (VDF/ACF) text whose key is `key`. */
export function valveValues(text: string, key: string): readonly string[] {
  const values: string[] = []
  const pattern = /"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)"/gu
  for (const match of text.matchAll(pattern)) {
    if (match[1]?.toLowerCase() === key.toLowerCase() && match[2] !== undefined) {
      values.push(match[2].replace(/\\\\/gu, '\\').replace(/\\"/gu, '"'))
    }
  }
  return values
}

/** `Name    REG_SZ    Value` lines of `reg query` output. */
export function registryLines(output: string): Readonly<Record<string, string>> {
  const values: Record<string, string> = {}
  for (const line of output.split(/\r?\n/u)) {
    const match = /^\s{2,}(.+?)\s{2,}REG_(SZ|EXPAND_SZ|DWORD|QWORD|BINARY)(?:\s{2,}(.*))?$/u.exec(
      line,
    )
    if (match?.[1] === undefined || match[2] === undefined) continue
    const value = (match[3] ?? '').trim()
    values[match[1]] = match[2] === 'BINARY' ? value.toLowerCase() : value
  }
  return values
}

export function createNodeInstallationProbes(
  options: NodeInstallationProbeOptions = {},
): InstallationProbes {
  const platform = options.platform ?? process.platform
  const runRegistry =
    options.runRegistry ??
    (async (args: readonly string[], signal?: AbortSignal) =>
      (
        await execFileAsync('reg.exe', [...args], {
          windowsHide: true,
          timeout: 10_000,
          ...(signal ? { signal } : {}),
        })
      ).stdout)
  const runPowerShell =
    options.runPowerShell ??
    (async (command: string, signal?: AbortSignal) =>
      (
        await execFileAsync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', command],
          {
            windowsHide: true,
            timeout: 15_000,
            ...(signal ? { signal } : {}),
          },
        )
      ).stdout)

  const registryValues = async (
    hive: RegistryHive,
    key: string,
    names: readonly string[],
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, string>>> => {
    if (platform !== 'win32' || (hive !== 'HKLM' && hive !== 'HKCU') || !SAFE_KEY.test(key))
      return {}
    if (!names.every(name => SAFE_NAME.test(name))) return {}
    const found: Record<string, string> = {}
    // The 64-bit view first, then the 32-bit one (WOW6432Node) for what it lacks.
    for (const view of ['/reg:64', '/reg:32']) {
      let values: Readonly<Record<string, string>>
      try {
        values = registryLines(await runRegistry(['query', `${hive}\\${key}`, view], signal))
      } catch {
        continue
      }
      for (const name of names)
        if (found[name] === undefined && values[name] !== undefined) found[name] = values[name]
    }
    return Object.freeze(found)
  }

  const steamRoots = async (signal?: AbortSignal): Promise<readonly string[]> => {
    if (options.steamRoots !== undefined) return options.steamRoots
    if (platform === 'win32') {
      const user = await registryValues('HKCU', 'Software\\Valve\\Steam', ['SteamPath'], signal)
      const machine = await registryValues(
        'HKLM',
        'SOFTWARE\\Valve\\Steam',
        ['InstallPath'],
        signal,
      )
      return [user['SteamPath'], machine['InstallPath']].filter(
        (root): root is string => root !== undefined,
      )
    }
    const home = homedir()
    return platform === 'darwin'
      ? [join(home, 'Library', 'Application Support', 'Steam')]
      : [join(home, '.steam', 'steam'), join(home, '.local', 'share', 'Steam')]
  }

  return Object.freeze({
    registryValues,

    async steamAppDir(appId: number, signal?: AbortSignal) {
      if (!Number.isSafeInteger(appId) || appId <= 0) return undefined
      for (const root of await steamRoots(signal)) {
        const folders = await readText(join(root, 'steamapps', 'libraryfolders.vdf'))
        const libraries = [root, ...(folders === undefined ? [] : valveValues(folders, 'path'))]
        for (const library of [...new Set(libraries)]) {
          const manifest = await readText(join(library, 'steamapps', `appmanifest_${appId}.acf`))
          const installDir =
            manifest === undefined ? undefined : valveValues(manifest, 'installdir')[0]
          if (installDir === undefined || /[\\/]|\.\./u.test(installDir)) continue
          const path = join(library, 'steamapps', 'common', installDir)
          if (existsSync(path)) return path
        }
      }
      return undefined
    },

    async epicInstallLocation(appName: string, signal?: AbortSignal) {
      const dirs =
        options.epicManifestDirs ??
        (platform === 'win32'
          ? [
              join(
                process.env['ProgramData'] ?? 'C:\\ProgramData',
                'Epic',
                'EpicGamesLauncher',
                'Data',
                'Manifests',
              ),
            ]
          : platform === 'darwin'
            ? [
                join(
                  homedir(),
                  'Library',
                  'Application Support',
                  'Epic',
                  'EpicGamesLauncher',
                  'Data',
                  'Manifests',
                ),
              ]
            : [])
      for (const dir of dirs) {
        let names: string[]
        try {
          names = await readdir(dir)
        } catch {
          continue
        }
        for (const name of names.filter(item => item.toLowerCase().endsWith('.item'))) {
          signal?.throwIfAborted()
          const text = await readText(join(dir, name))
          if (text === undefined) continue
          try {
            const item = JSON.parse(text) as { AppName?: unknown; InstallLocation?: unknown }
            if (item.AppName === appName && typeof item.InstallLocation === 'string')
              return item.InstallLocation
          } catch {
            continue
          }
        }
      }
      return undefined
    },

    async gogInstallPath(productId: string, signal?: AbortSignal) {
      if (!/^\d{1,20}$/u.test(productId)) return undefined
      const values = await registryValues(
        'HKLM',
        `SOFTWARE\\GOG.com\\Games\\${productId}`,
        ['path'],
        signal,
      )
      return values['path']
    },

    async knownFolder(folder: KnownFolder, signal?: AbortSignal) {
      if (folder === 'program-data') {
        return platform === 'win32'
          ? (options.environment ?? process.env)['ProgramData']
          : undefined
      }
      if (platform !== 'win32') return join(homedir(), 'Documents')
      // The shell's own answer, which follows a Documents folder the user moved (to OneDrive, to D:).
      const shell = 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders'
      const personal = (await registryValues('HKCU', shell, ['Personal'], signal))['Personal']
      const environment = options.environment ?? process.env
      const expanded = personal?.replace(
        /%([^%]+)%/gu,
        (whole, name: string) => environment[name] ?? whole,
      )
      return expanded !== undefined && !expanded.includes('%')
        ? expanded
        : join(homedir(), 'Documents')
    },

    async storePackageLocation(familyName: string, signal?: AbortSignal) {
      if (platform !== 'win32' || !/^[\w.-]{1,128}$/u.test(familyName)) return undefined
      const name = familyName.split('_')[0]
      try {
        const output = await runPowerShell(
          `(Get-AppxPackage -Name '${name}' | Select-Object -First 1).InstallLocation`,
          signal,
        )
        const location = output.trim()
        return location === '' ? undefined : location
      } catch {
        return undefined
      }
    },
  })
}
