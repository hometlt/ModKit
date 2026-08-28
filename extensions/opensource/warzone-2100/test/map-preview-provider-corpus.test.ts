import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseZipArchive } from 'modkit-extension-x3-archives/formats/zip/codec'
import { prepareWarzoneMapPreview } from '../src/map-preview-provider.js'
import { applyWarzoneLastWins } from '../src/warzone-wz/codec.js'

const corpusRoot = process.env['MODKITX_WARZONE_ROOT']
const configured = typeof corpusRoot === 'string' && corpusRoot.length > 0
const archivePath = configured ? join(corpusRoot, 'data', 'mp.wz') : ''

describe.skipIf(!configured)('Warzone 2100 installed mp.wz map preview preparation', () => {
  it('fits the product namespace budget, exposes all 39 maps and prepares only the explicit selection', async () => {
    if (!existsSync(archivePath)) {
      throw new Error('MODKITX_WARZONE_ROOT must identify a Warzone install with data/mp.wz')
    }
    const bytes = await readFile(archivePath)
    const digest = createHash('sha256').update(bytes).digest('hex')
    expect(digest).toBe('d698475eaa7b3386c2465e5850e5609b0d524157280c7d659dc5f79cde6e5688')
    const physical = parseZipArchive(bytes, 4_096)
    const effective = applyWarzoneLastWins(physical).effective
    expect(physical).toHaveLength(619)
    expect(effective).toHaveLength(619)
    expect(effective.length).toBeLessThan(4_096)

    const subject = {
      schemaVersion: 1 as const,
      subjectUri: 'warzone-wz:installed/mp.wz',
      revision: `content-hash.sha256:${digest}`,
      formatId: 'warzone-wz',
      traits: ['container.entries'],
      dataSources: [{ contract: 'common.view/namespace-entry-source', major: 1 }],
      operations: [{ id: 'container.extract', state: 'available' }],
      namespace: {
        state: 'complete' as const,
        entries: effective.map(entry => ({
          path: entry.name,
          kind: entry.kind,
          ...(entry.kind === 'file' ? { size: String(entry.size) } : {}),
        })),
      },
    }
    const limits = { maxCandidates: 64, maxRoots: 8, maxDepth: 8 }
    const selection = await prepareWarzoneMapPreview({ subject, ...limits })
    expect(selection.state).toBe('selection-required')
    if (selection.state !== 'selection-required') {
      throw new Error('installed mp.wz did not require map selection')
    }
    expect(selection.candidates).toHaveLength(39)
    expect(selection.diagnostics).toEqual([])
    expect(selection.candidates).toContainEqual(
      expect.objectContaining({ sourcePath: 'multiplay/maps/10c-Emergence' }),
    )
    const highground = selection.candidates.find(
      candidate => candidate.sourcePath === 'multiplay/maps/2c-highground',
    )
    expect(highground).toEqual({
      candidateId: 'wz-map:28472c74cd7d7a70',
      displayName: '2c-highground',
      sourcePath: 'multiplay/maps/2c-highground',
    })
    if (highground === undefined) throw new Error('2c-highground candidate is missing')

    const prepared = await prepareWarzoneMapPreview({
      subject,
      selectionId: highground.candidateId,
      ...limits,
    })
    expect(prepared).toMatchObject({
      state: 'prepared',
      plan: {
        workspace: {
          gameId: 'org.modkitx/warzone-2100',
          activeRootId: 'map',
          roots: [
            { rootId: 'base', sourcePath: 'base' },
            { rootId: 'mp', sourcePath: 'mp' },
            { rootId: 'map', sourcePath: 'multiplay/maps/2c-highground' },
          ],
        },
        resources: {
          strategy: 'host-resolved',
          subjectNamespaceRoots: [
            { rootId: 'map', namespacePrefix: 'multiplay/maps/2c-highground' },
          ],
          roots: [
            { rootId: 'mp', locator: { archiveName: 'mp.wz' } },
            { rootId: 'base', locator: { archiveName: 'base.wz' } },
          ],
        },
      },
    })
    expect(JSON.stringify(prepared)).not.toMatch(/file:\/\/|"[A-Za-z]:[\\/]/u)
    console.info(
      `[warzone-map-preview] mp.wz effective=${effective.length}, candidates=${selection.candidates.length}, selected=${highground.sourcePath}`,
    )
  }, 120_000)
})
