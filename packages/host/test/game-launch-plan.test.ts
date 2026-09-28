import { describe, expect, it } from 'vitest'
import { validGameLaunchPlan } from '../src/games/index.js'

const request = {
  gameId: 'ea/emperor',
  installation: { normalizedPath: 'C:/Games/Emperor' },
  resource: { kind: 'map', path: 'C:/Maps/#M61 Isles/test.xbf' },
} as never
const plan = (arguments_: string[], resourceArgumentIndex: number | null) => ({
  schemaVersion: 1,
  planId: 'emperor',
  gameId: 'ea/emperor',
  installationRoot: 'C:/Games/Emperor',
  resource: { kind: 'map', path: 'C:/Maps/#M61 Isles/test.xbf' },
  executableRelativePath: 'Game.exe',
  workingDirectoryRelativePath: '.',
  arguments: arguments_,
  resourceArgumentIndex,
  mode: 'detached',
  stdio: 'ignore',
})

describe('game launch plan', () => {
  it('passes the resource at its index, or no resource at all', () => {
    expect(validGameLaunchPlan(plan(['-map', 'C:/Maps/#M61 Isles/test.xbf'], 1), request)).toBe(
      true,
    )
    expect(validGameLaunchPlan(plan([], null), request)).toBe(true)
    // the path hidden in the arguments without an index is a substitution the host refuses
    expect(validGameLaunchPlan(plan(['C:/Maps/#M61 Isles/test.xbf'], null), request)).toBe(false)
    expect(validGameLaunchPlan(plan(['-map', 'other.xbf'], 1), request)).toBe(false)
  })
})
