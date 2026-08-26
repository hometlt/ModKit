import { existsSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
  artifactByteSourceFromRandomAccess,
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openSubject,
} from '@modkitx-x3/host'
import { loadExtensionDirectory, openFileSource } from '@modkitx-x3/host/node'
import {
  revisionId,
  type ModelSceneSource,
  type ResourceBudget,
  type TreeDataSource,
} from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const emperorRoot = process.env.MODKITX_EMPEROR_ROOT?.trim()
const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const budget: ResourceBudget = {
  maxInputBytes: 8_000_000n,
  maxDepth: 128,
  maxNodes: 100_000,
  maxScalarBytes: 8_000_000,
  maxDiagnostics: 100,
}

function firstXbf(root: string): string | undefined {
  const pending = ['']
  let visited = 0
  while (pending.length > 0) {
    const folder = pending.shift()
    if (folder === undefined) break
    const entries = readdirSync(join(root, folder), { withFileTypes: true }).toSorted(
      (left, right) => left.name.localeCompare(right.name, 'en'),
    )
    for (const entry of entries) {
      visited += 1
      if (visited > 100_000) throw new RangeError('Emperor corpus discovery exceeds node budget')
      const child = join(folder, entry.name)
      if (entry.isDirectory()) pending.push(child)
      else if (entry.isFile() && extname(entry.name).toLocaleLowerCase() === '.xbf') return child
    }
  }
  return undefined
}

const emperorXbf =
  emperorRoot !== undefined && existsSync(emperorRoot) ? firstXbf(emperorRoot) : undefined
const unavailableReason =
  emperorRoot === undefined
    ? 'MODKITX_EMPEROR_ROOT is not set'
    : emperorXbf === undefined
      ? 'MODKITX_EMPEROR_ROOT contains no XBF sample'
      : undefined

describe('installed Emperor: Battle for Dune product vertical', () => {
  it.skipIf(emperorXbf === undefined)(
    unavailableReason ?? 'opens a real XBF model through the host-owned product path',
    async () => {
      if (emperorRoot === undefined || emperorXbf === undefined)
        throw new TypeError('Emperor corpus did not resolve')
      const path = join(emperorRoot, emperorXbf)
      console.info(`[emperor-live] root ${emperorRoot}`)
      console.info(`[emperor-live] sample ${relative(emperorRoot, path).replaceAll('\\', '/')}`)
      const input = await loadExtensionDirectory(join(repoRoot, 'extensions', 'ea', 'emperor'))
      const inventory = await buildInventory(
        [{ ...input, execution: { origin: 'bundled', allowTrustedInProcess: true } }],
        createHostContributionContractRegistry(),
      )
      const executionBackends = createExecutionBackendRegistry([
        TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
      ])
      const random = await openFileSource(path)
      try {
        const source = await artifactByteSourceFromRandomAccess(random, {
          ref: { id: random.id, uri: random.id },
          revision: revisionId(
            `provider-token:${encodeURIComponent(`emperor-live:${emperorXbf}`)}`,
          ),
        })
        const opened = await openSubject({
          inventory,
          source,
          path: emperorXbf,
          intent: 'full',
          target,
          grant: { id: 'emperor-live-xbf', classes: ['read-source'] },
          executionBackends,
          budget,
        })
        if (opened.state !== 'opened')
          throw new Error(
            `real Emperor XBF open failed: ${opened.reason} ${JSON.stringify(opened.candidates)}`,
          )
        try {
          expect(opened.descriptor).toMatchObject({ identity: { formatId: 'emperor-xbf' } })
          const modelLease = await opened.session.dataSource('common.view/model-scene-source', 1)
          const treeLease = await opened.session.dataSource('common.view/tree-data-source', 1)
          try {
            const info = await (modelLease.value as ModelSceneSource).info()
            expect(info).toMatchObject({
              scenes: 1,
              nodes: 9,
              meshes: 4,
              primitives: 4,
              materials: 5,
              animations: 25,
              geometryAccess: 'decoded',
            })
            expect(info.textures).toBe(5)
            const tree = treeLease.value as TreeDataSource
            expect(
              (await tree.children(await tree.root(), { limit: 100 })).items.length,
            ).toBeGreaterThan(0)
            console.info(
              `[emperor-live] codec emperor-xbf, nodes ${info.nodes}, meshes ${info.meshes}, materials ${info.materials}, animations ${info.animations}`,
            )
          } finally {
            await treeLease.release()
            await modelLease.release()
          }
        } finally {
          await opened.session.dispose()
        }
      } finally {
        await random.dispose()
      }
    },
    30_000,
  )
})
