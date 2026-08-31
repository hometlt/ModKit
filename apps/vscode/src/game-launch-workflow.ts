/** Generic explicit-consent seam for native game launch from the VS Code adapter. */

import type { PermissionGrant } from '@modkit/sdk'
import type { GameInstallation, GameLaunchResource } from '@modkit/sdk/games'
import type { UiLocalizer } from '@modkit/ui/localization'

import { createVscodeLocalizer } from './localization.js'

export const VSCODE_GAME_LAUNCH_COMMAND = 'modkit.game.launchActiveMap'
export const VSCODE_GAME_LAUNCH_GRANT_TTL_MS = 60_000

export interface ExplicitGameLaunchInput {
  readonly grantId: string
  readonly installation: GameInstallation
  readonly resourcePath: string
}

export interface ExplicitGameLaunchRequest {
  readonly gameId: string
  readonly installation: GameInstallation
  readonly resource: GameLaunchResource
  readonly grant: PermissionGrant
}

export interface ExplicitGameLaunchConfirmation {
  readonly title: string
  readonly detail: string
  readonly action: string
}

export interface ExplicitGameLaunchPorts<Result> {
  readonly confirm: (request: ExplicitGameLaunchConfirmation) => Promise<boolean>
  readonly execute: (request: ExplicitGameLaunchRequest) => Promise<Result>
  readonly now?: () => number
  readonly localizer?: UiLocalizer
}

export type ExplicitGameLaunchResult<Result> =
  | Readonly<{ readonly state: 'cancelled' }>
  | Readonly<{ readonly state: 'executed'; readonly result: Result }>

/**
 * Create a short-lived process grant only after the user confirms this exact game and map.
 * Planning, path validation and spawning remain in the shared host and game provider.
 */
export async function runExplicitGameLaunch<Result>(
  input: ExplicitGameLaunchInput,
  ports: ExplicitGameLaunchPorts<Result>,
): Promise<ExplicitGameLaunchResult<Result>> {
  const resourcePath = input.resourcePath.trim()
  const localizer = ports.localizer ?? createVscodeLocalizer('en')
  if (resourcePath.length === 0)
    throw new TypeError('game launch requires a non-empty resource path')
  if (
    input.installation.gameId.trim().length === 0 ||
    input.installation.normalizedPath.trim().length === 0
  ) {
    throw new TypeError('game launch requires a named confirmed installation')
  }
  const confirmed = await ports.confirm({
    title: localizer.text('vscode.game.launchTitle', { game: input.installation.displayName }),
    detail: localizer.text('vscode.game.launchDetail', {
      map: resourcePath,
      installation: input.installation.installPath,
    }),
    action: localizer.text('vscode.game.launchAction'),
  })
  if (!confirmed) return Object.freeze({ state: 'cancelled' as const })

  const now = (ports.now ?? Date.now)()
  if (!Number.isFinite(now)) throw new TypeError('game launch clock must be finite')
  const grant: PermissionGrant = Object.freeze({
    id: input.grantId,
    classes: Object.freeze(['process-launch'] as const),
    subjectScope: Object.freeze([resourcePath]),
    expiresAt: new Date(now + VSCODE_GAME_LAUNCH_GRANT_TTL_MS).toISOString(),
  })
  const result = await ports.execute({
    gameId: input.installation.gameId,
    installation: input.installation,
    resource: Object.freeze({ kind: 'map', path: resourcePath }),
    grant,
  })
  return Object.freeze({ state: 'executed' as const, result })
}
