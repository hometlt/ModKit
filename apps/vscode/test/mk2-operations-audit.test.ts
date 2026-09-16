import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPathSubjectOpener } from '@modkit/host/node'
import { createVsCodeSubjectHost } from '../src/host.js'

const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const blizzard = resolve(repo, '..', 'modkit-extensions-blizzard')
const game = resolve(repo, '..', 'references', 'SC2GameData', 'mods', 'core.sc2mod')

const FILES = [
  ['sc2-data', resolve(game, 'base.sc2data/GameData/AbilData.xml')],
  ['sc2-strings', resolve(game, 'enus.sc2data/LocalizedData/GameStrings.txt')],
  ['sc2-layout', resolve(game, 'base.sc2data/UI/Layout/Common/StandardDialog.SC2Layout')],
  ['galaxy', resolve(game, 'base.sc2data/TriggerLibs/MeleeAI.galaxy')],
  ['sc2-style', resolve(game, 'base.sc2data/UI/FontStyles.SC2Style')],
] as const

const INPUTS: Record<string, unknown> = {
  'entity-cards': { namespace: 'Abil', entityId: 'ReviveSelf' },
  'resolve-inheritance': { namespace: 'Abil', id: 'ReviveSelf' },
  references: { namespace: 'Abil', id: 'ReviveSelf' },
  translate: { key: 'Abil/Name/Beacon', sourceLanguage: 'en', targetLanguage: 'ru' },
  'render-markup': { key: 'Abil/Name/Beacon' },
  'resolve-fallback': { key: 'Abil/Name/Beacon', locales: [] },
  'compare-locales': { locales: [] },
  'filter-entities': { namespace: 'Abil' },
  'edit-field': { namespace: 'Abil', id: 'ReviveSelf', field: 'Name', value: 'Revive' },
  'rename-entity': { namespace: 'Abil', id: 'ReviveSelf', newId: 'ReviveSelf2' },
  'edit-strings': { edits: [{ key: 'Abil/Name/Beacon', value: 'Beacon 2' }] },
  'rename-reference': { from: 'StandardTemplates/StandardSmallPanelTemplate', to: 'X' },
  'extract-subtree': { namespace: 'Abil', seeds: ['ReviveSelf'] },
}

describe('MK2 operation audit', () => {
  // The corpus is a real StarCraft II installation's data; without it there is nothing to audit.
  it.skipIf(!existsSync(game))('reports every declared operation and invokes the MK2-facing ones', async () => {
    const host = await createVsCodeSubjectHost({
      catalogCandidates: [resolve(repo, 'extensions')],
      configuredExtensions: [
        resolve(blizzard, 'starcraft2'),
        resolve(blizzard, 'mpq'),
        resolve(blizzard, 'models'),
      ],
    })
    const open = createPathSubjectOpener({
      subjects: host.services,
      roots: [game],
      grant: { id: 'audit', classes: ['read-source', 'network', 'credentials'] },
      budget: {
        maxInputBytes: BigInt(512 * 1024 * 1024),
        maxDepth: 256,
        maxNodes: 4_000_000,
        maxScalarBytes: 512 * 1024 * 1024,
        maxDiagnostics: 10_000,
        deadlineMs: 120_000,
      },
    })
    const seen = new Map<string, readonly string[]>()
    for (const [label, path] of FILES) {
      const opened = (await open(path)) as {
        session?: {
          descriptor(): Promise<{ operations?: readonly { id: string; handlerId: string; state: string }[] }>
          operations(): { invoke: Function; dispose(): Promise<void> }
          dispose(): Promise<void>
        }
      }
      const session = opened.session
      if (session === undefined) {
        console.log(`${label}: OPEN FAILED`)
        continue
      }
      const descriptor = await session.descriptor()
      const operations = descriptor.operations ?? []
      console.log(`${label} OPS ${operations.map(o => `${o.id}->${o.handlerId}(${o.state})`).join(' ')}`)
      const ops = session.operations()
      for (const operation of operations) {
        if (operation.id.startsWith('export.')) continue
        const input = INPUTS[operation.handlerId] ?? {}
        try {
          const result = (await ops.invoke(operation.handlerId, input as never)) as {
            state: string
            reason?: string
            value?: unknown
            diagnostics?: readonly { message: string }[]
          }
          const shape =
            result.state === 'completed' || result.state === 'ok'
              ? JSON.stringify(result.value ?? (result as Record<string, unknown>).output ?? Object.keys(result)).slice(0, 220)
              : `${result.reason ?? ''} ${(result.diagnostics ?? []).map(d => d.message).join('; ').slice(0, 100)}`
          console.log(`  ${label}/${operation.handlerId}: ${result.state} ${shape}`)
        } catch (error) {
          console.log(`  ${label}/${operation.handlerId}: THREW ${String(error).slice(0, 300)}`)
        }
      }
      await ops.dispose()
      await session.dispose()
      seen.set(label, operations.map(operation => operation.id))
    }
    // Every MK2 command that became an operation is declared and available on its subject.
    expect(seen.get('sc2-data')).toEqual(
      expect.arrayContaining([
        'blizzard/sc2-data.entity-cards',
        'blizzard/sc2-data.resolve-inheritance',
        'blizzard/sc2-data.references',
        'asset.validate',
        'edit.field',
      ]),
    )
    expect(seen.get('sc2-strings')).toEqual(
      expect.arrayContaining([
        'blizzard/sc2-strings.render',
        'blizzard/sc2-strings.translate',
        'edit.content',
      ]),
    )
    expect(seen.get('sc2-layout')).toEqual(
      expect.arrayContaining([
        'blizzard/sc2-layout.preview',
        'blizzard/sc2-layout.render-visual',
        'view.template',
      ]),
    )
  }, 900_000)
})
