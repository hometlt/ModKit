const CONTRACT = 'common.game/launch-plan'
const GAME_ID = 'org.modkitx/starcraft-2'
const PLANNER_ID = 'org.modkitx.blizzard/starcraft2-native-map-launch'
const PLAN_ID = 'org.modkitx.blizzard/starcraft2-native-map-defaults-v1'

const nonEmpty = value => typeof value === 'string' && value.trim().length > 0

/** Pure, deterministic projection of the sealed MK2 SC2Switcher launch defaults. */
export async function createStarcraft2MapLaunchPlan(request) {
  request.signal?.throwIfAborted()
  if (request.gameId !== GAME_ID || request.installation?.gameId !== GAME_ID) {
    throw new TypeError(`StarCraft II launch planning cannot handle ${String(request.gameId)}`)
  }
  if (!nonEmpty(request.installation.normalizedPath) || !nonEmpty(request.resource?.path)) {
    throw new TypeError('StarCraft II launch planning requires an installation root and map path')
  }
  if (request.resource.kind !== 'map') {
    throw new TypeError(
      `StarCraft II launch planning cannot handle ${String(request.resource.kind)}`,
    )
  }
  const mapPath = request.resource.path.trim()
  return Object.freeze({
    schemaVersion: 1,
    planId: PLAN_ID,
    gameId: GAME_ID,
    installationRoot: request.installation.normalizedPath,
    resource: Object.freeze({ kind: 'map', path: mapPath }),
    executableRelativePath: 'Support64/SC2Switcher_x64.exe',
    workingDirectoryRelativePath: '.',
    arguments: Object.freeze([
      '-run',
      mapPath,
      '-preload',
      '1',
      '-NoUserCheats',
      '-meleeMod',
      'Void',
      '-difficulty',
      '2',
      '-speed',
      '2',
      '-displaymode',
      '1',
    ]),
    resourceArgumentIndex: 1,
    mode: 'detached',
    stdio: 'ignore',
  })
}

export const abiVersion = 1
export const provides = Object.freeze([CONTRACT])

export function createProvider(selection) {
  if (selection.contract !== CONTRACT || selection.major !== 1) {
    throw new TypeError(
      `unsupported game-launch selection ${selection.contract}@${selection.major}`,
    )
  }
  return Object.freeze({
    value: Object.freeze({
      contract: CONTRACT,
      plannerId: PLANNER_ID,
      gameIds: Object.freeze([GAME_ID]),
      plan: createStarcraft2MapLaunchPlan,
    }),
    release: async () => undefined,
  })
}
