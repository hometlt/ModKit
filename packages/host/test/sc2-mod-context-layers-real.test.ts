/**
 * Resources for a document of a CASC mod: the loader's chain for a Liberty unit file, and every
 * layer of it — Core and Liberty from the game's storage — opened by the SC2 mod codec over the
 * loader's own listing, answering the package tree an author browses (GameData, strings, files…).
 *
 * Needs an installed StarCraft II (`MODKITX_SC2_ROOT`, or `C:\Apps\StarCraft II`) and a built
 * SC2 extension; skipped without them.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { TreeDataSource } from '@modkit/sdk'
import { loadContentSources } from '@modkit/vfs/content-sources/node'
import { createModkit } from '@modkit/host/node'

import { openModContextLayerSource } from '../src/mod-context-layer-source.js'
import { resolveSubjectClosure } from '../src/content-dependency-operations.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const blizzard = join(repoRoot, '..', 'modkit-extensions-blizzard')
const sourcesModule = join(
  blizzard,
  'starcraft2',
  'dist',
  'modules',
  'game',
  'battlenet',
  'content-sources',
  'local-content-sources.js',
)
const installation = process.env['MODKITX_SC2_ROOT'] ?? 'C:/Apps/StarCraft II'
const scratch = mkdtempSync(join(tmpdir(), 'x3-sc2-layers-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

async function rootLabels(tree: TreeDataSource): Promise<string[]> {
  const page = await tree.children(await tree.root(), { limit: 100 })
  return Promise.all(page.items.map(async item => (await tree.facts(item)).label))
}

describe.skipIf(!existsSync(installation) || !existsSync(sourcesModule))(
  'SC2 mod context layers as package subjects',
  () => {
    it('opens Core and Liberty from CASC with the mod codec', { timeout: 300_000 }, async () => {
      const config = join(scratch, 'sources.json')
      writeFileSync(
        config,
        JSON.stringify({
          module: sourcesModule,
          options: { installationDirectory: installation, stateDirectory: scratch },
        }),
      )
      const contentSources = await loadContentSources(config, scratch)
      if (contentSources === undefined) throw new Error('content sources did not load')
      const modkit = await createModkit({
        extensions: [],
        userExtensions: [join(blizzard, 'starcraft2'), join(blizzard, 'mpq')],
        roots: [scratch],
        intent: 'full',
      })
      try {
        const closure = await resolveSubjectClosure({
          contentSources,
          subject: {
            descriptor: {},
            target: {
              sourceId: 'local:casc',
              path: 'mods/liberty.sc2mod/base.sc2data/gamedata/unitdata.xml',
            },
          },
          keepContext: true,
        })
        const context = closure.context
        expect(context, JSON.stringify(closure.diagnostics)).toBeDefined()
        try {
          const names = context!.layers.map(layer => `${layer.displayName}:${layer.role}`)
          expect(names.some(name => /core/iu.test(name))).toBe(true)
          expect(names.at(-1)).toMatch(/liberty.*:primary/iu)
          for (const layer of context!.layers) {
            const root = `modkit-source://battlenet/${layer.sourceId}/${layer.sourcePath}`
            const started = Date.now()
            const source = await openModContextLayerSource({
              context: context!,
              layerId: layer.id,
              ref: { id: root, uri: root },
            })
            const opened = await modkit.services.open({
              source,
              path: root,
              intent: 'full',
              grant: { id: 'test', classes: ['read-source'] },
              budget: {
                maxInputBytes: 1n << 32n,
                maxDepth: 256,
                maxNodes: 1_000_000,
                maxScalarBytes: 64 * 1024 * 1024,
                maxDiagnostics: 10_000,
                deadlineMs: 120_000,
              },
            })
            // Editor add-on folders are layers but not packages; every package opens.
            if (/\.sc2mod$/iu.test(layer.sourcePath)) {
              expect(
                opened.state,
                `${layer.displayName}: ${JSON.stringify(opened.diagnostics.filter(item => item.severity !== 'information'))}`,
              ).toBe('opened')
            }
            if (opened.state !== 'opened') continue
            try {
              const lease = await opened.session.dataSource('common.view/tree-data-source', 1)
              try {
                const labels = await rootLabels(lease.value as TreeDataSource)
                console.log(
                  `${layer.displayName}: ${labels.join(' | ')} (${Date.now() - started} ms)`,
                )
                expect(labels.length, layer.displayName).toBeGreaterThan(0)
              } finally {
                await lease.release()
              }
            } finally {
              await opened.session.dispose()
            }
          }
        } finally {
          await context!.dispose()
        }
      } finally {
        await modkit.close?.()
        await contentSources.dispose()
      }
    })
  },
)
