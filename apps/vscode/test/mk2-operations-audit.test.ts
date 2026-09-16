import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPathSubjectOpener } from '@modkit/host/node'
import {
  GAME_TEMPLATE_WORKSPACE_INPUT,
  isGameTemplateDisplayItem,
} from '@modkit/sdk/templates'
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
  'resolved-view': { namespace: 'Abil', id: 'ReviveSelf' },
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

const layoutRoot = resolve(game, 'base.sc2data/UI/Layout')

/** Every layout of the mod, as the host would hand them over. */
function layoutDocuments(): readonly {
  uri: string
  languageId: string
  version: number
  text: string
}[] {
  const walk = (directory: string): string[] =>
    readdirSync(directory).flatMap(name => {
      const full = resolve(directory, name)
      return statSync(full).isDirectory() ? walk(full) : [full]
    })
  return walk(layoutRoot)
    .filter(file => file.toLowerCase().endsWith('.sc2layout'))
    .map(file => ({
      uri: `file:///${file.replaceAll('\\', '/')}`,
      languageId: 'sc2-layout',
      version: 1,
      text: readFileSync(file, 'utf8'),
    }))
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
              ? JSON.stringify(result.value ?? (result as Record<string, unknown>).output ?? Object.keys(result)).slice(
                  0,
                  operation.handlerId === 'game-template-preview' ? 1400 : 220,
                )
              : `${result.reason ?? ''} ${(result.diagnostics ?? []).map(d => d.message).join('; ').slice(0, 100)}`
          console.log(`  ${label}/${operation.handlerId}: ${result.state} ${shape}`)
          if (operation.handlerId === 'game-template-preview' && result.state === 'ok') {
            // What the producer emits is what the generic canvas draws; a game that drifts from the
            // shape stops being drawable and starts being a JSON dump again.
            const payload = (result.value ?? (result as Record<string, unknown>)['output']) as
              | { value?: { displayItems?: readonly unknown[] } }
              | undefined
            const items = (payload?.value?.displayItems ?? []) as readonly unknown[]
            expect(items.length).toBeGreaterThan(0)
            expect(items.filter(item => !isGameTemplateDisplayItem(item))).toEqual([])
          }
        } catch (error) {
          console.log(`  ${label}/${operation.handlerId}: THREW ${String(error).slice(0, 300)}`)
        }
      }
      await ops.dispose()
      await session.dispose()
      seen.set(label, operations.map(operation => operation.id))
    }
    /*
     * The same operation, once with the mod and once without: the snapshot the host now hands over
     * is what turns «template was not found» into a resolved frame.
     */
    const layoutOpened = (await open(
      resolve(game, 'base.sc2data/UI/Layout/Common/StandardDialog.SC2Layout'),
    )) as { session?: { operations(): { invoke: Function; dispose(): Promise<void> } } }
    const layoutOps = layoutOpened.session?.operations()
    if (layoutOps !== undefined) {
      const unresolved = async (input: unknown): Promise<number> => {
        const result = (await layoutOps.invoke('game-template-preview', input as never)) as {
          state: string
          output?: { value?: { diagnostics?: readonly { code: string }[] } }
        }
        expect(result.state).toBe('ok')
        const diagnostics = result.output?.value?.diagnostics ?? []
        return diagnostics.filter(item => item.code === 'unresolved-template').length
      }
      const alone = await unresolved({})
      const withMod = await unresolved({ [GAME_TEMPLATE_WORKSPACE_INPUT]: layoutDocuments() })
      console.log(`template preview unresolved templates: alone=${alone} withMod=${withMod}`)
      expect(alone).toBeGreaterThan(0)
      expect(withMod).toBe(0)
      await layoutOps.dispose()
    }

    // Every MK2 command that became an operation is declared and available on its subject.
    expect(seen.get('sc2-data')).toEqual(
      expect.arrayContaining([
        'blizzard/sc2-data.entity-cards',
        'blizzard/sc2-data.resolve-inheritance',
        'blizzard/sc2-data.resolved-view',
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
