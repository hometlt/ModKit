import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { uint64 } from '@modkit/core'
import {
  createHostTopology,
  type PermissionGrant,
  type WorldSceneSource,
} from '@modkit/sdk'
import { linkedExtensionInputs, type ExtensionInput } from '@modkit/host'
import {
  createNodeSubjectServices,
  loadExtensionDirectory,
  nodeRuntimeTargetBase,
  openFileArtifactSource,
} from '@modkit/host/node'
import { sceneModule } from '../../scene/src/module.js'
import { uvModule } from '../../uv/src/module.js'
import {
  createUvwWorldSceneSource,
  materializeWorldToUvpMap,
  packUvpArchive,
  parseUvwProfile,
} from '../../uv/src/world/index.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const scratch = mkdtempSync(join(tmpdir(), 'modkit-uvp-open-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const HOST = 'org.modkit.test/uvp-host'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.modkit.test/uvp-open',
  realms: [
    {
      schemaVersion: 1,
      realmId: HOST,
      revision: '1',
      target: nodeRuntimeTargetBase(),
      facilities: ['filesystem.read-random'],
      budgets: {
        maxConcurrentTasks: 2,
        maxWorkerCount: 0,
        maxResidentBytes: uint64('268435456'),
        maxTransferBytes: uint64('67108864'),
        defaultDeadlineMs: 30_000,
      },
      policy: { id: 'org.modkit.test/uvp-open-policy', revision: '1' },
    },
  ],
  links: [],
})
const budget = {
  maxInputBytes: 64n * 1024n * 1024n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 64 * 1024 * 1024,
  maxDiagnostics: 1_000,
}
const READ: PermissionGrant = { id: 'uvp-open-read', classes: ['read-source'] }

describe('a single-file UVP', () => {
  it('opens through the ZIP codec as the world it packages', async () => {
    const fixture = join(
      repoRoot,
      'vendor/multiverse-specs/specs/world/fixtures/uvw-profile-single-space.uvw.json',
    )
    const document = parseUvwProfile(new Uint8Array(readFileSync(fixture)))
    const packed = await materializeWorldToUvpMap(
      createUvwWorldSceneSource(document, { snapshotId: 'fixture', mapId: 'single-space' }),
      {
        packageId: 'modkit.test/single-space',
        packageVersion: '1.0.0',
        maxPageItems: 64,
        maxTerrainItems: 64,
        maxFacetItems: 64,
        maxOutputBytes: 1024 * 1024,
        maxTextureBytes: 1024,
        maxMediaBytes: 1024 * 1024,
      },
    )
    if (packed.state !== 'materialized') throw new Error(JSON.stringify(packed.refusals))
    const path = join(scratch, 'single-space.uvp')
    writeFileSync(path, packUvpArchive(packed.entries, { maxNodes: 100, maxInputBytes: 1n << 24n }))

    // the core archive codec in-process, beside the linked scene and UV modules
    const archives: ExtensionInput = {
      ...(await loadExtensionDirectory(join(repoRoot, 'extensions', 'archives'))),
      execution: { origin: 'linked', allowTrustedInProcess: true },
    }
    const linked = linkedExtensionInputs([sceneModule, uvModule])
    const services = await createNodeSubjectServices({
      topology,
      realms: { host: HOST, workers: HOST },
      extensions: [archives, ...linked.inputs],
      linkedModules: linked.modules,
    })
    const opened = await services.open({
      source: await openFileArtifactSource(path),
      path,
      intent: 'full',
      grant: READ,
      budget,
    })
    if (opened.state !== 'opened') throw new Error(JSON.stringify(opened.diagnostics))
    try {
      expect(opened.selected.contributionId).toBe('modkit/world-uvp')
      const world = await opened.session.dataSource('common.view/world-scene-source', 1)
      try {
        const info = await (world.value as WorldSceneSource).info()
        expect(info).toMatchObject({ mapId: 'modkit.test/single-space' })
      } finally {
        await world.release()
      }
    } finally {
      await opened.session.dispose()
    }
  }, 60_000)
})
