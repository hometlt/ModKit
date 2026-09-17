/**
 * A unit card shows the unit's model: the SC2 data codec only names it (Actor → Model → M3 path),
 * the host resolves that name through the catalog's own resource session, converts the M3 and lends
 * the scene on the entity's facts source.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { SubjectFactsSource, SubjectSelectorSource } from '@modkit/sdk'
import { createModkit } from '@modkit/host/node'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const blizzard = join(repoRoot, '..', 'modkit-extensions-blizzard')
const m3 = join(blizzard, 'models', 'test', 'mk2', 'm3', 'test', 'fixtures', 'model.m3')
const scratch = mkdtempSync(join(tmpdir(), 'x3-sc2-card-model-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const CATALOG = `<?xml version="1.0" encoding="utf-8"?>
<Catalog>
    <CUnit id="Probe">
        <LifeMax value="20"/>
    </CUnit>
    <CActorUnit id="Probe">
        <On Terms="UnitBirth.Probe" Send="Create"/>
        <Model value="Probe"/>
    </CActorUnit>
    <CModel id="Probe">
        <Model value="Assets\\Units\\Protoss\\Probe\\Probe.m3"/>
    </CModel>
</Catalog>
`

describe.skipIf(!existsSync(m3))('SC2 unit card model', () => {
  it('lends the host-resolved M3 of a unit through its facts source', { timeout: 180_000 }, async () => {
    const mod = join(scratch, 'Probe.SC2Mod')
    const gameData = join(mod, 'Base.SC2Data', 'GameData')
    const assets = join(mod, 'Assets', 'Units', 'Protoss', 'Probe')
    mkdirSync(gameData, { recursive: true })
    mkdirSync(assets, { recursive: true })
    writeFileSync(join(gameData, 'UnitData.xml'), CATALOG)
    copyFileSync(m3, join(assets, 'Probe.m3'))
    writeFileSync(
      join(mod, 'ComponentList.SC2Components'),
      '<?xml version="1.0" encoding="utf-8"?>\n<Components>\n    <DataComponent Type="GameData">GameData</DataComponent>\n</Components>\n',
    )
    const modkit = await createModkit({
      extensions: [],
      userExtensions: [
        join(blizzard, 'starcraft2'),
        join(blizzard, 'mpq'),
        join(blizzard, 'models'),
        join(repoRoot, 'extensions', 'images'),
        join(repoRoot, 'extensions', 'models'),
      ],
      roots: [scratch],
      intent: 'full',
    })
    try {
      expect(modkit.extensionFailures).toEqual([])
      const opened = await modkit.open(join(gameData, 'UnitData.xml'))
      expect(opened.snapshot.state, JSON.stringify(opened.snapshot).slice(0, 800)).toBe('opened')
      try {
        const selector = await opened.session!.dataSource('common.view/subject-selector-source', 1)
        const { items } = await (selector.value as SubjectSelectorSource).subjects({ limit: 64 })
        const probe = items.find(item => item.kind === 'Unit' && item.label.includes('Probe'))
        expect(probe, JSON.stringify(items)).toBeDefined()
        const facts = await (selector.value as SubjectSelectorSource).openFacts(probe!.subjectId)
        const source = facts.value as SubjectFactsSource
        const summary = await source.summary()
        expect(summary.identity.model).toBe('Assets/Units/Protoss/Probe/Probe.m3')
        const scene = await source.openModel!()
        const info = await scene.value.info()
        expect(info.meshes).toBeGreaterThan(0)
        const meshes = await scene.value.meshes({ limit: 8 })
        expect(meshes.items.length).toBeGreaterThan(0)
        const materials = await source.openModelMaterials!()
        expect((await materials.value.materials({ limit: 8 })).items.length).toBeGreaterThan(0)
        await Promise.all([scene.release(), materials.release()])
        await facts.release()
        await selector.release()
      } finally {
        await opened.close()
      }
    } finally {
      await modkit.close()
    }
  })
})
