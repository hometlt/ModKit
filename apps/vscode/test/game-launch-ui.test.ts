import { describe, expect, it } from 'vitest'
import {
  gameLaunchConfiguration,
  gameLogFindingsByFile,
  launchTargetOf,
} from '../src/game-launch-ui.js'

describe('the VS Code launch surface', () => {
  it('launches the package a path is in, of the kind asked for', () => {
    expect(launchTargetOf('C:/Maps/Arena.SC2Map/Base.SC2Data/GameData/UnitData.xml')).toEqual({
      kind: 'map',
      path: 'C:/Maps/Arena.SC2Map',
    })
    expect(launchTargetOf('C:/Mods/Mine.SC2Mod/Triggers', 'mod')).toEqual({ kind: 'mod', path: 'C:/Mods/Mine.SC2Mod' })
    expect(launchTargetOf('C:/Maps/Packed.s2ma')).toEqual({ kind: 'map', path: 'C:/Maps/Packed.s2ma' })
    expect(launchTargetOf('C:/Mods/Mine.SC2Mod/Triggers', 'map')).toBeUndefined()
    expect(launchTargetOf('C:/Scripts/loose.galaxy')).toBeUndefined()
  })

  it('reads a launch configuration and ignores what it does not know', () => {
    expect(
      gameLaunchConfiguration({ type: 'modkit-launch', resource: ' C:/Mods/Mine.SC2Mod ', kind: 'mod', options: { map: 'C:/Maps/A.SC2Map' } }),
    ).toEqual({ resource: 'C:/Mods/Mine.SC2Mod', kind: 'mod', options: { map: 'C:/Maps/A.SC2Map' } })
    expect(gameLaunchConfiguration({ kind: 'campaign', options: [1] })).toEqual({ options: {} })
  })

  it('files log findings under their source file, the rest under the launched package', () => {
    const findings = gameLogFindingsByFile(
      [
        { severity: 'error', code: 'a', message: 'one', path: 'C:/Maps/A.SC2Map/MapScript.galaxy', line: 3 },
        { severity: 'error', code: 'b', message: 'two' },
        { severity: 'error', code: 'c', message: 'three', path: 'C:/Maps/A.SC2Map/MapScript.galaxy' },
      ],
      'C:/Maps/A.SC2Map',
    )
    expect([...findings].map(([path, items]) => [path, items.map(item => item.code)])).toEqual([
      ['C:/Maps/A.SC2Map/MapScript.galaxy', ['a', 'c']],
      ['C:/Maps/A.SC2Map', ['b']],
    ])
  })
})
