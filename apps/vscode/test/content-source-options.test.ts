import { describe, expect, it } from 'vitest'
import {
  contentSourceOptionsFor,
  expandOptionTokens,
  mergeOptions,
} from '../src/content-source-options.js'

const tokens = {
  workspaceFolders: [
    { name: 'mod', path: 'C:/work/mod' },
    { name: 'shared', path: 'C:/work/shared' },
  ],
  env: { SC2_ROOT: 'F:/GAMES/StarCraft II', EMPTY: '' },
  userHome: 'C:/Users/me',
}

describe('content source options in settings', () => {
  it('merge objects by key, chain lists and let the later scope win a value', () => {
    expect(
      mergeOptions(
        { installationDirectory: 'A', sources: [{ path: 'one' }], nested: { a: 1, b: 2 } },
        { installationDirectory: 'B', sources: [{ path: 'two' }], nested: { b: 3 } },
      ),
    ).toEqual({
      installationDirectory: 'B',
      sources: [{ path: 'one' }, { path: 'two' }],
      nested: { a: 1, b: 3 },
    })
  })

  it('expand path tokens and leave out a value whose token names nothing', () => {
    expect(
      expandOptionTokens(
        {
          installationDirectory: '${env:SC2_ROOT}',
          documentsDirectory: '${userHome}/Documents/StarCraft II',
          wizardDirectories: ['${workspaceFolder}/Wizards', '${workspaceFolder:shared}/Wizards'],
          missing: '${env:NOT_SET}/x',
          empty: '${env:EMPTY}',
          unknown: '${workspaceFolder:nope}',
          locale: 'ruRU',
        },
        tokens,
      ),
    ).toEqual({
      installationDirectory: 'F:/GAMES/StarCraft II',
      documentsDirectory: 'C:/Users/me/Documents/StarCraft II',
      wizardDirectories: ['C:/work/mod/Wizards', 'C:/work/shared/Wizards'],
      locale: 'ruRU',
    })
    // a list entry resting on a missing folder drops out, the rest stays
    expect(expandOptionTokens(['${workspaceFolder}/a', '${env:NOT_SET}'], tokens)).toEqual([
      'C:/work/mod/a',
    ])
    expect(
      expandOptionTokens('${workspaceFolder}', { ...tokens, workspaceFolders: [] }),
    ).toBeUndefined()
  })

  it('give one extension its options from every scope, the workspace adding to the user', () => {
    const scoped = {
      globalValue: {
        'blizzard/starcraft2': { installationDirectory: 'C:/Games/SC2', sources: ['user'] },
        'wz2100project/warzone-2100': { locale: 'en' },
      },
      workspaceValue: {
        'blizzard/starcraft2': {
          installationDirectory: '${env:SC2_ROOT}',
          sources: ['${workspaceFolder}/Mods'],
        },
      },
    }
    expect(contentSourceOptionsFor(scoped, 'blizzard/starcraft2', tokens)).toEqual({
      installationDirectory: 'F:/GAMES/StarCraft II',
      sources: ['user', 'C:/work/mod/Mods'],
    })
    expect(contentSourceOptionsFor(scoped, 'wz2100project/warzone-2100', tokens)).toEqual({
      locale: 'en',
    })
    expect(contentSourceOptionsFor(scoped, 'roblox/roblox', tokens)).toBeUndefined()
    expect(contentSourceOptionsFor({ globalValue: 'not an object' }, 'x/y', tokens)).toBeUndefined()
  })
})
