/**
 * The facade's default worker limits fit the StarCraft II directory extension, and a subject its
 * codec cannot examine within tighter limits says so instead of opening as a bare `no-match`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createModkit, workerBackendPolicy, type WorkerBackendPolicy } from '@modkit/host/node'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const sc2 = join(repoRoot, '..', 'modkit-extensions-blizzard', 'starcraft2')
const mod = join(repoRoot, 'packages', 'testkit', 'test', 'fixtures', 'mk2-loose-mod')
const unitData = join(mod, 'Probe.SC2Mod', 'Base.SC2Data', 'GameData', 'UnitData.xml')

async function openUnitData(policy?: WorkerBackendPolicy) {
  const modkit = await createModkit({
    extensions: [],
    userExtensions: [sc2],
    roots: [mod],
    writableRoots: [mod],
    intent: 'inspect',
    ...(policy === undefined ? {} : { policy }),
  })
  try {
    expect(modkit.extensionFailures).toEqual([])
    const opened = await modkit.open(unitData)
    const editable = opened.editing !== undefined
    await opened.close()
    return { snapshot: opened.snapshot, editable }
  } finally {
    await modkit.close()
  }
}

describe.skipIf(!existsSync(sc2))('SC2 extension under the host worker limits', () => {
  it('opens and edits GameData with the default policy', { timeout: 180_000 }, async () => {
    const { snapshot, editable } = await openUnitData()
    expect(snapshot.state, JSON.stringify(snapshot).slice(0, 1500)).toBe('opened')
    if (snapshot.state === 'opened') expect(snapshot.selected.contributionId).toBe('blizzard/sc2-data')
    expect(editable).toBe(true)
  })

  it('reports an over-budget worker as a subject diagnostic', { timeout: 180_000 }, async () => {
    // measured: the SC2 data codec does not fit a 32 MB heap even on this one-unit fixture
    const { snapshot } = await openUnitData(
      workerBackendPolicy({ resourceLimits: { maxOldGenerationSizeMb: 16 } }),
    )
    expect(snapshot.state).toBe('unresolved')
    expect(snapshot.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'x3.host/subject-open-worker-refused',
        severity: 'error',
        message: expect.stringMatching(/memory limit/u),
      }),
    )
  })
})
