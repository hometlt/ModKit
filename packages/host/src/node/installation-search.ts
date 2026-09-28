/**
 * The host's folder search for installed games (owner decision 2026-09-28): the common install
 * folders of every local drive, plus the store and publisher folders games declare, walked two
 * levels deep (`Games\StarCraft II`, `Games\Blizzard\StarCraft II`). Each folder is read once and
 * compared with the markers of every game; a match is only a candidate (`search-folder`) that the
 * game's provider still confirms. Network drives are searched only when the user names a folder.
 */
import { execFile } from 'node:child_process'
import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { GameInstallationMarker } from '@modkit/sdk/games'
import { registryLines } from './installation-probes.js'

const execFileAsync = promisify(execFile)

/** Folders at every local drive root that installers commonly use. */
const COMMON_FOLDERS = ['Program Files', 'Program Files (x86)', 'Games', 'Apps', 'Applications']
const DEPTH = 2

export interface InstallationFolderSearchOptions {
  /** What each game's installation folder holds (`gameInstallationSearchOf(inventory).markers`). */
  readonly markers: readonly GameInstallationMarker[]
  /** Store and publisher folders games name, searched at every local drive root. */
  readonly searchFolders?: readonly string[]
  /** Folders the user added (a network share among them), searched as they are. */
  readonly folders?: readonly string[]
  /** Folders one search reads at most; beyond it the answer says it is incomplete. */
  readonly maxFolders?: number
  /** Found folders kept per game. */
  readonly maxPerGame?: number
  readonly platform?: NodeJS.Platform
  readonly environment?: Readonly<Record<string, string | undefined>>
  /** Local drive roots instead of asking the system (tests). */
  readonly drives?: readonly string[]
  /** Runs `reg.exe`; replaceable so a test need not touch the machine's registry. */
  readonly runRegistry?: (args: readonly string[], signal?: AbortSignal) => Promise<string>
  readonly signal?: AbortSignal
}

export interface InstallationFolderSearch {
  /** Per game id, the folders shaped like its installation, in walk order. */
  readonly found: Readonly<Record<string, readonly string[]>>
  /** False when `maxFolders` stopped the walk. */
  readonly complete: boolean
}

/** Local drive roots: the volumes Windows mounts itself (`\DosDevices\C:`), never a mapped share. */
async function localDrives(options: InstallationFolderSearchOptions): Promise<readonly string[]> {
  if (options.drives !== undefined) return options.drives
  const run =
    options.runRegistry ??
    (async (args: readonly string[], signal?: AbortSignal) =>
      (
        await execFileAsync('reg.exe', [...args], {
          windowsHide: true,
          timeout: 10_000,
          ...(signal ? { signal } : {}),
        })
      ).stdout)
  try {
    const names = Object.keys(
      registryLines(await run(['query', 'HKLM\\SYSTEM\\MountedDevices'], options.signal)),
    )
    const letters = names.flatMap(name => {
      const match = /^\\DosDevices\\([A-Z]):$/iu.exec(name)
      return match?.[1] === undefined ? [] : [`${match[1].toUpperCase()}:\\`]
    })
    if (letters.length > 0) return [...new Set(letters)].sort()
  } catch {
    // no registry answer: the system drive alone
  }
  const system = options.environment?.['SystemDrive'] ?? process.env['SystemDrive'] ?? 'C:'
  return [`${system.replace(/[\\/]+$/u, '')}\\`]
}

async function searchRoots(options: InstallationFolderSearchOptions): Promise<readonly string[]> {
  const platform = options.platform ?? process.platform
  const environment = options.environment ?? process.env
  const roots: string[] = []
  if (platform === 'win32') {
    const names = [...COMMON_FOLDERS, ...(options.searchFolders ?? [])]
    for (const drive of await localDrives(options))
      for (const name of names) roots.push(join(drive, name))
    const local = environment['LOCALAPPDATA']
    if (local !== undefined && local !== '') roots.push(join(local, 'Programs'))
  } else {
    const home = environment['HOME'] ?? homedir()
    roots.push(
      join(home, 'Games'),
      ...(platform === 'darwin' ? ['/Applications', join(home, 'Applications')] : []),
    )
  }
  roots.push(...(options.folders ?? []))
  const seen = new Set<string>()
  return roots.filter(root => {
    const key = platform === 'win32' ? root.toLowerCase() : root
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Walk the search folders two levels deep and name, per game, the folders that hold every file of
 * one of its markers. A folder that cannot be read is skipped; a matched folder is not descended.
 */
export async function searchInstallationFolders(
  options: InstallationFolderSearchOptions,
): Promise<InstallationFolderSearch> {
  const maxFolders = options.maxFolders ?? 20_000
  const maxPerGame = options.maxPerGame ?? 16
  const markers = options.markers
    .filter(marker => marker.files.length > 0)
    .map(marker => ({ gameId: marker.gameId, files: marker.files.map(file => file.toLowerCase()) }))
  const found = new Map<string, string[]>()
  let read = 0
  let complete = true
  const visit = async (folder: string, depth: number): Promise<void> => {
    options.signal?.throwIfAborted()
    if (read >= maxFolders) {
      complete = false
      return
    }
    read += 1
    let entries: Dirent[]
    try {
      entries = await readdir(folder, { withFileTypes: true })
    } catch {
      return
    }
    const names = new Set(entries.map(entry => entry.name.toLowerCase()))
    let matched = false
    for (const marker of markers) {
      if (!marker.files.every(file => names.has(file))) continue
      matched = true
      const list = found.get(marker.gameId) ?? []
      if (list.length < maxPerGame && !list.includes(folder)) list.push(folder)
      found.set(marker.gameId, list)
    }
    if (matched || depth >= DEPTH) return
    // ponytail: one folder at a time; parallel reads if a search of many drives proves slow
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink())
        await visit(join(folder, entry.name), depth + 1)
    }
  }
  // a root is the search folder itself: it is read, not matched (an install sits inside it)
  for (const root of await searchRoots(options)) {
    options.signal?.throwIfAborted()
    let entries: Dirent[]
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    read += 1
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) await visit(join(root, entry.name), 1)
    }
  }
  return Object.freeze({
    found: Object.freeze(
      Object.fromEntries([...found].map(([id, list]) => [id, Object.freeze(list)])),
    ),
    complete,
  })
}
