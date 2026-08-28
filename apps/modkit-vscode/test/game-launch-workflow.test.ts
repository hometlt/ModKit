import { describe, expect, it } from 'vitest'

import {
  runExplicitGameLaunch,
  VSCODE_GAME_LAUNCH_GRANT_TTL_MS,
} from '../src/game-launch-workflow.js'

const installation = Object.freeze({
  gameId: 'org.modkitx/starcraft-2',
  displayName: 'StarCraft II',
  installPath: 'C:/Games/StarCraft II',
  normalizedPath: 'C:/Games/StarCraft II',
  origins: Object.freeze(['configured-path'] as const),
  evidence: Object.freeze([
    Object.freeze({ kind: 'confirmed-fixture', path: 'C:/Games/StarCraft II', found: true }),
  ]),
})

describe('explicit VS Code native game launch workflow', () => {
  it('does not issue a process grant or execute when the user cancels', async () => {
    let executed = false
    const result = await runExplicitGameLaunch(
      { grantId: 'cancelled-launch', installation, resourcePath: 'C:/Maps/Fixture.SC2Map' },
      {
        confirm: async () => false,
        execute: async () => {
          executed = true
        },
      },
    )
    expect(result).toEqual({ state: 'cancelled' })
    expect(executed).toBe(false)
  })

  it('executes once with an exact-map, short-lived process grant after confirmation', async () => {
    const now = Date.parse('2026-08-28T08:00:00.000Z')
    const calls: unknown[] = []
    const result = await runExplicitGameLaunch(
      { grantId: 'confirmed-launch', installation, resourcePath: '  C:/Maps/Fixture.SC2Map  ' },
      {
        now: () => now,
        confirm: async request => {
          expect(request).toMatchObject({
            title: 'Launch StarCraft II?',
            action: 'Launch game',
          })
          expect(request.detail).toContain('C:/Maps/Fixture.SC2Map')
          return true
        },
        execute: async request => {
          calls.push(request)
          return { state: 'injected-success' as const }
        },
      },
    )
    expect(result).toEqual({ state: 'executed', result: { state: 'injected-success' } })
    expect(calls).toEqual([
      {
        gameId: installation.gameId,
        installation,
        resource: { kind: 'map', path: 'C:/Maps/Fixture.SC2Map' },
        grant: {
          id: 'confirmed-launch',
          classes: ['process-launch'],
          subjectScope: ['C:/Maps/Fixture.SC2Map'],
          expiresAt: new Date(now + VSCODE_GAME_LAUNCH_GRANT_TTL_MS).toISOString(),
        },
      },
    ])
  })
})
