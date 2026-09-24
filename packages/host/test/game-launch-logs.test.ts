import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { GameLaunchLogReport, GameLaunchPlan } from '@modkit/sdk/games'
import { watchGameLaunchLogs } from '../src/node/game-launch.js'

const documents = await mkdtemp(join(tmpdir(), 'modkit-game-logs-'))
afterAll(() => rm(documents, { recursive: true, force: true }))

const plan = {
  logs: { base: 'user-documents', relativePath: 'Game/GameLogs', patterns: ['*ScriptError.txt', '*Alerts.txt'] },
} as unknown as GameLaunchPlan

const until = async (condition: () => boolean): Promise<void> => {
  for (let tries = 0; tries < 100 && !condition(); tries += 1) await new Promise(done => setTimeout(done, 50))
}

describe('watching where a launched game logs', () => {
  it('reads only files the run writes, matching the plan, and stops at a final report', async () => {
    const folder = join(documents, 'Game', 'GameLogs')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'old ScriptError.txt'), 'an earlier run')
    const read: string[] = []
    const reports: [string, GameLaunchLogReport][] = []
    const watch = await watchGameLaunchLogs({
      plan,
      documentsDirectory: documents,
      writeDelayMs: 10,
      interpret: async (fileName, text) => {
        read.push(`${fileName}: ${text}`)
        return { diagnostics: [], final: /ScriptError/u.test(fileName) }
      },
      onReport: (fileName, report) => {
        reports.push([fileName, report])
      },
    })
    expect(watch?.directory).toBe(folder)
    await writeFile(join(folder, 'notes.txt'), 'not a log the plan names')
    await writeFile(join(folder, 'run Alerts.txt'), 'alert')
    await until(() => reports.length === 1)
    await writeFile(join(folder, 'run ScriptError.txt'), 'error')
    await until(() => reports.length === 2)
    await writeFile(join(folder, 'later ScriptError.txt'), 'after the verdict')
    await new Promise(done => setTimeout(done, 200))
    expect(read).toEqual(['run Alerts.txt: alert', 'run ScriptError.txt: error'])
    expect(reports.map(([name, report]) => [name, report.final])).toEqual([
      ['run Alerts.txt', false],
      ['run ScriptError.txt', true],
    ])
    watch?.dispose()
  })

  it('watches nothing when the plan logs nowhere or the folder is missing', async () => {
    const options = { interpret: async () => ({ diagnostics: [], final: true }), onReport: () => undefined }
    expect(await watchGameLaunchLogs({ plan: {} as GameLaunchPlan, ...options })).toBeUndefined()
    expect(
      await watchGameLaunchLogs({
        plan: { logs: { base: 'user-documents', relativePath: 'Missing', patterns: ['*.txt'] } } as unknown as GameLaunchPlan,
        documentsDirectory: documents,
        ...options,
      }),
    ).toBeUndefined()
  })
})
