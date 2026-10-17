import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  createModkit,
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

async function packFixture(): Promise<string> {
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
    return path
}

describe('a single-file UVP', () => {
  it('opens through the ZIP codec as the world it packages', async () => {
    const path = await packFixture()
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
      // map.export-native is wired to the package: without an installed encoder for the format it
      // fails resolving that encoder, not as an unknown operation
      await expect(
        opened.session.operations().invoke('export-uvp-native', { schemaVersion: 1, formatId: 'test-map' }),
      ).rejects.toThrow(/service contract resolution failed/u)
    } finally {
      await opened.session.dispose()
    }
  }, 60_000)

  // The UVP codec runs in-process; a trusted encoder beside it gets the whole package without a
  // worker frame (a 700 MB SC2 map does not fit one), an untrusted one keeps its worker variant.
  it.each([true, false])('hands the package to an encoder beside it when that is trusted (%s)', async trustedRoot => {
    const path = await packFixture()
    const root = mkdtempSync(join(scratch, 'encoder-'))
    mkdirSync(join(root, 'contributions'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'uvp-encoder-fixture', version: '1.0.0', license: 'MIT', type: 'module',
      modkit: { schemaVersion: 1, publisher: 'org.modkitx.test', id: 'uvp-encoder',
        contributionManifests: ['./contributions/encoder.json'] },
    }))
    writeFileSync(join(root, 'contributions/encoder.json'), JSON.stringify({
      schemaVersion: 1, contract: { id: 'modkit/service-provider-contribution', major: 1 },
      id: 'org.modkitx.test/uvp-encoder', displayName: 'UVP encoder fixture',
      runtimeVariants: [
        { variantId: 'trusted-node', entrypoint: './trusted.js', target: { environments: ['node'] },
          executionProfile: 'trusted-in-process', requestedPermissionClasses: [] },
        { variantId: 'portable', entrypoint: './portable.js', target: { environments: ['node-worker'] },
          executionProfile: 'worker-brokered', requestedPermissionClasses: [] },
      ],
      spec: { lifecycleScope: 'operation', provides: [{ offerId: 'test-map', contract: 'common.map/native-encoder',
        major: 1, version: '1.0.0', facet: { formatIds: ['test-map'] } }] },
    }))
    for (const where of ['trusted', 'portable'])
      writeFileSync(join(root, `${where}.js`), `
        export const abiVersion = 1
        export const provides = ['common.map/native-encoder']
        export function createProvider() {
          return { value: { contract: provides[0], formatId: 'test-map', extension: 'bin',
            encode: async ({ uvw }) => ({ formatId: 'test-map', extension: 'bin',
              bytes: new TextEncoder().encode('${where}:' + uvw.length) }),
          }, release: async () => {} }
        }
      `)
    const modkit = await createModkit({
      modules: [sceneModule, uvModule],
      extensions: [join(repoRoot, 'extensions', 'archives')],
      roots: [scratch],
      ...(trustedRoot ? { trustedExtensions: [root] } : { userExtensions: [root] }),
    })
    try {
      expect(modkit.extensionFailures).toEqual([])
      const opened = await modkit.services.open({
        source: await openFileArtifactSource(path), path, intent: 'full', grant: READ, budget,
      })
      if (opened.state !== 'opened') throw new Error(JSON.stringify(opened.diagnostics))
      try {
        expect(opened.selected.contributionId).toBe('modkit/world-uvp')
        const result = (await opened.session.operations().invoke('export-uvp-native', {
          schemaVersion: 1, formatId: 'test-map',
        })) as { readonly state: string; readonly output: { readonly kind: string; readonly value: Uint8Array } }
        expect(result.state).toBe('ok')
        expect(result.output.kind).toBe('bytes')
        expect(new TextDecoder().decode(result.output.value)).toMatch(trustedRoot ? /^trusted:\d+$/u : /^portable:\d+$/u)
      } finally {
        await opened.session.dispose()
      }
    } finally {
      await modkit.close()
    }
  }, 60_000)
})
