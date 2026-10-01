/**
 * What the VS Code launch surface needs beyond the host's launch workflow: which package a path
 * launches, the options a launch configuration carries, and where a game log's findings go.
 * Kept free of the `vscode` API so it is testable in Node.
 */
import { basename, dirname } from 'node:path'
import type { JsonValue } from '@modkit/sdk'
import type {
  GameLaunchLogDiagnostic,
  GameLaunchOptionSchema,
  GameLaunchResource,
} from '@modkit/sdk/games'

export const VSCODE_GAME_LAUNCH_MOD_COMMAND = 'modkit.game.launchActiveMod'
export const VSCODE_GAME_LAUNCH_DEBUG_TYPE = 'modkit-launch'
export type GameLaunchKind = GameLaunchResource['kind']

/**
 * Launchable package folders and archives by name. ponytail: StarCraft II's are the only
 * launchable packages today; a second game should declare its own on its launch provider offer.
 */
const PACKAGE_KINDS: readonly (readonly [RegExp, GameLaunchKind])[] = [
  [/\.(sc2map|s2ma)$/iu, 'map'],
  [/\.(sc2mod|s2mod)$/iu, 'mod'],
]

const kindOf = (name: string): GameLaunchKind | undefined =>
  PACKAGE_KINDS.find(([pattern]) => pattern.test(name))?.[1]

/**
 * The package a path launches: itself, or the nearest enclosing map or mod (a trigger script, a
 * data file inside one). With `kind`, only a package of that kind.
 */
export function launchTargetOf(path: string, kind?: GameLaunchKind): GameLaunchResource | undefined {
  for (let current = path; ; current = dirname(current)) {
    const found = kindOf(basename(current))
    if (found !== undefined && (kind === undefined || found === kind)) {
      return Object.freeze({ kind: found, path: current })
    }
    if (dirname(current) === current) return undefined
  }
}

/** A `modkit-launch` launch configuration: the package, its kind, and the game's options. */
export interface GameLaunchConfiguration {
  readonly resource?: string
  readonly kind?: GameLaunchKind
  readonly options: Readonly<Record<string, JsonValue>>
}

export function gameLaunchConfiguration(value: Readonly<Record<string, unknown>>): GameLaunchConfiguration {
  const options = value['options']
  return Object.freeze({
    ...(typeof value['resource'] === 'string' && value['resource'].trim() !== ''
      ? { resource: value['resource'].trim() }
      : {}),
    ...(value['kind'] === 'map' || value['kind'] === 'mod' ? { kind: value['kind'] } : {}),
    options:
      options !== null && typeof options === 'object' && !Array.isArray(options)
        ? (options as Readonly<Record<string, JsonValue>>)
        : {},
  })
}

/**
 * A `modkit-launch` configuration with the options its game's launch-plan offer declares, each at
 * its default (plan 8.8): written by «Configure Game Launch», so the options of any game reach
 * `launch.json` without the app knowing them. An option without a default is left for the user.
 */
export function gameLaunchConfigurationFor(
  name: string,
  options: Readonly<Record<string, GameLaunchOptionSchema>>,
): Readonly<Record<string, JsonValue>> {
  const values: Record<string, JsonValue> = {}
  for (const key of Object.keys(options).sort()) {
    const value = options[key]?.default
    if (value !== undefined) values[key] = value
  }
  return {
    type: VSCODE_GAME_LAUNCH_DEBUG_TYPE,
    request: 'launch',
    name,
    kind: 'map',
    options: values,
  }
}

/** A log's findings by file; findings that name no file go to the launched package. */
export function gameLogFindingsByFile(
  diagnostics: readonly GameLaunchLogDiagnostic[],
  fallbackPath: string,
): ReadonlyMap<string, readonly GameLaunchLogDiagnostic[]> {
  const byFile = new Map<string, GameLaunchLogDiagnostic[]>()
  for (const item of diagnostics) {
    const path = item.path ?? fallbackPath
    const list = byFile.get(path) ?? []
    list.push(item)
    byFile.set(path, list)
  }
  return byFile
}
