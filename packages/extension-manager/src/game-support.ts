import { ExtensionManagerError } from './schema.js'
import type {
  ExtensionManagerEntry,
  ExtensionManagerSnapshot,
  GameSupportAction,
  GameSupportPlan,
} from './public-types.js'

const COORDINATE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\/[a-z0-9]+(?:[.-][a-z0-9]+)*$/u
const ACTION_ORDER = Object.freeze({ install: 0, enable: 1, update: 2 })

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(
  code: string,
  message: string,
  context: Readonly<Record<string, unknown>> = {},
): never {
  throw new ExtensionManagerError(code, message, context)
}

function deepFreeze<T>(value: T): T {
  if (!record(value) && !Array.isArray(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function gamesOf(entry: ExtensionManagerEntry) {
  return Array.isArray(entry.presentation?.games) ? entry.presentation.games : []
}

function actionCompare(left: GameSupportAction, right: GameSupportAction): number {
  return (
    ACTION_ORDER[left.kind] - ACTION_ORDER[right.kind] ||
    left.packageId.localeCompare(right.packageId)
  )
}

/**
 * Build an inert, deterministic support plan from a manager snapshot.
 *
 * The core does not know game names or package ids. A package participates only when its validated
 * `presentation.games` metadata declares the requested game coordinate.
 */
export function createGameSupportPlan(snapshot: unknown, gameId: string): GameSupportPlan {
  if (!record(snapshot) || !Array.isArray(snapshot['entries'])) {
    fail('extension-manager/snapshot-invalid', 'snapshot must contain an entries array')
  }
  if (typeof gameId !== 'string' || !COORDINATE.test(gameId)) {
    fail('extension-manager/game-id-invalid', 'gameId must be a publisher/id coordinate', {
      gameId,
    })
  }

  const matches = (snapshot['entries'] as ExtensionManagerSnapshot['entries'])
    .filter(entry => gamesOf(entry).some(game => game.id === gameId))
    .sort((left, right) => left.id.localeCompare(right.id))
  if (matches.length === 0) {
    fail(
      'extension-manager/game-support-missing',
      `no catalog package declares support for game «${gameId}»`,
      { gameId },
    )
  }

  const displayNames = matches
    .flatMap(entry => gamesOf(entry).filter(game => game.id === gameId))
    .map(game => game.displayName)
    .sort((left, right) => left.localeCompare(right))
  const targets = matches.map(entry =>
    Object.freeze({
      packageId: entry.id,
      displayName: entry.displayName,
      availableVersion: entry.availableVersion,
      ...(entry.installedVersion === undefined ? {} : { installedVersion: entry.installedVersion }),
      enabled: entry.enabled,
      updateAvailable: entry.updateAvailable,
      trusted: entry.trusted,
      desiredEnabled: true,
    }),
  )
  const actions: GameSupportAction[] = []
  for (const entry of matches) {
    if (entry.installedVersion === undefined) {
      actions.push(
        Object.freeze({
          kind: 'install',
          packageId: entry.id,
          version: entry.availableVersion,
          reversible: true,
        }),
      )
      continue
    }
    if (!entry.enabled) {
      actions.push(Object.freeze({ kind: 'enable', packageId: entry.id, reversible: true }))
    }
    if (entry.updateAvailable) {
      actions.push(
        Object.freeze({
          kind: 'update',
          packageId: entry.id,
          fromVersion: entry.installedVersion,
          toVersion: entry.availableVersion,
          reversible: false,
        }),
      )
    }
  }
  actions.sort(actionCompare)
  const blocked = actions
    .filter(action => action.kind !== 'enable')
    .filter(action => matches.find(entry => entry.id === action.packageId)?.trusted !== true)
    .map(action =>
      Object.freeze({
        packageId: action.packageId,
        code: 'extension-manager/artifact-untrusted',
        message: 'The package artifact is not trusted for installation or update.',
      }),
    )

  return deepFreeze({
    schemaVersion: 1,
    game: { id: gameId, displayName: displayNames[0] ?? gameId },
    targets,
    actions,
    blocked,
    ready: blocked.length === 0,
  })
}

/** Exact comparison used to reject stale or user-edited plans before any mutation. */
export function gameSupportPlansEqual(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}
