import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPathSubjectOpener } from '@modkit/host/node'
import { createVsCodeSubjectHost } from '../src/host.js'

const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const blizzard = resolve(repo, '..', 'modkit-extensions-blizzard')
const game = resolve(repo, '..', 'references', 'SC2GameData', 'mods', 'core.sc2mod')
const fixtures = resolve(repo, 'packages', 'testkit', 'test', 'fixtures', 'mk2-synthetic')
const looseMod = resolve(fixtures, '..', 'mk2-loose-mod')

/** The smallest directory the loose-mod codec accepts: a component list plus the data it names. */
function writeLooseMod(): void {
  const root = resolve(looseMod, 'Probe.SC2Mod')
  mkdirSync(resolve(root, 'Base.SC2Data', 'GameData'), { recursive: true })
  mkdirSync(resolve(root, 'enUS.SC2Data', 'LocalizedData'), { recursive: true })
  writeFileSync(
    resolve(root, 'ComponentList.SC2Components'),
    '<?xml version="1.0" encoding="utf-8"?>\n<Components>\n  <DataComponent Type="gada">Base.SC2Data/GameData</DataComponent>\n</Components>\n',
  )
  writeFileSync(
    resolve(root, 'Base.SC2Data', 'GameData', 'UnitData.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<Catalog>\n  <CUnit id="Marine"><LifeMax value="45"/></CUnit>\n</Catalog>\n',
  )
  writeFileSync(
    resolve(root, 'enUS.SC2Data', 'LocalizedData', 'GameStrings.txt'),
    'Unit/Name/Marine=Marine\n',
  )
}

const SUBJECTS: readonly (readonly [string, string])[] = [
  ['sc2-data', resolve(game, 'base.sc2data/GameData/AbilData.xml')],
  ['sc2-layout', resolve(game, 'base.sc2data/UI/Layout/Common/StandardDialog.SC2Layout')],
  ['sc2-style', resolve(game, 'base.sc2data/UI/FontStyles.SC2Style')],
  ['sc2-strings', resolve(game, 'enus.sc2data/LocalizedData/GameStrings.txt')],
  ['galaxy', resolve(game, 'base.sc2data/TriggerLibs/MeleeAI.galaxy')],
  ['image', resolve(fixtures, 'minimal.dds')],
  ['audio', resolve(fixtures, 'minimal.wav')],
  ['video', resolve(fixtures, 'minimal.webm')],
  ['archive', resolve(fixtures, 'minimal.SC2Mod')],
  // A loose mod is the subject MK2's MOD tree was built on; the fixture is written by the test.
  ['mod-directory', resolve(fixtures, '..', 'mk2-loose-mod', 'Probe.SC2Mod')],
]

const CONTRACTS = [
  'common.view/table-data-source',
  'common.view/tree-data-source',
  'common.view/subject-facts-source',
  'common.view/subject-calculations-source',
  'common.view/relation-graph-source',
  'common.view/raster-image-source',
  'common.view/audio-media-source',
  'common.view/video-media-source',
  'common.view/namespace-entry-source',
]

describe('MK2 surface audit', () => {
  // The corpus is a real StarCraft II installation's data; without it there is nothing to audit.
  it.skipIf(!existsSync(game))('opens one subject of every kind and exercises its view sources', async () => {
    writeLooseMod()
    const host = await createVsCodeSubjectHost({
      catalogCandidates: [resolve(repo, 'extensions')],
      configuredExtensions: [resolve(blizzard, 'starcraft2'), resolve(blizzard, 'mpq')],
    })
    const open = createPathSubjectOpener({
      subjects: host.services,
      roots: [game, fixtures, looseMod],
      grant: { id: 'audit', classes: ['read-source'] },
      budget: {
        maxInputBytes: BigInt(512 * 1024 * 1024),
        maxDepth: 256,
        maxNodes: 4_000_000,
        maxScalarBytes: 512 * 1024 * 1024,
        maxDiagnostics: 10_000,
        deadlineMs: 120_000,
      },
    })
    const opened: string[] = []
    for (const [label, path] of SUBJECTS) {
      let result
      try {
        result = await open(path)
      } catch (error) {
        console.log(`${label}: OPEN FAILED ${String(error).slice(0, 160)}`)
        continue
      }
      const snapshot = (result as { snapshot: Record<string, unknown> }).snapshot
      const session = (result as { session?: { dataSource: Function; dispose: Function } }).session
      if (session === undefined) {
        {
          const cands = (snapshot.candidates ?? []) as readonly { contributionId: string; state: string; diagnostics?: readonly { code: string; message: string }[] }[]
          const why = cands.flatMap(c => (c.diagnostics ?? []).filter(d => !d.code.includes('worker-shared')).map(d => `${c.contributionId}:${d.code}:${d.message.slice(0, 90)}`))
          console.log(`${label}: UNRESOLVED ${[...new Set(why)].slice(0, 3).join(' | ')}`)
        }
        continue
      }
      const descriptor = snapshot.descriptor as { dataSources?: readonly { contract: string }[] }
      const declared = new Set((descriptor?.dataSources ?? []).map(d => d.contract))
      const report: string[] = []
      const page = { limit: 5 }
      const tablePage = { kind: 'range' as const, from: 0, count: 5 }
      for (const contract of CONTRACTS) {
        if (!declared.has(contract)) continue
        const short = contract.replace('common.view/', '').replace('-source', '')
        try {
          const lease = await session.dataSource(contract, 1)
          const api = lease.value as Record<string, Function>
          let detail = 'ok'
          if (contract.endsWith('table-data-source')) {
            const shape = await api.shape()
            const rows = await api.rows(tablePage)
            detail = `rows=${shape.rows} cols=${shape.columns} first=${JSON.stringify(rows.items?.[0] ?? null).slice(0, 60)}`
          } else if (contract.endsWith('tree-data-source')) {
            const root = await api.root()
            const kids = await api.children(root, page)
            const first = kids.items?.[0]
            const grandchildren =
              first === undefined ? undefined : await api.children(first, page)
            const facts = first === undefined ? undefined : await api.facts(first)
            detail =
              `root=${root.id} children=${kids.items?.length ?? 0}` +
              ` first=${facts?.label ?? '-'}/${String(facts?.preview ?? '-').slice(0, 12)}` +
              ` depth2=${grandchildren?.items?.length ?? 0}`
          } else if (contract.endsWith('subject-facts-source')) {
            const summary = await api.summary()
            const groups = await api.groups(page)
            const first = groups.items?.[0]
            const facts = first === undefined ? { items: [] } : await api.facts(first.id, page)
            detail = `groups=${groups.items?.length ?? 0} firstGroup=${first?.label ?? '-'} facts=${facts.items?.length ?? 0} title=${String(summary?.title ?? '-').slice(0, 40)}`
          } else if (contract.endsWith('relation-graph-source')) {
            const summary = await api.summary()
            const nodes = await api.nodes(page)
            const edges = await api.edges(page)
            detail = `nodes=${nodes.items?.length ?? 0} edges=${edges.items?.length ?? 0} total=${JSON.stringify(summary).slice(0, 60)}`
          } else if (contract.endsWith('raster-image-source')) {
            const info = await (api.info?.() ?? api.metadata?.() ?? Promise.resolve(undefined))
            detail = `info=${JSON.stringify(info).slice(0, 80)}`
          } else if (contract.endsWith('namespace-entry-source')) {
            const listing = await api.list('', page)
            detail = `entries=${listing.items?.length ?? 0} first=${String(listing.items?.[0]?.name ?? listing.items?.[0]?.id ?? '-').slice(0, 40)}`
          } else if (contract.includes('media-source')) {
            const info = await api.info()
            detail = `info=${JSON.stringify(info).slice(0, 110)}`
          } else {
            detail = `methods=${Object.keys(api).join('/')}`
          }
          report.push(`${short}[${detail}]`)
          await lease.release()
        } catch (error) {
          report.push(`${short}=ERR:${String(error).slice(0, 110)}`)
        }
      }
      const selected = snapshot.selected as { contributionId?: string } | undefined
      console.log(`${label}: codec=${selected?.contributionId} ${report.join(' ')}`)
      // A view the editor offers must answer; an error here is a stage that opens empty.
      expect(report.filter(item => item.includes('=ERR:'))).toEqual([])
      expect(report.length).toBeGreaterThan(0)
      opened.push(label)
      await session.dispose()
    }
    expect(opened).toEqual(SUBJECTS.map(([label]) => label))
  }, 900_000)
})
